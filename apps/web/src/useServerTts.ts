import { useCallback, useRef, useState } from "react";
import type { TtsHandle } from "./useTts.js";
import { TTS_URL } from "./useSimSocket.js";

/** Deepgram Aura voices, mirrored client-side for per-callsign assignment. */
const AURA_VOICES = [
  "aura-asteria-en", "aura-luna-en", "aura-stella-en", "aura-athena-en",
  "aura-hera-en", "aura-orion-en", "aura-arcas-en", "aura-perseus-en",
  "aura-angus-en", "aura-orpheus-en", "aura-helios-en", "aura-zeus-en",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Text-to-speech backed by the server's Deepgram Aura endpoint. Each callsign
 * maps to a stable Aura voice so pilots sound like distinct people. Same handle
 * shape as {@link useTts} so the browser and server backends are interchangeable.
 */
export function useServerTts(enabledFlag: boolean): TtsHandle {
  const supported = enabledFlag;
  const [enabled, setEnabled] = useState(true);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const busy = useRef(false);

  const speak = useCallback(
    (text: string, voiceKey: string, opts?: { skipIfBusy?: boolean }) => {
      if (!supported || !enabled || !text) return;
      if (opts?.skipIfBusy && busy.current) return;
      const voice = AURA_VOICES[hash(voiceKey) % AURA_VOICES.length]!;
      busy.current = true;
      void fetch(TTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`tts ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          // Interrupt anything still playing so radio calls don't stack.
          currentAudio.current?.pause();
          const audio = new Audio(URL.createObjectURL(blob));
          currentAudio.current = audio;
          const done = () => {
            busy.current = false;
            URL.revokeObjectURL(audio.src);
          };
          audio.onended = done;
          audio.onerror = done;
          void audio.play().catch(done);
        })
        .catch(() => {
          busy.current = false;
        });
    },
    [supported, enabled],
  );

  return { supported, enabled, setEnabled, speak };
}
