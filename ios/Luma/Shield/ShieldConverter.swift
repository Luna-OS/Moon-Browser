import Foundation

/// One rule of a WebKit content blocker (`WKContentRuleList` JSON).
struct ShieldRule: Hashable {
    enum Action: Hashable {
        case block
        case ignorePreviousRules
        case cssDisplayNone(String)
    }

    /// WebKit's regular-expression subset, matched against the whole URL.
    var urlFilter: String
    var caseSensitive: Bool = false
    var resourceTypes: [String] = []
    var loadTypes: [String] = []
    /// Lower-case hosts; a leading `*` also matches subdomains.
    var ifDomain: [String] = []
    var unlessDomain: [String] = []
    var action: Action

    /// The rule as WebKit expects it in the JSON list.
    var dictionary: [String: Any] {
        var trigger: [String: Any] = ["url-filter": urlFilter]
        if caseSensitive { trigger["url-filter-is-case-sensitive"] = true }
        if !resourceTypes.isEmpty { trigger["resource-type"] = resourceTypes }
        if !loadTypes.isEmpty { trigger["load-type"] = loadTypes }
        if !ifDomain.isEmpty {
            trigger["if-domain"] = ifDomain
        } else if !unlessDomain.isEmpty {
            trigger["unless-domain"] = unlessDomain
        }
        var actionDict: [String: Any] = [:]
        switch action {
        case .block:
            actionDict["type"] = "block"
        case .ignorePreviousRules:
            actionDict["type"] = "ignore-previous-rules"
        case .cssDisplayNone(let selector):
            actionDict["type"] = "css-display-none"
            actionDict["selector"] = selector
        }
        return ["trigger": trigger, "action": actionDict]
    }
}

/// Luma Shield's converter: Adblock Plus / uBlock Origin filter text in,
/// WebKit content-blocker rules out. Pure, so it is unit-tested.
///
/// Supported: `||domain^`, plain host lines and hosts-file lines, path
/// patterns with `*`, `^` and `|` anchors, `$third-party`, resource types,
/// `$domain=`, `@@` exceptions and `##selector` element hiding. Everything
/// WebKit cannot express is skipped: regular-expression rules, scriptlets,
/// procedural selectors, `$redirect`, `$csp`, `$removeparam` and the like.
enum ShieldConverter {
    struct Output {
        var blocks: [ShieldRule] = []
        var exceptions: [ShieldRule] = []
        var cosmetics: [ShieldRule] = []
        /// Filter lines that could not be expressed.
        var skipped: Int = 0

        var ruleCount: Int { blocks.count + exceptions.count + cosmetics.count }
    }

    /// A list ready for `WKContentRuleListStore`.
    struct EncodedList {
        /// "net" for blocking rules, "cos" for element hiding.
        let kind: String
        let json: String
        let ruleCount: Int
    }

    /// WebKit accepts 150 000 rules per list; smaller lists compile faster
    /// and one that fails to compile costs less.
    static let defaultMaxRulesPerList = 50_000
    static let webKitRuleLimit = 150_000

    /// The last rule of every blocking list: pages themselves and frames of
    /// the same site always load. Filters without a type would otherwise
    /// also block opening a page whose address they match.
    static let documentGuard = ShieldRule(
        urlFilter: ".*",
        resourceTypes: ["document"],
        loadTypes: ["first-party"],
        action: .ignorePreviousRules
    )

    // MARK: - Text to rules

    static func convert(_ text: String) -> Output {
        convert([text])
    }

    /// Converts several filter lists into one de-duplicated set of rules.
    static func convert(_ texts: [String]) -> Output {
        var output = Output()
        var seen = Set<ShieldRule>()
        for text in texts {
            // Preprocessor state: one entry per open `!#if`.
            var conditions: [Bool] = []
            for rawLine in text.split(whereSeparator: { $0.isNewline }) {
                let line = rawLine.trimmingCharacters(in: .whitespaces)
                if line.hasPrefix("!#") {
                    if line.hasPrefix("!#if") {
                        conditions.append(evaluateCondition(String(line.dropFirst(4))))
                    } else if line.hasPrefix("!#else") {
                        if let last = conditions.popLast() { conditions.append(!last) }
                    } else if line.hasPrefix("!#endif") {
                        _ = conditions.popLast()
                    }
                    continue
                }
                if conditions.contains(false) { continue }
                if isIgnorable(line) { continue }
                let rules = convertLine(line)
                if rules.isEmpty {
                    output.skipped += 1
                    continue
                }
                for rule in rules where seen.insert(rule).inserted {
                    switch rule.action {
                    case .block: output.blocks.append(rule)
                    case .ignorePreviousRules: output.exceptions.append(rule)
                    case .cssDisplayNone: output.cosmetics.append(rule)
                    }
                }
            }
        }
        return output
    }

