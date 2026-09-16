/**
 * Structured, validated ATC commands.
 *
 * This is the contract between the phraseology parser and the simulation
 * engine. The parser produces these; the engine consumes them. Nothing else
 * (speech, AI, networking) is allowed to mutate aircraft state directly.
 */

export type Command =
  | { kind: "heading"; heading: number; direction: "left" | "right" | null }
  | { kind: "altitude"; altitude: number }
  | { kind: "speed"; speed: number }
  | { kind: "contact"; position: string; frequency: string | null }
  | { kind: "squawk"; code: string }
  | { kind: "approach"; runway: string | null };

export type CommandKind = Command["kind"];

/** Controller positions an aircraft can be handed off to. */
export const HANDOFF_POSITIONS = ["APP", "TWR", "GND", "DEP", "CTR"] as const;

/** Frequencies look like 118.7 / 124.35 / 121.900 (MHz, one decimal group). */
const FREQUENCY_RE = /^\d{2,3}\.\d{1,3}$/;

/** Transponder codes are 4 octal digits: 0000–7777, no 8 or 9. */
const SQUAWK_RE = /^[0-7]{4}$/;

/** Operating envelope used for validation. Deliberately generous for a sim. */
export const LIMITS = {
  headingMin: 1,
  headingMax: 360,
  altitudeMin: 1000,
  altitudeMax: 45000,
  /** Altitudes are assigned in 100 ft increments. */
  altitudeStep: 100,
  speedMin: 100,
  speedMax: 350,
} as const;

export interface ValidationError {
  message: string;
}

/**
 * Validate a structured command against the operating envelope.
 * Returns `null` when valid, or a {@link ValidationError} describing the problem.
 */
export function validateCommand(cmd: Command): ValidationError | null {
  switch (cmd.kind) {
    case "heading": {
      if (!Number.isFinite(cmd.heading) || cmd.heading < LIMITS.headingMin || cmd.heading > LIMITS.headingMax) {
        return { message: `heading must be ${LIMITS.headingMin}-${LIMITS.headingMax}` };
      }
      return null;
    }
    case "altitude": {
      if (cmd.altitude < LIMITS.altitudeMin || cmd.altitude > LIMITS.altitudeMax) {
        return { message: `altitude must be ${LIMITS.altitudeMin}-${LIMITS.altitudeMax} ft` };
      }
      if (cmd.altitude % LIMITS.altitudeStep !== 0) {
        return { message: `altitude must be a multiple of ${LIMITS.altitudeStep} ft` };
      }
      return null;
    }
    case "speed": {
      if (cmd.speed < LIMITS.speedMin || cmd.speed > LIMITS.speedMax) {
        return { message: `speed must be ${LIMITS.speedMin}-${LIMITS.speedMax} kt` };
      }
      return null;
    }
    case "contact": {
      if (!HANDOFF_POSITIONS.includes(cmd.position as (typeof HANDOFF_POSITIONS)[number])) {
        return { message: `unknown handoff position: ${cmd.position}` };
      }
      if (cmd.frequency !== null && !FREQUENCY_RE.test(cmd.frequency)) {
        return { message: `invalid frequency: ${cmd.frequency}` };
      }
      return null;
    }
    case "squawk": {
      if (!SQUAWK_RE.test(cmd.code)) {
        return { message: `invalid squawk (must be 4 octal digits 0-7): ${cmd.code}` };
      }
      return null;
    }
    case "approach":
      // The runway (if given) is validated against the airport by the engine.
      return null;
  }
}
