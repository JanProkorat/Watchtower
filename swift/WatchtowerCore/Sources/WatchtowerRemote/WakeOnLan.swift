import Foundation
import WatchtowerBridge

/// 102-byte Wake-on-LAN magic packet: 6x 0xFF sync stream + 16 repeats of the MAC.
/// Port of apps/ipad/src/lib/wakeOnLan.ts.
public func buildMagicPacket(_ mac: ParsedMac) -> [UInt8] {
    var pkt = [UInt8](repeating: 0xFF, count: 6)
    for _ in 0..<16 { pkt.append(contentsOf: mac.bytes) }
    return pkt
}

public struct WakeTarget: Equatable, Sendable {
    public let host: String
    public let port: Int
    public init(host: String, port: Int) { self.host = host; self.port = port }
}

/// LAN target uses the fixed discard port 9; WAN/DDNS uses wanPort or 9.
/// Port of apps/ipad/src/state/wake.ts wakeTargets.
public func wakeTargets(_ connection: Connection) -> [WakeTarget] {
    var targets: [WakeTarget] = []
    if let lan = connection.lanIp { targets.append(WakeTarget(host: lan, port: 9)) }
    if let wan = connection.wanHost { targets.append(WakeTarget(host: wan, port: connection.wanPort ?? 9)) }
    return targets
}
