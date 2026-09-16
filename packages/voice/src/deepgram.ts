import type { SttProvider, SttOptions, TtsProvider } from "./index.js";

export interface DeepgramConfig {
  apiKey: string;
  /** Deepgram model, e.g. "nova-2". */
  model?: string;
}

/**
 * Server-side speech-to-text via Deepgram's pre-recorded API.
 *
 * Unlike the browser Web Speech API, Deepgram accepts keyword biasing, so we
 * boost aviation vocabulary and live callsigns — dramatically reducing classic
 * mishears like "ILS" → "iOS". The API key stays on the server; audio is
 * proxied from the browser and never carries the key.
 *
 * This is a concrete implementation of the {@link SttProvider} seam; it is a
 * transcription source only and never touches simulation state.
 */
export function createDeepgramStt(cfg: DeepgramConfig): SttProvider {
  const model = cfg.model ?? "nova-2";
  return {
    name: "deepgram",
    async transcribe(audio, opts?: SttOptions) {
      const url = new URL("https://api.deepgram.com/v1/listen");
      url.searchParams.set("model", model);
      url.searchParams.set("smart_format", "false");
      url.searchParams.set("punctuate", "false");
      url.searchParams.set("numerals", "true");
      // Boost domain terms so ATC phraseology is recognised over English words.
      for (const kw of opts?.keywords ?? []) url.searchParams.append("keywords", `${kw}:2`);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${cfg.apiKey}`,
          "Content-Type": opts?.mimeType ?? "audio/webm",
        },
        body: audio,
      });
      if (!res.ok) {
        throw new Error(`Deepgram ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      }
      const json = (await res.json()) as {
        results?: { channels?: { alternatives?: { transcript?: string; confidence?: number }[] }[] };
      };
      const alt = json.results?.channels?.[0]?.alternatives?.[0];
      return { text: alt?.transcript ?? "", confidence: alt?.confidence };
    },
  };
}

/** Deepgram Aura voices — assigned per-callsign so pilots sound distinct. */
export const AURA_VOICES = [
  "aura-asteria-en", "aura-luna-en", "aura-stella-en", "aura-athena-en",
  "aura-hera-en", "aura-orion-en", "aura-arcas-en", "aura-perseus-en",
  "aura-angus-en", "aura-orpheus-en", "aura-helios-en", "aura-zeus-en",
] as const;

export function isAuraVoice(v: string): boolean {
  return /^aura-[a-z]+-en$/.test(v);
}

/**
 * Server-side text-to-speech via Deepgram Aura. Renders a pilot readback to
 * audio (MP3). The `voice` option selects an Aura voice; the key stays on the
 * server. Non-authoritative — audio only.
 */
export function createDeepgramTts(cfg: DeepgramConfig): TtsProvider {
  const defaultVoice = cfg.model ?? "aura-asteria-en";
  return {
    name: "deepgram-aura",
    async synthesize(text, opts?: { voice?: string }) {
      const voice = opts?.voice && isAuraVoice(opts.voice) ? opts.voice : defaultVoice;
      const url = new URL("https://api.deepgram.com/v1/speak");
      url.searchParams.set("model", voice);
      url.searchParams.set("encoding", "mp3");
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Token ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        throw new Error(`Deepgram TTS ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      }
      return { audio: await res.arrayBuffer(), mimeType: "audio/mpeg" };
    },
  };
}
