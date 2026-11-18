import Foundation
import SwiftUI
import WebKit

/// Luma Shield: the built-in ad and tracker blocker, built on WebKit's
/// compiled content rule lists.
///
/// A small bundled list (`shield-fallback.json`) works from the first start.
/// The full filter lists are downloaded, converted by `ShieldConverter`,
/// compiled into the `WKContentRuleListStore` (which keeps them on disk) and
/// refreshed every few days.
@MainActor
final class ContentBlocker: ObservableObject {
    static let shared = ContentBlocker()

    /// Posted whenever `activeRuleLists` may have changed.
    static let didChange = Notification.Name("LumaContentBlockerDidChange")

    @Published private(set) var isReady: Bool = false
    @Published private(set) var isUpdating: Bool = false
    @Published private(set) var ruleCount: Int = 0
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var lastError: String?

    /// The lists to attach to a web view: none while the Shield is off or not
    /// ready; the downloaded lists, or the bundled one until they exist; the
    /// annoyance lists only with their setting on.
    var activeRuleLists: [WKContentRuleList] {
        let settings = AppSettings.shared
        guard isReady, settings.adblock else { return [] }
        var lists = mainLists
        if lists.isEmpty, let fallback = fallbackList { lists = [fallback] }
        if settings.adblockAnnoyances { lists.append(contentsOf: annoyanceLists) }
        return lists
    }

    // MARK: - State

    /// What is compiled in the rule list store, kept in the user defaults.
    private struct Meta: Codable {
        var converterVersion: Int = 0
        var mainIDs: [String] = []
        var annoyanceIDs: [String] = []
        var mainRuleCount: Int = 0
        var annoyanceRuleCount: Int = 0
        var lastUpdated: Date?
    }

    private enum ListGroup {
        case main, annoyances

        var key: String { self == .main ? "main" : "ann" }
    }

    /// Bump when `ShieldConverter` changes what it produces: lists compiled
    /// by an older version are then replaced at once.
    private static let converterVersion = 1
    private static let fallbackIdentifier = "luma-shield-fallback-1"
    private static let identifierPrefix = "luma-shield-"
    private static let metaKey = "luma.shield.meta"
    /// Lists older than this are refreshed at launch.
    private static let maxAge: TimeInterval = 4 * 24 * 60 * 60

    private var meta = Meta()
    private var fallbackList: WKContentRuleList?
    private var fallbackRuleCount = 0
    private var mainLists: [WKContentRuleList] = []
    private var annoyanceLists: [WKContentRuleList] = []
    private var didPrepare = false

    private init() {}

    // MARK: - Public

    /// Compiles the bundled list, loads the cached ones and starts an update
    /// in the background when they are missing or older than four days.
    func prepare() async {
        guard !didPrepare else { return }
        didPrepare = true

        guard let store = WKContentRuleListStore.default() else {
            lastError = "Content blocking is not available."
            isReady = true
            notifyChanged()
            return
        }

        await prepareFallback(store: store)

        meta = Self.loadMeta()
        if meta.converterVersion != Self.converterVersion {
            // Compiled by another converter: start over.
            meta = Meta()
            meta.converterVersion = Self.converterVersion
            saveMeta()
        }
        mainLists = await lookUp(meta.mainIDs, store: store)
        annoyanceLists = await lookUp(meta.annoyanceIDs, store: store)
        if mainLists.count != meta.mainIDs.count {
            // The store lost lists (restored device, cleared caches).
            mainLists = []
            meta.mainIDs = []
            meta.mainRuleCount = 0
            meta.lastUpdated = nil
        }
        if annoyanceLists.count != meta.annoyanceIDs.count {
            annoyanceLists = []
            meta.annoyanceIDs = []
            meta.annoyanceRuleCount = 0
        }
        lastUpdated = meta.lastUpdated
        await removeStaleLists(store: store)

        isReady = true
        refreshRuleCount()
        notifyChanged()

        if AppSettings.shared.adblock && needsUpdate {
            Task { await self.update() }
        }
    }

