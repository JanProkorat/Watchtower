// apps/ipad/src/components/AuthBlockBanner.tsx
// Amber banner shown when one or more instances are waiting for browser auth.
// Rendered inside Shell (inside <ConnectionProvider>) so it sits above the
// InstancesModule content, in the shared column layout.

export function AuthBlockBanner({
  blockedIds,
  onOpen,
}: {
  blockedIds: Set<string>;
  onOpen: () => void;
}) {
  if (blockedIds.size === 0) return null;
  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 16px',
        backgroundColor: '#3a2f12',
        borderBottom: '1px solid #a16207',
        color: '#fde68a',
        fontSize: 13,
      }}
    >
      <span>Mac čeká na přihlášení v prohlížeči</span>
      <button
        onClick={onOpen}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: 'none',
          backgroundColor: '#7c6df0',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          WebkitTapHighlightColor: 'transparent',
          cursor: 'pointer',
        }}
      >
        Otevřít obrazovku Macu
      </button>
    </div>
  );
}
