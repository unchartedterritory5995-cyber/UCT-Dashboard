/**
 * ⭐⭐ ENGINE 51 (review of #1149, low 7) — EVERY DRAWING SETTER'S PARAMETER NAMES, AS
 * PINE'S REFERENCE SPELLS THEM, after the handle (`id`; `table_id` for a table).
 *
 * ONE table, read by both lanes: the host lane's statement reader (`placeObjectArgs`,
 * `ast/pineObjects.js`) and the runtime lane's call lowering (`lowerObjectCall`,
 * `ast/pineRuntimeFrontend.js`). A named argument is placed by THIS name and no other:
 * `label.set_text(lb, txt = "a")` and `line.set_color(l, colour = c)` are calls
 * TradingView refuses to compile, so neither lane reads them; and the property a setter
 * writes is not its parameter's name (`box.set_bgcolor(id, color)` writes `bgcolor`).
 *
 * ⚰️ Both lanes had a rule that a one-property setter takes its value under ANY name but
 * the handle's, which drew the two calls above as if they were right.
 *
 * Each list is in argument order and has exactly as many names as the setter writes
 * properties (`SETTER_PROPS`, `objectStore` `SETTERS`); `objectSetterParams.test.js`
 * pins both, and every signature `docs/pine/pine-presentation-spec.md` writes out.
 */
const f = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])))

export const SETTER_PINE_PARAMS = Object.freeze({
  line: f({
    set_x1: ['x'], set_y1: ['y'], set_x2: ['x'], set_y2: ['y'],
    set_xy1: ['x', 'y'], set_xy2: ['x', 'y'], set_xloc: ['x1', 'x2', 'xloc'],
    set_color: ['color'], set_width: ['width'], set_style: ['style'], set_extend: ['extend'],
  }),
  label: f({
    set_x: ['x'], set_y: ['y'], set_xy: ['x', 'y'], set_xloc: ['x', 'xloc'], set_yloc: ['yloc'],
    set_text: ['text'], set_color: ['color'], set_textcolor: ['textcolor'], set_style: ['style'],
    set_size: ['size'], set_textalign: ['textalign'], set_tooltip: ['tooltip'],
    set_text_font_family: ['text_font_family'], set_text_formatting: ['text_formatting'],
  }),
  box: f({
    set_left: ['left'], set_top: ['top'], set_right: ['right'], set_bottom: ['bottom'],
    set_lefttop: ['left', 'top'], set_rightbottom: ['right', 'bottom'],
    set_xloc: ['left', 'right', 'xloc'],
    set_bgcolor: ['color'], set_border_color: ['color'], set_border_width: ['width'],
    set_border_style: ['style'], set_extend: ['extend'], set_text: ['text'],
    set_text_color: ['text_color'], set_text_size: ['text_size'], set_text_halign: ['text_halign'],
    set_text_valign: ['text_valign'], set_text_wrap: ['text_wrap'],
    set_text_font_family: ['text_font_family'], set_text_formatting: ['text_formatting'],
  }),
  table: f({
    set_position: ['position'], set_bgcolor: ['bgcolor'], set_frame_color: ['frame_color'],
    set_frame_width: ['frame_width'], set_border_color: ['border_color'],
    set_border_width: ['border_width'],
  }),
  linefill: f({ set_color: ['color'] }),
})

/** The Pine parameter names of `<family>.<method>` after the handle, or null when the
 *  table has no such setter. */
export function setterPineParams(family, method) {
  const fam = Object.hasOwn(SETTER_PINE_PARAMS, family) ? SETTER_PINE_PARAMS[family] : null
  return fam && Object.hasOwn(fam, method) ? fam[method] : null
}

/** The same for a method whose family is not known (`x.set_color(…)`): answerable only
 *  when every family in `families` that defines it spells it the same way. */
export function setterPineParamsOfAny(method, families) {
  let out = null
  for (const fam of families || []) {
    const p = setterPineParams(fam, method)
    if (!p) return null
    if (out === null) out = p
    else if (out.length !== p.length || out.some((x, i) => x !== p[i])) return null
  }
  return out
}
