import { describe, it, expect } from "vitest";
import { KHOU } from "@openatc/airport-data";
import { buildTaxiNetwork, planTaxiRoute } from "./taxiNetwork.js";
import { distanceNm } from "./geo.js";

const ground = KHOU.ground!;
const net = buildTaxiNetwork(ground);

describe("taxi network", () => {
  it("builds a connected graph from the taxiways", () => {
    expect(net.nodePos.size).toBeGreaterThan(50);
    expect(net.taxiwayNodes.get("C")?.length).toBeGreaterThan(0);
    expect(net.taxiwayNodes.get("Y")?.length).toBeGreaterThan(0);
  });

  it("routes a polyline along the graph, not a straight line", () => {
    const start = { x: 0.1, y: 0.2 }; // near the ramp
    const goal = ground.runways[0]!.centerline[0]!;
    const route = planTaxiRoute(net, start, goal, []);
    expect(route.length).toBeGreaterThan(2); // multiple waypoints, not a single hop
    // Ends at the goal.
    expect(distanceNm(route[route.length - 1]!, goal)).toBeLessThan(1e-6);
  });

  it("routes through a requested 'via' taxiway", () => {
    const start = { x: 0.1, y: 0.2 };
    const goal = ground.runways.find((r) => r.ends.includes("31R"))!.centerline[
      ground.runways.find((r) => r.ends.includes("31R"))!.ends.indexOf("31R")
    ]!;
    const route = planTaxiRoute(net, start, goal, ["C"]);
    // The route must pass within a taxi-width of some node belonging to taxiway C.
    const cNodes = net.taxiwayNodes.get("C")!.map((k) => net.nodePos.get(k)!);
    const passesC = route.some((p) => cNodes.some((c) => distanceNm(p, c) < 0.01));
    expect(passesC).toBe(true);
  });
});
