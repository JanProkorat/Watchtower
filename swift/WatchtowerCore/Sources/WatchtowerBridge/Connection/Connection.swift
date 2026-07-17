import Foundation

/// A saved connection to the Mac orchestrator — port of apps/ipad/src/connection.ts.
public struct Connection: Codable, Equatable, Sendable {
    public var host: String
    public var port: Int
    public var token: String
    /// Mac's Ethernet MAC, for Wake-on-LAN (Phase 4).
    public var mac: String?
    /// Home wake target (the Mac's LAN IP).
    public var lanIp: String?
    /// Away wake target (DDNS hostname / public IP).
    public var wanHost: String?
    /// Away wake target port (default 9).
    public var wanPort: Int?

    public init(
        host: String, port: Int, token: String,
        mac: String? = nil, lanIp: String? = nil, wanHost: String? = nil, wanPort: Int? = nil
    ) {
        self.host = host; self.port = port; self.token = token
        self.mac = mac; self.lanIp = lanIp; self.wanHost = wanHost; self.wanPort = wanPort
    }

    /// `ws://host:port/ws` — token is appended as a query param by the client.
    public var wsURL: URL? {
        var c = URLComponents()
        c.scheme = "ws"
        c.host = host
        c.port = port
        c.path = "/ws"
        return c.url
    }
}

// MARK: - MAC parsing (subset of wakeOnLan.ts; packet builder ports in Phase 4)

public struct ParsedMac: Equatable, Sendable {
    /// Exactly 6 octets.
    public let bytes: [UInt8]
}

/// Parse "AA:BB:CC:DD:EE:FF" or "AA-BB-CC-DD-EE-FF" (case-insensitive).
public func parseMac(_ input: String) -> ParsedMac? {
    // components(separatedBy:) keeps empty groups, matching the TS split(/[:-]/)
    // behavior — "AA::CC:DD:EE:FF" must fail, not collapse to 5 groups.
    let parts = input
        .trimmingCharacters(in: .whitespaces)
        .components(separatedBy: CharacterSet(charactersIn: ":-"))
    guard parts.count == 6 else { return nil }
    var bytes: [UInt8] = []
    for p in parts {
        guard p.count == 2, p.allSatisfy(\.isHexDigit), let b = UInt8(p, radix: 16) else { return nil }
        bytes.append(b)
    }
    return ParsedMac(bytes: bytes)
}

// MARK: - Form state + validation

public struct ConnectionFormState: Equatable, Sendable {
    public var host = ""
    public var port = "7445"
    public var token = ""
    public var mac = ""
    public var lanIp = ""
    public var wanHost = ""
    public var wanPort = ""

    public init() {}

    public init(_ c: Connection) {
        host = c.host
        port = String(c.port)
        token = c.token
        mac = c.mac ?? ""
        lanIp = c.lanIp ?? ""
        wanHost = c.wanHost ?? ""
        wanPort = c.wanPort.map(String.init) ?? ""
    }
}

public enum ConnectionValidationError: Error, Equatable {
    case hostRequired, portInvalid, tokenRequired, macInvalid, wanPortInvalid

    public var message: String {
        switch self {
        case .hostRequired: return "Host is required"
        case .portInvalid: return "Port must be 1–65535"
        case .tokenRequired: return "Token is required"
        case .macInvalid: return "MAC address is invalid"
        case .wanPortInvalid: return "Wake port must be 1–65535"
        }
    }
}

private func parsePort(_ raw: String) -> Int? {
    guard let p = Int(raw.trimmingCharacters(in: .whitespaces)), (1...65535).contains(p) else { return nil }
    return p
}

public func parseConnection(_ form: ConnectionFormState) -> Result<Connection, ConnectionValidationError> {
    let host = form.host.trimmingCharacters(in: .whitespaces)
    guard !host.isEmpty else { return .failure(.hostRequired) }
    guard let port = parsePort(form.port) else { return .failure(.portInvalid) }
    let token = form.token.trimmingCharacters(in: .whitespaces)
    guard !token.isEmpty else { return .failure(.tokenRequired) }

    var value = Connection(host: host, port: port, token: token)

    let mac = form.mac.trimmingCharacters(in: .whitespaces)
    if !mac.isEmpty {
        guard parseMac(mac) != nil else { return .failure(.macInvalid) }
        value.mac = mac
    }
    let lanIp = form.lanIp.trimmingCharacters(in: .whitespaces)
    if !lanIp.isEmpty { value.lanIp = lanIp }
    let wanHost = form.wanHost.trimmingCharacters(in: .whitespaces)
    if !wanHost.isEmpty {
        value.wanHost = wanHost
        let rawWanPort = form.wanPort.trimmingCharacters(in: .whitespaces)
        if rawWanPort.isEmpty {
            value.wanPort = 9
        } else {
            guard let wp = parsePort(rawWanPort) else { return .failure(.wanPortInvalid) }
            value.wanPort = wp
        }
    }
    return .success(value)
}
