import SwiftUI

/// A moon whose lit part follows `phase` (0 = new, 0.5 = full, 1 = new) — lit from the right while
/// waxing and from the left while waning, as seen from the north. Same drawing as the desktop app.
struct MoonPhaseView: View {
    let phase: Double
    let size: CGFloat

    init(phase: Double, size: CGFloat) {
        self.phase = phase
        self.size = size
    }

    private var normalized: Double {
        let p = phase.truncatingRemainder(dividingBy: 1)
        return p < 0 ? p + 1 : p
    }

    private var lit: Double { (1 - cos(2 * Double.pi * normalized)) / 2 }

    /// The drawing uses a 40-unit box with a disc of radius 17, like the desktop SVG.
    private var unit: CGFloat { size / 40 }

    var body: some View {
        let litShape = MoonLitShape(lit: lit, waxing: normalized < 0.5)
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [MoonPalette.glow, MoonPalette.glow.opacity(0)],
                                     center: .center, startRadius: 14 * unit, endRadius: 20 * unit))
                .opacity(0.1 + 0.3 * lit)
            Circle()
                .fill(MoonPalette.dark)
                .overlay(Circle().stroke(MoonPalette.glow.opacity(0.35), lineWidth: max(0.5, unit)))
                .padding(3 * unit)
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [MoonPalette.litCore, MoonPalette.litMid, MoonPalette.litEdge],
                                         center: UnitPoint(x: 0.38, y: 0.32),
                                         startRadius: 0, endRadius: 27 * unit))
                    .padding(3 * unit)
                crater(x: 25, y: 14, r: 2.6, opacity: 0.28)
                crater(x: 29, y: 24, r: 1.8, opacity: 0.25)
                crater(x: 20, y: 27, r: 3.2, opacity: 0.20)
                crater(x: 13, y: 17, r: 1.6, opacity: 0.22)
            }
            .frame(width: size, height: size)
            .clipShape(litShape)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func crater(x: CGFloat, y: CGFloat, r: CGFloat, opacity: Double) -> some View {
        Circle()
            .fill(MoonPalette.crater.opacity(opacity))
            .frame(width: 2 * r * unit, height: 2 * r * unit)
            .position(x: x * unit, y: y * unit)
    }
}

private enum MoonPalette {
    static let glow = Color(red: 185 / 255, green: 174 / 255, blue: 251 / 255)
    static let dark = Color(red: 34 / 255, green: 27 / 255, blue: 71 / 255)
    static let litCore = Color(red: 253 / 255, green: 251 / 255, blue: 255 / 255)
    static let litMid = Color(red: 221 / 255, green: 214 / 255, blue: 255 / 255)
    static let litEdge = Color(red: 168 / 255, green: 156 / 255, blue: 242 / 255)
    static let crater = Color(red: 143 / 255, green: 130 / 255, blue: 224 / 255)
}

/// The lit part of the disc: the outer limb on one side, closed by the terminator (a half ellipse
/// that bulges into the lit half for a crescent and out of it for a gibbous moon).
private struct MoonLitShape: Shape {
    let lit: Double
    let waxing: Bool

    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let radius = side * 17 / 40
        let cx = rect.midX
        let cy = rect.midY
        let direction: CGFloat = waxing ? 1 : -1
        let terminator = CGFloat(1 - 2 * lit)
        let steps = 48

        var path = Path()
        // Limb: top → lit side → bottom.
        for i in 0...steps {
            let t = Double.pi * Double(i) / Double(steps)
            let point = CGPoint(x: cx + direction * radius * CGFloat(sin(t)),
                                y: cy - radius * CGFloat(cos(t)))
            if i == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }
        // Terminator: bottom → top.
        for i in stride(from: steps, through: 0, by: -1) {
            let t = Double.pi * Double(i) / Double(steps)
            path.addLine(to: CGPoint(x: cx + direction * terminator * radius * CGFloat(sin(t)),
                                     y: cy - radius * CGFloat(cos(t))))
        }
        path.closeSubpath()
        return path
    }
}
