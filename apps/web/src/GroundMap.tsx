import type { AirportInfoDTO } from "@openatc/shared";

interface Props {
  airport: AirportInfoDTO;
}

const FT_PER_NM = 6076.12;
const VIEW = 800;
const PAD = 80;
/** Nominal runway width (ft) used to size the strips. */
const RUNWAY_WIDTH_FT = 150;

/**
 * Airport surface / ground diagram, rendered as SVG. It is generated from the
 * airport package's runway geometry (thresholds, headings, lengths) so every
 * airport gets a diagram with no bespoke artwork. A stored per-airport SVG
 * (with taxiways, ramps, hold-short lines) can override this later.
 *
 * Shown when the controller selects the Ground position, where a plan view of
 * the movement area is more useful than a radar picture.
 */
export function GroundMap({ airport }: Props) {
  // Each runway end contributes a strip from its threshold along its heading.
  const strips = airport.runways.map((r) => {
    const lenNm = r.lengthFt / FT_PER_NM;
    const rad = (r.heading * Math.PI) / 180;
    return {
      id: r.id,
      start: { x: r.position.x, y: r.position.y },
      end: { x: r.position.x + Math.sin(rad) * lenNm, y: r.position.y + Math.cos(rad) * lenNm },
    };
  });

  // Fit all runway endpoints into the viewBox.
  const pts = strips.flatMap((s) => [s.start, s.end]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 0.5);
  const s = (VIEW - 2 * PAD) / span;

  const tx = (x: number) => VIEW / 2 + (x - midX) * s;
  const ty = (y: number) => VIEW / 2 - (y - midY) * s; // north is up
  const widthPx = Math.max(7, (RUNWAY_WIDTH_FT / FT_PER_NM) * s);

  return (
    <svg className="radar" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={`${airport.name} ground diagram`}>
      <rect x={0} y={0} width={VIEW} height={VIEW} fill="#04120c" />

      {/* Runway strips */}
      {strips.map((strip, i) => (
        <line
          key={`strip-${i}`}
          x1={tx(strip.start.x)}
          y1={ty(strip.start.y)}
          x2={tx(strip.end.x)}
          y2={ty(strip.end.y)}
          stroke="#5a6b62"
          strokeWidth={widthPx}
          strokeLinecap="butt"
        />
      ))}

      {/* Dashed centerlines */}
      {strips.map((strip, i) => (
        <line
          key={`cl-${i}`}
          x1={tx(strip.start.x)}
          y1={ty(strip.start.y)}
          x2={tx(strip.end.x)}
          y2={ty(strip.end.y)}
          stroke="#cfe8d8"
          strokeWidth={1.5}
          strokeDasharray="10 10"
        />
      ))}

      {/* Threshold labels */}
      {strips.map((strip, i) => {
        const x1 = tx(strip.start.x);
        const y1 = ty(strip.start.y);
        const x2 = tx(strip.end.x);
        const y2 = ty(strip.end.y);
        // Place the label just outside the threshold, opposite the runway heading.
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const off = widthPx + 14;
        return (
          <text
            key={`lbl-${i}`}
            x={x1 - (dx / len) * off}
            y={y1 - (dy / len) * off}
            fill="#39ff88"
            fontFamily="monospace"
            fontSize={18}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {strip.id}
          </text>
        );
      })}

      {/* North arrow */}
      <g transform={`translate(${VIEW - 46}, 46)`}>
        <line x1={0} y1={18} x2={0} y2={-18} stroke="#39ff88" strokeWidth={2} />
        <path d="M0,-22 L5,-12 L-5,-12 Z" fill="#39ff88" />
        <text x={0} y={34} fill="#39ff88" fontFamily="monospace" fontSize={14} textAnchor="middle">
          N
        </text>
      </g>

      {/* Title */}
      <text x={20} y={34} fill="#1f6b47" fontFamily="monospace" fontSize={16}>
        {airport.icao} GROUND — surface diagram
      </text>
    </svg>
  );
}
