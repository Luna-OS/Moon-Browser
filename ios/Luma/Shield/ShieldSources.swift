import Foundation

/// The filter lists of Luma Shield — the same as the desktop app's
/// (`src/main/adblock-config.ts`): uBlock Origin's own lists plus EasyList,
/// EasyPrivacy and Peter Lowe's list, without "acceptable ads" exceptions.
/// They are fetched from the Ghostery adblocker's mirror of the upstream lists.
enum ShieldSources {
    private static let mirror = "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets"

    private static let mainPaths = [
        "ublock-origin/filters.txt",
        "ublock-origin/filters-2020.txt",
        "ublock-origin/filters-2021.txt",
        "ublock-origin/filters-2022.txt",
        "ublock-origin/filters-2023.txt",
        "ublock-origin/filters-2024.txt",
        "ublock-origin/privacy.txt",
        "ublock-origin/badware.txt",
        "ublock-origin/resource-abuse.txt",
        "ublock-origin/quick-fixes.txt",
        "ublock-origin/unbreak.txt",
        "easylist/easylist.txt",
        "easylist/easyprivacy.txt",
        "peter-lowe/serverlist.txt",
    ]

    /// Cookie notices and other annoyances; only with the setting on.
    private static let annoyancePaths = [
        "easylist/easylist-cookie.txt",
        "ublock-origin/annoyances-cookies.txt",
        "ublock-origin/annoyances-others.txt",
    ]

    static var mainURLs: [URL] { urls(mainPaths) }
    static var annoyanceURLs: [URL] { urls(annoyancePaths) }

    /// Luma's own fixes, after the lists (as on the desktop).
    static let lumaFixes = [
        // Netflix's player stops with an error when its own logging requests fail.
        "@@||netflix.com/log/$xhr,ping,other",
        "@@||logs.netflix.com^$xhr,ping,other",
        "@@||netflix.com/ichnaea/log$xhr,ping,other",
        "@@||netflix.com/msl/playapi/cadmium/logblob/$xhr,ping,other",
    ].joined(separator: "\n")

    private static func urls(_ paths: [String]) -> [URL] {
        paths.compactMap { URL(string: mirror + "/" + $0) }
    }

    /// Downloads the lists side by side; the ones that fail are left out.
    static func download(_ urls: [URL]) async -> [String] {
        await withTaskGroup(of: (Int, String?).self) { group -> [String] in
            for (index, url) in urls.enumerated() {
                group.addTask {
                    (index, await fetch(url))
                }
            }
            var results = [String?](repeating: nil, count: urls.count)
            for await (index, text) in group {
                results[index] = text
            }
            return results.compactMap { $0 }
        }
    }

    private static func fetch(_ url: URL) async -> String? {
        var request = URLRequest(url: url)
        request.timeoutInterval = 45
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            return String(data: data, encoding: .utf8)
        } catch {
            return nil
        }
    }
}