    /// The rules of one filter line; empty when it is a comment or cannot be
    /// expressed. A line may need two rules (see `urlFilters`).
    static func convertLine(_ rawLine: String) -> [ShieldRule] {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        if isIgnorable(line) { return [] }

        // Element hiding and the other "#…#" kinds.
        if let hash = line.firstIndex(of: "#") {
            let prefix = String(line[..<hash])
            let rest = line[hash...]
            if isDomainList(prefix) {
                if rest.hasPrefix("##") {
                    return cosmeticRules(domains: prefix, selector: String(rest.dropFirst(2)))
                }
                for marker in ["#@#", "#?#", "#$#", "#%#", "#@?#", "#$?#", "#@$#", "#@%#"] where rest.hasPrefix(marker) {
                    return []
                }
                // A comment of a hosts file.
                if prefix.isEmpty { return [] }
            }
        }
        return networkRules(line)
    }

    private static func isIgnorable(_ line: String) -> Bool {
        if line.isEmpty || line.hasPrefix("!") { return true }
        if line.hasPrefix("[") && line.hasSuffix("]") { return true }
        // Comments of hosts files.
        if line == "#" || line.hasPrefix("# ") { return true }
        return false
    }

    // MARK: - Element hiding

    /// Selector extensions of uBlock Origin and AdGuard that are not CSS.
    private static let proceduralMarkers = [
        ":has-text(", ":contains(", ":xpath(", ":matches-css", ":matches-attr(", ":matches-path(",
        ":matches-media(", ":matches-prop(", ":min-text-length(", ":upward(", ":nth-ancestor(",
        ":remove(", ":remove-attr(", ":remove-class(", ":style(", ":watch-attr(", ":others(",
        ":shadow(", ":if(", ":if-not(", ":-abp-", ":spath(",
    ]

    private static func cosmeticRules(domains: String, selector rawSelector: String) -> [ShieldRule] {
        guard let first = rawSelector.first, !first.isWhitespace else { return [] }
        let selector = rawSelector.trimmingCharacters(in: .whitespaces)
        if selector.isEmpty { return [] }
        // Scriptlets (+js), HTML filters (^) and CSS injection are not selectors.
        if selector.hasPrefix("+js") || selector.hasPrefix("^") { return [] }
        if selector.contains("{") || selector.contains("}") { return [] }
        let lower = selector.lowercased()
        for marker in proceduralMarkers where lower.contains(marker) { return [] }

        var rule = ShieldRule(urlFilter: ".*", action: .cssDisplayNone(selector))
        if !domains.isEmpty {
            var included: [String] = []
            var excluded: [String] = []
            for part in domains.split(separator: ",") {
                var name = part.lowercased()
                var negated = false
                if name.hasPrefix("~") {
                    negated = true
                    name.removeFirst()
                }
                // "example.*" (any TLD) has no counterpart in WebKit.
                guard isPlainDomain(name) else { return [] }
                if negated { excluded.append("*" + name) } else { included.append("*" + name) }
            }
            // WebKit takes if-domain or unless-domain, not both.
            if !included.isEmpty && !excluded.isEmpty { return [] }
            rule.ifDomain = included
            rule.unlessDomain = excluded
        }
        return [rule]
    }

    // MARK: - Network filters

    /// What a filter option means for WebKit's `resource-type`.
    private static let resourceTypeNames: [String: [String]] = [
        "script": ["script"],
        "image": ["image"],
        "img": ["image"],
        "stylesheet": ["style-sheet"],
        "css": ["style-sheet"],
        "font": ["font"],
        "media": ["media"],
        "xmlhttprequest": ["fetch"],
        "xhr": ["fetch"],
        "websocket": ["websocket"],
        "ping": ["ping"],
        "beacon": ["ping"],
        "other": ["other"],
        "popup": ["popup"],
        "subdocument": ["document"],
        "frame": ["document"],
        // No counterpart; a filter for these types alone is skipped.
        "object": [],
        "object-subrequest": [],
    ]

    /// Every type a filter with only negated types (`$~script`) still covers.
    private static let allResourceTypes = [
        "document", "image", "style-sheet", "script", "font", "media", "svg-document", "ping", "fetch",
        "websocket", "other",
    ]

