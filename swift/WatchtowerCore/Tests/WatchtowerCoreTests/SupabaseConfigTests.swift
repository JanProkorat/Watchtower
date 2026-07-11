import XCTest
@testable import WatchtowerCore

final class SupabaseConfigTests: XCTestCase {
    func testLoadsUrlAndKey() throws {
        let cfg = try SupabaseConfig.load(from: [
            "SUPABASE_URL": "https://xggihnrvsmbzbkhsnuky.supabase.co",
            "SUPABASE_ANON_KEY": "anon-123",
        ])
        XCTAssertEqual(cfg.url.absoluteString, "https://xggihnrvsmbzbkhsnuky.supabase.co")
        XCTAssertEqual(cfg.anonKey, "anon-123")
    }

    func testMissingKeyThrows() {
        XCTAssertThrowsError(try SupabaseConfig.load(from: ["SUPABASE_URL": "https://x.supabase.co"])) {
            XCTAssertEqual($0 as? SupabaseConfigError, .missingAnonKey)
        }
    }

    func testEmptyKeyThrows() {
        XCTAssertThrowsError(try SupabaseConfig.load(from: [
            "SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "",
        ])) {
            XCTAssertEqual($0 as? SupabaseConfigError, .missingAnonKey)
        }
    }

    func testInvalidUrlThrows() {
        XCTAssertThrowsError(try SupabaseConfig.load(from: [
            "SUPABASE_URL": "", "SUPABASE_ANON_KEY": "anon-123",
        ])) {
            XCTAssertEqual($0 as? SupabaseConfigError, .invalidURL)
        }
    }
}
