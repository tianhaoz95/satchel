import SatchelKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        if model.isPaired {
            TabView(selection: $model.tab) {
                ApprovalsView()
                    .tabItem { Label("Approve", systemImage: "checkmark.shield") }
                    .badge(model.pendingCount)
                    .tag(AppModel.Tab.approvals)
                NavigationStack { InboxView() }
                    .tabItem { Label("Inbox", systemImage: "tray") }
                    .tag(AppModel.Tab.inbox)
                NavigationStack { UpcomingView() }
                    .tabItem { Label("Upcoming", systemImage: "calendar") }
                    .tag(AppModel.Tab.upcoming)
                NavigationStack { CaptureView() }
                    .tabItem { Label("Capture", systemImage: "doc.viewfinder") }
                    .tag(AppModel.Tab.capture)
                NavigationStack { SettingsView() }
                    .tabItem { Label("Settings", systemImage: "gearshape") }
                    .tag(AppModel.Tab.settings)
            }
        } else {
            PairView()
        }
    }
}

/// Error banner shown at the top of lists.
struct ErrorRow: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(Theme.danger)
    }
}