    private static func networkRules(_ line: String) -> [ShieldRule] {
        var text = line
        var isException = false
        if text.hasPrefix("@@") {
            isException = true
            text.removeFirst(2)
        }
        if text.isEmpty { return [] }

        // Hosts files: "0.0.0.0 ads.example.com".
        if !isException {
            let fields = text.split(whereSeparator: { $0 == " " || $0 == "\t" })
            if fields.count >= 2, ["0.0.0.0", "127.0.0.1", "::", "::1"].contains(String(fields[0])) {
                let host = fields[1].lowercased()
                guard isPlainDomain(host), host.contains("."), host != "0.0.0.0" else { return [] }
                return hostRule(host)
            }
        }
        if text.contains(" ") || text.contains("\t") { return [] }

        // Regular-expression rules.
        if text.hasPrefix("/") && (text.hasSuffix("/") || text.contains("/$")) { return [] }

        // A bare host name, as in Peter Lowe's list.
        if !isException && isPlainDomain(text.lowercased()) && TopLevelDomains.hasKnownSuffix(text) {
            return hostRule(text.lowercased())
        }

        var pattern = text
        var options: [String] = []
        if let dollar = text.lastIndex(of: "$") {
            let tail = String(text[text.index(after: dollar)...])
            if looksLikeOptions(tail) {
                pattern = String(text[..<dollar])
                options = tail.split(separator: ",").map { String($0) }
            }
        }
        // A "$" left in the pattern belongs to an option we cannot read ($csp=…).
        if pattern.contains("$") { return [] }

        var loadTypes: [String] = []
        var includedTypes: [String] = []
        var excludedTypes: [String] = []
        var typesGiven = false
        var positiveTypeGiven = false
        var ifDomain: [String] = []
        var unlessDomain: [String] = []
        var caseSensitive = false
        var wholePage = false

        for rawOption in options {
            var option = rawOption.lowercased()
            var negated = false
            if option.hasPrefix("~") {
                negated = true
                option.removeFirst()
            }
            var name = option
            var value = ""
            if let eq = option.firstIndex(of: "=") {
                name = String(option[..<eq])
                value = String(option[option.index(after: eq)...])
            }
            switch name {
            case "third-party", "3p":
                loadTypes = [negated ? "first-party" : "third-party"]
            case "first-party", "1p":
                loadTypes = [negated ? "third-party" : "first-party"]
            case "match-case":
                caseSensitive = true
            case "important", "all":
                break
            case "document", "doc":
                if negated { break }
                if isException {
                    wholePage = true
                } else {
                    typesGiven = true
                    positiveTypeGiven = true
                    includedTypes.append("document")
                }
            case "domain", "from":
                if negated || value.isEmpty { return [] }
                for part in value.split(separator: "|") {
                    var domain = String(part)
                    var excluded = false
                    if domain.hasPrefix("~") {
                        excluded = true
                        domain.removeFirst()
                    }
                    guard isPlainDomain(domain) else { return [] }
                    if excluded { unlessDomain.append("*" + domain) } else { ifDomain.append("*" + domain) }
                }
            default:
                guard let mapped = resourceTypeNames[name], value.isEmpty else {
                    // $redirect, $csp, $removeparam, $badfilter, $denyallow, …
                    return []
                }
                typesGiven = true
                if negated {
                    excludedTypes.append(contentsOf: mapped)
                } else {
                    positiveTypeGiven = true
                    includedTypes.append(contentsOf: mapped)
                }
            }
        }

        // WebKit takes if-domain or unless-domain, not both. Blocking less is
        // the safe side for a block, allowing more for an exception.
        if !ifDomain.isEmpty && !unlessDomain.isEmpty {
            if !isException { return [] }
            unlessDomain = []
        }

        // "@@||example.com^$document": nothing is blocked on that site.
        if wholePage {
            guard !typesGiven, ifDomain.isEmpty, unlessDomain.isEmpty, pattern.hasPrefix("||") else { return [] }
            var host = String(pattern.dropFirst(2)).lowercased()
            if host.hasSuffix("^") { host.removeLast() }
            guard isPlainDomain(host), host.contains(".") else { return [] }
            return [ShieldRule(urlFilter: ".*", ifDomain: ["*" + host], action: .ignorePreviousRules)]
        }

        var resourceTypes: [String] = []
        if typesGiven {
            var source = includedTypes
            // Only types WebKit does not know ($object): nothing to match.
            if positiveTypeGiven && source.isEmpty { return [] }
            if source.isEmpty {
                source = allResourceTypes.filter({ !excludedTypes.contains($0) })
            }
            for type in source where !resourceTypes.contains(type) { resourceTypes.append(type) }
            if resourceTypes.isEmpty { return [] }
        }

        guard let filters = urlFilters(forPattern: pattern) else { return [] }
        // A pattern that matches about everything needs a site to apply to.
        let core = pattern.replacingOccurrences(of: "*", with: "").replacingOccurrences(of: "|", with: "")
            .replacingOccurrences(of: "^", with: "")
        if core.count < 3 && ifDomain.isEmpty && !isException { return [] }
        if core.isEmpty && ifDomain.isEmpty { return [] }

        return filters.map { filter in
            ShieldRule(
                urlFilter: filter,
                caseSensitive: caseSensitive,
                resourceTypes: resourceTypes,
                loadTypes: loadTypes,
                ifDomain: ifDomain,
                unlessDomain: unlessDomain,
                action: isException ? .ignorePreviousRules : .block
            )
        }
    }

