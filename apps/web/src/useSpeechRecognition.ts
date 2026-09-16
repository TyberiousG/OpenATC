import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal typings for the Web Speech API, which the DOM lib does not ship.
 * This is the client-side STT provider for the vertical slice; the server-side
 * `@openatc/voice` SttProvider interface remains the seam for pluggable
 * providers (e.g. Whisper) later.
 */
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly length: number;
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: Event) => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Options {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onStatus?: (status: "listening" | "stopped") => void;
  onError?: (message: string) => void;
  lang?: string;
}

export interface SpeechRecognitionHandle {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
}

export function useSpeechRecognition(opts: Options): SpeechRecognitionHandle {
  const supported = useRef<boolean>(getCtor() !== null).current;
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");

  // Keep callbacks in refs so the recognition instance never needs rebinding.
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    return () => recRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = cb.current.lang ?? "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    transcriptRef.current = "";

    rec.onresult = (e) => {
      let full = "";
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i]![0].transcript;
      }
      transcriptRef.current = full.trim();
      cb.current.onInterim?.(transcriptRef.current);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      cb.current.onStatus?.("stopped");
      const text = transcriptRef.current.trim();
      if (text) cb.current.onFinal(text);
      else cb.current.onError?.("no speech detected — hold and speak, or check the selected microphone");
    };
    rec.onerror = (e) => {
      // Surface the reason; onend still fires afterwards to clean up.
      const err = (e as unknown as { error?: string }).error ?? "speech error";
      cb.current.onError?.(err);
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      cb.current.onStatus?.("listening");
    } catch (err) {
      recRef.current = null;
      cb.current.onError?.((err as Error).message ?? "could not start microphone");
    }
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  return { supported, listening, start, stop };
}
