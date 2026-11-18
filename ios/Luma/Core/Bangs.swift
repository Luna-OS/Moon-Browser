import Foundation

/// Bangs — shortcuts that search a site directly from the address bar. They
/// are resolved locally, so `!w moon` goes straight to Wikipedia.
///
///     !w moon      searches Wikipedia for "moon"
///     moon !w      the same (the bang may also come last)
///     !gh          opens GitHub itself (a bang without a query)
struct Bang: Hashable {
    let trigger: String
    let name: String
    /// Search URL with `%s` for the query.
    let url: String
    /// Where the bang goes without a query.
    let home: String
}

struct BangMatch: Equatable {
    let bang: Bang
    let query: String
}

/// Ported from the desktop app (`src/shared/bangs.ts`).
enum Bangs {
    private static func make(_ trigger: String, _ name: String, _ url: String, home: String? = nil) -> Bang {
        Bang(trigger: trigger, name: name, url: url, home: home ?? SearchEngines.origin(of: url) ?? url)
    }

    static let all: [Bang] = [
        // Search engines
        make("p", "Perplexity", "https://www.perplexity.ai/search?q=%s"),
        make("pplx", "Perplexity", "https://www.perplexity.ai/search?q=%s"),
        make("ddg", "DuckDuckGo", "https://duckduckgo.com/?q=%s"),
        make("sp", "Startpage", "https://www.startpage.com/sp/search?query=%s"),
        make("brave", "Brave Search", "https://search.brave.com/search?q=%s"),
        make("kagi", "Kagi", "https://kagi.com/search?q=%s"),
        make("ec", "Ecosia", "https://www.ecosia.org/search?q=%s"),
        make("qw", "Qwant", "https://www.qwant.com/?q=%s"),
        make("g", "Google", "https://www.google.com/search?q=%s"),
        make("gi", "Google Images", "https://www.google.com/search?tbm=isch&q=%s"),
        make("gn", "Google News", "https://news.google.com/search?q=%s"),
        make("b", "Bing", "https://www.bing.com/search?q=%s"),
        make("yandex", "Yandex", "https://yandex.com/search/?text=%s"),

        // Knowledge
        make("w", "Wikipedia", "https://en.wikipedia.org/w/index.php?search=%s"),
        make("wde", "Wikipedia (Deutsch)", "https://de.wikipedia.org/w/index.php?search=%s"),
        make("wt", "Wiktionary", "https://en.wiktionary.org/w/index.php?search=%s"),
        make("wa", "Wolfram Alpha", "https://www.wolframalpha.com/input?i=%s"),
        make("dict", "Merriam-Webster", "https://www.merriam-webster.com/dictionary/%s"),
        make("leo", "LEO", "https://dict.leo.org/englisch-deutsch/%s"),
        make("dcc", "dict.cc", "https://www.dict.cc/?s=%s"),
        make("deepl", "DeepL", "https://www.deepl.com/translator#auto/auto/%s"),
        make("wb", "Wayback Machine", "https://web.archive.org/web/*/%s"),
        make("arxiv", "arXiv", "https://arxiv.org/search/?query=%s&searchtype=all"),
        make("scholar", "Google Scholar", "https://scholar.google.com/scholar?q=%s"),

        // Maps & travel
        make("osm", "OpenStreetMap", "https://www.openstreetmap.org/search?query=%s"),
        make("maps", "Google Maps", "https://www.google.com/maps/search/%s"),
        make("gm", "Google Maps", "https://www.google.com/maps/search/%s"),

        // Video, music & social
        make("yt", "YouTube", "https://www.youtube.com/results?search_query=%s"),
        make("twitch", "Twitch", "https://www.twitch.tv/search?term=%s"),
        make("r", "Reddit", "https://www.reddit.com/search/?q=%s"),
        make("x", "X", "https://x.com/search?q=%s"),
        make("bsky", "Bluesky", "https://bsky.app/search?q=%s"),
        make("mastodon", "Mastodon", "https://mastodon.social/search?q=%s"),
        make("spotify", "Spotify", "https://open.spotify.com/search/%s"),
        make("sc", "SoundCloud", "https://soundcloud.com/search?q=%s"),
        make("genius", "Genius", "https://genius.com/search?q=%s"),
        make("imdb", "IMDb", "https://www.imdb.com/find/?q=%s"),
        make("lb", "Letterboxd", "https://letterboxd.com/search/%s/"),
        make("hn", "Hacker News", "https://hn.algolia.com/?q=%s", home: "https://news.ycombinator.com/"),

        // Shopping
        make("a", "Amazon", "https://www.amazon.com/s?k=%s"),
        make("ade", "Amazon.de", "https://www.amazon.de/s?k=%s"),
        make("e", "eBay", "https://www.ebay.com/sch/i.html?_nkw=%s"),
        make("ede", "eBay.de", "https://www.ebay.de/sch/i.html?_nkw=%s"),
        make("idealo", "idealo", "https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=%s"),

        // Developers
        make("gh", "GitHub", "https://github.com/search?q=%s&type=repositories"),
        make("gl", "GitLab", "https://gitlab.com/search?search=%s"),
        make("so", "Stack Overflow", "https://stackoverflow.com/search?q=%s"),
        make("mdn", "MDN Web Docs", "https://developer.mozilla.org/search?q=%s"),
        make("caniuse", "Can I use", "https://caniuse.com/?search=%s"),
        make("npm", "npm", "https://www.npmjs.com/search?q=%s"),
        make("pypi", "PyPI", "https://pypi.org/search/?q=%s"),
        make("crates", "crates.io", "https://crates.io/search?q=%s"),
        make("docsrs", "Docs.rs", "https://docs.rs/releases/search?query=%s"),
        make("py", "Python docs", "https://docs.python.org/3/search.html?q=%s"),
        make("rust", "Rust std docs", "https://doc.rust-lang.org/std/?search=%s"),
        make("go", "Go packages", "https://pkg.go.dev/search?q=%s"),
        make("dh", "Docker Hub", "https://hub.docker.com/search?q=%s"),
        make("aw", "ArchWiki", "https://wiki.archlinux.org/index.php?search=%s"),
        make("aur", "AUR", "https://aur.archlinux.org/packages?K=%s"),
        make("flathub", "Flathub", "https://flathub.org/apps/search?q=%s"),
    ]

