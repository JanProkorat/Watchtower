import XCTest
@testable import WatchtowerBridge

final class ConnectionTests: XCTestCase {
    private func form(
        host: String = "mac.tailnet.ts.net", port: String = "7445", token: String = "tok",
        mac: String = "", lanIp: String = "", wanHost: String = "", wanPort: String = ""
    ) -> ConnectionFormState {
        var f = ConnectionFormState()
        f.host = host; f.port = port; f.token = token
        f.mac = mac; f.lanIp = lanIp; f.wanHost = wanHost; f.wanPort = wanPort
        return f
    }

    // MARK: parseMac (port of wakeOnLan.ts tests)

    func testParseMacColonAndDash() {
        XCTAssertEqual(parseMac("AA:BB:CC:DD:EE:FF")?.bytes, [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])
        XCTAssertEqual(parseMac("aa-bb-cc-dd-ee-ff")?.bytes, [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])
        XCTAssertEqual(parseMac("  00:11:22:33:44:55 ")?.bytes, [0x00, 0x11, 0x22, 0x33, 0x44, 0x55])
    }

    func testParseMacRejectsMalformed() {
        XCTAssertNil(parseMac("AA:BB:CC:DD:EE"))          // 5 groups
        XCTAssertNil(parseMac("AA:BB:CC:DD:EE:FF:00"))    // 7 groups
        XCTAssertNil(parseMac("AA::CC:DD:EE:FF"))         // empty group (matches TS split-keeps-empties)
        XCTAssertNil(parseMac("GG:BB:CC:DD:EE:FF"))       // non-hex
        XCTAssertNil(parseMac("AAA:BB:CC:DD:EE:F"))       // wrong group width
        XCTAssertNil(parseMac(""))
    }

    // MARK: parseConnection (port of connection.ts tests)

    func testValidMinimal() throws {
        let c = try parseConnection(form()).get()
        XCTAssertEqual(c.host, "mac.tailnet.ts.net")
        XCTAssertEqual(c.port, 7445)
        XCTAssertEqual(c.token, "tok")
        XCTAssertNil(c.mac); XCTAssertNil(c.lanIp); XCTAssertNil(c.wanHost); XCTAssertNil(c.wanPort)
    }

    func testTrimsWhitespace() throws {
        let c = try parseConnection(form(host: "  10.0.0.5 ", token: " tok ")).get()
        XCTAssertEqual(c.host, "10.0.0.5")
        XCTAssertEqual(c.token, "tok")
    }

    func testHostRequired() {
        XCTAssertEqual(parseConnection(form(host: "  ")), .failure(.hostRequired))
    }

    func testPortValidation() {
        XCTAssertEqual(parseConnection(form(port: "0")), .failure(.portInvalid))
        XCTAssertEqual(parseConnection(form(port: "65536")), .failure(.portInvalid))
        XCTAssertEqual(parseConnection(form(port: "abc")), .failure(.portInvalid))
        XCTAssertEqual(parseConnection(form(port: "7.5")), .failure(.portInvalid))
    }

    func testTokenRequired() {
        XCTAssertEqual(parseConnection(form(token: "")), .failure(.tokenRequired))
    }

    func testMacOptionalButValidatedWhenPresent() throws {
        XCTAssertEqual(parseConnection(form(mac: "nonsense")), .failure(.macInvalid))
        let c = try parseConnection(form(mac: "AA:BB:CC:DD:EE:FF")).get()
        XCTAssertEqual(c.mac, "AA:BB:CC:DD:EE:FF")
    }

    func testWanPortDefaultsTo9WhenWanHostSet() throws {
        let c = try parseConnection(form(wanHost: "home.example.com")).get()
        XCTAssertEqual(c.wanHost, "home.example.com")
        XCTAssertEqual(c.wanPort, 9)
        // No wanHost -> wanPort stays nil even if the field is filled.
        let c2 = try parseConnection(form(wanPort: "7")).get()
        XCTAssertNil(c2.wanPort)
    }

    func testWanPortValidated() {
        XCTAssertEqual(parseConnection(form(wanHost: "h", wanPort: "0")), .failure(.wanPortInvalid))
    }

    // MARK: wsURL + round-trips

    func testWsURL() throws {
        let c = try parseConnection(form(host: "100.64.1.2", port: "7445")).get()
        XCTAssertEqual(c.wsURL?.absoluteString, "ws://100.64.1.2:7445/ws")
    }

    func testFormStateRoundTrip() throws {
        var f = form(mac: "AA:BB:CC:DD:EE:FF", lanIp: "192.168.1.10", wanHost: "h.example.com", wanPort: "7")
        let c = try parseConnection(f).get()
        f = ConnectionFormState(c)
        XCTAssertEqual(f.host, "mac.tailnet.ts.net")
        XCTAssertEqual(f.port, "7445")
        XCTAssertEqual(f.token, "tok")
        XCTAssertEqual(f.mac, "AA:BB:CC:DD:EE:FF")
        XCTAssertEqual(f.lanIp, "192.168.1.10")
        XCTAssertEqual(f.wanHost, "h.example.com")
        XCTAssertEqual(f.wanPort, "7")
    }

    func testCodableRoundTrip() throws {
        let c = try parseConnection(form(mac: "AA:BB:CC:DD:EE:FF")).get()
        let decoded = try JSONDecoder().decode(Connection.self, from: JSONEncoder().encode(c))
        XCTAssertEqual(decoded, c)
    }

    func testErrorMessagesAreEnglish() {
        XCTAssertEqual(ConnectionValidationError.hostRequired.message, "Host is required")
        XCTAssertEqual(ConnectionValidationError.portInvalid.message, "Port must be 1–65535")
        XCTAssertEqual(ConnectionValidationError.tokenRequired.message, "Token is required")
        XCTAssertEqual(ConnectionValidationError.macInvalid.message, "MAC address is invalid")
        XCTAssertEqual(ConnectionValidationError.wanPortInvalid.message, "Wake port must be 1–65535")
    }
}
