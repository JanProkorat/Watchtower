// apps/ipad/src/components/SpawnModal.tsx
import { useEffect, useState } from 'react';
import { useConnection } from '../state/connectionContext.js';
import type { ProjectSummary } from '../state/useProjects.js';
import { glassPanel, glassFillStrong, ctaGradient, ctaGlow, text, accent } from '@watchtower/ui-core';

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
          background: 'rgba(6,7,11,0.45)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
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
          ...glassPanel({
            radius: 22,
            fill: glassFillStrong,
            blur: 40,
            saturate: 1.9,
            brightness: 1.1,
            shadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.32)',
          }),
          width: 'min(480px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'system-ui, sans-serif',
          color: text.primary,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.10)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f8' }}>Nová instance</span>
          <button
            onClick={onClose}
            disabled={spawning}
            aria-label="Zavřít"
            style={{
              background: 'none',
              border: 'none',
              color: text.muted,
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
              style={{ display: 'block', fontSize: 10, color: text.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              Projekt
            </label>
            {spawnableProjects.length === 0 ? (
              <p style={{ fontSize: 13, color: text.dim, margin: 0 }}>
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
                        padding: '8px 12px',
                        borderRadius: 11,
                        border: checked
                          ? `1px solid rgba(124,109,240,0.55)`
                          : '1px solid rgba(255,255,255,0.13)',
                        background: checked
                          ? 'rgba(168,156,240,0.18)'
                          : 'rgba(255,255,255,0.07)',
                        cursor: 'pointer',
                        transition: 'background 120ms ease, border-color 120ms ease',
                        boxShadow: checked
                          ? `0 0 0 1px rgba(124,109,240,0.30), inset 0 1px 0 rgba(255,255,255,0.15)`
                          : 'inset 0 1px 0 rgba(255,255,255,0.08)',
                      }}
                    >
                      <input
                        type="radio"
                        name="spawn-project"
                        value={p.id}
                        checked={checked}
                        onChange={() => { setSelectedProjectId(p.id); setError(null); }}
                        style={{ accentColor: accent, flexShrink: 0 }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: checked ? 600 : 400, color: checked ? '#c9bdff' : text.secondary }}>
                          {p.name}
                        </span>
                        <span style={{ fontSize: 11, color: text.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
              style={{ display: 'block', fontSize: 10, color: text.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              Typ instance
            </label>
            <div
              style={{
                display: 'inline-flex',
                gap: 4,
                padding: 3,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.13)',
              }}
            >
              {(['claude', 'shell'] as InstanceKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setInstanceKind(k)}
                  style={{
                    padding: '5px 18px',
                    borderRadius: 7,
                    border: 'none',
                    background: instanceKind === k
                      ? 'rgba(168,156,240,0.22)'
                      : 'transparent',
                    boxShadow: instanceKind === k
                      ? 'inset 0 1px 0 rgba(255,255,255,0.20)'
                      : 'none',
                    color: instanceKind === k ? '#fff' : text.muted,
                    fontSize: 12,
                    fontWeight: instanceKind === k ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'background 120ms ease, color 120ms ease',
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
                style={{ display: 'block', fontSize: 10, color: text.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}
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
                      padding: '7px 12px',
                      borderRadius: 11,
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.13)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: text.secondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inst.id.slice(0, 12)}…
                      </span>
                      <span style={{ fontSize: 11, color: '#f87171' }}>{inst.status}</span>
                    </div>
                    <button
                      onClick={() => void handleRestart(inst.id)}
                      disabled={spawning}
                      style={{
                        padding: '5px 12px',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.13)',
                        background: 'rgba(255,255,255,0.08)',
                        color: spawning ? text.dim : text.secondary,
                        fontSize: 11.5,
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
                borderRadius: 11,
                background: 'rgba(110,24,24,0.32)',
                border: '1px solid rgba(248,113,113,0.40)',
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
            borderTop: '1px solid rgba(255,255,255,0.10)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            disabled={spawning}
            style={{
              padding: '8px 18px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.13)',
              background: 'rgba(255,255,255,0.08)',
              color: text.secondary,
              fontSize: 12,
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
              borderRadius: 12,
              border: 'none',
              background: spawning || selectedProject === null
                ? 'rgba(124,109,240,0.35)'
                : ctaGradient,
              boxShadow: spawning || selectedProject === null
                ? 'none'
                : ctaGlow,
              color: spawning || selectedProject === null ? 'rgba(255,255,255,0.40)' : '#fff',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: spawning || selectedProject === null ? 'not-allowed' : 'pointer',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {spawning ? 'Spouštím…' : 'Spustit'}
          </button>
        </div>
      </div>
    </>
  );
}
