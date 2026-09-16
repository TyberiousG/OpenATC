import { describe, it, expect } from "vitest";
import { parseCommand } from "./parser.js";

describe("parseCommand squawk", () => {
  it("parses a squawk assignment", () => {
    const r = parseCommand("United 421 squawk 4271");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "squawk", code: "4271" }]);
    expect(r.readback).toBe("squawk 4271, United 421");
  });

  it("accepts 'squawk code' and spoken digits", () => {
    const r = parseCommand("Delta 88 squawk code two four zero one");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "squawk", code: "2401" }]);
  });

  it("rejects a non-octal code", () => {
    const r = parseCommand("United 421 squawk 4290");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/octal/);
  });

  it("combines squawk with other instructions", () => {
    const r = parseCommand("United 421 descend and maintain 4000 squawk 4271");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([
      { kind: "altitude", altitude: 4000 },
      { kind: "squawk", code: "4271" },
    ]);
  });
});

describe("parseCommand thousands separators", () => {
  it("handles commas in thousands", () => {
    const r = parseCommand("United 421 descend and maintain 4,000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "altitude", altitude: 4000 }]);
  });

  it("handles commas in thousands alongside clause-separating commas", () => {
    const r = parseCommand("United 421 turn left heading 240, descend and maintain 11,000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([
      { kind: "heading", heading: 240, direction: "left" },
      { kind: "altitude", altitude: 11000 },
    ]);
  });
});
