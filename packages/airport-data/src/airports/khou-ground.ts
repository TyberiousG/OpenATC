import type { GroundLayout } from "../types.js";
import raw from "./khou-ground.json";

/**
 * KHOU surface geometry, generated from OpenStreetMap data (aeroway=runway /
 * taxiway / apron) and projected onto the local tangent plane (nm, x east,
 * y north, origin = field reference). Regenerate with scripts/gen-ground if the
 * source changes. This is real geometry, not hand-drawn approximation.
 */
export const KHOU_GROUND: GroundLayout = raw as unknown as GroundLayout;
