import SwiftUI

/// Icon-only toolbar button with a VoiceOver label and a comfortable hit area.
struct ChromeIconButton: View {
    let systemName: String
    let label: String
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.body.weight(.medium))
                .imageScale(.large)
                .frame(width: 44, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isEnabled ? Color.lumaText : Color.lumaTextFaint)
        .disabled(!isEnabled)
        .hoverEffect(.highlight)
        .accessibilityLabel(label)
    }
}

/// The "tabs" button: a rounded square with the number of open tabs.
struct TabCountButton: View {
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel

    private var count: Int { tabs.visibleTabs.count }

    var body: some View {
        Button {
            chrome.openTabSwitcher(tabs: tabs)
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(Color.lumaText, lineWidth: 1.6)
                    .frame(width: 22, height: 22)
                Text(count > 99 ? "∞" : "\(count)")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.lumaText)
            }
            .frame(width: 44, height: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(tabs.isPrivateMode ? "Private tabs" : "Tabs")
        .accessibilityValue("\(count) open")
    }
}

/// The `…` menu.
struct ChromeMenuButton: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var bookmarks: BookmarkStore
    @EnvironmentObject private var chrome: BrowserChromeModel

    private var pageURL: String? { tab.url?.absoluteString }

    private var isBookmarked: Bool {
        guard let pageURL else { return false }
        return bookmarks.isBookmarked(pageURL)
    }

    var body: some View {
        Menu {
            tabSection
            librarySection
            pageSection
            Section {
                Button {
                    chrome.present(.settings)
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.body.weight(.medium))
                .imageScale(.large)
                .frame(width: 44, height: 40)
                .contentShape(Rectangle())
                .foregroundStyle(Color.lumaText)
        }
        .hoverEffect(.highlight)
        .accessibilityLabel("Menu")
    }

    private var tabSection: some View {
        Section {
            Button {
                chrome.openNewTab(in: tabs, isPrivate: false)
            } label: {
                Label("New Tab", systemImage: "plus.square")
            }
            Button {
                chrome.openNewTab(in: tabs, isPrivate: true)
            } label: {
                Label("New Private Tab", systemImage: "eyeglasses")
            }
        }
    }

    private var librarySection: some View {
        Section {
            Button {
                chrome.present(.bookmarks)
            } label: {
                Label("Bookmarks", systemImage: "book")
            }
            Button {
                chrome.present(.history)
            } label: {
                Label("History", systemImage: "clock")
            }
            Button {
                chrome.present(.downloads)
            } label: {
                Label("Downloads", systemImage: "arrow.down.circle")
            }
        }
    }

    private var pageSection: some View {
        Section {
            Button {
                toggleBookmark()
            } label: {
                Label(isBookmarked ? "Remove Bookmark" : "Add Bookmark",
                      systemImage: isBookmarked ? "star.slash" : "star")
            }
            .disabled(pageURL == nil)
            Button {
                chrome.openFind()
            } label: {
                Label("Find on Page", systemImage: "magnifyingglass")
            }
            .disabled(pageURL == nil)
            Button {
                tab.setDesktopSite(!tab.isDesktopSite)
            } label: {
                Label(tab.isDesktopSite ? "Request Mobile Site" : "Request Desktop Site",
                      systemImage: tab.isDesktopSite ? "iphone" : "desktopcomputer")
            }
            .disabled(pageURL == nil)
            Button {
                chrome.present(.share)
            } label: {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            .disabled(pageURL == nil)
        }
    }

    private func toggleBookmark() {
        guard let pageURL else { return }
        bookmarks.toggle(title: tab.displayTitle, url: pageURL)
        ChromeHaptics.success()
    }
}
