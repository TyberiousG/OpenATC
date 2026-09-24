import type { Command } from "@openatc/sim-engine";
import { validateCommand } from "@openatc/sim-engine";
import { resolveAirline, NAME_ALTERNATION } from "./airlines.js";
import { buildReadback, type ReadbackClause } from "./readback.js";
import { normalizeSpokenNumbers } from "./spokenNumbers.js";
import { correctHomophones } from "./corrections.js";

export type ParseResult =
  | {
      ok: true;
      /** ATC callsign code, e.g. "UAL421". */
      callsign: string;
      /** Spoken callsign, e.g. "United 421". */
      spoken: string;
      commands: Command[];
      readback: string;
    }
  | { ok: false; error: string; input: string };

interface Clause {
  command: Command;
  readback: ReadbackClause;
  /** Position in the input, for stable ordering of the readback. */
  index: number;
}

const CALLSIGN_RE = new RegExp(`^\\s*(${NAME_ALTERNATION})\\s+(\\d{1,4})\\b`, "i");

const HEADING_RE = /(?:turn\s+)?(left|right)?\s*(?:fly\s+)?heading\s+(?:to\s+)?(\d{1,3})/;
const ALTITUDE_RE =
  /(climb|descend|maintain)(?:\s+and\s+maintain)?(?:\s+to)?\s+(?:(?:flight\s+level|fl)\s*(\d{2,3})|(\d{4,5}))/;
const SPEED_RE = /(reduce|increase)?\s*speed\s+(?:to\s+)?(\d{2,3})/;
const SPEED_KNOTS_RE = /(\d{2,3})\s*(?:knots|kts|kt)\b/;
/** "squawk 4271" / "squawk code 4271" / "ident 4271". */
const SQUAWK_RE = /(?:squawk|transponder|beacon)\s+(?:code\s+)?(\d{4})/;
/** "cleared ILS 13R approach" / "cleared approach" / "cleared for the ILS runway 04 approach". */
const APPROACH_RE =
  /clear(?:ed)?\s+(?:for\s+)?(?:the\s+)?(ils|visual|rnav)?\s*(?:runway\s+)?(?:(\d{1,2})\s*(left|right|center|centre|l|r|c)?\s+)?approach(?:\s+(?:to\s+)?(?:runway\s+)?(\d{1,2})\s*(left|right|center|centre|l|r|c)?)?/;
/** "taxi to runway 13R" / "taxi to 04" / "taxi runway one three right". */
const TAXI_RE =
  /taxi\s+(?:to\s+)?(?:runway\s+)?(?:(\d{1,2})\s*(left|right|center|centre|l|r|c)?)?/;
/** "cleared for takeoff", "runway 13R cleared for takeoff", "cleared for takeoff runway 04". */
const TAKEOFF_RE =
  /(?:runway\s+(\d{1,2})\s*(left|right|center|centre|l|r|c)?\s+)?clear(?:ed)?\s+for\s+takeoff(?:\s+runway\s+(\d{1,2})\s*(left|right|center|centre|l|r|c)?)?/;

const RUNWAY_SIDE: Record<string, string> = {
  left: "L", right: "R", center: "C", centre: "C", l: "L", r: "R", c: "C",
};

function runwayId(digits: string | undefined, side: string | undefined): string | null {
  if (!digits) return null;
  return digits.padStart(2, "0") + (side ? (RUNWAY_SIDE[side] ?? "") : "");
}

const PHONETIC: Record<string, string> = {
  alpha: "A", bravo: "B", charlie: "C", delta: "D", echo: "E", foxtrot: "F",
  golf: "G", hotel: "H", india: "I", juliet: "J", juliett: "J", kilo: "K",
  lima: "L", mike: "M", november: "N", oscar: "O", papa: "P", quebec: "Q",
  romeo: "R", sierra: "S", tango: "T", uniform: "U", victor: "V", whiskey: "W",
  xray: "X", yankee: "Y", zulu: "Z",
};

/** Parse a "via A B K2" taxiway list (phonetic or letter/alphanumeric ids). */
function parseVia(rest: string): string[] {
  const m = rest.match(/\bvia\s+(.+)$/);
  if (!m) return [];
  const tail = m[1]!.split(/\b(?:hold|contact|then|and hold)\b/)[0]!;
  const tokens = tail.split(/[\s,]+/).filter((t) => t && t !== "and" && t !== "taxiway" && t !== "on");
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t in PHONETIC) {
      let id = PHONETIC[t]!;
      if (i + 1 < tokens.length && /^\d$/.test(tokens[i + 1]!)) id += tokens[++i]!;
      out.push(id);
    } else if (/^[a-z]{1,2}\d?$/.test(t)) {
      out.push(t.toUpperCase());
    }
  }
  return out;
}

/** Handoff: "contact [facility] <tower|ground|approach|departure|center>". */
const CONTACT_RE = /contact\s+(?:([a-z][a-z\s]*?)\s+)?(tower|ground|approach|departure|cent(?:er|re))\b/;
/** Frequency after the position: 118.7 / 124.35 / "one one eight point seven". */
const FREQUENCY_RE = /(\d{2,3})\s*(?:\.|point)\s*(\d{1,3})/;

const POSITION_WORDS: Record<string, { id: string; label: string }> = {
  tower: { id: "TWR", label: "Tower" },
  ground: { id: "GND", label: "Ground" },
  approach: { id: "APP", label: "Approach" },
  departure: { id: "DEP", label: "Departure" },
  center: { id: "CTR", label: "Center" },
  centre: { id: "CTR", label: "Center" },
};

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Deterministically parse a controller instruction into validated structured
 * commands plus a pilot readback. Pure and side-effect free: the same input
 * always yields the same result. It never touches simulation state — callers
 * apply the returned commands to the engine.
 */
