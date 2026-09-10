/* The drawing settings schema — and the proof the migration changed nothing.
 *
 * ⛔ THE MATRIX IS THE POINT OF THIS FILE. Replacing a hand-written menu with a
 * table is the kind of refactor that silently loses a row: nobody notices that
 * Horizontal Ray stopped offering "Set level…" until a user goes looking for it,
 * and by then it is three phases later. So `OLD_MENU` below transcribes the
 * PRE-MIGRATION conditions — from `DrawingContextMenu`'s JSX and from the props
 * the overlay computed for it — and every drawing type is compared against the
 * new schema. Not a snapshot of the new behaviour: an independent statement of
 * the old one.
 *
 * ⭐ PHASE 4 KEEPS THE MATRIX AND DECLARES ITS ADDITIONS SEPARATELY. The moment a
 * phase actually adds settings, the temptation is to re-baseline `OLD_MENU` and
 * lose the guarantee. Instead `PHASE4_ADD` / `PHASE4_RENAME` below state, per
 * tool, exactly what changed — so the assertion is still "the Phase-3 menu, plus
 * these named rows, and nothing else". A row that vanished would still fail, and
 * a row that appeared without being declared would too.
 */
import { describe, it, expect } from 'vitest'
import {
  SECTION_ORDER, CONTROLS, SCHEMA, schemaFor, controlIdsFor,
  sectionsFor, defaultsPayloadFor, newDrawingProps,
} from './drawingSettingsSchema'
import { drawingProp } from './drawingSchema'
import { fieldsFor } from './drawingMeasure'
import { TOOL_ICONS } from './ChartToolbar'

// Every drawing type that can exist on a chart. `ray` has no toolbar button but
// is reachable (Model Book, and the keyboard path), so it is a real type.
const ALL_TYPES = [
  'trendline', 'ray', 'extended', 'horizontal', 'hray', 'vertical',
  'rect', 'circle', 'arrow', 'text', 'fib', 'fibext', 'pitchfork', 'channel',
  'cup', 'avwap', 'measure', 'priceRange', 'dateRange', 'advance', 'position',
]

// ── the pre-migration menu, transcribed ─────────────────────────────────────
//
//   DrawingContextMenu rendered, in order:
//     Color                        — always
//     Text size                    — isText && onSetFontSize
//     Set level…                   — levelSupported
//     Make horizontal              — horizontalSupported
//     Set alert…                   — alertSupported
//     Duplicate / Lock             — always
//     Hide                         — onToggleHide
//     Save as default              — onSaveDefaults
//     Delete Drawing               — always
//
//   …with the three `*Supported` flags computed by the overlay as:
//     LEVEL_LINE_TYPES  = trendline, ray, extended, horizontal, hray
//     SLOPED_LINE_TYPES = trendline, ray, extended
//     levelSupported      = LEVEL_LINE_TYPES.has(type)
//     horizontalSupported = SLOPED_LINE_TYPES.has(type) && points.length >= 2
//     alertSupported      = !!onSetAlert && LEVEL_LINE_TYPES.has(type)
const LEVEL_LINE_TYPES = new Set(['trendline', 'ray', 'extended', 'horizontal', 'hray'])
const SLOPED_LINE_TYPES = new Set(['trendline', 'ray', 'extended'])

/** What the OLD menu would render for a type, given a fully-wired caller. */
function oldMenuFor(type, { points = [{}, {}], hasAlert = true, hasHide = true, hasSaveDefaults = true } = {}) {
  const ids = ['color']
  if (type === 'text') ids.push('fontSize')
  if (LEVEL_LINE_TYPES.has(type)) ids.push('setLevel')
  if (SLOPED_LINE_TYPES.has(type) && points.length >= 2) ids.push('makeHorizontal')
  if (hasAlert && LEVEL_LINE_TYPES.has(type)) ids.push('setAlert')
  ids.push('duplicate', 'lock')
  if (hasHide) ids.push('hide')
  if (hasSaveDefaults) ids.push('saveDefault')
  ids.push('remove')
  return ids
}

