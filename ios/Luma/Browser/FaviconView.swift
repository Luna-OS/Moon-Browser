import CryptoKit
import SwiftUI
import UIKit

/// Site icon for a page URL: cached favicon, or a letter tile until / unless one is available.
struct FaviconView: View {
    private let host: String?
    private let scheme: String
    private let size: CGFloat
    @State private var image: UIImage?

    init(url: String, size: CGFloat = 20) {
        let parsed = URL(string: url)
        let parsedScheme = (parsed?.scheme ?? "").lowercased()
        if let parsedHost = parsed?.host?.lowercased(), !parsedHost.isEmpty,
           parsedScheme == "http" || parsedScheme == "https" {
            self.host = parsedHost
            self.scheme = parsedScheme
        } else {
            self.host = nil
            self.scheme = "https"
        }
        self.size = size
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
            } else {
                letterTile
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
        .accessibilityHidden(true)
        .task(id: host ?? "") {
            await refresh()
        }
        .onReceive(NotificationCenter.default.publisher(for: BrowserFaviconCache.didUpdate)) { note in
            guard let host, let updated = note.object as? String, updated == host else { return }
            image = BrowserFaviconCache.shared.memoryImage(forHost: host)
        }
    }

    private var letterTile: some View {
        ZStack {
            Color.lumaSelected
            if let letter = FaviconView.letter(for: host) {
                Text(letter)
                    .font(.system(size: size * 0.55, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.lumaText)
            } else {
                Image(systemName: "globe")
                    .font(.system(size: size * 0.6))
                    .foregroundStyle(Color.lumaTextMuted)
            }
        }
    }

    private func refresh() async {
        guard let host else {
            image = nil
            return
        }
        if let cached = BrowserFaviconCache.shared.memoryImage(forHost: host) {
            image = cached
            return
        }
        image = nil
        let loaded = await BrowserFaviconCache.shared.image(forHost: host, scheme: scheme)
        if !Task.isCancelled {
            image = loaded
        }
    }

    private static func letter(for host: String?) -> String? {
        guard var name = host else { return nil }
        if name.hasPrefix("www.") { name = String(name.dropFirst(4)) }
        guard let first = name.first(where: { $0.isLetter || $0.isNumber }) else { return nil }
        return String(first).uppercased()
    }
}

/// Favicon loader with a memory cache and a small disk cache (Caches/Luma/Favicons).
/// Icons are fetched straight from the site — no third-party favicon service.
@MainActor
final class BrowserFaviconCache {
    static let shared = BrowserFaviconCache()
    /// Posted with the host (String) as `object` when an icon for it became available.
    static let didUpdate = Notification.Name("LumaBrowserFaviconCacheDidUpdate")

    private let memory = NSCache<NSString, UIImage>()
    private var misses: [String: Date] = [:]
    private var inFlight: [String: Task<UIImage?, Never>] = [:]
    /// Hosts seen in private tabs: their icons stay in memory only.
    private var privateHosts = Set<String>()
    private let session: URLSession

    private init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 15
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        session = URLSession(configuration: configuration)
        memory.countLimit = 300
    }

    func memoryImage(forHost host: String) -> UIImage? {
        memory.object(forKey: host.lowercased() as NSString)
    }

    func hasImage(forHost host: String) -> Bool {
        memoryImage(forHost: host) != nil
    }

    func markPrivate(host: String) {
        let key = host.lowercased()
        // A host that already has an icon on disk reveals nothing new.
        if memoryImage(forHost: key) == nil {
            privateHosts.insert(key)
        }
    }

    func image(forHost rawHost: String, scheme: String) async -> UIImage? {
        let host = rawHost.lowercased()
        if let cached = memoryImage(forHost: host) { return cached }
        if let running = inFlight[host] { return await running.value }
        if let missedAt = misses[host], Date().timeIntervalSince(missedAt) < 600 { return nil }

        let diskURL = BrowserFaviconCache.diskURL(forHost: host)
        let persist = !privateHosts.contains(host)
        let session = self.session
        let task = Task<UIImage?, Never> {
            if let diskURL, let data = await BrowserFaviconCache.readFile(diskURL), let image = UIImage(data: data) {
                return image
            }
            let candidates = [
                URL(string: "\(scheme)://\(host)/apple-touch-icon.png"),
                URL(string: "\(scheme)://\(host)/favicon.ico")
            ].compactMap { $0 }
            for candidate in candidates {
                if let data = await BrowserFaviconCache.fetch(candidate, session: session), let image = UIImage(data: data) {
                    if persist, let diskURL { BrowserFaviconCache.writeFile(data, to: diskURL) }
                    return image
                }
            }
            return nil
        }
        inFlight[host] = task
        let result = await task.value
        inFlight[host] = nil
        if let result {
            memory.setObject(result, forKey: host as NSString)
        } else if memoryImage(forHost: host) == nil {
            misses[host] = Date()
        }
        return result ?? memoryImage(forHost: host)
    }

    /// The page told us where its icon lives (`<link rel="icon">`); used when nothing is cached yet.
    func offer(iconURL: URL, forHost rawHost: String) {
        let host = rawHost.lowercased()
        let scheme = (iconURL.scheme ?? "").lowercased()
        guard scheme == "http" || scheme == "https", memoryImage(forHost: host) == nil else { return }
        let diskURL = BrowserFaviconCache.diskURL(forHost: host)
        let persist = !privateHosts.contains(host)
        let session = self.session
        Task { @MainActor [weak self] in
            guard let data = await BrowserFaviconCache.fetch(iconURL, session: session),
                  let image = UIImage(data: data), let self else { return }
            if persist, let diskURL { BrowserFaviconCache.writeFile(data, to: diskURL) }
            self.memory.setObject(image, forKey: host as NSString)
            self.misses[host] = nil
            NotificationCenter.default.post(name: BrowserFaviconCache.didUpdate, object: host)
        }
    }

    func clear() {
        memory.removeAllObjects()
        misses.removeAll()
        privateHosts.removeAll()
        if let directory = BrowserFaviconCache.directory() {
            try? FileManager.default.removeItem(at: directory)
        }
    }

    // MARK: - Files and network (off the main actor)

    private nonisolated static func directory() -> URL? {
        guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        return base.appendingPathComponent("Luma", isDirectory: true).appendingPathComponent("Favicons", isDirectory: true)
    }

    private nonisolated static func diskURL(forHost host: String) -> URL? {
        guard let directory = directory() else { return nil }
        let digest = SHA256.hash(data: Data(host.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name)
    }

    private nonisolated static func readFile(_ url: URL) async -> Data? {
        await Task.detached(priority: .utility) {
            try? Data(contentsOf: url)
        }.value
    }

    private nonisolated static func writeFile(_ data: Data, to url: URL) {
        Task.detached(priority: .utility) {
            let directory = url.deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try? data.write(to: url, options: [.atomic])
        }
    }

    private nonisolated static func fetch(_ url: URL, session: URLSession) async -> Data? {
        var request = URLRequest(url: url)
        request.setValue("image/*,*/*;q=0.5", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              !data.isEmpty, data.count < 2_000_000 else { return nil }
        return data
    }
}
