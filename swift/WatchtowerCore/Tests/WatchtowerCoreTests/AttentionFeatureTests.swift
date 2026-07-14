import XCTest
import ComposableArchitecture
@testable import WatchtowerCore

@MainActor
final class AttentionFeatureTests: XCTestCase {
    func testOnAppearLoadsAndGroupsThreads() async {
        let rows = [
            AttentionMessage(
                syncId: "c1", instanceId: "i1", projectLabel: "proj", role: "claude",
                kind: nil, body: "need input", options: [], replyTo: nil,
                injectedAt: nil, closedAt: nil, createdAt: "2026-07-14T10:00:00Z"
            ),
        ]
        let store = TestStore(initialState: AttentionFeature.State()) {
            AttentionFeature()
        } withDependencies: {
            $0.attentionClient.listThreads = { rows }
            $0.continuousClock = ImmediateClock()
        }

        await store.send(.onAppear) { $0.isLoading = true }
        await store.receive(\.threadsLoaded.success) {
            $0.isLoading = false
            $0.threads = groupThreads(rows)
            XCTAssertEqual($0.unansweredCount, 1)
        }
    }

    func testLoadFailureSurfacesErrorAndKeepsThreads() async {
        struct Boom: Error {}
        let store = TestStore(initialState: AttentionFeature.State()) {
            AttentionFeature()
        } withDependencies: {
            $0.attentionClient.listThreads = { throw Boom() }
            $0.continuousClock = ImmediateClock()
        }

        await store.send(.onAppear) { $0.isLoading = true }
        await store.receive(\.threadsLoaded.failure) {
            $0.isLoading = false
            $0.errorMessage = "Couldn't load messages."
        }
    }

    // MARK: - Reply (Task 11)

    func testSendReplySuccess() async {
        let captured = LockIsolated<[String]>([])
        var initial = AttentionFeature.State()
        initial.threads = groupThreads([AttentionMessage(syncId: "c1", instanceId: "i1", projectLabel: "p",
            role: "claude", kind: nil, body: "q", options: [], replyTo: nil,
            injectedAt: nil, closedAt: nil, createdAt: "2026-07-14T10:00:00Z")])
        initial.replyDrafts["i1"] = "my answer"
        let store = TestStore(initialState: initial) { AttentionFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
            $0.attentionClient.reply = { _, _, body, _, _ in captured.withValue { $0.append(body) } }
        }
        await store.send(.sendReply(instanceId: "i1", replyTo: "c1")) {
            $0.isSending = true
            $0.replyDrafts["i1"] = ""
        }
        await store.receive(\.replyFinished) { $0.isSending = false }
        XCTAssertEqual(captured.value, ["my answer"])
    }

    func testSendReplyFailureRollsBackDraft() async {
        struct Boom: Error {}
        var initial = AttentionFeature.State()
        initial.threads = groupThreads([AttentionMessage(syncId: "c1", instanceId: "i1", projectLabel: "p",
            role: "claude", kind: nil, body: "q", options: [], replyTo: nil,
            injectedAt: nil, closedAt: nil, createdAt: "2026-07-14T10:00:00Z")])
        initial.replyDrafts["i1"] = "my answer"
        let store = TestStore(initialState: initial) { AttentionFeature() } withDependencies: {
            $0.uuid = .incrementing
            $0.date.now = Date(timeIntervalSince1970: 1_780_000_000)
            $0.attentionClient.reply = { _, _, _, _, _ in throw Boom() }
        }
        await store.send(.sendReply(instanceId: "i1", replyTo: "c1")) {
            $0.isSending = true
            $0.replyDrafts["i1"] = ""
        }
        await store.receive(\.replyFinished) {
            $0.isSending = false
            $0.replyDrafts["i1"] = "my answer"   // rolled back
            $0.errorMessage = "Couldn't send reply."
        }
    }

    // MARK: - Poll lifecycle (Task 12)

    func testStartPollingTickSendsRefresh() async {
        // `startPolling` (fired by the drawer sheet's onAppear) must send
        // `.refresh` every 5s via the injected clock, and `stopPolling`
        // (fired by the sheet's onDisappear) must cancel that loop so it
        // doesn't keep ticking while the drawer is closed.
        let clock = TestClock()
        let store = TestStore(initialState: AttentionFeature.State()) {
            AttentionFeature()
        } withDependencies: {
            $0.continuousClock = clock
            $0.attentionClient.listThreads = { [] }
        }

        await store.send(.startPolling)
        await clock.advance(by: .seconds(5))
        await store.receive(\.refresh) { $0.isLoading = true }
        await store.receive(\.threadsLoaded.success) { $0.isLoading = false }

        await store.send(.stopPolling)
    }
}
