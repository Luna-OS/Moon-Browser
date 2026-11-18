import SwiftUI
import UIKit

@MainActor
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    init() {}

    var body: some View {
        NavigationStack {
            Form {
                SettingsAppearanceSection()
                SettingsSearchSection()
                SettingsShieldSection()
                SettingsPrivacySection()
                SettingsTabsSection()
                SettingsDefaultBrowserSection()
                SettingsAboutSection()
            }
            .pagesListBackground()
            .pagesNavigation(title: "Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .tint(Color.lumaAccent)
    }
}

// MARK: - Building blocks

private struct SettingsToggle: View {
    private let title: String
    private let hint: String?
    @Binding private var isOn: Bool

    init(_ title: String, hint: String? = nil, isOn: Binding<Bool>) {
        self.title = title
        self.hint = hint
        _isOn = isOn
    }

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .foregroundStyle(Color.lumaText)
                if let text = hint {
                    Text(text)
                        .font(.footnote)
                        .foregroundStyle(Color.lumaTextMuted)
                }
            }
        }
        .tint(Color.lumaAccent)
    }
}

private enum SettingsDevice {
    @MainActor static var isPhone: Bool {
        UIDevice.current.userInterfaceIdiom == .phone
    }
}

// MARK: - Appearance

@MainActor
private struct SettingsAppearanceSection: View {
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        Section {
            Picker("Theme", selection: $settings.theme) {
                ForEach(ThemeChoice.allCases) { choice in
                    Text(choice.label).tag(choice)
                }
            }
            if SettingsDevice.isPhone {
                Picker("Address bar", selection: $settings.addressBarAtBottom) {
                    Text("Bottom").tag(true)
                    Text("Top").tag(false)
                }
            }
        } header: {
            Text("Appearance")
        } footer: {
            Text("Night is Luma's home; websites follow it when they support dark mode.")
        }
        .listRowBackground(Color.lumaSolid)
    }
}

// MARK: - Search

@MainActor
private struct SettingsSearchSection: View {
    @EnvironmentObject private var settings: AppSettings
    @State private var customDraft: String = ""

    private var isCustom: Bool {
        settings.searchEngineID == "custom"
    }

    private var trimmedDraft: String {
        customDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var draftIsValid: Bool {
        SearchEngines.isValidCustomSearchURL(trimmedDraft)
    }

    var body: some View {
        Section {
            Picker("Search engine", selection: $settings.searchEngineID) {
                ForEach(SearchEngines.all) { engine in
                    Text(engine.name).tag(engine.id)
                }
                Text("Custom").tag("custom")
            }
            if isCustom {
                customField
            }
            SettingsToggle(
                "Bangs",
                hint: "Type !w, !yt, !gh and friends to search a site directly.",
                isOn: $settings.bangs
            )
        } header: {
            Text("Search")
        } footer: {
            Text("Search suggestions never leave your device: they come from your history and bookmarks only.")
        }
        .listRowBackground(Color.lumaSolid)
    }

    private var customField: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("https://search.example/?q=%s", text: $customDraft)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .accessibilityLabel("Custom search URL")
                .onAppear {
                    customDraft = settings.customSearchURL
                }
                .onChange(of: customDraft) { _, _ in
                    commitDraft()
                }
            Text(customHint)
                .font(.footnote)
                .foregroundStyle(customHintColor)
        }
    }

    private var customHint: String {
        if trimmedDraft.isEmpty || draftIsValid {
            return "The search address with %s where the query goes."
        }
        return "Needs to be an http(s) address that contains %s."
    }

    private var customHintColor: Color {
        (trimmedDraft.isEmpty || draftIsValid) ? Color.lumaTextMuted : Color.lumaDanger
    }

    private func commitDraft() {
        let value = trimmedDraft
        if SearchEngines.isValidCustomSearchURL(value), settings.customSearchURL != value {
            settings.customSearchURL = value
        }
    }
}

// MARK: - Luma Shield

