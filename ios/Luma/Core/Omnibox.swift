import Foundation

/// What the address bar input turned into.
enum OmniboxResult: Equatable {
    case url(URL)
    case search(URL, query: String)
    case bang(URL, query: String, name: String)

    var destination: URL {
        switch self {
        case .url(let value): return value
        case .search(let value, _): return value
        case .bang(let value, _, _): return value
        }
    }
}

/// Turns what was typed into the address bar into an address: a URL to open,
/// a bang, or a search with the chosen engine. Pure, so it is unit-tested.
/// Ported from the desktop app (`src/shared/omnibox.ts`); there are no
/// `moon://` pages on iOS.
enum Omnibox {
    /// Hostnames that are local by design and have no public suffix.
    private static let localSuffixes = [".localhost", ".local", ".lan", ".home", ".internal", ".home.arpa", ".test"]

    static func resolve(_ input: String, engine: SearchEngine, bangs: Bool) -> OmniboxResult? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }

        if bangs, let match = Bangs.match(text), let url = Bangs.url(for: match) {
            return .bang(url, query: match.query, name: match.bang.name)
        }

        if let explicit = explicitURL(text) { return .url(explicit) }
        if let guessed = guessURL(text) { return .url(guessed) }

        if let url = SearchEngines.searchURL(engine: engine, query: text) {
            return .search(url, query: text)
        }
        if let url = SearchEngines.searchURL(engine: SearchEngines.default, query: text) {
            return .search(url, query: text)
        }
        return nil
    }

    /// Input that already carries a scheme we open: http://… or https://…
    private static func explicitURL(_ text: String) -> URL? {
        if containsWhitespace(text) { return nil }
        if text.lowercased() == "about:blank" { return URL(string: "about:blank") }
        guard let colon = text.firstIndex(of: ":") else { return nil }
        let scheme = text[..<colon].lowercased()
        guard scheme == "http" || scheme == "https" else { return nil }
        // "localhost:3000" parses with "localhost:" as scheme — that is a host.
        let rest = text[text.index(after: colon)...]
        guard rest.hasPrefix("//") else { return nil }
        guard let url = URL(string: text), let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    /// Input without a scheme that looks like an address: example.com, localhost:3000/x …
    private static func guessURL(_ text: String) -> URL? {
        if containsWhitespace(text) { return nil }
        // Things like "c++" or "user@example.com" are searches, not hosts.
        let hostLike = matches(#"^[\p{L}\p{N}_.-]+(:\d{1,5})?([/?#].*)?$"#, text)
        let ipv6Like = matches(#"^\[[0-9a-fA-F:]+\](:\d{1,5})?([/?#].*)?$"#, text)
        if !hostLike && !ipv6Like { return nil }

        // Classify by the host as typed: a URL parser would read "3.14" as an
        // IPv4 address, but typed, it is a number to search for.
        let rawHost: String
        if ipv6Like, let close = text.firstIndex(of: "]") {
            rawHost = String(text[...close])
        } else if let end = text.firstIndex(where: { $0 == ":" || $0 == "/" || $0 == "?" || $0 == "#" }) {
            rawHost = String(text[..<end])
        } else {
            rawHost = text
        }
        var host = rawHost.lowercased()
        if host.hasSuffix(".") { host.removeLast() }
        if host.isEmpty { return nil }
        let afterHost = String(text.dropFirst(rawHost.count))
        let hasPathOrPort = matches(#"^(:\d+|[/?#])"#, afterHost)
        let numeric = host.unicodeScalars.allSatisfy { ($0.value >= 48 && $0.value <= 57) || $0 == "." }
        if numeric && !isIPAddress(host) { return nil }

        guard let url = URL(string: "http://" + text), let parsedHost = url.host, !parsedHost.isEmpty else {
            return nil
        }

        if host == "localhost" || isIPAddress(host) || localSuffixes.contains(where: { host.hasSuffix($0) }) {
            return url
        }
        if !host.contains(".") {
            // A single word is a search unless it clearly is an intranet host
            // ("router/", "nas:5000").
            return matches(#"^(:\d+|/)"#, afterHost) ? url : nil
        }
        if TopLevelDomains.hasKnownSuffix(host) { return url }
        // Unknown suffix: only an address if it has a port or a path (e.g. "nas.box:5000").
        return hasPathOrPort ? url : nil
    }

    static func isIPAddress(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        if parts.count == 4 {
            let valid = parts.allSatisfy { part -> Bool in
                guard !part.isEmpty, part.count <= 3 else { return false }
                guard part.unicodeScalars.allSatisfy({ $0.value >= 48 && $0.value <= 57 }) else { return false }
                guard let n = Int(part) else { return false }
                return n <= 255
            }
            if valid { return true }
        }
        return host.hasPrefix("[") && host.hasSuffix("]")
    }

    private static func containsWhitespace(_ text: String) -> Bool {
        text.contains(where: { $0.isWhitespace })
    }

    private static func matches(_ pattern: String, _ text: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return false }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.firstMatch(in: text, options: [], range: range) != nil
    }
}

/// Stands in for the public-suffix list the desktop app uses (tldts): every
/// country-code TLD plus the generic ones people actually type.
enum TopLevelDomains {
    static func isKnown(_ tld: String) -> Bool {
        let label = tld.lowercased()
        if label.hasPrefix("xn--") && label.count > 4 { return true }
        return known.contains(label)
    }

    /// Whether the host ends in a known top-level domain.
    static func hasKnownSuffix(_ host: String) -> Bool {
        var name = host.lowercased()
        if name.hasSuffix(".") { name.removeLast() }
        guard let dot = name.lastIndex(of: ".") else { return false }
        let tld = String(name[name.index(after: dot)...])
        return !tld.isEmpty && isKnown(tld)
    }

    private static let countryCodes = """
    ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz \
    ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk \
    fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir \
    is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk \
    ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl \
    pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc \
    td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw
    """

    private static let generic = """
    com org net edu gov mil int info biz name pro mobi asia tel travel jobs cat coop aero museum xxx post arpa \
    app dev page blog cloud online site store shop tech xyz top club live news email wiki world today life \
    space fun art design studio agency digital media network systems solutions company group games game social \
    video chat codes code software tools zone link click one works work run services support team house global \
    plus guru ninja rocks cool wtf lol earth eco bio green love moe icu vip best win bid cafe bar pub pizza \
    photo photos pics gallery graphics audio music film movie show health care fit yoga school academy \
    university college education science institute foundation church community center city town berlin hamburg \
    koeln cologne bayern nrw ruhr saarland wien swiss paris london nyc tokyo amsterdam brussels africa quebec \
    scot wales irish gmbh ltd llc inc bank finance money fund capital exchange market markets trade cash tax law \
    legal consulting ventures holdings partners engineering computer hosting domains directory events tickets \
    fyi how new google youtube apple microsoft amazon bot foo day dad zip mov nexus sbs cfd lat buzz monster \
    rest bond cyou press reviews review guide expert help farm garden kitchen recipes food coffee beer wine \
    fashion style clothing shoes toys kids baby family dog pet pets fish bike car cars auto taxi tours flights \
    hotel holiday vacations land estate homes immo property rent sale deals discount gift gifts luxury gold \
    energy solar build construction industries international institute training careers jobs security \
    protection download stream radio fm tv pictures camera express delivery contact here now mom red blue \
    pink black kim onl ooo
    """

    private static let internationalized = ["рф", "укр", "бел", "срб", "中国", "中國", "香港", "台灣", "台湾", "한국", "ไทย", "ελ"]

    private static let known: Set<String> = {
        var set = Set<String>()
        for chunk in [countryCodes, generic] {
            for label in chunk.split(whereSeparator: { $0 == " " || $0 == "\n" }) {
                set.insert(String(label))
            }
        }
        for label in internationalized { set.insert(label) }
        return set
    }()
}
