# OpenATC

A browser-based Air Traffic Control simulator with a **server-authoritative,
deterministic simulation engine**. The first milestone models **KHOU (Houston
Hobby)** from the Approach/Final radar position.

> This is a training/entertainment simulator. Airport coordinates, headings,
> and procedures are approximate and **must not be used for real navigation.**

---

## Milestone 1 — vertical slice (complete)

- ✅ KHOU radar scope (HTML Canvas): range rings, runways, navaids, aircraft
  blips with velocity leaders and data blocks
- ✅ Several moving aircraft, deterministically generated
- ✅ Server-authoritative simulation on a fixed tick
- ✅ Realtime WebSocket state updates
- ✅ Controller command input — **typed or spoken (push-to-talk)**
- ✅ Deterministic ATC phraseology parser → validated structured commands
- ✅ Aircraft respond to vector / altitude / speed instructions
- ✅ Pilot readbacks
- ✅ Automated tests (Vitest)

Try, typed or over PTT:

```
United 421 turn left heading 240, descend and maintain 4000, reduce speed 180
```

---

## Flight objectives

Every aircraft has an **intent** and a lifecycle, so guiding it somewhere means
something:

| Kind | Spawns | Goal | Auto-behavior (until you vector it) |
|---|---|---|---|
| **Arrival** | airspace edge, inbound | Land on its assigned runway | Tracks toward the field, holds altitude |
| **Departure** | off a runway, low | Climb out and leave the airspace | Climbs to cruise on runway heading |
| **Overflight** | one edge | Transit to the far side | Tracks toward the exit boundary |

- **Semi-autonomous:** a controller assignment always wins; unassigned values
  follow the intent. So you sequence arrivals to final, climb/turn departures,
  and keep overflights clear — but they don't fly into the ground if ignored.
- **Auto-detected completion (in the engine):** an arrival lined up on its
  runway (aligned, low, slow, near the threshold) **lands**; anything that
  leaves the airspace **departs/exits**. Completed flights are removed and new
  traffic spawns to keep a steady flow. Objectives show in the data block
  (`↓13R` / `↑DEP` / `→OVF`) and the traffic list.

## Architecture

A TypeScript monorepo (npm workspaces). The simulation engine is deliberately
isolated from React, networking, speech, and AI.

```
packages/
  sim-engine/    Pure, deterministic simulation. No React/network/AI deps.
                 Owns all aircraft state; only it may mutate it.
  airport-data/  Modular "airport packages" (KHOU first). Declarative data the
                 engine consumes but never depends on — add airports without
                 touching the engine.
  phraseology/   Deterministic ATC parser: text → validated Command[] + pilot
                 readback. Includes spoken-number normalization ("two four
                 zero" → 240) so typed and spoken input share one path.
  voice/         Provider interfaces for STT / TTS and an OPTIONAL LLM fallback.
                 None is authoritative over simulation state.
  shared/        WebSocket protocol DTOs shared by server and web.
apps/
  server/        Node: authoritative sim loop + WebSocket broadcast + optional
                 Postgres persistence (command log).
  web/           React + Vite. Canvas radar, WebSocket client, command input,
                 push-to-talk voice (Web Speech API).
```

### Design principles

- **The engine owns truth.** The server advances it on a fixed timestep and
  broadcasts snapshots. Given the same scenario and commands, evolution is
  identical (verified by a determinism test).
- **AI is never authoritative.** The speech pipeline is
  `mic → STT → phraseology parser → simulation → readback → TTS`. An optional
  LLM may only *normalize* a messy transcript; its suggestion is re-parsed and
  re-validated by the same deterministic parser before anything happens.
- **Airports are data, not code.** New airports are new packages under
  `packages/airport-data/src/airports/`.

---

## Running

### With Docker (recommended for a full stack incl. Postgres)

```bash
docker compose up
```

- Web: http://localhost:5173
- Server (health): http://localhost:8080/health
- Postgres: localhost:5432 (`openatc` / `openatc`)

### Locally (Node ≥ 20)

```bash
npm install
npm run dev          # runs server (:8080) and web (:5173) together
```

Postgres is optional — without `DATABASE_URL` the server runs fully in-memory.

### Tests & typecheck

```bash
npm test
npm run typecheck
```

---

## Using the scope

