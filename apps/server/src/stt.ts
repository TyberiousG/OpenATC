import type { IncomingMessage } from "node:http";
import type { Aircraft } from "@openatc/sim-engine";
import type { AirlineEntry } from "@openatc/phraseology";

/** Collect a request body into a single Buffer. */
export function readBody(req: IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("audio too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Static ATC phraseology worth biasing the recogniser toward. */
const ATC_TERMS = [
  "heading", "descend", "climb", "maintain", "altitude", "flight", "level",
  "reduce", "increase", "speed", "knots", "turn", "left", "right", "cleared",
  "approach", "ILS", "runway", "contact", "tower", "ground", "center",
  "departure", "squawk", "direct", "traffic", "niner",
];

/**
 * Build the keyword list to bias Deepgram: ATC terms plus the telephony names
 * of airlines currently on frequency, so live callsigns are recognised.
 */
export function sttKeywords(fleet: Aircraft[], airlines: AirlineEntry[]): string[] {
  const present = new Set(fleet.map((ac) => ac.callsign.replace(/\d+$/, "")));
  const names = airlines.filter((a) => present.has(a.icao)).map((a) => a.display);
  return [...ATC_TERMS, ...names];
}
