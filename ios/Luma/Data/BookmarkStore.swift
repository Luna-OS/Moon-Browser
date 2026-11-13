import Foundation
import SwiftUI

/// The bookmarks, kept in the order the user gave them (new ones at the end).
@MainActor
final class BookmarkStore: ObservableObject {
    static let shared = BookmarkStore(fileURL: CoreStorage.fileURL("bookmarks.json"))

    @Published private(set) var bookmarks: [Bookmark] = []

    private let fileURL: URL?

    /// `fileURL` nil keeps everything in memory (tests, previews).
    init(fileURL: URL?) {
        self.fileURL = fileURL
        if let fileURL = fileURL, let stored = CoreStorage.load([Bookmark].self, from: fileURL) {
            bookmarks = stored
        }
    }

    func isBookmarked(_ url: String) -> Bool {
        index(of: url) != nil
    }

    func add(title: String, url: String) {
        let address = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty, index(of: address) == nil else { return }
        bookmarks.append(Bookmark(id: UUID(), title: Self.cleanTitle(title, url: address), url: address, addedAt: Date()))
        save()
    }

    /// Adds the bookmark, or removes it when it exists. Returns the new state.
    @discardableResult
    func toggle(title: String, url: String) -> Bool {
        if let existing = index(of: url) {
            bookmarks.remove(at: existing)
            save()
            return false
        }
        add(title: title, url: url)
        return isBookmarked(url)
    }

    func update(_ bookmark: Bookmark) {
        guard let i = bookmarks.firstIndex(where: { $0.id == bookmark.id }) else { return }
        var changed = bookmark
        changed.url = bookmark.url.trimmingCharacters(in: .whitespacesAndNewlines)
        if changed.url.isEmpty { changed.url = bookmarks[i].url }
        changed.title = Self.cleanTitle(bookmark.title, url: changed.url)
        bookmarks[i] = changed
        save()
    }

    func remove(id: UUID) {
        guard let i = bookmarks.firstIndex(where: { $0.id == id }) else { return }
        bookmarks.remove(at: i)
        save()
    }

    func remove(atOffsets offsets: IndexSet) {
        let valid = offsets.filter { $0 >= 0 && $0 < bookmarks.count }
        guard !valid.isEmpty else { return }
        for i in valid.sorted(by: >) { bookmarks.remove(at: i) }
        save()
    }

    func move(fromOffsets: IndexSet, toOffset: Int) {
        let valid = fromOffsets.filter { $0 >= 0 && $0 < bookmarks.count }.sorted()
        guard !valid.isEmpty else { return }
        let target = min(max(toOffset, 0), bookmarks.count)
        let moving = valid.map { bookmarks[$0] }
        let before = valid.filter { $0 < target }.count
        var result = bookmarks
        for i in valid.reversed() { result.remove(at: i) }
        result.insert(contentsOf: moving, at: target - before)
        bookmarks = result
        save()
    }

    /// Bookmarks whose title or address contains every word of the query.
    func search(_ query: String, limit: Int) -> [Bookmark] {
        guard limit > 0 else { return [] }
        let tokens = CoreStorage.tokens(query)
        if tokens.isEmpty { return Array(bookmarks.prefix(limit)) }
        var result: [Bookmark] = []
        for bookmark in bookmarks {
            let haystack = CoreStorage.fold(bookmark.title + " " + bookmark.url)
            if tokens.allSatisfy({ haystack.contains($0) }) {
                result.append(bookmark)
                if result.count >= limit { break }
            }
        }
        return result
    }

    // MARK: - Private

    private func index(of url: String) -> Int? {
        let key = Self.key(url)
        return bookmarks.firstIndex(where: { Self.key($0.url) == key })
    }

    /// "https://example.com/" and "https://example.com" are the same bookmark.
    private static func key(_ url: String) -> String {
        var text = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasSuffix("/") { text.removeLast() }
        return text
    }

    private static func cleanTitle(_ title: String, url: String) -> String {
        let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? Display.shortHost(url) : text
    }

    private func save() {
        guard let fileURL = fileURL else { return }
        CoreStorage.save(bookmarks, to: fileURL)
    }
}
