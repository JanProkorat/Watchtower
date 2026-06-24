// apps/ipad/src/components/SpawnModal.tsx
import { useEffect, useState } from 'react';
import { useConnection } from '../state/connectionContext.js';
import type { ProjectSummary } from '../state/useProjects.js';

type InstanceKind = 'claude' | 'shell';

interface Props {
  open: boolean;
  projects: ProjectSummary[];
  onClose(): void;
  onSpawned(instanceId: string): void;
}

/**
 * Modal for spawning a new instance (or restarting a non-live one).
 *
 * Resume/restart affordance: the project list also shows instances that are
 * currently non-live (crashed / exited) for the selected project. If the user
 * taps "Restartovat" on one, we call `restartInstance` instead of
 * `spawnInstance`. This keeps the flow inside a single modal and avoids
 * requiring Task 11 wiring. The list is derived from the `instances` prop
 * (optional; callers that don't pass it yet get only the spawn flow).
 */

export interface NonLiveInstance {
  id: string;
  cwd: string;
  status: string;
}

interface PropsWithInstances extends Props {
  /** Non-live instances so the modal can offer a restart. Optional. */
  nonLiveInstances?: NonLiveInstance[];
}

const LIVE_STATUSES = new Set(['running', 'waiting-permission', 'waiting-input', 'idle-notify', 'idle']);

// Returns true if the status is considered live (i.e. does NOT need a restart).
function isLive(status: string): boolean {
  return LIVE_STATUSES.has(status);
}

