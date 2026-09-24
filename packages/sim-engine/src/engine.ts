import type { AirportPackage } from "@openatc/airport-data";
import type { Command } from "./commands.js";
import { validateCommand } from "./commands.js";
import { applyCommand, stepAircraft, type Aircraft } from "./aircraft.js";
import { planeToLatLon, projectToPlane, distanceNm, headingDifference, bearingTo, type Vec2 } from "./geo.js";
import { detectConflicts, type Conflict } from "./separation.js";
import { buildTaxiNetwork, planTaxiRoute, type TaxiNetwork } from "./taxiNetwork.js";

export type FlightOutcome = "landed" | "departed" | "exited";

export interface CompletedFlight {
  aircraft: Aircraft;
  outcome: FlightOutcome;
  /** Runway an arrival landed on, when applicable. */
  runway?: string;
}

/** Completion thresholds. Coarse but believable. */
const COMPLETION = {
  /** Landing gate: distance to threshold (nm), alignment (deg), height AGL (ft), speed (kt). */
  landingDistanceNm: 2.0,
  landingAlignDeg: 25,
  landingHeightFt: 800,
  landingSpeedKt: 170,
  /** How far beyond scope range (nm) counts as leaving the airspace. */
  exitBufferNm: 5,
} as const;

export interface CommandResult {
  ok: boolean;
  aircraft?: Aircraft;
  error?: string;
}

/**
 * The authoritative simulation. It owns all aircraft state and is the only
 * component permitted to mutate it. Advancing time is fully deterministic:
 * `tick(dt)` from a given state always yields the same next state.
 */
export class SimEngine {
  time = 0;
  private readonly byId = new Map<string, Aircraft>();

  private readonly taxiNet: TaxiNetwork | null;

  constructor(public readonly airport: AirportPackage) {
    this.taxiNet = airport.ground ? buildTaxiNetwork(airport.ground) : null;
  }

  add(ac: Aircraft): void {
    this.byId.set(ac.id, ac);
  }

  /** Remove all aircraft and reset the clock (used by an admin reset). */
  clear(): void {
    this.byId.clear();
    this.time = 0;
  }

  list(): Aircraft[] {
    return [...this.byId.values()];
  }

  get(id: string): Aircraft | undefined {
    return this.byId.get(id);
  }

  /** Advance the whole simulation by `dt` seconds. */
  tick(dt: number): void {
    this.time += dt;
    for (const ac of this.byId.values()) {
      stepAircraft(ac, dt);
    }
  }

  /**
   * Resolve an aircraft by its ATC callsign code (e.g. "UAL421"). Matching is
   * case-insensitive and ignores whitespace.
   */
  findByCallsign(callsign: string): Aircraft | undefined {
    const target = normalize(callsign);
    for (const ac of this.byId.values()) {
      if (normalize(ac.callsign) === target) return ac;
    }
    return undefined;
  }

  /** Validate and apply a command addressed to a callsign. */
  applyCommandToCallsign(callsign: string, cmd: Command): CommandResult {
    const ac = this.findByCallsign(callsign);
    if (!ac) return { ok: false, error: `no aircraft with callsign ${callsign}` };
    const invalid = validateCommand(cmd);
    if (invalid) return { ok: false, error: invalid.message, aircraft: ac };
    if (cmd.kind === "approach") return this.clearForApproach(ac, cmd.runway, cmd.visual);
    if (cmd.kind === "taxi") return this.taxiToRunway(ac, cmd.runway, cmd.via);
    if (cmd.kind === "takeoff") return this.clearForTakeoff(ac, cmd.runway);
    applyCommand(ac, cmd);
    return { ok: true, aircraft: ac };
  }

  /**
   * The departure end of a runway, in tangent-plane nm. Prefers the accurate
   * ground-diagram geometry (what the surface map draws) so aircraft taxi to
   * the point they visibly should; falls back to the approximate runway list.
   * The heading is the takeoff-roll direction from that end.
   */
  private departureEnd(rwyId: string): { pos: Vec2; heading: number } | null {
    const g = this.airport.ground;
    if (g) {
      for (const r of g.runways) {
        const idx = r.ends.indexOf(rwyId);
        if (idx >= 0) {
          const pos = r.centerline[idx]!;
          const other = r.centerline[1 - idx]!;
          return { pos: { x: pos.x, y: pos.y }, heading: bearingTo(pos, other) };
        }
      }
    }
    const rwy = this.airport.runways.find((r) => r.id === rwyId);
    if (rwy) return { pos: projectToPlane(this.airport.reference, rwy.threshold), heading: rwy.heading };
    return null;
  }