- **Click** an aircraft (scope or traffic list) to prefill its callsign.
- **Type** a command and press **Enter**.
- **Zoom & pan:** mouse-wheel to zoom toward the cursor, drag to pan, and the
  `+ / − / ⟳` controls (top-left of the scope) to zoom in/out or reset. The
  current range is shown in nm.
- **Frequency selector:** choose the position you're working — **CTR / APP /
  TWR / GND** — in the header. The active frequency is shown; traffic on other
  frequencies is dimmed on the scope, and **only transmissions on your selected
  frequency are shown/heard** (log + TTS). Since all traffic starts on Approach,
  other positions are quiet until you hand aircraft to them.
- **Push-to-talk:** click the on-screen **PTT** button (click to talk, click
  again — or just stop speaking — to send), or hold the configurable hotkey
  (default `` ` ``, rebindable via the **key** button). The transcript is shown
  in the transmissions log, and voice errors surface there too. Requires a
  browser with the Web Speech API (Chrome/Edge) and microphone permission.

### Speech providers (STT / TTS)

Two backends, chosen automatically:

- **Deepgram (server-side)** — enabled when `DEEPGRAM_API_KEY` is set. STT is
  keyword-biased toward ATC phraseology and the live callsigns (so "ILS" stops
  becoming "iOS"); TTS uses Aura voices, one per callsign. Audio is proxied
  through the server so the key never reaches the browser.
- **Browser (fallback)** — Web Speech API for STT and SpeechSynthesis for TTS,
  used when no server key is configured. Requires Chrome/Edge + mic permission.

The provider seam lives in `@openatc/voice`; neither STT, TTS, nor any future
LLM is authoritative over simulation state.

### Voice normalization

Because speech-to-text mangles ATC numbers, the parser first runs deterministic
repair before parsing (both benefit typed input too):

- **Homophone correction** (context-aware): "two four zero" mis-heard as
  "to four zero" → `240`, "for two one" → `421`, "tree/fife/niner" → 3/5/9.
  Genuine prepositions are preserved ("descend **to** 4000", "cleared **for**
  the approach").
- **Callsign telephony:** spoken "JetBlue 649" ⇄ code `JBU649`, both directions,
  so readbacks/TTS speak telephony while the sim tracks ICAO callsigns.

### Pilot voice (text-to-speech)

Pilot transmissions are spoken aloud via the browser SpeechSynthesis API — each
callsign gets a stable, distinct voice. Toggle with **🔊 Voice** in the header.
Two sources are spoken:

- **Readbacks** after you issue an instruction.
- **Pilot-initiated calls** — check-ins, VFR flight following, higher/lower,
  direct-to-fix, and approach requests — emitted by the server on an interval
  (`PILOT_REQUEST_MS`). These are a presentation layer only; they read sim state
  but never mutate the deterministic engine. (Controller responses to them are a
  future milestone.)

### Supported phraseology (milestone 1)

| Instruction | Examples |
|---|---|
| Heading | `turn left heading 240`, `fly heading 090`, `heading two four zero` |
| Altitude | `descend and maintain 4000`, `climb and maintain flight level 180` |
| Speed | `reduce speed 180`, `increase speed 250`, `maintain 210 knots` |
| Handoff | `contact Houston Tower on 118.7`, `contact ground 121.9`, `contact approach` |
| Squawk | `squawk 4271`, `squawk code 4271` |
| Approach | `cleared ILS 13R approach`, `cleared approach`, `cleared for the ILS runway 4 approach` |

A handoff transfers the aircraft's controller ownership to the new position, so
it leaves your frequency and dims on the scope.

### Flying an arrival to landing

1. Descend and slow the arrival, and **vector it to intercept the final
   approach course** (extended runway centerline).
2. `<callsign> cleared ILS <runway> approach` (runway optional — defaults to the
   arrival's assigned runway). The data block shows `(c) ILS 13R` while cleared.
3. When it crosses the localizer at a reasonable angle it **captures** — the tag
   becomes `▼ILS 13R`, the aircraft drops the vector, tracks the centerline and
   3° glideslope down, and slows to approach speed on its own.
4. Established, low, and slow at the threshold, it **lands** (a `✓ … landed`
   line appears) and new traffic spawns.

Multiple instructions may be combined in one transmission; the pilot reads them
back in order followed by the callsign.

---

## Roadmap (not yet built)

Approach clearances & ILS capture, handoffs between positions, conflict alerts,
SIDs/STARs, real STT/TTS providers, LLM transcript-normalization fallback,
additional airports, scenario/session persistence and replay.
