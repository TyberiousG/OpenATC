import { describe, it, expect } from "vitest";
import { applyCommand, stepAircraft, type Aircraft } from "./aircraft.js";

function makeAircraft(overrides: Partial<Aircraft> = {}): Aircraft {
  return {
    id: "TEST1",
    callsign: "TEST1",
    spoken: "Test 1",
    aircraftType: "B737",
    position: { x: 0, y: 0 },
    altitude: 3000,
    verticalRate: 0,
    heading: 360,
    speed: 250,
    assignedHeading: null,
    assignedAltitude: null,
    assignedSpeed: null,
    turnDirection: null,
    controller: "APP",
    squawk: "1234",
    intent: {
      kind: "overflight",
      origin: "DFW",
      destination: "MSY",
      runway: null,
      cruiseAltitude: 3000,
      navTarget: null,
    },
    status: "active",
    clearedApproach: null,
    ...overrides,
  };
}

function run(ac: Aircraft, seconds: number, dt = 1): void {
  for (let t = 0; t < seconds; t += dt) stepAircraft(ac, dt);
}

describe("aircraft dynamics", () => {
  it("turns to the assigned heading at standard rate", () => {
    const ac = makeAircraft({ heading: 360 });
    applyCommand(ac, { kind: "heading", heading: 90, direction: null });
    run(ac, 40); // 90° at 3°/s = 30s, with margin
    expect(ac.heading).toBeCloseTo(90, 5);
    expect(ac.turnDirection).toBeNull();
  });

  it("honors a commanded left turn the long way around", () => {
    const ac = makeAircraft({ heading: 10 });
    // Shortest to 350 is left (-20), but we force a right turn (340° of arc).
    applyCommand(ac, { kind: "heading", heading: 350, direction: "right" });
    stepAircraft(ac, 1);
    expect(ac.heading).toBeCloseTo(13, 5); // moved clockwise, not counter
  });

  it("climbs and levels off at the assigned altitude", () => {
    const ac = makeAircraft({ altitude: 3000 });
    applyCommand(ac, { kind: "altitude", altitude: 5000 });
    run(ac, 120);
    expect(ac.altitude).toBe(5000);
    expect(ac.verticalRate).toBe(0);
  });

  it("changes speed toward the assignment", () => {
    const ac = makeAircraft({ speed: 250 });
    applyCommand(ac, { kind: "speed", speed: 200 });
    run(ac, 60);
    expect(ac.speed).toBe(200);
  });

  it("moves east when heading 090", () => {
    const ac = makeAircraft({ heading: 90, speed: 360, assignedHeading: 90 });
    run(ac, 10); // 360kt = 0.1nm/s -> 1nm in 10s
    expect(ac.position.x).toBeCloseTo(1, 3);
    expect(ac.position.y).toBeCloseTo(0, 3);
  });
});

describe("semi-autonomous intent", () => {
  it("steers toward its nav target when unvectored", () => {
    const ac = makeAircraft({
      position: { x: 0, y: 0 },
      heading: 360,
      speed: 250,
      intent: {
        kind: "overflight",
        origin: "A",
        destination: "B",
        runway: null,
        cruiseAltitude: 8000,
        navTarget: { x: 100, y: 0 }, // due east, far away
      },
    });
    run(ac, 40);
    expect(ac.heading).toBeGreaterThan(80);
    expect(ac.heading).toBeLessThan(100);
  });

  it("a controller heading overrides the nav target", () => {
    const ac = makeAircraft({
      heading: 360,
      assignedHeading: 270,
      intent: {
        kind: "arrival",
        origin: "A",
        destination: "KHOU",
        runway: "13R",
        cruiseAltitude: 8000,
        navTarget: { x: 100, y: 0 },
      },
    });
    run(ac, 60);
    expect(ac.heading).toBeCloseTo(270, 5);
  });

  it("departures climb toward cruise on their own", () => {
    const ac = makeAircraft({
      altitude: 3000,
      intent: {
        kind: "departure",
        origin: "KHOU",
        destination: "B",
        runway: "13R",
        cruiseAltitude: 10000,
        navTarget: null,
      },
    });
    run(ac, 60);
    expect(ac.altitude).toBeGreaterThan(3000);
    expect(ac.verticalRate).toBeGreaterThan(0);
  });
});
