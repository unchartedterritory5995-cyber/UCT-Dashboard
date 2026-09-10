/* What settings does a drawing tool have? One table, asked by the menu.
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * `DrawingContextMenu` decided what to render from a handful of booleans its
 * caller computed and passed down — `levelSupported`, `horizontalSupported`,
 * `alertSupported`, `isText`, plus the presence or absence of four handler
 * props. Every row was `{cond && <MenuAction …/>}` inside a 370-line component,
 * and the conditions themselves lived at the CALL SITE, a thousand lines away in
 * the overlay. Adding a setting meant editing both.
 *
 * The revamp adds roughly twenty tool-specific settings. Twenty more booleans
 * threaded through two files is how a menu becomes the second monolith, so the
 * question moves into a table: a tool DECLARES what it supports, and the menu
 * renders whatever it finds.
 *
 * ─── THE SHAPE ──────────────────────────────────────────────────────────────
 *
 *   type → sections → control ids → CONTROLS[id] → a rendered row
 *
 * ⛔ SECTIONS ARE DECLARED IN A FIXED ORDER AND EMPTY ONES NEVER RENDER. The
 * order below (style · appearance · label · text · advanced · actions) is the
 * long-term one; Phase 3 only fills `style`, `text`, `advanced` and `actions`,
 * because those are the controls that exist today. A section with nothing in it
 * is not a heading with nothing under it — it is absent.
 *
 * ⛔ AND PHASE 3 ADDS NO SETTINGS. Every entry here is a control the shipped
 * menu already rendered, under exactly the conditions it already used.
 * `drawingSettingsSchema.test.js` compares this table against those conditions,
 * transcribed from the pre-migration source, for all 21 drawing types — so the
 * migration is provably capability-neutral rather than believed to be.
 *
 * ─── WHAT PHASE 4 ADDED, AND WHAT IT DID NOT ────────────────────────────────
 *
 * ⭐ SEVEN SETTINGS, SIX TABLE ENTRIES, ONE NEW WIDGET FAMILY, AND NOT ONE `if
 * (type === …)` IN THE MENU. Horizontal Line and Horizontal Ray gained a price
 * label; Rectangle gained a separate fill and a percent label; Arrow gained a
 * size. In `DrawingContextMenu` that cost two generic widgets (`toggle`,
 * `choice`) plus teaching the existing colour row to edit a NAMED property. The
 * renderer still walks whatever `sectionsFor` returns and knows nothing about
 * rectangles.
 *
 * ⛔ `prop` IS WHAT MADE THAT POSSIBLE. A control that edits one property of the
 * drawing NAMES that property, so one `toggle` widget serves "Show price label"
 * and "Show percent change" and every later one, through a single
 * `onSetProp(name, value)` handler. Without it each setting would have needed its
 * own prop threaded from the overlay — which is the ladder Phase 3 tore out.
 */

import { ARROW_SIZES, DEFAULT_ARROW_SIZE } from './drawingStyle'
import { DEFAULT_LABEL_POS, LABEL_POSITIONS, fieldOn, labelPosOf } from './drawingMeasure'
import { DEFAULT_TEXT_BG } from './drawingText'
import { hasFibOverrides } from './drawingFib'

/** Fixed render order. A tool's sections are emitted in this order regardless of
 *  how its entry is written, so no tool can accidentally invent its own layout. */
// ⭐ `text` SITS BEFORE `appearance` BECAUSE OF WHAT THEY MEAN, not because of
// who uses them. A tool's own substance comes first — the note's words and how
// they are set — and the box drawn AROUND that substance comes after. Text Note
// is the only tool that declares both, so this reorders nothing else; it is
// stated here rather than special-cased there.
export const SECTION_ORDER = ['style', 'text', 'appearance', 'label', 'advanced', 'actions']

/** Headings. ⛔ ONLY WHERE A SECTION NEEDS ONE. `style` and `actions` are the
 *  menu's spine and have never carried a caption; a shape's Border/Fill pair and
 *  a line's label toggles are new groupings, and a two-word caption is what makes
 *  them read as a group rather than as more rows. */
