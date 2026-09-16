import type { AirportPackage } from "../types.js";

/**
 * KHOU — William P. Hobby Airport, Houston, TX.
 *
 * Coordinates and headings are approximate and intended for simulation
 * plausibility, not real-world navigation. Do not use for actual flight.
 */
export const KHOU: AirportPackage = {
  icao: "KHOU",
  name: "Houston Hobby",
  reference: { lat: 29.6454, lon: -95.2789 },
  elevation: 46,
  magneticVariation: 3, // ~3° E
  rangeNm: 40,
  runways: [
    {
      id: "04",
      heading: 41,
      threshold: { lat: 29.6392, lon: -95.2846 },
      lengthFt: 7602,
      ilsFrequency: "109.9",
    },
    {
      id: "22",
      heading: 221,
      threshold: { lat: 29.6516, lon: -95.2732 },
      lengthFt: 7602,
    },
    {
      id: "13R",
      heading: 131,
      threshold: { lat: 29.6551, lon: -95.2879 },
      lengthFt: 7602,
      ilsFrequency: "111.3",
    },
    {
      id: "31L",
      heading: 311,
      threshold: { lat: 29.6414, lon: -95.2726 },
      lengthFt: 7602,
      ilsFrequency: "108.7",
    },
    {
      id: "13L",
      heading: 131,
      threshold: { lat: 29.6489, lon: -95.2831 },
      lengthFt: 6000,
    },
    {
      id: "31R",
      heading: 311,
      threshold: { lat: 29.6377, lon: -95.2699 },
      lengthFt: 6000,
    },
  ],
  navaids: [
    { id: "HUB", type: "VOR", position: { lat: 29.6454, lon: -95.2789 }, frequency: "117.6" },
    { id: "SILME", type: "FIX", position: { lat: 29.35, lon: -95.55 } },
    { id: "DAKKY", type: "FIX", position: { lat: 29.95, lon: -95.05 } },
    { id: "TENZI", type: "FIX", position: { lat: 29.4, lon: -94.95 } },
    { id: "ZEENA", type: "FIX", position: { lat: 29.9, lon: -95.55 } },
  ],
  approaches: [
    { id: "ILS 13R", runwayId: "13R", type: "ILS", finalCourse: 131, glideslopeAngle: 3.0 },
    { id: "ILS 04", runwayId: "04", type: "ILS", finalCourse: 41, glideslopeAngle: 3.0 },
    { id: "ILS 31L", runwayId: "31L", type: "ILS", finalCourse: 311, glideslopeAngle: 3.0 },
  ],
  positions: [
    { id: "CTR", label: "Center", frequency: "133.500" },
    { id: "APP", label: "Approach", frequency: "124.350" },
    { id: "TWR", label: "Tower", frequency: "118.700" },
    { id: "GND", label: "Ground", frequency: "121.900" },
  ],
};