// ── what Phase 4 added, transcribed from the brief rather than from the table ──
//
//   Horizontal Line / Horizontal Ray  + "Show price label"   (label section)
//   Rectangle                         Color BECOMES "Border", + "Fill",
//                                     + "Show percent change"
//   Arrow                             + "Arrow size"
//
// All four new controls need `onSetProp`; a caller that does not wire it gets
// the Phase-3 menu exactly, which is what every read-only surface still sees.
const PHASE4_RENAME = { rect: { color: 'border' } }
const PHASE4_ADD = {
  horizontal: { color: ['showPriceLabel'] },
  hray: { color: ['showPriceLabel'] },
  rect: { border: ['fill', 'showPercentChange'] },
  arrow: { color: ['arrowSize'] },
}

// ── what Phase 5 added, transcribed from the brief ─────────────────────────
//
//   Measure / Price Range  + Show dollar · Show percent · Show bars ·
//                            Show time · Label position
//   Bars & Time            + Show bars · Show time · Label position
//   Price Move             + Show dollar · Show percent, and Adjust anchors
//
// The five label rows need `onSetProp`; Adjust anchors needs its own handler,
// so a surface that offers one and not the other still resolves correctly.
const MEASURE_ROWS = ['showDollar', 'showPercentMove', 'showBars', 'showTime', 'labelPos']
const PHASE5_ADD = {
  measure: { color: MEASURE_ROWS },
  priceRange: { color: MEASURE_ROWS },
  dateRange: { color: ['showBars', 'showTime', 'labelPos'] },
  advance: { color: ['showDollar', 'showPercentMove'] },
}
// Rows that land in a LATER section than the one they follow — `advanced` sits
// between the label rows and the actions, so it is keyed by what comes after it.
const PHASE5_BEFORE = { advance: { duplicate: ['adjustAnchors'] } }

/** The old menu, plus every declared addition since, in render order. */
function menuFor(type, opts = {}) {
  const rename = PHASE4_RENAME[type] || {}
  const noProp = opts.hasSetProp === false
  const add = noProp ? {} : { ...(PHASE4_ADD[type] || {}) }
  if (!noProp) {
    for (const [k, v] of Object.entries(PHASE5_ADD[type] || {})) {
      add[k] = [...(add[k] || []), ...v]
    }
  }
  const before = opts.hasAdjust === false ? {} : (PHASE5_BEFORE[type] || {})
  const out = []
  for (const id of oldMenuFor(type, opts)) {
    for (const pre of before[id] || []) out.push(pre)
    const nid = rename[id] || id
    out.push(nid)
    for (const extra of add[nid] || []) out.push(extra)
  }
  return out
}

const ALL_HANDLERS = {
  onSetFontSize: () => {}, onSetLevel: () => {}, onMakeHorizontal: () => {},
  onSetAlert: () => {}, onDuplicate: () => {}, onToggleLock: () => {},
  onToggleHide: () => {}, onSaveDefaults: () => {}, onDelete: () => {},
  onSetProp: () => {}, onAdjustAnchors: () => {},
}
const flatIds = (sections) => sections.flatMap((s) => s.items.map((i) => i.id))
const resolve = (type, opts = {}) => flatIds(sectionsFor({
  drawing: { type, ...(opts.drawing || {}) },
  points: opts.points ?? [{}, {}],
  handlers: { ...ALL_HANDLERS, ...(opts.handlers || {}) },
}))

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ CAPABILITY MATRIX — old menu vs new schema, every drawing type', () => {
  for (const type of ALL_TYPES) {
    it(`${type} — the Phase-3 controls plus its declared Phase-4 additions`, () => {
      expect(resolve(type)).toEqual(menuFor(type))
    })
  }

  it('covers every type the chart can actually create', () => {
    // Guards the guard: a type added to POINT_COUNT but not here would make the
    // matrix above silently incomplete.
    expect(ALL_TYPES).toHaveLength(21)
    for (const t of ALL_TYPES) expect(SCHEMA[t], `${t} missing from SCHEMA`).toBeTruthy()
  })

  it('matches the old menu when the caller wires NOTHING optional', () => {
    // The Model Book / grid-cell shape: no alert handler, no save-defaults.
    const opts = { handlers: { onSetAlert: null, onSaveDefaults: null, onToggleHide: null, onAdjustAnchors: null } }
    for (const type of ALL_TYPES) {
      expect(resolve(type, opts), type).toEqual(
        menuFor(type, { hasAlert: false, hasSaveDefaults: false, hasHide: false, hasAdjust: false }),
      )
    }
  })

  it('⛔ a caller with no onSetProp gets the PHASE-3 MENU, unchanged', () => {
    // Every read-only / annotation surface is in this shape. Phase 4's settings
    // are additive to the tool, not to the component: a surface that cannot edit
    // a drawing does not grow rows it could not action.
    for (const type of ALL_TYPES) {
      const got = resolve(type, { handlers: { onSetProp: null } })
      expect(got, type).toEqual(menuFor(type, { hasSetProp: false, hasAdjust: true }))
      for (const id of ['showPriceLabel', 'showPercentChange', 'fill', 'arrowSize', ...MEASURE_ROWS]) {
        expect(got, `${type} leaked ${id}`).not.toContain(id)
      }
    }
  })

  it('matches the old menu for a HALF-PLACED sloped line (one point)', () => {
    // `horizontalSupported` carried `&& pts.length >= 2`; the schema carries it
    // as the control's own `available()`.
    for (const type of ['trendline', 'ray', 'extended']) {
      expect(resolve(type, { points: [{}] }), type).toEqual(menuFor(type, { points: [{}] }))
      expect(resolve(type, { points: [{}] })).not.toContain('makeHorizontal')
    }
  })
})