    /// Downloads the filter lists, converts and compiles them.
    func update() async {
        await runUpdate(includeMain: true)
    }

    /// Call after the Shield settings were changed.
    func settingsChanged() {
        refreshRuleCount()
        notifyChanged()
        guard isReady, !isUpdating else { return }
        let settings = AppSettings.shared
        guard settings.adblock else { return }
        if mainLists.isEmpty {
            Task { await self.runUpdate(includeMain: true) }
        } else if settings.adblockAnnoyances && annoyanceLists.isEmpty {
            Task { await self.runUpdate(includeMain: false) }
        }
    }

    // MARK: - Updating

    private var needsUpdate: Bool {
        if mainLists.isEmpty { return true }
        if AppSettings.shared.adblockAnnoyances && annoyanceLists.isEmpty { return true }
        guard let date = meta.lastUpdated else { return true }
        return Date().timeIntervalSince(date) > Self.maxAge
    }

    private func runUpdate(includeMain: Bool) async {
        guard !isUpdating else { return }
        guard let store = WKContentRuleListStore.default() else {
            lastError = "Content blocking is not available."
            return
        }
        isUpdating = true
        lastError = nil
        var errors: [String] = []

        if includeMain {
            if let error = await updateGroup(.main, store: store) { errors.append(error) }
        }
        if AppSettings.shared.adblockAnnoyances {
            if let error = await updateGroup(.annoyances, store: store) { errors.append(error) }
        }

        lastError = errors.isEmpty ? nil : errors.joined(separator: " ")
        isUpdating = false
        refreshRuleCount()
        notifyChanged()
    }

    /// Replaces the lists of one group. Returns what went wrong, if anything;
    /// the lists in use stay when nothing new could be compiled.
    private func updateGroup(_ group: ListGroup, store: WKContentRuleListStore) async -> String? {
        let urls = group == .main ? ShieldSources.mainURLs : ShieldSources.annoyanceURLs
        var texts = await ShieldSources.download(urls)
        if texts.isEmpty {
            return group == .main
                ? "The filter lists could not be downloaded."
                : "The annoyance lists could not be downloaded."
        }
        var problem: String?
        if texts.count < urls.count {
            problem = "\(urls.count - texts.count) of \(urls.count) filter lists could not be downloaded."
        }
        if group == .main { texts.append(ShieldSources.lumaFixes) }

        // Converting a few hundred thousand filters takes a moment: off the main thread.
        let sources = texts
        let converted = await Task.detached(priority: .utility) {
            ShieldConverter.encodedLists(from: sources)
        }.value

        let stamp = Int(Date().timeIntervalSince1970)
        var compiled: [WKContentRuleList] = []
        var identifiers: [String] = []
        var failed = 0
        for (index, list) in converted.lists.enumerated() {
            let identifier = "\(Self.identifierPrefix)\(group.key)-\(stamp)-\(list.kind)\(index)"
            if let ruleList = await compile(identifier: identifier, json: list.json, store: store) {
                compiled.append(ruleList)
                identifiers.append(identifier)
            } else {
                failed += 1
            }
        }
        if compiled.isEmpty {
            return "The filter lists could not be compiled."
        }
        if failed > 0 {
            problem = "\(failed) of \(converted.lists.count) rule lists could not be compiled and were left out."
        }

        let previous: [String]
        switch group {
        case .main:
            previous = meta.mainIDs
            mainLists = compiled
            meta.mainIDs = identifiers
            meta.mainRuleCount = converted.ruleCount
            meta.lastUpdated = Date()
            lastUpdated = meta.lastUpdated
        case .annoyances:
            previous = meta.annoyanceIDs
            annoyanceLists = compiled
            meta.annoyanceIDs = identifiers
            meta.annoyanceRuleCount = converted.ruleCount
        }
        meta.converterVersion = Self.converterVersion
        saveMeta()
        refreshRuleCount()
        notifyChanged()

        for identifier in previous where !identifiers.contains(identifier) {
            await remove(identifier: identifier, store: store)
        }
        return problem
    }

    // MARK: - Bundled list

