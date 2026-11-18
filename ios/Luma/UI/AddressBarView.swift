import SwiftUI
import UIKit

/// The address field: host + security indicator when idle, the full URL (selected) while editing.
struct AddressBarView: View {
    @ObservedObject var tab: Tab
    var showsShield: Bool
    var showsReload: Bool

    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel
    @FocusState private var focused: Bool

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: LumaTheme.radiusMD, style: .continuous)
    }

    var body: some View {
        HStack(spacing: 4) {
            if showsShield && !chrome.isEditingAddress {
                ShieldButton(tab: tab, compact: true)
            }
            ZStack {
                field
                if !chrome.isEditingAddress {
                    idleLabel
                }
            }
            trailingButton
        }
        .padding(.horizontal, 6)
        .frame(height: 40)
        .background(LumaTheme.omnibox(isPrivate: tabs.isPrivateMode), in: shape)
        .overlay(alignment: .bottom) { progressBar }
        .clipShape(shape)
        .overlay(shape.stroke(chrome.isEditingAddress ? Color.lumaAccent.opacity(0.6) : Color.lumaBorder, lineWidth: 1))
        .onChange(of: chrome.isEditingAddress) { _, editing in
            if focused != editing { focused = editing }
        }
        .onChange(of: focused) { _, isFocused in
            if !isFocused && chrome.isEditingAddress { chrome.endAddressEditing() }
        }
        .onChange(of: tab.id) { _, _ in
            if chrome.isEditingAddress { chrome.addressText = tab.url?.absoluteString ?? "" }
        }
        .onAppear {
            if chrome.isEditingAddress { focused = true }
        }
        .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidBeginEditingNotification)) { note in
            guard chrome.isEditingAddress, let textField = note.object as? UITextField else { return }
            // Select everything so typing replaces the current address.
            DispatchQueue.main.async {
                textField.selectedTextRange = textField.textRange(from: textField.beginningOfDocument,
                                                                  to: textField.endOfDocument)
            }
        }
    }

    private var field: some View {
        TextField("Search or enter address", text: $chrome.addressText)
            .focused($focused)
            .keyboardType(.webSearch)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .font(.body)
            .foregroundStyle(Color.lumaText)
            .padding(.horizontal, 6)
            .onSubmit { chrome.submitAddress(tab: tab) }
            .opacity(chrome.isEditingAddress ? 1 : 0)
            .allowsHitTesting(chrome.isEditingAddress)
            .accessibilityHidden(!chrome.isEditingAddress)
    }

    private var idleLabel: some View {
        Button {
            chrome.beginAddressEditing(tab: tab)
        } label: {
            AddressIdleLabel(tab: tab)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Address")
        .accessibilityValue(idleAccessibilityValue)
        .accessibilityHint("Double tap to search or enter an address")
    }

    private var idleAccessibilityValue: String {
        guard let url = tab.url else { return "New Tab" }
        let host = Display.shortHost(url.absoluteString)
        if tab.isSecure { return "\(host), secure connection" }
        if url.scheme?.lowercased() == "http" { return "\(host), not secure" }
        return host
    }

    @ViewBuilder
    private var trailingButton: some View {
        if chrome.isEditingAddress {
            if !chrome.addressText.isEmpty {
                smallButton("xmark.circle.fill", label: "Clear text") {
                    chrome.addressText = ""
                }
            }
        } else if showsReload && tab.url != nil {
            if tab.isLoading {
                smallButton("xmark", label: "Stop loading") { tab.stop() }
            } else {
                smallButton("arrow.clockwise", label: "Reload") { tab.reload() }
            }
        }
    }

    private func smallButton(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.subheadline.weight(.medium))
                .frame(width: 32, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.lumaTextMuted)
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private var progressBar: some View {
        if tab.isLoading {
            GeometryReader { geo in
                Rectangle()
                    .fill(Color.lumaAccent)
                    .frame(width: max(10, geo.size.width * CGFloat(min(max(tab.progress, 0), 1))))
                    .animation(.easeOut(duration: 0.2), value: tab.progress)
            }
            .frame(height: 2)
            .accessibilityHidden(true)
        }
    }
}

/// Host with lock / "Not secure" indicator, or a placeholder on the new tab page.
private struct AddressIdleLabel: View {
    @ObservedObject var tab: Tab

    var body: some View {
        HStack(spacing: 5) {
            if let url = tab.url {
                securityIndicator(for: url)
                Text(hostText(for: url))
                    .foregroundStyle(Color.lumaText)
            } else {
                Image(systemName: "magnifyingglass")
                    .font(.footnote)
                    .foregroundStyle(Color.lumaTextFaint)
                Text("Search or enter address")
                    .foregroundStyle(Color.lumaTextFaint)
            }
        }
        .font(.subheadline)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.horizontal, 6)
    }

    private func hostText(for url: URL) -> String {
        let host = Display.shortHost(url.absoluteString)
        return host.isEmpty ? url.absoluteString : host
    }

    @ViewBuilder
    private func securityIndicator(for url: URL) -> some View {
        if tab.isSecure {
            Image(systemName: "lock.fill")
                .font(.caption2)
                .foregroundStyle(Color.lumaTextMuted)
        } else if url.scheme?.lowercased() == "http" {
            HStack(spacing: 3) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.caption2)
                Text("Not secure")
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(Color.lumaWarning)
        }
    }
}
