import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { getAirport } from "@openatc/airport-data";
import {
  SimEngine,
  generateTraffic,
  generateSpacedAircraft,
  pickFlightKind,
  mulberry32,
  alertLevels,
  conflictKey,
} from "@openatc/sim-engine";
import { parseCommand, AIRLINES, spokenCallsign } from "@openatc/phraseology";
import { createDeepgramStt, createDeepgramTts, isAuraVoice } from "@openatc/voice";
import type { ClientMessage, ServerMessage, AdminAction } from "@openatc/shared";
import { config } from "./config.js";
import { createPersistence } from "./db.js";
import { toAirportInfo, toSnapshot } from "./mapping.js";
import { makePilotRequest } from "./pilotRequests.js";
import { readBody, sttKeywords } from "./stt.js";

async function main(): Promise<void> {
  const airport = getAirport(config.airportIcao);
  if (!airport) throw new Error(`unknown airport: ${config.airportIcao}`);

  const engine = new SimEngine(airport);
  for (const ac of generateTraffic(airport, config.trafficSeed, config.trafficCount)) {
    engine.add(ac);
  }

  const persistence = await createPersistence();
  const airportInfo = toAirportInfo(airport);

  const stt = config.deepgramApiKey
    ? createDeepgramStt({ apiKey: config.deepgramApiKey, model: config.deepgramModel })
    : null;
  const tts = config.deepgramApiKey ? createDeepgramTts({ apiKey: config.deepgramApiKey }) : null;
  console.log(`[voice] ${stt ? "Deepgram STT+TTS enabled" : "no server voice (browser only)"}`);

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  } as const;

  const httpServer = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: true, sim: engine.time, aircraft: engine.list().length, stt: !!stt }));
      return;
    }
    // Push-to-talk audio → server-side STT. The API key stays here.
    if (req.method === "POST" && (req.url ?? "").startsWith("/stt")) {
      if (!stt) {
        res.writeHead(503, { "content-type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "server STT not configured" }));
        return;
      }
      void (async () => {
        try {
          const audio = await readBody(req);
          const keywords = sttKeywords(engine.list(), AIRLINES);
          const { text, confidence } = await stt.transcribe(audio, {
            mimeType: req.headers["content-type"] ?? "audio/webm",
            keywords,
          });
          res.writeHead(200, { "content-type": "application/json", ...cors });
          res.end(JSON.stringify({ text, confidence }));
        } catch (err) {
          console.warn("[stt] error:", (err as Error).message);
          res.writeHead(502, { "content-type": "application/json", ...cors });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      })();
      return;
    }
    // Pilot readback text → synthesized audio (Deepgram Aura).
    if (req.method === "POST" && (req.url ?? "").startsWith("/tts")) {
      if (!tts) {
        res.writeHead(503, { "content-type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "server TTS not configured" }));
        return;
      }
      void (async () => {
        try {
          const body = JSON.parse((await readBody(req)).toString()) as { text?: string; voice?: string };
          if (!body.text) {
            res.writeHead(400, { "content-type": "application/json", ...cors });
            res.end(JSON.stringify({ error: "missing text" }));
            return;
          }
          const voice = body.voice && isAuraVoice(body.voice) ? body.voice : undefined;
          const { audio, mimeType } = await tts.synthesize(body.text.slice(0, 400), { voice });
          res.writeHead(200, { "content-type": mimeType, ...cors });
          res.end(Buffer.from(audio));
        } catch (err) {
          console.warn("[tts] error:", (err as Error).message);
          res.writeHead(502, { "content-type": "application/json", ...cors });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      })();
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  function send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  // Session scoring / operational counters.
  const stats = { landings: 0, departures: 0, violations: 0, activeAlerts: 0 };

  // Multiplayer session: who is connected and which position they work.
  const sessions = new Map<WebSocket, { id: string; position: string | null }>();
  let paused = false;

  function broadcastSession(): void {
    broadcast({
      type: "session",
      session: {
        controllers: [...sessions.values()].map((s) => ({ id: s.id, position: s.position })),
        paused,
        trafficCount: config.trafficCount,
      },
    });
  }

  wss.on("connection", (ws) => {
    sessions.set(ws, { id: randomUUID().slice(0, 8), position: null });
    send(ws, { type: "welcome", airport: airportInfo, tickRate: 1 / config.tickDt, serverStt: !!stt, serverTts: !!tts });
    send(ws, { type: "state", time: engine.time, aircraft: engine.list().map((ac) => toSnapshot(engine, ac)), stats });
    broadcastSession();

    ws.on("close", () => {
      sessions.delete(ws);
      broadcastSession();
    });

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "command") handleCommand(ws, msg.text);
      else if (msg.type === "set_position") {
        const s = sessions.get(ws);
        if (s) {
          s.position = msg.position;
          broadcastSession();
        }
      } else if (msg.type === "admin") {
        handleAdmin(msg.action);
      }
    });
  });

  function handleAdmin(action: AdminAction): void {
    switch (action.kind) {
      case "reset":
        resetSim();
        broadcast({ type: "state", time: engine.time, aircraft: engine.list().map((ac) => toSnapshot(engine, ac)), stats });
        break;
      case "pause":
        paused = true;
        break;
      case "resume":
        paused = false;
        break;
      case "set_traffic":
        config.trafficCount = Math.max(0, Math.min(30, Math.round(action.count)));
        break;
      case "reset_stats":
        Object.assign(stats, { landings: 0, departures: 0, violations: 0, activeAlerts: 0 });
        break;
    }
    broadcastSession();
  }

  function resetSim(): void {
    engine.clear();
    usedCallsigns.clear();
    knownConflicts.clear();
    lastCall.clear();
    Object.assign(stats, { landings: 0, departures: 0, violations: 0, activeAlerts: 0 });
    for (const ac of generateTraffic(engine.airport, (Date.now() & 0xffff) + 1, config.trafficCount)) {
      engine.add(ac);
      usedCallsigns.add(ac.callsign);
    }
  }

  function handleCommand(ws: WebSocket, text: string): void {
    const parsed = parseCommand(text);
    if (!parsed.ok) {
      send(ws, { type: "command_error", input: text, error: parsed.error, ok: false });
      void persistence.recordCommand({
        simTime: engine.time,
        input: text,
        ok: false,
        callsign: null,
        detail: parsed.error,
      });
      return;
    }

    // The readback belongs to the frequency the aircraft is on *now* — before a
    // handoff moves it — so the issuing controller hears the acknowledgement.
    const readbackPosition = engine.findByCallsign(parsed.callsign)?.controller ?? "APP";

    // Apply every command; the engine remains the sole authority over state.
    let applyError: string | null = null;
    for (const cmd of parsed.commands) {
      const res = engine.applyCommandToCallsign(parsed.callsign, cmd);
      if (!res.ok) {
        applyError = res.error ?? "command rejected";
        break;
      }
    }

    if (applyError) {
      send(ws, { type: "command_error", input: text, error: applyError, ok: false });
    } else {
      broadcast({ type: "readback", callsign: parsed.callsign, text: parsed.readback, position: readbackPosition, ok: true });
    }

    void persistence.recordCommand({
      simTime: engine.time,
      input: text,
      ok: !applyError,
      callsign: parsed.callsign,
      detail: applyError ?? parsed.readback,
    });
  }

  // Authoritative simulation loop, decoupled from broadcast cadence.
  // Server-side spawner for maintaining a steady flow of new objectives.
  const spawnRng = mulberry32(config.trafficSeed + 7919);
  const usedCallsigns = new Set(engine.list().map((ac) => ac.callsign));

  // Conflict pairs already announced, so we alert once per new conflict.
  const knownConflicts = new Set<string>();

  const reapAndSpawn = () => {
    for (const done of engine.reap()) {
      usedCallsigns.delete(done.aircraft.callsign);
      if (done.outcome === "landed") stats.landings++;
      else if (done.outcome === "departed") stats.departures++;
      broadcast({
        type: "flight_complete",
        callsign: done.aircraft.callsign,
        spoken: done.aircraft.spoken,
        outcome: done.outcome,
        runway: done.runway ?? null,
        position: done.aircraft.controller,
      });
    }
    while (engine.list().length < config.trafficCount) {
      engine.add(generateSpacedAircraft(airport, spawnRng, pickFlightKind(spawnRng), usedCallsigns, engine.list()));
    }
  };

  const tickMs = config.tickDt * 1000;
  const simTimer = setInterval(() => {
    if (!paused) engine.tick(config.tickDt);
  }, tickMs);
  const broadcastTimer = setInterval(() => {
    if (!paused) reapAndSpawn();

    const conflicts = engine.conflicts();
    const alerts = alertLevels(conflicts);
    stats.activeAlerts = alerts.size;

    // Announce each newly-formed conflict once; count new violations.
    const live = new Set<string>();
    for (const c of conflicts) {
      const key = conflictKey(c);
      live.add(key);
      if (!knownConflicts.has(key)) {
        knownConflicts.add(key);
        if (c.severity === "violation") stats.violations++;
        const verb = c.severity === "violation" ? "LOSS OF SEPARATION" : "conflict alert";
        broadcast({
          type: "conflict_alert",
          a: c.a,
          b: c.b,
          severity: c.severity,
          text: `${verb}: ${spokenCallsign(c.a)} and ${spokenCallsign(c.b)}`,
        });
      }
    }
    for (const key of knownConflicts) if (!live.has(key)) knownConflicts.delete(key);

    broadcast({
      type: "state",
      time: engine.time,
      aircraft: engine.list().map((ac) => toSnapshot(engine, ac, alerts.get(ac.id) ?? "none")),
      stats,
    });
  }, config.broadcastMs);

  // Occasional pilot-initiated radio calls. Self-scheduling with a random gap
  // so it never sounds like a metronome, one aircraft at a time, and each
  // aircraft respects a cooldown so no one hogs the frequency.
  const lastCall = new Map<string, number>();
  let pilotTimer: NodeJS.Timeout;

  const emitPilotRequest = () => {
    if (wss.clients.size > 0) {
      const now = Date.now();
      // Any active aircraft may call in on its own frequency; the client only
      // surfaces those on the controller's selected position. Each obeys a
      // per-aircraft cooldown so no one hogs the frequency.
      const eligible = engine
        .list()
        .filter((ac) => now - (lastCall.get(ac.id) ?? 0) > config.pilotRequestCooldownMs);
      if (eligible.length > 0) {
        const ac = eligible[Math.floor(Math.random() * eligible.length)]!;
        lastCall.set(ac.id, now);
        const req = makePilotRequest(airport, ac);
        broadcast({ type: "pilot_request", callsign: req.callsign, spoken: req.spoken, text: req.text, position: ac.controller });
      }
    }
    const { pilotRequestMinMs: min, pilotRequestMaxMs: max } = config;
    pilotTimer = setTimeout(emitPilotRequest, min + Math.random() * (max - min));
  };
  pilotTimer = setTimeout(emitPilotRequest, config.pilotRequestMinMs);

  httpServer.listen(config.port, () => {
    console.log(`[server] OpenATC on :${config.port} — airport ${airport.icao}, ${config.trafficCount} aircraft`);
  });

  const shutdown = async () => {
    clearInterval(simTimer);
    clearInterval(broadcastTimer);
    clearTimeout(pilotTimer);
    await persistence.close();
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