    private func prepareFallback(store: WKContentRuleListStore) async {
        let bundled = Self.bundledFallbackJSON()
        if let text = bundled {
            fallbackRuleCount = Self.countRules(inJSON: text)
        }
        if let existing = await lookUp(identifier: Self.fallbackIdentifier, store: store) {
            fallbackList = existing
            return
        }
        guard let json = bundled else {
            lastError = "The built-in filter list is missing."
            return
        }
        fallbackList = await compile(identifier: Self.fallbackIdentifier, json: json, store: store)
        if fallbackList == nil {
            fallbackRuleCount = 0
            lastError = "The built-in filter list could not be compiled."
        }
    }

    private static func bundledFallbackJSON() -> String? {
        let bundle = Bundle.main
        let url = bundle.url(forResource: "shield-fallback", withExtension: "json")
            ?? bundle.url(forResource: "shield-fallback", withExtension: "json", subdirectory: "Resources")
        guard let fileURL = url, let data = try? Data(contentsOf: fileURL) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func countRules(inJSON json: String) -> Int {
        guard let data = json.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data, options: []) as? [Any] else { return 0 }
        return array.count
    }

    // MARK: - Rule list store

    private func compile(identifier: String, json: String, store: WKContentRuleListStore) async -> WKContentRuleList? {
        await withCheckedContinuation { (continuation: CheckedContinuation<WKContentRuleList?, Never>) in
            store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, _ in
                continuation.resume(returning: list)
            }
        }
    }

    private func lookUp(identifier: String, store: WKContentRuleListStore) async -> WKContentRuleList? {
        await withCheckedContinuation { (continuation: CheckedContinuation<WKContentRuleList?, Never>) in
            store.lookUpContentRuleList(forIdentifier: identifier) { list, _ in
                continuation.resume(returning: list)
            }
        }
    }

    private func lookUp(_ identifiers: [String], store: WKContentRuleListStore) async -> [WKContentRuleList] {
        var lists: [WKContentRuleList] = []
        for identifier in identifiers {
            if let list = await lookUp(identifier: identifier, store: store) { lists.append(list) }
        }
        return lists
    }

    private func remove(identifier: String, store: WKContentRuleListStore) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            store.removeContentRuleList(forIdentifier: identifier) { _ in
                continuation.resume()
            }
        }
    }

    private func availableIdentifiers(store: WKContentRuleListStore) async -> [String] {
        await withCheckedContinuation { (continuation: CheckedContinuation<[String], Never>) in
            store.getAvailableContentRuleListIdentifiers { identifiers in
                continuation.resume(returning: identifiers ?? [])
            }
        }
    }

    /// Removes lists of earlier updates that are no longer referenced.
    private func removeStaleLists(store: WKContentRuleListStore) async {
        var keep = Set(meta.mainIDs)
        keep.formUnion(meta.annoyanceIDs)
        keep.insert(Self.fallbackIdentifier)
        let available = await availableIdentifiers(store: store)
        for identifier in available {
            if identifier.hasPrefix(Self.identifierPrefix) && !keep.contains(identifier) {
                await remove(identifier: identifier, store: store)
            }
        }
    }

    // MARK: - Small helpers

    private func refreshRuleCount() {
        let settings = AppSettings.shared
        var count = 0
        if mainLists.isEmpty {
            count = fallbackList == nil ? 0 : fallbackRuleCount
        } else {
            count = meta.mainRuleCount
        }
        if settings.adblockAnnoyances && !annoyanceLists.isEmpty { count += meta.annoyanceRuleCount }
        if ruleCount != count { ruleCount = count }
    }

    private func notifyChanged() {
        NotificationCenter.default.post(name: Self.didChange, object: self)
    }

    private static func loadMeta() -> Meta {
        guard let data = UserDefaults.standard.data(forKey: metaKey),
              let meta = try? JSONDecoder().decode(Meta.self, from: data) else { return Meta() }
        return meta
    }

    private func saveMeta() {
        guard let data = try? JSONEncoder().encode(meta) else { return }
        UserDefaults.standard.set(data, forKey: Self.metaKey)
    }
}
