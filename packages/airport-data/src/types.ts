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
  /** Default radar scope range in nautical miles. */
  rangeNm: number;
}
