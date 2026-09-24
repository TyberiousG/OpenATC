/**
 * Regenerate an airport's ground layout JSON from OpenStreetMap.
 *
 *   node scripts/gen-ground.mjs KHOU 29.6454 -95.2789 > \
 *     packages/airport-data/src/airports/khou-ground.json
 *
 * Fetches aeroway=runway/taxiway/apron ways in a bounding box around the field
 * reference and projects them onto the local tangent plane (nm, x east, y
 * north, origin = reference). Real geometry — not hand-drawn approximation.
 */
const [, , icao = "KHOU", refLatArg = "29.6454", refLonArg = "-95.2789"] = process.argv;
const REF = { lat: parseFloat(refLatArg), lon: parseFloat(refLonArg) };
const cos = Math.cos((REF.lat * Math.PI) / 180);

const box = [REF.lat - 0.021, REF.lon - 0.029, REF.lat + 0.024, REF.lon + 0.027];
const query = `[out:json][timeout:60];(way["aeroway"~"^(runway|taxiway|apron)$"](${box.join(",")}););out geom;`;

const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "User-Agent": "OpenATC-dev/1.0", "Content-Type": "application/x-www-form-urlencoded" },
  body: "data=" + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass ${res.status}`);
const els = (await res.json()).elements ?? [];

const proj = (p) => ({ x: +((p.lon - REF.lon) * 60 * cos).toFixed(4), y: +((p.lat - REF.lat) * 60).toFixed(4) });
const geom = (e) => e.geometry.map(proj);
const bearing = (a, b) => ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
const angDiff = (a, b) => {
  const x = Math.abs(a - b) % 360;
  return x > 180 ? 360 - x : x;
};
const pad = (s) => {
  const m = s.match(/^(\d+)([LRC]?)$/);
  return m ? String(m[1]).padStart(2, "0") + m[2] : s;
};

const runways = els
  .filter((e) => e.tags?.aeroway === "runway" && e.tags?.ref)
  .map((e) => {
    const g = geom(e);
    const A = g[0];
    const B = g[g.length - 1];
    const [d1, d2] = e.tags.ref.split("/");
    const bA = bearing(A, B);
    const bB = bearing(B, A);
    const assign = (des) => {
      const t = (parseInt(des) * 10) % 360;
      return angDiff(bA, t) <= angDiff(bB, t) ? A : B;
    };
    const widthFt = e.tags.width ? Math.round(parseFloat(e.tags.width) * 3.281) : 150;
    return { ends: [pad(d1), pad(d2)], centerline: [assign(d1), assign(d2)], widthFt };
  });

const taxiways = els.filter((e) => e.tags?.aeroway === "taxiway").map((e) => ({ id: e.tags?.ref || "", path: geom(e) }));

const area = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a / 2);
};
const ramps = els
  .filter((e) => e.tags?.aeroway === "apron")
  .map((e, i) => ({ id: `ap${i}`, polygon: geom(e) }))
  .filter((r) => r.polygon.length >= 3);
if (ramps.length) {
  let bi = 0;
  ramps.forEach((r, i) => {
    if (area(r.polygon) > area(ramps[bi].polygon)) bi = i;
  });
  ramps[bi].label = "TERMINAL";
}

process.stdout.write(JSON.stringify({ runways, taxiways, holdShort: [], ramps }));
process.stderr.write(`${icao}: ${runways.length} runways, ${taxiways.length} taxiways, ${ramps.length} ramps\n`);
