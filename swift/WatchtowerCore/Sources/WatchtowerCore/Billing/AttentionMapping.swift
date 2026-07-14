import Foundation

// ---------------------------------------------------------------------------
// Verbatim port of packages/data-supabase/src/attentionCache.ts:
// `mapAttentionRow` + `groupThreads`. Source of truth for any behavioral
// question is the TS file, not this comment block.
// ---------------------------------------------------------------------------

struct AttentionOptionDTO: Decodable {
    let number: Int
    let label: String
}

/// `attention_messages?select=sync_id,instance_id,project_label,role,kind,
///   body,options,reply_to,injected_at,closed_at,created_at`
struct AttentionMessageDTO: Decodable {
    let syncId: String
    let instanceId: String
    let projectLabel: String?
    let role: String
    let kind: String?
    let body: String?
    let options: [AttentionOptionDTO]?
    let replyTo: String?
    let injectedAt: String?
    let closedAt: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case syncId = "sync_id"
        case instanceId = "instance_id"
        case projectLabel = "project_label"
        case role, kind, body, options
        case replyTo = "reply_to"
        case injectedAt = "injected_at"
        case closedAt = "closed_at"
        case createdAt = "created_at"
    }
}

/// Port of `mapAttentionRow`. The TS handles a jsonb `options` column that
/// may arrive as an already-parsed array or a JSON string (`Array.isArray(...)
/// ? row.options : (row.options ? JSON.parse(row.options) : [])`); Swift's
/// `Decodable` always parses the wire JSON up front, so the DTO's `options`
/// is already `[AttentionOptionDTO]?` — this just coalesces missing/null to
/// `[]`, the same terminal behavior as the TS ternary.
func mapAttentionRow(_ dto: AttentionMessageDTO) -> AttentionMessage {
    AttentionMessage(
        syncId: dto.syncId,
        instanceId: dto.instanceId,
        projectLabel: dto.projectLabel,
        role: dto.role,
        kind: dto.kind,
        body: dto.body,
        options: (dto.options ?? []).map { AttentionOption(number: $0.number, label: $0.label) },
        replyTo: dto.replyTo,
        injectedAt: dto.injectedAt,
        closedAt: dto.closedAt,
        createdAt: dto.createdAt
    )
}

/// Port of `groupThreads`. Groups by `instanceId` (preserving first-seen
/// order, mirroring JS `Map` iteration order), sorts each group's messages
/// by `createdAt` ascending (stable, per Swift's documented-stable
/// `sort`/`sorted`, matching ECMAScript's stable `Array.sort`), then per
/// group:
/// - `lastClaude` = the last `role == "claude"` message after sorting.
/// - `answered` = true if there's no claude message at all (vacuous), else
///   true iff some `user` message's `replyTo == lastClaude.syncId` — only the
///   LATEST claude message's syncId counts, a reply to an earlier claude
///   message does not answer the thread.
/// - `closed` = `lastClaude?.closedAt != nil` (false if there's no claude
///   message).
/// - `unanswered` = `!answered && !closed`.
/// - `label` = the FIRST message's (chronologically earliest, post-sort)
///   `projectLabel`, falling back to `instanceId`.
/// - `kind` = `lastClaude?.kind`.
func groupThreads(_ rows: [AttentionMessage]) -> [AttentionThread] {
    var order: [String] = []
    var byId: [String: [AttentionMessage]] = [:]
    for m in rows {
        if byId[m.instanceId] == nil {
            byId[m.instanceId] = []
            order.append(m.instanceId)
        }
        byId[m.instanceId]!.append(m)
    }

    var threads: [AttentionThread] = []
    for instanceId in order {
        var msgs = byId[instanceId] ?? []
        msgs.sort { $0.createdAt < $1.createdAt }

        let claudeMsgs = msgs.filter { $0.role == "claude" }
        let lastClaude = claudeMsgs.last
        let answered: Bool
        if let lastClaude {
            answered = msgs.contains { $0.role == "user" && $0.replyTo == lastClaude.syncId }
        } else {
            answered = true
        }
        let closed = lastClaude?.closedAt != nil

        threads.append(AttentionThread(
            instanceId: instanceId,
            label: msgs.first?.projectLabel ?? instanceId,
            kind: lastClaude?.kind,
            messages: msgs,
            unanswered: !answered && !closed,
            closed: closed
        ))
    }
    return threads
}
