// app/src/components/chart/engine/objectColour.js
//
// ─── ⛔ THE ONE COLOUR GRAMMAR A DRAWING-OBJECT PROGRAM MAY CARRY ─────────────
//
// A stored definition's `objects` program (chart tables, labels, lines, boxes)
// carries colour LITERALS as plain strings, and the table renderer writes them
// into CSS (`objectTableDom.js` → `el.style.background`). Before this module any
// string was accepted, so a hand-crafted — and SHARED — definition could put
// `url(https://…)` into a recipient's page: no script, but a request the member
// never asked for (a privacy beacon). Found in the 2026-10-08 trust review.
//
// The grammar is exactly what UCT's own writers produce, measured over every
// committed program and fixture: `#RRGGBB` / `#RRGGBBAA` (the Pine translator,
// the authoring door), `#RGB` / `#RGBA`, numeric `rgb()` / `rgba()` (the
// authoring patch schema's `colour`), and the chart-theme REFERENCE
// `chart.fg_color` / `chart.bg_color` with an optional `@<transparency>`
// (`objectTheme.js`, resolved to a hex where it is painted).
//
// ⭐ ONE GRAMMAR, THREE DOORS, ONE FIXTURE. The server refuses an unsafe literal
// at save (`api/services/presentation_schema.py::object_colour_errors`, the same
// regex), `objectProgram.assertColorNode` refuses it at bind, and the renderer
// writes only a `isCssColour` value to CSS. `tests/fixtures/ast/object_colour_cases.json`
// holds all of them to the same answers.

/** A colour literal a stored object program may carry. */
export const OBJECT_COLOUR_LITERAL = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|1\.0+)\s*)?\)|chart\.(?:fg|bg)_color(?:@\d{1,3})?)$/i

/** A colour the renderer may write into CSS (a theme reference is resolved first). */
export const CSS_COLOUR = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+|1\.0+)\s*)?\)|transparent)$/i

export const isObjectColourLiteral = (s) => typeof s === 'string' && s.length <= 64 && OBJECT_COLOUR_LITERAL.test(s)
export const isCssColour = (s) => typeof s === 'string' && s.length <= 64 && CSS_COLOUR.test(s)

/** `s` when it is a CSS-safe colour, else `undefined` (the renderer's default applies). */
export const cssColourOrNone = (s) => (isCssColour(s) ? s : undefined)

// ─── ⭐ PRESENTATION COLOURS (plots, paints, colour settings) ─────────────────
//
// ⚰️ The 2026-10-08 inventory: a definition's plot / setting colours were checked only
// as "a non-empty string" (browser `defSchema`, server `presentation_schema`) and the
// legend wrote them into inline CSS — `background: url(...)` in a SHARED indicator or a
// SHARED chart layout made the recipient's browser fetch that URL. Same class as the
// table gap above, wider grammar, because these fields have more writers: everything
// UCT writes and every format measured in the repo (hex 3/4/6/8, numeric rgb/rgba,
// a few hsl, plain colour words in older code, `token:<role>[@step]` references).
//
// ⛔ Nothing here admits `(` except numeric rgb/hsl, nor `:` except the `token:` prefix,
// nor `;` — so `url()`, `var()`, `expression()` and declaration smuggling cannot pass.
// The SERVER refuses at save with the same regex
// (`presentation_schema.PRESENTATION_COLOUR`); the RENDERERS write only
// `safeCssColour` values, so even an older stored row or a shared layout draws nothing
// unsafe. Fixture: `tests/fixtures/ast/object_colour_cases.json` → "presentation".

const NUM_CHANNELS = String.raw`\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?\s*`
const HSL_CHANNELS = String.raw`\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?%\s*,\s*\d{1,3}(?:\.\d+)?%\s*`
const ALPHA = String.raw`(?:,\s*(?:0|1|0?\.\d+|1\.0+)\s*)?`

/** A colour a stored definition's presentation may carry. */
export const PRESENTATION_COLOUR = new RegExp(String.raw`^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})` +
  String.raw`|rgba?\(${NUM_CHANNELS}${ALPHA}\)|hsla?\(${HSL_CHANNELS}${ALPHA}\)` +
  String.raw`|[a-z]{3,20}|token:[a-z][a-z0-9_.-]{0,40}(?:@[a-z0-9_.-]{1,20})?)$`, 'i')

/** A colour a renderer may write into CSS: the presentation grammar minus `token:`
 *  (a reference is resolved, never written raw). */
export const SAFE_CSS_COLOUR = new RegExp(String.raw`^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})` +
  String.raw`|rgba?\(${NUM_CHANNELS}${ALPHA}\)|hsla?\(${HSL_CHANNELS}${ALPHA}\)|[a-z]{3,20})$`, 'i')

export const isPresentationColour = (s) => typeof s === 'string' && s.length <= 64 && PRESENTATION_COLOUR.test(s)

/** `s` when a renderer may write it into CSS, else `undefined` (the caller's default applies). */
export const safeCssColour = (s) => (typeof s === 'string' && s.length <= 64 && SAFE_CSS_COLOUR.test(s.trim()) ? s.trim() : undefined)
