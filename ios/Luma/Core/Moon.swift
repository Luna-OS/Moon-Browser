import Foundation

struct MoonPhaseInfo {
    /// Days since the last new moon.
    let age: Double
    /// Position in the cycle, 0 = new, 0.5 = full.
    let phase: Double
    /// Lit share of the disc, 0 … 1.
    let illumination: Double
    let name: String
    let waxing: Bool
}

/// Today's moon phase for the new tab page — from the mean synodic month,
/// which is accurate to well under a day and plenty for a greeting.
/// Ported from the desktop app (`src/shared/moon.ts`, `format.ts`).
enum Moon {
    private static let synodicMonth = 29.530588853
    /// A known new moon: 2000-01-06 18:14 UTC, in seconds since 1970.
    private static let referenceNewMoon: TimeInterval = 947_182_440
    private static let day: TimeInterval = 86_400

    private static let names = [
        "New moon",
        "Waxing crescent",
        "First quarter",
        "Waxing gibbous",
        "Full moon",
        "Waning gibbous",
        "Last quarter",
        "Waning crescent",
    ]

    static func phase(at date: Date) -> MoonPhaseInfo {
        let days = (date.timeIntervalSince1970 - referenceNewMoon) / day
        var age = days.truncatingRemainder(dividingBy: synodicMonth)
        if age < 0 { age += synodicMonth }
        if age >= synodicMonth { age = 0 }
        let phase = age / synodicMonth
        let illumination = (1 - cos(2 * Double.pi * phase)) / 2
        // Each named phase spans an eighth of the cycle, centered on its point.
        let index = Int((phase * 8).rounded()) % 8
        return MoonPhaseInfo(age: age, phase: phase, illumination: illumination, name: names[index], waxing: phase < 0.5)
    }

    static func greeting(hour: Int) -> String {
        if hour < 5 { return "Good night" }
        if hour < 12 { return "Good morning" }
        if hour < 18 { return "Good afternoon" }
        if hour < 22 { return "Good evening" }
        return "Good night"
    }
}
