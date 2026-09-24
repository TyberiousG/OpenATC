import type { GroundLayout } from "@openatc/airport-data";
import { distanceNm, type Vec2 } from "./geo.js";

/**
 * A routable graph of the airport surface, built from the taxiway geometry.
 * Nodes are taxiway vertices (coincident endpoints snap together, so
 * intersecting taxiways connect); edges are the segments between them. Runway
 * ends and ramps are not nodes — routes connect to the nearest taxiway node.
 */
export interface TaxiNetwork {
  nodePos: Map<string, Vec2>;
  adj: Map<string, { to: string; w: number }[]>;
  /** Node keys belonging to each named taxiway, for "via" routing. */
  taxiwayNodes: Map<string, string[]>;
}

/** Snap tolerance for treating vertices as the same node (~24 ft). */
const EPS = 0.004;

function keyOf(p: Vec2): string {
  return `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)}`;
}

export function buildTaxiNetwork(ground: GroundLayout): TaxiNetwork {
  const nodePos = new Map<string, Vec2>();
  const adj = new Map<string, { to: string; w: number }[]>();
  const taxiwayNodes = new Map<string, string[]>();

  const addNode = (p: Vec2): string => {
    const k = keyOf(p);
    if (!nodePos.has(k)) {
      nodePos.set(k, p);
      adj.set(k, []);
    }
    return k;
  };
  const addEdge = (a: string, b: string, w: number): void => {
    if (a === b) return;
    adj.get(a)!.push({ to: b, w });
    adj.get(b)!.push({ to: a, w });
  };

  for (const t of ground.taxiways) {
    const keys: string[] = [];
    for (let i = 0; i < t.path.length; i++) {
      const k = addNode(t.path[i]!);
      keys.push(k);
      if (i > 0) addEdge(keys[i - 1]!, k, distanceNm(t.path[i - 1]!, t.path[i]!));
    }
    if (t.id) {
      const arr = taxiwayNodes.get(t.id) ?? [];
      arr.push(...keys);
      taxiwayNodes.set(t.id, arr);
    }
  }
  return { nodePos, adj, taxiwayNodes };
}

function nearestNode(net: TaxiNetwork, pos: Vec2, candidates?: string[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  const keys = candidates ?? [...net.nodePos.keys()];
  for (const k of keys) {
    const d = distanceNm(pos, net.nodePos.get(k)!);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Dijkstra shortest path between two node keys; returns the key sequence. */
function shortestPath(net: TaxiNetwork, start: string, goal: string): string[] {
  if (start === goal) return [start];
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  // Small graph: linear-scan frontier is fine.
  const frontier = new Set<string>([start]);
  while (frontier.size > 0) {
    let u: string | null = null;
    let ud = Infinity;
    for (const k of frontier) {
      const d = dist.get(k) ?? Infinity;
      if (d < ud) {
        ud = d;
        u = k;
      }
    }
    if (u === null) break;
    frontier.delete(u);
    if (u === goal) break;
    visited.add(u);
    for (const { to, w } of net.adj.get(u) ?? []) {
      if (visited.has(to)) continue;
      const nd = ud + w;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, u);
        frontier.add(to);
      }
    }
  }
  if (!prev.has(goal) && start !== goal) return [];
  const path: string[] = [goal];
  let cur = goal;
  while (cur !== start) {
    const p = prev.get(cur);
    if (!p) return [];
    path.unshift(p);
    cur = p;
  }
  return path;
}

/**
 * Plan a taxi route as a polyline (excluding the start position). Routes from
 * the nearest node to the aircraft, through a node of each `via` taxiway in
 * order, to the nearest node to the goal, then to the goal itself.
 */
export function planTaxiRoute(net: TaxiNetwork, start: Vec2, goal: Vec2, via: string[]): Vec2[] {
  const startKey = nearestNode(net, start);
  const goalKey = nearestNode(net, goal);
  if (!startKey || !goalKey) return [goal];

  const waypoints: string[] = [startKey];
  let refPos = start;
  for (const v of via) {
    const nodes = net.taxiwayNodes.get(v.toUpperCase());
    if (!nodes || nodes.length === 0) continue; // unknown taxiway — skip
    const wp = nearestNode(net, refPos, nodes);
    if (wp) {
      waypoints.push(wp);
      refPos = net.nodePos.get(wp)!;
    }
  }
  waypoints.push(goalKey);

  const keyPath: string[] = [waypoints[0]!];
  for (let i = 1; i < waypoints.length; i++) {
    const seg = shortestPath(net, waypoints[i - 1]!, waypoints[i]!);
    for (let j = 1; j < seg.length; j++) keyPath.push(seg[j]!);
  }

  const poly = keyPath.map((k) => net.nodePos.get(k)!);
  poly.push(goal);
  // Drop any zero-length hops.
  return poly.filter((p, i) => i === 0 || distanceNm(p, poly[i - 1]!) > 1e-6);
}
