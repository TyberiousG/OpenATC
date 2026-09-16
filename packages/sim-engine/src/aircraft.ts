import type { Command } from "./commands.js";
import { normalizeHeading, headingDifference, bearingTo, distanceNm, type Vec2 } from "./geo.js";

/** What an aircraft is trying to accomplish in the airspace. */
export type FlightKind = "arrival" | "departure" | "overflight";

export interface FlightIntent {
  kind: FlightKind;
  origin: string;
  destination: string;
  /** Arrival's assigned landing runway id (e.g. "13R"), if any. */
  runway: string | null;
  /** Cruise/level altitude the flight naturally seeks (departures climb to it). */
  cruiseAltitude: number;
  /**
   * Point the aircraft steers toward on its own when the controller has not
   * assigned a heading. Field origin for arrivals, exit boundary for
   * overflights, null for departures (they fly runway heading until turned).
   */
  navTarget: Vec2 | null;
}

/** Lifecycle status. "active" flights are still being worked. */
export type FlightStatus = "active" | "landed" | "departed" | "exited";

/**
 * An active ILS approach clearance. Once the aircraft intercepts the localizer
 * it captures, then tracks the final approach course and glideslope down to the
 * runway on its own. Geometry is resolved (threshold on the plane, courses) when
 * the clearance is issued, so per-tick guidance needs no airport lookup.
 */
export interface ClearedApproach {
  runwayId: string;
  /** Final approach course, magnetic degrees. */
  finalCourse: number;
  glideslopeAngle: number;
  thresholdPos: Vec2;
  thresholdElevation: number;
  localizerCaptured: boolean;
}

/**
 * The authoritative aircraft domain model.
 *
 * `assigned*` fields are the controller's targets; the bare fields are the
 * current simulated state that eases toward those targets each tick. When an
 * assignment is null, the aircraft holds its current value.
 */
export interface Aircraft {
  id: string;
  callsign: string;
  /** Spoken form, e.g. "United 421". */
  spoken: string;
  aircraftType: string;
  position: Vec2;
  altitude: number;
  verticalRate: number;
  heading: number;
  speed: number;
  assignedHeading: number | null;
  assignedAltitude: number | null;
  assignedSpeed: number | null;
  /** Forced turn direction for the next heading capture, if commanded. */
  turnDirection: "left" | "right" | null;
  controller: string;
  /** Assigned transponder code (4 octal digits). */
  squawk: string;
  /** The flight's objective. */
  intent: FlightIntent;
  /** Lifecycle status; set to a terminal value when the objective completes. */
  status: FlightStatus;
  /** Active ILS approach clearance, or null. */
  clearedApproach: ClearedApproach | null;
}

/** Performance model. Coarse but believable; not real aerodynamics. */
export const DYNAMICS = {
  /** Standard rate turn, degrees per second. */
  turnRateDegPerSec: 3,
  /** Climb/descent rate, feet per minute. */
  verticalRateFpm: 1800,
  /** Airspeed change, knots per second. */
  accelKtPerSec: 1.5,
  /** Tolerances for considering a target "captured". */
  headingToleranceDeg: 0.5,
  altitudeToleranceFt: 20,
  speedToleranceKt: 1,
} as const;

const FT_PER_NM = 6076.12;

