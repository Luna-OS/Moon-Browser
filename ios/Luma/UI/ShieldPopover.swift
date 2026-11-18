import SwiftUI

/// Shield icon that opens the per-site protection popover.
struct ShieldButton: View {
    @ObservedObject var tab: Tab
    var compact: Bool
    @EnvironmentObject private var settings: AppSettings
    @State private var showsPopover = false

    private var isProtecting: Bool {
        settings.adblock && !settings.isAllowlisted(host: tab.url?.host)
    }

    var body: some View {
        Button {
            showsPopover = true
        } label: {
            Image(systemName: isProtecting ? "shield.lefthalf.filled" : "shield.slash")
                .font(compact ? Font.subheadline.weight(.medium) : Font.body.weight(.medium))
                .imageScale(compact ? .medium : .large)
                .foregroundStyle(isProtecting ? Color.lumaAccent : Color.lumaTextMuted)
                .frame(width: compact ? 32 : 44, height: compact ? 36 : 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("Luma Shield")
        .accessibilityValue(isProtecting ? "On" : "Off")
        .popover(isPresented: $showsPopover) {
            ShieldPopoverView(tab: tab)
                .presentationCompactAdaptation(.popover)
        }
    }
}

struct ShieldPopoverView: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var blocker: ContentBlocker

    private var host: String? {
        guard let url = tab.url, let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = url.host, !host.isEmpty else { return nil }
        return host
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if let host {
                siteToggle(host: host)
            } else {
                Text("Open a website to manage protection for it.")
                    .font(.footnote)
                    .foregroundStyle(Color.lumaTextMuted)
            }
            Divider()
            status
        }
        .padding(16)
        .frame(width: 300)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.lumaPopover)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.title3)
                .foregroundStyle(Color.lumaAccent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("Luma Shield")
                    .font(.headline)
                    .foregroundStyle(Color.lumaText)
                Text("Blocks ads and trackers")
                    .font(.caption)
                    .foregroundStyle(Color.lumaTextMuted)
            }
        }
    }

    private func siteToggle(host: String) -> some View {
        let isOn = Binding<Bool>(
            get: { !settings.isAllowlisted(host: host) },
            set: { on in
                settings.setAllowlisted(!on, host: host)
                blocker.settingsChanged()
                tab.reload()
            }
        )
        return Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Protection on this site")
                    .font(.subheadline)
                    .foregroundStyle(Color.lumaText)
                Text(Display.shortHost("https://" + host))
                    .font(.caption)
                    .foregroundStyle(Color.lumaTextMuted)
                    .lineLimit(1)
            }
        }
        .tint(Color.lumaAccent)
        .disabled(!settings.adblock)
    }

    @ViewBuilder
    private var status: some View {
        if !settings.adblock {
            statusRow("shield.slash", "Luma Shield is turned off in Settings.", Color.lumaTextMuted)
        } else if blocker.isUpdating {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Updating filter lists…")
                    .font(.footnote)
                    .foregroundStyle(Color.lumaTextMuted)
            }
        } else if blocker.isReady {
            statusRow("checkmark.circle.fill", "\(blocker.ruleCount.formatted()) rules active", Color.lumaSuccess)
            if let updated = blocker.lastUpdated {
                Text("Filter lists updated \(updated.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption)
                    .foregroundStyle(Color.lumaTextFaint)
            }
        } else {
            statusRow("hourglass", "Preparing filter lists…", Color.lumaTextMuted)
        }
        if settings.adblock, let error = blocker.lastError, !error.isEmpty {
            statusRow("exclamationmark.triangle.fill", error, Color.lumaWarning)
        }
    }

    private func statusRow(_ systemName: String, _ text: String, _ color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: systemName)
                .foregroundStyle(color)
                .accessibilityHidden(true)
            Text(text)
                .foregroundStyle(Color.lumaText)
        }
        .font(.footnote)
    }
}
