import { describe, it, expect } from "vitest";
import { detectConflicts, alertLevels, type Conflict } from "./separation.js";
import type { Aircraft } from "./aircraft.js";

function makeAc(id: string, overrides: Partial<Aircraft> = {}): Aircraft {
  return {
    id,
    callsign: id,
    spoken: id,
    aircraftType: "B737",
    position: { x: 0, y: 0 },
    altitude: 5000,
    verticalRate: 0,
    heading: 0,
    speed: 250,
    assignedHeading: null,
    assignedAltitude: null,
    assignedSpeed: null,
    turnDirection: null,
    controller: "APP",
    squawk: "1234",
    intent: { kind: "overflight", origin: "A", destination: "B", runway: null, cruiseAltitude: 5000, navTarget: null },
    status: "active",
    clearedApproach: null,
    phase: "airborne",
    taxiRoute: [],
    ...overrides,
  };
}

describe("detectConflicts", () => {
  it("flags a current loss of separation as a violation", () => {
    const a = makeAc("A", { position: { x: 0, y: 0 } });
    const b = makeAc("B", { position: { x: 1, y: 0 } });
    const c = detectConflicts([a, b]);
    expect(c).toHaveLength(1);
    expect(c[0]!.severity).toBe("violation");
  });

  it("flags converging traffic as a predicted warning", () => {
    const a = makeAc("A", { position: { x: 0, y: 0 }, heading: 90, speed: 300 });
    const b = makeAc("B", { position: { x: 10, y: 0 }, heading: 270, speed: 300 });
    const c = detectConflicts([a, b]);
    expect(c).toHaveLength(1);
    expect(c[0]!.severity).toBe("warning");
  });

  it("does not flag vertically separated traffic", () => {
    const a = makeAc("A", { position: { x: 0, y: 0 }, altitude: 5000 });
    const b = makeAc("B", { position: { x: 1, y: 0 }, altitude: 7000 });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it("does not flag diverging, laterally separated traffic", () => {
    const a = makeAc("A", { position: { x: 0, y: 0 }, heading: 270, speed: 250 });
    const b = makeAc("B", { position: { x: 20, y: 0 }, heading: 90, speed: 250 });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it("ignores aircraft sequenced in trail on the same approach", () => {
    const appr = {
      runwayId: "13R",
      finalCourse: 131,
      glideslopeAngle: 3,
      thresholdPos: { x: 0, y: 0 },
      thresholdElevation: 46,
      localizerCaptured: true,
    };
    const a = makeAc("A", { position: { x: 0, y: 0 }, clearedApproach: { ...appr } });
    const b = makeAc("B", { position: { x: 1.5, y: 0 }, clearedApproach: { ...appr } });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });
});

describe("alertLevels", () => {
  it("takes the highest severity per aircraft", () => {
    const conflicts: Conflict[] = [
      { a: "X", b: "Y", lateralNm: 4, verticalFt: 500, severity: "warning" },
      { a: "X", b: "Z", lateralNm: 1, verticalFt: 200, severity: "violation" },
    ];
    const levels = alertLevels(conflicts);
    expect(levels.get("X")).toBe("violation");
    expect(levels.get("Y")).toBe("warning");
    expect(levels.get("Z")).toBe("violation");
  });
});
