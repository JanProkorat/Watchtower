import XCTest
@testable import WatchtowerCore

final class AttentionMappingTests: XCTestCase {
    private func msg(_ syncId: String, _ inst: String, _ role: String,
                     projectLabel: String? = nil, kind: String? = nil,
                     options: [AttentionOption] = [], replyTo: String? = nil,
                     createdAt: String, closedAt: String? = nil) -> AttentionMessage {
        AttentionMessage(syncId: syncId, instanceId: inst, projectLabel: projectLabel ?? inst, role: role,
                         kind: kind, body: "b", options: options, replyTo: replyTo,
                         injectedAt: nil, closedAt: closedAt, createdAt: createdAt)
    }

    // MARK: - Brief vectors (verbatim)

    func testGroupsByInstanceAndSortsByCreatedAt() {
        let threads = groupThreads([
            msg("b", "i1", "claude", createdAt: "2026-07-14T10:01:00Z"),
            msg("a", "i1", "claude", createdAt: "2026-07-14T10:00:00Z"),
        ])
        XCTAssertEqual(threads.count, 1)
        XCTAssertEqual(threads[0].instanceId, "i1")
        XCTAssertEqual(threads[0].messages.map(\.syncId), ["a", "b"])
    }

    func testUnansweredWhenLastClaudeHasNoMatchingUserReply() {
        let t = groupThreads([msg("c1", "i1", "claude", createdAt: "2026-07-14T10:00:00Z")])
        XCTAssertTrue(t[0].unanswered)
    }

    func testAnsweredWhenUserReplyReferencesClaudeSyncId() {
        let t = groupThreads([
            msg("c1", "i1", "claude", createdAt: "2026-07-14T10:00:00Z"),
            msg("u1", "i1", "user", replyTo: "c1", createdAt: "2026-07-14T10:01:00Z"),
        ])
        XCTAssertFalse(t[0].unanswered)
    }

    func testClosedThreadIsNotUnanswered() {
        let t = groupThreads([
            msg("c1", "i1", "claude", createdAt: "2026-07-14T10:00:00Z", closedAt: "2026-07-14T11:00:00Z"),
        ])
        XCTAssertFalse(t[0].unanswered)
        XCTAssertTrue(t[0].closed)
    }

    // MARK: - Additional vectors implied by attentionCache.ts's groupThreads/mapAttentionRow

    /// Only the LATEST claude message's syncId can be answered — a user reply
    /// referencing an earlier claude message in the same thread does not
    /// answer it (TS: `lastClaude` is `claudeMsgs[claudeMsgs.length - 1]`).
    func testOnlyLatestClaudeMessageDeterminesUnanswered() {
        let t = groupThreads([
            msg("c1", "i1", "claude", createdAt: "2026-07-14T10:00:00Z"),
            msg("u1", "i1", "user", replyTo: "c1", createdAt: "2026-07-14T10:01:00Z"),
            msg("c2", "i1", "claude", createdAt: "2026-07-14T10:02:00Z"),
        ])
        XCTAssertTrue(t[0].unanswered, "reply to c1 does not answer c2, the latest claude message")
    }

    /// No claude message at all → `answered` is vacuously true (TS:
    /// `lastClaude ? ... : true`), so a user-only thread is never unanswered.
    func testUserOnlyThreadIsAnsweredAndNotClosed() {
        let t = groupThreads([
            msg("u1", "i1", "user", createdAt: "2026-07-14T10:00:00Z"),
        ])
        XCTAssertFalse(t[0].unanswered)
        XCTAssertFalse(t[0].closed)
        XCTAssertNil(t[0].kind)
    }

    /// `label` = FIRST (post-sort) message's `projectLabel`, falling back to
    /// `instanceId` — not the last message's, and not a raw passthrough field.
    func testThreadLabelFallsBackToInstanceIdWhenFirstMessageHasNoProjectLabel() {
        let t = groupThreads([
            msg("c1", "i1", "claude", projectLabel: nil, createdAt: "2026-07-14T10:00:00Z"),
            msg("c2", "i1", "claude", projectLabel: "Later Label", createdAt: "2026-07-14T10:01:00Z"),
        ])
        XCTAssertEqual(t[0].label, "i1")
    }

    func testThreadLabelUsesFirstMessageProjectLabel() {
        let t = groupThreads([
            msg("c1", "i1", "claude", projectLabel: "My Project", createdAt: "2026-07-14T10:00:00Z"),
            msg("c2", "i1", "claude", projectLabel: nil, createdAt: "2026-07-14T10:01:00Z"),
        ])
        XCTAssertEqual(t[0].label, "My Project")
    }

    /// `kind` = the LAST claude message's kind, not the first's.
    func testThreadKindComesFromLastClaudeMessage() {
        let t = groupThreads([
            msg("c1", "i1", "claude", kind: "question", createdAt: "2026-07-14T10:00:00Z"),
            msg("c2", "i1", "claude", kind: "confirm", createdAt: "2026-07-14T10:01:00Z"),
        ])
        XCTAssertEqual(t[0].kind, "confirm")
    }

    /// Grouping preserves first-seen instanceId order (mirrors JS `Map`
    /// iteration order), not e.g. alphabetical or reverse-input order.
    func testGroupingPreservesFirstSeenInstanceOrder() {
        let threads = groupThreads([
            msg("c1", "i2", "claude", createdAt: "2026-07-14T10:00:00Z"),
            msg("c2", "i1", "claude", createdAt: "2026-07-14T10:01:00Z"),
            msg("c3", "i2", "claude", createdAt: "2026-07-14T10:02:00Z"),
        ])
        XCTAssertEqual(threads.map(\.instanceId), ["i2", "i1"])
    }

    // MARK: - mapAttentionRow / options decoding

    /// TS: `options: { number: number; label: string }[]` — NOT `[String]`.
    func testMapAttentionRowParsesOptionsArray() throws {
        let json = """
        {
          "sync_id": "c1", "instance_id": "i1", "project_label": "Proj",
          "role": "claude", "kind": "choice", "body": "Pick one",
          "options": [{"number": 1, "label": "Yes"}, {"number": 2, "label": "No"}],
          "reply_to": null, "injected_at": null, "closed_at": null,
          "created_at": "2026-07-14T10:00:00Z"
        }
        """
        let dto = try JSONDecoder().decode(AttentionMessageDTO.self, from: Data(json.utf8))
        let message = mapAttentionRow(dto)
        XCTAssertEqual(message.options, [
            AttentionOption(number: 1, label: "Yes"),
            AttentionOption(number: 2, label: "No"),
        ])
    }

    /// TS: `Array.isArray(row.options) ? row.options : (row.options ? JSON.parse(row.options) : [])`
    /// — a missing/null `options` column terminates at `[]`.
    func testMapAttentionRowDefaultsMissingOptionsToEmptyArray() throws {
        let json = """
        {
          "sync_id": "c1", "instance_id": "i1", "project_label": null,
          "role": "claude", "kind": null, "body": null,
          "reply_to": null, "injected_at": null, "closed_at": null,
          "created_at": "2026-07-14T10:00:00Z"
        }
        """
        let dto = try JSONDecoder().decode(AttentionMessageDTO.self, from: Data(json.utf8))
        let message = mapAttentionRow(dto)
        XCTAssertEqual(message.options, [])
    }
}
