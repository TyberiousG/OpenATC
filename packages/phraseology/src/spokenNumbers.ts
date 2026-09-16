/**
 * Normalize spoken number words into the digit forms the parser expects.
 *
 * Speech-to-text produces phrases like "heading two four zero, descend and
 * maintain four thousand". This converts those runs of number words into
 * "heading 240, descend and maintain 4000" deterministically, so the same
 * strict parser handles both typed and spoken input.
 *
 * Two rules, matching how controllers actually speak:
 *   - A run containing a scale word ("hundred"/"thousand") is read as a
 *     cardinal number: "four thousand" → 4000, "eleven thousand" → 11000.
 *   - A run of plain digit/tens/teens words is *concatenated*, which is how
 *     headings, speeds and flight levels are spoken: "two four zero" → 240,
 *     "two forty" → 240, "one eighty" → 180.
 */

type Tok =
  | { type: "num"; digits: string; value: number }
  | { type: "scale"; value: number }
  | { type: "word"; text: string };

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, niner: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };

/** Every word the normalizer treats as part of a number, for context checks. */
export const NUMBER_WORDS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(UNITS),
  ...Object.keys(TEENS),
  ...Object.keys(TENS),
  ...Object.keys(SCALES),
]);

function classify(word: string): Tok {
  if (word in UNITS) return { type: "num", digits: String(UNITS[word]), value: UNITS[word]! };
  if (word in TEENS) return { type: "num", digits: String(TEENS[word]), value: TEENS[word]! };
  if (word in TENS) return { type: "num", digits: String(TENS[word]), value: TENS[word]! };
  if (word in SCALES) return { type: "scale", value: SCALES[word]! };
  // Bare numerals (e.g. STT "numerals" mode emits "8 6 7" / "0 4 0"): treat as
  // digit tokens so a run concatenates into a single number.
  if (/^\d+$/.test(word)) return { type: "num", digits: word, value: parseInt(word, 10) };
  return { type: "word", text: word };
}

/** Read a run of numeric tokens that includes at least one scale word. */
function cardinal(run: Tok[]): number {
  let total = 0;
  let current = 0;
  for (const t of run) {
    if (t.type === "num") current += t.value;
    else if (t.type === "scale") {
      if (t.value === 100) current *= 100;
      else {
        total += current * 1000;
        current = 0;
      }
    }
  }
  return total + current;
}

export function normalizeSpokenNumbers(input: string): string {
  const words = input.split(/\s+/);
  const out: string[] = [];
  let run: Tok[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const hasScale = run.some((t) => t.type === "scale");
    if (hasScale) {
      out.push(String(cardinal(run)));
    } else {
      out.push(run.map((t) => (t.type === "num" ? t.digits : "")).join(""));
    }
    run = [];
  };

  for (const w of words) {
    const tok = classify(w.toLowerCase());
    if (tok.type === "word") {
      flush();
      out.push(w);
    } else {
      run.push(tok);
    }
  }
  flush();

  return out.join(" ");
}
