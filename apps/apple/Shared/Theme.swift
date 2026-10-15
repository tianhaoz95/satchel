import SwiftUI

/// Flat visual language shared with the web app: one green accent, quiet surfaces, no depth effects.
enum Theme {
    static let accent = Color(red: 0.122, green: 0.435, blue: 0.314)
    static let warn = Color(red: 0.63, green: 0.36, blue: 0.03)
    static let danger = Color(red: 0.71, green: 0.14, blue: 0.09)

    static func daysLabel(_ days: Int) -> String {
        days < 0 ? "\(-days) d late" : days == 0 ? "today" : "\(days) d"
    }

    static func daysColor(_ days: Int) -> Color {
        days < 0 ? danger : days <= 60 ? warn : accent
    }
}

struct Pill: View {
    let text: String
    var color: Color = Theme.accent

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }
}
