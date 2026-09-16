import { describe, it, expect } from "vitest";
import { correctHomophones } from "./corrections.js";
import { spokenCallsign, resolveAirline } from "./airlines.js";
import { parseCommand } from "./parser.js";

describe("correctHomophones", () => {
  it("rewrites homophones inside a number run", () => {
    expect(correctHomophones("heading two for zero")).toBe("heading two four zero");
    expect(correctHomophones("heading to four zero")).toBe("heading two four zero");
  });

  it("applies always-safe aviation phonetics", () => {
    expect(correctHomophones("heading tree fife niner")).toBe("heading three five nine");
  });

  it("leaves genuine prepositions after command words alone", () => {
    expect(correctHomophones("descend to four thousand")).toBe("descend to four thousand");
    expect(correctHomophones("reduce speed to one eighty")).toBe("reduce speed to one eighty");
    expect(correctHomophones("cleared for the approach")).toBe("cleared for the approach");
  });

  it("fixes a homophone in a flight number after the airline", () => {
    expect(correctHomophones("jetblue for two one")).toBe("jetblue four two one");
  });
});

describe("spokenCallsign", () => {
  it("renders ICAO codes back to telephony", () => {
    expect(spokenCallsign("JBU649")).toBe("JetBlue 649");
    expect(spokenCallsign("UAL421")).toBe("United 421");
    expect(spokenCallsign("RPA1234")).toBe("Brickyard 1234");
  });

  it("passes through unknown prefixes unchanged", () => {
    expect(spokenCallsign("N12345")).toBe("N12345");
  });

  it("round-trips with resolveAirline", () => {
    expect(resolveAirline("jet blue")?.icao).toBe("JBU");
    expect(resolveAirline("brickyard")?.icao).toBe("RPA");
  });
});

describe("parseCommand with homophones and prepositions", () => {
  it("parses a homophone-mangled spoken instruction", () => {
    const r = parseCommand("JetBlue 649 turn left heading to four zero descend to four thousand");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.callsign).toBe("JBU649");
    expect(r.spoken).toBe("JetBlue 649");
    expect(r.commands).toEqual([
      { kind: "heading", heading: 240, direction: "left" },
      { kind: "altitude", altitude: 4000 },
    ]);
  });

  it("tolerates 'to' as a preposition in each clause", () => {
    const r = parseCommand("United 421 fly heading to 090 climb to 5000 reduce speed to 180");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands).toEqual([
      { kind: "heading", heading: 90, direction: null },
      { kind: "altitude", altitude: 5000 },
      { kind: "speed", speed: 180 },
    ]);
  });
});
