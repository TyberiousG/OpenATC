import { useEffect, useRef, useState, useCallback } from "react";
import type {
  AircraftSnapshot,
  AirportInfoDTO,
  ServerMessage,
  ClientMessage,
  SessionStats,
  SessionInfo,
} from "@openatc/shared";

const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${location.hostname}:8080`;
/** HTTP base derived from the WS URL, used for the STT/TTS endpoints. */
const HTTP_BASE = WS_URL.replace(/^ws/, "http");
export const STT_URL = HTTP_BASE + "/stt";
export const TTS_URL = HTTP_BASE + "/tts";

export interface TransmissionLine {
  id: number;
  kind: "readback" | "error" | "system" | "pilot" | "alert";
  text: string;
}

export interface SimSocketOptions {
  /** Called for spoken pilot transmissions (readbacks, requests) for TTS. */
  onVoice?: (voiceKey: string, text: string, kind: "readback" | "pilot") => void;
  /** The controller's selected position; only its transmissions are surfaced. */
  activePosition?: string;
}

export interface SimState {
  connected: boolean;
  airport: AirportInfoDTO | null;
  aircraft: AircraftSnapshot[];
  simTime: number;
  log: TransmissionLine[];
  /** True when the server offers Deepgram STT / TTS. */
  serverStt: boolean;
  serverTts: boolean;
  stats: SessionStats;
  session: SessionInfo;
  sendCommand: (text: string) => void;
  sendMessage: (msg: ClientMessage) => void;
  clearLog: () => void;
  /** Inject a local (client-side) line into the transmissions log. */
  pushSystem: (kind: TransmissionLine["kind"], text: string) => void;
}

/**
 * Subscribes to the authoritative server over WebSocket. The client is a pure
 * renderer/sender: it holds no simulation logic and treats server state as
 * ground truth, reconnecting automatically if the socket drops.
 */
export function useSimSocket(options: SimSocketOptions = {}): SimState {
  const [connected, setConnected] = useState(false);
  const [airport, setAirport] = useState<AirportInfoDTO | null>(null);
  const [aircraft, setAircraft] = useState<AircraftSnapshot[]>([]);
  const [simTime, setSimTime] = useState(0);
  const [log, setLog] = useState<TransmissionLine[]>([]);
  const [serverStt, setServerStt] = useState(false);
  const [serverTts, setServerTts] = useState(false);
  const [stats, setStats] = useState<SessionStats>({ landings: 0, departures: 0, violations: 0, activeAlerts: 0 });
  const [session, setSession] = useState<SessionInfo>({ controllers: [], paused: false, trafficCount: 0 });
  const wsRef = useRef<WebSocket | null>(null);
  const logId = useRef(0);
  const onVoiceRef = useRef(options.onVoice);
  onVoiceRef.current = options.onVoice;
  const positionRef = useRef(options.activePosition);
  positionRef.current = options.activePosition;

  const pushLog = useCallback((kind: TransmissionLine["kind"], text: string) => {
    setLog((prev) => [{ id: logId.current++, kind, text }, ...prev].slice(0, 100));
  }, []);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) reconnectTimer = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        const msg: ServerMessage = JSON.parse(ev.data);
        switch (msg.type) {
          case "welcome":
            setAirport(msg.airport);
            setServerStt(msg.serverStt);
            setServerTts(msg.serverTts);
            pushLog("system", `Connected — ${msg.airport.name} (${msg.airport.icao}) Approach`);
            if (msg.serverStt || msg.serverTts) pushLog("system", "🎙️ Deepgram voice active");
            break;
          case "state":
            setAircraft(msg.aircraft);
            setSimTime(msg.time);
            setStats(msg.stats);
            break;
          case "conflict_alert":
            // Separation is critical — always surfaced, regardless of frequency.
            pushLog("alert", `⚠ ${msg.text}`);
            break;
          case "session":
            setSession(msg.session);
            break;
          case "readback":
            // Only surface transmissions on the controller's selected frequency.
            if (positionRef.current && msg.position !== positionRef.current) break;
            pushLog("readback", msg.text);
            onVoiceRef.current?.(msg.callsign, msg.text, "readback");
            break;
          case "command_error":
            pushLog("error", `${msg.error}  ⟵  "${msg.input}"`);
            break;
          case "pilot_request":
            if (positionRef.current && msg.position !== positionRef.current) break;
            pushLog("pilot", msg.text);
            onVoiceRef.current?.(msg.callsign, msg.text, "pilot");
            break;
          case "flight_complete": {
            if (positionRef.current && msg.position !== positionRef.current) break;
            const spokenCs = msg.spoken;
            const what =
              msg.outcome === "landed"
                ? `landed${msg.runway ? ` runway ${msg.runway}` : ""}`
                : msg.outcome === "departed"
                  ? "departed the airspace"
                  : "left the airspace";
            pushLog("system", `✓ ${spokenCs} ${what}`);
            break;
          }
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [pushLog]);

  const sendMessage = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  const sendCommand = useCallback((text: string) => sendMessage({ type: "command", text }), [sendMessage]);
  const clearLog = useCallback(() => setLog([]), []);

  return {
    connected,
    airport,
    aircraft,
    simTime,
    log,
    serverStt,
    serverTts,
    stats,
    session,
    sendCommand,
    sendMessage,
    clearLog,
    pushSystem: pushLog,
  };
}