  /** Route a ground aircraft to the departure end of a runway, via any taxiways given. */
  private taxiToRunway(ac: Aircraft, runway: string | null, via: string[]): CommandResult {
    if (ac.phase === "airborne") return { ok: false, error: "aircraft is airborne", aircraft: ac };
    const rwyId = (runway ?? ac.intent.runway)?.toUpperCase() ?? null;
    const end = rwyId ? this.departureEnd(rwyId) : null;
    if (!rwyId || !end) return { ok: false, error: `unknown runway ${rwyId ?? "(none)"}`, aircraft: ac };
    ac.intent.runway = rwyId;
    ac.taxiRoute = this.taxiNet ? planTaxiRoute(this.taxiNet, ac.position, end.pos, via) : [end.pos];
    ac.phase = "taxi";
    return { ok: true, aircraft: ac };
  }

  /** Clear a ground aircraft for takeoff: it lines up and rolls down the runway. */
  private clearForTakeoff(ac: Aircraft, runway: string | null): CommandResult {
    if (ac.phase === "airborne") return { ok: false, error: "aircraft is airborne", aircraft: ac };
    const rwyId = (runway ?? ac.intent.runway)?.toUpperCase() ?? null;
    const end = rwyId ? this.departureEnd(rwyId) : null;
    if (!rwyId || !end) return { ok: false, error: `unknown runway ${rwyId ?? "(none)"}`, aircraft: ac };
    ac.phase = "takeoff";
    ac.taxiRoute = [];
    ac.position = { x: end.pos.x, y: end.pos.y };
    ac.heading = end.heading;
    ac.altitude = this.airport.elevation;
    ac.intent.runway = rwyId;
    return { ok: true, aircraft: ac };
  }

  /**
   * Attach an approach clearance for a runway. Uses the published ILS when one
   * exists (and a visual wasn't requested); otherwise clears a *visual*
   * approach synthesized from the runway geometry (final course = runway
   * heading, 3° path), so any runway that exists can be cleared.
   */
  private clearForApproach(ac: Aircraft, runway: string | null, visual: boolean): CommandResult {
    const rwyId = (runway ?? ac.intent.runway)?.toUpperCase() ?? null;
    if (!rwyId) return { ok: false, error: "no runway specified or assigned", aircraft: ac };
    const rwy = this.airport.runways.find((r) => r.id === rwyId);
    if (!rwy) return { ok: false, error: `unknown runway ${rwyId}`, aircraft: ac };

    const published = visual ? undefined : this.airport.approaches.find((a) => a.runwayId === rwyId);
    ac.clearedApproach = {
      runwayId: rwy.id,
      finalCourse: published?.finalCourse ?? rwy.heading,
      glideslopeAngle: published?.glideslopeAngle ?? 3.0,
      thresholdPos: projectToPlane(this.airport.reference, rwy.threshold),
      thresholdElevation: this.airport.elevation,
      localizerCaptured: false,
    };
    ac.intent.runway = rwy.id;
    return { ok: true, aircraft: ac };
  }

  /** Current separation conflicts among active aircraft. */
  conflicts(): Conflict[] {
    return detectConflicts(this.list());
  }

  /** Geographic position of an aircraft, derived from its plane position. */
  latLonOf(ac: Aircraft): { lat: number; lon: number } {
    return planeToLatLon(this.airport.reference, ac.position);
  }

  remove(id: string): void {
    this.byId.delete(id);
  }

  /**
   * Detect aircraft that have completed their objective — arrivals established
   * on a runway (landed), and any flight that has left the airspace. Marks
   * their status, removes them, and returns the completion events. Call once
   * per tick after {@link tick}.
   */
  reap(): CompletedFlight[] {
    const done: CompletedFlight[] = [];
    for (const ac of this.byId.values()) {
      if (ac.status !== "active") continue;

      const landing = ac.intent.kind === "arrival" ? this.landedRunway(ac) : null;
      if (landing) {
        ac.status = "landed";
        done.push({ aircraft: ac, outcome: "landed", runway: landing });
        continue;
      }

      const range = Math.hypot(ac.position.x, ac.position.y);
      if (range > this.airport.rangeNm + COMPLETION.exitBufferNm) {
        const outcome: FlightOutcome = ac.intent.kind === "departure" ? "departed" : "exited";
        ac.status = outcome;
        done.push({ aircraft: ac, outcome });
      }
    }
    for (const d of done) this.byId.delete(d.aircraft.id);
    return done;
  }

  /** Runway an arrival is established on and low/slow enough to land, or null. */
  private landedRunway(ac: Aircraft): string | null {
    for (const rwy of this.airport.runways) {
      if (ac.intent.runway && rwy.id !== ac.intent.runway) continue;
      const thr = projectToPlane(this.airport.reference, rwy.threshold);
      const aligned = Math.abs(headingDifference(ac.heading, rwy.heading)) <= COMPLETION.landingAlignDeg;
      const near = distanceNm(ac.position, thr) <= COMPLETION.landingDistanceNm;
      const low = ac.altitude <= this.airport.elevation + COMPLETION.landingHeightFt;
      const slow = ac.speed <= COMPLETION.landingSpeedKt;
      if (aligned && near && low && slow) return rwy.id;
    }
    return null;
  }
}

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}