/** ILS approach capture and tracking parameters. */
export const APPROACH = {
  /** Max intercept angle to the final course to allow localizer capture (deg). */
  interceptAngleDeg: 45,
  /** Max lateral offset from the centerline to capture (nm). */
  captureCrossTrackNm: 1.5,
  /** Localizer is only capturable within this distance of the threshold (nm). */
  captureRangeNm: 16,
  /** Track correction applied per nm of cross-track error (deg/nm). */
  trackGainDegPerNm: 8,
  maxCorrectionDeg: 30,
  /** Speed the aircraft slows to once established (kt). */
  speedKt: 140,
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Apply a validated structured command, mutating assignments in place. */
export function applyCommand(ac: Aircraft, cmd: Command): void {
  switch (cmd.kind) {
    case "heading":
      ac.assignedHeading = normalizeHeading(cmd.heading);
      ac.turnDirection = cmd.direction;
      break;
    case "altitude":
      ac.assignedAltitude = cmd.altitude;
      break;
    case "speed":
      ac.assignedSpeed = cmd.speed;
      break;
    case "contact":
      // Handoff: ownership transfers to the new position. The aircraft leaves
      // the issuing controller's frequency (and dims on their scope).
      ac.controller = cmd.position;
      break;
    case "squawk":
      ac.squawk = cmd.code;
      break;
  }
}

/**
 * Advance a single aircraft by `dt` seconds. Pure with respect to `ac`.
 *
 * Semi-autonomous: a controller assignment always wins, but when a value is
 * unassigned the aircraft pursues its intent — arrivals/overflights steer
 * toward their nav target, departures climb toward cruise. Everything else
 * holds until told otherwise.
 */
export function stepAircraft(ac: Aircraft, dt: number): void {
  // An established approach overrides vectors and flies the aircraft down.
  const appr = ac.clearedApproach ? approachGuidance(ac) : null;

  const targetHeading = appr ? appr.heading : (ac.assignedHeading ?? autoHeading(ac));
  const forcedDir = appr ? null : ac.assignedHeading !== null ? ac.turnDirection : null;
  updateHeading(ac, targetHeading, forcedDir, dt);

  const targetAltitude = appr ? appr.altitude : (ac.assignedAltitude ?? autoAltitude(ac));
  updateAltitude(ac, targetAltitude, dt);

  const targetSpeed = appr ? appr.speed : ac.assignedSpeed;
  updateSpeed(ac, targetSpeed, dt);

  updatePosition(ac, dt);
}

/**
 * ILS approach guidance. Before capture it watches for the aircraft to
 * intercept the localizer (near the centerline, reasonable angle, within
 * range); after capture it returns the heading/altitude/speed that track the
 * final course and 3° glideslope down to the threshold. Returns null while the
 * clearance is issued but not yet captured (the controller's vector still flies).
 */
function approachGuidance(
  ac: Aircraft,
): { heading: number; altitude: number; speed: number } | null {
  const ap = ac.clearedApproach!;
  const relx = ac.position.x - ap.thresholdPos.x;
  const rely = ac.position.y - ap.thresholdPos.y;
  const rad = (ap.finalCourse * Math.PI) / 180;
  const cx = Math.sin(rad);
  const cy = Math.cos(rad);
  const along = relx * cx + rely * cy; // > 0 means past the threshold
  const distToThreshold = -along;
  const crossTrack = relx * cy - rely * cx; // signed lateral offset from centerline

  if (!ap.localizerCaptured) {
    const angleOk = Math.abs(headingDifference(ac.heading, ap.finalCourse)) <= APPROACH.interceptAngleDeg;
    const laterallyClose = Math.abs(crossTrack) <= APPROACH.captureCrossTrackNm;
    const inRange = distToThreshold > 0.3 && distToThreshold <= APPROACH.captureRangeNm;
    if (!(angleOk && laterallyClose && inRange)) return null;
    // Capture: drop any pending vector; the aircraft now flies the approach.
    ap.localizerCaptured = true;
    ac.assignedHeading = null;
    ac.assignedAltitude = null;
    ac.turnDirection = null;
  }

  const correction = clamp(
    -crossTrack * APPROACH.trackGainDegPerNm,
    -APPROACH.maxCorrectionDeg,
    APPROACH.maxCorrectionDeg,
  );
  const heading = normalizeHeading(ap.finalCourse + correction);
  // Glideslope altitude at this distance; capture from level/below, then follow down.
  const gsAlt = ap.thresholdElevation + Math.tan((ap.glideslopeAngle * Math.PI) / 180) * Math.max(distToThreshold, 0) * FT_PER_NM;
  const altitude = Math.min(ac.altitude, gsAlt);
  const speed = Math.min(ac.assignedSpeed ?? ac.speed, APPROACH.speedKt);
  return { heading, altitude, speed };
}

/** Heading the aircraft flies on its own when not being vectored. */
function autoHeading(ac: Aircraft): number | null {
  const t = ac.intent.navTarget;
  if (!t) return null;
  // Once essentially overhead the target, hold heading rather than orbit it.
  if (distanceNm(ac.position, t) < 3) return null;
  return bearingTo(ac.position, t);
}

/** Altitude the aircraft seeks on its own: departures climb, others hold. */
function autoAltitude(ac: Aircraft): number | null {
  return ac.intent.kind === "departure" ? ac.intent.cruiseAltitude : null;
}

function updateHeading(ac: Aircraft, target: number | null, forcedDir: "left" | "right" | null, dt: number): void {
  if (target === null) return;
  const diff = headingDifference(ac.heading, target);
  if (Math.abs(diff) <= DYNAMICS.headingToleranceDeg) {
    ac.heading = normalizeHeading(target);
    ac.turnDirection = null;
    return;
  }
  // Direction: honor a commanded turn even when it is the long way around.
  let sign: number;
  if (forcedDir === "left") sign = -1;
  else if (forcedDir === "right") sign = 1;
  else sign = Math.sign(diff);

  const maxStep = DYNAMICS.turnRateDegPerSec * dt;
  // Remaining angle in the chosen direction (0, 360].
  let remaining = sign > 0 ? diff : -diff;
  if (remaining < 0) remaining += 360;
  const step = Math.min(maxStep, remaining);
  ac.heading = normalizeHeading(ac.heading + sign * step);

  if (Math.abs(headingDifference(ac.heading, target)) <= DYNAMICS.headingToleranceDeg) {
    ac.heading = normalizeHeading(target);
    ac.turnDirection = null;
  }
}

function updateAltitude(ac: Aircraft, target: number | null, dt: number): void {
  if (target === null) {
    ac.verticalRate = 0;
    return;
  }
  const diff = target - ac.altitude;
  if (Math.abs(diff) <= DYNAMICS.altitudeToleranceFt) {
    ac.altitude = target;
    ac.verticalRate = 0;
    return;
  }
  const maxChange = (DYNAMICS.verticalRateFpm / 60) * dt; // ft this tick
  const change = Math.min(Math.abs(diff), maxChange) * Math.sign(diff);
  ac.altitude += change;
  ac.verticalRate = Math.sign(diff) * DYNAMICS.verticalRateFpm;
}

function updateSpeed(ac: Aircraft, target: number | null, dt: number): void {
  if (target === null) return;
  const diff = target - ac.speed;
  if (Math.abs(diff) <= DYNAMICS.speedToleranceKt) {
    ac.speed = target;
    return;
  }
  const maxChange = DYNAMICS.accelKtPerSec * dt;
  ac.speed += Math.min(Math.abs(diff), maxChange) * Math.sign(diff);
}

function updatePosition(ac: Aircraft, dt: number): void {
  const distNm = (ac.speed * dt) / 3600;
  const rad = (ac.heading * Math.PI) / 180;
  // Heading 0 = north (+y), 90 = east (+x).
  ac.position.x += distNm * Math.sin(rad);
  ac.position.y += distNm * Math.cos(rad);
}
