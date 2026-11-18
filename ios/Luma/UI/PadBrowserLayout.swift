import SwiftUI

/// Regular-width layout: tab strip, toolbar with a wide address field, page below.
struct PadBrowserLayout: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel

    var body: some View {
        VStack(spacing: 0) {
            PadTabStrip()
            PadToolbar(tab: tab)
            if chrome.showsFindBar {
                Divider().overlay(Color.lumaBorder)
                FindBarView(tab: tab)
                    .background(LumaTheme.toolbar(isPrivate: tabs.isPrivateMode))
            }
            Divider().overlay(Color.lumaBorder)
            ZStack(alignment: .top) {
                ChromePageArea(tab: tab)
                if chrome.isEditingAddress {
                    PadSuggestionsOverlay(tab: tab)
                        .transition(.opacity)
                }
            }
            .ignoresSafeArea(.all, edges: .bottom)
        }
        .animation(.easeOut(duration: 0.15), value: chrome.isEditingAddress)
        .animation(.easeOut(duration: 0.15), value: chrome.showsFindBar)
    }
}

/// Back, forward, reload, address field, shield, share, bookmarks, tabs, menu.
private struct PadToolbar: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel

    var body: some View {
        HStack(spacing: 2) {
            leadingButtons
            Spacer(minLength: 8)
            AddressBarView(tab: tab, showsShield: false, showsReload: false)
                .frame(maxWidth: 760)
            Spacer(minLength: 8)
            trailingButtons
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(LumaTheme.toolbar(isPrivate: tabs.isPrivateMode))
    }

    private var leadingButtons: some View {
        HStack(spacing: 2) {
            ChromeIconButton(systemName: "chevron.backward", label: "Back", isEnabled: tab.canGoBack) {
                tab.goBack()
            }
            ChromeIconButton(systemName: "chevron.forward", label: "Forward", isEnabled: tab.canGoForward) {
                tab.goForward()
            }
            if tab.isLoading {
                ChromeIconButton(systemName: "xmark", label: "Stop loading") {
                    tab.stop()
                }
            } else {
                ChromeIconButton(systemName: "arrow.clockwise", label: "Reload", isEnabled: tab.url != nil) {
                    tab.reload()
                }
            }
        }
    }

    private var trailingButtons: some View {
        HStack(spacing: 2) {
            ShieldButton(tab: tab, compact: false)
            ChromeIconButton(systemName: "square.and.arrow.up", label: "Share", isEnabled: tab.url != nil) {
                chrome.present(.share)
            }
            ChromeIconButton(systemName: "book", label: "Bookmarks") {
                chrome.present(.bookmarks)
            }
            ChromeIconButton(systemName: "square.grid.2x2", label: "Show all tabs") {
                chrome.openTabSwitcher(tabs: tabs)
            }
            ChromeMenuButton(tab: tab)
        }
    }
}

/// Scrollable row of tab pills with a "+" button.
private struct PadTabStrip: View {
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel

    var body: some View {
        HStack(spacing: 6) {
            if tabs.isPrivateMode {
                privateChip
            }
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(tabs.visibleTabs) { item in
                            PadTabPill(tab: item, isSelected: item.id == tabs.selectedTab?.id)
                                .id(item.id)
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .onChange(of: tabs.selectedTab?.id) { _, selected in
                    guard let selected else { return }
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(selected)
                    }
                }
            }
            ChromeIconButton(systemName: "plus", label: tabs.isPrivateMode ? "New private tab" : "New tab") {
                chrome.openNewTab(in: tabs, isPrivate: tabs.isPrivateMode)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .padding(.bottom, 4)
        .background(LumaTheme.frame(isPrivate: tabs.isPrivateMode))
    }

    private var privateChip: some View {
        Button {
            tabs.isPrivateMode = false
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "eyeglasses")
                Text("Private")
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.lumaText)
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(LumaTheme.tabActive(isPrivate: true), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Private mode")
        .accessibilityHint("Double tap to return to normal tabs")
    }
}

private struct PadTabPill: View {
    @ObservedObject var tab: Tab
    let isSelected: Bool
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
    }

    var body: some View {
        HStack(spacing: 0) {
            Button {
                chrome.select(tab, in: tabs)
            } label: {
                HStack(spacing: 7) {
                    icon
                        .frame(width: 18, height: 18)
                    Text(tab.displayTitle)
                        .font(.footnote)
                        .lineLimit(1)
                        .foregroundStyle(isSelected ? Color.lumaText : Color.lumaTextMuted)
                    Spacer(minLength: 0)
                }
                .padding(.leading, 10)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(tab.displayTitle)
            .accessibilityAddTraits(isSelected ? [.isSelected] : [])
            Button {
                chrome.close(tab, in: tabs)
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color.lumaTextMuted)
                    .frame(width: 30, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close \(tab.displayTitle)")
        }
        .frame(width: 190, height: 32)
        .background(isSelected ? LumaTheme.tabActive(isPrivate: tab.isPrivate) : Color.clear, in: shape)
        .overlay(shape.stroke(isSelected ? Color.lumaBorder : Color.clear, lineWidth: 1))
        .contentShape(shape)
        .hoverEffect(.highlight)
        .contextMenu {
            Button {
                chrome.openNewTab(in: tabs, isPrivate: tab.isPrivate)
            } label: {
                Label("New Tab", systemImage: "plus")
            }
            Button(role: .destructive) {
                chrome.close(tab, in: tabs)
            } label: {
                Label("Close Tab", systemImage: "xmark")
            }
        }
    }

    @ViewBuilder
    private var icon: some View {
        if tab.isLoading {
            ProgressView()
                .controlSize(.small)
        } else if let url = tab.url {
            FaviconView(url: url.absoluteString, size: 16)
        } else {
            Image(systemName: "moon.fill")
                .font(.caption)
                .foregroundStyle(Color.lumaAccent)
        }
    }
}
