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
}
