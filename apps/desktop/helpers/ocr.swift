// satchel-ocr <file>: prints recognized text using Apple's on-device Vision framework.
import Foundation
import Vision
import AppKit
import PDFKit

func images(for url: URL) -> [CGImage] {
  if url.pathExtension.lowercased() == "pdf", let doc = PDFDocument(url: url) {
    var out: [CGImage] = []
    for i in 0..<min(doc.pageCount, 20) {
      guard let page = doc.page(at: i) else { continue }
      let bounds = page.bounds(for: .mediaBox)
      let scale: CGFloat = 2
      let img = NSImage(size: NSSize(width: bounds.width * scale, height: bounds.height * scale))
      img.lockFocus()
      NSColor.white.set()
      NSRect(origin: .zero, size: img.size).fill()
      if let ctx = NSGraphicsContext.current?.cgContext {
        ctx.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: ctx)
      }
      img.unlockFocus()
      if let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) { out.append(cg) }
    }
    return out
  }
  guard let img = NSImage(contentsOf: url), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return [] }
  return [cg]
}

guard CommandLine.arguments.count > 1 else { FileHandle.standardError.write("usage: satchel-ocr <file>\n".data(using: .utf8)!); exit(2) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
var pages: [String] = []
for cg in images(for: url) {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  try? VNImageRequestHandler(cgImage: cg).perform([req])
  let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
  pages.append(lines.joined(separator: "\n"))
}
print(pages.joined(separator: "\n\n"))
