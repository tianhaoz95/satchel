import AVFoundation
import SatchelKit
import SwiftUI
import VisionKit

struct PairView: View {
    @EnvironmentObject var model: AppModel
    @State private var scanning = false
    @State private var pasted = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "briefcase.fill").font(.largeTitle).foregroundStyle(Theme.accent)
                        Text("Pair with your Satchel node").font(.title.bold())
                        Text("On your computer, open Satchel → Phone → Show pairing code, then scan the QR code. This iPhone creates a signing key in its Secure Enclave; approvals will need Face ID.")
                            .foregroundStyle(.secondary)
                    }
                    if let error = model.error { ErrorRow(message: error) }
                    Button {
                        scanning = true
                    } label: {
                        Label("Scan pairing code", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!QRScanner.isAvailable)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Or paste the pairing link").font(.subheadline.weight(.semibold))
                        TextField("satchel://pair?…", text: $pasted, axis: .vertical)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(.callout.monospaced())
                            .padding(10)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
                        if let link = PairingLink(pasted) {
                            PinNote(link: link)
                            Button("Pair with \(link.nodeName)") { Task { await model.pair(link) } }
                                .buttonStyle(.bordered)
                        }
                    }
                    if model.busy { ProgressView("Pairing…") }
                }
                .padding(20)
            }
            .sheet(isPresented: $scanning) {
                QRScanner { code in
                    scanning = false
                    if let link = PairingLink(code) { Task { await model.pair(link) } } else { model.error = "That QR code isn't a Satchel pairing code." }
                }
                .ignoresSafeArea()
            }
        }
    }
}

struct PinNote: View {
    let link: PairingLink

    var body: some View {
        if link.isPinned {
            Label("Encrypted to your node's own key (pinned)", systemImage: "lock.fill").font(.footnote).foregroundStyle(Theme.accent)
        } else {
            Label("Home network only, without TLS. Connect a relay to use Satchel anywhere.", systemImage: "wifi").font(.footnote).foregroundStyle(Theme.warn)
        }
    }
}

/// Live QR scanning with VisionKit's DataScanner (needs a real camera).
struct QRScanner: UIViewControllerRepresentable {
    static var isAvailable: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_: DataScannerViewController, context _: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        var done = false
        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

        func dataScanner(_: DataScannerViewController, didAdd items: [RecognizedItem], allItems _: [RecognizedItem]) {
            for case let .barcode(code) in items {
                if let value = code.payloadStringValue, !done {
                    done = true
                    onCode(value)
                }
            }
        }
    }
}
