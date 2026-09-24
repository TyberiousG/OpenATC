import { describe, it, expect } from "vitest";
import { parseCommand } from "./parser.js";

describe("parseCommand taxi & takeoff", () => {
  it("parses a taxi clearance to a runway", () => {
    const r = parseCommand("Southwest 12 taxi to runway 13R");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "taxi", runway: "13R", via: [] }]);
    expect(r.readback).toBe("taxi to runway 13R, Southwest 12");
  });

  it("parses a spoken taxi runway", () => {
    const r = parseCommand("Delta 88 taxi to runway one three right");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "taxi", runway: "13R", via: [] }]);
  });

  it("parses 'via' taxiways (phonetic and alphanumeric)", () => {
    const r = parseCommand("Spirit 557 taxi to runway 31R via charlie");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "taxi", runway: "31R", via: ["C"] }]);
    expect(r.readback).toBe("taxi to runway 31R via C, Spirit 557");

    const r2 = parseCommand("United 5 taxi to runway 04 via bravo kilo two");
    expect((r2 as any).commands[0].via).toEqual(["B", "K2"]);
  });

  it("parses takeoff clearance with the runway before or after", () => {
    expect((parseCommand("United 5 runway 04 cleared for takeoff") as any).commands).toEqual([
      { kind: "takeoff", runway: "04" },
    ]);
    expect((parseCommand("United 5 cleared for takeoff runway 31L") as any).commands).toEqual([
      { kind: "takeoff", runway: "31L" },
    ]);
  });

  it("parses a bare takeoff clearance", () => {
    const r = parseCommand("United 5 cleared for takeoff");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "takeoff", runway: null }]);
    expect(r.readback).toBe("cleared for takeoff, United 5");
  });
});
