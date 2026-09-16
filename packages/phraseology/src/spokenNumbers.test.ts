import { describe, it, expect } from "vitest";
import { normalizeSpokenNumbers } from "./spokenNumbers.js";
import { parseCommand } from "./parser.js";

describe("normalizeSpokenNumbers", () => {
  it("concatenates spoken digit runs", () => {
    expect(normalizeSpokenNumbers("heading two four zero")).toBe("heading 240");
    expect(normalizeSpokenNumbers("heading zero niner zero")).toBe("heading 090");
  });

  it("handles tens/teens by concatenation of value strings", () => {
    expect(normalizeSpokenNumbers("heading two forty")).toBe("heading 240");
    expect(normalizeSpokenNumbers("reduce speed one eighty")).toBe("reduce speed 180");
  });

  it("reads scale words as cardinals", () => {
    expect(normalizeSpokenNumbers("maintain four thousand")).toBe("maintain 4000");
    expect(normalizeSpokenNumbers("maintain eleven thousand")).toBe("maintain 11000");
    expect(normalizeSpokenNumbers("descend three hundred")).toBe("descend 300");
  });

  it("leaves already-digit input untouched", () => {
    expect(normalizeSpokenNumbers("heading 240 speed 180")).toBe("heading 240 speed 180");
  });

  it("collapses space-separated single digits (STT numerals mode)", () => {
    expect(normalizeSpokenNumbers("8 6 7")).toBe("867");
    expect(normalizeSpokenNumbers("heading 0 4 0")).toBe("heading 040");
    expect(normalizeSpokenNumbers("squawk 4 2 7 1")).toBe("squawk 4271");
  });
});

describe("parseCommand with split-digit STT output", () => {
  it("parses a callsign and heading given as separate digits", () => {
    const r = parseCommand("american 8 6 7 turn right heading 0 4 0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.callsign).toBe("AAL867");
    expect(r.commands).toEqual([{ kind: "heading", heading: 40, direction: "right" }]);
    expect(r.readback).toBe("turn right heading 040, American 867");
  });
});

describe("parseCommand with spoken input", () => {
  it("parses a fully spoken instruction", () => {
    const r = parseCommand("United 421 turn left heading two four zero descend and maintain four thousand");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.callsign).toBe("UAL421");
    expect(r.commands).toEqual([
      { kind: "heading", heading: 240, direction: "left" },
      { kind: "altitude", altitude: 4000 },
    ]);
  });

  it("parses spoken flight levels and speeds", () => {
    const r = parseCommand("Delta 88 climb and maintain flight level one eight zero reduce speed two one zero");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([
      { kind: "altitude", altitude: 18000 },
      { kind: "speed", speed: 210 },
    ]);
  });
});
