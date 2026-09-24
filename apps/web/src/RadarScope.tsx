import { useEffect, useRef, useState } from "react";
import type { AircraftSnapshot, AirportInfoDTO } from "@openatc/shared";

interface Props {
  airport: AirportInfoDTO;
  aircraft: AircraftSnapshot[];
  selectedId: string | null;
  /** The controller's active position; off-frequency traffic is dimmed. */
  activePosition: string;
  onSelect: (ac: AircraftSnapshot) => void;
}

const GREEN = "#39ff88";
const DIM = "#1f6b47";
const AMBER = "#ffcc44";
const RED = "#ff4d4d";

/** Amount of look-ahead the velocity leader line represents, in seconds. */
const LEADER_SECONDS = 60;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface Proj {
  cx: number;
  cy: number;
  scale: number;
  baseScale: number;
  size: number;
}

export function RadarScope({ airport, aircraft, selectedId, activePosition, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const acRef = useRef(aircraft);
  acRef.current = aircraft;

  // View transform (kept in refs so canvas interactions don't churn React state).
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const projRef = useRef<Proj>({ cx: 0, cy: 0, scale: 1, baseScale: 1, size: 0 });
  const [version, setVersion] = useState(0);
  const redraw = () => setVersion((v) => v + 1);
  const [rangeNm, setRangeNm] = useState(airport.rangeNm);

  // Drag state.
  const drag = useRef({ active: false, moved: false, lastX: 0, lastY: 0, downX: 0, downY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(canvas.clientWidth, canvas.clientHeight);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const baseScale = size / 2 / airport.rangeNm;
    const scale = baseScale * zoomRef.current;
    const pan = panRef.current;
    projRef.current = { cx, cy, scale, baseScale, size };

    const toPx = (x: number, y: number) => ({
      px: cx + (x - pan.x) * scale,
      py: cy - (y - pan.y) * scale,
    });

    // Visible range at the viewport edge, for the readout.
    const visibleRange = size / 2 / scale;
    setRangeNm(visibleRange);

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#020806";
    ctx.fillRect(0, 0, size, size);

    const field = toPx(0, 0);

    // Range rings (nm-anchored, centred on the field)
    ctx.strokeStyle = DIM;
    ctx.fillStyle = DIM;
    ctx.lineWidth = 1;
    ctx.font = "10px monospace";
    for (let r = 10; r <= airport.rangeNm; r += 10) {
      ctx.beginPath();
      ctx.arc(field.px, field.py, r * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${r}`, field.px + 2, field.py - r * scale + 12);
    }
    // Crosshair through the field
    ctx.beginPath();
    ctx.moveTo(field.px, 0);
    ctx.lineTo(field.px, size);
    ctx.moveTo(0, field.py);
    ctx.lineTo(size, field.py);
    ctx.stroke();

    // Compass rose: centred on the viewport (not the field) so it travels with
    // the current view, giving a bearing reference wherever you pan/zoom.
    const roseR = size / 2 - 22;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "11px monospace";
    for (let deg = 0; deg < 360; deg += 10) {
      const rad = (deg * Math.PI) / 180;
      const sin = Math.sin(rad);
      const cos = Math.cos(rad);
      const major = deg % 30 === 0;
      const tickLen = major ? 12 : 6;
      ctx.strokeStyle = major ? GREEN : DIM;
      ctx.beginPath();
      ctx.moveTo(cx + sin * roseR, cy - cos * roseR);
      ctx.lineTo(cx + sin * (roseR - tickLen), cy - cos * (roseR - tickLen));
      ctx.stroke();
      if (major) {
        const label = (deg === 0 ? 360 : deg).toString().padStart(3, "0");
        ctx.fillStyle = GREEN;
        ctx.fillText(label, cx + sin * (roseR - 24), cy - cos * (roseR - 24));
      }
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // Runways
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    for (const rwy of airport.runways) {
      const { px, py } = toPx(rwy.position.x, rwy.position.y);
      const rad = (rwy.heading * Math.PI) / 180;
      const len = 8;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(rad) * len, py - Math.cos(rad) * len);
      ctx.stroke();
    }

    // Navaids
    ctx.fillStyle = DIM;
    for (const nav of airport.navaids) {
      const { px, py } = toPx(nav.position.x, nav.position.y);
      ctx.beginPath();
      ctx.moveTo(px, py - 4);
      ctx.lineTo(px + 4, py + 3);
      ctx.lineTo(px - 4, py + 3);
      ctx.closePath();
      ctx.stroke();
      ctx.fillText(nav.id, px + 6, py + 3);
    }

    // Aircraft
    ctx.font = "11px monospace";
    for (const ac of acRef.current) {
      const { px, py } = toPx(ac.position.x, ac.position.y);
      const selected = ac.id === selectedId;
      const onFrequency = ac.controller === activePosition;
      const color = selected ? AMBER : onFrequency ? GREEN : DIM;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      ctx.fillRect(px - 3, py - 3, 6, 6);

      // Separation alert halo: red = loss of separation, amber = predicted.
      if (ac.alert !== "none") {
        ctx.strokeStyle = ac.alert === "violation" ? RED : AMBER;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      const rad = (ac.heading * Math.PI) / 180;
      const leadNm = (ac.speed * LEADER_SECONDS) / 3600;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(rad) * leadNm * scale, py - Math.cos(rad) * leadNm * scale);
      ctx.stroke();

      const fl = Math.round(ac.altitude / 100).toString().padStart(3, "0");
      const spd = Math.round(ac.speed / 10).toString().padStart(2, "0");
      const tag = ac.approachEstablished
        ? `▼ILS ${ac.approachRunway}`
        : ac.approachRunway
          ? `(c) ILS ${ac.approachRunway}`
          : ac.intentKind === "arrival"
            ? `↓${ac.runway ?? ""}`
            : ac.intentKind === "departure"
              ? "↑DEP"
              : "→OVF";
      const lines = [`${ac.callsign} ${tag}`, `${fl} ${spd}`, `${ac.aircraftType} ${ac.squawk}`];
      lines.forEach((line, i) => ctx.fillText(line, px + 8, py - 6 + i * 12));
    }
  }, [airport, aircraft, selectedId, activePosition, version]);

  // Zoom toward a screen point, keeping the plane point under it fixed.
  const zoomAt = (factor: number, mx: number, my: number) => {
    const { cx, cy, scale, baseScale } = projRef.current;
    const pX = panRef.current.x + (mx - cx) / scale;
    const pY = panRef.current.y - (my - cy) / scale;
    const newZoom = clamp(zoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
    zoomRef.current = newZoom;
    const newScale = baseScale * newZoom;
    panRef.current = { x: pX - (mx - cx) / newScale, y: pY + (my - cy) / newScale };
    if (newZoom === MIN_ZOOM) panRef.current = { x: 0, y: 0 };
    redraw();
  };

  // Native (non-passive) wheel listener so we can preventDefault the page scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = { active: true, moved: false, lastX: e.clientX, lastY: e.clientY, downX: e.clientX, downY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    const { scale } = projRef.current;
    panRef.current = { x: panRef.current.x - dx / scale, y: panRef.current.y + dy / scale };
    if (Math.hypot(e.clientX - d.downX, e.clientY - d.downY) > 4) d.moved = true;
    redraw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    d.active = false;
    if (d.moved) return; // a drag, not a click
    // Click: select the nearest aircraft.
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { cx, cy, scale } = projRef.current;
    const pan = panRef.current;
    let nearest: AircraftSnapshot | null = null;
    let best = 20;
    for (const ac of acRef.current) {
      const px = cx + (ac.position.x - pan.x) * scale;
      const py = cy - (ac.position.y - pan.y) * scale;
      const dist = Math.hypot(px - mx, py - my);
      if (dist < best) {
        best = dist;
        nearest = ac;
      }
    }
    if (nearest) onSelect(nearest);
  };

  const resetView = () => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    redraw();
  };

  return (
    <div className="radar-wrap">
      <canvas
        ref={canvasRef}
        className="radar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="zoom-controls">
        <span className="zoom-range">{Math.round(rangeNm)} nm</span>
        <button type="button" onClick={() => zoomAt(1.3, projRef.current.cx, projRef.current.cy)} title="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomAt(1 / 1.3, projRef.current.cx, projRef.current.cy)} title="Zoom out">
          −
        </button>
        <button type="button" onClick={resetView} title="Reset view">
          ⟳
        </button>
      </div>
    </div>
  );
}