describe('the table is well-formed', () => {
  it('every type resolves a schema, and unknown types get a usable fallback', () => {
    for (const type of ALL_TYPES) expect(schemaFor(type)).toBeTruthy()
    const unknown = resolve('something-from-the-future')
    expect(unknown).toContain('color')
    expect(unknown).toContain('remove')   // never strand a drawing with no Delete
  })

  it('names no control id that does not exist', () => {
    for (const type of [...ALL_TYPES, 'unknown']) {
      for (const id of controlIdsFor(type)) {
        expect(CONTROLS[id], `${type} declares unknown control '${id}'`).toBeTruthy()
      }
    }
  })

  it('never repeats a control within one tool', () => {
    for (const type of ALL_TYPES) {
      const ids = controlIdsFor(type)
      expect(new Set(ids).size, `${type} lists a control twice`).toBe(ids.length)
    }
  })

  it('uses only declared sections, and emits them in SECTION_ORDER', () => {
    for (const type of ALL_TYPES) {
      for (const key of Object.keys(SCHEMA[type])) {
        expect(SECTION_ORDER, `${type} declares unknown section '${key}'`).toContain(key)
      }
      const emitted = sectionsFor({ drawing: { type }, points: [{}, {}], handlers: ALL_HANDLERS })
        .map((s) => s.id)
      const expected = SECTION_ORDER.filter((k) => emitted.includes(k))
      expect(emitted, `${type} section order`).toEqual(expected)
    }
  })

  it('⛔ never emits an EMPTY section — no heading over nothing', () => {
    for (const type of ALL_TYPES) {
      // strip every optional handler so most sections collapse
      const sections = sectionsFor({
        drawing: { type }, points: [{}, {}],
        handlers: { onDuplicate: () => {}, onToggleLock: () => {}, onDelete: () => {} },
      })
      for (const s of sections) expect(s.items.length, `${type}/${s.id} is empty`).toBeGreaterThan(0)
    }
  })

  it('gives every tool a Delete and a colour row', () => {
    for (const type of ALL_TYPES) {
      expect(resolve(type), type).toContain('remove')
      // ⛔ THE RECTANGLE'S COLOUR ROW IS CALLED `border` — it MOVED rather than
      // being duplicated, which is the whole reason the shape has no `color`.
      const ids = resolve(type)
      expect(ids.includes('color') || ids.includes('border'), type).toBe(true)
      expect(ids.includes('color') && ids.includes('border'), `${type} has TWO colour rows`).toBe(false)
    }
  })

  it('marks Delete — and only Delete — as destructive', () => {
    const danger = Object.values(CONTROLS).filter((c) => c.danger).map((c) => c.id)
    expect(danger).toEqual(['remove'])
  })

  it('the tables are frozen', () => {
    expect(Object.isFrozen(SCHEMA)).toBe(true)
    expect(Object.isFrozen(CONTROLS)).toBe(true)
  })
})

