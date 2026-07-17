import SwiftUI
import WatchtowerCore

/// Small sheet listing the instances available to fill a newly-split pane —
/// the tab group's instances minus those already mounted in the layout.
/// Port of apps/ipad/src/components/PanePicker.tsx (a centered glass overlay
/// on the web; a system sheet here, which is the idiomatic iPad presentation
/// for a short pick-one list and already carries the glass look for free).
struct PanePickerView: View {
    /// Instance ids offered — already filtered to "not mounted anywhere in
    /// the active layout" by `availableInstancesForPicker` at the call site.
    let candidates: [String]
    let onPick: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if candidates.isEmpty {
                    VStack(spacing: 8) {
                        Text("No other instances available")
                            .font(.callout)
                            .foregroundStyle(Palette.textMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(candidates, id: \.self) { instanceId in
                        Button {
                            onPick(instanceId)
                        } label: {
                            Text(instanceId)
                                .foregroundStyle(Palette.textPrimary)
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Choose a pane")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
