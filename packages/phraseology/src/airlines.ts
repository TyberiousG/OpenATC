/**
 * Callsign translation between spoken telephony and ICAO codes.
 *
 *   spoken  "JetBlue 649"   ⇄   code  "JBU649"
 *
 * Controllers speak (and pilots read back) the telephony form — "JetBlue six
 * four niner" — while the simulation tracks the compact ICAO callsign. This is
 * the bidirectional bridge: `resolveAirline` for parsing spoken input, and
 * `spokenCallsign` for rendering a code back into speech (readbacks, and later
 * TTS). `names` includes brand aliases and the way STT tends to split words
 * ("jet blue").
 */
export interface AirlineEntry {
  /** Lowercased spoken names/aliases that resolve to this airline. */
  names: string[];
  icao: string;
  /** Canonical telephony form used when speaking the callsign. */
  display: string;
}

export const AIRLINES: AirlineEntry[] = [
  { names: ["southwest"], icao: "SWA", display: "Southwest" },
  { names: ["united"], icao: "UAL", display: "United" },
  { names: ["american"], icao: "AAL", display: "American" },
  { names: ["delta"], icao: "DAL", display: "Delta" },
  { names: ["jetblue", "jet blue"], icao: "JBU", display: "JetBlue" },
  { names: ["spirit"], icao: "NKS", display: "Spirit" },
  { names: ["alaska"], icao: "ASA", display: "Alaska" },
  { names: ["frontier"], icao: "FFT", display: "Frontier" },
  { names: ["envoy"], icao: "ENY", display: "Envoy" },
  { names: ["skywest", "sky west"], icao: "SKW", display: "SkyWest" },
  { names: ["republic", "brickyard"], icao: "RPA", display: "Brickyard" },
  { names: ["allegiant"], icao: "AAY", display: "Allegiant" },
  { names: ["sun country", "suncountry"], icao: "SCX", display: "Sun Country" },
  { names: ["fedex", "fed ex"], icao: "FDX", display: "FedEx" },
  { names: ["ups"], icao: "UPS", display: "UPS" },
];

/** Longest names first so multi-word telephonies match before single words. */
const NAME_INDEX: { name: string; entry: AirlineEntry }[] = AIRLINES.flatMap((entry) =>
  entry.names.map((name) => ({ name, entry })),
).sort((a, b) => b.name.length - a.name.length);

const BY_ICAO = new Map<string, AirlineEntry>(AIRLINES.map((a) => [a.icao, a]));

/** Resolve a spoken airline name/alias to its airline entry. */
export function resolveAirline(spokenName: string): AirlineEntry | undefined {
  const n = spokenName.toLowerCase().replace(/\s+/g, " ").trim();
  return NAME_INDEX.find((x) => x.name === n)?.entry;
}

/**
 * Render an ICAO callsign code (e.g. "JBU649") into spoken telephony
 * ("JetBlue 649"). Unknown prefixes (e.g. GA registrations) are returned
 * unchanged so nothing is lost.
 */
export function spokenCallsign(code: string): string {
  const m = code.match(/^([A-Za-z]+)(\d+[A-Za-z]?)$/);
  if (!m) return code;
  const airline = BY_ICAO.get(m[1]!.toUpperCase());
  return airline ? `${airline.display} ${m[2]}` : code;
}

/** Alternation of names for use inside a callsign regex. */
export const NAME_ALTERNATION = NAME_INDEX.map((x) => x.name.replace(/\s+/g, "\\s+")).join("|");
