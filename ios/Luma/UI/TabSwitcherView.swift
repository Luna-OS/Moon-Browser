import SwiftUI

/// Full-screen grid of tab cards with a Normal / Private switch.
struct TabSwitcherView: View {
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel
    @State private var confirmsCloseAll = false

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 240), spacing: 16)]

    var body: some View {
        VStack(spacing: 0) {
            header
            if tabs.visibleTabs.isEmpty {
                emptyState
            } else {
                grid
            }
            footer
        }
        .background(LumaTheme.frame(isPrivate: tabs.isPrivateMode).ignoresSafeArea())
        .animation(.easeInOut(duration: 0.2), value: tabs.isPrivateMode)
        .confirmationDialog(tabs.isPrivateMode ? "Close all private tabs?" : "Close all tabs?",
                            isPresented: $confirmsCloseAll, titleVisibility: .visible) {
            Button("Close All", role: .destructive) {
                tabs.closeAll(isPrivate: tabs.isPrivateMode)
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var header: some View {
        Picker("Tab group", selection: $tabs.isPrivateMode) {
            Text("Tabs").tag(false)
            Text("Private").tag(true)
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 320)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var grid: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(tabs.visibleTabs) { tab in
                    TabCardView(tab: tab,
                                isSelected: tab.id == tabs.selectedTab?.id,
                                onSelect: { open(tab) },
                                onClose: { close(tab) })
                }
            }
            .padding(16)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: tabs.isPrivateMode ? "eyeglasses" : "square.on.square")
                .font(.largeTitle)
                .foregroundStyle(Color.lumaAccent)
                .accessibilityHidden(true)
            Text(tabs.isPrivateMode ? "No private tabs" : "No open tabs")
                .font(.headline)
                .foregroundStyle(Color.lumaText)
            if tabs.isPrivateMode {
                Text("Private tabs keep no history, and their cookies disappear when the last one closes.")
                    .font(.footnote)
                    .foregroundStyle(Color.lumaTextMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var footer: some View {
        HStack {
            Button("Close All") {
                confirmsCloseAll = true
            }
            .disabled(tabs.visibleTabs.isEmpty)
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                chrome.openNewTab(in: tabs, isPrivate: tabs.isPrivateMode)
                chrome.showsTabSwitcher = false
            } label: {
                Image(systemName: "plus")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.lumaText)
                    .frame(width: 52, height: 40)
                    .background(LumaTheme.tabActive(isPrivate: tabs.isPrivateMode), in: Capsule())
                    .overlay(Capsule().stroke(Color.lumaBorder, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(tabs.isPrivateMode ? "New private tab" : "New tab")

            Button("Done") {
                chrome.showsTabSwitcher = false
            }
            .font(.body.weight(.semibold))
            .keyboardShortcut(.cancelAction)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(LumaTheme.toolbar(isPrivate: tabs.isPrivateMode))
    }

    private func open(_ tab: Tab) {
        chrome.select(tab, in: tabs)
        chrome.showsTabSwitcher = false
    }

    private func close(_ tab: Tab) {
        withAnimation(.easeOut(duration: 0.2)) {
            chrome.close(tab, in: tabs)
        }
    }
}

/// One card in the tab switcher: title bar with close button above the page snapshot.
private struct TabCardView: View {
    @ObservedObject var tab: Tab
    let isSelected: Bool
    let onSelect: () -> Void
    let onClose: () -> Void

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Button(action: onSelect) {
                VStack(spacing: 0) {
                    titleBar
                    preview
                }
                .background(Color.lumaSolid)
                .clipShape(shape)
                .overlay(shape.stroke(isSelected ? Color.lumaAccent : Color.lumaBorder, lineWidth: isSelected ? 2 : 1))
                .shadow(color: Color.black.opacity(0.18), radius: 8, y: 4)
                .contentShape(shape)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(tab.displayTitle)
            .accessibilityAddTraits(isSelected ? [.isSelected] : [])

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color.lumaTextMuted)
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close \(tab.displayTitle)")
        }
        .contextMenu {
            Button(role: .destructive, action: onClose) {
                Label("Close Tab", systemImage: "xmark")
            }
        }
    }

    private var titleBar: some View {
        HStack(spacing: 6) {
            if let url = tab.url {
                FaviconView(url: url.absoluteString, size: 16)
            } else {
                Image(systemName: "moon.fill")
                    .font(.caption)
                    .foregroundStyle(Color.lumaAccent)
            }
            Text(tab.displayTitle)
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.lumaText)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.leading, 10)
        .padding(.trailing, 34)
        .frame(height: 34)
    }

    private var preview: some View {
        Color.clear
            .aspectRatio(0.8, contentMode: .fit)
            .overlay { previewContent }
            .clipped()
    }

    @ViewBuilder
    private var previewContent: some View {
        if let image = tab.snapshot {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .accessibilityHidden(true)
        } else if let url = tab.url {
            ZStack {
                Color.lumaBg
                FaviconView(url: url.absoluteString, size: 40)
            }
            .accessibilityHidden(true)
        } else {
            ZStack {
                SkyBackgroundView()
                MoonPhaseView(phase: Moon.phase(at: Date()).phase, size: 48)
            }
            .accessibilityHidden(true)
        }
    }
}
