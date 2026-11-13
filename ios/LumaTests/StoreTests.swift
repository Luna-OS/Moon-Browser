import XCTest
@testable import Luma

@MainActor
final class BookmarkStoreTests: XCTestCase {
    private func temporaryFile() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("luma-tests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("bookmarks.json")
    }

    func testAddAndToggle() {
        let store = BookmarkStore(fileURL: nil)
        XCTAssertFalse(store.isBookmarked("https://example.com/"))

        store.add(title: "Example", url: "https://example.com/")
        XCTAssertTrue(store.isBookmarked("https://example.com/"))
        XCTAssertTrue(store.isBookmarked("https://example.com"))
        XCTAssertEqual(store.bookmarks.count, 1)

        // Adding it again changes nothing.
        store.add(title: "Again", url: "https://example.com")
        XCTAssertEqual(store.bookmarks.count, 1)
        XCTAssertEqual(store.bookmarks.first?.title, "Example")

        XCTAssertFalse(store.toggle(title: "Example", url: "https://example.com/"))
        XCTAssertTrue(store.bookmarks.isEmpty)
        XCTAssertTrue(store.toggle(title: "Example", url: "https://example.com/"))
        XCTAssertEqual(store.bookmarks.count, 1)
    }

    func testEmptyTitleFallsBackToTheHost() {
        let store = BookmarkStore(fileURL: nil)
        store.add(title: "  ", url: "https://www.example.com/page")
        XCTAssertEqual(store.bookmarks.first?.title, "example.com")
    }

    func testUpdateAndRemove() {
        let store = BookmarkStore(fileURL: nil)
        store.add(title: "One", url: "https://one.example/")
        store.add(title: "Two", url: "https://two.example/")
        guard var first = store.bookmarks.first else { return XCTFail("empty") }

        first.title = "Uno"
        first.url = "https://uno.example/"
        store.update(first)
        XCTAssertEqual(store.bookmarks.first?.title, "Uno")
        XCTAssertTrue(store.isBookmarked("https://uno.example/"))
        XCTAssertFalse(store.isBookmarked("https://one.example/"))

        store.remove(id: first.id)
        XCTAssertEqual(store.bookmarks.map { $0.title }, ["Two"])

        store.remove(atOffsets: IndexSet(integer: 0))
        XCTAssertTrue(store.bookmarks.isEmpty)
        // Out of range offsets are ignored.
        store.remove(atOffsets: IndexSet(integer: 5))
    }

    func testMove() {
        let store = BookmarkStore(fileURL: nil)
        for name in ["a", "b", "c", "d"] {
            store.add(title: name, url: "https://\(name).example/")
        }
        store.move(fromOffsets: IndexSet(integer: 0), toOffset: 3)
        XCTAssertEqual(store.bookmarks.map { $0.title }, ["b", "c", "a", "d"])
        store.move(fromOffsets: IndexSet(integer: 3), toOffset: 0)
        XCTAssertEqual(store.bookmarks.map { $0.title }, ["d", "b", "c", "a"])
        store.move(fromOffsets: IndexSet([0, 1]), toOffset: 4)
        XCTAssertEqual(store.bookmarks.map { $0.title }, ["c", "a", "d", "b"])
    }

    func testSearch() {
        let store = BookmarkStore(fileURL: nil)
        store.add(title: "Café Luna", url: "https://cafe.example/")
        store.add(title: "Moon phases", url: "https://moon.example/phases")
        store.add(title: "Other", url: "https://other.example/moon")

        XCTAssertEqual(store.search("cafe", limit: 10).map { $0.title }, ["Café Luna"])
        XCTAssertEqual(store.search("MOON", limit: 10).count, 2)
        XCTAssertEqual(store.search("moon", limit: 1).count, 1)
        XCTAssertEqual(store.search("moon phases", limit: 10).map { $0.title }, ["Moon phases"])
        XCTAssertEqual(store.search("", limit: 10).count, 3)
        XCTAssertTrue(store.search("nothing", limit: 10).isEmpty)
    }

    func testPersists() {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }

        let store = BookmarkStore(fileURL: file)
        store.add(title: "Example", url: "https://example.com/")
        store.add(title: "Moon", url: "https://moon.example/")

        let reloaded = BookmarkStore(fileURL: file)
        XCTAssertEqual(reloaded.bookmarks.map { $0.title }, ["Example", "Moon"])
        XCTAssertEqual(reloaded.bookmarks.first?.id, store.bookmarks.first?.id)
    }
}

@MainActor
final class HistoryStoreTests: XCTestCase {
    func testRecordsOnlyWebPages() {
        let store = HistoryStore(fileURL: nil)
        store.record(title: "Blank", url: "about:blank")
        store.record(title: "File", url: "file:///tmp/x.html")
        store.record(title: "Example", url: "https://example.com/")
        store.record(title: "Plain", url: "http://plain.example/")
        XCTAssertEqual(store.entries.map { $0.title }, ["Plain", "Example"])
    }

