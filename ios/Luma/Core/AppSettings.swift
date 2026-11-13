import SwiftUI

/// Luma's settings. Every change is written to UserDefaults at once; a
/// missing or broken value falls back to its default.
@MainActor
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    @Published var theme: ThemeChoice { didSet { defaults.set(theme.rawValue, forKey: Key.theme) } }
    @Published var searchEngineID: String { didSet { defaults.set(searchEngineID, forKey: Key.searchEngineID) } }
    @Published var customSearchURL: String { didSet { defaults.set(customSearchURL, forKey: Key.customSearchURL) } }
    @Published var bangs: Bool { didSet { defaults.set(bangs, forKey: Key.bangs) } }
    @Published var restoreTabs: Bool { didSet { defaults.set(restoreTabs, forKey: Key.restoreTabs) } }
    @Published var httpsFirst: Bool { didSet { defaults.set(httpsFirst, forKey: Key.httpsFirst) } }
    @Published var adblock: Bool { didSet { defaults.set(adblock, forKey: Key.adblock) } }
    @Published var adblockAnnoyances: Bool { didSet { defaults.set(adblockAnnoyances, forKey: Key.adblockAnnoyances) } }
    @Published var protectionAllowlist: [String] { didSet { defaults.set(protectionAllowlist, forKey: Key.protectionAllowlist) } }
    @Published var globalPrivacyControl: Bool { didSet { defaults.set(globalPrivacyControl, forKey: Key.globalPrivacyControl) } }
    @Published var stripTrackingParams: Bool { didSet { defaults.set(stripTrackingParams, forKey: Key.stripTrackingParams) } }
    @Published var blockPopups: Bool { didSet { defaults.set(blockPopups, forKey: Key.blockPopups) } }
    @Published var clearOnExit: Bool { didSet { defaults.set(clearOnExit, forKey: Key.clearOnExit) } }
    @Published var newTabShortcuts: Bool { didSet { defaults.set(newTabShortcuts, forKey: Key.newTabShortcuts) } }
    @Published var hiddenTopSites: [String] { didSet { defaults.set(hiddenTopSites, forKey: Key.hiddenTopSites) } }
    @Published var addressBarAtBottom: Bool { didSet { defaults.set(addressBarAtBottom, forKey: Key.addressBarAtBottom) } }
    @Published var desktopSiteOnPad: Bool { didSet { defaults.set(desktopSiteOnPad, forKey: Key.desktopSiteOnPad) } }

    private let defaults: UserDefaults

    private enum Key {
        static let theme = "theme"
        static let searchEngineID = "searchEngine"
        static let customSearchURL = "customSearchUrl"
        static let bangs = "bangs"
        static let restoreTabs = "restoreTabs"
        static let httpsFirst = "httpsFirst"
        static let adblock = "adblock"
        static let adblockAnnoyances = "adblockAnnoyances"
        static let protectionAllowlist = "protectionAllowlist"
        static let globalPrivacyControl = "globalPrivacyControl"
        static let stripTrackingParams = "stripTrackingParams"
        static let blockPopups = "blockPopups"
        static let clearOnExit = "clearOnExit"
        static let newTabShortcuts = "newTabShortcuts"
        static let hiddenTopSites = "hiddenTopSites"
        static let addressBarAtBottom = "addressBarAtBottom"
        static let desktopSiteOnPad = "desktopSiteOnPad"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults

        func bool(_ key: String, _ fallback: Bool) -> Bool {
            defaults.object(forKey: key) as? Bool ?? fallback
        }

        theme = ThemeChoice(rawValue: defaults.string(forKey: Key.theme) ?? "") ?? .dark
        searchEngineID = defaults.string(forKey: Key.searchEngineID) ?? "perplexity"
        customSearchURL = defaults.string(forKey: Key.customSearchURL) ?? ""
        bangs = bool(Key.bangs, true)
        restoreTabs = bool(Key.restoreTabs, true)
        httpsFirst = bool(Key.httpsFirst, true)
        adblock = bool(Key.adblock, true)
        adblockAnnoyances = bool(Key.adblockAnnoyances, false)
        protectionAllowlist = defaults.stringArray(forKey: Key.protectionAllowlist) ?? []
        globalPrivacyControl = bool(Key.globalPrivacyControl, true)
        stripTrackingParams = bool(Key.stripTrackingParams, true)
        blockPopups = bool(Key.blockPopups, true)
        clearOnExit = bool(Key.clearOnExit, false)
        newTabShortcuts = bool(Key.newTabShortcuts, true)
        hiddenTopSites = defaults.stringArray(forKey: Key.hiddenTopSites) ?? []
        addressBarAtBottom = bool(Key.addressBarAtBottom, true)
        desktopSiteOnPad = bool(Key.desktopSiteOnPad, true)
    }

    /// The engine searches go to; a custom engine without a valid URL is the default one.
    var searchEngine: SearchEngine {
        SearchEngines.resolve(id: searchEngineID, customSearchURL: customSearchURL)
    }

    /// `nil` follows the system.
    var colorScheme: ColorScheme? {
        switch theme {
        case .dark: return .dark
        case .light: return .light
        case .system: return nil
        }
    }

    /// A site entry of the allowlist: a lower-case host name, nothing else.
    static func normalizeSite(_ site: String) -> String? {
        var s = site.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s.hasPrefix("www.") { s.removeFirst(4) }
        if s == "localhost" { return s }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789.-")
        guard !s.isEmpty, s.contains("."), s.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
            return nil
        }
        return s
    }

    /// Whether Luma Shield is switched off for this host (or a parent domain of it).
    func isAllowlisted(host: String?) -> Bool {
        guard let host, let site = AppSettings.normalizeSite(host) else { return false }
        return protectionAllowlist.contains { site == $0 || site.hasSuffix("." + $0) }
    }

    func setAllowlisted(_ on: Bool, host: String) {
        guard let site = AppSettings.normalizeSite(host) else { return }
        if on {
            if !protectionAllowlist.contains(site) { protectionAllowlist.append(site) }
        } else {
            protectionAllowlist.removeAll { site == $0 || site.hasSuffix("." + $0) }
        }
    }
}
