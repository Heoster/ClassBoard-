import type { Point } from "../../types/annotation";
export type PageSize = { width: number; height: number };
export function normalizePoint(point: Point, page: PageSize): Point { return { x: point.x / page.width, y: point.y / page.height }; }
export function denormalizePoint(point: Point, page: PageSize): Point { return { x: point.x * page.width, y: point.y * page.height }; }

/**
 * Compute the axis-aligned bounding box of a set of points.
 *
 * IMPORTANT: do NOT use Math.min(...xs) / Math.max(...xs) with the spread
 * operator here.  For ink strokes with thousands of points the spread blows
 * the V8 call-stack (Maximum call stack size exceeded).  A plain loop is
 * O(n) with no stack pressure and is faster on large arrays anyway.
 */
export function bounds(points: Point[]): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const { x, y } = points[i];
    if (x < minX) minX = x; else if (x > maxX) maxX = x;
    if (y < minY) minY = y; else if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rotatePoint(point: Point, degrees: 0 | 90 | 180 | 270): Point { if (degrees === 90) return { x: 1 - point.y, y: point.x }; if (degrees === 180) return { x: 1 - point.x, y: 1 - point.y }; if (degrees === 270) return { x: point.y, y: 1 - point.x }; return point; }