export const SECTION_TITLES = Object.freeze({
  appearance: 'Appearance',
  label: 'Label',
  text: 'Text',
})

/**
 * Every control the drawing menu can render.
 *
 * `kind` tells the renderer which widget to draw. `action` and `toggle` are the
 * vocabulary `ChartContextMenu` already uses; `custom` is this menu's escape
 * hatch for the four widgets that are not rows at all (a colour row with a live
 * line preview, a font stepper, a price input, an alert direction picker).
 *
 * `needs` is the handler a control cannot work without — the menu omits the row
 * rather than rendering something inert. That is how the shipped menu behaved
 * (`{onToggleHide && …}`), now stated once instead of at each row.
 *
 * `persists` is what "Save as default" writes when a tool has this control. It
 * lives HERE, beside the control, because that is the only place that can stay
 * true: when Phase 6 drops `lineWidth` from the Text Note's colour row, the
 * saved payload has to stop carrying it, and it will, without anyone
 * remembering to go and look.
 */
/**
 * ⛔ A LABEL TOOL SHOWING NOTHING IS NOT A TOOL. Price Move IS its label — turn
 * off both the dollar and the percent and the drawing still exists, still takes
 * up a slot in the Objects manager, and is completely invisible and
 * unselectable on the chart. So the last visible field refuses to switch off.
 *
 * ⭐ MEASURE IS EXEMPT, AND THAT IS NOT AN INCONSISTENCY. Its box is drawn
 * whatever the toggles say, so a Measure with every field off is still a
 * perfectly usable region marker — a thing people actually want. The rule
 * follows "can you still see and grab it", not "is this the same control".
 */
const MOVE_FIELDS = ['showDollar', 'showPercent']
const isLastVisibleMoveField = (drawing, prop) => {
  if (drawing?.type !== 'advance') return false
  const on = MOVE_FIELDS.filter((p) => fieldOn(drawing, p))
  return on.length <= 1 && on[0] === prop
}

