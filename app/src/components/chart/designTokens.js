// app/src/components/chart/designTokens.js
//
// ─── The indicator design-token system ───────────────────────────────────────
//
// WHY THIS IS JAVASCRIPT AND NOT CSS
// ----------------------------------
// Chart canvas colours come from JS, not from CSS. The four chart presets
// (`classic` / `oled` / `tradingview` / `light`) live in `chartDefaults.js`
// PRESETS and set `background` / `textColor` / `grid.color` as plain JS values;
// `lightThemePalette.js` + StockChart then layer theme colours over `cs` and
// hand them to Lightweight Charts. The `[data-theme]` blocks in
// `app/src/styles/tokens.css` are a DIFFERENT system that never reaches the
// canvas — and the two systems do not even line up: `tradingview` has no CSS
// counterpart at all, and `dim` has no chart preset. So a CSS-only token system
// would resolve to nothing on the canvas, which is precisely where indicators
// draw. Hence: a JS resolver is the source of truth for canvas colour, and
// tokens.css carries only the handful of `--ind-*` vars needed by DOM chrome
// (legend chips, dialogs, the Style tab) so that chrome can match without
// re-implementing the ramp.
//
// OWNER-LOCKED RULES (discovered in tokens.css — do not "fix" these)
// -----------------------------------------------------------------
// 1. TYPOGRAPHY IS INSTRUMENT SANS, NEVER MONO. tokens.css carries an explicit
//    warning at `--font-mono`: numbers/tickers/prices intentionally render in
//    the UI font (Instrument Sans), NOT a true monospace — a prior sweep
//    "fixed" this to JetBrains Mono and turned every price/table typewriter.
//    `--font-mono` is deliberately aliased to Instrument Sans. DO NOT repoint
//    any indicator label, legend chip, or axis readout to a mono stack. Tabular
//    figures come from the `.t-mono` utility, which supplies
//    `font-variant-numeric: tabular-nums` on top of the same Instrument Sans —
//    that is the correct way to get column-aligned digits here.
// 2. GOLD IS THE PREMIUM BRAND COLOUR, NOT A WARNING. See below.
//
// WARN ≠ PREMIUM — the load-bearing rule
// --------------------------------------
// `--warn` in tokens.css is literally aliased to `--ut-gold` (`#c9a84c`) in the
// dark `:root` AND to `#7a5c16` in the light theme — i.e. warning and premium
// brand are the SAME value today. Mapping `warn -> --warn` would therefore ship
// exactly the conflation the design spec forbids ("gold ≠ warning"), so this
// module introduces a genuinely new amber instead. `designTokens.test.js` fails
// if any preset ever makes `warn === premium` again.
//
// HOW THE AMBER WAS CHOSEN (measured, not eyeballed)
// -------------------------------------------------
// Selection maximised the MINIMUM CIEDE2000 distance from every other semantic
// role, per preset, subject to WCAG contrast >= 4.5 on that preset's canvas.
//   dark  `#ff8100`: dE00 21.9 from gold `#c9a84c`; >= 21.8 from EVERY other
//                    semantic role (bear/neutral/info in all three dark
//                    presets); contrast >= 7.15 on #0e0f0d / #000000 / #131722.
//   light `#d14803`: dE00 25.4 from the light gold `#7a5c16`; >= 25.3 from
//                    every other light role; contrast 4.53 on #ffffff.
// For scale: the tightest pair the palette already ships as "distinct" is
// gold↔neutral at dE00 21.4, and the amber clears that bar. The value the
// design brief proposed (`#d98324`) measured only 16.4 from gold — and just
// 3.8–5.0 once composited at the fill alphas below, i.e. effectively
// indistinguishable from gold as a zone fill. That is why it was not used.
// The light variant is deliberately hue-shifted (30° -> 20°) rather than merely
// darkened: the light gold `#7a5c16` is a dark olive, so a same-hue darkening
// of the dark amber (`#b35a00`) collapses to dE00 16.6 against it.
//
// KNOWN, ACCEPTED ADJACENCY: every preset also ships an ORANGE moving-average
// default (`#fb923c` SMA-200 in classic/oled, `#ff9800` SMA-50 in
// tradingview/light), and `warn` sits within dE00 4.5–7.7 of those. This is
// unavoidable, not an oversight: an exhaustive search shows the best colour that
// clears both the semantic roles AND both MA oranges is `#aa744e` — a muted
// taupe that is not an amber at all, and which scores WORSE (17.5) on the
// semantic axis that the spec actually cares about. MA defaults are thin,
// continuous, user-editable lines; `warn` is a discrete marker/zone. Separating
// the semantic roles wins.
//
// CONSISTENCY CONTRACT WITH chartDefaults.js
// ------------------------------------------
// Per preset, `surface` IS that preset's canvas `background` and `ink` IS its
// `textColor`, copied from `chartDefaults.js` PRESETS. They are duplicated here
// (rather than imported) so this module stays a pure, dependency-free palette —
// but they must not drift, and `designTokens.test.js` asserts the equality
// against PRESETS so a future edit to either file fails the suite.
// `inkMuted` is a dimmed `ink` for secondary labels — dimmer than `ink` but
// still legible: contrast >= 2.8 on its own surface, measured per preset.
// `neutral` is a PLOT colour, not text, and clears contrast >= 5.2 on every
// canvas; on the three dark presets it deliberately out-contrasts `ink` so a
// neutral series reads above the axis labels.

