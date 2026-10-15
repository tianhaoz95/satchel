// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "SatchelKit",
    platforms: [.iOS(.v17), .watchOS(.v10), .macOS(.v14)],
    products: [.library(name: "SatchelKit", targets: ["SatchelKit"])],
    targets: [
        .target(name: "SatchelKit"),
        .testTarget(name: "SatchelKitTests", dependencies: ["SatchelKit"]),
    ]
)
