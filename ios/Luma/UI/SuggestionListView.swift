import SwiftUI

struct ChromeSuggestion: Identifiable {
    enum Kind { case action, bookmark, history }
    let id: String
    let kind: Kind
    let title: String
    let subtitle: String
    let systemImage: String
    let url: URL
}

@MainActor
enum ChromeSuggestions {
    /// First row from the omnibox ("Open …" / "Search <engine> for …"), then bookmarks and history.
    static func build(text: String, currentURL: URL?, settings: AppSettings,
                      bookmarks: BookmarkStore, history: HistoryStore) -> [ChromeSuggestion] {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, query != currentURL?.absoluteString else { return [] }

        var items: [ChromeSuggestion] = []
        var seen = Set<String>()
        let engine = settings.searchEngine

        if let result = Omnibox.resolve(query, engine: engine, bangs: settings.bangs) {
            items.append(primary(for: result, engineName: engine.name))
            seen.insert(result.destination.absoluteString)
        }
        for bookmark in bookmarks.search(query, limit: 3) {
            guard let url = URL(string: bookmark.url), seen.insert(bookmark.url).inserted else { continue }
            items.append(ChromeSuggestion(id: "b:" + bookmark.url, kind: .bookmark,
                                          title: bookmark.title.isEmpty ? Display.shortHost(bookmark.url) : bookmark.title,
                                          subtitle: Display.prettyURL(bookmark.url),
                                          systemImage: "star.fill", url: url))
        }
        for entry in history.search(query, limit: 5) {
            guard let url = URL(string: entry.url), seen.insert(entry.url).inserted else { continue }
            items.append(ChromeSuggestion(id: "h:" + entry.url, kind: .history,
                                          title: entry.title.isEmpty ? Display.shortHost(entry.url) : entry.title,
                                          subtitle: Display.prettyURL(entry.url),
                                          systemImage: "clock", url: url))
        }
        return items
    }

    private static func primary(for result: OmniboxResult, engineName: String) -> ChromeSuggestion {
        switch result {
        case .url(let url):
            return ChromeSuggestion(id: "a:open", kind: .action,
                                    title: "Open " + Display.prettyURL(url.absoluteString),
                                    subtitle: "", systemImage: "globe", url: url)
        case .search(let url, let query):
            return ChromeSuggestion(id: "a:search", kind: .action,
                                    title: "Search \(engineName) for “\(query)”",
                                    subtitle: "", systemImage: "magnifyingglass", url: url)
        case .bang(let url, let query, let name):
            return ChromeSuggestion(id: "a:bang", kind: .action,
                                    title: query.isEmpty ? "Open \(name)" : "Search \(name) for “\(query)”",
                                    subtitle: "", systemImage: "exclamationmark.bubble", url: url)
        }
    }
}

/// The rows shown while typing in the address field.
struct SuggestionListView: View {
    @ObservedObject var tab: Tab
    let items: [ChromeSuggestion]
    @EnvironmentObject private var chrome: BrowserChromeModel

    var body: some View {
        VStack(spacing: 0) {
            ForEach(items) { item in
                Button {
                    chrome.navigate(tab: tab, to: item.url)
                } label: {
                    SuggestionRow(item: item)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

@MainActor
private struct SuggestionRow: View {
    let item: ChromeSuggestion

    var body: some View {
        HStack(spacing: 12) {
            icon
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.body)
                    .foregroundStyle(Color.lumaText)
                    .lineLimit(1)
                if !item.subtitle.isEmpty {
                    Text(item.subtitle)
                        .font(.footnote)
                        .foregroundStyle(Color.lumaTextMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if item.kind != .action {
                Image(systemName: item.systemImage)
                    .font(.caption)
                    .foregroundStyle(Color.lumaTextFaint)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder
    private var icon: some View {
        if item.kind == .action {
            Image(systemName: item.systemImage)
                .font(.body.weight(.medium))
                .foregroundStyle(Color.lumaAccent)
                .accessibilityHidden(true)
        } else {
            FaviconView(url: item.url.absoluteString, size: 20)
                .accessibilityHidden(true)
        }
    }
}

/// iPhone: suggestions cover the page; rows hug the address bar (bottom or top).
struct PhoneSuggestionsOverlay: View {
    @ObservedObject var tab: Tab
    var anchoredToBottom: Bool

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var bookmarks: BookmarkStore
    @EnvironmentObject private var history: HistoryStore
    @EnvironmentObject private var chrome: BrowserChromeModel

    private var items: [ChromeSuggestion] {
        let built = ChromeSuggestions.build(text: chrome.addressText, currentURL: tab.url, settings: settings,
                                            bookmarks: bookmarks, history: history)
        return anchoredToBottom ? Array(built.reversed()) : built
    }

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                SuggestionListView(tab: tab, items: items)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: geo.size.height, alignment: anchoredToBottom ? .bottom : .top)
                    .contentShape(Rectangle())
                    .onTapGesture { chrome.endAddressEditing() }
            }
        }
        .background(Color.lumaBg)
    }
}

/// iPad: a dropdown card under the address field over a dimmed page.
struct PadSuggestionsOverlay: View {
    @ObservedObject var tab: Tab

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var bookmarks: BookmarkStore
    @EnvironmentObject private var history: HistoryStore
    @EnvironmentObject private var chrome: BrowserChromeModel

    private var items: [ChromeSuggestion] {
        ChromeSuggestions.build(text: chrome.addressText, currentURL: tab.url, settings: settings,
                                bookmarks: bookmarks, history: history)
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: LumaTheme.radiusLG, style: .continuous)
    }

    var body: some View {
        let rows = items
        ZStack(alignment: .top) {
            Color.black.opacity(0.22)
                .contentShape(Rectangle())
                .onTapGesture { chrome.endAddressEditing() }
                .accessibilityHidden(true)
            if !rows.isEmpty {
                SuggestionListView(tab: tab, items: rows)
                    .padding(.vertical, 4)
                    .frame(maxWidth: 720)
                    .background(Color.lumaPopover, in: cardShape)
                    .clipShape(cardShape)
                    .overlay(cardShape.stroke(Color.lumaBorder, lineWidth: 1))
                    .shadow(color: Color.black.opacity(0.25), radius: 18, y: 8)
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
            }
        }
    }
}