    private static let byTrigger: [String: Bang] = {
        var map: [String: Bang] = [:]
        for bang in Bangs.all { map[bang.trigger] = bang }
        return map
    }()

    static func find(trigger: String) -> Bang? {
        byTrigger[trigger.lowercased()]
    }

    /// Finds a `!bang` at the start or the end of the input.
    static func match(_ input: String) -> BangMatch? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.contains("!") else { return nil }
        let words = text.split(whereSeparator: { $0.isWhitespace }).map { String($0) }
        guard !words.isEmpty else { return nil }
        let candidates = [0, words.count - 1]
        for index in candidates {
            let word = words[index]
            guard word.hasPrefix("!"), word.count > 1 else { continue }
            let trigger = String(word.dropFirst())
            guard trigger.unicodeScalars.allSatisfy({ isASCIIAlphanumeric($0) }) else { continue }
            guard let found = find(trigger: trigger) else { continue }
            var rest: [String] = []
            for (i, w) in words.enumerated() where i != index { rest.append(w) }
            return BangMatch(bang: found, query: rest.joined(separator: " "))
        }
        return nil
    }

    static func url(for match: BangMatch) -> URL? {
        if match.query.isEmpty { return URL(string: match.bang.home) }
        return URL(string: SearchEngines.fillTemplate(match.bang.url, query: match.query))
    }

    private static func isASCIIAlphanumeric(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 48...57, 65...90, 97...122: return true
        default: return false
        }
    }
}
