import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeId } from '@watchtower/shared/layout.js';
import { computePaneRects, type Rect } from '@watchtower/shared/computePaneRects.js';
import type { TabLayout, PaneTree } from '../state/workspaceLayoutModel.js';
import { sizesAfterDrag } from '../lib/paneResize.js';
import { availableInstancesForPicker } from '../lib/panePicker.js';
import { adjacentLeaf } from '../lib/paneNav.js';
import { PaneTerminal } from './PaneTerminal.js';
import { PanePicker } from './PanePicker.js';

const GAP = 8;

interface Props {
  layout: TabLayout;
  onFocusLeaf: (leafId: NodeId, instanceId: string) => void;
  onResize: (splitId: NodeId, sizes: number[]) => void;
  onSplit: (leafId: NodeId, dir: 'row' | 'col', position: 'before' | 'after', instanceId: string) => void;
  onClose: (leafId: NodeId) => void;
  onKill: (leafId: NodeId, instanceId: string) => void;
  /** All instances in this tab's project group, in group order. */
  groupInstanceIds: string[];
  /** Human-readable label for an instance id (for the picker). */
  labelFor: (instanceId: string) => string;
}

interface Divider {
  splitId: NodeId;
  index: number; // divider between children[index] and children[index+1]
  dir: 'row' | 'col';
  sizes: number[];
  avail: number; // px available along the split axis (minus gaps)
  rect: Rect; // the handle's pixel rect
}

interface PendingSplit {
  leafId: NodeId;
  dir: 'row' | 'col';
  position: 'before' | 'after';
}

/**
 * Flat, absolute-positioned terminal pool for one project-group tab. Every live
 * leaf's terminal is a sibling absolutely-positioned child of one stable
 * container; positions come from the pure `computePaneRects`. Terminals are
 * never reparented, so xterm is never remounted. Divider handles sit in the
 * gaps between sibling panes; each pane's chrome splits/closes it; a split opens
 * the instance picker to choose what fills the new pane.
 */
