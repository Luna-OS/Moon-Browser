import SwiftUI

/// Centered placeholder used by the page sheets when a list has nothing to show.
struct PagesEmptyState: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(Color.lumaTextFaint)
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.lumaText)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.lumaTextMuted)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.lumaBg)
        .accessibilityElement(children: .combine)
    }
}

/// Favicon + title + address line, shared by bookmarks and history.
struct PagesSiteRow: View {
    let title: String
    let url: String
    var trailing: String? = nil

    private var shownTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? Display.shortHost(url) : trimmed
    }

    var body: some View {
        HStack(spacing: 12) {
            FaviconView(url: url, size: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(shownTitle)
                    .font(.body)
                    .foregroundStyle(Color.lumaText)
                    .lineLimit(1)
                Text(Display.prettyURL(url))
                    .font(.footnote)
                    .foregroundStyle(Color.lumaTextMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 8)
            if let trailing = trailing {
                Text(trailing)
                    .font(.footnote)
                    .foregroundStyle(Color.lumaTextFaint)
                    .lineLimit(1)
            }
        }
        .contentShape(Rectangle())
    }
}

extension View {
    /// Luma look for the lists and forms inside the page sheets.
    func pagesListBackground() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(Color.lumaBg)
    }

    /// Inline title and a navigation bar that matches the sheet background.
    func pagesNavigation(title: String) -> some View {
        self
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.lumaBg, for: .navigationBar)
    }
}
