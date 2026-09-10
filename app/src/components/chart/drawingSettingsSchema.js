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
 */

/** Fixed render order. A tool's sections are emitted in this order regardless of
 *  how its entry is written, so no tool can accidentally invent its own layout. */
export const SECTION_ORDER = ['style', 'appearance', 'label', 'text', 'advanced', 'actions']

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
export const CONTROLS = Object.freeze({
  // ── style ──
  color: {
    id: 'color', kind: 'custom', widget: 'colorRow', label: 'Color',
    // The row opens ColorPanel, which edits all three at once — so all three are
    // what this control means, and all three are what it saves.
    persists: ['color', 'lineWidth', 'lineStyle'],
  },

  // ── text ──
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

/** Colour is the one control every drawing has. */
const STYLE = ['color']

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
  horizontal: { style: STYLE, advanced: LEVEL, actions: ACTIONS },
  hray: { style: STYLE, advanced: LEVEL, actions: ACTIONS },
  // text — the only tool with typography today
  text: { style: STYLE, text: ['fontSize'], actions: ACTIONS },
  // everything else: colour + the shared actions
  vertical: { style: STYLE, actions: ACTIONS },
  rect: { style: STYLE, actions: ACTIONS },
  circle: { style: STYLE, actions: ACTIONS },
  arrow: { style: STYLE, actions: ACTIONS },
  fib: { style: STYLE, actions: ACTIONS },
  fibext: { style: STYLE, actions: ACTIONS },
  pitchfork: { style: STYLE, actions: ACTIONS },
  channel: { style: STYLE, actions: ACTIONS },
  cup: { style: STYLE, actions: ACTIONS },
  avwap: { style: STYLE, actions: ACTIONS },
  measure: { style: STYLE, actions: ACTIONS },
  priceRange: { style: STYLE, actions: ACTIONS },
  dateRange: { style: STYLE, actions: ACTIONS },
  advance: { style: STYLE, actions: ACTIONS },
  position: { style: STYLE, actions: ACTIONS },
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
      items.push({ ...control, label: labelOf(control, ctx) })
    }
    // ⛔ A SECTION WITH NO ITEMS IS ABSENT, not a heading over nothing.
    if (items.length) sections.push({ id, title: undefined, items })
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
 */
const DEFAULT_KEY = { color: 'color', lineWidth: 'width', lineStyle: 'style', fontSize: 'fontSize' }

export function defaultsPayloadFor(type, values) {
  const wanted = new Set()
  for (const cid of controlIdsFor(type)) {
    for (const prop of CONTROLS[cid]?.persists || []) wanted.add(prop)
  }
  const out = {}
  for (const prop of wanted) {
    const key = DEFAULT_KEY[prop]
    if (!key) continue
    const v = values?.[prop]
    if (v !== undefined) out[key] = v
  }
  return out
}
