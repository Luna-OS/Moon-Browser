import SwiftUI
import UIKit

/// Luma's night-sky palette — the same tokens as the desktop app
/// (src/renderer/theme/tokens.css). The semantic colors follow light and
/// dark on their own.

private extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

private func dynamicColor(dark: UIColor, light: UIColor) -> Color {
    Color(UIColor { traits in traits.userInterfaceStyle == .light ? light : dark })
}

extension Color {
    // Raw palette
    static let night950 = Color(UIColor(hex: 0x0B0920))
    static let night900 = Color(UIColor(hex: 0x141030))
    static let night800 = Color(UIColor(hex: 0x1D1742))
    static let violet700 = Color(UIColor(hex: 0x3B2E6B))
    static let lavender400 = Color(UIColor(hex: 0xB9AEFB))
    static let lavender300 = Color(UIColor(hex: 0xD6CFFD))
    static let moon100 = Color(UIColor(hex: 0xF4F1FF))
    static let mint400 = Color(UIColor(hex: 0x7FE3C6))
    static let sky300 = Color(UIColor(hex: 0x9AD7F5))
    static let peach300 = Color(UIColor(hex: 0xF7B89A))
    static let cream100 = Color(UIColor(hex: 0xFBF7F0))

    // Semantic colors
    static let lumaBg = dynamicColor(dark: UIColor(hex: 0x0B0920), light: UIColor(hex: 0xF5F2FB))
    static let lumaText = dynamicColor(dark: UIColor(hex: 0xFBF7F0), light: UIColor(hex: 0x1C1733))
    static let lumaTextMuted = dynamicColor(
        dark: UIColor(hex: 0xFBF7F0, alpha: 0.62), light: UIColor(hex: 0x1C1733, alpha: 0.74))
    static let lumaTextFaint = dynamicColor(
        dark: UIColor(hex: 0xFBF7F0, alpha: 0.5), light: UIColor(hex: 0x1C1733, alpha: 0.63))
    static let lumaBorder = dynamicColor(
        dark: UIColor(hex: 0xB9AEFB, alpha: 0.18), light: UIColor(hex: 0x3B2E6B, alpha: 0.16))
    static let lumaBorderStrong = dynamicColor(
        dark: UIColor(hex: 0xB9AEFB, alpha: 0.36), light: UIColor(hex: 0x3B2E6B, alpha: 0.32))
    static let lumaAccent = dynamicColor(dark: UIColor(hex: 0xD6CFFD), light: UIColor(hex: 0x5B4BC4))
    static let lumaSolid = dynamicColor(dark: UIColor(hex: 0x141030), light: UIColor(hex: 0xFFFFFF))
    static let lumaPopover = dynamicColor(dark: UIColor(hex: 0x181338), light: UIColor(hex: 0xFFFFFF))
    static let lumaInset = dynamicColor(
        dark: UIColor(hex: 0x0B0920, alpha: 0.55), light: UIColor(hex: 0xF5F4F8))
    static let lumaHover = dynamicColor(
        dark: UIColor(white: 1, alpha: 0.05), light: UIColor(hex: 0x3B2E6B, alpha: 0.06))
    static let lumaSelected = dynamicColor(
        dark: UIColor(hex: 0xB9AEFB, alpha: 0.15), light: UIColor(hex: 0x7D6DE0, alpha: 0.14))
    static let lumaWarning = dynamicColor(dark: UIColor(hex: 0xF3C766), light: UIColor(hex: 0xA86B00))
    static let lumaDanger = dynamicColor(dark: UIColor(hex: 0xF28B92), light: UIColor(hex: 0xC2323D))
    static let lumaSuccess = dynamicColor(dark: UIColor(hex: 0x7FE3C6), light: UIColor(hex: 0x1D7D65))
}

/// The browser frame. Private tabs wear a deeper violet, so they are never mistaken.
enum LumaTheme {
    static let radiusMD: CGFloat = 12
    static let radiusLG: CGFloat = 20

    static func frame(isPrivate: Bool) -> Color {
        isPrivate
            ? dynamicColor(dark: UIColor(hex: 0x1D1742), light: UIColor(hex: 0xDDD5F5))
            : dynamicColor(dark: UIColor(hex: 0x0B0920), light: UIColor(hex: 0xECE7F7))
    }

    static func toolbar(isPrivate: Bool) -> Color {
        isPrivate
            ? dynamicColor(dark: UIColor(hex: 0x251D52), light: UIColor(hex: 0xEBE5FB))
            : dynamicColor(dark: UIColor(hex: 0x141030), light: UIColor(hex: 0xF7F4FD))
    }

    static func tabActive(isPrivate: Bool) -> Color {
        isPrivate
            ? dynamicColor(dark: UIColor(hex: 0x32286A), light: UIColor(hex: 0xF8F6FF))
            : dynamicColor(dark: UIColor(hex: 0x1D1742), light: UIColor(hex: 0xFFFFFF))
    }

    static func omnibox(isPrivate: Bool) -> Color {
        isPrivate
            ? dynamicColor(dark: UIColor(hex: 0x1A1440), light: UIColor(hex: 0xFFFFFF))
            : dynamicColor(dark: UIColor(hex: 0x0E0B26), light: UIColor(hex: 0xFFFFFF))
    }
}

private struct LumaGlass: ViewModifier {
    let cornerRadius: CGFloat

    private static let top = dynamicColor(
        dark: UIColor(hex: 0x1D1742, alpha: 0.62), light: UIColor(white: 1, alpha: 0.82))
    private static let bottom = dynamicColor(
        dark: UIColor(hex: 0x141030, alpha: 0.7), light: UIColor(white: 1, alpha: 0.7))

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(
                shape.fill(
                    LinearGradient(
                        colors: [LumaGlass.top, LumaGlass.bottom], startPoint: .top, endPoint: .bottom))
            )
            .overlay(shape.strokeBorder(Color.lumaBorder, lineWidth: 1))
            .clipShape(shape)
    }
}

extension View {
    /// A translucent card with a hairline border, as on the desktop new tab page.
    func lumaGlass(cornerRadius: CGFloat = 20) -> some View {
        modifier(LumaGlass(cornerRadius: cornerRadius))
    }
}
