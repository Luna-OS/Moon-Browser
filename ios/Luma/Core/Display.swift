import Foundation

/// How addresses are shown in compact places. Ported from the desktop app
/// (`src/shared/display.ts`).
enum Display {
    /// Hostname without "www." for compact labels:
    /// "https://www.example.com/x" -> "example.com".
    static func shortHost(_ url: String) -> String {
        let text = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let comps = URLComponents(string: text) else { return text }
        if comps.scheme?.lowercased() == "file" { return "file" }
        guard let host = comps.host, !host.isEmpty else { return text }
        let lower = host.lowercased()
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }

    /// The address without scheme and trailing slash, for lists:
    /// "https://example.com/" -> "example.com", "https://example.com/a?b" -> "example.com/a?b".
    static func prettyURL(_ url: String) -> String {
        let text = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let comps = URLComponents(string: text),
              let scheme = comps.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = comps.host, !host.isEmpty else { return text }
        var result = host.lowercased()
        if let port = comps.port { result += ":\(port)" }
        result += comps.percentEncodedPath
        if let query = comps.percentEncodedQuery, !query.isEmpty { result += "?" + query }
        if let fragment = comps.percentEncodedFragment, !fragment.isEmpty { result += "#" + fragment }
        while result.hasSuffix("/") { result.removeLast() }
        return result
    }
}
