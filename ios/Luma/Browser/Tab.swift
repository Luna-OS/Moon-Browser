import Combine
import UIKit
import WebKit

/// One browser tab. Owns its `WKWebView` (created lazily) and is its navigation / UI delegate.
@MainActor
final class Tab: NSObject, ObservableObject, Identifiable {
    let id: UUID
    let isPrivate: Bool

    @Published private(set) var title: String = ""
    @Published private(set) var url: URL?
    @Published private(set) var isLoading: Bool = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var canGoBack: Bool = false
    @Published private(set) var canGoForward: Bool = false
    @Published private(set) var isSecure: Bool = false
    @Published private(set) var snapshot: UIImage?
    @Published private(set) var loadError: TabLoadError?
    @Published private(set) var isDesktopSite: Bool = false
    @Published var pendingDialog: PageDialog? {
        didSet {
            // A dialog that is dropped without an answer must still release the page's JavaScript.
            if let old = oldValue, old.id != pendingDialog?.id,
               let cancel = dialogCancels.removeValue(forKey: old.id) {
                cancel()
            }
        }
    }

    /// Set by `TabManager`; used for popups and "open in new tab".
    weak var manager: TabManager?

    private var webViewStorage: WKWebView?
    private let dataStore: WKWebsiteDataStore?
    private var adoptedConfiguration: WKWebViewConfiguration?
    private var sharesContentController = false
    private var pendingRestoreURL: URL?
    private var upgradedFrom: URL?
    private var observations: [NSKeyValueObservation] = []
    private var cancellables = Set<AnyCancellable>()
    private var dialogCancels: [UUID: () -> Void] = [:]
    private var appliedRules: (generation: Int, allowlisted: Bool)?
    private var rulesGeneration = 0
    private var lastRecordedTitle: String = ""
    private var isTornDown = false

    /// Hosts that failed over HTTPS and were continued over HTTP by the user (this session only).
    private static var httpExceptions = Set<String>()

    init(id: UUID = UUID(),
         isPrivate: Bool,
         dataStore: WKWebsiteDataStore? = nil,
         manager: TabManager? = nil,
         restoredURL: URL? = nil,
         restoredTitle: String = "") {
        self.id = id
        self.isPrivate = isPrivate
        self.dataStore = dataStore
        super.init()
        self.manager = manager
        self.isDesktopSite = UIDevice.current.userInterfaceIdiom == .pad && AppSettings.shared.desktopSiteOnPad
        if let restoredURL {
            self.url = restoredURL
            self.title = restoredTitle
            self.pendingRestoreURL = restoredURL
        }
    }

    // MARK: - Derived state

    var showsNewTabPage: Bool { url == nil && !isLoading }

