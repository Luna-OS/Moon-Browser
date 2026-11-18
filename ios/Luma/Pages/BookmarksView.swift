import SwiftUI
import UIKit

@MainActor
struct BookmarksView: View {
    @EnvironmentObject private var store: BookmarkStore
    @Environment(\.dismiss) private var dismiss

    @State private var query: String = ""
    @State private var editMode: EditMode = .inactive
    @State private var editing: Bookmark?

    private let onOpen: (URL) -> Void

    init(onOpen: @escaping (URL) -> Void) {
        self.onOpen = onOpen
    }

    var body: some View {
        NavigationStack {
            content
                .pagesNavigation(title: "Bookmarks")
                .searchable(
                    text: $query,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: Text("Search bookmarks")
                )
                .toolbar { toolbarContent }
                .sheet(item: $editing) { bookmark in
                    BookmarkEditor(bookmark: bookmark) { updated in
                        store.update(updated)
                    }
                }
        }
        .tint(Color.lumaAccent)
    }

    // MARK: Data

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearching: Bool {
        !trimmedQuery.isEmpty
    }

    private var results: [Bookmark] {
        isSearching ? store.search(trimmedQuery, limit: 200) : store.bookmarks
    }

    private var isEditing: Bool {
        editMode == .active
    }

    private var moveAction: ((IndexSet, Int) -> Void)? {
        if isSearching { return nil }
        return { source, destination in
            store.move(fromOffsets: source, toOffset: destination)
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let shown = results
        if shown.isEmpty {
            emptyState
        } else {
            list(shown)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if isSearching {
            PagesEmptyState(
                systemImage: "magnifyingglass",
                title: "No matches",
                message: "No bookmark matches “\(trimmedQuery)”."
            )
        } else {
            PagesEmptyState(
                systemImage: "bookmark",
                title: "No bookmarks yet",
                message: "Add the page you're on from the menu and it will show up here."
            )
        }
    }

    private func list(_ shown: [Bookmark]) -> some View {
        List {
            ForEach(shown) { bookmark in
                row(bookmark)
            }
            .onDelete { offsets in
                delete(offsets, in: shown)
            }
            .onMove(perform: moveAction)
            .listRowBackground(Color.lumaSolid)
        }
        .listStyle(.insetGrouped)
        .environment(\.editMode, $editMode)
        .pagesListBackground()
    }

    private func row(_ bookmark: Bookmark) -> some View {
        Button {
            activate(bookmark)
        } label: {
            PagesSiteRow(title: bookmark.title, url: bookmark.url)
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                store.remove(id: bookmark.id)
            } label: {
                Label("Delete", systemImage: "trash")
            }
            Button {
                editing = bookmark
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            .tint(Color.lumaAccent)
        }
        .contextMenu {
            Button {
                open(bookmark)
            } label: {
                Label("Open", systemImage: "arrow.up.right.square")
            }
            Button {
                editing = bookmark
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            Button {
                UIPasteboard.general.string = bookmark.url
            } label: {
                Label("Copy Link", systemImage: "doc.on.doc")
            }
            Button(role: .destructive) {
                store.remove(id: bookmark.id)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            if !store.bookmarks.isEmpty {
                Button(isEditing ? "Finish" : "Edit") {
                    withAnimation {
                        editMode = isEditing ? .inactive : .active
                    }
                }
            }
        }
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") {
                dismiss()
            }
        }
    }

    // MARK: Actions

    private func activate(_ bookmark: Bookmark) {
        if isEditing {
            editing = bookmark
        } else {
            open(bookmark)
        }
    }

    private func open(_ bookmark: Bookmark) {
        let text = bookmark.url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text) else {
            editing = bookmark
            return
        }
        onOpen(url)
        dismiss()
    }

    private func delete(_ offsets: IndexSet, in shown: [Bookmark]) {
        if isSearching {
            let ids = offsets.filter { $0 < shown.count }.map { shown[$0].id }
            for id in ids {
                store.remove(id: id)
            }
        } else {
            store.remove(atOffsets: offsets)
        }
    }
}

// MARK: - Editor

@MainActor
private struct BookmarkEditor: View {
    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var address: String

    private let original: Bookmark
    private let onSave: (Bookmark) -> Void

    init(bookmark: Bookmark, onSave: @escaping (Bookmark) -> Void) {
        self.original = bookmark
        self.onSave = onSave
        _title = State(initialValue: bookmark.title)
        _address = State(initialValue: bookmark.url)
    }

    /// The address as it will be stored, or nil while it isn't a usable URL.
    private var normalizedAddress: String? {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed.contains(" ") { return nil }
        let candidate = trimmed.contains("://") ? trimmed : "https://" + trimmed
        guard let parsed = URL(string: candidate), let host = parsed.host, !host.isEmpty else {
            return nil
        }
        return candidate
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    TextField("Address", text: $address)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                } footer: {
                    if normalizedAddress == nil {
                        Text("Enter a web address, e.g. https://example.com")
                            .foregroundStyle(Color.lumaDanger)
                    }
                }
                .listRowBackground(Color.lumaSolid)
            }
            .pagesListBackground()
            .pagesNavigation(title: "Edit Bookmark")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                    }
                    .disabled(normalizedAddress == nil)
                }
            }
        }
        .tint(Color.lumaAccent)
    }

    private func save() {
        guard let url = normalizedAddress else { return }
        var updated = original
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.title = trimmedTitle.isEmpty ? Display.shortHost(url) : trimmedTitle
        updated.url = url
        onSave(updated)
        dismiss()
    }
}
