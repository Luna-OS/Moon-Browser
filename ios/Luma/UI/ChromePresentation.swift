import SwiftUI
import UIKit

/// Presents `tab.pendingDialog` (JavaScript alert / confirm / prompt) as a system alert.
/// The dialog's `respond` closure is called exactly once, from the tapped button.
@MainActor
struct PageDialogPresenter: ViewModifier {
    @ObservedObject var tab: Tab
    @State private var promptText = ""

    private var isPresented: Binding<Bool> {
        Binding(get: { tab.pendingDialog != nil }, set: { _ in })
    }

    private var title: String {
        guard let host = tab.pendingDialog?.host, !host.isEmpty else { return "This page says" }
        return "\(host) says"
    }

    func body(content: Content) -> some View {
        content
            .alert(title, isPresented: isPresented, presenting: tab.pendingDialog) { dialog in
                actions(for: dialog)
            } message: { dialog in
                Text(dialog.message)
            }
            .onChange(of: tab.pendingDialog?.id, initial: true) { _, _ in
                promptText = defaultText
            }
    }

    private var defaultText: String {
        guard let dialog = tab.pendingDialog else { return "" }
        if case .prompt(let text) = dialog.kind { return text }
        return ""
    }

    @ViewBuilder
    private func actions(for dialog: PageDialog) -> some View {
        switch dialog.kind {
        case .alert:
            Button("OK") { finish(dialog, accepted: true, text: nil) }
        case .confirm:
            Button("Cancel", role: .cancel) { finish(dialog, accepted: false, text: nil) }
            Button("OK") { finish(dialog, accepted: true, text: nil) }
        case .prompt:
            TextField("", text: $promptText)
                .textInputAutocapitalization(.never)
            Button("Cancel", role: .cancel) { finish(dialog, accepted: false, text: nil) }
            Button("OK") { finish(dialog, accepted: true, text: promptText) }
        }
    }

    private func finish(_ dialog: PageDialog, accepted: Bool, text: String?) {
        // Clear first: responding may synchronously queue the next dialog.
        if tab.pendingDialog?.id == dialog.id {
            tab.pendingDialog = nil
        }
        dialog.respond(accepted, text)
    }
}

/// The system share sheet.
struct ChromeShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Invisible buttons that carry the hardware-keyboard shortcuts.
struct ChromeKeyboardShortcuts: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel

    var body: some View {
        ZStack {
            tabShortcuts
            pageShortcuts
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var tabShortcuts: some View {
        Group {
            Button("New Tab") {
                chrome.openNewTab(in: tabs, isPrivate: false, focusAddress: true)
            }
            .keyboardShortcut("t", modifiers: .command)
            Button("New Private Tab") {
                chrome.openNewTab(in: tabs, isPrivate: true, focusAddress: true)
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Close Tab") {
                chrome.close(tab, in: tabs)
            }
            .keyboardShortcut("w", modifiers: .command)
            Button("Open Location") {
                chrome.beginAddressEditing(tab: tab)
            }
            .keyboardShortcut("l", modifiers: .command)
        }
    }

    private var pageShortcuts: some View {
        Group {
            Button("Reload") {
                tab.reload()
            }
            .keyboardShortcut("r", modifiers: .command)
            Button("Find on Page") {
                if tab.url != nil { chrome.openFind() }
            }
            .keyboardShortcut("f", modifiers: .command)
            Button("Back") {
                if tab.canGoBack { tab.goBack() }
            }
            .keyboardShortcut("[", modifiers: .command)
            Button("Forward") {
                if tab.canGoForward { tab.goForward() }
            }
            .keyboardShortcut("]", modifiers: .command)
        }
    }
}
