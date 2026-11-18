import XCTest
@testable import Luma

final class SearchEnginesTests: XCTestCase {
    func testNineEnginesPerplexityFirst() {
        XCTAssertEqual(SearchEngines.all.count, 9)
        XCTAssertEqual(SearchEngines.all.first?.id, "perplexity")
        XCTAssertEqual(SearchEngines.default.id, "perplexity")
        XCTAssertEqual(Set(SearchEngines.all.map { $0.id }).count, 9)
        for engine in SearchEngines.all {
            XCTAssertTrue(engine.searchURL.contains("%s"), engine.id)
            XCTAssertNotNil(URL(string: engine.home), engine.id)
        }
    }

    func testSearchURLEncodesTheQuery() {
        let ddg = SearchEngines.resolve(id: "duckduckgo", customSearchURL: "")
        XCTAssertEqual(
            SearchEngines.searchURL(engine: ddg, query: "moon phase")?.absoluteString,
            "https://duckduckgo.com/?q=moon+phase"
        )
        XCTAssertEqual(
            SearchEngines.searchURL(engine: ddg, query: "a&b=c #1")?.absoluteString,
            "https://duckduckgo.com/?q=a%26b%3Dc+%231"
        )
        XCTAssertEqual(
            SearchEngines.searchURL(engine: ddg, query: "käse")?.absoluteString,
            "https://duckduckgo.com/?q=k%C3%A4se"
        )
    }

    func testEmptyQueryGoesHome() {
        let engine = SearchEngines.default
        XCTAssertEqual(SearchEngines.searchURL(engine: engine, query: "   ")?.absoluteString, engine.home)
    }

    func testCustomSearchURLValidation() {
        XCTAssertTrue(SearchEngines.isValidCustomSearchURL("https://example.com/search?q=%s"))
        XCTAssertTrue(SearchEngines.isValidCustomSearchURL("http://search.local/%s"))
        XCTAssertFalse(SearchEngines.isValidCustomSearchURL("https://example.com/search"))
        XCTAssertFalse(SearchEngines.isValidCustomSearchURL("ftp://example.com/%s"))
        XCTAssertFalse(SearchEngines.isValidCustomSearchURL("example.com/%s"))
        XCTAssertFalse(SearchEngines.isValidCustomSearchURL(""))
    }

    func testResolve() {
        XCTAssertEqual(SearchEngines.resolve(id: "kagi", customSearchURL: "").name, "Kagi")
        XCTAssertEqual(SearchEngines.resolve(id: "nope", customSearchURL: "").id, "perplexity")

        let custom = SearchEngines.resolve(id: "custom", customSearchURL: "https://www.example.com/find?q=%s")
        XCTAssertEqual(custom.id, "custom")
        XCTAssertEqual(custom.name, "example.com")
        XCTAssertEqual(custom.home, "https://www.example.com/")
        XCTAssertEqual(
            SearchEngines.searchURL(engine: custom, query: "moon")?.absoluteString,
            "https://www.example.com/find?q=moon"
        )

        // An invalid custom URL falls back to the default engine.
        XCTAssertEqual(SearchEngines.resolve(id: "custom", customSearchURL: "nonsense").id, "perplexity")
    }
}

final class BangsTests: XCTestCase {
    func testTriggersAreUnique() {
        let triggers = Bangs.all.map { $0.trigger }
        XCTAssertEqual(Set(triggers).count, triggers.count)
        for bang in Bangs.all {
            XCTAssertTrue(bang.url.contains("%s"), bang.trigger)
            XCTAssertNotNil(URL(string: bang.home), bang.trigger)
        }
    }

    func testBangAtStartAndEnd() {
        let first = Bangs.match("!w moon landing")
        XCTAssertEqual(first?.bang.name, "Wikipedia")
        XCTAssertEqual(first?.query, "moon landing")

        let last = Bangs.match("moon landing !W")
        XCTAssertEqual(last?.bang.name, "Wikipedia")
        XCTAssertEqual(last?.query, "moon landing")
    }

    func testBangWithoutQueryOpensTheSite() {
        guard let match = Bangs.match("!gh") else { return XCTFail("no match") }
        XCTAssertEqual(match.query, "")
        XCTAssertEqual(Bangs.url(for: match)?.absoluteString, "https://github.com/")
    }

    func testExplicitHome() {
        XCTAssertEqual(Bangs.find(trigger: "hn")?.home, "https://news.ycombinator.com/")
        XCTAssertEqual(Bangs.find(trigger: "deepl")?.home, "https://www.deepl.com/")
    }

    func testNoBang() {
        XCTAssertNil(Bangs.match("moon"))
        XCTAssertNil(Bangs.match("hello !unknownbang"))
        XCTAssertNil(Bangs.match("wow! great"))
        XCTAssertNil(Bangs.match("a !w b"))
    }

