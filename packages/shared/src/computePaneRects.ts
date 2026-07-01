import type { NodeId, WorkspaceNode } from './layout.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Walk the workspace tree and assign each leaf a pixel rect that exactly tiles
 * the [0,0,width,height] box. `gap` px is reserved between sibling panes for
 * divider handles (n children -> (n-1) gaps along the split axis).
 */
export function computePaneRects<TLeaf>(
  root: WorkspaceNode<TLeaf>,
  width: number,
  height: number,
  gap: number,
): Map<NodeId, Rect> {
  const out = new Map<NodeId, Rect>();
  walk(root, 0, 0, width, height, gap, out);
  return out;
}

function walk<TLeaf>(
  node: WorkspaceNode<TLeaf>,
  x: number,
  y: number,
  w: number,
  h: number,
  gap: number,
  out: Map<NodeId, Rect>,
): void {
  if (node.kind === 'leaf') {
    out.set(node.id, { x, y, w, h });
    return;
  }
  const n = node.children.length;
  const totalGap = gap * Math.max(0, n - 1);
  const sum = node.sizes.reduce((a, b) => a + b, 0) || 1;
  if (node.dir === 'row') {
    const avail = w - totalGap;
    let cx = x;
    node.children.forEach((child, i) => {
      const cw = ((node.sizes[i] ?? 0) / sum) * avail;
      walk(child, cx, y, cw, h, gap, out);
      cx += cw + gap;
    });
  } else {
    const avail = h - totalGap;
    let cy = y;
    node.children.forEach((child, i) => {
      const ch = ((node.sizes[i] ?? 0) / sum) * avail;
      walk(child, x, cy, w, ch, gap, out);
      cy += ch + gap;
    });
  }
}
