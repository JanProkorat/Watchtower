import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeId } from '@watchtower/shared/layout.js';
import { computePaneRects, type Rect } from '@watchtower/shared/computePaneRects.js';
import type { TabLayout, PaneTree } from '../state/workspaceLayoutModel.js';
import { PaneTerminal } from './PaneTerminal.js';

const GAP = 8;

interface Props {
  layout: TabLayout;
  onFocusLeaf: (leafId: NodeId, instanceId: string) => void;
}

/**
 * Flat, absolute-positioned terminal pool for one project-group tab. Every live
 * leaf's terminal is a sibling absolutely-positioned child of one stable
 * container; positions come from the pure `computePaneRects`. Terminals are
 * never reparented, so xterm is never remounted.
 */
export function WorkspacePane({ layout, onFocusLeaf }: Props) {
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
