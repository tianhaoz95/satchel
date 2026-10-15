import SatchelKit
import SwiftUI
import UIKit
import UserNotifications

@main
struct SatchelApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .tint(Theme.accent)
                .onOpenURL { url in
                    if let link = PairingLink(url.absoluteString) { Task { await model.pair(link) } }
                }
                .task {
                    AppDelegate.model = model
                    WatchSync.shared.activate(model: model)
                    #if DEBUG
                        let args = ProcessInfo.processInfo.arguments
                        if let i = args.firstIndex(of: "-SatchelPairLink"), i + 1 < args.count, !model.isPaired, let link = PairingLink(args[i + 1]) {
                            await model.pair(link)
                        }
                    #endif
                    await model.refresh()
                }
                .onChange(of: phase) { _, p in
                    if p == .active { Task { await model.refresh() } }
                }
        }
    }
}

/// Push: the gateway sends a content-free alert; tapping it opens Approvals and the app fetches
/// details from the node over the pinned connection.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    @MainActor static weak var model: AppModel?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let review = UNNotificationAction(identifier: "REVIEW", title: "Review", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "APPROVAL", actions: [review], intentIdentifiers: []),
            UNNotificationCategory(identifier: "DELIVERY", actions: [], intentIdentifiers: []),
        ])
        return true
    }

    func application(_: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await Self.model?.registerPush(token: deviceToken) }
    }

    func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let kind = response.notification.request.content.userInfo["kind"] as? String
        await MainActor.run {
            Self.model?.tab = kind == "delivery" ? .inbox : .approvals
        }
        await Self.model?.refresh()
    }

    func userNotificationCenter(_: UNUserNotificationCenter, willPresent _: UNNotification) async -> UNNotificationPresentationOptions {
        await Self.model?.refresh()
        return [.banner, .badge, .sound]
    }
}

enum PushRegistrar {
    static func requestAuthorization() {
        Task {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted { await MainActor.run { UIApplication.shared.registerForRemoteNotifications() } }
        }
    }
}