// ─── Semantic palette, per chart preset ──────────────────────────────────────
// Roles: bull, bear, neutral, warn, info, premium, ink, inkMuted, surface.
//
// `bull`/`bear` follow each preset's own identity (classic uses the app's
// --gain/--loss; oled/tradingview use their own candle colours) so an indicator
// reads as part of the chart it is drawn on. `premium` stays the UCT brand gold
// everywhere it is legible — it means "premium/brand", never "caution".

/** The new amber. NOT gold — see the header. Dark presets. */
const AMBER = '#ff8100'
/** Darker amber for the light canvas, hue-shifted off the light gold. */
const AMBER_DARK = '#d14803'
/** UCT brand gold (`--ut-gold`) = the `premium` role, never `warn`. */
const GOLD = '#c9a84c'
/** The light theme's darkened gold (`--ut-gold` inside `[data-theme="light"]`). */
const GOLD_DARK = '#7a5c16'

export const IND_TOKENS = Object.freeze({
  classic: Object.freeze({
    bull: '#3cb868',      // --gain
    bear: '#e74c3c',      // --loss
    neutral: '#8a8574',
    warn: AMBER,
    info: '#6ba3be',      // --info
    premium: GOLD,        // --ut-gold
    ink: '#706b5e',       // == PRESETS.classic.settings.textColor
    inkMuted: '#605b50',
    surface: '#0e0f0d',   // == PRESETS.classic.settings.background
  }),
  oled: Object.freeze({
    bull: '#00c853',      // preset candle up
    bear: '#ff1744',      // preset candle down
    neutral: '#7f7f7f',
    warn: AMBER,
    info: '#4fc3f7',
    premium: GOLD,
    ink: '#666666',       // == PRESETS.oled.settings.textColor
    inkMuted: '#575757',
    surface: '#000000',   // == PRESETS.oled.settings.background
  }),
  tradingview: Object.freeze({
    bull: '#26a69a',      // preset candle up
    bear: '#ef5350',      // preset candle down
    neutral: '#9598a1',
    warn: AMBER,
    // TradingView's accent blue. Deliberately NOT #2196f3 — that is this
    // preset's own EMA-9 overlay default, so `info` would have been an exact
    // duplicate of a line already on the chart.
    info: '#2962ff',
    premium: GOLD,
    ink: '#787b86',       // == PRESETS.tradingview.settings.textColor
    inkMuted: '#5d606b',
    surface: '#131722',   // == PRESETS.tradingview.settings.background
  }),
  light: Object.freeze({
    // The light theme's darkened accents (tokens.css `[data-theme="light"]`) —
    // the bright dark-theme values are unreadable on white.
    bull: '#0a5c22',      // --gain (light)
    bear: '#7d1620',      // --loss (light)
    neutral: '#6f6a5c',
    warn: AMBER_DARK,
    info: '#1f5d7a',      // --info (light)
    premium: GOLD_DARK,   // --ut-gold (light)
    ink: '#555555',       // == PRESETS.light.settings.textColor
    inkMuted: '#8a8a8a',
    surface: '#ffffff',   // == PRESETS.light.settings.background
  }),
})

/** Fallback preset when a caller passes an unknown/absent preset name. Keeps the
 *  canvas painted rather than returning null just because a stored settings blob
 *  carries an unrecognised `preset` value. */
const DEFAULT_PRESET = 'classic'

// ─── The named opacity ramp ──────────────────────────────────────────────────
// Replaces the ad-hoc 8-digit-hex alpha suffixes used elsewhere (`15` ~= 8%,
// `35` ~= 21%). Ascending by construction — the test asserts it, so a new step
// must be inserted in sorted position.
export const ALPHA = Object.freeze({
  'fill-faint': 0.08,   // spent / invalidated zones, faintest wash
  fill: 0.12,           // ordinary zone fill
  band: 0.16,           // active zone / channel band
  emphasis: 0.24,       // hovered or selected
  glow: 0.35,           // marker halo, alert pulse
  solid: 1,             // strokes, markers, text
})

// ─── Marker + zone + width vocabularies (locked) ─────────────────────────────
// Frozen so a downstream Style tab cannot silently extend the vocabulary; add a
// shape here and everything that renders markers picks it up in one place.
export const MARKER_SHAPES = Object.freeze([
  'triangle-up',
  'triangle-down',
  'circle',
  'diamond',
  'square',
  'cross',
])

