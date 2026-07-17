import XCTest
import WatchtowerBridge
@testable import WatchtowerRemote

final class WakeOnLanTests: XCTestCase {
    func testMagicPacketLayout() {
        let mac = parseMac("01:23:45:67:89:AB")!
        let pkt = buildMagicPacket(mac)
        XCTAssertEqual(pkt.count, 102)
        XCTAssertEqual(Array(pkt.prefix(6)), [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        // 16 repeats of the 6-byte MAC follow the 6x 0xFF prefix.
        for i in 0..<16 {
            let start = 6 + i * 6
            XCTAssertEqual(Array(pkt[start..<start+6]), [0x01, 0x23, 0x45, 0x67, 0x89, 0xAB])
        }
    }

    func testWakeTargetsLanAndWan() {
        let c = Connection(host: "h", port: 7445, token: "t",
                           mac: "01:23:45:67:89:AB", lanIp: "192.168.1.9",
                           wanHost: "home.example.net", wanPort: 1234)
        XCTAssertEqual(wakeTargets(c), [
            WakeTarget(host: "192.168.1.9", port: 9),
            WakeTarget(host: "home.example.net", port: 1234),
        ])
    }

    func testWakeTargetsWanPortDefaultsToNine() {
        let c = Connection(host: "h", port: 7445, token: "t",
                           mac: nil, lanIp: nil, wanHost: "home.example.net", wanPort: nil)
        XCTAssertEqual(wakeTargets(c), [WakeTarget(host: "home.example.net", port: 9)])
    }

    func testWakeTargetsEmptyWhenNoAddresses() {
        let c = Connection(host: "h", port: 7445, token: "t",
                           mac: nil, lanIp: nil, wanHost: nil, wanPort: nil)
        XCTAssertTrue(wakeTargets(c).isEmpty)
    }
}
