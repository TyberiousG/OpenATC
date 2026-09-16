import type { AirportPackage } from "@openatc/airport-data";
import type { Aircraft } from "@openatc/sim-engine";

/**
 * Generates pilot-initiated transmissions — check-ins, VFR flight following,
 * altitude and approach requests. This is a *presentation* layer: it reads
 * simulation state but never mutates it, and uses its own randomness so the
 * authoritative engine stays fully deterministic. Controller responses to
 * these requests are a future milestone; for now they add radio life.
 */
export interface PilotRequest {
  callsign: string;
  spoken: string;
  text: string;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/** Altitude spoken form: FL for ≥18000, else thousands. */
function spokenAltitude(altitude: number): string {
  if (altitude >= 18000) return `flight level ${Math.round(altitude / 100)}`;
  return `${Math.round(altitude / 100) * 100}`;
}

export function makePilotRequest(airport: AirportPackage, ac: Aircraft): PilotRequest {
  const fixes = airport.navaids.map((n) => n.id);
  const approaches = airport.approaches.map((a) => a.id);
  const facility = airport.name.split(" ")[0]; // e.g. "Houston"

  const templates: string[] = [
    `${facility} Approach, ${ac.spoken}, with you at ${spokenAltitude(ac.altitude)}`,
    `${ac.spoken}, request VFR flight following`,
    `${ac.spoken}, request higher`,
    `${ac.spoken}, request lower`,
  ];
  if (fixes.length > 0) templates.push(`${ac.spoken}, request direct ${pick(fixes)}`);
  if (approaches.length > 0) templates.push(`${ac.spoken}, request the ${pick(approaches)}`);

  return { callsign: ac.callsign, spoken: ac.spoken, text: pick(templates) };
}