export function parseCommand(rawInput: string): ParseResult {
  const input = rawInput.trim();
  const cleaned = normalizeSpokenNumbers(
    correctHomophones(
      input
        .toLowerCase()
        // Strip thousands separators ("4,000" → "4000") before treating any
        // remaining commas as clause separators ("240, descend" → "240 descend").
        .replace(/(\d),(?=\d)/g, "$1")
        .replace(/,/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );

  const csMatch = cleaned.match(CALLSIGN_RE);
  if (!csMatch) {
    return { ok: false, error: "could not identify a callsign (e.g. \"United 421\")", input };
  }
  const airline = resolveAirline(csMatch[1]!.replace(/\s+/g, " "));
  if (!airline) {
    return { ok: false, error: `unknown airline: ${csMatch[1]}`, input };
  }
  const flightNumber = csMatch[2]!;
  const callsign = `${airline.icao}${flightNumber}`;
  const spoken = `${airline.display} ${flightNumber}`;

  const rest = cleaned.slice(csMatch[0].length);
  const clauses: Clause[] = [];

  // Heading
  const h = rest.match(HEADING_RE);
  if (h) {
    const direction = (h[1] as "left" | "right" | undefined) ?? null;
    const heading = parseInt(h[2]!, 10);
    clauses.push({
      command: { kind: "heading", heading, direction },
      readback: { kind: "heading", heading, direction },
      index: h.index ?? 0,
    });
  }

  // Altitude
  const a = rest.match(ALTITUDE_RE);
  if (a) {
    const verb = a[1] as "climb" | "descend" | "maintain";
    const isFlightLevel = a[2] !== undefined;
    const altitude = isFlightLevel ? parseInt(a[2]!, 10) * 100 : parseInt(a[3]!, 10);
    clauses.push({
      command: { kind: "altitude", altitude },
      readback: { kind: "altitude", altitude, verb, flightLevel: isFlightLevel },
      index: a.index ?? 0,
    });
  }

  // Speed
  const s = rest.match(SPEED_RE);
  const sk = !s ? rest.match(SPEED_KNOTS_RE) : null;
  if (s) {
    const verb = (s[1] as "reduce" | "increase" | undefined) ?? null;
    const speed = parseInt(s[2]!, 10);
    clauses.push({
      command: { kind: "speed", speed },
      readback: { kind: "speed", speed, verb, knots: false },
      index: s.index ?? 0,
    });
  } else if (sk) {
    const speed = parseInt(sk[1]!, 10);
    clauses.push({
      command: { kind: "speed", speed },
      readback: { kind: "speed", speed, verb: null, knots: true },
      index: sk.index ?? 0,
    });
  }

  // Squawk / transponder
  const sq = rest.match(SQUAWK_RE);
  if (sq) {
    const code = sq[1]!;
    clauses.push({
      command: { kind: "squawk", code },
      readback: { kind: "squawk", code },
      index: sq.index ?? 0,
    });
  }

  // Approach clearance (ILS when published, else visual)
  const ap = rest.match(APPROACH_RE);
  if (ap) {
    const type = ap[1] as "ils" | "visual" | "rnav" | undefined;
    const runway = runwayId(ap[2] ?? ap[4], ap[3] ?? ap[5]);
    const visual = type === "visual";
    clauses.push({
      command: { kind: "approach", runway, visual },
      readback: { kind: "approach", runway, type: type ?? null },
      index: ap.index ?? 0,
    });
  }

  // Taxi
  const tx = rest.match(TAXI_RE);
  if (tx) {
    const runway = runwayId(tx[1], tx[2]);
    const via = parseVia(rest);
    clauses.push({
      command: { kind: "taxi", runway, via },
      readback: { kind: "taxi", runway, via },
      index: tx.index ?? 0,
    });
  }

  // Takeoff clearance
  const to = rest.match(TAKEOFF_RE);
  if (to) {
    const runway = runwayId(to[1] ?? to[3], to[2] ?? to[4]);
    clauses.push({
      command: { kind: "takeoff", runway },
      readback: { kind: "takeoff", runway },
      index: to.index ?? 0,
    });
  }

  // Handoff / contact
  const c = rest.match(CONTACT_RE);
  if (c) {
    const pos = POSITION_WORDS[c[2]!]!;
    const facility = c[1] ? titleCase(c[1].trim()) : null;
    // Look for a frequency only in the tail that follows the position keyword.
    const tail = rest.slice((c.index ?? 0) + c[0].length);
    const f = tail.match(FREQUENCY_RE);
    const frequency = f ? `${f[1]}.${f[2]}` : null;
    clauses.push({
      command: { kind: "contact", position: pos.id, frequency },
      readback: { kind: "contact", facility, label: pos.label, frequency },
      index: c.index ?? 0,
    });
  }

  if (clauses.length === 0) {
    return { ok: false, error: "no recognizable instruction found", input };
  }

  // Validate every command before committing.
  for (const c of clauses) {
    const err = validateCommand(c.command);
    if (err) {
      return { ok: false, error: err.message, input };
    }
  }

  clauses.sort((x, y) => x.index - y.index);
  const commands = clauses.map((c) => c.command);
  const readback = buildReadback(clauses.map((c) => c.readback), spoken);

  return { ok: true, callsign, spoken, commands, readback };
}