    func testRepeatVisitIsMerged() {
        let store = HistoryStore(fileURL: nil)
        store.record(title: "Example", url: "https://example.com/")
        store.record(title: "Other", url: "https://other.example/")
        store.record(title: "Example again", url: "https://example.com/")
        XCTAssertEqual(store.entries.count, 2)
        XCTAssertEqual(store.entries.first?.title, "Example again")
        XCTAssertEqual(store.entries.first?.url, "https://example.com/")
    }

    func testUpdateTitle() {
        let store = HistoryStore(fileURL: nil)
        store.record(title: "", url: "https://www.example.com/page")
        XCTAssertEqual(store.entries.first?.title, "example.com")
        store.updateTitle(url: "https://www.example.com/page", title: "The page")
        XCTAssertEqual(store.entries.first?.title, "The page")
        store.updateTitle(url: "https://www.example.com/page", title: "  ")
        XCTAssertEqual(store.entries.first?.title, "The page")
    }

    func testRemoveAndClear() {
        let store = HistoryStore(fileURL: nil)
        store.record(title: "One", url: "https://one.example/")
        store.record(title: "Two", url: "https://two.example/")
        guard let first = store.entries.first else { return XCTFail("empty") }
        store.remove(id: first.id)
        XCTAssertEqual(store.entries.map { $0.title }, ["One"])

        store.clear(since: Date().addingTimeInterval(60))
        XCTAssertEqual(store.entries.count, 1)
        store.clear(since: Date().addingTimeInterval(-60))
        XCTAssertTrue(store.entries.isEmpty)

        store.record(title: "One", url: "https://one.example/")
        store.clear(since: nil)
        XCTAssertTrue(store.entries.isEmpty)
    }

    func testSearch() {
        let store = HistoryStore(fileURL: nil)
        store.record(title: "Moon phases", url: "https://moon.example/phases")
        store.record(title: "Café", url: "https://cafe.example/")
        store.record(title: "Lunar calendar", url: "https://calendar.example/moon")

        XCTAssertEqual(store.search("moon", limit: 10).map { $0.title }, ["Lunar calendar", "Moon phases"])
        XCTAssertEqual(store.search("cafe", limit: 10).map { $0.title }, ["Café"])
        XCTAssertEqual(store.search("moon", limit: 1).count, 1)
        XCTAssertEqual(store.search("", limit: 10).count, 3)
        XCTAssertTrue(store.search("nothing", limit: 10).isEmpty)
    }

    func testTopSites() throws {
        // Visits more than a minute apart, so they are not merged.
        let now = Date()
        var entries: [HistoryEntry] = []
        func visit(_ title: String, _ url: String, minutesAgo: Double) {
            entries.append(HistoryEntry(id: UUID(), title: title, url: url, visitedAt: now.addingTimeInterval(-minutesAgo * 60)))
        }
        visit("News front", "https://news.example/", minutesAgo: 10)
        visit("News front", "https://news.example/", minutesAgo: 20)
        visit("News story", "https://www.news.example/story", minutesAgo: 30)
        visit("Moon", "https://moon.example/", minutesAgo: 40)
        visit("Moon", "https://moon.example/", minutesAgo: 50)
        visit("Rare", "https://rare.example/", minutesAgo: 60)

        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("luma-tests-\(UUID().uuidString)", isDirectory: true)
        let file = dir.appendingPathComponent("history.json")
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertTrue(CoreStorage.save(entries, to: file))

        let store = HistoryStore(fileURL: file)
        XCTAssertEqual(store.entries.count, 6)
        XCTAssertEqual(store.entries.first?.url, "https://news.example/")

        let top = store.topSites(limit: 8, hidden: [])
        XCTAssertEqual(top.map { $0.url }, ["https://news.example/", "https://moon.example/", "https://rare.example/"])
        XCTAssertEqual(top.first?.title, "News front")

        XCTAssertEqual(store.topSites(limit: 2, hidden: []).count, 2)

        let withoutNews = store.topSites(limit: 8, hidden: ["https://news.example/"])
        XCTAssertEqual(withoutNews.map { $0.url }, ["https://moon.example/", "https://rare.example/"])

        // The cache follows changes.
        store.clear(since: nil)
        XCTAssertTrue(store.topSites(limit: 8, hidden: []).isEmpty)
    }

    func testPersists() {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("luma-tests-\(UUID().uuidString)", isDirectory: true)
        let file = dir.appendingPathComponent("history.json")
        defer { try? FileManager.default.removeItem(at: dir) }

        let store = HistoryStore(fileURL: file)
        store.record(title: "Example", url: "https://example.com/")
        store.flush()

        let reloaded = HistoryStore(fileURL: file)
        XCTAssertEqual(reloaded.entries.map { $0.url }, ["https://example.com/"])
    }
}
