import { describe, it, expect } from "vitest";
import { projectToPlane, planeToLatLon, headingDifference, normalizeHeading } from "./geo.js";

const ref = { lat: 29.6454, lon: -95.2789 };

describe("geo projection", () => {
  it("round-trips lat/lon through the tangent plane", () => {
    const point = { lat: 29.75, lon: -95.15 };
    const back = planeToLatLon(ref, projectToPlane(ref, point));
    expect(back.lat).toBeCloseTo(point.lat, 6);
    expect(back.lon).toBeCloseTo(point.lon, 6);
  });

  it("maps north as +y and east as +x", () => {
    const north = projectToPlane(ref, { lat: ref.lat + 0.1, lon: ref.lon });
    expect(north.y).toBeGreaterThan(0);
    expect(Math.abs(north.x)).toBeLessThan(1e-9);
    const east = projectToPlane(ref, { lat: ref.lat, lon: ref.lon + 0.1 });
    expect(east.x).toBeGreaterThan(0);
  });
});

describe("heading math", () => {
  it("normalizes into [0,360)", () => {
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(370)).toBe(10);
  });

  it("computes signed shortest difference", () => {
    expect(headingDifference(10, 40)).toBe(30);
    expect(headingDifference(350, 10)).toBe(20);
    expect(headingDifference(10, 350)).toBe(-20);
  });
});
