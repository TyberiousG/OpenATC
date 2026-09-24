import type { AdminAction, SessionInfo, SessionStats } from "@openatc/shared";

interface Props {
  session: SessionInfo;
  stats: SessionStats;
  onAdmin: (action: AdminAction) => void;
  onClearLog: () => void;
  onClose: () => void;
}

const POSITION_LABELS: Record<string, string> = {
  CTR: "Center",
  APP: "Approach",
  TWR: "Tower",
  GND: "Ground",
};

/**
 * Admin console for the shared multiplayer session: see who is working which
 * position, reset / pause the simulation, tune traffic, and clear counters or
 * the log. Any connected client can open it (no auth in this dev build).
 */
export function AdminPanel({ session, stats, onAdmin, onClearLog, onClose }: Props) {
  const worked = new Map<string, number>();
  for (const c of session.controllers) {
    if (c.position) worked.set(c.position, (worked.get(c.position) ?? 0) + 1);
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
        <header className="admin-head">
          <span>⚙ ADMIN CONSOLE</span>
          <button type="button" className="admin-close" onClick={onClose}>
            ✕
          </button>
        </header>

        <section>
          <h3>Session</h3>
          <div className="admin-row">
            <span>{session.controllers.length} controller(s) connected</span>
            {session.paused && <span className="admin-paused">PAUSED</span>}
          </div>
          <ul className="admin-positions">
            {["CTR", "APP", "TWR", "GND"].map((p) => (
              <li key={p}>
                <span className="pos-id">{p}</span>
                <span>{POSITION_LABELS[p]}</span>
                <span className={worked.get(p) ? "pos-on" : "pos-off"}>
                  {worked.get(p) ? `${worked.get(p)} working` : "unstaffed"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Simulation</h3>
          <div className="admin-buttons">
            <button type="button" onClick={() => onAdmin({ kind: session.paused ? "resume" : "pause" })}>
              {session.paused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <button type="button" className="danger" onClick={() => onAdmin({ kind: "reset" })}>
              ⟳ Reset traffic
            </button>
          </div>
          <div className="admin-row">
            <label>Traffic count: {session.trafficCount}</label>
            <div className="admin-stepper">
              <button type="button" onClick={() => onAdmin({ kind: "set_traffic", count: session.trafficCount - 1 })}>
                −
              </button>
              <button type="button" onClick={() => onAdmin({ kind: "set_traffic", count: session.trafficCount + 1 })}>
                +
              </button>
            </div>
          </div>
        </section>

        <section>
          <h3>Log & stats</h3>
          <div className="admin-row">
            <span>
              ✓ {stats.landings} landed · ↑ {stats.departures} dep · ⚠ {stats.violations} viol
            </span>
          </div>
          <div className="admin-buttons">
            <button type="button" onClick={() => onAdmin({ kind: "reset_stats" })}>
              Reset stats
            </button>
            <button type="button" onClick={onClearLog}>
              Clear log
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
