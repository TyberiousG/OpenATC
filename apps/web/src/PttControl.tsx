import { useEffect, useState } from "react";

interface Props {
  supported: boolean;
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

function keyLabel(code: string): string {
  if (code === "Backquote") return "`";
  if (code === "Space") return "Space";
  return code.replace(/^Key|^Digit/, "");
}

/**
 * Push-to-talk: hold the on-screen button or a configurable hotkey to speak.
 * Releasing ends the utterance, which is transcribed and submitted. The hotkey
 * is ignored while a text field is focused so it never fights with typing.
 */
export function PttControl({ supported, listening, onStart, onStop }: Props) {
  const [pttKey, setPttKey] = useState(() => localStorage.getItem("openatc.pttKey") ?? "Backquote");
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!supported) return;

    const down = (e: KeyboardEvent) => {
      if (capturing) {
        e.preventDefault();
        setPttKey(e.code);
        localStorage.setItem("openatc.pttKey", e.code);
        setCapturing(false);
        return;
      }
      if (e.code === pttKey && !e.repeat && !isEditableTarget(e.target)) {
        e.preventDefault();
        onStart();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === pttKey && !isEditableTarget(e.target)) {
        e.preventDefault();
        onStop();
      }
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [pttKey, capturing, supported, onStart, onStop]);

  if (!supported) {
    return <span className="ptt unsupported" title="Web Speech API not available in this browser">🎤 n/a</span>;
  }

  return (
    <div className="ptt-wrap">
      <button
        type="button"
        className={listening ? "ptt listening" : "ptt"}
        onClick={() => (listening ? onStop() : onStart())}
        title={`Click to talk, click again to send. Or hold the ${keyLabel(pttKey)} key.`}
      >
        {listening ? "● REC — click to send" : "🎤 PTT"}
      </button>
      <button
        type="button"
        className="ptt-key"
        onClick={() => setCapturing(true)}
        title="Click, then press a key to rebind push-to-talk"
      >
        {capturing ? "press a key…" : `key: ${keyLabel(pttKey)}`}
      </button>
    </div>
  );
}
