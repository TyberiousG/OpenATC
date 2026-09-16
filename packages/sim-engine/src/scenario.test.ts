import { describe, it, expect } from "vitest";
import { KHOU } from "@openatc/airport-data";
import { generateTraffic } from "./scenario.js";

describe("generateTraffic", () => {
  it("is reproducible for a given seed", () => {
    expect(generateTraffic(KHOU, 7, 5)).toEqual(generateTraffic(KHOU, 7, 5));
  });

  it("differs across seeds", () => {
    const a = generateTraffic(KHOU, 1, 5).map((x) => x.callsign);
    const b = generateTraffic(KHOU, 2, 5).map((x) => x.callsign);
    expect(a).not.toEqual(b);
  });

  it("produces unique callsigns within a scenario", () => {
    const cs = generateTraffic(KHOU, 3, 12).map((x) => x.callsign);
    expect(new Set(cs).size).toBe(cs.length);
  });

  it("spawns aircraft within scope range", () => {
    for (const ac of generateTraffic(KHOU, 9, 10)) {
      const range = Math.hypot(ac.position.x, ac.position.y);
      expect(range).toBeLessThanOrEqual(KHOU.rangeNm);
    }
  });
});
