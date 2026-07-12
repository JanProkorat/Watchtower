import Foundation
import ComposableArchitecture

/// Pure codec core for the on-disk billing snapshot. Mirrors the JS
/// `billingCache.ts` `loadCache` shape-guard: any decode failure (garbage
/// bytes, missing required fields) yields `nil` rather than throwing.
public enum BillingCacheCodec {
    public static func decode(_ data: Data) -> BillingDataset? {
        try? JSONDecoder().decode(BillingDataset.self, from: data)
    }

    public static func encode(_ dataset: BillingDataset) -> Data {
        // Encoding a well-formed `BillingDataset` cannot fail: all fields are
        // standard Codable types (String, Double, Int, Bool, arrays, optionals).
        (try? JSONEncoder().encode(dataset)) ?? Data()
    }
}

@DependencyClient
public struct BillingCache: Sendable {
    public var load: @Sendable () async -> BillingDataset? = { nil }
    public var save: @Sendable (BillingDataset) async -> Void
}

extension BillingCache: DependencyKey {
    public static var liveValue: BillingCache {
        @Sendable func cacheFileURL() throws -> URL {
            let dir = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            return dir.appendingPathComponent("billing-cache.json")
        }

        return BillingCache(
            load: {
                guard let url = try? cacheFileURL(),
                      let data = try? Data(contentsOf: url) else { return nil }
                return BillingCacheCodec.decode(data)
            },
            save: { dataset in
                guard let url = try? cacheFileURL() else { return }
                let data = BillingCacheCodec.encode(dataset)
                try? data.write(to: url, options: .atomic)
            }
        )
    }

    public static let testValue = BillingCache()
}

public extension DependencyValues {
    var billingCache: BillingCache {
        get { self[BillingCache.self] }
        set { self[BillingCache.self] = newValue }
    }
}
