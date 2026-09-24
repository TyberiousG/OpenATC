import { useEffect, useRef, useState } from "react";
import type { AircraftSnapshot, AirportInfoDTO, GroundLayoutDTO, Vec2 } from "@openatc/shared";

interface Props {
  airport: AirportInfoDTO;
  aircraft: AircraftSnapshot[];
}

const FT_PER_NM = 6076.12;
const VIEW = 800;
const PAD = 70;
const MIN_W = VIEW / 10; // most zoomed-in
const MAX_W = VIEW; // full extent

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Airport surface / ground diagram (SVG), zoomable and pannable via the
 * viewBox. Draws the real runway/taxiway/apron geometry plus ground traffic
 * (parked, taxiing, and rolling for takeoff).
 */
export function GroundMap({ airport, aircraft }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewBox>({ x: 0, y: 0, w: VIEW, h: VIEW });
  const drag = useRef({ active: false, lastX: 0, lastY: 0 });

  // Wheel-zoom toward the cursor (native, non-passive so we can preventDefault).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const neww = clamp(v.w * (e.deltaY < 0 ? 1 / 1.12 : 1.12), MIN_W, MAX_W);
        const cx = v.x + fx * v.w;
        const cy = v.y + fy * v.h;
        return { x: cx - fx * neww, y: cy - fy * neww, w: neww, h: neww };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current.active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.lastX) / rect.width) * view.w;
    const dy = ((e.clientY - drag.current.lastY) / rect.height) * view.h;
    drag.current.lastX = e.clientX;
    drag.current.lastY = e.clientY;
    setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
  };
  const onPointerUp = () => {
    drag.current.active = false;
  };

  const zoomBy = (factor: number) =>
    setView((v) => {
      const neww = clamp(v.w * factor, MIN_W, MAX_W);
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      return { x: cx - neww / 2, y: cy - neww / 2, w: neww, h: neww };
    });

  const content = airport.ground ? (
    <DetailedContent airport={airport} ground={airport.ground} aircraft={aircraft} />
  ) : (
    <SchematicContent airport={airport} aircraft={aircraft} />
  );

  return (
    <div className="radar-wrap">
      <svg
        ref={svgRef}
        className="radar"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="img"
        aria-label={`${airport.name} ground diagram`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <rect x={0} y={0} width={VIEW} height={VIEW} fill="#04120c" />
        {content}
      </svg>
      <div className="zoom-controls">
        <span className="zoom-range">×{(VIEW / view.w).toFixed(1)}</span>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} title="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1.3)} title="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setView({ x: 0, y: 0, w: VIEW, h: VIEW })} title="Reset view">
          ⟳
        </button>
      </div>
    </div>
  );
}

interface Fit {
  tx: (x: number) => number;
  ty: (y: number) => number;
  s: number;
}

function fitToView(points: Vec2[]): Fit {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 0.5);
  const s = (VIEW - 2 * PAD) / span;
  return { s, tx: (x: number) => VIEW / 2 + (x - midX) * s, ty: (y: number) => VIEW / 2 - (y - midY) * s };
}

function pathLength(path: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return len;
}

function labelSegments(taxiways: GroundLayoutDTO["taxiways"]): { id: string; mid: Vec2 }[] {
  const best = new Map<string, { len: number; path: Vec2[] }>();
  for (const t of taxiways) {
    if (!t.id) continue;
    const len = pathLength(t.path);
    const cur = best.get(t.id);
    if (!cur || len > cur.len) best.set(t.id, { len, path: t.path });
  }
  return [...best.entries()].map(([id, { path }]) => ({ id, mid: path[Math.floor(path.length / 2)]! }));
}

/** Ground blips for parked / taxiing / rolling aircraft. */
function GroundTraffic({ aircraft, tx, ty }: { aircraft: AircraftSnapshot[]; tx: Fit["tx"]; ty: Fit["ty"] }) {
  const onGround = aircraft.filter((a) => a.phase !== "airborne");
  return (
    <>
      {onGround.map((a) => {
        const px = tx(a.position.x);
        const py = ty(a.position.y);
        const moving = a.phase === "taxi" || a.phase === "takeoff";
        const color = moving ? "#39ff88" : "#ffcc44";
        const tag = a.phase === "hold" ? "· HOLD" : a.phase === "taxi" ? "· TAXI" : a.phase === "takeoff" ? "· ROLL" : "";
        return (
          <g key={a.id}>
            <rect x={px - 4} y={py - 4} width={8} height={8} fill={color} />
            <text x={px + 8} y={py + 4} fill={color} fontFamily="monospace" fontSize={11}>
              {a.callsign} {tag}
            </text>
          </g>
        );
      })}
    </>
  );
}

