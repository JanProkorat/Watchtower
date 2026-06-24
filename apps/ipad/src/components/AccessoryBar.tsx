// apps/ipad/src/components/AccessoryBar.tsx
import type { AccessoryKey } from '../lib/accessoryKeys.js';
import { accessoryKeyToSequence } from '../lib/accessoryKeys.js';

interface Props {
  onKey(seq: string): void;
  ctrlArmed: boolean;
  onToggleCtrl(): void;
}

const ARROW_KEYS: { label: string; key: AccessoryKey }[] = [
  { label: '↑', key: 'up' },
  { label: '↓', key: 'down' },
  { label: '←', key: 'left' },
  { label: '→', key: 'right' },
];

export function AccessoryBar({ onKey, ctrlArmed, onToggleCtrl }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 6,
        padding: '4px 8px',
        backgroundColor: '#1a1b1f',
        borderTop: '1px solid #2e3038',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        flexShrink: 0,
      }}
    >
      <AccessoryButton label="Esc" onPress={() => onKey(accessoryKeyToSequence('esc'))} />
      <AccessoryButton
        label="Ctrl"
        onPress={onToggleCtrl}
        active={ctrlArmed}
      />
      <AccessoryButton label="Tab" onPress={() => onKey(accessoryKeyToSequence('tab'))} />
      {ARROW_KEYS.map(({ label, key }) => (
        <AccessoryButton key={key} label={label} onPress={() => onKey(accessoryKeyToSequence(key))} />
      ))}
    </div>
  );
}

interface ButtonProps {
  label: string;
  onPress(): void;
  active?: boolean;
}

function AccessoryButton({ label, onPress, active = false }: ButtonProps) {
  return (
    <button
      onPointerDown={(e) => {
        // Prevent the xterm textarea from losing focus on tap.
        e.preventDefault();
        onPress();
      }}
      style={{
        minWidth: 40,
        height: 36,
        padding: '0 10px',
        border: '1px solid',
        borderColor: active ? '#7c6df0' : '#3a3c46',
        borderRadius: 6,
        backgroundColor: active ? '#3b3468' : '#252730',
        color: active ? '#c4b8ff' : '#d1d5db',
        fontSize: 14,
        fontFamily: 'system-ui, sans-serif',
        cursor: 'pointer',
        flexShrink: 0,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {label}
    </button>
  );
}
