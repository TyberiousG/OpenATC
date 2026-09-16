import { describe, it, expect } from "vitest";
import { parseCommand } from "./parser.js";

describe("parseCommand", () => {
  it("parses the canonical multi-command instruction", () => {
    const r = parseCommand("United 421 turn left heading 240, descend and maintain 4000, reduce speed 180");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.callsign).toBe("UAL421");
    expect(r.spoken).toBe("United 421");
    expect(r.commands).toEqual([
      { kind: "heading", heading: 240, direction: "left" },
      { kind: "altitude", altitude: 4000 },
      { kind: "speed", speed: 180 },
    ]);
    expect(r.readback).toBe("turn left heading 240, descend and maintain 4000, reduce speed 180, United 421");
  });

  it("parses flight levels", () => {
    const r = parseCommand("Delta 88 climb and maintain flight level 180");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "altitude", altitude: 18000 }]);
    expect(r.readback).toBe("climb and maintain flight level 180, Delta 88");
  });

  it("parses a plain 'fly heading' with no turn direction", () => {
    const r = parseCommand("Southwest 12 fly heading 090");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "heading", heading: 90, direction: null }]);
    expect(r.readback).toBe("fly heading 090, Southwest 12");
  });

  it("parses speed given in knots", () => {
    const r = parseCommand("American 55 maintain 210 knots");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "speed", speed: 210 }]);
    expect(r.readback).toBe("maintain 210 knots, American 55");
  });

  it("orders the readback by input position regardless of command type", () => {
    const r = parseCommand("United 421 reduce speed 200, turn right heading 300");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readback).toBe("reduce speed 200, turn right heading 300, United 421");
  });

  it("fails when no callsign is present", () => {
    const r = parseCommand("turn left heading 240");
    expect(r.ok).toBe(false);
  });

  it("fails when no instruction is recognized", () => {
    const r = parseCommand("United 421 say altimeter");
    expect(r.ok).toBe(false);
  });

  it("rejects an out-of-range heading via validation", () => {
    const r = parseCommand("United 421 fly heading 400");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/heading/);
  });

  it("rejects an off-increment altitude", () => {
    const r = parseCommand("United 421 descend and maintain 4050");
    expect(r.ok).toBe(false);
  });
});
