// app/src/components/chart/comparisonUtils.js

// Curated, visually-distinct base hues. The first five are the long-standing
// comparison colors (kept so existing charts + the docked legend look unchanged);
// the rest extend the set so a full theme (10-12 names) gets a unique hue each.
export const COMPARISON_PALETTE = [
  '#60a5fa', // blue
  '#f472b6', // pink
  '#34d399', // emerald
  '#fbbf24', // amber
  '#c084fc', // purple
  '#22d3ee', // cyan
  '#fb923c', // orange
  '#a3e635', // lime
  '#f87171', // red
  '#818cf8', // indigo
  '#2dd4bf', // teal
  '#e879f9', // fuchsia
];

/**
 * Convert OHLCV bars into a {time, value} series normalized to % change from the
 * first valid bar. Skips bars with null/undefined close.
 *
 * @param {Array<{t: number, c: number}>} bars
 * @returns {Array<{time: number, value: number}>}
 */
export function normalizeToPctChange(bars) {
  if (!bars || bars.length === 0) return [];
  let baseClose = null;
  const result = [];
  for (const bar of bars) {
    const c = bar?.c;
    if (c == null || !Number.isFinite(c)) continue;
    if (baseClose === null) {
      baseClose = c;
    }
    if (baseClose === 0) {
      result.push({ time: bar.t, value: 0 });
      continue;
    }
    const pct = ((c - baseClose) / baseClose) * 100;
    result.push({ time: bar.t, value: pct });
  }
  return result;
}

// ── Hex ⇄ HSL so we can derive distinct SHADES of a base hue for overflow ──
function _hexToHsl(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim());
  if (!m) return { h: 0, s: 0, l: 50 };
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

function _hslToHex(h, s, l) {
  const sN = Math.max(0, Math.min(100, s)) / 100;
  const lN = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  const hh = ((h % 360) + 360) % 360;
  if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; } else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; } else { r = c; b = x; }
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function _shiftLightness(hex, delta) {
  const { h, s, l } = _hexToHsl(hex);
  // clamp so shades stay legible on both light + dark canvases
  return _hslToHex(h, s, Math.max(20, Math.min(82, l + delta)));
}

/**
 * Deterministic color for sequence position `i`. The first PALETTE.length are the
 * curated hues; beyond that each "band" reuses a hue but at a distinct lightness
 * (alternating lighter/darker), so no two positions ever land on an identical color
 * — a group larger than the palette still gets a unique shade per member.
 */
export function comparisonColorAt(i) {
  const len = COMPARISON_PALETTE.length;
  const idx = Math.max(0, i | 0);
  const base = COMPARISON_PALETTE[idx % len];
  const band = Math.floor(idx / len);
  if (band === 0) return base;
  const step = Math.ceil(band / 2);              // 1,1,2,2,3,3…
  const dir = band % 2 === 1 ? 1 : -1;           // odd bands lighter, even darker
  return _shiftLightness(base, dir * step * 14);
}

/**
 * Pick a comparison color for a new item. Collision-free: given the colors already
 * in use (optional), it returns the earliest sequence color not already taken, so
 * even after removals/re-adds no two live comparisons share a color. Called with a
 * bare index it stays backward-compatible (deterministic per position).
 *
 * @param {number} idx        sequence position (e.g. current item count)
 * @param {Iterable<string>=} usedColors colors already assigned (Set or array)
 */
export function pickComparisonColor(idx, usedColors) {
  const used = usedColors instanceof Set
    ? new Set([...usedColors].map(x => String(x).toLowerCase()))
    : new Set([...(usedColors || [])].map(x => String(x).toLowerCase()));
  let i = Math.max(0, idx | 0);
  for (let guard = 0; guard < 1024; guard++, i++) {
    const col = comparisonColorAt(i);
    if (!used.has(col.toLowerCase())) return col;
  }
  return comparisonColorAt(Math.max(0, idx | 0));
}
