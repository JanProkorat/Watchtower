// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "WatchtowerCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "WatchtowerCore", targets: ["WatchtowerCore"]),
        .library(name: "WatchtowerBridge", targets: ["WatchtowerBridge"]),
    ],
    dependencies: [
        .package(url: "https://github.com/pointfreeco/swift-composable-architecture", from: "1.15.0"),
        .package(url: "https://github.com/supabase/supabase-swift", from: "2.0.0"),
    ],
    targets: [
        .target(
            name: "WatchtowerCore",
            dependencies: [
                .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
                .product(name: "Supabase", package: "supabase-swift"),
            ]
        ),
        .target(
            name: "WatchtowerBridge",
            dependencies: [
                "WatchtowerCore",
                .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
            ]
        ),
        .testTarget(
            name: "WatchtowerCoreTests",
            dependencies: ["WatchtowerCore"]
        ),
        .testTarget(
            name: "WatchtowerBridgeTests",
            dependencies: ["WatchtowerBridge"]
        ),
    ]
)
