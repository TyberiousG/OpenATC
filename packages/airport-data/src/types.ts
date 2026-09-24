/**
 * Airport package schema.
 *
 * An "airport package" is a self-contained, declarative description of an
 * airport and its surrounding navigation environment. The simulation engine
 * consumes these packages but never depends on any specific one, so new
 * airports can be added without touching engine code.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RunwayDef {
  /** e.g. "13R", "31L". */
  id: string;
  /** Magnetic heading of the runway centerline, degrees. */
  heading: number;
  /** Threshold coordinate. */
  threshold: LatLon;
  lengthFt: number;
  /** True if this runway end supports the modeled approach types. */
  ilsFrequency?: string;
}

export interface NavaidDef {
  id: string;
  type: "VOR" | "NDB" | "FIX" | "WAYPOINT";
  position: LatLon;
  frequency?: string;
}

export interface ApproachDef {
  /** e.g. "ILS 13R". */
  id: string;
  runwayId: string;
  type: "ILS" | "RNAV" | "VISUAL";
  /** Final approach course, magnetic degrees. */
  finalCourse: number;
  /** Glideslope angle in degrees (typically 3.0). */
  glideslopeAngle: number;
}

export interface PositionDef {
  /** Short id and controller ownership tag, e.g. "APP", "TWR", "GND". */
  id: string;
  /** Human label, e.g. "Approach". */
  label: string;
  /** Radio frequency in MHz, e.g. "124.350". */
  frequency: string;
}

/**
 * Airport surface geometry for the ground/taxi diagram, in local tangent-plane
 * nautical miles (x = east, y = north, origin = airport reference). Kept as
 * declarative data so the taxi logic (routing, hold-short, incursions) can be
 * built on the same graph the diagram is drawn from.
 */
export interface GroundPoint {
  x: number;
  y: number;
}

export interface RunwaySurface {
  /** Physical runway, both ends, e.g. ["04", "22"]. */
  ends: [string, string];
  centerline: [GroundPoint, GroundPoint];
  widthFt: number;
}

export interface Taxiway {
  /** Identifier, e.g. "A", "B", "K2". */
  id: string;
  /** Ordered polyline of the taxiway centerline. */
  path: GroundPoint[];
}

export interface HoldShort {
  /** Runway this hold-short line protects, e.g. "13R". */
  runway: string;
  pos: GroundPoint;
  /** Orientation of the hold bar (the runway heading it faces). */
  heading: number;
}

export interface RampArea {
  id: string;
  label?: string;
  /** Closed polygon of the apron/ramp/terminal area. */
  polygon: GroundPoint[];
}

export interface GroundLayout {
  runways: RunwaySurface[];
  taxiways: Taxiway[];
  holdShort: HoldShort[];
  ramps: RampArea[];
}

export interface AirportPackage {
  icao: string;
  name: string;
  /** Airport reference point — origin of the local tangent plane. */
  reference: LatLon;
  /** Field elevation in feet MSL. */
  elevation: number;
  /** Magnetic variation in degrees (west negative). */
  magneticVariation: number;
  runways: RunwayDef[];
  navaids: NavaidDef[];
  approaches: ApproachDef[];
  /** Controller positions / frequencies that can be worked at this airport. */
  positions: PositionDef[];
  /** Surface diagram geometry (runways, taxiways, ramps). Optional. */
  ground?: GroundLayout;
  /** Default radar scope range in nautical miles. */
  rangeNm: number;
}
