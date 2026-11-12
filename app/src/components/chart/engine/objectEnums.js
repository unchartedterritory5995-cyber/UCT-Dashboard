// app/src/components/chart/engine/objectEnums.js
//
// ─── ⭐⭐ ENGINE 51 — EVERY CONSTANT A DRAWING'S ENUM SLOT CAN HOLD, ONE TABLE ──
//
// `pine.js::objectEnumValue` turns `label.style_label_down` into the word the
// object program carries (`label_down`), for both lanes (the runtime frontend
// asks the same function). Until engine 51 it held the line / size / position
// families literally and let ANY `label.style_*` (and `box.style_*`) through by a
// regular expression, keeping whatever followed the underscore. So the v4 spelling
// `label.style_labeldown` reached the renderer as `labeldown`, a word it does not
// know, and the label was drawn centred with no pointer; TradingView records
// `label_down` for it (vendor capture `extrapolated-pivot-connector-{rddt,spy}`).
//
// ⭐ ONE TABLE, by namespace, each constant's word. The namespaces and their
// members are the Pine v6 reference's (`docs/pine/pine-v6-constants.md`, the
// extraction table; `objectEnums.test.js` parses that file and fails if a member
// it lists is missing here). The renderer's own vocabulary is railed against it
// too (`objectCanvas.js::LABEL_ANCHOR`).
// ⭐ A LEGACY SPELLING is an alias of a v6 constant, kept only where a capture
// witnesses what TradingView draws for it:
//   label.style_labelup   → label_up     (extrapolated-pivot-connector: recorded `lup`)
//   label.style_labeldown → label_down   (extrapolated-pivot-connector: recorded `ldn`)
// ⛔ ANYTHING ELSE IS NOT A WORD. `objectEnumValue` answers `undefined`, and an enum
// slot holding a name it cannot read is WITHHELD by name (`enumNaRule.js`,
// `pine:enum-unreadable`), never drawn with the renderer's default.

/** Namespace → { constant suffix → the word the object program carries }. */
export const OBJECT_ENUM_TABLE = Object.freeze({
  xloc: Object.freeze({ bar_index: 'bar_index', bar_time: 'bar_time' }),
  yloc: Object.freeze({ price: 'price', abovebar: 'abovebar', belowbar: 'belowbar' }),
  extend: Object.freeze({ none: 'none', right: 'right', left: 'left', both: 'both' }),
  line: Object.freeze({
    style_solid: 'solid', style_dashed: 'dashed', style_dotted: 'dotted',
    style_arrow_left: 'arrow_left', style_arrow_right: 'arrow_right', style_arrow_both: 'arrow_both',
  }),
  label: Object.freeze({
    style_none: 'none', style_xcross: 'xcross', style_cross: 'cross',
    style_triangleup: 'triangleup', style_triangledown: 'triangledown', style_flag: 'flag',
    style_circle: 'circle', style_arrowup: 'arrowup', style_arrowdown: 'arrowdown',
    style_label_up: 'label_up', style_label_down: 'label_down', style_label_left: 'label_left',
    style_label_right: 'label_right', style_label_lower_left: 'label_lower_left',
    style_label_lower_right: 'label_lower_right', style_label_upper_left: 'label_upper_left',
    style_label_upper_right: 'label_upper_right', style_label_center: 'label_center',
    style_square: 'square', style_diamond: 'diamond', style_text_outline: 'text_outline',
  }),
  size: Object.freeze({ auto: 'auto', tiny: 'tiny', small: 'small', normal: 'normal', large: 'large', huge: 'huge' }),
  text: Object.freeze({
    align_left: 'left', align_center: 'center', align_right: 'right', align_top: 'top', align_bottom: 'bottom',
    // ⭐ A CLOSED THREE-NAME VOCABULARY. `text.format_bold + text.format_italic` is
    // not a name and does not resolve here (`pine.js` reads the sum on its own).
    format_none: 'none', format_bold: 'bold', format_italic: 'italic',
    wrap_auto: 'auto', wrap_none: 'none',
  }),
  position: Object.freeze({
    top_left: 'top_left', top_center: 'top_center', top_right: 'top_right',
    middle_left: 'middle_left', middle_center: 'middle_center', middle_right: 'middle_right',
    bottom_left: 'bottom_left', bottom_center: 'bottom_center', bottom_right: 'bottom_right',
  }),
  font: Object.freeze({ family_default: 'default', family_monospace: 'monospace' }),
})

/** Legacy spellings → the v6 constant they mean (witnessed, see the header). */
export const LEGACY_OBJECT_ENUMS = Object.freeze({
  'label.style_labelup': 'label.style_label_up',
  'label.style_labeldown': 'label.style_label_down',
})

/** Fully qualified constant → word, derived from the two tables above. */
export const OBJECT_ENUM_VALUES = Object.freeze((() => {
  const out = {}
  for (const [ns, members] of Object.entries(OBJECT_ENUM_TABLE)) {
    for (const [suffix, word] of Object.entries(members)) out[`${ns}.${suffix}`] = word
  }
  for (const [legacy, v6] of Object.entries(LEGACY_OBJECT_ENUMS)) {
    if (!Object.hasOwn(out, v6)) throw new Error(`objectEnums: legacy ${legacy} names unknown ${v6}`)
    out[legacy] = out[v6]
  }
  return out
})())

/** The words a label's `style` can carry (what the renderer must know). */
export const LABEL_STYLE_WORDS = Object.freeze([...new Set(Object.values(OBJECT_ENUM_TABLE.label))])