    private static func hostRule(_ host: String) -> [ShieldRule] {
        guard let filters = urlFilters(forPattern: "||" + host + "^") else { return [] }
        return filters.map { ShieldRule(urlFilter: $0, action: .block) }
    }

    // MARK: - Patterns

    /// Start of a URL up to a host that is the pattern or a subdomain of it.
    static let hostAnchor = "^[^:]+://+([^:/]+\\.)?"
    /// The `^` of filter syntax: anything that cannot be part of a name.
    static let separator = "[^a-zA-Z0-9_.%-]"

    /// The filter pattern in WebKit's regular-expression subset; nil when it
    /// cannot be expressed. A pattern ending in `^` means "a separator or the
    /// end of the address": WebKit has no alternation, so that takes two
    /// rules — except after a host name, which is always followed by `:` or `/`.
    static func urlFilters(forPattern input: String) -> [String]? {
        var pattern = input
        // ASCII only, and nothing WebKit's parser trips over.
        for byte in pattern.utf8 where byte <= 0x20 || byte >= 0x7F { return nil }
        if pattern.contains("{") || pattern.contains("}") || pattern.contains("\\") { return nil }

        var prefix = ""
        var hostAnchored = false
        if pattern.hasPrefix("||") {
            hostAnchored = true
            prefix = hostAnchor
            pattern.removeFirst(2)
        } else if pattern.hasPrefix("|") {
            prefix = "^"
            pattern.removeFirst()
        }
        var suffix = ""
        if pattern.hasSuffix("|") {
            suffix = "$"
            pattern.removeLast()
        }
        if pattern.contains("|") { return nil }

        if prefix.isEmpty {
            while pattern.hasPrefix("*") { pattern.removeFirst() }
        } else if pattern.hasPrefix("*") {
            return nil
        }
        if suffix.isEmpty {
            while pattern.hasSuffix("*") { pattern.removeLast() }
        }
        if pattern.isEmpty {
            return prefix.isEmpty && suffix.isEmpty ? [".*"] : nil
        }

        let characters = Array(pattern)
        var body = ""
        var endsWithSeparator = false
        var lastWasWildcard = false
        for (i, character) in characters.enumerated() {
            var isWildcard = false
            switch character {
            case "*":
                isWildcard = true
                if !lastWasWildcard { body += ".*" }
            case "^":
                if i == characters.count - 1 && suffix.isEmpty {
                    endsWithSeparator = true
                } else {
                    body += separator
                }
            case ".", "+", "?", "$", "(", ")", "[", "]":
                body += "\\" + String(character)
            default:
                body.append(character)
            }
            lastWasWildcard = isWildcard
        }
        if body.isEmpty { return nil }

        if endsWithSeparator {
            let beforeSeparator = String(characters.dropLast())
            if hostAnchored && isPlainDomain(beforeSeparator.lowercased()) {
                return [prefix + body + "[:/]"]
            }
            return [prefix + body + separator, prefix + body + "$"]
        }
        return [prefix + body + suffix]
    }

    // MARK: - Lists for WebKit

    /// Blocking lists. Every list ends with all exceptions and the document
    /// guard: `ignore-previous-rules` only reaches rules before it in its own
    /// list, so exceptions come after the blocks and are repeated per list.
    static func networkLists(_ output: Output, maxRulesPerList: Int = defaultMaxRulesPerList) -> [[ShieldRule]] {
        guard !output.blocks.isEmpty else { return [] }
        let limit = min(max(maxRulesPerList, 2), webKitRuleLimit)
        // Leave room for blocks even with a huge set of exceptions.
        let exceptions = Array(output.exceptions.prefix(max(0, limit / 2 - 1)))
        let tail = exceptions + [documentGuard]
        let chunkSize = max(1, limit - tail.count)
        var lists: [[ShieldRule]] = []
        var start = 0
        while start < output.blocks.count {
            let end = min(start + chunkSize, output.blocks.count)
            lists.append(Array(output.blocks[start..<end]) + tail)
            start = end
        }
        return lists
    }

