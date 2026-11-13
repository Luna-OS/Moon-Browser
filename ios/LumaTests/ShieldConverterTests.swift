import XCTest
@testable import Luma

final class ShieldConverterTests: XCTestCase {
    private let hostAnchor = "^[^:]+://+([^:/]+\\.)?"
    private let separator = "[^a-zA-Z0-9_.%-]"

    private func one(_ line: String, file: StaticString = #filePath, line lineNumber: UInt = #line) -> ShieldRule? {
        let rules = ShieldConverter.convertLine(line)
        XCTAssertEqual(rules.count, 1, "rules for \(line)", file: file, line: lineNumber)
        return rules.first
    }

    private func matches(_ rule: ShieldRule, _ url: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: rule.urlFilter, options: [.caseInsensitive]) else {
            return false
        }
        return regex.firstMatch(in: url, options: [], range: NSRange(url.startIndex..<url.endIndex, in: url)) != nil
    }

    // MARK: - Hosts

    func testDomainAnchor() {
        guard let rule = one("||ads.example.com^") else { return }
        XCTAssertEqual(rule.urlFilter, hostAnchor + "ads\\.example\\.com[:/]")
        XCTAssertEqual(rule.action, .block)
        XCTAssertTrue(rule.resourceTypes.isEmpty)
        XCTAssertTrue(rule.loadTypes.isEmpty)
        XCTAssertTrue(matches(rule, "https://ads.example.com/banner.js"))
        XCTAssertTrue(matches(rule, "https://cdn.ads.example.com:8443/x"))
        XCTAssertFalse(matches(rule, "https://ads.example.community/x"))
        XCTAssertFalse(matches(rule, "https://badads.example.com/x"))
        XCTAssertFalse(matches(rule, "https://other.com/?u=ads.example.com/"))
    }

    func testPlainHostLines() {
        XCTAssertEqual(one("ads.example.com")?.urlFilter, hostAnchor + "ads\\.example\\.com[:/]")
        XCTAssertEqual(one("0.0.0.0 tracker.example.net")?.urlFilter, hostAnchor + "tracker\\.example\\.net[:/]")
        XCTAssertEqual(
            one("127.0.0.1 tracker.example.net # comment")?.urlFilter,
            hostAnchor + "tracker\\.example\\.net[:/]"
        )
        XCTAssertTrue(ShieldConverter.convertLine("127.0.0.1 localhost").isEmpty)
        // Not a host name: stays a plain pattern.
        XCTAssertEqual(one("adserver.js")?.urlFilter, "adserver\\.js")
    }

    // MARK: - Patterns

    func testPathPatterns() {
        XCTAssertEqual(one("/banner/ads/*")?.urlFilter, "/banner/ads/")
        XCTAssertEqual(one("/ads/*/banner.")?.urlFilter, "/ads/.*/banner\\.")
        XCTAssertEqual(one("|https://example.com/ad")?.urlFilter, "^https://example\\.com/ad")
        XCTAssertEqual(one("/track.gif|")?.urlFilter, "/track\\.gif$")
        XCTAssertEqual(one("||example.com/ads/")?.urlFilter, hostAnchor + "example\\.com/ads/")
        XCTAssertEqual(one("||example.com^*/pixel?")?.urlFilter, hostAnchor + "example\\.com" + separator + ".*/pixel\\?")
    }

    func testTrailingSeparatorAfterAPathTakesTwoRules() {
        let rules = ShieldConverter.convertLine("||example.com/ads^")
        XCTAssertEqual(rules.map { $0.urlFilter }, [
            hostAnchor + "example\\.com/ads" + separator,
            hostAnchor + "example\\.com/ads$",
        ])
        XCTAssertTrue(matches(rules[0], "https://example.com/ads?x=1"))
        XCTAssertTrue(matches(rules[1], "https://example.com/ads"))
        XCTAssertFalse(matches(rules[0], "https://example.com/adserver"))
        XCTAssertFalse(matches(rules[1], "https://example.com/adserver"))
    }

    func testUnsupportedPatterns() {
        XCTAssertTrue(ShieldConverter.convertLine("/^https?:\\/\\/ads\\./").isEmpty)        // regular expression
        XCTAssertTrue(ShieldConverter.convertLine("/ads/$script").isEmpty)                    // also one
        XCTAssertTrue(ShieldConverter.convertLine("||exämple.com^").isEmpty)                  // not ASCII
        XCTAssertTrue(ShieldConverter.convertLine("/ad{2}").isEmpty)                          // braces
        XCTAssertTrue(ShieldConverter.convertLine("ad").isEmpty)                              // far too broad
        XCTAssertNil(ShieldConverter.urlFilters(forPattern: "a|b"))
    }

    // MARK: - Options

    func testThirdParty() {
        XCTAssertEqual(one("||example.com^$third-party")?.loadTypes, ["third-party"])
        XCTAssertEqual(one("||example.com^$3p")?.loadTypes, ["third-party"])
        XCTAssertEqual(one("||example.com^$~third-party")?.loadTypes, ["first-party"])
        XCTAssertEqual(one("||example.com^$1p")?.loadTypes, ["first-party"])
    }

    func testResourceTypes() {
        XCTAssertEqual(one("||example.com^$script,image")?.resourceTypes, ["script", "image"])
        XCTAssertEqual(one("||example.com^$stylesheet,font,media")?.resourceTypes, ["style-sheet", "font", "media"])
        XCTAssertEqual(one("||example.com^$xhr,websocket,ping")?.resourceTypes, ["fetch", "websocket", "ping"])
        XCTAssertEqual(one("||example.com^$subdocument")?.resourceTypes, ["document"])
        XCTAssertEqual(one("||example.com^$popup")?.resourceTypes, ["popup"])

        let negated = one("||example.com^$~script")?.resourceTypes ?? []
        XCTAssertFalse(negated.contains("script"))
        XCTAssertTrue(negated.contains("image"))
        XCTAssertTrue(negated.contains("fetch"))

        // Only a type WebKit does not know: nothing to block.
        XCTAssertTrue(ShieldConverter.convertLine("||example.com^$object").isEmpty)
    }

    func testDomainOption() {
        guard let included = one("/ads.js$script,domain=example.com|Example.org") else { return }
        XCTAssertEqual(included.ifDomain, ["*example.com", "*example.org"])
        XCTAssertTrue(included.unlessDomain.isEmpty)

        guard let excluded = one("/ads.js$domain=~example.com") else { return }
        XCTAssertEqual(excluded.unlessDomain, ["*example.com"])
        XCTAssertTrue(excluded.ifDomain.isEmpty)

        // WebKit cannot combine the two: a block is dropped, an exception widened.
        XCTAssertTrue(ShieldConverter.convertLine("/ads.js$domain=example.com|~sub.example.com").isEmpty)
        XCTAssertEqual(one("@@/ads.js$domain=example.com|~sub.example.com")?.ifDomain, ["*example.com"])

        // Options alone need a site.
        XCTAssertEqual(one("$script,domain=example.com")?.urlFilter, ".*")
        XCTAssertTrue(ShieldConverter.convertLine("*$script").isEmpty)
        // "example.*" has no counterpart.
        XCTAssertTrue(ShieldConverter.convertLine("/ads.js$domain=example.*").isEmpty)
    }

    func testMatchCase() {
        XCTAssertEqual(one("/BannerAd.$match-case")?.caseSensitive, true)
        XCTAssertEqual(one("/BannerAd.")?.caseSensitive, false)
    }

    func testUnsupportedOptionsAreSkipped() {
        for line in [
            "||example.com^$redirect=noop.js",
            "||example.com^$csp=script-src 'none'",
            "||example.com^$removeparam=utm_source",
            "||example.com^$badfilter",
            "||example.com^$script,redirect-rule=noopjs",
            "@@||example.com^$generichide",
            "||example.com^$denyallow=cdn.example.com",
        ] {
            XCTAssertTrue(ShieldConverter.convertLine(line).isEmpty, line)
        }
    }

    // MARK: - Exceptions

    func testExceptions() {
        guard let rule = one("@@||example.com/ads.js$script") else { return }
        XCTAssertEqual(rule.action, .ignorePreviousRules)
        XCTAssertEqual(rule.resourceTypes, ["script"])
        XCTAssertEqual(rule.urlFilter, hostAnchor + "example\\.com/ads\\.js")
    }

    func testWholePageException() {
        guard let rule = one("@@||example.com^$document") else { return }
        XCTAssertEqual(rule.action, .ignorePreviousRules)
        XCTAssertEqual(rule.urlFilter, ".*")
        XCTAssertEqual(rule.ifDomain, ["*example.com"])
    }

    // MARK: - Element hiding

    func testGenericCosmetic() {
        guard let rule = one("##.ad-banner") else { return }
        XCTAssertEqual(rule.action, .cssDisplayNone(".ad-banner"))
        XCTAssertEqual(rule.urlFilter, ".*")
        XCTAssertTrue(rule.ifDomain.isEmpty)
        XCTAssertEqual(one("###sidebar-ads")?.action, .cssDisplayNone("#sidebar-ads"))
        XCTAssertEqual(one("##a[href^=\"https://ads.example.com/\"]")?.action,
                       .cssDisplayNone("a[href^=\"https://ads.example.com/\"]"))
    }

    func testDomainCosmetic() {
        guard let rule = one("example.com,Example.org##.promo") else { return }
        XCTAssertEqual(rule.ifDomain, ["*example.com", "*example.org"])
        XCTAssertEqual(rule.action, .cssDisplayNone(".promo"))

        XCTAssertEqual(one("~example.com##.promo")?.unlessDomain, ["*example.com"])
        XCTAssertTrue(ShieldConverter.convertLine("example.com,~sub.example.com##.promo").isEmpty)
        XCTAssertTrue(ShieldConverter.convertLine("example.*##.promo").isEmpty)
    }

    func testUnsupportedCosmetics() {
        for line in [
            "example.com##+js(set-constant, ads, false)",
            "example.com##.item:has-text(Sponsored)",
            "example.com##div:xpath(//div)",
            "example.com##.ad:style(position: absolute !important)",
            "example.com##.ad:upward(2)",
            "example.com##^script:has-text(ads)",
            "example.com#@#.promo",
            "example.com#?#.item:-abp-has(.ad)",
            "example.com#$#abort-on-property-read ads",
            "#@#.promo",
        ] {
            XCTAssertTrue(ShieldConverter.convertLine(line).isEmpty, line)
        }
    }

    // MARK: - Whole lists

    func testCommentsAndHeaders() {
        for line in ["", "   ", "! Title: EasyList", "[Adblock Plus 2.0]", "# hosts comment", "#"] {
            XCTAssertTrue(ShieldConverter.convertLine(line).isEmpty, line)
        }
    }

    func testConvertSortsAndDeduplicates() {
        let text = """
        [Adblock Plus 2.0]
        ! comment
        ||ads.example.com^
        ||ads.example.com^
        ads.example.com
        ||tracker.example.net^$third-party
        @@||ads.example.com/ok.js$script
        ##.ad-banner
        example.com##.promo
        ||example.com^$redirect=noop.js
        """
        let output = ShieldConverter.convert(text)
        XCTAssertEqual(output.blocks.count, 2)
        XCTAssertEqual(output.exceptions.count, 1)
        XCTAssertEqual(output.cosmetics.count, 2)
        XCTAssertEqual(output.skipped, 1)
        XCTAssertEqual(output.ruleCount, 5)
    }

    func testWindowsLineEndings() {
        let output = ShieldConverter.convert("||a.example.com^\r\n||b.example.com^\r\n")
        XCTAssertEqual(output.blocks.count, 2)
        XCTAssertEqual(output.blocks.first?.urlFilter, hostAnchor + "a\\.example\\.com[:/]")
    }

    func testPreprocessor() {
        let text = """
        !#if env_firefox
        ||firefox-only.example.com^
        !#else
        ||everyone-else.example.com^
        !#endif
        !#if !env_chromium
        ||not-chromium.example.com^
        !#endif
        !#if env_mobile && ext_ublock
        ||mobile.example.com^
        !#endif
        ||always.example.com^
        """
        let filters = ShieldConverter.convert(text).blocks.map { $0.urlFilter }
        XCTAssertEqual(filters, [
            hostAnchor + "everyone-else\\.example\\.com[:/]",
            hostAnchor + "not-chromium\\.example\\.com[:/]",
            hostAnchor + "mobile\\.example\\.com[:/]",
            hostAnchor + "always\\.example\\.com[:/]",
        ])
        XCTAssertTrue(ShieldConverter.evaluateCondition("env_safari || env_firefox"))
        XCTAssertFalse(ShieldConverter.evaluateCondition("env_mobile && env_firefox"))
        XCTAssertFalse(ShieldConverter.evaluateCondition("!ext_ublock"))
    }

    // MARK: - Lists for WebKit

    func testExceptionsComeAfterBlocksInEveryList() {
        var lines: [String] = []
        for i in 0..<25 { lines.append("||ads\(i).example.com^") }
        lines.append("@@||ads1.example.com/ok.js")
        lines.append("@@||ads2.example.com/fine.js")
        lines.append("##.ad-banner")
        let output = ShieldConverter.convert(lines.joined(separator: "\n"))
        XCTAssertEqual(output.blocks.count, 25)

        let lists = ShieldConverter.networkLists(output, maxRulesPerList: 13)
        XCTAssertEqual(lists.count, 3)   // 10 blocks + 2 exceptions + the document guard
        var blocks = 0
        for list in lists {
            XCTAssertLessThanOrEqual(list.count, 13)
            XCTAssertEqual(list.last, ShieldConverter.documentGuard)
            let exceptions = list.filter { $0.action == .ignorePreviousRules }
            XCTAssertEqual(exceptions.count, 3)
            // No block follows an exception.
            guard let firstException = list.firstIndex(where: { $0.action == .ignorePreviousRules }) else {
                return XCTFail("no exception")
            }
            XCTAssertTrue(list[firstException...].allSatisfy { $0.action == .ignorePreviousRules })
            XCTAssertTrue(list.allSatisfy { rule in
                if case .cssDisplayNone = rule.action { return false }
                return true
            })
            blocks += list.count - exceptions.count
        }
        XCTAssertEqual(blocks, 25)

        let cosmetic = ShieldConverter.cosmeticLists(output, maxRulesPerList: 13)
        XCTAssertEqual(cosmetic.count, 1)
        XCTAssertEqual(cosmetic.first?.count, 1)
    }

    func testNoListsWithoutRules() {
        let output = ShieldConverter.convert("! nothing here")
        XCTAssertTrue(ShieldConverter.networkLists(output).isEmpty)
        XCTAssertTrue(ShieldConverter.cosmeticLists(output).isEmpty)
    }

    func testEncodedJSON() throws {
        let output = ShieldConverter.convert("""
        ||ads.example.com^$third-party,script
        @@||ads.example.com/ok.js
        example.com##.promo
        /Banner.$match-case,domain=~example.org
        """)
        let lists = ShieldConverter.networkLists(output) + ShieldConverter.cosmeticLists(output)
        let rules = lists.flatMap { $0 }
        let json = ShieldConverter.encode(rules)
        let data = try XCTUnwrap(json.data(using: .utf8))
        let parsed = try XCTUnwrap(try JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]])
        XCTAssertEqual(parsed.count, 5)

        let first = try XCTUnwrap(parsed.first)
        let trigger = try XCTUnwrap(first["trigger"] as? [String: Any])
        XCTAssertEqual(trigger["url-filter"] as? String, hostAnchor + "ads\\.example\\.com[:/]")
        XCTAssertEqual(trigger["load-type"] as? [String], ["third-party"])
        XCTAssertEqual(trigger["resource-type"] as? [String], ["script"])
        XCTAssertEqual((first["action"] as? [String: Any])?["type"] as? String, "block")

        let caseRule = try XCTUnwrap(parsed[1]["trigger"] as? [String: Any])
        XCTAssertEqual(caseRule["url-filter-is-case-sensitive"] as? Bool, true)
        XCTAssertEqual(caseRule["unless-domain"] as? [String], ["*example.org"])
        XCTAssertNil(caseRule["if-domain"])

        let types = parsed.compactMap { ($0["action"] as? [String: Any])?["type"] as? String }
        XCTAssertEqual(types, ["block", "block", "ignore-previous-rules", "ignore-previous-rules", "css-display-none"])
        XCTAssertEqual((parsed[4]["action"] as? [String: Any])?["selector"] as? String, ".promo")
        XCTAssertEqual((parsed[4]["trigger"] as? [String: Any])?["if-domain"] as? [String], ["*example.com"])
    }

    func testEncodedLists() {
        let result = ShieldConverter.encodedLists(from: ["||ads.example.com^\n##.ad", "||ads.example.com^"])
        XCTAssertEqual(result.ruleCount, 2)
        XCTAssertEqual(result.lists.map { $0.kind }, ["net", "cos"])
        XCTAssertEqual(result.lists.first?.ruleCount, 2)   // the block and the document guard
    }

    func testLumaFixesConvert() {
        let output = ShieldConverter.convert(ShieldSources.lumaFixes)
        XCTAssertEqual(output.skipped, 0)
        XCTAssertTrue(output.blocks.isEmpty)
        XCTAssertGreaterThanOrEqual(output.exceptions.count, 4)
        XCTAssertTrue(output.exceptions.allSatisfy { $0.resourceTypes == ["fetch", "ping", "other"] })
    }

    /// The bundled list must be valid WebKit JSON; it sits next to the app's sources.
    func testBundledFallbackList() throws {
        let bundles = [Bundle.main, Bundle(for: ShieldConverterTests.self)]
        guard let url = bundles.compactMap({ $0.url(forResource: "shield-fallback", withExtension: "json") }).first else {
            throw XCTSkip("shield-fallback.json is not in the test host's bundle")
        }
        let data = try Data(contentsOf: url)
        let parsed = try XCTUnwrap(try JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]])
        XCTAssertGreaterThan(parsed.count, 200)
        for rule in parsed {
            let trigger = try XCTUnwrap(rule["trigger"] as? [String: Any])
            let filter = try XCTUnwrap(trigger["url-filter"] as? String)
            XCTAssertNoThrow(try NSRegularExpression(pattern: filter, options: []))
            XCTAssertEqual((rule["action"] as? [String: Any])?["type"] as? String, "block")
        }
    }
}
