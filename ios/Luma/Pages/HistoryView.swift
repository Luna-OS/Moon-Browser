import SwiftUI
import UIKit

private struct HistoryDayGroup: Identifiable {
    let day: Date
    let entries: [HistoryEntry]
    var id: Date { day }

    var title: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }
        return day.formatted(date: .complete, time: .omitted)
    }
}

@MainActor
struct HistoryView: View {
    @EnvironmentObject private var store: HistoryStore
    @Environment(\.dismiss) private var dismiss

    @State private var query: String = ""
    @State private var showsClearDialog: Bool = false

    private let onOpen: (URL) -> Void

    init(onOpen: @escaping (URL) -> Void) {
        self.onOpen = onOpen
    }

    var body: some View {
        NavigationStack {
            content
                .pagesNavigation(title: "History")
                .searchable(
                    text: $query,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: Text("Search history")
                )
                .toolbar { toolbarContent }
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

    private var groups: [HistoryDayGroup] {
        let calendar = Calendar.current
        let source: [HistoryEntry] = isSearching ? store.search(trimmedQuery, limit: 300) : store.entries
        var days: [Date] = []
        var buckets: [Date: [HistoryEntry]] = [:]
        for entry in source {
            let day = calendar.startOfDay(for: entry.visitedAt)
            if buckets[day] == nil {
                days.append(day)
                buckets[day] = [entry]
            } else {
                buckets[day]?.append(entry)
            }
        }
        days.sort { lhs, rhs in lhs > rhs }
        var result: [HistoryDayGroup] = []
        for day in days {
            let entries = (buckets[day] ?? []).sorted { lhs, rhs in lhs.visitedAt > rhs.visitedAt }
            result.append(HistoryDayGroup(day: day, entries: entries))
        }
        return result
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let shown = groups
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
                message: "Nothing in your history matches “\(trimmedQuery)”."
            )
        } else {
            PagesEmptyState(
                systemImage: "clock",
                title: "No history yet",
                message: "Pages you visit show up here. Private tabs never leave a trace."
            )
        }
    }

    private func list(_ shown: [HistoryDayGroup]) -> some View {
        List {
            ForEach(shown) { group in
                Section {
                    ForEach(group.entries) { entry in
                        row(entry)
                    }
                    .listRowBackground(Color.lumaSolid)
                } header: {
                    Text(group.title)
                }
            }
        }
        .listStyle(.insetGrouped)
        .pagesListBackground()
    }

    private func row(_ entry: HistoryEntry) -> some View {
        Button {
            open(entry)
        } label: {
            PagesSiteRow(
                title: entry.title,
                url: entry.url,
                trailing: entry.visitedAt.formatted(date: .omitted, time: .shortened)
            )
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                store.remove(id: entry.id)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .contextMenu {
            Button {
                open(entry)
            } label: {
                Label("Open", systemImage: "arrow.up.right.square")
            }
            Button {
                UIPasteboard.general.string = entry.url
            } label: {
                Label("Copy Link", systemImage: "doc.on.doc")
            }
            Button(role: .destructive) {
                store.remove(id: entry.id)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Clear…") {
                showsClearDialog = true
            }
            .disabled(store.entries.isEmpty)
            .confirmationDialog(
                "Clear history",
                isPresented: $showsClearDialog,
                titleVisibility: .visible
            ) {
                Button("Last hour", role: .destructive) {
                    store.clear(since: Date().addingTimeInterval(-3600))
                }
                Button("Today", role: .destructive) {
                    store.clear(since: Calendar.current.startOfDay(for: Date()))
                }
                Button("All history", role: .destructive) {
                    store.clear(since: nil)
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes the visited pages from this device. It can't be undone.")
            }
        }
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") {
                dismiss()
            }
        }
    }

    // MARK: Actions

    private func open(_ entry: HistoryEntry) {
        guard let url = URL(string: entry.url) else { return }
        onOpen(url)
        dismiss()
    }
}
