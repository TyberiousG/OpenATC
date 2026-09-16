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
}

export interface PositionDTO {
  id: string;
  label: string;
  frequency: string;
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
  | { type: "state"; time: number; aircraft: AircraftSnapshot[] }
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
    };

/** Client → server messages. */
export type ClientMessage = { type: "command"; text: string };
