import SwiftUI

/// The new tab page: night sky, moon, clock, greeting, search pill and shortcuts.
/// Always drawn as a night scene, so it uses the raw palette rather than the light/dark colors.
struct NewTabPageView: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var history: HistoryStore
    @EnvironmentObject private var chrome: BrowserChromeModel

    private var sites: [TopSite] {
        guard settings.newTabShortcuts else { return [] }
        return history.topSites(limit: 8, hidden: settings.hiddenTopSites)
    }

    var body: some View {
        ZStack {
            SkyBackgroundView()
            GeometryReader { geo in
                ScrollView {
                    content(height: geo.size.height)
                        .frame(maxWidth: 640)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: geo.size.height, alignment: .top)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .environment(\.colorScheme, .dark)
    }

    private func content(height: CGFloat) -> some View {
        VStack(spacing: 0) {
            TimelineView(.everyMinute) { context in
                NewTabHeader(date: context.date)
            }
            .padding(.top, max(20, height * 0.09))

            searchPill
                .padding(.top, 28)

            if !sites.isEmpty {
                NewTabShortcutGrid(sites: sites, onOpen: { url in tab.load(url) }, onOpenInNewTab: { url in
                    _ = tabs.newTab(url: url, isPrivate: tab.isPrivate, select: false)
                }, onRemove: { site in
                    withAnimation(.easeOut(duration: 0.2)) {
                        settings.hiddenTopSites.append(site.url)
                    }
                })
                .padding(.top, 30)
            }

            if tab.isPrivate {
                privateChip
                    .padding(.top, 30)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
    }

    private var searchPill: some View {
        Button {
            chrome.beginAddressEditing(tab: tab)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color.lavender300)
                Text("Search with \(settings.searchEngine.name) or type an address")
                    .foregroundStyle(Color.moon100.opacity(0.6))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }
            .font(.callout)
            .padding(.horizontal, 18)
            .frame(height: 52)
            .background(Color.white.opacity(0.08), in: Capsule())
            .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Search or type an address")
    }

    private var privateChip: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "eyeglasses")
                .accessibilityHidden(true)
            Text("Private tab — no history is kept, and cookies disappear when the last private tab closes.")
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(Color.moon100.opacity(0.85))
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.violet700.opacity(0.45), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.12), lineWidth: 1))
    }
}

/// Moon, clock and "<greeting> · <phase name>, NN% lit".
private struct NewTabHeader: View {
    let date: Date

    var body: some View {
        let moon = Moon.phase(at: date)
        let percent = Int((moon.illumination * 100).rounded())
        let hour = Calendar.current.component(.hour, from: date)
        let line: String = "\(Moon.greeting(hour: hour)) · \(moon.name), \(percent)% lit"
        VStack(spacing: 8) {
            MoonPhaseView(phase: moon.phase, size: 92)
            Text(date.formatted(date: .omitted, time: .shortened))
                .font(.system(size: 60, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .foregroundStyle(Color.moon100)
            Text(verbatim: line)
                .font(.subheadline)
                .foregroundStyle(Color.lavender300.opacity(0.9))
                .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Up to eight most visited sites, four to a row.
@MainActor
private struct NewTabShortcutGrid: View {
    let sites: [TopSite]
    let onOpen: (URL) -> Void
    let onOpenInNewTab: (URL) -> Void
    let onRemove: (TopSite) -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 4)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(sites) { site in
                tile(for: site)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Shortcuts")
    }

    private func name(of site: TopSite) -> String {
        site.title.isEmpty ? Display.shortHost(site.url) : site.title
    }

    private func tile(for site: TopSite) -> some View {
        Button {
            if let url = URL(string: site.url) { onOpen(url) }
        } label: {
            VStack(spacing: 8) {
                FaviconView(url: site.url, size: 26)
                    .frame(width: 56, height: 56)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.14), lineWidth: 1))
                Text(name(of: site))
                    .font(.caption)
                    .foregroundStyle(Color.moon100.opacity(0.75))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name(of: site))
        .contextMenu {
            Button {
                if let url = URL(string: site.url) { onOpenInNewTab(url) }
            } label: {
                Label("Open in New Tab", systemImage: "plus.square.on.square")
            }
            Button(role: .destructive) {
                onRemove(site)
            } label: {
                Label("Remove", systemImage: "xmark.circle")
            }
        }
    }
}