    func testBangURL() {
        guard let match = Bangs.match("!yt lunar eclipse") else { return XCTFail("no match") }
        XCTAssertEqual(
            Bangs.url(for: match)?.absoluteString,
            "https://www.youtube.com/results?search_query=lunar+eclipse"
        )
    }
}

final class OmniboxTests: XCTestCase {
    private let engine = SearchEngines.resolve(id: "duckduckgo", customSearchURL: "")

    private func resolve(_ input: String, bangs: Bool = true) -> OmniboxResult? {
        Omnibox.resolve(input, engine: engine, bangs: bangs)
    }

    private func assertURL(_ input: String, _ expected: String, file: StaticString = #filePath, line: UInt = #line) {
        guard let result = resolve(input) else { return XCTFail("nil for \(input)", file: file, line: line) }
        guard case .url(let url) = result else {
            return XCTFail("\(input) is not a URL: \(result)", file: file, line: line)
        }
        XCTAssertEqual(url.absoluteString, expected, file: file, line: line)
    }

    private func assertSearch(_ input: String, file: StaticString = #filePath, line: UInt = #line) {
        guard let result = resolve(input) else { return XCTFail("nil for \(input)", file: file, line: line) }
        guard case .search(_, let query) = result else {
            return XCTFail("\(input) is not a search: \(result)", file: file, line: line)
        }
        XCTAssertEqual(query, input.trimmingCharacters(in: .whitespaces), file: file, line: line)
    }

    func testEmptyInput() {
        XCTAssertNil(resolve(""))
        XCTAssertNil(resolve("   "))
    }

    func testExplicitURLs() {
        assertURL("https://example.com/a?b=c", "https://example.com/a?b=c")
        assertURL("  http://example.com  ", "http://example.com")
        assertURL("HTTPS://Example.com/", "HTTPS://Example.com/")
    }

    func testGuessedHosts() {
        assertURL("example.com", "http://example.com")
        assertURL("example.com/path?x=1", "http://example.com/path?x=1")
        assertURL("sub.example.co.uk", "http://sub.example.co.uk")
        assertURL("localhost", "http://localhost")
        assertURL("localhost:3000/x", "http://localhost:3000/x")
        assertURL("192.168.1.1", "http://192.168.1.1")
        assertURL("printer.local", "http://printer.local")
        assertURL("router/", "http://router/")
        assertURL("nas:5000", "http://nas:5000")
        assertURL("nas.box:5000", "http://nas.box:5000")
        assertURL("[::1]:8080", "http://[::1]:8080")
    }

    func testSearches() {
        assertSearch("moon")
        assertSearch("moon phase today")
        assertSearch("3.14")
        assertSearch("c++")
        assertSearch("user@example.com")
        assertSearch("what is example.com")
        assertSearch("file.unknownsuffix")
        assertSearch("mailto:someone")
        assertSearch("999.1.1.1")
    }

    func testSearchUsesTheEngine() {
        XCTAssertEqual(
            resolve("moon phase"),
            .search(URL(string: "https://duckduckgo.com/?q=moon+phase")!, query: "moon phase")
        )
    }

    func testBangs() {
        XCTAssertEqual(
            resolve("!w moon"),
            .bang(URL(string: "https://en.wikipedia.org/w/index.php?search=moon")!, query: "moon", name: "Wikipedia")
        )
        // With bangs off, the same input is an ordinary search.
        guard let off = resolve("!w moon", bangs: false) else { return XCTFail("nil") }
        guard case .search = off else { return XCTFail("not a search: \(off)") }
    }

    func testResultURL() {
        XCTAssertEqual(resolve("example.com")?.destination.absoluteString, "http://example.com")
        XCTAssertEqual(resolve("moon")?.destination.absoluteString, "https://duckduckgo.com/?q=moon")
    }

    func testIPAddresses() {
        XCTAssertTrue(Omnibox.isIPAddress("127.0.0.1"))
        XCTAssertTrue(Omnibox.isIPAddress("[::1]"))
        XCTAssertFalse(Omnibox.isIPAddress("256.1.1.1"))
        XCTAssertFalse(Omnibox.isIPAddress("3.14"))
    }

    func testTopLevelDomains() {
        XCTAssertTrue(TopLevelDomains.hasKnownSuffix("example.com"))
        XCTAssertTrue(TopLevelDomains.hasKnownSuffix("Example.DE"))
        XCTAssertTrue(TopLevelDomains.hasKnownSuffix("a.b.io"))
        XCTAssertFalse(TopLevelDomains.hasKnownSuffix("adserver.js"))
        XCTAssertFalse(TopLevelDomains.hasKnownSuffix("localhost"))
    }
}

