import Foundation

/// Group instances under their project (matched by cwd == folderPath); unmatched
/// instances collect in a trailing "Other" group. Empty project groups are omitted.
/// Port of packages/shared/src/groupInstances.ts.
public func groupInstancesByProject(_ instances: [Instance], projects: [ProjectSummary]) -> [ProjectGroup] {
    var groups: [ProjectGroup] = []
    var claimed = Set<String>()
    for project in projects {
        guard let path = project.folderPath else { continue }
        let ids = instances.filter { $0.cwd == path }.map(\.id)
        guard !ids.isEmpty else { continue }
        ids.forEach { claimed.insert($0) }
        groups.append(ProjectGroup(projectId: project.id, label: project.name, folderPath: path, instanceIds: ids))
    }
    let orphans = instances.filter { !claimed.contains($0.id) }.map(\.id)
    if !orphans.isEmpty {
        groups.append(ProjectGroup(projectId: nil, label: "Other", folderPath: nil, instanceIds: orphans))
    }
    return groups
}

/// Ids that should show an attention dot: status needs action and not acknowledged.
public func acknowledgedNeedingAttention(instances: [Instance], acked: Set<String>) -> Set<String> {
    Set(instances.filter { InstanceAttention.actionNeeded.contains($0.status) && !acked.contains($0.id) }.map(\.id))
}

/// Drop an acked id once its instance no longer needs attention (so re-entry re-notifies).
/// Port of reconcileAcked: keep an ack only while its instance is still in the attention set.
public func reconcileAcked(_ acked: Set<String>, instances: [Instance]) -> Set<String> {
    let stillNeeding = Set(instances.filter { InstanceAttention.actionNeeded.contains($0.status) }.map(\.id))
    return acked.intersection(stillNeeding)
}

/// Fold an authBlock push into the blocked-id set; returns prev unchanged on no-op.
/// Port of authBlockStore.ts applyAuthBlock.
public func applyAuthBlock(_ prev: Set<String>, instanceId: String, blocked: Bool) -> Set<String> {
    if blocked == prev.contains(instanceId) { return prev }
    var next = prev
    if blocked { next.insert(instanceId) } else { next.remove(instanceId) }
    return next
}
