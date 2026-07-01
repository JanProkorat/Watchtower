// apps/ipad/src/components/TabStrip.tsx
import { useMemo, type CSSProperties } from 'react';
import { groupInstancesByProject } from '@watchtower/shared/groupInstances.js';
import { ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';
import type { GroupableInstance, GroupableProject } from '@watchtower/shared/groupInstances.js';
import { glassPanel, accentHover, text } from '../theme/glass.js';

interface Props {
  instances: ReadonlyArray<GroupableInstance>;
  projects: ReadonlyArray<GroupableProject>;
  activeInstanceId: string | null;
  /** Instances the user has acknowledged (focused) — suppressed from the ⚠️. */
  ackedIds: ReadonlySet<string>;
  onSelectInstance(instanceId: string): void;
  onNew(): void;
}

/**
 * Top horizontal strip. One tab per project group computed by
 * `groupInstancesByProject`. A ⚠️ marker appears when any *un-acknowledged*
 * instance in the group is in an action-needed state (waiting-permission,
 * waiting-input, crashed); focusing an instance acknowledges it, so the marker
 * clears. Tapping a tab selects the group's "best" instance: the currently-
 * active one if it belongs to the group, otherwise the first in `instanceIds`.
 */
export function TabStrip({
  instances,
  projects,
  activeInstanceId,
  ackedIds,
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
    /* Outer gutter: the glass strip floats 16px from all edges */
    <div
      style={{
        padding: '8px 16px',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          height: 38,
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          gap: 6,
          padding: '0 6px',
          ...glassPanel({ radius: 14, shadow: '0 14px 34px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.20)' }),
        }}
      >
        {groups.map((group) => {
          // Is any *un-acknowledged* instance in this group in an action-needed
          // state? Acknowledged (focused) instances are suppressed.
          const needsAttention = group.instanceIds.some(
            (id) => ACTION_NEEDED_STATUSES.has(statusById.get(id) ?? '') && !ackedIds.has(id),
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

        {/* New-instance button — soft glass chip */}
        <button
          onClick={onNew}
          title="Nová instance"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 30,
            height: 26,
            padding: '0 10px',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 10,
            backgroundColor: 'rgba(255,255,255,0.10)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.20)',
            color: text.secondary,
            fontSize: 18,
            lineHeight: 1,
            cursor: 'pointer',
            flexShrink: 0,
            WebkitTapHighlightColor: 'transparent',
            transition: 'background-color 120ms ease, color 120ms ease',
          }}
          onPointerEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.18)';
            (e.currentTarget as HTMLButtonElement).style.color = '#fff';
          }}
          onPointerLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.10)';
            (e.currentTarget as HTMLButtonElement).style.color = text.secondary;
          }}
          aria-label="Nová instance"
        >
          +
        </button>
      </div>
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
  // Dot style — three states: attention (amber glow), active (purple glow), inactive (muted grey)
  const dotStyle: CSSProperties = attention
    ? {
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: '#f5a524',
        boxShadow: '0 0 8px #f5a524',
        flexShrink: 0,
        display: 'inline-block',
      }
    : active
      ? {
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: accentHover,
          boxShadow: `0 0 8px ${accentHover}`,
          flexShrink: 0,
          display: 'inline-block',
        }
      : {
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: '#6b7488',
          flexShrink: 0,
          display: 'inline-block',
        };

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
        padding: '0 12px',
        height: 26,
        border: 'none',
        borderRadius: 10,
        backgroundColor: active ? 'rgba(255,255,255,0.20)' : 'transparent',
        boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.30)' : 'none',
        color: active ? '#fff' : text.secondary,
        fontSize: 11,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: active ? 600 : 400,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
        WebkitTapHighlightColor: 'transparent',
      }}
      onPointerEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.10)';
          (e.currentTarget as HTMLButtonElement).style.color = '#fff';
        }
      }}
      onPointerLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.color = text.secondary;
        }
      }}
    >
      {/* Status / attention dot — amber glow for attention, purple glow for active, muted for inactive */}
      <span
        aria-label={attention ? 'Vyžaduje pozornost' : undefined}
        title={attention ? 'Vyžaduje pozornost' : undefined}
        style={dotStyle}
      />
      {label}
    </button>
  );
}
