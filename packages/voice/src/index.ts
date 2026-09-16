import type { ParseResult } from "@openatc/phraseology";

/**
 * Voice & AI provider interfaces.
 *
 * These describe the *future* push-to-talk pipeline:
 *
 *   mic audio → STT → phraseology parser → simulation → readback → TTS
 *
 * They are intentionally thin and provider-agnostic. Crucially, none of these
 * providers is authoritative over simulation state — the deterministic
 * phraseology parser and engine remain the sole source of truth. The optional
 * LLM fallback may only *suggest* a normalized transcript when the strict
 * parser fails; its output must still pass through the same parser/validator.
 */

export interface SttOptions {
  sampleRate?: number;
  /** MIME type of the audio payload (e.g. "audio/webm"). */
  mimeType?: string;
  /** Domain vocabulary to bias recognition toward (callsigns, ATC terms). */
  keywords?: string[];
}

/** Speech-to-text. Converts controller push-to-talk audio into a transcript. */
export interface SttProvider {
  readonly name: string;
  transcribe(audio: ArrayBuffer | Uint8Array, opts?: SttOptions): Promise<{ text: string; confidence?: number }>;
}

/** Text-to-speech. Renders a pilot readback into audio for playback. */
export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, opts?: { voice?: string }): Promise<{ audio: ArrayBuffer; mimeType: string }>;
}

/**
 * Optional LLM fallback used ONLY to normalize a messy transcript into
 * canonical phraseology when the deterministic parser fails. It never issues
 * commands and never mutates state; its suggestion is re-parsed and re-validated.
 */
export interface LlmFallbackProvider {
  readonly name: string;
  /** Return a canonical-phraseology candidate, or null if it cannot help. */
  normalize(transcript: string, context: { callsigns: string[] }): Promise<string | null>;
}

/** A parser function, injected so `voice` never depends on engine internals. */
export type ParseFn = (input: string) => ParseResult;

/**
 * Resolve a transcript to a parse result, trying the strict parser first and
 * only then the optional LLM normalization. The final result always comes
 * from the deterministic parser — the LLM cannot bypass validation.
 */
export async function resolveTranscript(
  transcript: string,
  parse: ParseFn,
  opts?: { llm?: LlmFallbackProvider; callsigns?: string[] },
): Promise<ParseResult> {
  const strict = parse(transcript);
  if (strict.ok || !opts?.llm) return strict;

  const suggestion = await opts.llm.normalize(transcript, { callsigns: opts.callsigns ?? [] });
  if (!suggestion) return strict;
  return parse(suggestion);
}

/** A no-op TTS/STT set useful for tests and text-only mode. */
export const NullStt: SttProvider = {
  name: "null",
  async transcribe() {
    return { text: "" };
  },
};

export {
  createDeepgramStt,
  createDeepgramTts,
  AURA_VOICES,
  isAuraVoice,
  type DeepgramConfig,
} from "./deepgram.js";

export const NullTts: TtsProvider = {
  name: "null",
  async synthesize() {
    return { audio: new ArrayBuffer(0), mimeType: "audio/none" };
  },
};
