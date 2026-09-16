import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side text-to-speech for pilot transmissions (the `pilot response →
 * TTS` stage). Uses the browser SpeechSynthesis API. Each callsign gets a
 * stable, slightly different voice/pitch/rate so pilots sound like distinct
 * people. This is the concrete TtsProvider for the vertical slice; the
 * `@openatc/voice` TtsProvider interface remains the seam for server-side
 * providers later.
 */
export interface TtsHandle {
  supported: boolean;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  speak: (text: string, voiceKey: string, opts?: { skipIfBusy?: boolean }) => void;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function useTts(): TtsHandle {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [enabled, setEnabled] = useState(true);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [supported]);

  const speak = useCallback(
    (text: string, voiceKey: string, opts?: { skipIfBusy?: boolean }) => {
      if (!supported || !enabled || !text) return;
      // Avoid pileup: pilot chatter is dropped rather than queued when the
      // frequency is already "busy" (something else is being spoken).
      if (opts?.skipIfBusy && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) return;
      const u = new SpeechSynthesisUtterance(text);
      const h = hash(voiceKey);
      const voices = voicesRef.current;
      if (voices.length > 0) u.voice = voices[h % voices.length]!;
      u.pitch = 0.85 + (h % 30) / 100; // 0.85 – 1.14
      u.rate = 0.95 + ((h >> 5) % 20) / 100; // 0.95 – 1.14
      window.speechSynthesis.speak(u);
    },
    [supported, enabled],
  );

  return { supported, enabled, setEnabled, speak };
}
