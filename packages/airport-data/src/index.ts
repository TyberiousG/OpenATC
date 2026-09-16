import type { AirportPackage } from "./types.js";
import { KHOU } from "./airports/khou.js";

export * from "./types.js";
export { KHOU };

/** Registry of available airport packages, keyed by ICAO. */
export const airports: Record<string, AirportPackage> = {
  KHOU,
};

export function getAirport(icao: string): AirportPackage | undefined {
  return airports[icao.toUpperCase()];
}
