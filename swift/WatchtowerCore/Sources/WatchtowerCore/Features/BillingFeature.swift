import Foundation
import ComposableArchitecture

/// Read-model + stale-while-revalidate lifecycle for the billing dataset.
/// Mirrors the JS `useBilling` hook: show the cached snapshot immediately
/// (if any), then always kick off a background fetch. A failed fetch keeps
/// showing the last-known-good dataset (`.cached`) rather than blanking the
/// screen; only a failure with nothing cached goes `.offline`. A manual
/// pull-to-refresh additionally surfaces a transient "Updated" toast.
@Reducer
public struct BillingFeature {
    public enum LoadState: Equatable, Sendable {
        case loading, fresh, cached, offline
    }

    @ObservableState
    public struct State: Equatable {
        @Shared(.inMemory("billingDataset")) public var dataset: BillingDataset? = nil
        @Shared(.inMemory("billingLoadState")) public var loadState: LoadState = .loading
        public var lastUpdated: String?
        public var showRefreshToast: Bool = false
        public init() {}
    }

    public enum BillingError: Error, Equatable {
        case fetchFailed
    }

    public enum Action: Equatable {
        case onAppear
        case cacheLoaded(BillingDataset?)
        case refreshRequested
        case fetchResponse(Result<BillingDataset, BillingError>)
        case refreshResponse(Result<BillingDataset, BillingError>)
        case toastExpired
    }

    @Dependency(\.billingCache) var billingCache
    @Dependency(\.billingClient) var billingClient
    @Dependency(\.continuousClock) var clock

    public init() {}

    private enum CancelID { case toast }

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .onAppear:
                return .merge(
                    .run { send in
                        let cached = await billingCache.load()
                        await send(.cacheLoaded(cached))
                    },
                    fetchEffect(isRefresh: false)
                )

            case let .cacheLoaded(dataset):
                // SWR invariant: never regress to staler data once fresher has
                // rendered. onAppear runs cache-load and fetch concurrently, so a
                // fetchResponse (success → .fresh, or failure with no dataset →
                // .offline) can land before this cacheLoaded. Apply the cache only
                // when no data has landed yet: fresh-first (dataset != nil) still
                // correctly skips; offline-first (dataset nil) correctly recovers
                // from .offline to .cached instead of stranding the user offline
                // with valid data on disk.
                guard state.dataset == nil, let dataset else { return .none }
                state.$dataset.withLock { $0 = dataset }
                state.$loadState.withLock { $0 = .cached }
                state.lastUpdated = dataset.fetchedAt
                return .none

            case .refreshRequested:
                return fetchEffect(isRefresh: true)

            case let .fetchResponse(result):
                return apply(result, isRefresh: false, state: &state)

            case let .refreshResponse(result):
                return apply(result, isRefresh: true, state: &state)

            case .toastExpired:
                state.showRefreshToast = false
                return .none
            }
        }
    }

    private func fetchEffect(isRefresh: Bool) -> Effect<Action> {
        .run { send in
            do {
                let dataset = try await billingClient.fetchBillingDataset()
                if isRefresh {
                    await send(.refreshResponse(.success(dataset)))
                } else {
                    await send(.fetchResponse(.success(dataset)))
                }
            } catch {
                if isRefresh {
                    await send(.refreshResponse(.failure(.fetchFailed)))
                } else {
                    await send(.fetchResponse(.failure(.fetchFailed)))
                }
            }
        }
    }

    private func apply(
        _ result: Result<BillingDataset, BillingError>,
        isRefresh: Bool,
        state: inout State
    ) -> Effect<Action> {
        switch result {
        case let .success(dataset):
            state.$dataset.withLock { $0 = dataset }
            state.$loadState.withLock { $0 = .fresh }
            state.lastUpdated = dataset.fetchedAt
            var effects: [Effect<Action>] = [
                .run { _ in await billingCache.save(dataset) }
            ]
            if isRefresh {
                state.showRefreshToast = true
                effects.append(
                    .run { send in
                        try await clock.sleep(for: .seconds(2.2))
                        await send(.toastExpired)
                    }
                    .cancellable(id: CancelID.toast, cancelInFlight: true)
                )
            }
            return .merge(effects)

        case .failure:
            if state.dataset != nil {
                state.$loadState.withLock { $0 = .cached }
            } else {
                state.$dataset.withLock { $0 = nil }
                state.$loadState.withLock { $0 = .offline }
                state.lastUpdated = nil
            }
            return .none
        }
    }
}
