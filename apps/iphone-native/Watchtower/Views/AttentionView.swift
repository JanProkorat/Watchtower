import SwiftUI
import ComposableArchitecture
import WatchtowerCore

/// Reply drawer for `AttentionFeature` (Tasks 10-11), presented as a sheet
/// from the shell's toolbar bell (Task 12). Starts the 5s poll on
/// `onAppear` and cancels it on `onDisappear` — the poll must only run
/// while this sheet is on screen.
struct AttentionView: View {
    @Bindable var store: StoreOf<AttentionFeature>

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.baseBg.ignoresSafeArea()

                List {
                    if let error = store.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }

                    if store.threads.isEmpty && !store.isLoading {
                        Text("No attention messages.")
                            .font(.footnote)
                            .foregroundStyle(Palette.textMuted)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }

                    ForEach(store.threads, id: \.instanceId) { thread in
                        threadRow(thread)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .refreshable {
                    await store.send(.refresh).finish()
                }
            }
            .navigationTitle("Attention")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            store.send(.onAppear)
            store.send(.startPolling)
        }
        .onDisappear {
            store.send(.stopPolling)
        }
    }

    @ViewBuilder
    private func threadRow(_ thread: AttentionThread) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(thread.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.textPrimary)
                    Spacer()
                    if thread.unanswered {
                        Circle()
                            .fill(Palette.accent)
                            .frame(width: 8, height: 8)
                    }
                }

                if let latestBody = latestClaudeMessage(thread)?.body {
                    Text(latestBody)
                        .font(.footnote)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(3)
                }

                HStack(spacing: 8) {
                    TextField("Reply…", text: replyDraftBinding(for: thread.instanceId))
                        .padding(10)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                        .foregroundStyle(Palette.textPrimary)

                    Button {
                        guard let replyTo = latestClaudeMessage(thread)?.syncId else { return }
                        store.send(.sendReply(instanceId: thread.instanceId, replyTo: replyTo))
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.accentIcon)
                    .disabled(sendDisabled(thread))
                    .accessibilityLabel("Send reply")
                }
            }
        }
    }

    private func latestClaudeMessage(_ thread: AttentionThread) -> AttentionMessage? {
        thread.messages.last(where: { $0.role == "claude" })
    }

    private func replyDraftBinding(for instanceId: String) -> Binding<String> {
        Binding(
            get: { store.replyDrafts[instanceId] ?? "" },
            set: { store.send(.replyDraftChanged(instanceId: instanceId, text: $0)) }
        )
    }

    private func sendDisabled(_ thread: AttentionThread) -> Bool {
        if store.isSending { return true }
        guard latestClaudeMessage(thread) != nil else { return true }
        let draft = store.replyDrafts[thread.instanceId] ?? ""
        return draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