export function WorkspacePane({ layout, onFocusLeaf, onResize, onSplit, onClose, onKill, groupInstanceIds, labelFor }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [pending, setPending] = useState<PendingSplit | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const rects = useMemo<Map<NodeId, Rect>>(
    () => computePaneRects(layout.root, size.w, size.h, GAP),
    [layout.root, size.w, size.h],
  );

  const leaves = useMemo(() => leafEntries(layout.root), [layout.root]);
  const dividers = useMemo(() => collectDividers(layout.root, rects), [layout.root, rects]);

  const mountedIds = useMemo(() => leaves.map((l) => l.instanceId), [leaves]);
  const candidates = useMemo(
    () => availableInstancesForPicker(groupInstanceIds, mountedIds).map((id) => ({ instanceId: id, label: labelFor(id) })),
    [groupInstanceIds, mountedIds, labelFor],
  );

  // Active drag: split + starting pointer coord + starting sizes. Held in a ref
  // so pointermove doesn't need to re-bind; pointer capture routes all events
  // to the handle even when the finger leaves it.
  const dragRef = useRef<{ splitId: NodeId; index: number; dir: 'row' | 'col'; start: number; avail: number; sizes: number[] } | null>(null);

  // Leaf-only rect map for geometric focus navigation. computePaneRects also
  // emits split-node rects (for dividers); those must be excluded here or ⌘⌥
  // arrows could "focus" a split node.
  const leafRects = useMemo<Map<NodeId, Rect>>(() => {
    const m = new Map<NodeId, Rect>();
    for (const { leafId } of leaves) {
      const r = rects.get(leafId);
      if (r) m.set(leafId, r);
    }
    return m;
  }, [leaves, rects]);

  // Latest values for the once-bound keydown handler (avoids re-binding the
  // window listener on every layout/resize change).
  const nav = useRef({ focusedLeafId: layout.focusedLeafId, leafRects, leaves, onClose, onFocusLeaf });
  nav.current = { focusedLeafId: layout.focusedLeafId, leafRects, leaves, onClose, onFocusLeaf };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const st = nav.current;
      const focused = st.focusedLeafId;
      if (!focused) return;
      const key = e.key.toLowerCase();
      if (key === 'd') {
        e.preventDefault();
        setPending({ leafId: focused, dir: e.shiftKey ? 'col' : 'row', position: 'after' });
      } else if (key === 'w') {
        e.preventDefault();
        st.onClose(focused);
      } else if (e.altKey && e.key.startsWith('Arrow')) {
        const dir = e.key === 'ArrowLeft' ? 'left'
          : e.key === 'ArrowRight' ? 'right'
          : e.key === 'ArrowUp' ? 'up' : 'down';
        const next = adjacentLeaf(st.leafRects, focused, dir);
        if (next) {
          e.preventDefault();
          const inst = st.leaves.find((l) => l.leafId === next)?.instanceId;
          if (inst) st.onFocusLeaf(next, inst);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // The container is absolutely pinned to the (position:relative) body's content
  // box. Using inset:0 instead of height:100% avoids a WebKit flex quirk where
  // the % height resolves against the viewport and the panes overflow below the
  // tab strip, clipping the terminal's last line.
  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
      {size.w > 0 && leaves.map(({ leafId, instanceId }) => {
        const rect = rects.get(leafId);
        if (!rect) return null;
        return (
          <PaneTerminal
            key={leafId}
            instanceId={instanceId}
            rect={rect}
            focused={layout.focusedLeafId === leafId}
            onFocus={() => onFocusLeaf(leafId, instanceId)}
            onSplit={(dir, position) => setPending({ leafId, dir, position })}
            onClose={() => onClose(leafId)}
            onKill={() => onKill(leafId, instanceId)}
          />
        );
      })}

      {size.w > 0 && dividers.map((d) => (
        <div
          key={`${d.splitId}:${d.index}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            dragRef.current = {
              splitId: d.splitId, index: d.index, dir: d.dir,
              start: d.dir === 'row' ? e.clientX : e.clientY,
              avail: d.avail, sizes: d.sizes,
            };
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag) return;
            const cur = drag.dir === 'row' ? e.clientX : e.clientY;
            const dpx = cur - drag.start;
            const sum = drag.sizes.reduce((a, b) => a + b, 0) || 1;
            const deltaPercent = drag.avail > 0 ? (dpx / drag.avail) * sum : 0;
            onResize(drag.splitId, sizesAfterDrag(drag.sizes, drag.index, deltaPercent));
          }}
          onPointerUp={(e) => {
            dragRef.current = null;
            (e.currentTarget as Element).releasePointerCapture(e.pointerId);
          }}
          style={{
            position: 'absolute',
            left: d.rect.x, top: d.rect.y, width: d.rect.w, height: d.rect.h,
            cursor: d.dir === 'row' ? 'col-resize' : 'row-resize',
            touchAction: 'none',
            zIndex: 5,
          }}
        />
      ))}

      {pending && (
        <PanePicker
          candidates={candidates}
          onPick={(instanceId) => {
            onSplit(pending.leafId, pending.dir, pending.position, instanceId);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

/** leafId -> instanceId (leaf.tabId holds the instanceId on iPad). */
function leafEntries(root: PaneTree): Array<{ leafId: NodeId; instanceId: string }> {
  const out: Array<{ leafId: NodeId; instanceId: string }> = [];
  const walk = (n: PaneTree): void => {
    if (n.kind === 'leaf') out.push({ leafId: n.id, instanceId: n.tabId });
    else n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** One divider handle per adjacent child-pair of every split node. */
function collectDividers(root: PaneTree, rects: Map<NodeId, Rect>): Divider[] {
  const out: Divider[] = [];
  const walk = (n: PaneTree): void => {
    if (n.kind === 'leaf') return;
    const splitRect = rects.get(n.id);
    if (splitRect) {
      const count = n.children.length;
      const avail = (n.dir === 'row' ? splitRect.w : splitRect.h) - GAP * Math.max(0, count - 1);
      for (let i = 0; i < count - 1; i++) {
        const childRect = rects.get(n.children[i]!.id);
        if (!childRect) continue;
        const rect: Rect = n.dir === 'row'
          ? { x: childRect.x + childRect.w, y: splitRect.y, w: GAP, h: splitRect.h }
          : { x: splitRect.x, y: childRect.y + childRect.h, w: splitRect.w, h: GAP };
        out.push({ splitId: n.id, index: i, dir: n.dir, sizes: n.sizes, avail, rect });
      }
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}
