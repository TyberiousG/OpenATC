import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Minimal .env loader (repo root), dependency-free. Existing env vars win. */
function loadEnvFile(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1]! in process.env)) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "").trim();
    }
  }
}
loadEnvFile();

export const config = {
  port: Number(process.env.PORT ?? 8080),
  airportIcao: process.env.AIRPORT ?? "KHOU",
  trafficSeed: Number(process.env.TRAFFIC_SEED ?? 42),
  trafficCount: Number(process.env.TRAFFIC_COUNT ?? 6),
  /** Simulation integration step, seconds. */
  tickDt: Number(process.env.TICK_DT ?? 0.1),
  /** How often state is broadcast to clients, milliseconds. */
  broadcastMs: Number(process.env.BROADCAST_MS ?? 200),
  /** Pilot-initiated calls are spaced by a random delay in this range (ms). */
  pilotRequestMinMs: Number(process.env.PILOT_REQUEST_MIN_MS ?? 35000),
  pilotRequestMaxMs: Number(process.env.PILOT_REQUEST_MAX_MS ?? 80000),
  /** An aircraft won't make another call within this window (ms). */
  pilotRequestCooldownMs: Number(process.env.PILOT_REQUEST_COOLDOWN_MS ?? 150000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** Deepgram API key for server-side speech-to-text (optional). */
  deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? "",
  deepgramModel: process.env.DEEPGRAM_MODEL ?? "nova-2",
};
