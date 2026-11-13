import SwiftUI

@main
struct LumaApp: App {
    @StateObject private var settings = AppSettings.shared
    @StateObject private var tabs = TabManager()
    @StateObject private var bookmarks = BookmarkStore.shared
    @StateObject private var history = HistoryStore.shared
    @StateObject private var downloads = DownloadManager.shared
    @StateObject private var shield = ContentBlocker.shared

    @Environment(\.scenePhase) private var scenePhase
    @State private var started = false

    var body: some Scene {
        WindowGroup {
            BrowserView()
                .environmentObject(settings)
                .environmentObject(tabs)
                .environmentObject(bookmarks)
                .environmentObject(history)
                .environmentObject(downloads)
                .environmentObject(shield)
                .preferredColorScheme(settings.colorScheme)
                .tint(Color.lumaAccent)
                .task {
                    guard !started else { return }
                    started = true
                    // What "clear on exit" left undone when iOS ended the app in the background.
                    if settings.clearOnExit {
                        await tabs.clearBrowsingData(history: true, websiteData: true)
                    }
                    tabs.restoreSession()
                    await shield.prepare()
                }
                .onOpenURL { url in
                    tabs.open(externalURL: url)
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background {
                        tabs.saveSession()
                    }
                }
        }
    }
}
