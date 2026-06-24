// apps/ipad/src/components/TabStrip.tsx
import { useMemo } from 'react';
import { groupInstancesByProject } from '@watchtower/shared/groupInstances.js';
import { ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';
import type { GroupableInstance, GroupableProject } from '@watchtower/shared/groupInstances.js';

interface Props {
  instances: ReadonlyArray<GroupableInstance>;
  projects: ReadonlyArray<GroupableProject>;
  activeInstanceId: string | null;
  onSelectInstance(instanceId: string): void;
  onNew(): void;
}

/**
 * Top horizontal strip. One tab per project group computed by
 * `groupInstancesByProject`. A ⚠️ marker appears when any instance in the
 * group is in an action-needed state (waiting-permission, waiting-input,
 * crashed). Tapping a tab selects the group's "best" instance: the currently-
 * active one if it belongs to the group, otherwise the first in `instanceIds`.
 */
export function TabStrip({
  instances,
  projects,
  activeInstanceId,
  onSelectInstance,
  onNew,
}: Props) {
  // Re-compute groups whenever instances or projects change.
  const groups = useMemo(
    () => groupInstancesByProject(instances, projects),
    [instances, projects],
  );

  // Build a quick status lookup by instance id.
  const statusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const inst of instances) m.set(inst.id, inst.status);
    return m;
  }, [instances]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        minHeight: 44,
        backgroundColor: '#13141a',
        borderBottom: '1px solid #2e3038',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        flexShrink: 0,
        gap: 0,
      }}
    >
      {groups.map((group) => {
        // Is any instance in this group in an action-needed state?
        const needsAttention = group.instanceIds.some(
          (id) => ACTION_NEEDED_STATUSES.has(statusById.get(id) ?? ''),
        );

        // Which instance should be selected when this tab is tapped?
        // Prefer the currently-active instance if it belongs to this group;
        // otherwise fall back to the first instance in the group.
        const targetId = group.instanceIds.includes(activeInstanceId ?? '')
          ? (activeInstanceId as string)
          : group.instanceIds[0];

        const isActive =
          activeInstanceId !== null && group.instanceIds.includes(activeInstanceId);

        return (
          <GroupTab
            key={group.projectId ?? 'other'}
            label={group.label}
            active={isActive}
            attention={needsAttention}
            onTap={() => targetId && onSelectInstance(targetId)}
          />
        );
      })}

      {/* Spacer pushes the + button to the right */}
      <div style={{ flex: 1 }} />

      {/* New-instance button */}
      <button
        onClick={onNew}
        title="Nová instance"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 44,
          height: '100%',
          padding: '0 12px',
          border: 'none',
          backgroundColor: 'transparent',
          color: '#9ca3af',
          fontSize: 22,
          cursor: 'pointer',
          flexShrink: 0,
          WebkitTapHighlightColor: 'transparent',
          transition: 'color 120ms ease',
        }}
        onPointerEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#a89cf0'; }}
        onPointerLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
        aria-label="Nová instance"
      >
        +
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual group tab button
// ---------------------------------------------------------------------------

interface GroupTabProps {
  label: string;
  active: boolean;
  attention: boolean;
  onTap(): void;
}

function GroupTab({ label, active, attention, onTap }: GroupTabProps) {
  return (
    <button
      onClick={onTap}
      role="tab"
      aria-selected={active}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        padding: '0 14px',
        height: '100%',
        border: 'none',
        borderBottom: `2px solid ${active ? '#7c6df0' : 'transparent'}`,
        backgroundColor: active ? '#1c1d28' : 'transparent',
        color: active ? '#e5e7eb' : '#9ca3af',
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: active ? 600 : 400,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
        WebkitTapHighlightColor: 'transparent',
      }}
      onPointerEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1e2028';
          (e.currentTarget as HTMLButtonElement).style.color = '#d1d5db';
        }
      }}
      onPointerLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
        }
      }}
    >
      {/* Attention badge or accent dot */}
      {attention ? (
        <span
          aria-label="Vyžaduje pozornost"
          title="Vyžaduje pozornost"
          style={{ fontSize: 14, lineHeight: 1 }}
        >
          ⚠️
        </span>
      ) : (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: active ? '#7c6df0' : '#4b5563',
            flexShrink: 0,
            display: 'inline-block',
          }}
        />
      )}
      {label}
    </button>
  );
}
