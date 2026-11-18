import SwiftUI
import UIKit
import WebKit

/// Owns the normal and the private tab sets, the selection, and the session file.
@MainActor
final class TabManager: ObservableObject {
    @Published private(set) var tabs: [Tab] = []
    @Published private(set) var privateTabs: [Tab] = []
    @Published var isPrivateMode: Bool = false {
        didSet {
            if oldValue != isPrivateMode, !suppressModeChange {
                modeDidChange()
            }
        }
    }
    @Published private(set) var selectedTab: Tab?

    private var suppressModeChange = false
    private var lastSelectedNormal: UUID?
    private var lastSelectedPrivate: UUID?
    /// One shared in-memory store for all private tabs; dropped with the last private tab.
    private var privateStore: WKWebsiteDataStore?
    private var popupTabIDs = Set<UUID>()

    init() {
        let first = Tab(isPrivate: false, manager: self)
        tabs = [first]
        selectedTab = first
        lastSelectedNormal = first.id
    }

    var visibleTabs: [Tab] { isPrivateMode ? privateTabs : tabs }

    // MARK: - Creating / selecting / closing

    @discardableResult
    func newTab(url: URL? = nil, isPrivate: Bool? = nil, select: Bool = true) -> Tab {
        let makePrivate = isPrivate ?? isPrivateMode
        let tab = makeTab(isPrivate: makePrivate)
        if makePrivate {
            privateTabs.append(tab)
        } else {
            tabs.append(tab)
        }
        if let url {
            tab.load(url)
        }
        if select {
            self.select(tab)
        }
        return tab
    }

    func select(_ tab: Tab) {
        guard contains(tab) else { return }
        if let current = selectedTab, current !== tab {
            current.updateSnapshot()
        }
        if tab.isPrivate != isPrivateMode {
            let leavingPrivate = isPrivateMode
            suppressModeChange = true
            isPrivateMode = tab.isPrivate
            suppressModeChange = false
            if leavingPrivate { prunePristinePrivateTabs() }
        }
        if tab.isPrivate {
            lastSelectedPrivate = tab.id
        } else {
            lastSelectedNormal = tab.id
        }
        if selectedTab !== tab {
            selectedTab = tab
        }
        tab.activate()
    }

    func close(_ tab: Tab) {
        let wasSelected = selectedTab === tab
        let index: Int
        if tab.isPrivate {
            guard let found = privateTabs.firstIndex(where: { $0 === tab }) else { return }
            index = found
            privateTabs.remove(at: found)
        } else {
            guard let found = tabs.firstIndex(where: { $0 === tab }) else { return }
            index = found
            tabs.remove(at: found)
        }
        popupTabIDs.remove(tab.id)
        if wasSelected { selectedTab = nil }
        tab.teardown()
        if tab.isPrivate, privateTabs.isEmpty {
            privateStore = nil
        }
        guard wasSelected else { return }
        let remaining = tab.isPrivate ? privateTabs : tabs
        if remaining.isEmpty {
            newTab(isPrivate: tab.isPrivate, select: true)
        } else {
            select(remaining[min(index, remaining.count - 1)])
        }
    }

    func closeAll(isPrivate: Bool) {
        let closing = isPrivate ? privateTabs : tabs
        let selectionAffected = selectedTab.map { $0.isPrivate == isPrivate } ?? true
        if selectionAffected { selectedTab = nil }
        if isPrivate {
            privateTabs = []
            lastSelectedPrivate = nil
        } else {
            tabs = []
            lastSelectedNormal = nil
        }
        for tab in closing {
            popupTabIDs.remove(tab.id)
            tab.teardown()
        }
        if isPrivate {
            privateStore = nil
        }
        if isPrivate == isPrivateMode {
            newTab(isPrivate: isPrivate, select: true)
        }
    }

    func move(fromOffsets: IndexSet, toOffset: Int) {
        if isPrivateMode {
            privateTabs.move(fromOffsets: fromOffsets, toOffset: toOffset)
        } else {
            tabs.move(fromOffsets: fromOffsets, toOffset: toOffset)
        }
    }

    func open(externalURL: URL) {
        guard let target = TabManager.resolveExternal(externalURL) else { return }
        if let current = selectedTab, !current.isPrivate, current.isPristine {
            current.load(target)
        } else if !isPrivateMode, let reusable = tabs.last, reusable.isPristine {
            reusable.load(target)
            select(reusable)
        } else {
            newTab(url: target, isPrivate: false, select: true)
        }
    }

    // MARK: - Popups (used by Tab)

    func openPopup(from opener: Tab, configuration: WKWebViewConfiguration, url: URL?) -> Tab {
        let popup = makeTab(isPrivate: opener.isPrivate)
        popup.adoptPopup(configuration: configuration, initialURL: url)
        opener.markSharesContentController()
        popupTabIDs.insert(popup.id)
        if opener.isPrivate {
            let index = privateTabs.firstIndex(where: { $0 === opener }).map { $0 + 1 } ?? privateTabs.count
            privateTabs.insert(popup, at: index)
        } else {
            let index = tabs.firstIndex(where: { $0 === opener }).map { $0 + 1 } ?? tabs.count
            tabs.insert(popup, at: index)
        }
        // Only steal the selection when the opener is what the person is looking at.
        if selectedTab === opener {
            select(popup)
        }
        return popup
    }

    func isPopupTab(_ tab: Tab) -> Bool {
        popupTabIDs.contains(tab.id)
    }

    // MARK: - Session

