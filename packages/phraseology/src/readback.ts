/** Structured description of one clause, used to render a pilot readback. */
export type ReadbackClause =
  | { kind: "heading"; heading: number; direction: "left" | "right" | null }
  | { kind: "altitude"; altitude: number; verb: "climb" | "descend" | "maintain"; flightLevel: boolean }
  | { kind: "speed"; speed: number; verb: "reduce" | "increase" | null; knots: boolean }
  | { kind: "contact"; facility: string | null; label: string; frequency: string | null }
  | { kind: "squawk"; code: string }
  | { kind: "approach"; runway: string | null; type: "ils" | "visual" | "rnav" | null }
  | { kind: "taxi"; runway: string | null; via: string[] }
  | { kind: "takeoff"; runway: string | null };

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

function renderClause(c: ReadbackClause): string {
  switch (c.kind) {
    case "heading":
      return c.direction
        ? `turn ${c.direction} heading ${pad3(c.heading)}`
        : `fly heading ${pad3(c.heading)}`;
    case "altitude": {
      const value = c.flightLevel ? `flight level ${Math.round(c.altitude / 100)}` : `${c.altitude}`;
      if (c.verb === "maintain") return `maintain ${value}`;
      return `${c.verb} and maintain ${value}`;
    }
    case "speed":
      if (c.verb) return `${c.verb} speed ${c.speed}`;
      return c.knots ? `maintain ${c.speed} knots` : `speed ${c.speed}`;
    case "contact": {
      const who = c.facility ? `${c.facility} ${c.label}` : c.label;
      return c.frequency ? `contact ${who} ${c.frequency}` : `contact ${who}`;
    }
    case "squawk":
      return `squawk ${c.code}`;
    case "approach": {
      if (!c.runway) return c.type === "visual" ? "cleared visual approach" : "cleared approach";
      if (c.type === "visual") return `cleared visual approach runway ${c.runway}`;
      if (c.type === "rnav") return `cleared RNAV runway ${c.runway} approach`;
      if (c.type === "ils") return `cleared ILS ${c.runway} approach`;
      return `cleared approach runway ${c.runway}`;
    }
    case "taxi": {
      const base = c.runway ? `taxi to runway ${c.runway}` : `taxi`;
      return c.via.length > 0 ? `${base} via ${c.via.join(", ")}` : base;
    }
    case "takeoff":
      return c.runway ? `runway ${c.runway} cleared for takeoff` : `cleared for takeoff`;
  }
}

/**
 * Build a pilot readback: the instructions echoed back, followed by the
 * aircraft's callsign — the standard order pilots use on frequency.
 */
export function buildReadback(clauses: ReadbackClause[], spoken: string): string {
  const parts = clauses.map(renderClause);
  return `${parts.join(", ")}, ${spoken}`;
}
