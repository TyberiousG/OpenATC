import type { AirportPackage } from "@openatc/airport-data";
import type { Aircraft, FlightKind } from "./aircraft.js";
import { normalizeHeading, type Vec2 } from "./geo.js";
import { mulberry32, randRange, pick } from "./rng.js";

interface Airline {
  icao: string;
  name: string;
}

const AIRLINES: readonly Airline[] = [
  { icao: "SWA", name: "Southwest" },
  { icao: "UAL", name: "United" },
  { icao: "AAL", name: "American" },
  { icao: "DAL", name: "Delta" },
  { icao: "JBU", name: "JetBlue" },
  { icao: "NKS", name: "Spirit" },
];

const TYPES = ["B737", "B738", "A320", "A319", "E175"] as const;

/** Nearby cities used as origins/destinations for flavor. */
const CITIES = ["DFW", "MSY", "ATL", "DEN", "ORD", "MCO", "LAS", "PHX"] as const;

const RESERVED_SQUAWKS = new Set(["7500", "7600", "7700", "1200", "0000"]);

function makeSquawk(rng: () => number): string {
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += Math.floor(rng() * 8);
  } while (RESERVED_SQUAWKS.has(code));
  return code;
}

function runwayHeading(airport: AirportPackage, id: string): number {
  return airport.runways.find((r) => r.id === id)?.heading ?? 0;
}

/** Runways that support a modeled approach — the ones arrivals aim for. */
function landingRunways(airport: AirportPackage): string[] {
  const ids = airport.approaches.map((a) => a.runwayId);
  return ids.length > 0 ? ids : airport.runways.map((r) => r.id);
}

function newCallsign(rng: () => number, used: Set<string>): { callsign: string; spoken: string } {
  const airline = pick(rng, AIRLINES);
  let number = 0;
  let callsign = "";
  do {
    number = Math.floor(randRange(rng, 100, 1000));
    callsign = `${airline.icao}${number}`;
  } while (used.has(callsign));
  used.add(callsign);
  return { callsign, spoken: `${airline.name} ${number}` };
}

/** Base fields shared by every generated aircraft. */
function base(rng: () => number, cs: { callsign: string; spoken: string }, pos: Vec2): Omit<Aircraft, "intent"> {
  return {
    id: cs.callsign,
    callsign: cs.callsign,
    spoken: cs.spoken,
    aircraftType: pick(rng, TYPES),
    position: pos,
    altitude: 0,
    verticalRate: 0,
    heading: 0,
    speed: 0,
    assignedHeading: null,
    assignedAltitude: null,
    assignedSpeed: null,
    turnDirection: null,
    controller: "APP",
    squawk: makeSquawk(rng),
    status: "active",
    clearedApproach: null,
  };
}

/** Generate one aircraft of the given kind. Deterministic given `rng`. */
export function generateAircraft(
  airport: AirportPackage,
  rng: () => number,
  kind: FlightKind,
  used: Set<string>,
): Aircraft {
  const cs = newCallsign(rng, used);

  if (kind === "departure") {
    const rwy = pick(rng, landingRunways(airport));
    const hdg = runwayHeading(airport, rwy);
    const dist = randRange(rng, 1.5, 6);
    const rad = (hdg * Math.PI) / 180;
    const pos = { x: Math.sin(rad) * dist, y: Math.cos(rad) * dist };
    const cruise = Math.round(randRange(rng, 16000, 24000) / 1000) * 1000;
    const ac = base(rng, cs, pos) as Aircraft;
    ac.altitude = Math.round(randRange(rng, airport.elevation + 1500, 5000) / 100) * 100;
    ac.heading = hdg;
    ac.speed = Math.round(randRange(rng, 180, 250) / 10) * 10;
    ac.intent = {
      kind: "departure",
      origin: airport.icao,
      destination: pick(rng, CITIES),
      runway: rwy,
      cruiseAltitude: cruise,
      navTarget: null, // fly runway heading until vectored
    };
    return ac;
  }

  // Arrival or overflight: spawn on a ring around the field.
  const bearing = randRange(rng, 0, 360);
  const dist = randRange(rng, 24, 36);
  const rad = (bearing * Math.PI) / 180;
  const pos = { x: Math.sin(rad) * dist, y: Math.cos(rad) * dist };
  const ac = base(rng, cs, pos) as Aircraft;

  if (kind === "arrival") {
    const rwy = pick(rng, landingRunways(airport));
    ac.altitude = Math.round(randRange(rng, 8000, 13000) / 100) * 100;
    ac.speed = Math.round(randRange(rng, 220, 280) / 10) * 10;
    ac.heading = normalizeHeading((Math.atan2(-pos.x, -pos.y) * 180) / Math.PI + randRange(rng, -20, 20));
    ac.intent = {
      kind: "arrival",
      origin: pick(rng, CITIES),
      destination: airport.icao,
      runway: rwy,
      cruiseAltitude: ac.altitude,
      navTarget: { x: 0, y: 0 }, // steer toward the field until vectored
    };
    return ac;
  }

  // Overflight: cross the airspace to the far side.
  const exit: Vec2 = { x: -pos.x, y: -pos.y };
  ac.altitude = Math.round(randRange(rng, 12000, 20000) / 100) * 100;
  ac.speed = Math.round(randRange(rng, 250, 300) / 10) * 10;
  ac.heading = normalizeHeading((Math.atan2(exit.x - pos.x, exit.y - pos.y) * 180) / Math.PI);
  ac.intent = {
    kind: "overflight",
    origin: pick(rng, CITIES),
    destination: pick(rng, CITIES),
    runway: null,
    cruiseAltitude: ac.altitude,
    navTarget: exit,
  };
  return ac;
}

/** Pick a flight kind with a realistic-ish mix. */
export function pickFlightKind(rng: () => number): FlightKind {
  const r = rng();
  if (r < 0.5) return "arrival";
  if (r < 0.8) return "departure";
  return "overflight";
}

/**
 * Produce a reproducible set of aircraft with a mix of objectives. The same
 * (airport, seed, count) always yields identical traffic.
 */
export function generateTraffic(airport: AirportPackage, seed: number, count: number): Aircraft[] {
  const rng = mulberry32(seed);
  const used = new Set<string>();
  const out: Aircraft[] = [];
  for (let i = 0; i < count; i++) {
    out.push(generateAircraft(airport, rng, pickFlightKind(rng), used));
  }
  return out;
}
