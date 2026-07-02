import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeId } from '@watchtower/shared/layout.js';
import { computePaneRects, type Rect } from '@watchtower/shared/computePaneRects.js';
import type { TabLayout, PaneTree } from '../state/workspaceLayoutModel.js';
import { sizesAfterDrag } from '../lib/paneResize.js';
import { PaneTerminal } from './PaneTerminal.js';

const GAP = 8;

interface Props {
  layout: TabLayout;
  onFocusLeaf: (leafId: NodeId, instanceId: string) => void;
  onResize: (splitId: NodeId, sizes: number[]) => void;
}

interface Divider {
  splitId: NodeId;
  index: number; // divider between children[index] and children[index+1]
  dir: 'row' | 'col';
  sizes: number[];
  avail: number; // px available along the split axis (minus gaps)
  rect: Rect; // the handle's pixel rect
}

/**
 * Flat, absolute-positioned terminal pool for one project-group tab. Every live
 * leaf's terminal is a sibling absolutely-positioned child of one stable
 * container; positions come from the pure `computePaneRects`. Terminals are
 * never reparented, so xterm is never remounted. Divider handles sit in the
 * gaps between sibling panes; dragging one updates that split's sizes.
 */
export function WorkspacePane({ layout, onFocusLeaf, onResize }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

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

  // Active drag: split + starting pointer coord + starting sizes. Held in a ref
  // so pointermove doesn't need to re-bind; pointer capture routes all events
  // to the handle even when the finger leaves it.
  const dragRef = useRef<{ splitId: NodeId; index: number; dir: 'row' | 'col'; start: number; avail: number; sizes: number[] } | null>(null);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
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