@MainActor
private struct SettingsShieldSection: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var blocker: ContentBlocker

    var body: some View {
        Section {
            SettingsToggle(
                "Block ads and trackers",
                hint: "Luma Shield uses uBlock Origin's filter lists, EasyList, EasyPrivacy and Peter Lowe's list.",
                isOn: $settings.adblock
            )
            .onChange(of: settings.adblock) { _, _ in
                blocker.settingsChanged()
            }
            SettingsToggle(
                "Hide cookie banners and annoyances",
                hint: "Adds the cookie-notice and annoyance lists.",
                isOn: $settings.adblockAnnoyances
            )
            .disabled(!settings.adblock)
            .onChange(of: settings.adblockAnnoyances) { _, _ in
                blocker.settingsChanged()
            }
            NavigationLink {
                SettingsAllowlistView()
            } label: {
                LabeledContent("Sites with Luma Shield off", value: "\(settings.protectionAllowlist.count)")
            }
            LabeledContent("Rules", value: ruleCountText)
            LabeledContent("Last updated", value: lastUpdatedText)
            updateButton
            if let message = blocker.lastError, !message.isEmpty {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Color.lumaDanger)
            }
        } header: {
            Text("Luma Shield")
        }
        .listRowBackground(Color.lumaSolid)
    }

    private var ruleCountText: String {
        if !blocker.isReady { return "Preparing…" }
        return blocker.ruleCount.formatted()
    }

    private var lastUpdatedText: String {
        guard let date = blocker.lastUpdated else { return "Built-in list" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private var updateButton: some View {
        Button {
            Task {
                await blocker.update()
            }
        } label: {
            HStack {
                Text(blocker.isUpdating ? "Updating filter lists…" : "Update now")
                Spacer()
                if blocker.isUpdating {
                    ProgressView()
                }
            }
        }
        .disabled(blocker.isUpdating)
    }
}

@MainActor
private struct SettingsAllowlistView: View {
    @EnvironmentObject private var settings: AppSettings

    @State private var draft: String = ""
    @State private var showsInvalid: Bool = false

    var body: some View {
        Form {
            Section {
                HStack {
                    TextField("example.com", text: $draft)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .submitLabel(.done)
                        .onSubmit {
                            add()
                        }
                        .accessibilityLabel("Site to add")
                    Button("Add") {
                        add()
                    }
                    .buttonStyle(.borderless)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } header: {
                Text("Add a site")
            } footer: {
                if showsInvalid {
                    Text("That doesn't look like a site address.")
                        .foregroundStyle(Color.lumaDanger)
                } else {
                    Text("Luma Shield stays off on these sites. Use it when a page breaks.")
                }
            }
            .listRowBackground(Color.lumaSolid)

            Section {
                if settings.protectionAllowlist.isEmpty {
                    Text("No sites yet")
                        .foregroundStyle(Color.lumaTextMuted)
                } else {
                    ForEach(settings.protectionAllowlist, id: \.self) { host in
                        Text(host)
                            .foregroundStyle(Color.lumaText)
                    }
                    .onDelete { offsets in
                        remove(offsets)
                    }
                }
            } header: {
                Text("Shield off")
            }
            .listRowBackground(Color.lumaSolid)
        }
        .pagesListBackground()
        .pagesNavigation(title: "Shield Exceptions")
    }

    private func add() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return }
        guard let host = AppSettings.normalizeSite(text) else {
            showsInvalid = true
            return
        }
        showsInvalid = false
        settings.setAllowlisted(true, host: host)
        draft = ""
    }

    private func remove(_ offsets: IndexSet) {
        let current = settings.protectionAllowlist
        let hosts = offsets.filter { $0 < current.count }.map { current[$0] }
        for host in hosts {
            settings.setAllowlisted(false, host: host)
        }
    }
}

// MARK: - Privacy

@MainActor
private struct SettingsPrivacySection: View {
    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var tabs: TabManager

    @State private var showsClearDialog: Bool = false
    @State private var isClearing: Bool = false
    @State private var didClear: Bool = false

