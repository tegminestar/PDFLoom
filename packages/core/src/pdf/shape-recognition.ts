import type { Point, Rect } from "./annotations";

/**
 * Pure geometry, no PDF I/O — deliberately NOT routed through the pdf-worker
 * (unlike every other pdf/* module) since it's cheap synchronous math over a
 * few dozen/hundred points, not a pdf-lib document mutation; adding a
 * Comlink round-trip here would only add latency to something that needs to
 * feel instant right after a pointer-up.
 */

export type RecognizedShape =
  | { type: "rectangle"; rect: Rect }
  | { type: "circle"; rect: Rect }
  | { type: "line"; start: Point; end: Point }
  | { type: "none" };

// All thresholds below are ratios against the stroke's own bounding-box
// diagonal (or half its shorter side, for the edge-hugging test), so
// recognition works the same at any zoom level or shape size — a tiny
// doodle and a page-spanning one get judged by the same standard.
const MIN_POINTS = 6; // fewer samples is a dot/tap, not a shape attempt
const MIN_DIAGONAL = 4; // PDF units — below this, min/max ratios blow up on noise
const LINE_MAX_RESIDUAL_RATIO = 0.06;
const CLOSED_PATH_MAX_GAP_RATIO = 0.18;
// Coefficient of variation of distance-from-centroid. This has to be loose
// enough to accept a genuinely elongated oval (a perfect 2:1-aspect ellipse
// has real, geometric radius variation around 0.2-0.25 even hand-traced
// perfectly — that's not noise, an ellipse's near/far points are just at
// different distances from center by construction) while still rejecting
// irregular shapes like a traced triangle, which the rectangle test above
// won't catch (a triangle isn't edge-hugging a 4-sided box either) and
// which has noticeably higher variation than any real ellipse.
const CIRCLE_MAX_RADIUS_VARIATION = 0.3;
const RECT_MAX_EDGE_DISTANCE_RATIO = 0.14; // average distance from each point to its nearest bounding-box edge
const CORNER_ANGLE_THRESHOLD_DEG = 50; // a direction change sharper than this counts as a corner
const CIRCLE_MAX_CORNERS = 1; // an ellipse has none; tolerate one for a single noisy jitter

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundingBox(points: Point[]): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number; diagonal: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  return { minX, maxX, minY, maxY, width, height, diagonal: Math.hypot(width, height) };
}

/** RMS perpendicular distance of every point from the straight line through the stroke's own start and end points. */
function lineResidual(points: Point[], start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Number.POSITIVE_INFINITY;
  const nx = -dy / len;
  const ny = dx / len;
  const squared = points.reduce((sum, p) => {
    const d = (p.x - start.x) * nx + (p.y - start.y) * ny;
    return sum + d * d;
  }, 0);
  return Math.sqrt(squared / points.length);
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}

/**
 * Counts sharp direction changes along the path — a smooth curve (a
 * genuine ellipse/circle) has none, while a polygon (a traced triangle,
 * say) has one per vertex. This exists because distance-from-centroid
 * variance alone can't tell an elongated-but-smooth ellipse apart from a
 * sharp-cornered polygon of similar aspect — both can land in the same
 * variance range, since that measure only sees "far vs. near," not
 * "smooth vs. abrupt." Uses a window (not adjacent points) so single-
 * sample pointer-move jitter doesn't register as a corner.
 */
function countSharpCorners(points: Point[]): number {
  const step = Math.max(1, Math.floor(points.length / 20));
  const thresholdRad = (CORNER_ANGLE_THRESHOLD_DEG * Math.PI) / 180;
  let corners = 0;
  let lastCornerIndex = -Infinity;
  for (let i = step; i < points.length - step; i++) {
    const a = points[i - step]!;
    const b = points[i]!;
    const c = points[i + step]!;
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    if (len1 === 0 || len2 === 0) continue;
    const cosAngle = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (len1 * len2)));
    const angle = Math.acos(cosAngle);
    if (angle > thresholdRad && i - lastCornerIndex > step) {
      corners++;
      lastCornerIndex = i;
    }
  }
  return corners;
}

/**
 * Classifies a freehand stroke as a rectangle, circle/ellipse, straight
 * line, or "none" (keep it as freehand ink) — heuristic, not ML-based.
 * Order matters: a line test runs first since it's meaningful for both
 * open and (degenerate) closed paths, then closed-path shapes are tested
 * only once a stroke clearly isn't a line.
 */
export function recognizeShape(points: Point[]): RecognizedShape {
  if (points.length < MIN_POINTS) return { type: "none" };

  const box = boundingBox(points);
  if (box.diagonal < MIN_DIAGONAL) return { type: "none" };

  const start = points[0]!;
  const end = points[points.length - 1]!;
  const closureGap = distance(start, end);
  const isClosed = closureGap / box.diagonal < CLOSED_PATH_MAX_GAP_RATIO;

  if (!isClosed) {
    const residual = lineResidual(points, start, end);
    if (residual / box.diagonal < LINE_MAX_RESIDUAL_RATIO) {
      return { type: "line", start, end };
    }
    return { type: "none" };
  }

  const rect: Rect = { x: box.minX, y: box.minY, width: box.width, height: box.height };

  // Rectangle is checked before circle deliberately: it's the more specific
  // test (points must hug the bounding box's actual edges, not just stay
  // roughly equidistant from the centroid), and a traced square can pass a
  // loose circularity check too (its corner-to-edge-midpoint radius swing
  // is gentle enough to look "roughly round" by that measure alone) — so
  // checking circularity first would misclassify sharp-cornered squares.
  //
  // Uses a high percentile of edge-distances, not the mean: a circle
  // inscribed in its own bounding box briefly touches all four edges at
  // its tangent points, which drags the *average* distance down close to a
  // real rectangle's — even though most of the circle's curve sits well
  // inside those edges. A rectangle keeps nearly every point close to an
  // edge; a circle only does that for a small fraction of its points.
  const halfShortSide = Math.min(box.width, box.height) / 2;
  if (halfShortSide > 0) {
    const edgeDistances = points
      .map((p) => Math.min(p.x - box.minX, box.maxX - p.x, p.y - box.minY, box.maxY - p.y))
      .sort((a, b) => a - b);
    const p80 = edgeDistances[Math.floor(edgeDistances.length * 0.8)]!;
    if (p80 / halfShortSide < RECT_MAX_EDGE_DISTANCE_RATIO) {
      return { type: "rectangle", rect };
    }
  }

  const center = centroid(points);
  const radii = points.map((p) => distance(p, center));
  const meanRadius = mean(radii);
  const circularity = meanRadius > 0 ? stddev(radii, meanRadius) / meanRadius : Number.POSITIVE_INFINITY;
  if (circularity < CIRCLE_MAX_RADIUS_VARIATION && countSharpCorners(points) <= CIRCLE_MAX_CORNERS) {
    return { type: "circle", rect };
  }

  return { type: "none" };
}
