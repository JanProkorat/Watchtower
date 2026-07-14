import Foundation

/// Formats a raw APNs device token (`Data`) as a lowercase hex string,
/// the format Supabase's `push_devices.apns_token` column expects.
public func hexEncode(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}
