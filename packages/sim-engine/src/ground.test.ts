import { describe, it, expect } from "vitest";
import { KHOU } from "@openatc/airport-data";
import { SimEngine } from "./engine.js";
import { generateAircraft } from "./scenario.js";
import { mulberry32 } from "./rng.js";
import type { Aircraft } from "./aircraft.js";

function departure(): Aircraft {
  // pickFlightKind not used; force a departure directly.
  return generateAircraft(KHOU, mulberry32(1), "departure", new Set());
}

describe("ground traffic", () => {
  it("spawns departures parked at the ramp, on the ground", () => {
    const ac = departure();
    expect(ac.phase).toBe("ramp");
    expect(ac.speed).toBe(0);
    expect(ac.altitude).toBe(KHOU.elevation);
    expect(ac.controller).toBe("GND");
    expect(ac.intent.kind).toBe("departure");
  });

  it("taxis to a runway and holds short", () => {
    const eng = new SimEngine(KHOU);
    const ac = departure();
    eng.add(ac);
    const res = eng.applyCommandToCallsign(ac.callsign, { kind: "taxi", runway: "13R", via: [] });
    expect(res.ok).toBe(true);
    expect(ac.phase).toBe("taxi");
    expect(ac.taxiRoute.length).toBeGreaterThan(0);

    // Taxi long enough to reach the hold point.
    for (let t = 0; t < 600 && ac.phase === "taxi"; t++) eng.tick(1);
    expect(ac.phase).toBe("hold");
    expect(ac.speed).toBe(0);
  });

  it("cleared for takeoff rolls down the runway, then lifts off and climbs", () => {
    const eng = new SimEngine(KHOU);
    const ac = departure();
    eng.add(ac);
    eng.applyCommandToCallsign(ac.callsign, { kind: "takeoff", runway: "13R" });
    expect(ac.phase).toBe("takeoff"); // rolling on the ground, still visible

    // Roll accelerates and stays on the ground until rotation speed.
    eng.tick(2);
    expect(ac.speed).toBeGreaterThan(0);
    expect(ac.phase).toBe("takeoff");

    for (let t = 0; t < 40 && ac.phase !== "airborne"; t++) eng.tick(1);
    expect(ac.phase).toBe("airborne");

    const alt0 = ac.altitude;
    for (let t = 0; t < 30; t++) eng.tick(1);
    expect(ac.altitude).toBeGreaterThan(alt0); // climbing out
  });

  it("rejects taxi for an airborne aircraft", () => {
    const eng = new SimEngine(KHOU);
    const ac = generateAircraft(KHOU, mulberry32(2), "arrival", new Set());
    eng.add(ac);
    const res = eng.applyCommandToCallsign(ac.callsign, { kind: "taxi", runway: "13R", via: [] });
    expect(res.ok).toBe(false);
  });
});
