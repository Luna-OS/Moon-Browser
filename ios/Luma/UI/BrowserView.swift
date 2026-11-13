import SwiftUI

/// Root view: picks the iPhone or iPad chrome and owns sheets, the tab switcher and page dialogs.
struct BrowserView: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var bookmarks: BookmarkStore
    @EnvironmentObject private var history: HistoryStore
    @EnvironmentObject private var downloads: DownloadManager
    @EnvironmentObject private var blocker: ContentBlocker
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @StateObject private var chrome = BrowserChromeModel()

    init() {}

    var body: some View {
        ZStack {
            LumaTheme.frame(isPrivate: tabs.isPrivateMode)
                .ignoresSafeArea()
            if let tab = tabs.selectedTab {
                layout(for: tab)
            } else {
                emptyState
            }
        }
        .tint(Color.lumaAccent)
        .environmentObject(chrome)
        .onChange(of: tabs.selectedTab?.id) { _, _ in
            chrome.showsFindBar = false
        }
        .sheet(item: $chrome.sheet) { sheet in
            sheetContent(sheet)
        }
        .fullScreenCover(isPresented: $chrome.showsTabSwitcher) {
            TabSwitcherView()
                .environmentObject(chrome)
                .environmentObject(tabs)
                .environmentObject(settings)
                .tint(Color.lumaAccent)
        }
    }

    @ViewBuilder
    private func layout(for tab: Tab) -> some View {
        Group {
            if horizontalSizeClass == .regular {
                PadBrowserLayout(tab: tab)
            } else {
                PhoneBrowserLayout(tab: tab)
            }
        }
        .modifier(PageDialogPresenter(tab: tab))
        .background(ChromeKeyboardShortcuts(tab: tab))
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "moon.stars.fill")
                .font(.largeTitle)
                .foregroundStyle(Color.lumaAccent)
                .accessibilityHidden(true)
            Text(tabs.isPrivateMode ? "No private tabs" : "No tabs")
                .font(.headline)
                .foregroundStyle(Color.lumaText)
            Button("New Tab") {
                chrome.openNewTab(in: tabs, isPrivate: tabs.isPrivateMode)
            }
            .buttonStyle(.borderedProminent)
            if tabs.isPrivateMode {
                Button("Leave Private Mode") {
                    tabs.isPrivateMode = false
                }
            }
        }
        .padding()
    }

    private func sheetContent(_ sheet: ChromeSheet) -> some View {
        Group {
            switch sheet {
            case .bookmarks:
                BookmarksView(onOpen: { url in openFromSheet(url) })
            case .history:
                HistoryView(onOpen: { url in openFromSheet(url) })
            case .downloads:
                DownloadsView()
            case .settings:
                SettingsView()
            case .share:
                if let url = tabs.selectedTab?.url {
                    ChromeShareSheet(items: [url])
                        .presentationDetents([.medium, .large])
                        .ignoresSafeArea()
                } else {
                    Text("Nothing to share")
                        .foregroundStyle(Color.lumaTextMuted)
                        .presentationDetents([.medium])
                }
            }
        }
        .environmentObject(settings)
        .environmentObject(tabs)
        .environmentObject(bookmarks)
        .environmentObject(history)
        .environmentObject(downloads)
        .environmentObject(blocker)
        .tint(Color.lumaAccent)
    }

    private func openFromSheet(_ url: URL) {
        if let tab = tabs.selectedTab {
            tab.load(url)
        } else {
            tabs.newTab(url: url, isPrivate: tabs.isPrivateMode, select: true)
        }
    }
}

/// What a tab shows below the chrome: new tab page, error page or the web view.
struct ChromePageArea: View {
    @ObservedObject var tab: Tab

    var body: some View {
        ZStack {
            if let error = tab.loadError {
                ErrorPageView(tab: tab, error: error)
            } else if tab.showsNewTabPage {
                NewTabPageView(tab: tab)
            } else {
                WebViewContainer(tab: tab)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }
}