final class MoonTests: XCTestCase {
    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = hour
        comps.minute = minute
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone
        return calendar.date(from: comps) ?? Date(timeIntervalSince1970: 0)
    }

    func testReferenceNewMoon() {
        let info = Moon.phase(at: date(2000, 1, 6, 18, 14))
        XCTAssertEqual(info.age, 0, accuracy: 0.001)
        XCTAssertEqual(info.phase, 0, accuracy: 0.001)
        XCTAssertEqual(info.illumination, 0, accuracy: 0.001)
        XCTAssertEqual(info.name, "New moon")
        XCTAssertTrue(info.waxing)
    }

    func testFullMoonHalfACycleLater() {
        // 2000-01-21 was a full moon (total lunar eclipse).
        let info = Moon.phase(at: date(2000, 1, 21, 4, 40))
        XCTAssertEqual(info.phase, 0.5, accuracy: 0.03)
        XCTAssertGreaterThan(info.illumination, 0.98)
        XCTAssertEqual(info.name, "Full moon")
    }

    func testQuarters() {
        let reference = date(2000, 1, 6, 18, 14)
        let month = 29.530588853 * 86_400
        let firstQuarter = Moon.phase(at: reference.addingTimeInterval(month * 0.25))
        XCTAssertEqual(firstQuarter.name, "First quarter")
        XCTAssertEqual(firstQuarter.illumination, 0.5, accuracy: 0.001)
        XCTAssertTrue(firstQuarter.waxing)

        let lastQuarter = Moon.phase(at: reference.addingTimeInterval(month * 0.75))
        XCTAssertEqual(lastQuarter.name, "Last quarter")
        XCTAssertFalse(lastQuarter.waxing)

        XCTAssertEqual(Moon.phase(at: reference.addingTimeInterval(month * 0.12)).name, "Waxing crescent")
        XCTAssertEqual(Moon.phase(at: reference.addingTimeInterval(month * 0.98)).name, "New moon")
    }

    func testDatesBeforeTheReference() {
        let info = Moon.phase(at: date(1990, 6, 1))
        XCTAssertGreaterThanOrEqual(info.age, 0)
        XCTAssertLessThan(info.age, 29.530588853)
        XCTAssertGreaterThanOrEqual(info.phase, 0)
        XCTAssertLessThan(info.phase, 1)
    }

    func testGreeting() {
        XCTAssertEqual(Moon.greeting(hour: 3), "Good night")
        XCTAssertEqual(Moon.greeting(hour: 5), "Good morning")
        XCTAssertEqual(Moon.greeting(hour: 12), "Good afternoon")
        XCTAssertEqual(Moon.greeting(hour: 18), "Good evening")
        XCTAssertEqual(Moon.greeting(hour: 22), "Good night")
    }
}

final class TrackingParamsTests: XCTestCase {
    private func strip(_ url: String) -> String? {
        guard let parsed = URL(string: url) else { return nil }
        return TrackingParams.strip(from: parsed)?.absoluteString
    }

    func testRemovesTrackingParameters() {
        XCTAssertEqual(
            strip("https://example.com/page?utm_source=news&id=7&fbclid=abc"),
            "https://example.com/page?id=7"
        )
        XCTAssertEqual(strip("https://example.com/?gclid=1#top"), "https://example.com/#top")
        XCTAssertEqual(strip("https://example.com/a?UTM_Medium=x"), "https://example.com/a")
        XCTAssertEqual(strip("https://example.com/a?mtm_campaign=x&pk_kwd=y&q=1"), "https://example.com/a?q=1")
    }

    func testShareIDOnlyOnKnownSites() {
        XCTAssertEqual(
            strip("https://www.youtube.com/watch?v=x&si=track"),
            "https://www.youtube.com/watch?v=x"
        )
        XCTAssertEqual(strip("https://youtu.be/x?si=track"), "https://youtu.be/x")
        XCTAssertNil(strip("https://example.com/?si=keep"))
        XCTAssertNil(strip("https://notyoutube.com/?si=keep"))
    }

    func testNothingToRemove() {
        XCTAssertNil(strip("https://example.com/?q=moon"))
        XCTAssertNil(strip("https://example.com/"))
        XCTAssertNil(strip("ftp://example.com/?utm_source=x"))
    }

    func testKeepsTheRestUntouched() {
        XCTAssertEqual(
            strip("https://example.com/?q=a%20b+c&gclid=1&x=%C3%A4"),
            "https://example.com/?q=a%20b+c&x=%C3%A4"
        )
    }
}

final class DisplayTests: XCTestCase {
    func testShortHost() {
        XCTAssertEqual(Display.shortHost("https://www.example.com/x"), "example.com")
        XCTAssertEqual(Display.shortHost("http://Sub.Example.com:8080/"), "sub.example.com")
        XCTAssertEqual(Display.shortHost("not a url"), "not a url")
    }

    func testPrettyURL() {
        XCTAssertEqual(Display.prettyURL("https://example.com/"), "example.com")
        XCTAssertEqual(Display.prettyURL("https://www.example.com/a/b/?q=1#top"), "www.example.com/a/b/?q=1#top")
        XCTAssertEqual(Display.prettyURL("http://example.com:8080/a/"), "example.com:8080/a")
        XCTAssertEqual(Display.prettyURL("about:blank"), "about:blank")
    }
}
