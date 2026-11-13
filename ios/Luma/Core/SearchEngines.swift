import Foundation

/// A search engine of the address bar. `searchURL` contains `%s` for the query.
struct SearchEngine: Identifiable, Hashable {
    let id: String
    let name: String
    let searchURL: String
    let home: String
}

/// Ported from the desktop app (`src/shared/engines.ts`).
enum SearchEngines {
    /// Perplexity is the default: answers instead of a list of links. The
    /// private engines follow; the big two stay available by choice.
    static let all: [SearchEngine] = [
        SearchEngine(id: "perplexity", name: "Perplexity",
                     searchURL: "https://www.perplexity.ai/search?q=%s", home: "https://www.perplexity.ai/"),
        SearchEngine(id: "duckduckgo", name: "DuckDuckGo",
                     searchURL: "https://duckduckgo.com/?q=%s", home: "https://duckduckgo.com/"),
        SearchEngine(id: "startpage", name: "Startpage",
                     searchURL: "https://www.startpage.com/sp/search?query=%s", home: "https://www.startpage.com/"),
        SearchEngine(id: "brave", name: "Brave Search",
                     searchURL: "https://search.brave.com/search?q=%s", home: "https://search.brave.com/"),
        SearchEngine(id: "kagi", name: "Kagi",
                     searchURL: "https://kagi.com/search?q=%s", home: "https://kagi.com/"),
        SearchEngine(id: "ecosia", name: "Ecosia",
                     searchURL: "https://www.ecosia.org/search?q=%s", home: "https://www.ecosia.org/"),
        SearchEngine(id: "qwant", name: "Qwant",
                     searchURL: "https://www.qwant.com/?q=%s", home: "https://www.qwant.com/"),
        SearchEngine(id: "google", name: "Google",
                     searchURL: "https://www.google.com/search?q=%s", home: "https://www.google.com/"),
        SearchEngine(id: "bing", name: "Bing",
                     searchURL: "https://www.bing.com/search?q=%s", home: "https://www.bing.com/"),
    ]

    static let `default`: SearchEngine = SearchEngines.all[0]

    /// A custom search URL must be http(s) and contain the `%s` placeholder.
    static func isValidCustomSearchURL(_ s: String) -> Bool {
        let text = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.contains("%s") else { return false }
        if text.contains(" ") { return false }
        guard let comps = URLComponents(string: replacingFirstPlaceholder(in: text, with: "test")) else { return false }
        guard let scheme = comps.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return false }
        guard let host = comps.host, !host.isEmpty else { return false }
        return true
    }

    static func resolve(id: String, customSearchURL: String) -> SearchEngine {
        if id == "custom" {
            let custom = customSearchURL.trimmingCharacters(in: .whitespacesAndNewlines)
            guard isValidCustomSearchURL(custom), let home = origin(of: custom) else { return SearchEngines.default }
            var name = "Custom search"
            if let host = URLComponents(string: home)?.host, !host.isEmpty {
                name = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
            }
            return SearchEngine(id: "custom", name: name, searchURL: custom, home: home)
        }
        return all.first(where: { $0.id == id }) ?? SearchEngines.default
    }

    /// The results page for a query; an empty query goes to the engine's home.
    static func searchURL(engine: SearchEngine, query: String) -> URL? {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return URL(string: engine.home) }
        return URL(string: fillTemplate(engine.searchURL, query: q))
    }

    // MARK: - Helpers (also used by bangs)

    /// Replaces the first `%s` by the encoded query (spaces become `+`).
    static func fillTemplate(_ template: String, query: String) -> String {
        replacingFirstPlaceholder(in: template, with: encodeQuery(query))
    }

    /// Like JavaScript's `encodeURIComponent`, with `+` for spaces.
    static func encodeQuery(_ query: String) -> String {
        var allowed = CharacterSet()
        allowed.insert(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        let encoded = query.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        return encoded.replacingOccurrences(of: "%20", with: "+")
    }

    /// "https://www.example.com/search?q=%s" -> "https://www.example.com/"
    static func origin(of template: String) -> String? {
        let cleaned = replacingFirstPlaceholder(in: template, with: "")
        guard let comps = URLComponents(string: cleaned),
              let scheme = comps.scheme?.lowercased(),
              let host = comps.host, !host.isEmpty else { return nil }
        var result = scheme + "://" + host.lowercased()
        if let port = comps.port { result += ":\(port)" }
        return result + "/"
    }

    private static func replacingFirstPlaceholder(in template: String, with value: String) -> String {
        guard let range = template.range(of: "%s") else { return template }
        return template.replacingCharacters(in: range, with: value)
    }
}