    var body: some View {
        Section {
            SettingsToggle(
                "HTTPS first",
                hint: "Try every site over a secure connection first, and ask before falling back to plain HTTP.",
                isOn: $settings.httpsFirst
            )
            SettingsToggle(
                "Remove tracking parameters from links",
                hint: "Strips click IDs and campaign tags like utm_source, fbclid and gclid before a page loads.",
                isOn: $settings.stripTrackingParams
            )
            SettingsToggle(
                "Send Global Privacy Control",
                hint: "Tells sites you don't want your data sold or shared. In some places, they have to listen.",
                isOn: $settings.globalPrivacyControl
            )
            SettingsToggle(
                "Block pop-ups",
                hint: "Windows a page opens on its own are stopped; links you tap still open.",
                isOn: $settings.blockPopups
            )
            SettingsToggle(
                "Clear browsing data when Luma closes",
                hint: "Every start is a fresh start: you'll be signed out of websites.",
                isOn: $settings.clearOnExit
            )
            clearButton
        } header: {
            Text("Privacy")
        }
        .listRowBackground(Color.lumaSolid)
    }

    private var clearButton: some View {
        Button(role: .destructive) {
            showsClearDialog = true
        } label: {
            HStack {
                Text("Clear Browsing Data…")
                Spacer()
                if isClearing {
                    ProgressView()
                } else if didClear {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.lumaSuccess)
                        .accessibilityLabel("Cleared")
                }
            }
        }
        .disabled(isClearing)
        .confirmationDialog(
            "Clear browsing data",
            isPresented: $showsClearDialog,
            titleVisibility: .visible
        ) {
            Button("History", role: .destructive) {
                clear(history: true, websiteData: false)
            }
            Button("Cookies and Site Data", role: .destructive) {
                clear(history: false, websiteData: true)
            }
            Button("Everything", role: .destructive) {
                clear(history: true, websiteData: true)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Clearing cookies and site data signs you out of websites. Bookmarks are kept.")
        }
    }

    private func clear(history: Bool, websiteData: Bool) {
        isClearing = true
        didClear = false
        Task {
            await tabs.clearBrowsingData(history: history, websiteData: websiteData)
            isClearing = false
            didClear = true
        }
    }
}

// MARK: - Tabs

@MainActor
private struct SettingsTabsSection: View {
    @EnvironmentObject private var settings: AppSettings

    var body: some View {
        Section {
            SettingsToggle(
                "Restore tabs on launch",
                hint: "Pick up where you left off. Private tabs are never restored.",
                isOn: $settings.restoreTabs
            )
            SettingsToggle(
                "Shortcuts on the new tab page",
                hint: "Your most visited sites, from your local history.",
                isOn: $settings.newTabShortcuts
            )
            if !SettingsDevice.isPhone {
                SettingsToggle(
                    "Request desktop sites",
                    hint: "iPad loads the desktop version of websites by default.",
                    isOn: $settings.desktopSiteOnPad
                )
            }
        } header: {
            Text("Tabs")
        }
        .listRowBackground(Color.lumaSolid)
    }
}

// MARK: - Default browser

@MainActor
private struct SettingsDefaultBrowserSection: View {
    var body: some View {
        Section {
            Button {
                openSystemSettings()
            } label: {
                HStack {
                    Text("Open Luma in Settings")
                    Spacer()
                    Image(systemName: "arrow.up.forward.app")
                        .accessibilityHidden(true)
                }
            }
        } header: {
            Text("Default browser")
        } footer: {
            Text("In Settings, tap “Default Browser App” and choose Luma to open links from other apps here.")
        }
        .listRowBackground(Color.lumaSolid)
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

// MARK: - About

@MainActor
private struct SettingsAboutSection: View {
    private var versionText: String {
        let info = Bundle.main.infoDictionary
        let version = (info?["CFBundleShortVersionString"] as? String) ?? "–"
        if let build = info?["CFBundleVersion"] as? String, !build.isEmpty {
            return "\(version) (\(build))"
        }
        return version
    }

    var body: some View {
        Section {
            LabeledContent("Version", value: versionText)
            LabeledContent("License", value: "GPL-3.0")
            if let url = URL(string: "https://github.com/Luna-OS/Moon-Browser") {
                Link(destination: url) {
                    HStack {
                        Text("Source code on GitHub")
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .accessibilityHidden(true)
                    }
                }
            }
        } header: {
            Text("About")
        } footer: {
            Text("Luma is free software. No account, no telemetry.")
        }
        .listRowBackground(Color.lumaSolid)
    }
}
