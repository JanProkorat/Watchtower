import SwiftUI
import ComposableArchitecture
import WatchtowerCore
import WatchtowerBridge

/// Spawn/restart modal — project picker (folder-bearing projects only), a
/// claude/shell kind toggle, and a "Restart existing" list for non-live
/// instances already running in the chosen project's folder. Presented as a
/// sheet by `InstancesView` via `InstancesFeature`'s `@Presents var spawn`.
struct SpawnModalView: View {
    @Bindable var store: StoreOf<SpawnFeature>
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Project") {
                    if store.spawnableProjects.isEmpty {
                        Text("No projects with a folder path yet.")
                            .foregroundStyle(Palette.textMuted)
                    } else {
                        ForEach(store.spawnableProjects) { project in
                            Button {
                                store.send(.projectSelected(project.id))
                            } label: {
                                HStack {
                                    Text(project.name)
                                        .foregroundStyle(Palette.textPrimary)
                                    Spacer()
                                    if store.selectedProjectId == project.id {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(Palette.accent)
                                    }
                                }
                            }
                        }
                    }
                }

                Section("Kind") {
                    Picker(
                        "Kind",
                        selection: Binding(
                            get: { store.instanceKind },
                            set: { store.send(.kindSelected($0)) }
                        )
                    ) {
                        Text("Claude").tag("claude")
                        Text("Shell").tag("shell")
                    }
                    .pickerStyle(.segmented)
                }

                if !store.restartable.isEmpty {
                    Section("Restart existing") {
                        ForEach(store.restartable) { instance in
                            Button {
                                store.send(.restartTapped(instance.id))
                            } label: {
                                Text("\(instance.id) — \(instance.status)")
                                    .foregroundStyle(Palette.textPrimary)
                            }
                            .disabled(store.isSubmitting)
                        }
                    }
                }

                if let error = store.errorMessage {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        store.send(.spawnTapped)
                    } label: {
                        HStack {
                            Spacer()
                            if store.isSubmitting {
                                ProgressView()
                            } else {
                                Text("Spawn")
                            }
                            Spacer()
                        }
                    }
                    .disabled(store.isSubmitting)
                }
            }
            .navigationTitle("New instance")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        store.send(.dismissed)
                        dismiss()
                    }
                }
            }
        }
    }
}
