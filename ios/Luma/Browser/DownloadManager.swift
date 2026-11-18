import Foundation
import UIKit
import WebKit

/// Receives `WKDownload`s from the tabs and stores the files in Documents/Downloads.
@MainActor
final class DownloadManager: NSObject, ObservableObject {
    static let shared = DownloadManager()

    @Published private(set) var items: [DownloadItem] = []

    private var downloads: [UUID: WKDownload] = [:]
    private var ids: [ObjectIdentifier: UUID] = [:]
    private var observations: [UUID: NSKeyValueObservation] = [:]

    private override init() {
        super.init()
        loadFinished()
    }

    // MARK: - Contract

    func cancel(id: UUID) {
        guard let index = items.firstIndex(where: { $0.id == id }), items[index].state == .inProgress else { return }
        items[index].state = .cancelled
        let partial = items[index].localURL
        items[index].localURL = nil
        if let download = downloads[id] {
            download.cancel { _ in }
        }
        forget(id: id)
        if let partial {
            try? FileManager.default.removeItem(at: partial)
        }
    }

    func remove(id: UUID, deleteFile: Bool) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        if items[index].state == .inProgress {
            cancel(id: id)
        }
        guard let current = items.firstIndex(where: { $0.id == id }) else { return }
        let item = items.remove(at: current)
        if deleteFile, let file = item.localURL {
            try? FileManager.default.removeItem(at: file)
        }
        saveFinished()
    }

    /// Removes everything that is no longer running from the list (the files stay).
    func clearFinished() {
        items.removeAll(where: { $0.state != .inProgress })
        saveFinished()
    }

    // MARK: - Used by Tab

    func adopt(_ download: WKDownload) {
        let id = UUID()
        let source = download.originalRequest?.url
        var name = source?.lastPathComponent ?? ""
        if name.isEmpty || name == "/" { name = "Download" }
        let item = DownloadItem(id: id,
                                filename: name,
                                sourceURL: source?.absoluteString ?? "",
                                state: .inProgress,
                                fraction: -1,
                                totalBytes: -1,
                                localURL: nil,
                                startedAt: Date())
        items.insert(item, at: 0)
        downloads[id] = download
        ids[ObjectIdentifier(download)] = id
        download.delegate = self
        observations[id] = DownloadManager.observeProgress(download.progress) { [weak self] fraction, total in
            Task { @MainActor [weak self] in
                self?.progressChanged(id: id, fraction: fraction, total: total)
            }
        }
    }

    // MARK: - Internals

    /// Progress KVO may fire off the main thread, so the observer is built outside the main actor.
    private nonisolated static func observeProgress(_ progress: Progress,
                                                    handler: @escaping @Sendable (Double, Int64) -> Void) -> NSKeyValueObservation {
        progress.observe(\.fractionCompleted, options: [.new]) { observed, _ in
            handler(observed.fractionCompleted, observed.totalUnitCount)
        }
    }

    private func progressChanged(id: UUID, fraction: Double, total: Int64) {
        guard let index = items.firstIndex(where: { $0.id == id }), items[index].state == .inProgress else { return }
        if total > 0, items[index].totalBytes != total {
            items[index].totalBytes = total
        }
        guard total > 0, fraction.isFinite else { return }
        let clamped = min(max(fraction, 0), 1)
        // Publish in whole percent steps only: the list would otherwise redraw on every chunk.
        if items[index].fraction < 0 || abs(clamped - items[index].fraction) >= 0.01 || clamped >= 1 {
            if items[index].fraction != clamped {
                items[index].fraction = clamped
            }
        }
    }

    private func forget(id: UUID) {
        observations[id]?.invalidate()
        observations[id] = nil
        if let download = downloads.removeValue(forKey: id) {
            ids[ObjectIdentifier(download)] = nil
        }
    }

    private func itemIndex(for download: WKDownload) -> Int? {
        guard let id = ids[ObjectIdentifier(download)] else { return nil }
        return items.firstIndex(where: { $0.id == id })
    }

    private static func downloadsDirectory() -> URL? {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
        let directory = documents.appendingPathComponent("Downloads", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        return directory
    }

    private static func sanitize(_ filename: String) -> String {
        var name = filename.replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .replacingOccurrences(of: "\\", with: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while name.hasPrefix(".") { name.removeFirst() }
        if name.isEmpty { name = "Download" }
        if name.count > 180 {
            let ext = (name as NSString).pathExtension
            let stem = String(((name as NSString).deletingPathExtension).prefix(160))
            name = ext.isEmpty ? stem : stem + "." + ext
        }
        return name
    }

    /// "file.pdf", "file (2).pdf", … — WebKit refuses a destination that already exists.
    private static func uniqueURL(in directory: URL, filename: String) -> URL {
        let fm = FileManager.default
        var candidate = directory.appendingPathComponent(filename)
        guard fm.fileExists(atPath: candidate.path) else { return candidate }
        let ext = (filename as NSString).pathExtension
        let stem = (filename as NSString).deletingPathExtension
        var counter = 2
        while counter < 10_000 {
            let name = ext.isEmpty ? "\(stem) (\(counter))" : "\(stem) (\(counter)).\(ext)"
            candidate = directory.appendingPathComponent(name)
            if !fm.fileExists(atPath: candidate.path) { return candidate }
            counter += 1
        }
        return directory.appendingPathComponent(UUID().uuidString + "-" + filename)
    }

    // MARK: - Remembering finished downloads

    private struct FinishedRecord: Codable {
        var id: UUID
        var filename: String
        var sourceURL: String
        var totalBytes: Int64
        var startedAt: Date
    }

    private static func recordsFileURL() -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let directory = base.appendingPathComponent("Luma", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("downloads.json")
    }

    private func saveFinished() {
        guard let file = DownloadManager.recordsFileURL() else { return }
        var records: [FinishedRecord] = []
        for item in items where item.state == .finished {
            guard let local = item.localURL else { continue }
            // The container path changes between launches: store the file name only.
            records.append(FinishedRecord(id: item.id,
                                          filename: local.lastPathComponent,
                                          sourceURL: item.sourceURL,
                                          totalBytes: item.totalBytes,
                                          startedAt: item.startedAt))
        }
        if let data = try? JSONEncoder().encode(records) {
            try? data.write(to: file, options: [.atomic])
        }
    }

    private func loadFinished() {
        guard let file = DownloadManager.recordsFileURL(),
              let data = try? Data(contentsOf: file),
              let records = try? JSONDecoder().decode([FinishedRecord].self, from: data),
              let directory = DownloadManager.downloadsDirectory() else { return }
        var restored: [DownloadItem] = []
        for record in records {
            let local = directory.appendingPathComponent(record.filename)
            guard FileManager.default.fileExists(atPath: local.path) else { continue }
            restored.append(DownloadItem(id: record.id,
                                         filename: record.filename,
                                         sourceURL: record.sourceURL,
                                         state: .finished,
                                         fraction: 1,
                                         totalBytes: record.totalBytes,
                                         localURL: local,
                                         startedAt: record.startedAt))
        }
        items = restored
    }
}

// MARK: - WKDownloadDelegate

extension DownloadManager: WKDownloadDelegate {
    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        guard let index = itemIndex(for: download), items[index].state == .inProgress,
              let directory = DownloadManager.downloadsDirectory() else {
            completionHandler(nil)
            return
        }
        let destination = DownloadManager.uniqueURL(in: directory, filename: DownloadManager.sanitize(suggestedFilename))
        items[index].filename = destination.lastPathComponent
        items[index].localURL = destination
        if response.expectedContentLength > 0 {
            items[index].totalBytes = response.expectedContentLength
        }
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let index = itemIndex(for: download) else { return }
        let id = items[index].id
        if items[index].state == .inProgress {
            items[index].state = .finished
            items[index].fraction = 1
            if let local = items[index].localURL,
               let attributes = try? FileManager.default.attributesOfItem(atPath: local.path),
               let size = attributes[.size] as? NSNumber {
                items[index].totalBytes = size.int64Value
            }
        }
        forget(id: id)
        saveFinished()
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let index = itemIndex(for: download) else { return }
        let id = items[index].id
        if items[index].state == .inProgress {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                items[index].state = .cancelled
            } else {
                items[index].state = .failed(error.localizedDescription)
            }
            if let partial = items[index].localURL {
                try? FileManager.default.removeItem(at: partial)
            }
            items[index].localURL = nil
        }
        forget(id: id)
    }
}