export const CONTROLS = Object.freeze({
  // ── style ──
  color: {
    id: 'color', kind: 'custom', widget: 'colorRow', label: 'Color',
    // The row opens ColorPanel, which edits all three at once — so all three are
    // what this control means, and all three are what it saves.
    persists: ['color', 'lineWidth', 'lineStyle'],
  },

  // ── appearance ──
  //
  // ⛔ "BORDER" IS THE SAME WIDGET AND THE SAME PROPERTIES AS "COLOR" — only the
  // word changes. A Rectangle's outline colour IS `d.color`; giving it a second
  // `borderColor` control would have put two rows in one menu that do the same
  // thing, and would have needed a migration to decide which of them an existing
  // rectangle obeys. Instead the shape's menu says what the user is looking at:
  // **Border** = the outline (colour, width, line style), **Fill** = the inside
  // tint. Same storage, same backward compatibility, no duplicate control.
  border: {
    id: 'border', kind: 'custom', widget: 'colorRow', label: 'Border',
    persists: ['color', 'lineWidth', 'lineStyle'],
  },
  fill: {
    id: 'fill', kind: 'custom', widget: 'colorRow', label: 'Fill',
    // ⭐ THE PICKER'S OPACITY SLIDER *IS* THE FILL OPACITY. ColorPanel emits
    // `#rrggbbaa`, so the alpha the user chose travels inside the colour. A
    // separate "Fill opacity" row would be a second control for one fact, and
    // the two would disagree the moment either was touched.
    prop: 'fillColor', needs: 'onSetProp',
    // No line preview: a fill has no width or dash.
    line: false,
    // `fillOpacity` rides along so a tool that later grows a numeric slider
    // saves it too; today it is absent on every rectangle and resolves to 1.
    persists: ['fillColor', 'fillOpacity'],
  },

  // ── label: the measurement family ──
  //
  // ⭐ FOUR INDEPENDENT FIELDS, NOT THREE BUNDLED PRESETS. The shipped Measure
  // decided its own content from its TYPE — `measure` printed price and bars,
  // `priceRange` printed price, `dateRange` printed bars — so a user who wanted
  // "percent and time, nothing else" had no combination of tools that produced
  // it. Each field is now its own switch and every one of the sixteen
  // combinations is reachable.
  //
  // ⛔ `resolve` EXISTS BECAUSE THE DEFAULT IS PER TYPE. A plain
  // `drawingProp(d, 'showDollar')` would report OFF for every Measure drawn
  // before Phase 5 — and then the menu would say "off" while the canvas showed
  // the number. `fieldOn` asks the same authority the painter asks.
  showDollar: {
    id: 'showDollar', kind: 'custom', widget: 'toggle', label: 'Show dollar change',
    prop: 'showDollar', needs: 'onSetProp', resolve: (d) => fieldOn(d, 'showDollar'),
    lockedWhen: (ctx) => isLastVisibleMoveField(ctx.drawing, 'showDollar'),
    lockedHint: 'A Price Move must show at least one figure',
    persists: ['showDollar'],
  },
  showPercentMove: {
    id: 'showPercentMove', kind: 'custom', widget: 'toggle', label: 'Show percent change',
    prop: 'showPercent', needs: 'onSetProp', resolve: (d) => fieldOn(d, 'showPercent'),
    lockedWhen: (ctx) => isLastVisibleMoveField(ctx.drawing, 'showPercent'),
    lockedHint: 'A Price Move must show at least one figure',
    persists: ['showPercent'],
  },
  showBars: {
    id: 'showBars', kind: 'custom', widget: 'toggle', label: 'Show bars',
    prop: 'showBars', needs: 'onSetProp', resolve: (d) => fieldOn(d, 'showBars'),
    persists: ['showBars'],
  },
  showTime: {
    id: 'showTime', kind: 'custom', widget: 'toggle', label: 'Show time',
    prop: 'showTime', needs: 'onSetProp', resolve: (d) => fieldOn(d, 'showTime'),
    persists: ['showTime'],
  },
  labelPos: {
    id: 'labelPos', kind: 'custom', widget: 'choice', label: 'Label position',
    prop: 'labelPos', needs: 'onSetProp',
    choices: LABEL_POSITIONS.map((v) => ({
      value: v, label: v === 'top' ? 'T' : v === 'center' ? 'C' : 'B',
      title: v[0].toUpperCase() + v.slice(1),
    })),
    fallback: DEFAULT_LABEL_POS, resolve: labelPosOf,
    persists: ['labelPos'],
  },

  // ── label ──
  showPriceLabel: {
    id: 'showPriceLabel', kind: 'custom', widget: 'toggle', label: 'Show price label',
    prop: 'showPriceLabel', needs: 'onSetProp',
    persists: ['showPriceLabel'],
  },
  showPercentChange: {
    id: 'showPercentChange', kind: 'custom', widget: 'toggle', label: 'Show percent change',
    prop: 'showPercentChange', needs: 'onSetProp',
    persists: ['showPercentChange'],
  },

  // ── arrow ──
  // ── fibonacci ──
  //
  // ⛔ ONE ROW, NOT TWENTY-ONE. A Fib has up to eleven levels and ten bands; a
  // visibility switch, a colour and a fill for each would be sixty rows in a
  // right-click menu. The root menu gets a single `Levels…` row and the whole
  // configuration lives behind it in a dense editor — the same shape the colour
  // row already uses, and the only shape that scales.
  fibLevels: {
    id: 'fibLevels', kind: 'custom', widget: 'fibEditor', label: 'Levels…',
    needs: 'onSetProp',
    // ⭐ EVERYTHING THE EDITOR WRITES PERSISTS AS ONE PAIR OF MAPS. Save as
    // default therefore captures a user's whole preferred Fib — which levels
    // they use, in what colours, with which bands filled.
    persists: ['levels', 'fills'],
  },
  resetFib: {
    id: 'resetFib', kind: 'action', label: 'Reset levels', needs: 'onResetFib',
    // Offered only when there is something to reset, so the row is never a no-op.
    available: (ctx) => hasFibOverrides(ctx.drawing),
  },

  // ── advanced ──
  //
  // ⛔ A MODE, BECAUSE THE ALTERNATIVE IS A WORSE DEFAULT. Price Move's anchors
  // are DATA — two candles whose low→high defines the run — and they are
  // usually nowhere near the label. Showing handles on them every time the user
  // selects the label put two gold dots in empty space, invited a drag that
  // silently restated the measurement, and made "move this label" the one thing
  // selection did not offer. So normal selection belongs to the label, and the
  // anchors appear only when they are asked for.
  adjustAnchors: {
    id: 'adjustAnchors', kind: 'action', needs: 'onAdjustAnchors',
    label: (ctx) => (ctx.adjusting ? 'Done adjusting' : 'Adjust anchors…'),
  },

  arrowSize: {
    id: 'arrowSize', kind: 'custom', widget: 'choice', label: 'Arrow size',
    prop: 'arrowSize', needs: 'onSetProp',
    // ⛔ THREE NAMED SIZES, NOT A NUMBER FIELD. Nobody wants to type 13 and see
    // whether it looks right; they want small, normal, big. The numbers live in
    // `drawingStyle.ARROW_SIZES` so the painter and the picker cannot drift.
    choices: [
      { value: ARROW_SIZES.small, label: 'S', title: 'Small' },
      { value: ARROW_SIZES.medium, label: 'M', title: 'Medium' },
      { value: ARROW_SIZES.large, label: 'L', title: 'Large' },
    ],
    fallback: DEFAULT_ARROW_SIZE,
    persists: ['arrowSize'],
  },

  // ── text ──
  //
  // ⛔ "COLOR" IS NOT A USEFUL WORD ON A TOOL WITH THREE COLOURS. A Text Note can
  // now colour its text, its background and its border; a row called Color would
  // be asking the user to guess. Same widget and same stored property as every
  // other tool's colour row — only the label changes, exactly as `border` does
  // for the Rectangle.
  textColor: {
    id: 'textColor', kind: 'custom', widget: 'colorRow', label: 'Text color',
    // ⛔ AND IT DOES NOT PERSIST `lineWidth` OR `lineStyle`. A note is not a
    // line: the width slider did nothing to it and the dash picker did nothing
    // to it, and "Save as default" was quietly writing both into the shared
    // store every time somebody saved a note. `line: false` hides them in the
    // picker; the short `persists` is what stops them being saved.
    line: false,
    persists: ['color'],
  },
  fontFamily: {
    id: 'fontFamily', kind: 'custom', widget: 'fontPicker', label: 'Font',
    prop: 'fontFamily', needs: 'onSetProp',
    persists: ['fontFamily'],
  },
  bold: {
    id: 'bold', kind: 'custom', widget: 'toggle', label: 'Bold',
    prop: 'bold', needs: 'onSetProp', persists: ['bold'],
  },
  italic: {
    id: 'italic', kind: 'custom', widget: 'toggle', label: 'Italic',
    prop: 'italic', needs: 'onSetProp', persists: ['italic'],
  },

  // ── text appearance ──
  //
  // ⭐ THE TWO COLOUR ROWS APPEAR ONLY WHEN THEIR TOGGLE IS ON. `available` is
  // the schema's own conditional — the same seam `makeHorizontal` uses for
  // "needs two points" — so the menu renderer never learns that a background
  // has a colour. Without it the alternative is
  // `if (type === 'text' && bgEnabled)` inside the renderer, which is the ladder
  // Phase 3 tore out.
  bgEnabled: {
    id: 'bgEnabled', kind: 'custom', widget: 'toggle', label: 'Background',
    prop: 'bgEnabled', needs: 'onSetProp', persists: ['bgEnabled'],
  },
  bgColor: {
    id: 'bgColor', kind: 'custom', widget: 'colorRow', label: 'Background color',
    prop: 'bgColor', needs: 'onSetProp', line: false,
    // The swatch shows the plate the canvas is ACTUALLY painting, so a note whose
    // background is on but uncoloured does not show its text colour here.
    fallbackColor: DEFAULT_TEXT_BG,
    available: (ctx) => !!ctx.drawing?.bgEnabled,
    persists: ['bgColor'],
  },
  borderEnabled: {
    id: 'borderEnabled', kind: 'custom', widget: 'toggle', label: 'Border',
    prop: 'borderEnabled', needs: 'onSetProp', persists: ['borderEnabled'],
  },
  borderColor: {
    id: 'borderColor', kind: 'custom', widget: 'colorRow', label: 'Border color',
    prop: 'borderColor', needs: 'onSetProp', line: false,
    available: (ctx) => !!ctx.drawing?.borderEnabled,
    persists: ['borderColor'],
  },

  fontSize: {
    id: 'fontSize', kind: 'custom', widget: 'fontStepper', label: 'Text size',
    needs: 'onSetFontSize',
    persists: ['fontSize'],
  },

  // ── advanced ──
  setLevel: {
    id: 'setLevel', kind: 'custom', widget: 'levelInput', label: 'Set level…',
    needs: 'onSetLevel',
  },
  makeHorizontal: {
    id: 'makeHorizontal', kind: 'action', label: 'Make horizontal',
    needs: 'onMakeHorizontal',
    // ⛔ A RUNTIME CONDITION, NOT A TYPE CONDITION. Flattening a line onto its
    // left endpoint's price needs a line — a sloped tool mid-placement has one
    // point and nothing to flatten. The shipped menu expressed this as
    // `SLOPED_LINE_TYPES.has(type) && pts.length >= 2` at the call site.
    available: (ctx) => (ctx.points?.length || 0) >= 2,
  },
  setAlert: {
    id: 'setAlert', kind: 'custom', widget: 'alertPicker', label: 'Set alert…',
    // Only the MAIN chart passes this — it is the surface that knows the symbol.
    needs: 'onSetAlert',
  },

  // ── actions ──
  duplicate: { id: 'duplicate', kind: 'action', label: 'Duplicate', needs: 'onDuplicate' },
  lock: {
    id: 'lock', kind: 'action', needs: 'onToggleLock',
    label: (ctx) => (ctx.drawing?.locked ? 'Unlock' : 'Lock'),
  },
  hide: {
    id: 'hide', kind: 'action', needs: 'onToggleHide',
    label: (ctx) => (ctx.drawing?.hidden ? 'Show' : 'Hide'),
  },
  saveDefault: { id: 'saveDefault', kind: 'action', label: 'Save as default', needs: 'onSaveDefaults' },
  remove: { id: 'remove', kind: 'action', label: 'Delete Drawing', danger: true, needs: 'onDelete' },
})

