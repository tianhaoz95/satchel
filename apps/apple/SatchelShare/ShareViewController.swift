import SatchelKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Share to Satchel": sends a PDF or image from any app to the node's Inbox folder, using the
/// credentials the main app stored in the shared keychain group.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareView(items: extensionContext?.inputItems as? [NSExtensionItem] ?? []) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }
}

struct ShareView: View {
    let items: [NSExtensionItem]
    let done: () -> Void
    @State private var status = "Sending to Satchel…"
    @State private var finished = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: finished ? "checkmark.circle" : "tray.and.arrow.down").font(.largeTitle).foregroundStyle(Theme.accent)
            Text(status).multilineTextAlignment(.center)
            if finished { Button("Done", action: done).buttonStyle(.borderedProminent) }
        }
        .padding(24)
        .task { await send() }
    }

    private func send() async {
        guard let creds = Credentials.load() else {
            status = "Open Satchel and pair it with your node first."
            finished = true
            return
        }
        let client = NodeClient(creds)
        var count = 0
        for provider in items.flatMap({ $0.attachments ?? [] }) {
            for type in [UTType.pdf, UTType.image] where provider.hasItemConformingToTypeIdentifier(type.identifier) {
                if let data = try? await loadData(provider, type) {
                    let ext = type == .pdf ? "pdf" : "jpg"
                    _ = try? await client.capture(data, filename: "\(provider.suggestedName ?? "Shared").\(ext)", contentType: type == .pdf ? "application/pdf" : "image/jpeg", note: "")
                    count += 1
                }
                break
            }
        }
        status = count > 0 ? "Saved \(count) item\(count == 1 ? "" : "s") to your Inbox." : "Nothing Satchel can keep here (PDFs and images only)."
        finished = true
    }

    private func loadData(_ provider: NSItemProvider, _ type: UTType) async throws -> Data {
        try await withCheckedThrowingContinuation { cont in
            _ = provider.loadDataRepresentation(for: type) { data, error in
                if let data { cont.resume(returning: data) } else { cont.resume(throwing: error ?? NodeError.invalidResponse) }
            }
        }
    }
}
