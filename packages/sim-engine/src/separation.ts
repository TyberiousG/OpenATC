import type { Aircraft } from "./aircraft.js";
import { distanceNm } from "./geo.js";

export type AlertLevel = "none" | "warning" | "violation";

export interface Conflict {
  a: string;
  b: string;
  /** Current lateral separation, nm. */
  lateralNm: number;
  /** Current vertical separation, ft. */
  verticalFt: number;
  severity: "warning" | "violation";
}

/**
 * Separation standards and conflict-probe parameters. Approach control keeps
 * 3 nm laterally OR 1000 ft vertically; losing both is a violation. A warning
 * is a *predicted* loss within the look-ahead window, giving the controller
 * time to act.
 */
export const SEPARATION = {
  lateralMinNm: 3,
  verticalMinFt: 1000,
  lookaheadSec: 120,
  sampleSec: 15,
} as const;

interface Predicted {
  x: number;
  y: number;
  alt: number;
}

/** Linear dead-reckoning of an aircraft `t` seconds ahead. */
function predict(ac: Aircraft, t: number): Predicted {
  const rad = (ac.heading * Math.PI) / 180;
  const distNm = (ac.speed * t) / 3600;
  return {
    x: ac.position.x + Math.sin(rad) * distNm,
    y: ac.position.y + Math.cos(rad) * distNm,
    alt: ac.altitude + (ac.verticalRate * t) / 60,
  };
}

/** True for two aircraft legitimately sequenced in trail on the same final. */
function inTrailOnApproach(a: Aircraft, b: Aircraft): boolean {
  return (
    !!a.clearedApproach?.localizerCaptured &&
    !!b.clearedApproach?.localizerCaptured &&
    a.clearedApproach.runwayId === b.clearedApproach.runwayId
  );
}

function pairConflict(a: Aircraft, b: Aircraft): Conflict | null {
  // Ground traffic is separated by taxi/tower procedures, not radar minima.
  if (a.phase !== "airborne" || b.phase !== "airborne") return null;
  if (inTrailOnApproach(a, b)) return null;

  const lateralNm = distanceNm(a.position, b.position);
  const verticalFt = Math.abs(a.altitude - b.altitude);

  // Current loss of separation.
  if (lateralNm < SEPARATION.lateralMinNm && verticalFt < SEPARATION.verticalMinFt) {
    return { a: a.id, b: b.id, lateralNm, verticalFt, severity: "violation" };
  }

  // Predicted loss within the look-ahead window.
  for (let t = SEPARATION.sampleSec; t <= SEPARATION.lookaheadSec; t += SEPARATION.sampleSec) {
    const pa = predict(a, t);
    const pb = predict(b, t);
    const lat = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    const vert = Math.abs(pa.alt - pb.alt);
    if (lat < SEPARATION.lateralMinNm && vert < SEPARATION.verticalMinFt) {
      return { a: a.id, b: b.id, lateralNm, verticalFt, severity: "warning" };
    }
  }
  return null;
}

/** All conflicting pairs among the given aircraft. O(n²); n is small. */
export function detectConflicts(fleet: Aircraft[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < fleet.length; i++) {
    for (let j = i + 1; j < fleet.length; j++) {
      const c = pairConflict(fleet[i]!, fleet[j]!);
      if (c) out.push(c);
    }
  }
  return out;
}

const RANK: Record<AlertLevel, number> = { none: 0, warning: 1, violation: 2 };

/** Highest alert level each aircraft is involved in. */
export function alertLevels(conflicts: Conflict[]): Map<string, AlertLevel> {
  const m = new Map<string, AlertLevel>();
  const bump = (id: string, sev: AlertLevel) => {
    if (RANK[sev] > RANK[m.get(id) ?? "none"]) m.set(id, sev);
  };
  for (const c of conflicts) {
    bump(c.a, c.severity);
    bump(c.b, c.severity);
  }
  return m;
}

/** Stable key for a pair, order-independent. */
export function conflictKey(c: Conflict): string {
  return [c.a, c.b].sort().join("|");
}