/** Every tool gets these, in this order, at the bottom of its menu. */
const ACTIONS = ['duplicate', 'lock', 'hide', 'saveDefault', 'remove']

/**
 * ⛔ A RETIRED TYPE: STILL DRAWN, STILL YOURS, NO LONGER CREATABLE.
 *
 * The 3-point Position drawing is retired in Phase 9. Everything about an
 * EXISTING one keeps working — it renders, selects, moves, locks, hides and
 * deletes — because a saved drawing is the user's, and turning it into an
 * unknown object would be the application losing their work to tidy its own
 * toolbar.
 *
 * ⭐ WHAT IT LOSES IS THE TWO ACTIONS THAT WOULD MAKE MORE OF IT.
 *   • DUPLICATE would be a backdoor: "cannot create from the toolbar" is not a
 *     retirement if a right-click clones one.
 *   • SAVE AS DEFAULT has nothing to act on — a default only ever reaches a NEW
 *     drawing, and there are no new ones. (Any default already in a user's
 *     settings is left alone. Deleting it would be a migration to remove data
 *     that is doing no harm.)
 *
 * ⛔ AND IT IS DECLARED, NOT BRANCHED ON. `available` is the same seam
 * `makeHorizontal` and the Text Note's colour rows use, so `DrawingContextMenu`
 * never learns that a type can be retired — which is the whole reason the
 * capability table exists.
 */
