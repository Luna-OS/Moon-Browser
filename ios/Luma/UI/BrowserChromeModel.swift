import SwiftUI
import UIKit

/// The sheets the browser chrome can present (Area D pages + the share sheet).
enum ChromeSheet: String, Identifiable {
    case bookmarks, history, downloads, settings, share
    var id: String { rawValue }
}

/// Transient UI state of the browser chrome, shared by the iPhone and iPad layouts.
@MainActor
final class BrowserChromeModel: ObservableObject {
    @Published var isEditingAddress = false
    @Published var addressText = ""
    @Published var sheet: ChromeSheet?
    @Published var showsTabSwitcher = false
    @Published var showsFindBar = false

    // MARK: Address bar

    /// The single entry point for focusing the address field.
    func beginAddressEditing(tab: Tab?) {
        if showsFindBar {
            tab?.clearFind()
            showsFindBar = false
        }
        addressText = tab?.url?.absoluteString ?? ""
        isEditingAddress = true
    }

    func endAddressEditing() {
        isEditingAddress = false
    }

    func submitAddress(tab: Tab) {
        let text = addressText.trimmingCharacters(in: .whitespacesAndNewlines)
        isEditingAddress = false
        guard !text.isEmpty else { return }
        tab.loadInput(text)
    }

    func navigate(tab: Tab, to url: URL) {
        isEditingAddress = false
        tab.load(url)
    }

    // MARK: Tabs

    func openNewTab(in tabs: TabManager, isPrivate: Bool, focusAddress: Bool = false) {
        isEditingAddress = false
        showsFindBar = false
        let tab = tabs.newTab(url: nil, isPrivate: isPrivate, select: true)
        if tabs.isPrivateMode != isPrivate {
            tabs.isPrivateMode = isPrivate
        }
        if tabs.selectedTab?.id != tab.id {
            tabs.select(tab)
        }
        ChromeHaptics.tap()
        if focusAddress {
            beginAddressEditing(tab: tab)
        }
    }

    func select(_ tab: Tab, in tabs: TabManager) {
        isEditingAddress = false
        guard tabs.selectedTab?.id != tab.id else { return }
        tabs.select(tab)
    }

    func close(_ tab: Tab, in tabs: TabManager) {
        isEditingAddress = false
        tabs.close(tab)
        ChromeHaptics.tap()
    }

    func openTabSwitcher(tabs: TabManager) {
        isEditingAddress = false
        tabs.selectedTab?.updateSnapshot()
        showsTabSwitcher = true
    }

    // MARK: Find on page

    func openFind() {
        isEditingAddress = false
        showsFindBar = true
    }

    func closeFind(tab: Tab?) {
        tab?.clearFind()
        showsFindBar = false
    }

    // MARK: Sheets

    func present(_ sheet: ChromeSheet) {
        isEditingAddress = false
        self.sheet = sheet
    }
}

@MainActor
enum ChromeHaptics {
    static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}
