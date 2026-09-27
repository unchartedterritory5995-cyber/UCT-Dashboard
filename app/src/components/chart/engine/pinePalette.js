// app/src/components/chart/engine/pinePalette.js
//
// ─── THE ONE AUTHORITY FOR WHAT A NAMED PINE COLOUR IS, PER `//@version=` ────
//
// ⭐⭐ MEASURED, NOT DOCUMENTED. Every hex below was read out of TradingView's own
// style state after it compiled and drew one probe script per Pine version —
// `tests/fixtures/vendor/palette-by-version-rddt-1d-2026-09-27.json`, the pin
// that `__tests__/pinePaletteVendor.test.js` holds this file to, name by name
// and version by version, through both translation lanes.
//
// ⚰️ WHAT THIS REPLACES. Until 2026-09-27 the engine carried ONE version-blind
// table (`pine.js` PINE_COLOURS). It was right for exactly one dialect: the
// 2026-09-07 correction of `color.red` to `#FF5252` came from a `@version=5`
// probe and was applied to every version. Measured against the vendor:
//
//   · v3 (bare names, `color=red`) draws PLAIN WEB COLOURS — 15 of the 17
//     differ from the modern palette (only `olive` and `white` coincide).
//   · v4 is the modern palette EXCEPT `blue`, which is `#2196F3`.
//   · v5 is the table the engine already carried, exactly.
//   · v6 is v5 EXCEPT `red` `#F23645`, `teal` `#089981`, `yellow` `#FDD835`.
//
// So the first live harness capture — a v4 script plotting two `color.blue`
// bands — graded DIVERGE on colour on every bar, and every v6 script using the
// up/down pair drew the v5 red and teal.
//
// ⛔⛔ ONE COPY. `pine.js` (the host/screener lane) and `pineRuntimeFrontend.js`
// (the runtime lane, through `pine.js`'s `colourHexByName`) and
// `versionRender.js` all DERIVE from this file. A second table anywhere is a
// second chance to carry the wrong red, and nothing would catch it: a rail that
// asserts our own constant agrees with our own constant.
//
// ⚠️ WHAT IS NOT MEASURED, AND WHAT IS DONE ABOUT IT:
//
//   · A script with NO `//@version=` annotation (the lexer reports `null`), and
//     `//@version=1` / `=2`. The vendor was not probed at those. The presentation
//     spec (C202) says an absent annotation means v1, and v1's palette is itself
//     unmeasured — so choosing any table would be a guess wearing a citation.
//     These keep the engine's PRE-EXISTING behaviour: the v5 table, which is what
//     every script resolved to before this file existed. `UNMEASURED_FALLBACK`
//     names that choice so it is findable, and `isMeasuredVersion` lets a caller
//     say so. Corpus at the time of writing: zero unannotated, zero v1/v2 scripts.
//   · SPELLING ACROSS DIALECTS. Real Pine v3 has no `color.` namespace, and the
//     modern dialects spell colours `color.x`. Our parser accepts BOTH spellings
//     in EVERY version (it did before this file, and still does). The palette is
//     chosen by the VERSION, never by the spelling — a v3 script's `color.red`
//     resolves to the v3 red, a v5 script's bare `red` to the v5 red. What
//     TradingView does with either is unmeasured (it most likely refuses to
//     compile them); corpus at the time of writing: zero scripts do either.
//   · `grey` was not probed. Pine documents it as an alias of `gray`, and it is
//     resolved as `gray` at every version.

/** The vendor's measured palettes. Keys are the names without `color.`.
 *
 *  ⭐ v5 IS WRITTEN OUT and v4/v6 are written as their measured DIFFERENCE from
 *  it, so the structure of the finding is visible in the code: two dialects that
 *  differ from v5 by one and three constants respectively. The pin checks every
 *  name at every version anyway, so a delta cannot hide a drift.
 *
 *  ⚠️ CASE. The vendor answers `#2962ff` lowercase for blue under v5/v6 and
 *  uppercase everywhere else; every comparison of these is case-insensitive.
 *  The engine keeps `#2962FF` because that is the spelling every saved
 *  definition and committed digest already carries — changing the case would be
 *  a byte-level change to every v5 document for no pixel difference. */
