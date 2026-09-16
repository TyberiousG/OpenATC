import type { AirportPackage } from "@openatc/airport-data";
import type { Command } from "./commands.js";
import { validateCommand } from "./commands.js";
import { applyCommand, stepAircraft, type Aircraft } from "./aircraft.js";
import { planeToLatLon, projectToPlane, distanceNm, headingDifference } from "./geo.js";

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

  constructor(public readonly airport: AirportPackage) {}

  add(ac: Aircraft): void {
    this.byId.set(ac.id, ac);
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
    if (cmd.kind === "approach") return this.clearForApproach(ac, cmd.runway);
    applyCommand(ac, cmd);
    return { ok: true, aircraft: ac };
  }

  /** Resolve and attach an ILS approach clearance for a runway. */
  private clearForApproach(ac: Aircraft, runway: string | null): CommandResult {
    const rwyId = (runway ?? ac.intent.runway)?.toUpperCase() ?? null;
    if (!rwyId) return { ok: false, error: "no runway specified or assigned", aircraft: ac };
    const appr = this.airport.approaches.find((a) => a.runwayId === rwyId);
    if (!appr) return { ok: false, error: `no published approach for runway ${rwyId}`, aircraft: ac };
    const rwy = this.airport.runways.find((r) => r.id === appr.runwayId);
    if (!rwy) return { ok: false, error: `unknown runway ${appr.runwayId}`, aircraft: ac };

    ac.clearedApproach = {
      runwayId: rwy.id,
      finalCourse: appr.finalCourse,
      glideslopeAngle: appr.glideslopeAngle,
      thresholdPos: projectToPlane(this.airport.reference, rwy.threshold),
      thresholdElevation: this.airport.elevation,
      localizerCaptured: false,
    };
    // Land on the cleared runway.
    ac.intent.runway = rwy.id;
    return { ok: true, aircraft: ac };
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
