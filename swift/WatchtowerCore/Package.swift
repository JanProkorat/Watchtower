// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "WatchtowerCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "WatchtowerCore", targets: ["WatchtowerCore"]),
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
        .testTarget(
            name: "WatchtowerCoreTests",
            dependencies: ["WatchtowerCore"]
        ),
    ]
)