export const RETIRED_TYPES = Object.freeze(new Set(['position']))
export const isRetired = (type) => RETIRED_TYPES.has(type)

/** The actions a retired type keeps: everything except the two that make more. */
const RETIRED_ACTIONS = ['lock', 'hide', 'remove']

/** Colour is the one control every drawing has. */
const STYLE = ['color']

/** A flat line's price label — the same control on both, different PLACEMENT in
 *  the painter (the line's hugs the price scale; the ray's tags its own anchor). */
const PRICE_LABEL = ['showPriceLabel']

/** A shape's outline + inside tint. */
const SHAPE = ['border', 'fill']

/** The measurement family's label section. ⭐ ONE ORDER FOR ALL THREE — price
 *  first, then span, then where to put it — so the menus read the same way even
 *  though no two of the tools offer the same subset. */
const MEASURE_LABEL = ['showDollar', 'showPercentMove', 'showBars', 'showTime', 'labelPos']
const RULER_LABEL = ['showBars', 'showTime', 'labelPos']
const MOVE_LABEL = ['showDollar', 'showPercentMove']

/** Line tools that can be flattened to an exact price, and can carry an alert. */
const LEVEL = ['setLevel', 'setAlert']
/** …and the sloped ones can additionally be made horizontal. */
const SLOPED = ['setLevel', 'makeHorizontal', 'setAlert']

