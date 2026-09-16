import { describe, it, expect } from "vitest";
import { parseCommand } from "./parser.js";

describe("parseCommand handoff / contact", () => {
  it("parses 'contact <facility> <position> at <frequency>'", () => {
    const r = parseCommand("United 421 contact Houston Tower on 118.7");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.callsign).toBe("UAL421");
    expect(r.commands).toEqual([{ kind: "contact", position: "TWR", frequency: "118.7" }]);
    expect(r.readback).toBe("contact Houston Tower 118.7, United 421");
  });

  it("maps position words to ids (ground/approach/departure/center)", () => {
    expect((parseCommand("Delta 88 contact ground 121.9") as any).commands[0]).toEqual({
      kind: "contact",
      position: "GND",
      frequency: "121.9",
    });
    expect((parseCommand("Delta 88 contact departure 123.8") as any).commands[0].position).toBe("DEP");
    expect((parseCommand("Delta 88 contact center 134.4") as any).commands[0].position).toBe("CTR");
  });

  it("parses a spoken frequency with 'point'", () => {
    const r = parseCommand("United 421 contact tower one one eight point seven");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "contact", position: "TWR", frequency: "118.7" }]);
  });

  it("allows a handoff with no frequency", () => {
    const r = parseCommand("United 421 contact approach");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "contact", position: "APP", frequency: null }]);
    expect(r.readback).toBe("contact Approach, United 421");
  });

  it("combines a handoff with another instruction, ordered by position", () => {
    const r = parseCommand("United 421 descend and maintain 3000 contact tower 118.7");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([
      { kind: "altitude", altitude: 3000 },
      { kind: "contact", position: "TWR", frequency: "118.7" },
    ]);
    expect(r.readback).toBe("descend and maintain 3000, contact Tower 118.7, United 421");
  });
});
