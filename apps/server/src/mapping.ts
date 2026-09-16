import type { AirportPackage } from "@openatc/airport-data";
import { projectToPlane, type SimEngine, type Aircraft } from "@openatc/sim-engine";
import type { AircraftSnapshot, AirportInfoDTO } from "@openatc/shared";

/** Build the static airport DTO sent to clients on connect. */
export function toAirportInfo(airport: AirportPackage): AirportInfoDTO {
  return {
    icao: airport.icao,
    name: airport.name,
    lat: airport.reference.lat,
    lon: airport.reference.lon,
    elevation: airport.elevation,
    magneticVariation: airport.magneticVariation,
    rangeNm: airport.rangeNm,
    positions: airport.positions.map((p) => ({ id: p.id, label: p.label, frequency: p.frequency })),
    runways: airport.runways.map((r) => ({
      id: r.id,
      heading: r.heading,
      position: projectToPlane(airport.reference, r.threshold),
      lengthFt: r.lengthFt,
    })),
    navaids: airport.navaids.map((n) => ({
      id: n.id,
      type: n.type,
      position: projectToPlane(airport.reference, n.position),
    })),
  };
}

/** Convert an engine aircraft into a wire snapshot. */
export function toSnapshot(engine: SimEngine, ac: Aircraft): AircraftSnapshot {
  const { lat, lon } = engine.latLonOf(ac);
  return {
    id: ac.id,
    callsign: ac.callsign,
    spoken: ac.spoken,
    position: { x: ac.position.x, y: ac.position.y },
    lat,
    lon,
    altitude: Math.round(ac.altitude),
    verticalRate: Math.round(ac.verticalRate),
    heading: ac.heading,
    speed: Math.round(ac.speed),
    assignedHeading: ac.assignedHeading,
    assignedAltitude: ac.assignedAltitude,
    assignedSpeed: ac.assignedSpeed,
    turnDirection: ac.turnDirection,
    controller: ac.controller,
    aircraftType: ac.aircraftType,
    squawk: ac.squawk,
    intentKind: ac.intent.kind,
    origin: ac.intent.origin,
    destination: ac.intent.destination,
    runway: ac.intent.runway,
    approachRunway: ac.clearedApproach?.runwayId ?? null,
    approachEstablished: ac.clearedApproach?.localizerCaptured ?? false,
  };
}
