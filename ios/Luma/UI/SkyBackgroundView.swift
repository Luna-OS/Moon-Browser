import SwiftUI

/// Decorative night sky: gradient night950 → night800, a faint violet haze and subtle stars.
struct SkyBackgroundView: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color.night950, Color.night800], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Color.violet700.opacity(0.35), Color.violet700.opacity(0)],
                           center: UnitPoint(x: 0.5, y: 0), startRadius: 0, endRadius: 520)
            Canvas { context, size in
                for star in skyStars {
                    let rect = CGRect(x: star.x * size.width - star.radius,
                                      y: star.y * size.height - star.radius,
                                      width: star.radius * 2, height: star.radius * 2)
                    context.fill(Path(ellipseIn: rect), with: .color(Color.white.opacity(star.opacity)))
                }
            }
        }
        .accessibilityHidden(true)
    }
}

private struct SkyStar {
    let x: CGFloat
    let y: CGFloat
    let radius: CGFloat
    let opacity: Double
}

/// A fixed star field (deterministic, so it never jumps between renders).
private let skyStars: [SkyStar] = {
    var seed: UInt64 = 0x4C55_4D41
    func next() -> Double {
        seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return Double((seed >> 33) % 10_000) / 10_000
    }
    var stars: [SkyStar] = []
    for _ in 0..<90 {
        let x = next()
        let y = next()
        let size = next()
        let glow = next()
        // Fewer and fainter stars towards the bottom.
        let fade = 1 - 0.6 * y
        stars.append(SkyStar(x: CGFloat(x), y: CGFloat(y),
                             radius: CGFloat(0.5 + size * 0.9),
                             opacity: (0.15 + glow * 0.55) * fade))
    }
    return stars
}()