    /// Element-hiding lists. They are kept apart from the exceptions, which
    /// would otherwise also undo the hiding on a page they match.
    static func cosmeticLists(_ output: Output, maxRulesPerList: Int = defaultMaxRulesPerList) -> [[ShieldRule]] {
        let limit = min(max(maxRulesPerList, 1), webKitRuleLimit)
        var lists: [[ShieldRule]] = []
        var start = 0
        while start < output.cosmetics.count {
            let end = min(start + limit, output.cosmetics.count)
            lists.append(Array(output.cosmetics[start..<end]))
            start = end
        }
        return lists
    }

    /// The JSON text `WKContentRuleListStore` compiles.
    static func encode(_ rules: [ShieldRule]) -> String {
        let objects = rules.map { $0.dictionary }
        guard let data = try? JSONSerialization.data(withJSONObject: objects, options: [.withoutEscapingSlashes]) else {
            return "[]"
        }
        return String(decoding: data, as: UTF8.self)
    }

    /// Filter texts to encoded lists, plus the number of distinct rules.
    static func encodedLists(
        from texts: [String],
        maxRulesPerList: Int = defaultMaxRulesPerList
    ) -> (lists: [EncodedList], ruleCount: Int) {
        let output = convert(texts)
        var lists: [EncodedList] = []
        for rules in networkLists(output, maxRulesPerList: maxRulesPerList) {
            lists.append(EncodedList(kind: "net", json: encode(rules), ruleCount: rules.count))
        }
        for rules in cosmeticLists(output, maxRulesPerList: maxRulesPerList) {
            lists.append(EncodedList(kind: "cos", json: encode(rules), ruleCount: rules.count))
        }
        return (lists, output.ruleCount)
    }

    // MARK: - Small helpers

    /// `!#if` conditions of uBlock Origin's lists: Luma on iOS counts as
    /// uBlock-compatible, Safari-like and mobile.
    static func evaluateCondition(_ condition: String) -> Bool {
        let trueTokens: Set<String> = ["ext_ublock", "env_safari", "env_mobile", "true"]
        let cleaned = condition.replacingOccurrences(of: "(", with: "").replacingOccurrences(of: ")", with: "")
        for alternative in cleaned.components(separatedBy: "||") {
            var allTrue = true
            for rawTerm in alternative.components(separatedBy: "&&") {
                var term = rawTerm.trimmingCharacters(in: .whitespaces)
                var negated = false
                while term.hasPrefix("!") {
                    negated.toggle()
                    term.removeFirst()
                    term = term.trimmingCharacters(in: .whitespaces)
                }
                let value = trueTokens.contains(term)
                if value == negated {
                    allTrue = false
                    break
                }
            }
            if allTrue { return true }
        }
        return false
    }

    /// "example.com,~sub.example.com" in front of "##": only names, commas and "~".
    private static func isDomainList(_ text: String) -> Bool {
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 48...57, 65...90, 97...122: continue
            case 0x2E, 0x2C, 0x7E, 0x2A, 0x2D, 0x5F: continue   // . , ~ * - _
            default: return false
            }
        }
        return true
    }

    /// A lower-case ASCII host name without wildcards.
    static func isPlainDomain(_ text: String) -> Bool {
        if text.isEmpty || text.hasPrefix(".") || text.hasSuffix(".") || text.hasPrefix("-") { return false }
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 48...57, 97...122: continue
            case 0x2E, 0x2D, 0x5F: continue   // . - _
            default: return false
            }
        }
        return true
    }

    /// Whether the text after the last "$" is a list of filter options.
    private static func looksLikeOptions(_ text: String) -> Bool {
        guard let first = text.unicodeScalars.first else { return false }
        // "3p" and "1p" start with a digit.
        let startsRight = (first.value >= 48 && first.value <= 57) || (first.value >= 65 && first.value <= 90)
            || (first.value >= 97 && first.value <= 122) || first == "~" || first == "_"
        if !startsRight { return false }
        for scalar in text.unicodeScalars {
            switch scalar.value {
            case 48...57, 65...90, 97...122: continue
            case 0x2C, 0x7E, 0x3D, 0x7C, 0x2E, 0x2D, 0x5F, 0x2A: continue   // , ~ = | . - _ *
            default: return false
            }
        }
        return true
    }
}
