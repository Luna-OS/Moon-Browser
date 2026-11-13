import SwiftUI

/// Find-on-page bar: query field, previous / next, Done.
struct FindBarView: View {
    @ObservedObject var tab: Tab
    @EnvironmentObject private var tabs: TabManager
    @EnvironmentObject private var chrome: BrowserChromeModel
    @State private var query = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.footnote)
                    .foregroundStyle(Color.lumaTextFaint)
                    .accessibilityHidden(true)
                TextField("Find on page", text: $query)
                    .focused($focused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .foregroundStyle(Color.lumaText)
                    .onSubmit { search(backwards: false) }
            }
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(LumaTheme.omnibox(isPrivate: tabs.isPrivateMode),
                        in: RoundedRectangle(cornerRadius: LumaTheme.radiusMD, style: .continuous))
            ChromeIconButton(systemName: "chevron.up", label: "Previous match", isEnabled: !query.isEmpty) {
                search(backwards: true)
            }
            ChromeIconButton(systemName: "chevron.down", label: "Next match", isEnabled: !query.isEmpty) {
                search(backwards: false)
            }
            Button("Done") {
                focused = false
                chrome.closeFind(tab: tab)
            }
            .font(.body.weight(.semibold))
            .padding(.horizontal, 6)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .onAppear {
            DispatchQueue.main.async { focused = true }
        }
        .onChange(of: query) { _, text in
            if text.isEmpty { tab.clearFind() }
        }
    }

    private func search(backwards: Bool) {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        tab.find(text, backwards: backwards)
    }
}
