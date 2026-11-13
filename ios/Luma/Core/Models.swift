import Foundation

/// The plain data the areas of the app pass around.

struct Bookmark: Identifiable, Codable, Hashable {
    var id: UUID
    var title: String
    var url: String
    var addedAt: Date

    init(id: UUID = UUID(), title: String, url: String, addedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.url = url
        self.addedAt = addedAt
    }
}

struct HistoryEntry: Identifiable, Codable, Hashable {
    var id: UUID
    var title: String
    var url: String
    var visitedAt: Date

    init(id: UUID = UUID(), title: String, url: String, visitedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.url = url
        self.visitedAt = visitedAt
    }
}

/// A shortcut on the new tab page.
struct TopSite: Identifiable, Hashable {
    var title: String
    var url: String
    var id: String { url }

    init(title: String, url: String) {
        self.title = title
        self.url = url
    }
}

enum ThemeChoice: String, Codable, CaseIterable, Identifiable {
    case dark, light, system

    var id: String { rawValue }

    var label: String {
        switch self {
        case .dark: return "Night"
        case .light: return "Day"
        case .system: return "Like the system"
        }
    }
}

struct DownloadItem: Identifiable, Hashable {
    enum State: Hashable {
        case inProgress
        case finished
        case failed(String)
        case cancelled
    }

    var id: UUID
    var filename: String
    var sourceURL: String
    var state: State
    /// 0…1, or -1 while the size is unknown.
    var fraction: Double
    /// -1 while unknown.
    var totalBytes: Int64
    var localURL: URL?
    var startedAt: Date

    init(
        id: UUID = UUID(),
        filename: String,
        sourceURL: String,
        state: State = .inProgress,
        fraction: Double = -1,
        totalBytes: Int64 = -1,
        localURL: URL? = nil,
        startedAt: Date = Date()
    ) {
        self.id = id
        self.filename = filename
        self.sourceURL = sourceURL
        self.state = state
        self.fraction = fraction
        self.totalBytes = totalBytes
        self.localURL = localURL
        self.startedAt = startedAt
    }
}

/// A dialog a page asked for: alert(), confirm() or prompt().
struct PageDialog: Identifiable {
    enum Kind {
        case alert
        case confirm
        case prompt(defaultText: String)
    }

    let id = UUID()
    let kind: Kind
    let host: String
    let message: String
    /// Must be called exactly once.
    let respond: (_ accepted: Bool, _ text: String?) -> Void

    init(
        kind: Kind,
        host: String,
        message: String,
        respond: @escaping (_ accepted: Bool, _ text: String?) -> Void
    ) {
        self.kind = kind
        self.host = host
        self.message = message
        self.respond = respond
    }
}

struct TabLoadError: Equatable {
    var title: String
    var message: String
    var failedURL: URL?
    /// The page was tried over HTTPS first and may still be reachable over HTTP.
    var canTryHTTP: Bool

    init(title: String, message: String, failedURL: URL? = nil, canTryHTTP: Bool = false) {
        self.title = title
        self.message = message
        self.failedURL = failedURL
        self.canTryHTTP = canTryHTTP
    }
}
