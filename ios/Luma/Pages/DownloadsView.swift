import SwiftUI
import UIKit
import QuickLook

@MainActor
struct DownloadsView: View {
    @EnvironmentObject private var downloads: DownloadManager
    @Environment(\.dismiss) private var dismiss

    @State private var previewURL: URL?
    @State private var showsMissingFile: Bool = false

    init() {}

    var body: some View {
        NavigationStack {
            content
                .pagesNavigation(title: "Downloads")
                .toolbar { toolbarContent }
                .quickLookPreview($previewURL)
                .alert("File not found", isPresented: $showsMissingFile) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text("The file was moved or deleted. You can find your downloads in the Files app under Luma.")
                }
        }
        .tint(Color.lumaAccent)
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if downloads.items.isEmpty {
            PagesEmptyState(
                systemImage: "arrow.down.circle",
                title: "No downloads",
                message: "Files you download show up here and in the Files app."
            )
        } else {
            list
        }
    }

    private var list: some View {
        List {
            ForEach(downloads.items) { item in
                row(item)
            }
            .listRowBackground(Color.lumaSolid)
        }
        .listStyle(.insetGrouped)
        .pagesListBackground()
    }

    private func row(_ item: DownloadItem) -> some View {
        HStack(spacing: 12) {
            Button {
                open(item)
            } label: {
                DownloadRowLabel(item: item)
            }
            .buttonStyle(.plain)
            .disabled(item.state != .finished)

            trailingControl(item)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                downloads.remove(id: item.id, deleteFile: true)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .contextMenu {
            contextMenu(item)
        }
    }

    @ViewBuilder
    private func trailingControl(_ item: DownloadItem) -> some View {
        if item.state == .inProgress {
            Button {
                downloads.cancel(id: item.id)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Color.lumaTextMuted)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Cancel download")
        } else if item.state == .finished, let url = existingFile(item) {
            ShareLink(item: url) {
                Image(systemName: "square.and.arrow.up")
                    .font(.body)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Share")
        }
    }

    @ViewBuilder
    private func contextMenu(_ item: DownloadItem) -> some View {
        if item.state == .finished {
            Button {
                open(item)
            } label: {
                Label("Open", systemImage: "eye")
            }
        }
        if item.state == .inProgress {
            Button {
                downloads.cancel(id: item.id)
            } label: {
                Label("Cancel", systemImage: "xmark.circle")
            }
        }
        Button {
            UIPasteboard.general.string = item.sourceURL
        } label: {
            Label("Copy Download Link", systemImage: "doc.on.doc")
        }
        Button {
            downloads.remove(id: item.id, deleteFile: false)
        } label: {
            Label("Remove from List", systemImage: "minus.circle")
        }
        Button(role: .destructive) {
            downloads.remove(id: item.id, deleteFile: true)
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Clear") {
                downloads.clearFinished()
            }
            .disabled(!hasClearableItems)
            .accessibilityLabel("Clear finished downloads from the list")
        }
        ToolbarItem(placement: .confirmationAction) {
            Button("Done") {
                dismiss()
            }
        }
    }

    // MARK: Helpers

    private var hasClearableItems: Bool {
        downloads.items.contains { item in item.state != .inProgress }
    }

    private func existingFile(_ item: DownloadItem) -> URL? {
        guard let url = item.localURL, FileManager.default.fileExists(atPath: url.path) else {
            return nil
        }
        return url
    }

    private func open(_ item: DownloadItem) {
        guard item.state == .finished else { return }
        if let url = existingFile(item) {
            previewURL = url
        } else {
            showsMissingFile = true
        }
    }
}

// MARK: - Row label

private struct DownloadRowLabel: View {
    let item: DownloadItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.title2)
                .foregroundStyle(iconColor)
                .frame(width: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.filename)
                    .font(.body)
                    .foregroundStyle(Color.lumaText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                progress
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(detailColor)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var progress: some View {
        if item.state == .inProgress {
            if item.fraction >= 0 {
                ProgressView(value: min(max(item.fraction, 0), 1))
                    .tint(Color.lumaAccent)
            } else {
                ProgressView()
                    .progressViewStyle(.linear)
                    .tint(Color.lumaAccent)
            }
        }
    }

    private var iconName: String {
        switch item.state {
        case .inProgress: return "arrow.down.circle"
        case .finished: return "doc.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .cancelled: return "xmark.circle"
        }
    }

    private var iconColor: Color {
        switch item.state {
        case .inProgress: return Color.lumaAccent
        case .finished: return Color.lumaTextMuted
        case .failed: return Color.lumaDanger
        case .cancelled: return Color.lumaTextFaint
        }
    }

    private var detailColor: Color {
        switch item.state {
        case .failed: return Color.lumaDanger
        default: return Color.lumaTextMuted
        }
    }

    private var sizeText: String? {
        guard item.totalBytes >= 0 else { return nil }
        return ByteCountFormatter.string(fromByteCount: item.totalBytes, countStyle: .file)
    }

    private var host: String {
        Display.shortHost(item.sourceURL)
    }

    private var detail: String {
        switch item.state {
        case .inProgress:
            var parts: [String] = []
            if item.fraction >= 0 {
                let percent = Int((min(max(item.fraction, 0), 1) * 100).rounded())
                parts.append("\(percent)%")
            } else {
                parts.append("Downloading…")
            }
            if let sizeText = sizeText {
                parts.append("of \(sizeText)")
            }
            return parts.joined(separator: " ")
        case .finished:
            var parts: [String] = []
            if let sizeText = sizeText {
                parts.append(sizeText)
            }
            if !host.isEmpty {
                parts.append(host)
            }
            parts.append(item.startedAt.formatted(date: .abbreviated, time: .shortened))
            return parts.joined(separator: " · ")
        case .failed(let message):
            return message.isEmpty ? "Download failed" : "Failed: \(message)"
        case .cancelled:
            return "Cancelled"
        }
    }
}
