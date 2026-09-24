/**
 * Wire protocol shared between the server and web client.
 *
 * These types are transport-only DTOs. They intentionally mirror — but are
 * decoupled from — the simulation engine's internal domain model, so the
 * engine can evolve without breaking the client contract.
 */

export interface Vec2 {
  /** Nautical miles east of the airport reference point. */
  x: number;
  /** Nautical miles north of the airport reference point. */
  y: number;
}

export interface AircraftSnapshot {
  id: string;
  callsign: string;
  /** Spoken callsign, e.g. "United 421". */
  spoken: string;
  /** Position on the local tangent plane, in nautical miles. */
  position: Vec2;
  /** Geographic position for reference/labels. */
  lat: number;
  lon: number;
  altitude: number;
  /** Feet per minute; positive = climbing. */
  verticalRate: number;
  /** Magnetic heading in degrees [0, 360). */
  heading: number;
  /** Indicated airspeed in knots. */
  speed: number;
  assignedHeading: number | null;
  assignedAltitude: number | null;
  assignedSpeed: number | null;
  turnDirection: "left" | "right" | null;
  controller: string;
  aircraftType: string;
  squawk: string;
  /** Objective. */
  intentKind: "arrival" | "departure" | "overflight";
  origin: string;
  destination: string;
  /** Arrival's assigned landing runway, if any. */
  runway: string | null;
  /** Approach clearance state, for the data block. */
  approachRunway: string | null;
  approachEstablished: boolean;
  /** Separation alert level this aircraft is involved in. */
  alert: "none" | "warning" | "violation";
  /** Movement phase; anything other than "airborne" is on the ground. */
  phase: "ramp" | "taxi" | "hold" | "takeoff" | "airborne";
}

/** Running session score / operational counters. */
export interface SessionStats {
  landings: number;
  departures: number;
  /** Distinct loss-of-separation events. */
  violations: number;
  /** Aircraft currently in a predicted or actual conflict. */
  activeAlerts: number;
}

export interface PositionDTO {
  id: string;
  label: string;
  frequency: string;
}

/** Surface diagram geometry, in tangent-plane nm. Mirrors airport-data. */
export interface GroundLayoutDTO {
  runways: { ends: [string, string]; centerline: [Vec2, Vec2]; widthFt: number }[];
  taxiways: { id: string; path: Vec2[] }[];
  holdShort: { runway: string; pos: Vec2; heading: number }[];
  ramps: { id: string; label?: string; polygon: Vec2[] }[];
}

export interface AirportInfoDTO {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  magneticVariation: number;
  runways: RunwayDTO[];
  navaids: NavaidDTO[];
  positions: PositionDTO[];
  ground: GroundLayoutDTO | null;
  /** Scope range in nautical miles from the reference point. */
  rangeNm: number;
}

export interface RunwayDTO {
  id: string;
  heading: number;
  /** Threshold position on the local tangent plane. */
  position: Vec2;
  lengthFt: number;
}

export interface NavaidDTO {
  id: string;
  type: "VOR" | "NDB" | "FIX" | "WAYPOINT";
  position: Vec2;
}

/** Server → client messages. */
export type ServerMessage =
  | { type: "welcome"; airport: AirportInfoDTO; tickRate: number; serverStt: boolean; serverTts: boolean }
  | { type: "state"; time: number; aircraft: AircraftSnapshot[]; stats: SessionStats }
  /** New separation conflict — a "traffic alert" the controller must resolve. */
  | { type: "conflict_alert"; a: string; b: string; text: string; severity: "warning" | "violation" }
  | { type: "readback"; callsign: string; text: string; position: string; ok: true }
  | { type: "command_error"; input: string; error: string; ok: false }
  /** Pilot-initiated transmission (check-in, request, etc.). */
  | { type: "pilot_request"; callsign: string; spoken: string; text: string; position: string }
  /** An aircraft completed its objective and left the sim. */
  | {
      type: "flight_complete";
      callsign: string;
      spoken: string;
      outcome: "landed" | "departed" | "exited";
      runway: string | null;
      position: string;
    }
  /** Session roster + admin state; broadcast on any change. */
  | { type: "session"; session: SessionInfo };

/** A connected controller and the position they are working. */
export interface ControllerInfo {
  id: string;
  position: string | null;
}

/** Live session/admin state, broadcast to everyone. */
export interface SessionInfo {
  controllers: ControllerInfo[];
  paused: boolean;
  trafficCount: number;
}

/** Administrative actions available from the admin console. */
export type AdminAction =
  | { kind: "reset" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "set_traffic"; count: number }
  | { kind: "reset_stats" };

/** Client → server messages. */
export type ClientMessage =
  | { type: "command"; text: string }
  /** Claim/announce the position this client is working. */
  | { type: "set_position"; position: string }
  | { type: "admin"; action: AdminAction };