describe('a control needs its handler', () => {
  it('is omitted entirely rather than rendered inert', () => {
    // The shipped behaviour (`{onToggleHide && …}`), generalised. A row that does
    // nothing is worse than a row that is not there.
    for (const [handler, id] of [
      ['onSetFontSize', 'fontSize'], ['onSetLevel', 'setLevel'],
      ['onMakeHorizontal', 'makeHorizontal'], ['onSetAlert', 'setAlert'],
      ['onToggleHide', 'hide'], ['onSaveDefaults', 'saveDefault'],
      ['onDuplicate', 'duplicate'], ['onToggleLock', 'lock'], ['onDelete', 'remove'],
    ]) {
      const type = id === 'fontSize' ? 'text' : 'trendline'
      expect(resolve(type)).toContain(id)
      expect(resolve(type, { handlers: { [handler]: null } })).not.toContain(id)
    }
  })
})

describe('labels that depend on the drawing', () => {
  const labelOf = (type, id, drawing) => sectionsFor({
    drawing: { type, ...drawing }, points: [{}, {}], handlers: ALL_HANDLERS,
  }).flatMap((s) => s.items).find((i) => i.id === id)?.label

  it('Lock ↔ Unlock', () => {
    expect(labelOf('rect', 'lock', { locked: false })).toBe('Lock')
    expect(labelOf('rect', 'lock', { locked: true })).toBe('Unlock')
  })

  it('Hide ↔ Show', () => {
    expect(labelOf('rect', 'hide', { hidden: false })).toBe('Hide')
    expect(labelOf('rect', 'hide', { hidden: true })).toBe('Show')
  })

  it('keeps the shipped wording for the fixed labels', () => {
    expect(labelOf('trendline', 'setLevel')).toBe('Set level…')
    expect(labelOf('trendline', 'makeHorizontal')).toBe('Make horizontal')
    expect(labelOf('trendline', 'setAlert')).toBe('Set alert…')
    expect(labelOf('rect', 'duplicate')).toBe('Duplicate')
    expect(labelOf('rect', 'saveDefault')).toBe('Save as default')
    expect(labelOf('rect', 'remove')).toBe('Delete Drawing')
    expect(labelOf('text', 'fontSize')).toBe('Text size')
    expect(labelOf('trendline', 'color')).toBe('Color')
  })

  it('⭐ the Rectangle says Border and Fill, because that is what they are', () => {
    expect(labelOf('rect', 'border')).toBe('Border')
    expect(labelOf('rect', 'fill')).toBe('Fill')
    expect(labelOf('rect', 'color')).toBeUndefined()
  })

  it('the new toggles read as plain statements', () => {
    expect(labelOf('horizontal', 'showPriceLabel')).toBe('Show price label')
    expect(labelOf('hray', 'showPriceLabel')).toBe('Show price label')
    expect(labelOf('rect', 'showPercentChange')).toBe('Show percent change')
    expect(labelOf('arrow', 'arrowSize')).toBe('Arrow size')
  })

  it('a section that needs a heading gets one; the spine sections do not', () => {
    const titled = (type) => sectionsFor({
      drawing: { type }, points: [{}, {}], handlers: ALL_HANDLERS,
    }).map((s) => [s.id, s.title])
    expect(titled('rect')).toEqual([
      ['appearance', 'Appearance'], ['label', 'Label'], ['actions', undefined],
    ])
    expect(titled('trendline')).toEqual([
      ['style', undefined], ['advanced', undefined], ['actions', undefined],
    ])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('SAVE AS DEFAULT — the payload follows the tool’s own controls', () => {
  const VALUES = { color: '#1ae51a', lineWidth: 3, lineStyle: 'dotted', fontSize: 22 }

  it('reproduces the shipped payload for every drawing type', () => {
    // ⛔ The shipped call was:
    //   onSaveDefaults({ color, width, style, ...(isText ? { fontSize } : {}) })
    // …so exactly text gains a fontSize and nothing else differs.
    for (const type of ALL_TYPES) {
      const expected = { color: '#1ae51a', width: 3, style: 'dotted' }
      if (type === 'text') expected.fontSize = 22
      expect(defaultsPayloadFor(type, VALUES), type).toEqual(expected)
    }
  })

  // ── Phase 4: the tool-specific half ──────────────────────────────────────
  it('⛔ a tool-specific property is filed UNDER THE TOOL, never flat', () => {
    const p = defaultsPayloadFor('rect', { ...VALUES, fillColor: '#3f7fe0aa' })
    expect(p.byTool).toEqual({ rect: { fillColor: '#3f7fe0aa' } })
    expect(p.fillColor).toBeUndefined()          // not loose in the shared store
    expect(p.color).toBe('#1ae51a')              // …and the shared half is intact
  })

  it('⭐ A RECTANGLE\u2019S FILL CANNOT BECOME A CIRCLE\u2019S — the leak this prevents', () => {
    const rect = defaultsPayloadFor('rect', { ...VALUES, fillColor: '#d24ba8' })
    expect(Object.keys(rect.byTool)).toEqual(['rect'])
    // A Circle declares no fill control at all, so it neither saves nor reads one.
    const circle = defaultsPayloadFor('circle', { ...VALUES, fillColor: '#d24ba8' })
    expect(circle.byTool).toBeUndefined()
    expect(newDrawingProps('circle', rect.byTool)).toBeNull()
  })

  it('each tool saves only what its OWN controls persist', () => {
    const everything = {
      ...VALUES, fillColor: '#111111', arrowSize: 16,
      showPriceLabel: true, showPercentChange: true,
    }
    expect(defaultsPayloadFor('arrow', everything).byTool).toEqual({ arrow: { arrowSize: 16 } })
    expect(defaultsPayloadFor('horizontal', everything).byTool).toEqual({ horizontal: { showPriceLabel: true } })
    expect(defaultsPayloadFor('rect', everything).byTool).toEqual({
      rect: { fillColor: '#111111', showPercentChange: true },
    })
    // A trend line has none of them.
    expect(defaultsPayloadFor('trendline', everything).byTool).toBeUndefined()
  })

  it('saving a toggle OFF is a real answer, saving an absent fill is not', () => {
    expect(defaultsPayloadFor('horizontal', { ...VALUES, showPriceLabel: false }).byTool)
      .toEqual({ horizontal: { showPriceLabel: false } })
    expect(defaultsPayloadFor('rect', VALUES).byTool).toBeUndefined()
  })


  it('⭐ a tool never saves a property it has no control for', () => {
    // The rule that makes this survive later phases: a Trend Line has no
    // typography control, so no font size can leak into its defaults — even
    // though every drawing object carries a fontSize field.
    expect(defaultsPayloadFor('trendline', VALUES)).not.toHaveProperty('fontSize')
    expect(defaultsPayloadFor('rect', VALUES)).not.toHaveProperty('fontSize')
    expect(defaultsPayloadFor('pitchfork', VALUES)).not.toHaveProperty('fontSize')
  })

  it('⭐ dropping a control from a tool drops it from the payload, automatically', () => {
    // This is what Phase 6 needs: when the Text Note stops offering a line width,
    // its defaults must stop carrying one — without anyone remembering to also
    // edit a save handler. Simulated by asking for a tool whose schema has only
    // the text control.
    const persisted = new Set(CONTROLS.fontSize.persists)
    expect(persisted.has('lineWidth')).toBe(false)
    expect(persisted.has('fontSize')).toBe(true)
    // and the colour row is what currently brings width/style to every tool
    expect(CONTROLS.color.persists).toEqual(['color', 'lineWidth', 'lineStyle'])
  })

  it('omits a value the caller did not supply rather than writing undefined', () => {
    expect(defaultsPayloadFor('text', { color: '#fff' })).toEqual({ color: '#fff' })
    expect(defaultsPayloadFor('rect', {})).toEqual({})
  })

  it('carries a dotted style through — the Phase 1 fix reaches defaults', () => {
    expect(defaultsPayloadFor('trendline', { ...VALUES, lineStyle: 'dotted' }).style).toBe('dotted')
  })
})

describe('the schema stays in step with the toolbar roster', () => {
  it('every tool with a toolbar icon has a schema entry', () => {
    // Adding a tool in a later phase (Bars & Time) without a schema entry would
    // silently give it the fallback menu. Fails by name instead.
    const skip = new Set(['repeat', 'settings', 'cursor', 'delete', 'clear', 'undo', 'redo',
      'chevronLeft', 'chevronRight', 'eye', 'eyeOff', 'camera', 'share', 'replay',
      'favorites', 'starOutline', 'grip', 'check'])
    for (const id of Object.keys(TOOL_ICONS)) {
      if (skip.has(id)) continue
      expect(SCHEMA[id], `tool '${id}' has an icon but no settings schema`).toBeTruthy()
    }
  })
})



// ═══════════════════════════════════════════════════════════════════════════
describe('NEW vs LEGACY — what a freshly drawn tool is stamped with', () => {
  it('⭐ a NEW horizontal line is born with its price label ON', () => {
    expect(newDrawingProps('horizontal')).toEqual({ showPriceLabel: true })
    expect(newDrawingProps('hray')).toEqual({ showPriceLabel: true })
  })

  it('⛔ …and a LEGACY one is stamped with nothing, so it resolves OFF', () => {
    // The whole legacy/new distinction: absence means off, presence means the
    // user (or creation) said so. Nothing is written to an existing drawing.
    expect(drawingProp({ type: 'horizontal' }, 'showPriceLabel')).toBe(false)
    expect(drawingProp({ type: 'horizontal', showPriceLabel: true }, 'showPriceLabel')).toBe(true)
  })

  it('⭐ a NEW measurement answers the whole question, and a new ruler both halves', () => {
    expect(newDrawingProps('measure'))
      .toEqual({ showDollar: true, showPercent: true, showBars: true, showTime: true })
    expect(newDrawingProps('dateRange')).toEqual({ showBars: true, showTime: true })
    expect(newDrawingProps('advance')).toEqual({ showDollar: true, showPercent: true })
  })

  it('⛔ …while the LEGACY appearance of each is untouched', () => {
    // Nothing is written to an existing drawing, so an unstamped one still
    // resolves to what its type has always shown.
    expect(fieldsFor({ type: 'measure' })).toEqual({ dollar: true, percent: true, bars: true, time: false })
    expect(fieldsFor({ type: 'dateRange' })).toEqual({ dollar: false, percent: false, bars: true, time: false })
    expect(fieldsFor({ type: 'advance' })).toEqual({ dollar: false, percent: true, bars: false, time: false })
  })

  it('every other tool is stamped with nothing at all', () => {
    const stamped = new Set(['horizontal', 'hray', 'measure', 'dateRange', 'advance'])
    for (const type of ALL_TYPES) {
      if (stamped.has(type)) continue
      expect(newDrawingProps(type), type).toBeNull()
    }
  })

  it('⛔ A PRICE MOVE CANNOT BE LEFT SHOWING NOTHING', () => {
    // The label IS the drawing: with neither figure on it would exist, occupy a
    // row in the Objects manager, and be invisible and unclickable on the chart.
    const lockedOf = (drawing) => sectionsFor({
      drawing, points: [{}, {}], handlers: ALL_HANDLERS,
    }).flatMap((s) => s.items).filter((i) => i.locked).map((i) => i.id)

    expect(lockedOf({ type: 'advance', showDollar: true, showPercent: true })).toEqual([])
    expect(lockedOf({ type: 'advance', showDollar: false, showPercent: true })).toEqual(['showPercentMove'])
    expect(lockedOf({ type: 'advance', showDollar: true, showPercent: false })).toEqual(['showDollar'])
    // A legacy Price Move is percent-only, so its percent switch is the last one.
    expect(lockedOf({ type: 'advance' })).toEqual(['showPercentMove'])
  })

  it('⭐ MEASURE IS EXEMPT — its box is still there with every field off', () => {
    const locked = sectionsFor({
      drawing: { type: 'measure', showDollar: true, showPercent: false, showBars: false, showTime: false },
      points: [{}, {}], handlers: ALL_HANDLERS,
    }).flatMap((s) => s.items).filter((i) => i.locked)
    expect(locked).toEqual([])
  })

  it('the user\u2019s saved tool defaults beat the built-in', () => {
    expect(newDrawingProps('horizontal', { horizontal: { showPriceLabel: false } }))
      .toEqual({ showPriceLabel: false })
    expect(newDrawingProps('arrow', { arrow: { arrowSize: 16 } }))
      .toEqual({ arrowSize: 16 })
  })

  it('a saved default for one tool is invisible to every other tool', () => {
    const saved = { rect: { fillColor: '#d24ba8' }, arrow: { arrowSize: 7 } }
    expect(newDrawingProps('rect', saved)).toEqual({ fillColor: '#d24ba8' })
    expect(newDrawingProps('circle', saved)).toBeNull()
    expect(newDrawingProps('trendline', saved)).toBeNull()
  })
})
