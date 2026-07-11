import type { NodeId } from '@watchtower/shared/layout.js';
import type { Rect } from '@watchtower/shared/computePaneRects.js';

type Dir = 'left' | 'right' | 'up' | 'down';

/**
 * Nearest leaf whose center lies in `dir` from the focused pane's center,
 * tie-broken by cross-axis proximity (prefer aligned neighbours). Returns null
 * when the focused id is unknown or there is no pane that way.
 */
export function adjacentLeaf(
  rects: Map<NodeId, Rect>,
  focusedLeafId: NodeId,
  dir: Dir,
): NodeId | null {
  const from = rects.get(focusedLeafId);
  if (!from) return null;
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  let best: NodeId | null = null;
  let bestScore = Infinity;
  for (const [id, r] of rects) {
    if (id === focusedLeafId) continue;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const inDir =
      dir === 'right' ? c.x > fc.x :
      dir === 'left' ? c.x < fc.x :
      dir === 'down' ? c.y > fc.y :
      c.y < fc.y;
    if (!inDir) continue;
    const primary = dir === 'left' || dir === 'right' ? Math.abs(c.x - fc.x) : Math.abs(c.y - fc.y);
    const cross = dir === 'left' || dir === 'right' ? Math.abs(c.y - fc.y) : Math.abs(c.x - fc.x);
    const score = primary + cross * 2; // prefer aligned neighbours
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}
