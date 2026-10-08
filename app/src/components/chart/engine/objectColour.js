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
