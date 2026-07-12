import Foundation

public enum SupabaseConfigError: Error, Equatable {
    case missingAnonKey
    case invalidURL
}

public struct SupabaseConfig: Equatable, Sendable {
    public let url: URL
    public let anonKey: String

    public init(url: URL, anonKey: String) {
        self.url = url
        self.anonKey = anonKey
    }

    public static func load(from bag: [String: Any]) throws -> SupabaseConfig {
        let key = (bag["SUPABASE_ANON_KEY"] as? String) ?? ""
        guard !key.isEmpty else { throw SupabaseConfigError.missingAnonKey }
        let urlString = (bag["SUPABASE_URL"] as? String) ?? ""
        guard let url = URL(string: urlString), url.scheme != nil, url.host != nil else {
            throw SupabaseConfigError.invalidURL
        }
        return SupabaseConfig(url: url, anonKey: key)
    }
}
