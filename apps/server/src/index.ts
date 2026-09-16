import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getAirport } from "@openatc/airport-data";
import { SimEngine, generateTraffic, generateAircraft, pickFlightKind, mulberry32 } from "@openatc/sim-engine";
import { parseCommand, AIRLINES } from "@openatc/phraseology";
import { createDeepgramStt, createDeepgramTts, isAuraVoice } from "@openatc/voice";
import type { ClientMessage, ServerMessage } from "@openatc/shared";
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

  wss.on("connection", (ws) => {
    send(ws, { type: "welcome", airport: airportInfo, tickRate: 1 / config.tickDt, serverStt: !!stt, serverTts: !!tts });
    send(ws, { type: "state", time: engine.time, aircraft: engine.list().map((ac) => toSnapshot(engine, ac)) });

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== "command") return;
      handleCommand(ws, msg.text);
    });
  });

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

  const reapAndSpawn = () => {
    for (const done of engine.reap()) {
      usedCallsigns.delete(done.aircraft.callsign);
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
      engine.add(generateAircraft(airport, spawnRng, pickFlightKind(spawnRng), usedCallsigns));
    }
  };

  const tickMs = config.tickDt * 1000;
  const simTimer = setInterval(() => engine.tick(config.tickDt), tickMs);
  const broadcastTimer = setInterval(() => {
    reapAndSpawn();
    broadcast({ type: "state", time: engine.time, aircraft: engine.list().map((ac) => toSnapshot(engine, ac)) });
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
