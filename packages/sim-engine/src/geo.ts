/**
 * Geographic helpers.
 *
 * The simulation runs on a flat local tangent plane centered on an airport
 * reference point. Distances are in nautical miles; +x is east, +y is north.
 * This equirectangular approximation is accurate to well within scope range
 * (tens of nm) and keeps movement math cheap and deterministic. It is not a
 * geodesic model and is not intended for real navigation.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

const NM_PER_DEG_LAT = 60;
const DEG2RAD = Math.PI / 180;

/** Project a geographic point onto the local tangent plane at `ref`. */
export function projectToPlane(ref: LatLon, point: LatLon): Vec2 {
  const lonScale = NM_PER_DEG_LAT * Math.cos(ref.lat * DEG2RAD);
  return {
    x: (point.lon - ref.lon) * lonScale,
    y: (point.lat - ref.lat) * NM_PER_DEG_LAT,
  };
}

/** Inverse of {@link projectToPlane}. */
export function planeToLatLon(ref: LatLon, p: Vec2): LatLon {
  const lonScale = NM_PER_DEG_LAT * Math.cos(ref.lat * DEG2RAD);
  return {
    lat: ref.lat + p.y / NM_PER_DEG_LAT,
    lon: ref.lon + p.x / lonScale,
  };
}

/** Normalize a heading into [0, 360). */
export function normalizeHeading(h: number): number {
  return ((h % 360) + 360) % 360;
}

/**
 * Signed smallest angular difference from `from` to `to`, in (-180, 180].
 * Positive means a right (clockwise) turn is shortest.
 */
export function headingDifference(from: number, to: number): number {
  let d = normalizeHeading(to) - normalizeHeading(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Distance in nautical miles between two tangent-plane points. */
export function distanceNm(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Compass bearing (degrees) from point `a` to point `b`. 0 = north, 90 = east. */
export function bearingTo(a: Vec2, b: Vec2): number {
  return normalizeHeading((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI);
}
