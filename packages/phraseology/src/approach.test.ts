import { describe, it, expect } from "vitest";
import { parseCommand } from "./parser.js";

describe("parseCommand approach clearance", () => {
  it("parses 'cleared ILS <runway> approach'", () => {
    const r = parseCommand("United 421 cleared ILS 13R approach");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "approach", runway: "13R", visual: false }]);
    expect(r.readback).toBe("cleared ILS 13R approach, United 421");
  });

  it("parses 'cleared approach' with no runway", () => {
    const r = parseCommand("United 421 cleared approach");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "approach", runway: null, visual: false }]);
    expect(r.readback).toBe("cleared approach, United 421");
  });

  it("parses a visual approach with the runway after 'approach'", () => {
    const r = parseCommand("United 421 cleared visual approach runway 22");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "approach", runway: "22", visual: true }]);
    expect(r.readback).toBe("cleared visual approach runway 22, United 421");
  });

  it("parses a spoken runway with side word", () => {
    const r = parseCommand("United 421 cleared for the ILS runway one three right approach");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "approach", runway: "13R", visual: false }]);
  });

  it("pads a single-digit runway", () => {
    const r = parseCommand("United 421 cleared ILS 4 approach");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([{ kind: "approach", runway: "04", visual: false }]);
  });

  it("absorbs common STT mistranscriptions ('clear iOS 04 approach')", () => {
    const r = parseCommand("Delta 717 clear iOS 04 approach");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.callsign).toBe("DAL717");
    expect(r.commands).toEqual([{ kind: "approach", runway: "04", visual: false }]);
    expect(r.readback).toBe("cleared ILS 04 approach, Delta 717");
  });

  it("accepts 'clear' without the -ed and 'isles' for ILS", () => {
    expect((parseCommand("United 421 clear isles 13R approach") as any).commands).toEqual([
      { kind: "approach", runway: "13R", visual: false },
    ]);
  });

  it("combines a vector with an approach clearance", () => {
    const r = parseCommand("United 421 turn left heading 160 cleared ILS 13R approach");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([
      { kind: "heading", heading: 160, direction: "left" },
      { kind: "approach", runway: "13R", visual: false },
    ]);
  });
});
