import Foundation
import ComposableArchitecture

/// Single-project earnings drill-down: a month cursor plus presentation of the
/// contract drawer (create/edit). No write logic lives here — that's owned by
/// `ContractDrawerFeature`; this feature only owns navigation/presentation and
/// the month state, mirroring `EarningsFeature`'s month-cursor pattern and
/// `RecordsFeature`'s `@Presents`/`.ifLet` composition for the drawer.
@Reducer
public struct ProjectDetailFeature {
    @ObservableState
    public struct State: Equatable, Identifiable {
        public var id: Int { projectId }

        public let projectId: Int
        public var month: String

        @Presents public var contractDrawer: ContractDrawerFeature.State?

        @Shared(.inMemory("billingDataset")) public var dataset: BillingDataset? = nil
        @Shared(.inMemory("billingLoadState")) public var loadState: BillingFeature.LoadState = .loading

        public init(projectId: Int, initialMonth: String = "") {
            self.projectId = projectId
            self.month = initialMonth
        }
    }

    // Deliberately NOT `Equatable` (same rationale as `RecordsFeature.Action`):
    // it embeds `PresentationAction<ContractDrawerFeature.Action>`, and
    // `ContractDrawerFeature.Action` (a `BindableAction` carrying
    // `BindingAction<State>`) isn't itself `Equatable`. Tests match via
    // case-key-path `store.receive(\.foo)` instead of full-action equality.
    public enum Action {
        case monthStepped(Int)
        case addContractTapped
        case contractRowTapped(ContractRow)
        case contractDrawer(PresentationAction<ContractDrawerFeature.Action>)
    }

    public init() {}

    public var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case let .monthStepped(delta):
                state.month = CzFormat.addMonths(state.month, delta)
                return .none

            case .addContractTapped:
                guard canEdit(state.loadState) else { return .none }
                state.contractDrawer = ContractDrawerFeature.State(mode: .create(projectId: state.projectId))
                return .none

            case let .contractRowTapped(contract):
                guard canEdit(state.loadState) else { return .none }
                state.contractDrawer = ContractDrawerFeature.State(
                    mode: .edit(contract),
                    sharedProjectIds: Self.groupMembership(of: contract, in: state.dataset)
                )
                return .none

            case .contractDrawer(.presented(.delegate(.dismissed))):
                state.contractDrawer = nil
                return .none

            case .contractDrawer:
                return .none
            }
        }
        .ifLet(\.$contractDrawer, action: \.contractDrawer) {
            ContractDrawerFeature()
        }
    }

    /// The OTHER project ids currently sharing `contract`'s `contractGroupId`
    /// (never includes `contract.projectId` itself). Empty for a solo
    /// contract (`contractGroupId == nil`) or when the dataset isn't loaded.
    ///
    /// This prefill is load-bearing, not cosmetic: `ContractDrawerFeature`
    /// treats `sharedProjectIds` as the FULL desired group membership on
    /// save, not a diff. Presenting `.edit` with an empty set for an
    /// already-grouped contract would silently drop every sibling member on
    /// the very next save, even a no-op one — zeroing their billing (Finding
    /// B from the Task 14 review).
    private static func groupMembership(of contract: ContractRow, in dataset: BillingDataset?) -> Set<Int> {
        guard let groupId = contract.contractGroupId, let dataset else { return [] }
        return Set(
            dataset.contracts
                .filter { $0.contractGroupId == groupId }
                .map(\.projectId)
        ).subtracting([contract.projectId])
    }
}
