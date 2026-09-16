import { NUMBER_WORDS } from "./spokenNumbers.js";

/**
 * Homophone correction for speech-to-text output.
 *
 * General-purpose STT mishears aviation numbers as common English homophones:
 * "two" → "to"/"too", "four" → "for"/"fore", "eight" → "ate", "nine" →
 * "niner", "three" → "tree". This repairs them *before* number normalization.
 *
 * The hard part is ambiguity: "to"/"for" are also real prepositions
 * ("descend TO 4000", "cleared FOR approach"). We only rewrite an ambiguous
 * homophone when it sits in a numeric context — the previous token is already
 * a number, or the next token is a number and the previous token is not a
 * command word that legitimately takes a preposition ("descend", "speed", …).
 * True prepositions are left alone and the parser tolerates them.
 */

/** Always safe — these are aviation phonetics with no ordinary meaning. */
const ALWAYS: Record<string, string> = {
  niner: "nine",
  tree: "three",
  fife: "five",
};

/**
 * Aviation term mistranscriptions from general-purpose STT that have no
 * legitimate ATC meaning of their own, so they are always corrected.
 * "iOS"/"isles" → "ILS" is the classic one.
 */
const TERMS: Record<string, string> = {
  ios: "ils",
  isles: "ils",
  aisles: "ils",
  "i.l.s": "ils",
};

/** Ambiguous with real words — only applied inside a number context. */
const AMBIGUOUS: Record<string, string> = {
  to: "two",
  too: "two",
  for: "four",
  fore: "four",
  ate: "eight",
  won: "one",
  oh: "zero",
};

/**
 * Command words that legitimately take a following preposition, so a "to"/"for"
 * right after one is kept as a preposition, not rewritten to a digit.
 */
const PREPOSITION_ANCHORS = new Set<string>([
  "turn", "fly", "climb", "descend", "maintain", "reduce", "increase",
  "speed", "cleared", "direct", "contact", "expedite", "and", "at", "of", "the", "level",
]);

/** Broad check for the *previous* token — is a number run already underway? */
function continuesNumber(token: string | undefined): boolean {
  if (!token) return false;
  return /^\d+$/.test(token) || NUMBER_WORDS.has(token) || token in AMBIGUOUS;
}

/**
 * Narrow check for the *next* token. A spoken number word ("four") or single
 * digit means we're mid digit-group, so a leading "to"/"for" is really a digit.
 * A complete multi-digit numeral ("090", "4000") means the homophone before it
 * is a genuine preposition ("descend to 4000", "fly heading to 090").
 */
function startsSpokenNumber(token: string | undefined): boolean {
  if (!token) return false;
  return NUMBER_WORDS.has(token) || token in AMBIGUOUS || /^\d$/.test(token);
}

export function correctHomophones(input: string): string {
  const words = input.split(/\s+/).filter(Boolean);
  const lower = words.map((w) => w.toLowerCase());

  return words
    .map((word, i) => {
      const lw = lower[i]!;
      if (lw in TERMS) return TERMS[lw];
      if (lw in ALWAYS) return ALWAYS[lw];
      if (lw in AMBIGUOUS) {
        const prev = lower[i - 1];
        const next = lower[i + 1];
        const prevIsAnchor = prev !== undefined && PREPOSITION_ANCHORS.has(prev);
        if (continuesNumber(prev) || (startsSpokenNumber(next) && !prevIsAnchor)) {
          return AMBIGUOUS[lw];
        }
        return word; // genuine preposition — leave it
      }
      return word;
    })
    .join(" ");
}