export function SpawnModal({
  open,
  projects,
  onClose,
  onSpawned,
  nonLiveInstances = [],
}: PropsWithInstances) {
  const { bridge } = useConnection();

  // Only projects with a non-null folderPath can be used to spawn.
  const spawnableProjects = projects.filter((p): p is ProjectSummary & { folderPath: string } =>
    p.folderPath !== null,
  );

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    spawnableProjects[0]?.id ?? null,
  );

  // Auto-select the first spawnable project once the list loads async.
  // Does not clobber a valid existing user selection.
  useEffect(() => {
    setSelectedProjectId((cur) =>
      cur != null && spawnableProjects.some((p) => p.id === cur)
        ? cur
        : (spawnableProjects[0]?.id ?? null),
    );
  }, [spawnableProjects]);

  const [instanceKind, setInstanceKind] = useState<InstanceKind>('claude');
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const selectedProject = spawnableProjects.find((p) => p.id === selectedProjectId) ?? null;

  // Non-live instances that belong to the selected project.
  const restartCandidates = selectedProject
    ? nonLiveInstances.filter(
        (inst) => inst.cwd === selectedProject.folderPath && !isLive(inst.status),
      )
    : [];

  async function handleSpawn() {
    if (!selectedProject) return;
    setSpawning(true);
    setError(null);
    try {
      const res = await bridge.invoke('spawnInstance', {
        cwd: selectedProject.folderPath,
        instanceKind,
      }) as { instanceId: string | null; error?: string };

      if (res.error || res.instanceId === null) {
        setError(res.error ?? 'Instance se nepodařilo spustit');
      } else {
        onSpawned(res.instanceId);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSpawning(false);
    }
  }

  async function handleRestart(instanceId: string) {
    setSpawning(true);
    setError(null);
    try {
      const res = await bridge.invoke('restartInstance', { instanceId }) as { ok: boolean };
      if (res.ok) {
        onSpawned(instanceId);
        onClose();
      } else {
        setError('Restart se nepodařil');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSpawning(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          zIndex: 100,
        }}
      />

      {/* Modal panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nová instance"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          zIndex: 101,
          backgroundColor: '#1a1b1f',
          border: '1px solid #2e3038',
          borderRadius: 12,
          width: 'min(480px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'system-ui, sans-serif',
          color: '#e5e7eb',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: '1px solid #2e3038',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>Nová instance</span>
          <button
            onClick={onClose}
            disabled={spawning}
            aria-label="Zavřít"
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Project picker */}
          <section>
            <label
              style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              Projekt
            </label>
            {spawnableProjects.length === 0 ? (
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                Žádné projekty s nastavenou složkou.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {spawnableProjects.map((p) => {
                  const checked = p.id === selectedProjectId;
                  return (
                    <label
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: `1px solid ${checked ? '#7c6df0' : '#2e3038'}`,
                        backgroundColor: checked ? '#2d2857' : '#252730',
                        cursor: 'pointer',
                        transition: 'background-color 120ms ease, border-color 120ms ease',
                      }}
                    >
                      <input
                        type="radio"
                        name="spawn-project"
                        value={p.id}
                        checked={checked}
                        onChange={() => { setSelectedProjectId(p.id); setError(null); }}
                        style={{ accentColor: '#7c6df0', flexShrink: 0 }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#c4b8ff' : '#d1d5db' }}>
                          {p.name}
                        </span>
                        <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.folderPath}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {/* Kind toggle */}
          <section>
            <label
              style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              Typ instance
            </label>
            <div
              style={{
                display: 'inline-flex',
                borderRadius: 8,
                border: '1px solid #2e3038',
                overflow: 'hidden',
              }}
            >
              {(['claude', 'shell'] as InstanceKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setInstanceKind(k)}
                  style={{
                    padding: '7px 20px',
                    border: 'none',
                    backgroundColor: instanceKind === k ? '#7c6df0' : '#252730',
                    color: instanceKind === k ? '#fff' : '#9ca3af',
                    fontSize: 13,
                    fontWeight: instanceKind === k ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'background-color 120ms ease, color 120ms ease',
                    fontFamily: 'system-ui, sans-serif',
                  }}
                >
                  {k === 'claude' ? 'Claude' : 'Shell'}
                </button>
              ))}
            </div>
          </section>

          {/* Restart candidates (non-live instances for the selected project) */}
          {restartCandidates.length > 0 && (
            <section>
              <label
                style={{ display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}
              >
                Restartovat existující
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {restartCandidates.map((inst) => (
                  <div
                    key={inst.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '7px 10px',
                      borderRadius: 8,
                      backgroundColor: '#252730',
                      border: '1px solid #2e3038',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: '#d1d5db', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inst.id.slice(0, 12)}…
                      </span>
                      <span style={{ fontSize: 11, color: '#ef4444' }}>{inst.status}</span>
                    </div>
                    <button
                      onClick={() => void handleRestart(inst.id)}
                      disabled={spawning}
                      style={{
                        padding: '5px 12px',
                        borderRadius: 6,
                        border: '1px solid #3a3c46',
                        backgroundColor: '#2d2d38',
                        color: spawning ? '#4b5563' : '#d1d5db',
                        fontSize: 12,
                        cursor: spawning ? 'not-allowed' : 'pointer',
                        fontFamily: 'system-ui, sans-serif',
                        flexShrink: 0,
                      }}
                    >
                      Restartovat
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Inline error */}
          {error && (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                backgroundColor: '#2d1515',
                border: '1px solid #7f1d1d',
                color: '#fca5a5',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 16px',
            borderTop: '1px solid #2e3038',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            disabled={spawning}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: '1px solid #3a3c46',
              backgroundColor: '#252730',
              color: '#d1d5db',
              fontSize: 14,
              cursor: spawning ? 'not-allowed' : 'pointer',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Zrušit
          </button>
          <button
            onClick={() => void handleSpawn()}
            disabled={spawning || selectedProject === null}
            style={{
              padding: '8px 22px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: spawning || selectedProject === null ? '#4b4a72' : '#7c6df0',
              color: spawning || selectedProject === null ? '#9ca3af' : '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: spawning || selectedProject === null ? 'not-allowed' : 'pointer',
              fontFamily: 'system-ui, sans-serif',
              transition: 'background-color 120ms ease',
            }}
          >
            {spawning ? 'Spouštím…' : 'Spustit'}
          </button>
        </div>
      </div>
    </>
  );
}