const V5 = Object.freeze({
  aqua: '#00BCD4', black: '#363A45', blue: '#2962FF', fuchsia: '#E040FB',
  gray: '#787B86', green: '#4CAF50', lime: '#00E676', maroon: '#880E4F',
  navy: '#311B92', olive: '#808000', orange: '#FF9800', purple: '#9C27B0',
  red: '#FF5252', silver: '#B2B5BE', teal: '#00897B', white: '#FFFFFF',
  yellow: '#FFEB3B',
})

const V3 = Object.freeze({
  aqua: '#00FFFF', black: '#000000', blue: '#0000FF', fuchsia: '#FF00FF',
  gray: '#808080', green: '#008000', lime: '#00FF00', maroon: '#800000',
  navy: '#000080', olive: '#808000', orange: '#FF7F00', purple: '#800080',
  red: '#FF0000', silver: '#C0C0C0', teal: '#008080', white: '#FFFFFF',
  yellow: '#FFFF00',
})

export const PALETTE_BY_VERSION = Object.freeze({
  3: V3,
  4: Object.freeze({ ...V5, blue: '#2196F3' }),
  5: V5,
  6: Object.freeze({ ...V5, red: '#F23645', teal: '#089981', yellow: '#FDD835' }),
})

/** The versions the vendor was actually probed at. */
export const MEASURED_VERSIONS = Object.freeze(Object.keys(PALETTE_BY_VERSION).map(Number))

/** What an unmeasured version (no annotation, v1, v2) resolves to: the engine's
 *  pre-existing behaviour, NOT a claim about the vendor. See the header. */
export const UNMEASURED_FALLBACK = 5

/** The 17 colour names, as the vendor names them. */
export const PINE_COLOUR_NAMES = Object.freeze(Object.keys(V5))

/** Documented aliases. `grey` was not probed; Pine documents it as `gray`. */
const ALIASES = Object.freeze({ grey: 'gray' })

export const isMeasuredVersion = (version) => Object.hasOwn(PALETTE_BY_VERSION, version)

/** The palette a script of this version draws with. */
export function paletteFor(version) {
  return isMeasuredVersion(version) ? PALETTE_BY_VERSION[version] : PALETTE_BY_VERSION[UNMEASURED_FALLBACK]
}

/** `'red'`, `'grey'` → `'red'`, `'gray'`; anything else → null. Exact spelling:
 *  Pine identifiers are case-sensitive, so `Red` is not a colour here. */
function canonicalName(bare) {
  if (Object.hasOwn(V5, bare)) return bare
  if (Object.hasOwn(ALIASES, bare)) return ALIASES[bare]
  return null
}

/** Does this spelling — `color.red` or bare `red` — name a Pine colour at all?
 *  Version-independent: every dialect has the same seventeen names. */
export function isPineColourSpelling(name) {
  if (typeof name !== 'string') return false
  const bare = name.startsWith('color.') ? name.slice('color.'.length) : name
  return canonicalName(bare) !== null
}

/** The BARE spelling only (`red`, not `color.red`) — the one a member's own
 *  variable can shadow. */
export const isBareColourSpelling = (name) => (typeof name === 'string'
  && !name.startsWith('color.') && canonicalName(name) !== null)

/**
 * A named colour's hex at a script's version.
 *
 * @param {string} name     `color.red` or `red` (either spelling, any version —
 *                          see the header for why the version, not the spelling,
 *                          decides)
 * @param {number|null} version  the script's `//@version=`, or null if it has none
 * @returns {string|null}   `#RRGGBB`, or null when the spelling is not a colour
 */
export function pineColourHex(name, version) {
  if (typeof name !== 'string') return null
  const bare = name.startsWith('color.') ? name.slice('color.'.length) : name
  const key = canonicalName(bare)
  return key === null ? null : paletteFor(version)[key]
}
