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
        public var dataset: BillingDataset?
        public var loadState: LoadState = .loading
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
                guard let dataset else { return .none }
                state.dataset = dataset
                state.loadState = .cached
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
            state.dataset = dataset
            state.loadState = .fresh
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
                state.loadState = .cached
            } else {
                state.dataset = nil
                state.loadState = .offline
                state.lastUpdated = nil
            }
            return .none
        }
    }
}
