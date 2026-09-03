/**
 * Marching squares over a scalar grid, producing iso-contours as polylines.
 *
 * Grid coordinates: point `(c, r)` is the centre of cell column `c`, row `r`.
 * `NaN` marks cells outside the region of interest; contours simply stop at
 * their edge rather than hugging it.
 */

export interface ScalarGrid {
  /** Row-major values, `rows * cols` long; NaN = no data. */
  z: ArrayLike<number>;
  cols: number;
  rows: number;
}

type Segment = [number, number, number, number];

/** Where a level crosses the edge between two grid values. */
function edgeT(p: number, q: number, level: number): number {
  if (q === p) return 0.5;
  const t = (level - p) / (q - p);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function key(x: number, y: number): string {
  return `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
}

/** Contour segments of one level, each a pair of points in grid coordinates. */
function segmentsForLevel(grid: ScalarGrid, level: number): Segment[] {
  const { z, cols, rows } = grid;
  const segs: Segment[] = [];

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = z[r * cols + c]; // top-left
      const b = z[r * cols + c + 1]; // top-right
      const cc = z[(r + 1) * cols + c + 1]; // bottom-right
      const d = z[(r + 1) * cols + c]; // bottom-left
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(cc) || Number.isNaN(d)) continue;

      const idx =
        (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (cc >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;

      // Crossing points on the four edges
      const T: [number, number] = [c + edgeT(a, b, level), r];
      const R: [number, number] = [c + 1, r + edgeT(b, cc, level)];
      const B: [number, number] = [c + edgeT(d, cc, level), r + 1];
      const L: [number, number] = [c, r + edgeT(a, d, level)];
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);

      switch (idx) {
        case 1: case 14: add(L, B); break;
        case 2: case 13: add(B, R); break;
        case 3: case 12: add(L, R); break;
        case 4: case 11: add(T, R); break;
        case 6: case 9: add(T, B); break;
        case 7: case 8: add(T, L); break;
        case 5: {
          // b and d inside: connected through the centre when it is inside too
          const centreInside = (a + b + cc + d) / 4 >= level;
          if (centreInside) { add(T, L); add(B, R); } else { add(T, R); add(L, B); }
          break;
        }
        case 10: {
          const centreInside = (a + b + cc + d) / 4 >= level;
          if (centreInside) { add(T, R); add(L, B); } else { add(T, L); add(B, R); }
          break;
        }
      }
    }
  }
  return segs;
}

/** Join segments that share endpoints into polylines (flat `[x0, y0, x1, y1, …]`). */
function joinSegments(segs: Segment[]): number[][] {
  const endpoints = new Map<string, number[]>(); // point key -> segment indices
  const register = (k: string, i: number) => {
    const list = endpoints.get(k);
    if (list) list.push(i);
    else endpoints.set(k, [i]);
  };
  segs.forEach((s, i) => {
    register(key(s[0], s[1]), i);
    register(key(s[2], s[3]), i);
  });

  const used = new Uint8Array(segs.length);
  const paths: number[][] = [];

  const takeNext = (x: number, y: number): [number, number] | null => {
    const list = endpoints.get(key(x, y));
    if (!list) return null;
    for (const i of list) {
      if (used[i]) continue;
      used[i] = 1;
      const s = segs[i];
      // Return the far end of the segment
      return key(s[0], s[1]) === key(x, y) ? [s[2], s[3]] : [s[0], s[1]];
    }
    return null;
  };

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segs[i];
    const forward: number[] = [s[0], s[1], s[2], s[3]];

    // Extend forward from the segment's second point
    let cur: [number, number] | null = [s[2], s[3]];
    while (cur) {
      const next = takeNext(cur[0], cur[1]);
      if (!next) break;
      forward.push(next[0], next[1]);
      cur = next;
      if (key(cur[0], cur[1]) === key(s[0], s[1])) break; // closed loop
    }

    // Extend backward from the first point
    const backward: number[] = [];
    cur = [s[0], s[1]];
    while (cur) {
      const prev = takeNext(cur[0], cur[1]);
      if (!prev) break;
      backward.push(prev[0], prev[1]);
      cur = prev;
    }
    for (let j = backward.length - 2; j >= 0; j -= 2) {
      forward.unshift(backward[j], backward[j + 1]);
    }
    paths.push(forward);
  }
  return paths;
}

export function isolinesFromGrid(grid: ScalarGrid, level: number): number[][] {
  return joinSegments(segmentsForLevel(grid, level));
}

/** One pass of Chaikin corner cutting; endpoints of open paths are kept. */
export function chaikin(path: number[], closed: boolean): number[] {
  const n = path.length / 2;
  if (n < 3) return path;
  const out: number[] = [];
  const px = (i: number) => path[((i % n) + n) % n * 2];
  const py = (i: number) => path[((i % n) + n) % n * 2 + 1];
  const last = closed ? n : n - 1;
  if (!closed) out.push(px(0), py(0));
  for (let i = 0; i < last; i++) {
    const x0 = px(i), y0 = py(i), x1 = px(i + 1), y1 = py(i + 1);
    out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1);
    out.push(0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
  }
  if (!closed) out.push(px(n - 1), py(n - 1));
  else out.push(out[0], out[1]);
  return out;
}

export function isClosedPath(path: number[]): boolean {
  const n = path.length;
  return n >= 6 && key(path[0], path[1]) === key(path[n - 2], path[n - 1]);
}
