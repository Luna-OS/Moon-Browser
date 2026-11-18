import SwiftUI

/// Shown instead of the page when a navigation failed.
struct ErrorPageView: View {
    @ObservedObject var tab: Tab
    let error: TabLoadError

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 14) {
                    Image(systemName: "moon.zzz.fill")
                        .font(.system(size: 52))
                        .foregroundStyle(Color.lumaAccent)
                        .accessibilityHidden(true)
                    Text(error.title)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Color.lumaText)
                        .multilineTextAlignment(.center)
                    Text(error.message)
                        .font(.body)
                        .foregroundStyle(Color.lumaTextMuted)
                        .multilineTextAlignment(.center)
                    if let failed = error.failedURL {
                        Text(Display.prettyURL(failed.absoluteString))
                            .font(.footnote.monospaced())
                            .foregroundStyle(Color.lumaTextFaint)
                            .lineLimit(2)
                            .truncationMode(.middle)
                            .multilineTextAlignment(.center)
                    }
                    buttons
                        .padding(.top, 8)
                }
                .padding(28)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .frame(minHeight: geo.size.height)
            }
        }
        .background(Color.lumaBg)
    }

    private var buttons: some View {
        VStack(spacing: 10) {
            Button {
                tab.reload()
            } label: {
                Label("Retry", systemImage: "arrow.clockwise")
                    .frame(minWidth: 160)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            if error.canTryHTTP {
                Button("Continue with HTTP") {
                    tab.retryOverHTTP()
                }
                .controlSize(.large)
                Text("The connection will not be encrypted.")
                    .font(.caption)
                    .foregroundStyle(Color.lumaTextFaint)
            }
        }
    }
}
