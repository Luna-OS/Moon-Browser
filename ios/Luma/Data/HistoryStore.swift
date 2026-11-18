import Foundation
import SwiftUI
import UIKit

/// The browsing history: one entry per visit, newest first.
@MainActor
final class HistoryStore: ObservableObject {
    static let shared = HistoryStore(fileURL: CoreStorage.fileURL("history.json"))

    /// The most entries that are kept; older ones fall off the end.
    static let maxEntries = 5000

    @Published private(set) var entries: [HistoryEntry] = [] {
        didSet { topSitesCache.removeAll() }
    }

    private let fileURL: URL?
    private var saveTask: Task<Void, Never>?
    private var needsSave = false
    private var topSitesCache: [String: [TopSite]] = [:]
    private var backgroundObserver: NSObjectProtocol?

    /// `fileURL` nil keeps everything in memory (tests, previews).
    init(fileURL: URL?) {
        self.fileURL = fileURL
        if let fileURL = fileURL, let stored = CoreStorage.load([HistoryEntry].self, from: fileURL) {
            entries = Array(stored.sorted(by: { $0.visitedAt > $1.visitedAt }).prefix(Self.maxEntries))
        }
        if fileURL != nil {
            backgroundObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in self?.flush() }
            }
        }
    }

    /// Records a visit (http and https only). A repeat visit of the same
    /// address within a minute is merged into the earlier entry.
    func record(title: String, url: String) {
        let address = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isWebURL(address) else { return }
        let now = Date()
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)

        if let i = entries.firstIndex(where: { $0.url == address }),
           now.timeIntervalSince(entries[i].visitedAt) < 60 {
            var entry = entries.remove(at: i)
            entry.visitedAt = now
            if !cleanTitle.isEmpty { entry.title = cleanTitle }
            entries.insert(entry, at: 0)
        } else {
            let entry = HistoryEntry(
                id: UUID(),
                title: cleanTitle.isEmpty ? Display.shortHost(address) : cleanTitle,
                url: address,
                visitedAt: now
            )
            entries.insert(entry, at: 0)
            if entries.count > Self.maxEntries {
                entries.removeLast(entries.count - Self.maxEntries)
            }
        }
        scheduleSave()
    }

    /// Sets the title of the latest visit of this address (titles arrive
    /// after the navigation was recorded).
    func updateTitle(url: String, title: String) {
        let address = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty else { return }
        guard let i = entries.firstIndex(where: { $0.url == address }) else { return }
        guard entries[i].title != cleanTitle else { return }
        entries[i].title = cleanTitle
        scheduleSave()
    }

    func remove(id: UUID) {
        guard let i = entries.firstIndex(where: { $0.id == id }) else { return }
        entries.remove(at: i)
        scheduleSave()
    }

    /// Removes everything visited since the date; nil removes everything.
    func clear(since: Date?) {
        if let since = since {
            entries.removeAll(where: { $0.visitedAt >= since })
        } else {
            entries.removeAll()
        }
        flush(force: true)
    }

    /// Visits whose title or address contains every word of the query, newest
    /// first and one per address.
    func search(_ query: String, limit: Int) -> [HistoryEntry] {
        guard limit > 0 else { return [] }
        let tokens = CoreStorage.tokens(query)
        var seen = Set<String>()
        var result: [HistoryEntry] = []
        for entry in entries {
            if seen.contains(entry.url) { continue }
            if !tokens.isEmpty {
                let haystack = CoreStorage.fold(entry.title + " " + entry.url)
                if !tokens.allSatisfy({ haystack.contains($0) }) { continue }
            }
            seen.insert(entry.url)
            result.append(entry)
            if result.count >= limit { break }
        }
        return result
    }

    /// The most visited sites, one per host, for the new tab page. `hidden`
    /// holds addresses the user removed; their sites stay away.
    func topSites(limit: Int, hidden: [String]) -> [TopSite] {
        guard limit > 0 else { return [] }
        let cacheKey = "\(limit)|" + hidden.joined(separator: "\n")
        if let cached = topSitesCache[cacheKey] { return cached }

        struct PageStats {
            var visits = 0
            var title = ""
            var latest = Date.distantPast
        }
        struct SiteStats {
            var visits = 0
            var latest = Date.distantPast
            var pages: [String: PageStats] = [:]
        }

        let hiddenHosts = Set(hidden.map { Display.shortHost($0) })
        var sites: [String: SiteStats] = [:]
        for entry in entries {
            let host = Display.shortHost(entry.url)
            if host.isEmpty || hiddenHosts.contains(host) { continue }
            var site = sites[host] ?? SiteStats()
            site.visits += 1
            if entry.visitedAt > site.latest { site.latest = entry.visitedAt }
            var page = site.pages[entry.url] ?? PageStats()
            page.visits += 1
            if entry.visitedAt > page.latest {
                page.latest = entry.visitedAt
                page.title = entry.title
            }
            site.pages[entry.url] = page
            sites[host] = site
        }

        let ranked = sites.sorted { a, b in
            if a.value.visits != b.value.visits { return a.value.visits > b.value.visits }
            if a.value.latest != b.value.latest { return a.value.latest > b.value.latest }
            return a.key < b.key
        }

        var result: [TopSite] = []
        for (host, site) in ranked {
            let best = site.pages.max { a, b in
                if a.value.visits != b.value.visits { return a.value.visits < b.value.visits }
                if a.value.latest != b.value.latest { return a.value.latest < b.value.latest }
                return a.key > b.key
            }
            guard let page = best else { continue }
            let title = page.value.title.isEmpty ? host : page.value.title
            result.append(TopSite(title: title, url: page.key))
            if result.count >= limit { break }
        }
        topSitesCache[cacheKey] = result
        return result
    }

    /// Writes pending changes now (the app is about to be suspended).
    func flush() {
        flush(force: false)
    }

    // MARK: - Private

    private static func isWebURL(_ url: String) -> Bool {
        let lower = url.lowercased()
        return lower.hasPrefix("https://") || lower.hasPrefix("http://")
    }

    private func scheduleSave() {
        needsSave = true
        guard fileURL != nil, saveTask == nil else { return }
        saveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 800_000_000)
            if Task.isCancelled { return }
            guard let self = self else { return }
            self.saveTask = nil
            self.flush(force: false)
        }
    }

    private func flush(force: Bool) {
        guard needsSave || force else { return }
        needsSave = false
        saveTask?.cancel()
        saveTask = nil
        guard let fileURL = fileURL else { return }
        CoreStorage.save(entries, to: fileURL)
    }
}
