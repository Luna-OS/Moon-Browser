import Foundation

/// Where Luma keeps its files: Application Support/Luma/.
enum CoreStorage {
    static func directory() -> URL {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.temporaryDirectory
        let dir = base.appendingPathComponent("Luma", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: nil)
        }
        return dir
    }

    static func fileURL(_ name: String) -> URL {
        directory().appendingPathComponent(name, isDirectory: false)
    }

    static func load<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    @discardableResult
    static func save<T: Encodable>(_ value: T, to url: URL) -> Bool {
        guard let data = try? JSONEncoder().encode(value) else { return false }
        let parent = url.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: parent.path) {
            try? FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true, attributes: nil)
        }
        do {
            try data.write(to: url, options: [.atomic])
            return true
        } catch {
            return false
        }
    }

    /// Lower-cased and without accents, so "cafe" finds "Café".
    static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }

    /// The words of a search query, folded.
    static func tokens(_ query: String) -> [String] {
        fold(query).split(whereSeparator: { $0.isWhitespace }).map { String($0) }
    }
}