    func saveSession() {
        let settings = AppSettings.shared
        guard let file = TabManager.sessionFileURL() else { return }
        guard settings.restoreTabs, !settings.clearOnExit else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        selectedTab?.updateSnapshot()
        var entries: [BrowserSessionFile.Entry] = []
        var selectedIndex = 0
        for tab in tabs {
            guard let url = tab.url, TabManager.isRestorable(url) else { continue }
            if let id = lastSelectedNormal, tab.id == id { selectedIndex = entries.count }
            entries.append(BrowserSessionFile.Entry(id: tab.id, url: url.absoluteString, title: tab.title))
        }
        if entries.isEmpty {
            try? FileManager.default.removeItem(at: file)
            return
        }
        let session = BrowserSessionFile(tabs: entries, selected: selectedIndex)
        do {
            let data = try JSONEncoder().encode(session)
            try data.write(to: file, options: [.atomic])
        } catch {
            // Losing the session is not fatal.
        }
    }

    func restoreSession() {
        let settings = AppSettings.shared
        guard let file = TabManager.sessionFileURL() else { return }
        guard settings.restoreTabs, !settings.clearOnExit else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        guard let data = try? Data(contentsOf: file),
              let session = try? JSONDecoder().decode(BrowserSessionFile.self, from: data) else { return }

        let existingIDs = Set(tabs.map { $0.id })
        var restored: [Tab] = []
        var restoredSelection: Tab?
        for (offset, entry) in session.tabs.enumerated() {
            guard let string = entry.url, let url = URL(string: string), TabManager.isRestorable(url),
                  !existingIDs.contains(entry.id) else { continue }
            let tab = Tab(id: entry.id, isPrivate: false, manager: self, restoredURL: url, restoredTitle: entry.title)
            restored.append(tab)
            if offset == session.selected { restoredSelection = tab }
        }
        guard !restored.isEmpty else { return }

        // Keep anything already in use (e.g. a link opened before restore); drop the untouched launch tab.
        let keep = tabs.filter { !$0.isPristine }
        let dropped = tabs.filter { $0.isPristine }
        let selectionDropped = dropped.contains(where: { $0 === selectedTab })
        if selectionDropped { selectedTab = nil }
        for tab in dropped { tab.teardown() }
        tabs = restored + keep

        if isPrivateMode {
            lastSelectedNormal = (restoredSelection ?? restored.last)?.id
        } else if selectionDropped || selectedTab == nil {
            select(restoredSelection ?? restored[restored.count - 1])
        }
    }

    // MARK: - Clearing data

    func clearBrowsingData(history: Bool, websiteData: Bool) async {
        if history {
            HistoryStore.shared.clear(since: nil)
        }
        if websiteData {
            let types = WKWebsiteDataStore.allWebsiteDataTypes()
            await WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: Date.distantPast)
            if let store = privateStore {
                await store.removeData(ofTypes: types, modifiedSince: Date.distantPast)
            }
            URLCache.shared.removeAllCachedResponses()
            BrowserFaviconCache.shared.clear()
        }
    }

    // MARK: - Internals

    private func makeTab(isPrivate: Bool) -> Tab {
        var store: WKWebsiteDataStore?
        if isPrivate {
            if privateStore == nil {
                privateStore = WKWebsiteDataStore.nonPersistent()
            }
            store = privateStore
        }
        return Tab(isPrivate: isPrivate, dataStore: store, manager: self)
    }

    private func contains(_ tab: Tab) -> Bool {
        if tab.isPrivate {
            return privateTabs.contains(where: { $0 === tab })
        }
        return tabs.contains(where: { $0 === tab })
    }

    /// The UI flipped `isPrivateMode`: show that set's tab (creating one when the set is empty).
    private func modeDidChange() {
        if let current = selectedTab {
            current.updateSnapshot()
        }
        if !isPrivateMode {
            prunePristinePrivateTabs()
        }
        let set = visibleTabs
        let rememberedID = isPrivateMode ? lastSelectedPrivate : lastSelectedNormal
        if let rememberedID, let remembered = set.first(where: { $0.id == rememberedID }) {
            select(remembered)
        } else if let last = set.last {
            select(last)
        } else {
            newTab(isPrivate: isPrivateMode, select: true)
        }
    }

    /// Leaving private mode with nothing but untouched private tabs: forget them (and the private store).
    private func prunePristinePrivateTabs() {
        guard !privateTabs.isEmpty, privateTabs.allSatisfy({ $0.isPristine }) else { return }
        let dropped = privateTabs
        privateTabs = []
        lastSelectedPrivate = nil
        for tab in dropped {
            popupTabIDs.remove(tab.id)
            tab.teardown()
        }
        privateStore = nil
    }

    private static func isRestorable(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        return scheme == "http" || scheme == "https"
    }

    /// http(s) URLs as they are; `luma://open?url=…` unwrapped.
    private static func resolveExternal(_ url: URL) -> URL? {
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "http" || scheme == "https" {
            return url
        }
        guard scheme == "luma",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let value = components.queryItems?.first(where: { $0.name == "url" })?.value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let inner = URL(string: trimmed), let innerScheme = inner.scheme?.lowercased() {
            return (innerScheme == "http" || innerScheme == "https") ? inner : nil
        }
        // Scheme-less ("example.com/page"): https-first applies when the tab loads it.
        return URL(string: "http://" + trimmed)
    }

    private static func sessionFileURL() -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let directory = base.appendingPathComponent("Luma", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("session.json")
    }
}

private struct BrowserSessionFile: Codable {
    struct Entry: Codable {
        var id: UUID
        var url: String?
        var title: String
    }
    var tabs: [Entry]
    var selected: Int
}