/**
 * The table.
 *
 * ⛔ EVERY TYPE IS LISTED, INCLUDING THE ONES WITH NOTHING SPECIAL. An implicit
 * default would make "this tool was forgotten" and "this tool has no extras"
 * the same state, and the schema test could not tell them apart.
 */
export const SCHEMA = Object.freeze({
  // sloped lines — level, flatten, alert
  trendline: { style: STYLE, advanced: SLOPED, actions: ACTIONS },
  ray: { style: STYLE, advanced: SLOPED, actions: ACTIONS },
  extended: { style: STYLE, advanced: SLOPED, actions: ACTIONS },
  // flat lines — level, alert (already horizontal)
  horizontal: { style: STYLE, label: PRICE_LABEL, advanced: LEVEL, actions: ACTIONS },
  hray: { style: STYLE, label: PRICE_LABEL, advanced: LEVEL, actions: ACTIONS },
  // ⭐ TEXT IS THE ONE TOOL WHOSE `style` SECTION IS EMPTY, and that is the
  // point: it has no line to style. Its colour row lives in `text` as "Text
  // color", beside the typography it belongs with, and the box it can draw
  // around itself lives in `appearance` with the two colours that are only
  // meaningful when their toggle is on.
  text: {
    text: ['textColor', 'fontFamily', 'fontSize', 'bold', 'italic'],
    appearance: ['bgEnabled', 'bgColor', 'borderEnabled', 'borderColor'],
    actions: ACTIONS,
  },
  // everything else: colour + the shared actions
  vertical: { style: STYLE, actions: ACTIONS },
  // ⛔ THE RECTANGLE HAS NO `style` SECTION. Its colour row moved WHOLESALE into
  // Appearance as "Border" — it was not copied. One row, one meaning: the thing
  // the user is looking at is an outline and a tint, and the menu says so.
  rect: { appearance: SHAPE, label: ['showPercentChange'], actions: ACTIONS },
  // ⭐ THE CIRCLE IS DELIBERATELY UNCHANGED. Phase 4's shape work is Rectangle's
  // fill and the Circle's HANDLES; giving the circle a fill picker nobody asked
  // for is also how a rectangle's saved fill would end up on one.
  circle: { style: STYLE, actions: ACTIONS },
  arrow: { style: STYLE, appearance: ['arrowSize'], actions: ACTIONS },
  // ⭐ THE TWO FIB TOOLS DECLARE THE SAME CONTROLS, because they are the same
  // concept with different geometry. Their DEFAULTS are per-tool (see
  // `byTool`), so a user's retracement palette and their extension palette stay
  // separate — which is what people actually want.
  fib: { style: STYLE, appearance: ['fibLevels'], advanced: ['resetFib'], actions: ACTIONS },
  fibext: { style: STYLE, appearance: ['fibLevels'], advanced: ['resetFib'], actions: ACTIONS },
  pitchfork: { style: STYLE, actions: ACTIONS },
  channel: { style: STYLE, actions: ACTIONS },
  cup: { style: STYLE, actions: ACTIONS },
  avwap: { style: STYLE, actions: ACTIONS },
  // the measurement family — same vocabulary, different questions
  measure: { style: STYLE, label: MEASURE_LABEL, actions: ACTIONS },
  priceRange: { style: STYLE, label: MEASURE_LABEL, actions: ACTIONS },
  dateRange: { style: STYLE, label: RULER_LABEL, actions: ACTIONS },
  advance: { style: STYLE, label: MOVE_LABEL, advanced: ['adjustAnchors'], actions: ACTIONS },
  // ⚰️ RETIRED IN PHASE 9 — see `RETIRED_TYPES`. Its entry stays so an existing
  // drawing still gets a full, working menu; what it does not get is Duplicate
  // or Save as default.
  position: { style: STYLE, actions: RETIRED_ACTIONS },
})