    var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        if let host = url?.host, !host.isEmpty {
            return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        }
        if let url, url.scheme != "about" { return url.absoluteString }
        return "New Tab"
    }

    var hasWebView: Bool { webViewStorage != nil }

    /// True for an untouched new-tab page (nothing loaded, nothing to restore).
    var isPristine: Bool { url == nil && !isLoading && pendingRestoreURL == nil && (webViewStorage?.url == nil) }

    var webView: WKWebView {
        if let existing = webViewStorage { return existing }
        let created = makeWebView()
        webViewStorage = created
        if pendingRestoreURL != nil {
            // Deferred: the getter is often called from inside a SwiftUI view update.
            Task { @MainActor [weak self] in self?.loadPendingRestore() }
        }
        return created
    }

    // MARK: - Commands

    func load(_ url: URL) {
        let scheme = (url.scheme ?? "").lowercased()
        guard Tab.webSchemes.contains(scheme) else {
            // Typed / chosen by the user: hand tel:, mailto:, itms-apps: … to the system.
            if !scheme.isEmpty, scheme != "file", scheme != "javascript" {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            return
        }
        var target = url
        upgradedFrom = nil
        if AppSettings.shared.httpsFirst, let upgraded = Tab.httpsUpgrade(target) {
            upgradedFrom = target
            target = upgraded
        }
        if AppSettings.shared.stripTrackingParams, Tab.isHTTP(target), let stripped = TrackingParams.strip(from: target) {
            target = stripped
        }
        startLoad(target)
    }

    func loadInput(_ text: String) {
        let settings = AppSettings.shared
        guard let result = Omnibox.resolve(text, engine: settings.searchEngine, bangs: settings.bangs) else { return }
        load(result.destination)
    }

    func reload() {
        if pendingRestoreURL != nil {
            loadPendingRestore()
            return
        }
        if let failed = loadError?.failedURL {
            startLoad(failed)
            return
        }
        guard let wv = webViewStorage else { return }
        if wv.url != nil {
            loadError = nil
            wv.reload()
        } else if let current = url {
            load(current)
        }
    }

    func stop() {
        webViewStorage?.stopLoading()
        syncState()
    }

    func goBack() {
        if loadError != nil {
            // The failed page never committed: "back" returns to what the web view still shows.
            dismissFailedNavigation()
            return
        }
        if pendingRestoreURL != nil { return }
        webViewStorage?.goBack()
    }

    func goForward() {
        guard loadError == nil, pendingRestoreURL == nil else { return }
        webViewStorage?.goForward()
    }

    func retryOverHTTP() {
        guard let failed = loadError?.failedURL ?? url,
              var components = URLComponents(url: failed, resolvingAgainstBaseURL: false) else { return }
        components.scheme = "http"
        guard let httpURL = components.url else { return }
        if let host = httpURL.host?.lowercased() { Tab.httpExceptions.insert(host) }
        upgradedFrom = nil
        startLoad(httpURL)
    }

    func setDesktopSite(_ on: Bool) {
        guard on != isDesktopSite else { return }
        isDesktopSite = on
        guard let wv = webViewStorage else { return }
        wv.customUserAgent = on ? Tab.desktopUserAgent : nil
        if wv.url != nil, loadError == nil {
            wv.reloadFromOrigin()
        }
    }

    func find(_ text: String, backwards: Bool) {
        guard let wv = webViewStorage, !text.isEmpty else { return }
        let configuration = WKFindConfiguration()
        configuration.backwards = backwards
        configuration.wraps = true
        configuration.caseSensitive = false
        wv.find(text, configuration: configuration) { _ in }
    }

    func clearFind() {
        webViewStorage?.evaluateJavaScript("window.getSelection().removeAllRanges()", completionHandler: nil)
    }

    func updateSnapshot() {
        guard let wv = webViewStorage, wv.window != nil, url != nil,
              wv.bounds.width > 1, wv.bounds.height > 1 else { return }
        let configuration = WKSnapshotConfiguration()
        configuration.snapshotWidth = NSNumber(value: Double(min(wv.bounds.width, 480)))
        wv.takeSnapshot(with: configuration) { [weak self] image, _ in
            guard let image else { return }
            self?.snapshot = image
        }
    }

    // MARK: - Used by TabManager / WebViewContainer (same folder)

    /// Called when the tab becomes the selected one: restored tabs load now.
    func activate() {
        if pendingRestoreURL != nil {
            loadPendingRestore()
        }
    }

    /// Turns this (fresh) tab into a popup that must use WebKit's configuration.
    func adoptPopup(configuration: WKWebViewConfiguration, initialURL: URL?) {
        guard webViewStorage == nil else { return }
        adoptedConfiguration = configuration
        sharesContentController = true
        if let initialURL, !initialURL.absoluteString.isEmpty {
            url = initialURL
        } else {
            url = URL(string: "about:blank")
        }
        isLoading = true
    }

    func markSharesContentController() {
        sharesContentController = true
        appliedRules = nil
    }

    /// Releases the web view. The tab must not be used afterwards.
    func teardown() {
        guard !isTornDown else { return }
        isTornDown = true
        pendingDialog = nil
        for cancel in dialogCancels.values { cancel() }
        dialogCancels.removeAll()
        NotificationCenter.default.removeObserver(self)
        cancellables.removeAll()
        for observation in observations { observation.invalidate() }
        observations.removeAll()
        if let wv = webViewStorage {
            wv.stopLoading()
            wv.navigationDelegate = nil
            wv.uiDelegate = nil
            wv.scrollView.refreshControl = nil
            wv.removeFromSuperview()
        }
        webViewStorage = nil
        pendingRestoreURL = nil
    }

    // MARK: - Loading internals

    private func loadPendingRestore() {
        guard let pending = pendingRestoreURL else { return }
        pendingRestoreURL = nil
        load(pending)
    }

    private func startLoad(_ target: URL) {
        guard !isTornDown else { return }
        pendingRestoreURL = nil
        loadError = nil
        url = target
        isLoading = true
        var request = URLRequest(url: target)
        if AppSettings.shared.globalPrivacyControl, Tab.isHTTP(target) {
            request.setValue("1", forHTTPHeaderField: "Sec-GPC")
        }
        webView.load(request)
    }

    private func dismissFailedNavigation() {
        loadError = nil
        upgradedFrom = nil
        url = webViewStorage?.url
        syncState()
    }

    private func syncState() {
        guard let wv = webViewStorage else { return }
        let newTitle = wv.title ?? ""
        if loadError == nil {
            if title != newTitle, !(newTitle.isEmpty && wv.url == nil) { title = newTitle }
            if let current = wv.url, url != current { url = current }
        }
        if isLoading != wv.isLoading { isLoading = wv.isLoading }
        let estimated = wv.estimatedProgress
        if progress != estimated { progress = estimated }
        if canGoBack != wv.canGoBack { canGoBack = wv.canGoBack }
        if canGoForward != wv.canGoForward { canGoForward = wv.canGoForward }
        let secure = loadError == nil && wv.url?.scheme?.lowercased() == "https" && wv.hasOnlySecureContent
        if isSecure != secure { isSecure = secure }
    }

    private func titleDidChange() {
        syncState()
        guard !isPrivate, loadError == nil, let wv = webViewStorage, !wv.isLoading,
              let current = wv.url, Tab.isHTTP(current),
              let newTitle = wv.title, !newTitle.isEmpty, newTitle != lastRecordedTitle else { return }
        lastRecordedTitle = newTitle
        HistoryStore.shared.updateTitle(url: current.absoluteString, title: newTitle)
    }

    // MARK: - Web view construction

    private func makeWebView() -> WKWebView {
        let settings = AppSettings.shared
        let configuration: WKWebViewConfiguration
        if let adopted = adoptedConfiguration {
            // Popup: WebKit requires the configuration it handed us (scripts and rules are inherited).
            configuration = adopted
        } else {
            configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = dataStore ?? (isPrivate ? WKWebsiteDataStore.nonPersistent() : WKWebsiteDataStore.default())
            configuration.allowsInlineMediaPlayback = true
            configuration.allowsPictureInPictureMediaPlayback = true
            configuration.allowsAirPlayForMediaPlayback = true
            configuration.applicationNameForUserAgent = Tab.mobileApplicationName
            configuration.preferences.isElementFullscreenEnabled = true
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = !settings.blockPopups
            configuration.defaultWebpagePreferences.preferredContentMode = isDesktopSite ? .desktop : .mobile
        }
        adoptedConfiguration = nil

        let wv = WKWebView(frame: .zero, configuration: configuration)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        wv.allowsLinkPreview = true
        wv.customUserAgent = isDesktopSite ? Tab.desktopUserAgent : nil
        #if DEBUG
        wv.isInspectable = true
        #endif

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(handlePullToRefresh(_:)), for: .valueChanged)
        wv.scrollView.refreshControl = refresh

        observations = [
            wv.observe(\.title, options: [.new]) { [weak self] _, _ in
                guard let self else { return }
                MainActor.assumeIsolated { self.titleDidChange() }
            },
            wv.observe(\.url, options: [.new]) { [weak self] _, _ in
                guard let self else { return }
                MainActor.assumeIsolated { self.syncState() }
            },
            wv.observe(\.isLoading, options: [.new]) { [weak self] _, _ in
                guard let self else { return }
                MainActor.assumeIsolated { self.syncState() }
            },
            wv.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in
                guard let self else { return }
                MainActor.assumeIsolated { self.syncState() }
            },
            wv.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in
                guard let self else { return }
                MainActor.assumeIsolated { self.syncState() }
            },
            wv.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in
                guard let self else { return }
                MainActor.assumeIsolated { self.syncState() }
            },
            wv.observe(\.hasOnlySecureContent, options: [.new]) { [weak self] _, _ in
                guard let self else { return }
                MainActor.assumeIsolated { self.syncState() }
            }
        ]

        NotificationCenter.default.addObserver(self,
                                               selector: #selector(contentBlockerDidChange(_:)),
                                               name: ContentBlocker.didChange,
                                               object: nil)
        settings.$globalPrivacyControl
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.installUserScripts() }
            .store(in: &cancellables)
        settings.$blockPopups
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.webViewStorage?.configuration.preferences.javaScriptCanOpenWindowsAutomatically = !AppSettings.shared.blockPopups
            }
            .store(in: &cancellables)
        settings.$protectionAllowlist
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.rulesGeneration += 1
                self.applyRuleLists(forHost: self.webViewStorage?.url?.host, to: self.webViewStorage)
            }
            .store(in: &cancellables)

        installUserScripts(on: wv)
        applyRuleLists(forHost: url?.host, to: wv)
        return wv
    }

    private func installUserScripts() {
        guard let wv = webViewStorage else { return }
        installUserScripts(on: wv)
    }

    private func installUserScripts(on wv: WKWebView) {
        let controller = wv.configuration.userContentController
        controller.removeAllUserScripts()
        if AppSettings.shared.globalPrivacyControl {
            let source = """
            (function () {
              try {
                Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
                  get: function () { return true; }, configurable: true, enumerable: true
                });
              } catch (e) {}
            })();
            """
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }
    }

    /// Luma Shield: rule lists are attached per tab and dropped while the main frame is on an allowlisted site.
    private func applyRuleLists(forHost host: String?, to target: WKWebView?) {
        guard let wv = target else { return }
        let allowlisted = AppSettings.shared.isAllowlisted(host: host)
        if !sharesContentController, let applied = appliedRules,
           applied.generation == rulesGeneration, applied.allowlisted == allowlisted {
            return
        }
        let controller = wv.configuration.userContentController
        controller.removeAllContentRuleLists()
        if !allowlisted {
            for list in ContentBlocker.shared.activeRuleLists {
                controller.add(list)
            }
        }
        appliedRules = (generation: rulesGeneration, allowlisted: allowlisted)
    }

    @objc private func contentBlockerDidChange(_ note: Notification) {
        rulesGeneration += 1
        applyRuleLists(forHost: webViewStorage?.url?.host ?? url?.host, to: webViewStorage)
    }

    @objc private func handlePullToRefresh(_ sender: UIRefreshControl) {
        reload()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 700_000_000)
            sender.endRefreshing()
        }
    }

    // MARK: - Dialog plumbing

    private func presentDialog(kind: PageDialog.Kind,
                               frame: WKFrameInfo,
                               message: String,
                               completion: @escaping (_ accepted: Bool, _ text: String?) -> Void) {
        let token = BrowserDialogToken()
        let host = frame.securityOrigin.host.isEmpty ? (url?.host ?? "") : frame.securityOrigin.host
        let dialog = PageDialog(kind: kind, host: host, message: message) { [weak self] accepted, text in
            guard token.claim() else { return }
            completion(accepted, text)
            if let self, let id = token.dialogID {
                self.dialogCancels[id] = nil
                if self.pendingDialog?.id == id { self.pendingDialog = nil }
            }
        }
        token.dialogID = dialog.id
        dialogCancels[dialog.id] = {
            guard token.claim() else { return }
            completion(false, nil)
        }
        pendingDialog = dialog
    }

    // MARK: - Static helpers

    fileprivate static let webSchemes: Set<String> = ["http", "https", "about", "blob", "data"]

    fileprivate static func isHTTP(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        return scheme == "http" || scheme == "https"
    }

    private static let localSuffixes = [".localhost", ".local", ".lan", ".home", ".internal", ".home.arpa", ".test"]

    private static func isLocalHost(_ host: String) -> Bool {
        let h = host.lowercased()
        if h == "localhost" || !h.contains(".") { return true }
        if localSuffixes.contains(where: { h.hasSuffix($0) }) { return true }
        if h.contains(":") || h.hasPrefix("[") { return true }
        // IPv4 literal
        let parts = h.split(separator: ".", omittingEmptySubsequences: false)
        if parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isNumber }) }) { return true }
        return false
    }

    /// The https:// URL to try instead of `url`, or nil to leave it alone (port of `src/shared/https.ts`).
    private static func httpsUpgrade(_ url: URL) -> URL? {
        guard (url.scheme ?? "").lowercased() == "http", let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        if let port = url.port, port != 80 { return nil }
        if isLocalHost(host) || httpExceptions.contains(host) { return nil }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = "https"
        components.port = nil
        return components.url
    }

    /// Errors after which an upgraded load may fall back to HTTP: the server has no (valid) HTTPS.
    private static let httpFallbackErrors: Set<Int> = [
        NSURLErrorSecureConnectionFailed,
        NSURLErrorServerCertificateHasBadDate,
        NSURLErrorServerCertificateUntrusted,
        NSURLErrorServerCertificateHasUnknownRoot,
        NSURLErrorServerCertificateNotYetValid,
        NSURLErrorClientCertificateRejected,
        NSURLErrorCannotConnectToHost,
        NSURLErrorNetworkConnectionLost,
        NSURLErrorTimedOut,
        NSURLErrorAppTransportSecurityRequiresSecureConnection
    ]

    private static let certificateErrors: Set<Int> = [
        NSURLErrorSecureConnectionFailed,
        NSURLErrorServerCertificateHasBadDate,
        NSURLErrorServerCertificateUntrusted,
        NSURLErrorServerCertificateHasUnknownRoot,
        NSURLErrorServerCertificateNotYetValid,
        NSURLErrorClientCertificateRejected
    ]

    private static let systemVersionShort: String = {
        let parts = UIDevice.current.systemVersion.split(separator: ".")
        let major = parts.first.map(String.init) ?? "17"
        let minor = parts.count > 1 ? String(parts[1]) : "0"
        return major + "." + minor
    }()

    /// Makes the default WKWebView user agent look like Safari (sites otherwise treat it as an in-app web view).
    private static let mobileApplicationName = "Version/\(systemVersionShort) Mobile/15E148 Safari/604.1"

    private static let desktopUserAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/\(systemVersionShort) Safari/605.1.15"

    private static let appStoreHosts: Set<String> = ["apps.apple.com", "itunes.apple.com"]

    private static let faviconProbe = """
    (function () {
      var links = document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]');
      var best = null, bestSize = -1;
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        if (!el.href || /\\.svg(\\?|#|$)/i.test(el.href) || el.href.indexOf('data:') === 0) { continue; }
        var size = 16;
        var m = /(\\d+)x(\\d+)/.exec(el.getAttribute('sizes') || '');
        if (m) { size = parseInt(m[1], 10); }
        else if ((el.getAttribute('rel') || '').indexOf('apple') >= 0) { size = 180; }
        if (size > 256) { size = 15; }
        if (size > bestSize) { bestSize = size; best = el.href; }
      }
      return best;
    })()
    """

    private func makeLoadError(for error: NSError, failedURL: URL?) -> TabLoadError {
        let host = failedURL?.host ?? "this site"
        var canTryHTTP = false
        if error.domain == NSURLErrorDomain, Tab.httpFallbackErrors.contains(error.code),
           let failedURL, (failedURL.scheme ?? "").lowercased() == "https",
           let original = upgradedFrom, original.host?.lowercased() == failedURL.host?.lowercased() {
            canTryHTTP = true
        }
        var title = "This page can't be loaded"
        var message = error.localizedDescription
        if error.domain == NSURLErrorDomain {
            switch error.code {
            case NSURLErrorNotConnectedToInternet, NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff:
                title = "You're offline"
                message = "Check your internet connection and try again."
            case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
                title = "Site not found"
                message = "Luma can't find the server at \(host)."
            case NSURLErrorTimedOut:
                title = "The connection timed out"
                message = "\(host) took too long to respond."
            case NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost:
                title = "Can't connect to the site"
                message = "Luma can't establish a connection to \(host)."
            default:
                if Tab.certificateErrors.contains(error.code) {
                    title = "This connection isn't secure"
                    message = "Luma can't establish a secure connection to \(host). " + error.localizedDescription
                }
            }
        }
        if canTryHTTP {
            message += " The site may not support HTTPS. Continuing with HTTP is not private."
        }
        return TabLoadError(title: title, message: message, failedURL: failedURL, canTryHTTP: canTryHTTP)
    }

    fileprivate func handleNavigationFailure(_ error: Error, provisional: Bool) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        // 102: frame load interrupted (policy change / became a download), 204: handled by a plug-in / media.
        if nsError.domain == "WebKitErrorDomain" && (nsError.code == 102 || nsError.code == 204) { return }
        webViewStorage?.scrollView.refreshControl?.endRefreshing()
        guard provisional else {
            syncState()
            return
        }
        var failedURL = nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        if failedURL == nil, let string = nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String {
            failedURL = URL(string: string)
        }
        if failedURL == nil { failedURL = url }
        let failure = makeLoadError(for: nsError, failedURL: failedURL)
        loadError = failure
        if let failedURL { url = failedURL }
        syncState()
    }

    fileprivate func navigationBecameDownload(_ download: WKDownload) {
        DownloadManager.shared.adopt(download)
        // The navigation never commits: show again what the web view really displays.
        loadError = nil
        upgradedFrom = nil
        let committed = webViewStorage?.url
        url = (committed?.absoluteString == "about:blank" && sharesContentController) ? nil : committed
        syncState()
        if url == nil, let wv = webViewStorage, wv.backForwardList.currentItem == nil,
           sharesContentController, let manager, manager.isPopupTab(self) {
            // A popup that only existed to start a download.
            manager.close(self)
        }
    }

    fileprivate func topViewController() -> UIViewController? {
        var controller = webViewStorage?.window?.rootViewController
        while let presented = controller?.presentedViewController {
            controller = presented
        }
        return controller
    }
}

