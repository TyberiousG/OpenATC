import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechRecognitionHandle } from "./useSpeechRecognition.js";
import { STT_URL } from "./useSimSocket.js";

interface Options {
  onFinal: (text: string) => void;
  onStatus?: (status: "listening" | "stopped") => void;
  onError?: (message: string) => void;
  /** Latency breakdown (ms): rec = recorder finalize, net = upload+STT. */
  onLatency?: (info: { total: number; rec: number; net: number }) => void;
  /** Whether the server actually offers STT (from the welcome message). */
  enabled: boolean;
}

/**
 * Push-to-talk backed by server-side STT (Deepgram).
 *
 * The mic stream is opened once and kept warm — opening the device on every
 * press (and tearing it down after) added seconds of latency on Windows. Each
 * press just spins up a MediaRecorder on the live stream, so recording starts
 * instantly and only a short clip is POSTed on release.
 */
export function useServerStt(opts: Options): SpeechRecognitionHandle {
  const supported =
    opts.enabled &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const [listening, setListening] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopAtRef = useRef(0);

  const cb = useRef(opts);
  cb.current = opts;

  // Warm the mic once so the first (and every) transmission starts instantly.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) stream.getTracks().forEach((t) => t.stop());
        else streamRef.current = stream;
      })
      .catch(() => {
        /* acquired lazily on first press instead */
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [supported]);

  const begin = useCallback((stream: MediaStream) => {
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const recStopAt = performance.now();
      recRef.current = null;
      setListening(false);
      cb.current.onStatus?.("stopped");
      void transcribe(
        new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" }),
        cb.current,
        stopAtRef.current,
        recStopAt,
      );
    };
    recRef.current = mr;
    // Timeslice flushes data during recording, so stop() finalizes instantly.
    mr.start(250);
    setListening(true);
    cb.current.onStatus?.("listening");
  }, []);

  const start = useCallback(() => {
    if (recRef.current) return;
    if (streamRef.current) {
      begin(streamRef.current);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        begin(stream);
      })
      .catch((err: Error) => {
        cb.current.onError?.(err.name === "NotAllowedError" ? "microphone permission denied" : err.message);
      });
  }, [begin]);

  const stop = useCallback(() => {
    stopAtRef.current = performance.now();
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }, []);

  return { supported, listening, start, stop };
}

async function transcribe(blob: Blob, cb: Options, stopAt: number, recStopAt: number): Promise<void> {
  if (blob.size < 800) {
    cb.onError?.("no audio captured — hold and speak");
    return;
  }
  try {
    const res = await fetch(STT_URL, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `STT ${res.status}`);
    }
    const { text } = (await res.json()) as { text: string };
    const now = performance.now();
    cb.onLatency?.({ total: now - stopAt, rec: recStopAt - stopAt, net: now - recStopAt });
    if (text && text.trim()) cb.onFinal(text.trim());
    else cb.onError?.("no speech detected");
  } catch (err) {
    cb.onError?.((err as Error).message);
  }
}