/** A type the table does not know still gets a usable menu. An unknown drawing
 *  is far likelier to be one this build has not heard of than a mistake, and a
 *  menu with no Delete would strand it. */
const FALLBACK = { style: STYLE, actions: ACTIONS }

export const schemaFor = (type) => SCHEMA[type] || FALLBACK

/** Which controls does this tool declare, in render order, ignoring runtime
 *  availability? The capability answer — what the matrix test compares. */
export function controlIdsFor(type) {
  const entry = schemaFor(type)
  const out = []
  for (const section of SECTION_ORDER) for (const id of entry[section] || []) out.push(id)
  return out
}

const labelOf = (control, ctx) =>
  (typeof control.label === 'function' ? control.label(ctx) : control.label)

/**
 * Resolve a drawing to the sections the menu should render.
 *
 * @param {object} ctx
 * @param {object} ctx.drawing
 * @param {object[]} [ctx.points]   the drawing's stored points
 * @param {object} ctx.handlers     which callbacks the caller actually supplied
 * @returns {{id:string, title?:string, items:object[]}[]}  empty sections dropped
 */
export function sectionsFor(ctx) {
  const entry = schemaFor(ctx?.drawing?.type)
  const handlers = ctx?.handlers || {}
  const sections = []
  for (const id of SECTION_ORDER) {
    const ids = entry[id]
    if (!ids || !ids.length) continue
    const items = []
    for (const cid of ids) {
      const control = CONTROLS[cid]
      if (!control) continue
      if (control.needs && !handlers[control.needs]) continue
      if (control.available && !control.available(ctx)) continue
      items.push({
        ...control,
        label: labelOf(control, ctx),
        // Resolved HERE so the renderer stays a renderer: it reads `locked` and
        // draws a disabled switch, and never learns why.
        locked: control.lockedWhen ? !!control.lockedWhen(ctx) : false,
      })
    }
    // ⛔ A SECTION WITH NO ITEMS IS ABSENT, not a heading over nothing.
    if (items.length) sections.push({ id, title: SECTION_TITLES[id], items })
  }
  return sections
}

/**
 * What "Save as default" writes for this tool.
 *
 * ⛔ DERIVED FROM THE TOOL'S OWN CONTROLS, NOT FROM THE DRAWING OBJECT. Every
 * drawing carries `lineWidth` because they share one shape, so reading the
 * object would make a Text Note save a line width it has no control for and a
 * Trend Line save a font size. Asking the schema means the payload is exactly
 * "the settings this tool actually offers" — and it stays that way for free as
 * later phases move controls between tools.
 *
 * ⚠️ THE DEFAULTS STORE USES ITS OWN KEY NAMES (`width`, `style`) rather than the
 * drawing's (`lineWidth`, `lineStyle`). That mapping is shipped behaviour in
 * `cs.drawingDefaults` and is preserved exactly.
 *
 * ─── SHARED vs TOOL-SPECIFIC (Phase 4) ──────────────────────────────────────
 *
 * ⛔ THE PAYLOAD NOW HAS TWO HALVES, AND THE SPLIT IS THE WHOLE POINT.
 *
 *   • `{color, width, style, fontSize}` stay FLAT and SHARED, exactly as shipped.
 *     "My drawing colour is blue" is a statement about drawing, not about
 *     rectangles; making it per-tool would mean setting the same colour eleven
 *     times, and would silently change what the Settings page's existing
 *     "Drawing colour" control means.
 *
 *   • Everything a single tool invented — a rectangle's fill, an arrow's head
 *     size, a line's price label — goes under `byTool[type]`. A Rectangle's fill
 *     colour is not a fact about Circles, and there is no shape of a shared store
 *     in which it does not eventually become one. This is the answer to "do not
 *     let defaults leak between unrelated tools": they are stored under the tool
 *     that saved them and read back only for that tool.
 *
 * The caller merges `byTool` one level deep (see StockChart's `onSaveDefaults`),
 * so saving a Rectangle's fill cannot wipe an Arrow's saved size.
 */