/// Makes sure a JavaScript dialog's completion handler runs exactly once.
private final class BrowserDialogToken {
    var dialogID: UUID?
    private var claimed = false
    func claim() -> Bool {
        if claimed { return false }
        claimed = true
        return true
    }
}

// MARK: - WKNavigationDelegate

extension Tab: WKNavigationDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        preferences.preferredContentMode = isDesktopSite ? .desktop : .mobile

        guard let target = navigationAction.request.url else {
            decisionHandler(.allow, preferences)
            return
        }
        let scheme = (target.scheme ?? "").lowercased()
        let userInitiated = navigationAction.navigationType == .linkActivated
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? false

        // tel:, mailto:, itms-apps:, other apps … only after a tap, never silently from a script.
        if !Tab.webSchemes.contains(scheme) && scheme != "javascript" {
            decisionHandler(.cancel, preferences)
            if userInitiated, scheme != "file", !scheme.isEmpty {
                UIApplication.shared.open(target, options: [:], completionHandler: nil)
            }
            return
        }
        if userInitiated, scheme == "https", let host = target.host?.lowercased(), Tab.appStoreHosts.contains(host),
           navigationAction.targetFrame == nil || isMainFrame {
            decisionHandler(.cancel, preferences)
            UIApplication.shared.open(target, options: [:], completionHandler: nil)
            return
        }

        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }

        if isMainFrame {
            let method = (navigationAction.request.httpMethod ?? "GET").uppercased()
            let type = navigationAction.navigationType
            if AppSettings.shared.stripTrackingParams, Tab.isHTTP(target), method == "GET",
               type != .backForward, type != .formSubmitted, type != .formResubmitted,
               let stripped = TrackingParams.strip(from: target), stripped != target {
                decisionHandler(.cancel, preferences)
                startLoad(stripped)
                return
            }
            if isPrivate, let host = target.host {
                BrowserFaviconCache.shared.markPrivate(host: host)
            }
            if Tab.isHTTP(target) {
                applyRuleLists(forHost: target.host, to: webView)
            }
        }
        decisionHandler(.allow, preferences)
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = navigationResponse.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"),
           disposition.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("attachment") {
            decisionHandler(.download)
            return
        }
        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        navigationBecameDownload(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        navigationBecameDownload(download)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if loadError != nil { loadError = nil }
        syncState()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        upgradedFrom = nil
        lastRecordedTitle = ""
        if loadError != nil { loadError = nil }
        syncState()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.scrollView.refreshControl?.endRefreshing()
        syncState()
        guard let current = webView.url, Tab.isHTTP(current) else { return }
        if !isPrivate {
            let pageTitle = webView.title ?? ""
            lastRecordedTitle = pageTitle
            HistoryStore.shared.record(title: pageTitle, url: current.absoluteString)
        }
        if let host = current.host, !BrowserFaviconCache.shared.hasImage(forHost: host) {
            webView.evaluateJavaScript(Tab.faviconProbe) { result, _ in
                guard let string = result as? String, let iconURL = URL(string: string) else { return }
                BrowserFaviconCache.shared.offer(iconURL: iconURL, forHost: host)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleNavigationFailure(error, provisional: false)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleNavigationFailure(error, provisional: true)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView.url != nil {
            webView.reload()
        } else if let current = url, loadError == nil {
            startLoad(current)
        }
    }
}

// MARK: - WKUIDelegate

extension Tab: WKUIDelegate {
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        // With "block pop-ups" on, WebKit only gets here after a user gesture
        // (javaScriptCanOpenWindowsAutomatically is off); otherwise every popup is allowed.
        guard let manager else {
            if navigationAction.targetFrame == nil, let target = navigationAction.request.url {
                load(target)
            }
            return nil
        }
        let popup = manager.openPopup(from: self, configuration: configuration, url: navigationAction.request.url)
        return popup.webView
    }

    func webViewDidClose(_ webView: WKWebView) {
        manager?.close(self)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        presentDialog(kind: .alert, frame: frame, message: message) { _, _ in
            completionHandler()
        }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        presentDialog(kind: .confirm, frame: frame, message: message) { accepted, _ in
            completionHandler(accepted)
        }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let fallback = defaultText ?? ""
        presentDialog(kind: .prompt(defaultText: fallback), frame: frame, message: prompt) { accepted, text in
            completionHandler(accepted ? (text ?? fallback) : nil)
        }
    }

    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // Let the system ask the person each time a site wants the camera or microphone.
        decisionHandler(.prompt)
    }

    func webView(_ webView: WKWebView,
                 contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo,
                 completionHandler: @escaping (UIContextMenuConfiguration?) -> Void) {
        guard let link = elementInfo.linkURL, Tab.isHTTP(link) else {
            completionHandler(nil)
            return
        }
        let fromPrivate = isPrivate
        let configuration = UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
            var actions: [UIMenuElement] = []
            if !fromPrivate {
                actions.append(UIAction(title: "Open in New Tab", image: UIImage(systemName: "plus.square.on.square")) { _ in
                    self?.manager?.newTab(url: link, isPrivate: false, select: false)
                })
            }
            actions.append(UIAction(title: fromPrivate ? "Open in New Private Tab" : "Open in Private Tab",
                                    image: UIImage(systemName: "moon.stars")) { _ in
                self?.manager?.newTab(url: link, isPrivate: true, select: !fromPrivate)
            })
            actions.append(UIAction(title: "Copy Link", image: UIImage(systemName: "doc.on.doc")) { _ in
                UIPasteboard.general.url = link
            })
            actions.append(UIAction(title: "Share…", image: UIImage(systemName: "square.and.arrow.up")) { _ in
                self?.share(link)
            })
            return UIMenu(title: link.host ?? "", children: actions)
        }
        completionHandler(configuration)
    }

    private func share(_ link: URL) {
        guard let presenter = topViewController(), let wv = webViewStorage else { return }
        let sheet = UIActivityViewController(activityItems: [link], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = wv
            popover.sourceRect = CGRect(x: wv.bounds.midX, y: wv.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true, completion: nil)
    }
}
