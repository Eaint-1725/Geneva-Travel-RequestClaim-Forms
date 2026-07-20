// Spatial helpers for matching a Document Intelligence selection mark to a nearby text label
// (e.g. a Hotel/Meals checkbox to its "Hotel"/"Meals" label). Pure math, independently testable
// with synthetic polygon coordinates -- unlike the extraction rules in azure-provider.ts, this
// doesn't need a real Azure sample to verify.

export interface PolygonElement {
  polygon?: number[];
}

interface Point {
  x: number;
  y: number;
}

function polygonCenter(polygon: number[]): Point {
  let sumX = 0;
  let sumY = 0;
  const pointCount = polygon.length / 2;
  for (let i = 0; i < polygon.length; i += 2) {
    sumX += polygon[i];
    sumY += polygon[i + 1];
  }
  return { x: sumX / pointCount, y: sumY / pointCount };
}

function polygonYRange(polygon: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < polygon.length; i += 2) {
    if (polygon[i] < min) min = polygon[i];
    if (polygon[i] > max) max = polygon[i];
  }
  return { min, max };
}

/**
 * Finds the closest of `candidates` to `mark`, restricted to candidates whose bounding box
 * shares a vertical range with the mark (i.e. sits on roughly the same line/row). This is a
 * proximity heuristic, not a guaranteed layout parser -- its accuracy depends on the row-overlap
 * assumption holding for the real form, which hasn't been verified against a real sample yet.
 */
export function nearestLabel<T extends PolygonElement>(
  mark: PolygonElement,
  candidates: T[],
): { candidate: T; distance: number } | null {
  if (!mark.polygon) return null;
  const markCenter = polygonCenter(mark.polygon);
  const markRow = polygonYRange(mark.polygon);

  let best: { candidate: T; distance: number } | null = null;
  for (const candidate of candidates) {
    if (!candidate.polygon) continue;
    const row = polygonYRange(candidate.polygon);
    const sameRow = row.min <= markRow.max && row.max >= markRow.min;
    if (!sameRow) continue;
    const center = polygonCenter(candidate.polygon);
    const distance = Math.hypot(center.x - markCenter.x, center.y - markCenter.y);
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  return best;
}