const DEFAULT_KEY = { color: 'color', lineWidth: 'width', lineStyle: 'style', fontSize: 'fontSize' }

export function defaultsPayloadFor(type, values) {
  const wanted = new Set()
  for (const cid of controlIdsFor(type)) {
    for (const prop of CONTROLS[cid]?.persists || []) wanted.add(prop)
  }
  const out = {}
  const tool = {}
  for (const prop of wanted) {
    const v = values?.[prop]
    if (v === undefined) continue
    const key = DEFAULT_KEY[prop]
    if (key) out[key] = v
    else tool[prop] = v
  }
  if (Object.keys(tool).length) out.byTool = { [type]: tool }
  return out
}

/**
 * The properties a NEW drawing of this type is stamped with at creation.
 *
 * ⭐ WHY A NEW DRAWING IS STAMPED RATHER THAN LEFT TO A DEFAULT. The owner wants
 * the price label ON for new Horizontal Lines and OFF for the ones already on
 * people's charts — the same absent property has to mean two different things.
 * It cannot, so it stops being absent: a new drawing WRITES `showPriceLabel:
 * true`, and `DRAWING_DEFAULTS.showPriceLabel` stays `false` so a legacy drawing,
 * which carries nothing, still resolves OFF. This is exactly the legacy/new
 * distinction schema versioning was preserved for.
 *
 * ⛔ THE USER'S SAVED TOOL DEFAULTS WIN. If they turned the label off and hit
 * "Save as default", new lines come up off — the built-in only decides what
 * happens before anyone has an opinion.
 */
export const NEW_DRAWING_PROPS = Object.freeze({
  horizontal: Object.freeze({ showPriceLabel: true }),
  hray: Object.freeze({ showPriceLabel: true }),

  // ⭐ A NEW MEASURE ANSWERS THE WHOLE QUESTION. Someone reaching for a ruler
  // wants to know what the move was and how long it took; making them find four
  // switches to get there is the tool being coy. Two rows, four figures, and
  // every one of them is why they drew it. Existing Measure drawings carry
  // nothing and keep their price-and-bars appearance exactly (LEGACY_FIELDS).
  measure: Object.freeze({ showDollar: true, showPercent: true, showBars: true, showTime: true }),

  // The ruler's whole purpose, both halves on.
  dateRange: Object.freeze({ showBars: true, showTime: true }),

  // ⛔ A NEW NOTE DECLARES WHICH LAYOUT RULE IT WAS DRAWN UNDER. This is the
  // whole of the legacy/new distinction for Text Note: with the marker the
  // painter honours the anchor as the box's top-left (what it always meant);
  // without it, a note drawn before Phase 6 keeps the placement it has had all
  // along and does not slide across somebody's chart. See `drawingText.js`.
  text: Object.freeze({ textOrigin: 'box' }),

  // ⛔ AND PRICE MOVE GAINS THE DOLLAR IT NEVER HAD. "+18%" is the shape of a
  // run; "+$50.68 (+18.90%)" is the shape AND the size, and on a chart where
  // you already know the price the second is strictly more useful. Existing
  // 'advance' drawings stay percent-only — they carry nothing, and LEGACY_FIELDS
  // says percent-only is what an unstamped one means.
  advance: Object.freeze({ showDollar: true, showPercent: true }),
})

export function newDrawingProps(type, toolDefaults = null) {
  const saved = toolDefaults && toolDefaults[type]
  const built = NEW_DRAWING_PROPS[type]
  if (!saved && !built) return null
  return { ...built, ...saved }
}
