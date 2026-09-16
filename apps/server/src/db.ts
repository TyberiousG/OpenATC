import pg from "pg";
import { config } from "./config.js";

/**
 * Optional persistence layer.
 *
 * Postgres is used to log controller commands (and, later, sessions and
 * scenarios). It is intentionally optional: when DATABASE_URL is unset the
 * server runs fully in-memory so the dev vertical slice works without a DB.
 * Persistence never feeds back into the authoritative simulation.
 */
export interface Persistence {
  recordCommand(entry: CommandLog): Promise<void>;
  close(): Promise<void>;
}

export interface CommandLog {
  simTime: number;
  input: string;
  ok: boolean;
  callsign: string | null;
  detail: string;
}

class NoopPersistence implements Persistence {
  async recordCommand(): Promise<void> {}
  async close(): Promise<void> {}
}

class PgPersistence implements Persistence {
  constructor(private readonly pool: pg.Pool) {}

  static async connect(url: string): Promise<PgPersistence> {
    const pool = new pg.Pool({ connectionString: url });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS command_log (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sim_time DOUBLE PRECISION NOT NULL,
        input TEXT NOT NULL,
        ok BOOLEAN NOT NULL,
        callsign TEXT,
        detail TEXT NOT NULL
      );
    `);
    return new PgPersistence(pool);
  }

  async recordCommand(e: CommandLog): Promise<void> {
    await this.pool.query(
      `INSERT INTO command_log (sim_time, input, ok, callsign, detail) VALUES ($1,$2,$3,$4,$5)`,
      [e.simTime, e.input, e.ok, e.callsign, e.detail],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function createPersistence(): Promise<Persistence> {
  if (!config.databaseUrl) {
    console.log("[db] DATABASE_URL not set — running without persistence");
    return new NoopPersistence();
  }
  try {
    const p = await PgPersistence.connect(config.databaseUrl);
    console.log("[db] connected to Postgres");
    return p;
  } catch (err) {
    console.warn("[db] failed to connect, continuing without persistence:", (err as Error).message);
    return new NoopPersistence();
  }
}