function DetailedContent({
  airport,
  ground,
  aircraft,
}: {
  airport: AirportInfoDTO;
  ground: GroundLayoutDTO;
  aircraft: AircraftSnapshot[];
}) {
  const pts: Vec2[] = [
    ...ground.runways.flatMap((r) => r.centerline),
    ...ground.taxiways.flatMap((t) => t.path),
    ...ground.ramps.flatMap((r) => r.polygon),
  ];
  const { tx, ty, s } = fitToView(pts);
  const runwayWidth = (widthFt: number) => Math.max(7, (widthFt / FT_PER_NM) * s);
  const taxiWidth = Math.max(3, (75 / FT_PER_NM) * s);

  return (
    <>
      {ground.ramps.map((r) => (
        <g key={r.id}>
          <polygon
            points={r.polygon.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ")}
            fill="#0c2418"
            stroke="#2b5540"
            strokeWidth={1}
          />
          {r.label && (
            <text
              x={tx(r.polygon.reduce((a, p) => a + p.x, 0) / r.polygon.length)}
              y={ty(r.polygon.reduce((a, p) => a + p.y, 0) / r.polygon.length)}
              fill="#4f8f6f"
              fontFamily="monospace"
              fontSize={12}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {r.label}
            </text>
          )}
        </g>
      ))}

      {ground.taxiways.map((t, i) => (
        <polyline
          key={i}
          points={t.path.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ")}
          fill="none"
          stroke="#37624a"
          strokeWidth={taxiWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {labelSegments(ground.taxiways).map(({ id, mid }) => (
        <text
          key={`lbl-${id}`}
          x={tx(mid.x)}
          y={ty(mid.y)}
          fill="#7fdcab"
          fontFamily="monospace"
          fontSize={11}
          fontWeight="bold"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {id}
        </text>
      ))}

      {ground.runways.map((r, i) => {
        const [a, b] = r.centerline;
        return (
          <g key={`rwy-${i}`}>
            <line x1={tx(a.x)} y1={ty(a.y)} x2={tx(b.x)} y2={ty(b.y)} stroke="#5a6b62" strokeWidth={runwayWidth(r.widthFt)} />
            <line x1={tx(a.x)} y1={ty(a.y)} x2={tx(b.x)} y2={ty(b.y)} stroke="#cfe8d8" strokeWidth={1.5} strokeDasharray="9 9" />
          </g>
        );
      })}

      {ground.runways.flatMap((r) => {
        const [a, b] = r.centerline;
        return [
          { id: r.ends[0], p: a, away: b },
          { id: r.ends[1], p: b, away: a },
        ].map((end) => {
          const dx = end.p.x - end.away.x;
          const dy = end.p.y - end.away.y;
          const len = Math.hypot(dx, dy) || 1;
          const off = (runwayWidth(r.widthFt) + 14) / s;
          return (
            <text
              key={`end-${end.id}`}
              x={tx(end.p.x + (dx / len) * off)}
              y={ty(end.p.y + (dy / len) * off)}
              fill="#39ff88"
              fontFamily="monospace"
              fontSize={16}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {end.id}
            </text>
          );
        });
      })}

      <GroundTraffic aircraft={aircraft} tx={tx} ty={ty} />

      <NorthArrow />
      <text x={20} y={30} fill="#1f6b47" fontFamily="monospace" fontSize={15}>
        {airport.icao} GROUND — surface diagram
      </text>
    </>
  );
}

function SchematicContent({ airport, aircraft }: Props) {
  const strips = airport.runways.map((r) => {
    const lenNm = r.lengthFt / FT_PER_NM;
    const rad = (r.heading * Math.PI) / 180;
    return {
      id: r.id,
      start: { x: r.position.x, y: r.position.y },
      end: { x: r.position.x + Math.sin(rad) * lenNm, y: r.position.y + Math.cos(rad) * lenNm },
    };
  });
  const { tx, ty } = fitToView(strips.flatMap((st) => [st.start, st.end]));
  const widthPx = 12;
  return (
    <>
      {strips.map((st, i) => (
        <line key={i} x1={tx(st.start.x)} y1={ty(st.start.y)} x2={tx(st.end.x)} y2={ty(st.end.y)} stroke="#5a6b62" strokeWidth={widthPx} />
      ))}
      <GroundTraffic aircraft={aircraft} tx={tx} ty={ty} />
      <NorthArrow />
      <text x={20} y={30} fill="#1f6b47" fontFamily="monospace" fontSize={15}>
        {airport.icao} GROUND — surface diagram
      </text>
    </>
  );
}

function NorthArrow() {
  return (
    <g transform={`translate(${VIEW - 46}, 46)`}>
      <line x1={0} y1={18} x2={0} y2={-18} stroke="#39ff88" strokeWidth={2} />
      <path d="M0,-22 L5,-12 L-5,-12 Z" fill="#39ff88" />
      <text x={0} y={34} fill="#39ff88" fontFamily="monospace" fontSize={14} textAnchor="middle">
        N
      </text>
    </g>
  );
}
