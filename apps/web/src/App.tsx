import { useCallback, useEffect, useRef, useState } from "react";
import type { AircraftSnapshot } from "@openatc/shared";
import { useSimSocket } from "./useSimSocket.js";
import { useSpeechRecognition } from "./useSpeechRecognition.js";
import { useServerStt } from "./useServerStt.js";
import { useTts } from "./useTts.js";
import { useServerTts } from "./useServerTts.js";
import { RadarScope } from "./RadarScope.js";
import { GroundMap } from "./GroundMap.js";
import { CommandInput } from "./CommandInput.js";
import { PttControl } from "./PttControl.js";
import { FrequencySelector } from "./FrequencySelector.js";
import { AdminPanel } from "./AdminPanel.js";

export function App() {
  // Speaking is routed through a ref so the socket's onVoice can reach whichever
  // TTS backend we settle on below (server-side Deepgram or the browser).
  const speakRef = useRef<(text: string, voiceKey: string, opts?: { skipIfBusy?: boolean }) => void>(() => {});
  const [position, setPosition] = useState("APP");
  const { connected, airport, aircraft, simTime, log, serverStt, serverTts, stats, session, sendCommand, sendMessage, clearLog, pushSystem } =
    useSimSocket({
      onVoice: (voiceKey, text, kind) => speakRef.current(text, voiceKey, { skipIfBusy: kind === "pilot" }),
      activePosition: position,
    });
  const [adminOpen, setAdminOpen] = useState(false);

  // Announce the position we're working to the shared session.
  useEffect(() => {
    if (connected) sendMessage({ type: "set_position", position });
  }, [connected, position, sendMessage]);
  const browserTts = useTts();
  const serverTtsHandle = useServerTts(serverTts);
  const tts = serverTtsHandle.supported ? serverTtsHandle : browserTts;
  speakRef.current = tts.speak;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Default to the airport's first published position once it arrives.
  useEffect(() => {
    if (airport && airport.positions.length > 0 && !airport.positions.some((p) => p.id === position)) {
      setPosition(airport.positions[0]!.id);
    }
  }, [airport, position]);

  const submit = useCallback(
    (text?: string) => {
      const value = (text ?? command).trim();
      if (!value) return;
      sendCommand(value);
      setCommand("");
    },
    [command, sendCommand],
  );

  // Voice: shared handlers, with two interchangeable STT backends. Server-side
  // Deepgram is preferred when available; the browser Web Speech API is the
  // fallback. The transcript feeds the same command path either way.
  const onFinal = (t: string) => {
    pushSystem("system", `🎤 heard: "${t}"`);
    submit(t);
  };
  const onStatus = (s: "listening" | "stopped") =>
    pushSystem("system", s === "listening" ? "🎤 listening…" : "🎤 stopped");
  const onError = (msg: string) => pushSystem("error", `voice: ${msg}`);

  const browserStt = useSpeechRecognition({ onInterim: (t) => setCommand(t), onFinal, onStatus, onError });
  const serverSttHandle = useServerStt({
    onFinal,
    onStatus,
    onError,
    onLatency: (i) =>
      pushSystem("system", `⏱ STT ${Math.round(i.total)}ms (rec ${Math.round(i.rec)} · net ${Math.round(i.net)})`),
    enabled: serverStt,
  });
  const speech = serverSttHandle.supported ? serverSttHandle : browserStt;

  const selectAircraft = (ac: AircraftSnapshot) => {
    setSelectedId(ac.id);
    setCommand(ac.spoken + " ");
    inputRef.current?.focus();
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">OpenATC</span>
        <span>{airport ? `${airport.name} (${airport.icao}) — Approach/Final` : "connecting…"}</span>
        <span className={connected ? "status ok" : "status bad"}>{connected ? "ONLINE" : "OFFLINE"}</span>
        {airport && (
          <FrequencySelector positions={airport.positions} active={position} onChange={setPosition} />
        )}
        {tts.supported && (
          <button
            type="button"
            className={tts.enabled ? "tts-toggle on" : "tts-toggle"}
            onClick={() => tts.setEnabled(!tts.enabled)}
            title="Toggle pilot voice (text-to-speech)"
          >
            {tts.enabled ? "🔊 Voice" : "🔇 Muted"}
          </button>
        )}
        <span className="clock">T+{simTime.toFixed(0)}s</span>
        <span>{aircraft.length} tracks</span>
        <span className="stat ok" title="Landings">✓ {stats.landings}</span>
        <span className="stat ok" title="Departures">↑ {stats.departures}</span>
        <span className={stats.violations > 0 ? "stat bad" : "stat"} title="Separation violations">
          ⚠ {stats.violations}
        </span>
        {session.paused && <span className="stat bad">⏸ PAUSED</span>}
        <button type="button" className="admin-btn" onClick={() => setAdminOpen(true)} title="Admin console">
          ⚙
        </button>
      </header>

      <main className="main">
        <section className="scope-wrap">
          {airport &&
            (position === "GND" ? (
              <GroundMap airport={airport} aircraft={aircraft} />
            ) : (
              <RadarScope
                airport={airport}
                aircraft={aircraft}
                selectedId={selectedId}
                activePosition={position}
                onSelect={selectAircraft}
              />
            ))}
        </section>

        <aside className="sidebar">
          <h2>Traffic</h2>
          <ul className="track-list">
            {[...aircraft]
              .sort((a, b) => a.callsign.localeCompare(b.callsign))
              .map((ac) => (
                <li
                  key={ac.id}
                  className={
                    (ac.id === selectedId ? "selected " : "") +
                    (ac.controller === position ? "" : "off-freq")
                  }
                  onClick={() => selectAircraft(ac)}
                >
                  <span className="cs">{ac.callsign}</span>
                  <span className={`obj obj-${ac.intentKind}`}>
                    {ac.approachEstablished
                      ? `▼ILS ${ac.approachRunway}`
                      : ac.approachRunway
                        ? `(c)${ac.approachRunway}`
                        : ac.intentKind === "arrival"
                          ? `ARR ${ac.runway ?? ""}`
                          : ac.intentKind === "departure"
                            ? "DEP"
                            : "OVF"}
                  </span>
                  <span>{Math.round(ac.altitude)}ft</span>
                  <span>{Math.round(ac.speed)}kt</span>
                </li>
              ))}
          </ul>

          <h2>Transmissions</h2>
          <ul className="log">
            {log.map((line) => (
              <li key={line.id} className={`log-${line.kind}`}>
                {line.text}
              </li>
            ))}
          </ul>
        </aside>
      </main>

      <footer className="bottom">
        <CommandInput ref={inputRef} value={command} onChange={setCommand} onSubmit={() => submit()}>
          <PttControl
            supported={speech.supported}
            listening={speech.listening}
            onStart={speech.start}
            onStop={speech.stop}
          />
        </CommandInput>
      </footer>

      {adminOpen && (
        <AdminPanel
          session={session}
          stats={stats}
          onAdmin={(action) => sendMessage({ type: "admin", action })}
          onClearLog={clearLog}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
  );
}
