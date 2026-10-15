import PDFKit
import PhotosUI
import SatchelKit
import SwiftUI
import VisionKit

/// Scan a document (VisionKit), pick a photo or a file; it lands in the vault's Inbox folder.
struct CaptureView: View {
    @EnvironmentObject var model: AppModel
    @State private var note = ""
    @State private var scanning = false
    @State private var photo: PhotosPickerItem?
    @State private var importing = false
    @State private var saved: String?

    var body: some View {
        Form {
            Section {
                Button {
                    scanning = true
                } label: {
                    Label("Scan a document", systemImage: "doc.viewfinder")
                }
                .disabled(!VNDocumentCameraViewController.isSupported)
                PhotosPicker(selection: $photo, matching: .images) { Label("Choose a photo", systemImage: "photo") }
                Button { importing = true } label: { Label("Choose a file", systemImage: "folder") }
            } footer: {
                Text("Captures go straight to your node's Inbox folder; your agent files them next time it checks in.")
            }
            Section("Note for your agent (optional)") {
                TextField("New registration for the Civic", text: $note)
            }
            if model.busy { ProgressView("Uploading…") }
            if let saved { Label("Saved to \(saved)", systemImage: "checkmark.circle").foregroundStyle(Theme.accent) }
            if let error = model.error { ErrorRow(message: error) }
        }
        .navigationTitle("Capture")
        .sheet(isPresented: $scanning) {
            DocumentScanner { pdf in
                scanning = false
                if let pdf { upload(pdf, name: "Scan.pdf", type: "application/pdf") }
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .image]) { result in
            guard case let .success(url) = result, url.startAccessingSecurityScopedResource() else { return }
            defer { url.stopAccessingSecurityScopedResource() }
            if let data = try? Data(contentsOf: url) { upload(data, name: url.lastPathComponent, type: url.pathExtension == "pdf" ? "application/pdf" : "image/jpeg") }
        }
        .onChange(of: photo) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self) { upload(data, name: "Photo.jpg", type: "image/jpeg") }
                photo = nil
            }
        }
    }

    private func upload(_ data: Data, name: String, type: String) {
        Task {
            saved = await model.capture(data, filename: name, contentType: type, note: note)
            if saved != nil { note = "" }
        }
    }
}

/// VisionKit's document camera; pages are combined into one PDF.
struct DocumentScanner: UIViewControllerRepresentable {
    let onDone: (Data?) -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_: VNDocumentCameraViewController, context _: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onDone: (Data?) -> Void
        init(onDone: @escaping (Data?) -> Void) { self.onDone = onDone }

        func documentCameraViewController(_: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            let pdf = PDFDocument()
            for i in 0 ..< scan.pageCount {
                if let page = PDFPage(image: scan.imageOfPage(at: i)) { pdf.insert(page, at: pdf.pageCount) }
            }
            onDone(pdf.dataRepresentation())
        }

        func documentCameraViewControllerDidCancel(_: VNDocumentCameraViewController) { onDone(nil) }
        func documentCameraViewController(_: VNDocumentCameraViewController, didFailWithError _: Error) { onDone(nil) }
    }
}