export const MARKER_SIZES = Object.freeze({ s: 8, m: 11, l: 14 })

// Zone lifecycle. `alpha` is a key into ALPHA; `role` overrides the zone's own
// colour role when non-null (an invalidated zone greys out — it no longer
// carries a bull/bear opinion). Key order is part of the contract.
export const ZONE_STATES = Object.freeze({
  forming:     Object.freeze({ alpha: 'fill',       border: 'dashed', borderWidth: 1,   role: null }),
  active:      Object.freeze({ alpha: 'band',       border: 'solid',  borderWidth: 1.5, role: null }),
  mitigated:   Object.freeze({ alpha: 'fill-faint', border: 'dotted', borderWidth: 1,   role: null }),
  invalidated: Object.freeze({ alpha: 'fill-faint', border: 'dotted', borderWidth: 1,   role: 'neutral' }),
})

export const LINE_WIDTHS = Object.freeze([1, 1.5, 2])

// ─── Resolver ────────────────────────────────────────────────────────────────

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Parse a hex colour to [r, g, b, a]. Returns null if it isn't one. */
function parseHex(hex) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return null
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return [r, g, b, a]
}

/**
 * Apply an alpha to a colour. Handles hex (3/4/6/8-digit) and rgb()/rgba().
 * An alpha already carried by the colour is multiplied through, so
 * `#ff000080@band` dims rather than brightens. Returns null if unparseable.
 *
 * EXPORTED for `engine/pool.js`, which needs the same multiply-through rule for
 * two things `resolveToken` cannot express: a `plots[].opacity` applied to an
 * already-resolved literal colour (the ref may have been a raw `#rrggbb`, never a
 * `token:` at all), and an area/baseline plot's FILL, which is the line's colour
 * at a lower alpha. A second implementation of "dim this colour" is exactly the
 * kind of drift this module exists to prevent.
 */
export function withAlpha(color, alpha) {
  const hex = parseHex(color)
  if (hex) {
    const [r, g, b, a] = hex
    return `rgba(${r}, ${g}, ${b}, ${round(a * alpha)})`
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    typeof color === 'string' ? color.trim() : '',
  )
  if (!m) return null
  const a = m[4] === undefined ? 1 : parseFloat(m[4])
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${round(a * alpha)})`
}

/** Trim float noise (0.16 * 1 must serialise as "0.16", not "0.16000000000002"). */
function round(n) {
  return Math.round(n * 1e4) / 1e4
}

/**
 * Resolve a colour reference to a CSS colour string.
 *
 *   resolveToken('token:bull', 'classic')       -> '#3cb868'
 *   resolveToken('token:bull@band', 'classic')  -> 'rgba(60, 184, 104, 0.16)'
 *   resolveToken('#ff0000', 'classic')          -> '#ff0000'   (raw passthrough)
 *   resolveToken('token:nope', 'classic')       -> null
 *
 * Anything that is not a `token:` reference is returned UNCHANGED, so a stored
 * literal colour keeps working alongside token refs during the B3 migration.
 *
 * Returns `null` — never a plausible-but-wrong colour — on any miss (unknown
 * role, unknown ramp step, unparseable value). The caller decides whether that
 * means "skip this plot" or "fall back"; silently substituting a wrong colour
 * would ship a mislabelled indicator, which is worse than not drawing it.
 *
 * `@solid` returns the base colour unchanged rather than a pointless
 * `rgba(..., 1)`.
 */
export function resolveToken(ref, preset) {
  if (typeof ref !== 'string') return null
  const raw = ref.trim()
  if (!raw.startsWith('token:')) return ref   // raw passthrough, byte-for-byte untouched

  const body = raw.slice('token:'.length)
  const at = body.indexOf('@')
  const role = (at === -1 ? body : body.slice(0, at)).trim()
  const step = at === -1 ? null : body.slice(at + 1).trim()

  const map = IND_TOKENS[preset] || IND_TOKENS[DEFAULT_PRESET]
  const color = Object.prototype.hasOwnProperty.call(map, role) ? map[role] : undefined
  if (!color) return null

  if (step === null) return color
  if (!Object.prototype.hasOwnProperty.call(ALPHA, step)) return null

  const alpha = ALPHA[step]
  if (alpha >= 1) return color
  return withAlpha(color, alpha)
}

/**
 * Resolve a ZONE_STATES entry against a colour role, in one call.
 * Returns `null` for an unknown state or role, matching resolveToken.
 */
export function resolveZone(role, state, preset) {
  const spec = Object.prototype.hasOwnProperty.call(ZONE_STATES, state) ? ZONE_STATES[state] : null
  if (!spec) return null
  const effectiveRole = spec.role || role
  const fill = resolveToken(`token:${effectiveRole}@${spec.alpha}`, preset)
  const border = resolveToken(`token:${effectiveRole}`, preset)
  if (!fill || !border) return null
  return { fill, border, borderStyle: spec.border, borderWidth: spec.borderWidth }
}
