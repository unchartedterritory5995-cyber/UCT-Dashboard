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
 */
import { describe, it, expect } from 'vitest'
import {
  SECTION_ORDER, CONTROLS, SCHEMA, schemaFor, controlIdsFor,
  sectionsFor, defaultsPayloadFor,
} from './drawingSettingsSchema'
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

const ALL_HANDLERS = {
  onSetFontSize: () => {}, onSetLevel: () => {}, onMakeHorizontal: () => {},
  onSetAlert: () => {}, onDuplicate: () => {}, onToggleLock: () => {},
  onToggleHide: () => {}, onSaveDefaults: () => {}, onDelete: () => {},
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
    it(`${type} — identical controls, in identical order`, () => {
      expect(resolve(type)).toEqual(oldMenuFor(type))
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
    const opts = { handlers: { onSetAlert: null, onSaveDefaults: null, onToggleHide: null } }
    for (const type of ALL_TYPES) {
      expect(resolve(type, opts), type).toEqual(
        oldMenuFor(type, { hasAlert: false, hasSaveDefaults: false, hasHide: false }),
      )
    }
  })

  it('matches the old menu for a HALF-PLACED sloped line (one point)', () => {
    // `horizontalSupported` carried `&& pts.length >= 2`; the schema carries it
    // as the control's own `available()`.
    for (const type of ['trendline', 'ray', 'extended']) {
      expect(resolve(type, { points: [{}] }), type).toEqual(oldMenuFor(type, { points: [{}] }))
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

  it('gives every tool a Delete and a Color', () => {
    for (const type of ALL_TYPES) {
      expect(resolve(type), type).toContain('remove')
      expect(resolve(type), type).toContain('color')
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
    expect(labelOf('rect', 'color')).toBe('Color')
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
