import { glassPanel, text } from '@watchtower/ui-core';

export interface PickerCandidate {
  instanceId: string;
  label: string;
}

interface Props {
  candidates: PickerCandidate[];
  onPick: (instanceId: string) => void;
  onCancel: () => void;
}

/**
 * Small centered overlay listing the instances that can fill a newly-split
 * pane (the tab group's instances not already mounted). Tapping the backdrop or
 * "Zrušit" cancels. Inline-styled glass — no MUI.
 */
export function PanePicker({ candidates, onPick, onCancel }: Props) {
  return (
    <div
      onPointerDown={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.42)',
      }}
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          ...glassPanel({ radius: 16 }),
          width: '86%',
          maxWidth: 360,
          maxHeight: '72%',
          overflowY: 'auto',
          padding: 14,
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: text.secondary, marginBottom: 2 }}>
          Vyberte instanci do panelu
        </div>

        {candidates.length === 0 ? (
          <div style={{ fontSize: 13, color: text.dim, padding: '10px 4px' }}>Žádné další instance</div>
        ) : (
          candidates.map((c) => (
            <button
              key={c.instanceId}
              onClick={() => onPick(c.instanceId)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.07)',
                color: text.primary,
                fontSize: 14,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {c.label}
            </button>
          ))
        )}

        <button
          onClick={onCancel}
          style={{
            marginTop: 4,
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.05)',
            color: text.muted,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Zrušit
        </button>
      </div>
    </div>
  );
}
