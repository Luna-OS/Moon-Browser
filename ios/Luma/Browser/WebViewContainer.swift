import SwiftUI
import UIKit
import WebKit

/// Hosts `tab.webView` and swaps the hosted web view when the tab changes.
/// No web view is created for a tab that is still showing the new tab page.
struct WebViewContainer: UIViewRepresentable {
    @ObservedObject private var tab: Tab

    init(tab: Tab) {
        _tab = ObservedObject(wrappedValue: tab)
    }

    func makeUIView(context: Context) -> BrowserWebHostView {
        let host = BrowserWebHostView()
        host.backgroundColor = .clear
        return host
    }

    func updateUIView(_ uiView: BrowserWebHostView, context: Context) {
        if tab.hasWebView || tab.url != nil {
            uiView.show(tab.webView)
        } else {
            uiView.show(nil)
        }
    }

    static func dismantleUIView(_ uiView: BrowserWebHostView, coordinator: ()) {
        uiView.show(nil)
    }
}

/// Plain container: the web view always fills it.
final class BrowserWebHostView: UIView {
    private weak var hosted: WKWebView?

    func show(_ webView: WKWebView?) {
        if let current = hosted, current === webView, current.superview === self {
            return
        }
        if let current = hosted, current.superview === self {
            current.removeFromSuperview()
        }
        hosted = webView
        guard let webView else { return }
        // A web view lives in one host at a time; adding it here takes it out of any previous one.
        webView.frame = bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(webView)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if let hosted, hosted.superview === self, hosted.frame != bounds {
            hosted.frame = bounds
        }
    }
}
