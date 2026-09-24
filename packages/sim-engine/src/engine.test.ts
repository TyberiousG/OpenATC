import { describe, it, expect } from "vitest";
import { KHOU } from "@openatc/airport-data";
import { SimEngine } from "./engine.js";
import { generateTraffic, generateAircraft } from "./scenario.js";
import { mulberry32 } from "./rng.js";
import { projectToPlane } from "./geo.js";
import type { Aircraft } from "./aircraft.js";

describe("SimEngine", () => {
  it("resolves aircraft by callsign, ignoring case and spaces", () => {
    const eng = new SimEngine(KHOU);
    for (const ac of generateTraffic(KHOU, 1, 4)) eng.add(ac);
    const target = eng.list()[0]!;
    expect(eng.findByCallsign(target.callsign.toLowerCase())?.id).toBe(target.id);
    expect(eng.findByCallsign(` ${target.callsign} `)?.id).toBe(target.id);
  });

  it("rejects commands to unknown callsigns", () => {
    const eng = new SimEngine(KHOU);
    const res = eng.applyCommandToCallsign("XXX999", { kind: "altitude", altitude: 4000 });
    expect(res.ok).toBe(false);
  });

  it("applies a valid command to assignments", () => {
    const eng = new SimEngine(KHOU);
    const [ac] = generateTraffic(KHOU, 1, 1);
    eng.add(ac!);
    const res = eng.applyCommandToCallsign(ac!.callsign, { kind: "heading", heading: 270, direction: "left" });
    expect(res.ok).toBe(true);
    expect(ac!.assignedHeading).toBe(270);
    expect(ac!.turnDirection).toBe("left");
  });

  it("transfers ownership on a handoff", () => {
    const eng = new SimEngine(KHOU);
    const ac = generateAircraft(KHOU, mulberry32(1), "overflight", new Set());
    eng.add(ac);
    expect(ac.controller).toBe("APP");
    const res = eng.applyCommandToCallsign(ac.callsign, { kind: "contact", position: "TWR", frequency: "118.7" });
    expect(res.ok).toBe(true);
    expect(ac.controller).toBe("TWR");
  });

  it("rejects a handoff to an unknown position", () => {
    const eng = new SimEngine(KHOU);
    const ac = generateAircraft(KHOU, mulberry32(1), "overflight", new Set());
    eng.add(ac);
    const res = eng.applyCommandToCallsign(ac.callsign, { kind: "contact", position: "XYZ", frequency: null });
    expect(res.ok).toBe(false);
    expect(ac.controller).toBe("APP");
  });

  it("reaps an arrival established on its runway as landed", () => {
    const eng = new SimEngine(KHOU);
    const rwy = KHOU.runways.find((r) => r.id === "13R")!;
    const thr = projectToPlane(KHOU.reference, rwy.threshold);
    const [ac] = generateTraffic(KHOU, 1, 1);
    const arrival: Aircraft = {
      ...ac!,
      position: { ...thr },
      heading: rwy.heading,
      altitude: KHOU.elevation + 200,
      speed: 140,
      intent: { ...ac!.intent, kind: "arrival", destination: "KHOU", runway: "13R", navTarget: { x: 0, y: 0 } },
      status: "active",
    };
    eng.add(arrival);
    const done = eng.reap();
    expect(done).toHaveLength(1);
    expect(done[0]!.outcome).toBe("landed");
    expect(done[0]!.runway).toBe("13R");
    expect(eng.get(arrival.id)).toBeUndefined();
  });

  it("reaps traffic that leaves the airspace", () => {
    const eng = new SimEngine(KHOU);
    const [ac] = generateTraffic(KHOU, 2, 1);
    const leaving: Aircraft = {
      ...ac!,
      position: { x: KHOU.rangeNm + 20, y: 0 },
      intent: { ...ac!.intent, kind: "overflight" },
      status: "active",
    };
    eng.add(leaving);
    const done = eng.reap();
    expect(done).toHaveLength(1);
    expect(done[0]!.outcome).toBe("exited");
  });

  it("generateTraffic produces a mix of objectives", () => {
    const kinds = new Set(generateTraffic(KHOU, 5, 20).map((a) => a.intent.kind));
    expect(kinds.has("arrival")).toBe(true);
    expect(kinds.has("departure")).toBe(true);
    expect(kinds.has("overflight")).toBe(true);
  });

  it("generateAircraft yields unique callsigns against a used set", () => {
    const rng = mulberry32(11);
    const used = new Set<string>();
    const a = generateAircraft(KHOU, rng, "arrival", used);
    const b = generateAircraft(KHOU, rng, "departure", used);
    expect(a.callsign).not.toBe(b.callsign);
  });

  it("rejects an approach clearance for a runway that does not exist", () => {
    const eng = new SimEngine(KHOU);
    const [ac] = generateTraffic(KHOU, 1, 1);
    eng.add(ac!);
    const res = eng.applyCommandToCallsign(ac!.callsign, { kind: "approach", runway: "17", visual: false });
    expect(res.ok).toBe(false);
    expect(ac!.clearedApproach).toBeNull();
  });

  it("clears a visual approach to a runway with no published ILS (e.g. 22)", () => {
    const eng = new SimEngine(KHOU);
    const [ac] = generateTraffic(KHOU, 1, 1);
    eng.add(ac!);
    const rwy22 = KHOU.runways.find((r) => r.id === "22")!;
    const res = eng.applyCommandToCallsign(ac!.callsign, { kind: "approach", runway: "22", visual: false });
    expect(res.ok).toBe(true);
    expect(ac!.clearedApproach?.runwayId).toBe("22");
    // Final course synthesized from the runway heading.
    expect(ac!.clearedApproach?.finalCourse).toBe(rwy22.heading);
  });

  it("captures the localizer and flies the ILS down to a landing", () => {
    const eng = new SimEngine(KHOU);
    const rwy = KHOU.runways.find((r) => r.id === "13R")!;
    const thr = projectToPlane(KHOU.reference, rwy.threshold);
    const rad = (rwy.heading * Math.PI) / 180;
    // Position ~8 nm out on final, aligned and near the glideslope.
    const distNm = 8;
    const pos = { x: thr.x - Math.sin(rad) * distNm, y: thr.y - Math.cos(rad) * distNm };

    const [seed] = generateTraffic(KHOU, 3, 1);
    const arrival: Aircraft = {
      ...seed!,
      position: pos,
      heading: rwy.heading,
      altitude: 3000,
      speed: 180,
      assignedHeading: null,
      assignedAltitude: null,
      assignedSpeed: null,
      intent: { ...seed!.intent, kind: "arrival", destination: "KHOU", runway: "13R", navTarget: { x: 0, y: 0 } },
      status: "active",
      clearedApproach: null,
      phase: "airborne",
      taxiRoute: [],
    };
    eng.add(arrival);

    const cleared = eng.applyCommandToCallsign(arrival.callsign, { kind: "approach", runway: "13R", visual: false });
    expect(cleared.ok).toBe(true);

    let landed = false;
    for (let t = 0; t < 400 && !landed; t++) {
      eng.tick(1);
      const done = eng.reap();
      if (done.some((d) => d.outcome === "landed" && d.aircraft.id === arrival.id)) landed = true;
    }
    expect(arrival.clearedApproach?.localizerCaptured ?? false).toBe(true);
    expect(landed).toBe(true);
  });

  it("is deterministic: identical scenarios evolve identically", () => {
    const build = () => {
      const e = new SimEngine(KHOU);
      for (const ac of generateTraffic(KHOU, 42, 6)) e.add(ac);
      return e;
    };
    const a = build();
    const b = build();
    for (let i = 0; i < 300; i++) {
      a.tick(0.5);
      b.tick(0.5);
    }
    expect(a.list()).toEqual(b.list());
  });
});
