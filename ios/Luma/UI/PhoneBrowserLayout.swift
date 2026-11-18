import SwiftUI

/// Compact-width layout: page full-screen, address bar + toolbar at the bottom (or address bar on top).
struct PhoneBrowserLayout: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel

    private var toolbarColor: Color { LumaTheme.toolbar(isPrivate: tabs.isPrivateMode) }

    /// The chrome only follows the keyboard while one of its own fields is being edited;
    /// otherwise the web view handles the keyboard itself.
    private var ignoredRegions: SafeAreaRegions {
        (chrome.isEditingAddress || chrome.showsFindBar) ? [] : .keyboard
    }

    var body: some View {
        Group {
            if settings.addressBarAtBottom {
                bottomBarLayout
            } else {
                topBarLayout
            }
        }
        .animation(.easeOut(duration: 0.18), value: chrome.isEditingAddress)
        .animation(.easeOut(duration: 0.18), value: chrome.showsFindBar)
    }

    private var bottomBarLayout: some View {
        pageArea(suggestionsAtBottom: true)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    Divider().overlay(Color.lumaBorder)
                    if chrome.showsFindBar {
                        FindBarView(tab: tab)
                    } else {
                        PhoneAddressRow(tab: tab)
                        if !chrome.isEditingAddress {
                            PhoneToolbarRow(tab: tab)
                        }
                    }
                }
                .background(toolbarColor)
            }
            .ignoresSafeArea(ignoredRegions, edges: .bottom)
    }

    private var topBarLayout: some View {
        pageArea(suggestionsAtBottom: false)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    PhoneAddressRow(tab: tab)
                    Divider().overlay(Color.lumaBorder)
                }
                .background(toolbarColor)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if chrome.showsFindBar {
                        Divider().overlay(Color.lumaBorder)
                        FindBarView(tab: tab)
                    } else if !chrome.isEditingAddress {
                        Divider().overlay(Color.lumaBorder)
                        PhoneToolbarRow(tab: tab)
                    }
                }
                .background(toolbarColor)
            }
            .ignoresSafeArea(ignoredRegions, edges: .bottom)
    }

    private func pageArea(suggestionsAtBottom: Bool) -> some View {
        ZStack {
            ChromePageArea(tab: tab)
            if chrome.isEditingAddress {
                PhoneSuggestionsOverlay(tab: tab, anchoredToBottom: suggestionsAtBottom)
                    .transition(.opacity)
            }
        }
    }
}

/// Address field plus a Cancel button while editing.
private struct PhoneAddressRow: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var chrome: BrowserChromeModel

    var body: some View {
        HStack(spacing: 10) {
            AddressBarView(tab: tab, showsShield: true, showsReload: true)
            if chrome.isEditingAddress {
                Button("Cancel") {
                    chrome.endAddressEditing()
                }
                .font(.body)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

/// Back, forward, share, bookmarks, tabs, menu.
private struct PhoneToolbarRow: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var chrome: BrowserChromeModel

    var body: some View {
        HStack(spacing: 0) {
            ChromeIconButton(systemName: "chevron.backward", label: "Back", isEnabled: tab.canGoBack) {
                tab.goBack()
            }
            .frame(maxWidth: .infinity)
            ChromeIconButton(systemName: "chevron.forward", label: "Forward", isEnabled: tab.canGoForward) {
                tab.goForward()
            }
            .frame(maxWidth: .infinity)
            ChromeIconButton(systemName: "square.and.arrow.up", label: "Share", isEnabled: tab.url != nil) {
                chrome.present(.share)
            }
            .frame(maxWidth: .infinity)
            ChromeIconButton(systemName: "book", label: "Bookmarks") {
                chrome.present(.bookmarks)
            }
            .frame(maxWidth: .infinity)
            TabCountButton()
                .frame(maxWidth: .infinity)
            ChromeMenuButton(tab: tab)
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
    }
}
