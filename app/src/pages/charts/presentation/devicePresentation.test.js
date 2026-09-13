// @vitest-environment node
/* MOB-08 — the device-scoped presentation contract, pinned.
 *
 * ⛔ EVERY CASE HERE IS A WAY THIS FEATURE COULD DESTROY A BOARD. The record
 * being extended is the one the certification called "the one place a careless
 * refactor produces a blank board", so the matrix is about survival: an old blob
 * loading, one device's write not erasing another's, and a malformed value never
 * being able to stop a chart from rendering.
 */
import { describe, it, expect } from 'vitest'
import {
  DEVICE_CLASSES, SCOPED_FIELDS, deviceClassOf,
  normalisePresentation, readScopedField, writeScopedField,
} from './devicePresentation'
import { sanitizeState } from '../grid/gridLayouts'

/** The persisted round trip: what a save/reload actually does to the blob. */
const roundTrip = (state) => {
  const wire = JSON.parse(JSON.stringify(state))
  return { mode: wire.mode === 'grid' ? 'grid' : 'workspace', ...sanitizeState(wire) }
}

describe('the device-class vocabulary', () => {
  it('is the smallest set that maps to a real difference — two shells', () => {
    expect(DEVICE_CLASSES).toEqual(['desktop', 'mobile'])
  })

  it('is derived from the SHELL, and nothing else', () => {
    expect(deviceClassOf(true)).toBe('mobile')
    expect(deviceClassOf(false)).toBe('desktop')
  })
})

describe('A · a legacy blob with no presentation key', () => {
  const legacy = { mode: 'grid', layout: '2x2', cells: [], syncCrosshair: false }

  it('DESKTOP still reads the legacy value — nothing changes for existing users', () => {
    expect(readScopedField(legacy, 'desktop', 'mode')).toBe('grid')
  })

  it('⛔⛔ MOBILE does NOT inherit it — this is the whole defect', () => {
    // The shipped bug: a desktop user entering Multi Chart made the PHONE open
    // in grid mode. A fallback to the shared value here would faithfully
    // reproduce it, which is why `legacyFallbackFor` excludes mobile.
    expect(readScopedField(legacy, 'mobile', 'mode')).toBe('workspace')
  })

  it('and an empty blob falls to the product default for both', () => {
    for (const cls of DEVICE_CLASSES) expect(readScopedField({}, cls, 'mode')).toBe('workspace')
  })
})

describe('B-D · writes are scoped, and cannot cross', () => {
  it('B · a mobile write lands in presentation.mobile', () => {
    const out = writeScopedField({}, 'mobile', 'mode', 'grid')
    expect(out.presentation.mobile.mode).toBe('grid')
  })

  it('⛔⛔ C · desktop presentation SURVIVES a mobile write', () => {
    const start = writeScopedField({}, 'desktop', 'mode', 'grid')
    const after = writeScopedField(start, 'mobile', 'mode', 'workspace')
    expect(after.presentation.desktop.mode).toBe('grid')
    expect(readScopedField(after, 'desktop', 'mode')).toBe('grid')
  })

  it('⛔⛔ D · mobile presentation SURVIVES a desktop write', () => {
    const start = writeScopedField({}, 'mobile', 'mode', 'grid')
    const after = writeScopedField(start, 'desktop', 'mode', 'workspace')
    expect(after.presentation.mobile.mode).toBe('grid')
    expect(readScopedField(after, 'mobile', 'mode')).toBe('grid')
  })

  it('⛔⛔ M · the exact bleed that shipped: a phone exiting grid must not clear the desktop', () => {
    // Before MOB-08 the phone's "Exit Multi Chart" wrote mode:'workspace' to the
    // shared key and the desktop lost its grid on next load.
    const desktopInGrid = writeScopedField({}, 'desktop', 'mode', 'grid')
    const afterPhoneExit = writeScopedField(desktopInGrid, 'mobile', 'mode', 'workspace')
    expect(readScopedField(roundTrip(afterPhoneExit), 'desktop', 'mode')).toBe('grid')
    expect(readScopedField(roundTrip(afterPhoneExit), 'mobile', 'mode')).toBe('workspace')
  })
})

describe('the legacy mirror has exactly ONE writer', () => {
  it('desktop mirrors its value into the legacy key — so a rollback still works', () => {
    expect(writeScopedField({}, 'desktop', 'mode', 'grid').mode).toBe('grid')
  })

  it('⛔⛔ mobile NEVER writes the legacy key', () => {
    const start = { mode: 'grid' }
    expect(writeScopedField(start, 'mobile', 'mode', 'workspace').mode).toBe('grid')
  })

  it('the registry declares the single mirror owner rather than leaving it implied', () => {
    expect(SCOPED_FIELDS.mode.legacyMirrorFrom).toBe('desktop')
    expect(SCOPED_FIELDS.mode.legacyFallbackFor).toEqual(['desktop'])
  })
})

describe('E · a semantic board write preserves BOTH presentation branches', () => {
  it('cells, layout and group are untouched by scoping — and scoping by them', () => {
    let s = writeScopedField({}, 'desktop', 'mode', 'grid')
    s = writeScopedField(s, 'mobile', 'mode', 'workspace')
    // A board change, exactly as the hook's non-mode mutators do it.
    const semantic = { ...s, cells: [{ id: 'a', sym: 'NVDA', tf: 'D', chartType: null }], group: { id: 'semis', name: 'Semis' } }
    const back = roundTrip(semantic)
    expect(back.cells[0].sym).toBe('NVDA')
    expect(back.group.id).toBe('semis')
    expect(readScopedField(back, 'desktop', 'mode')).toBe('grid')
    expect(readScopedField(back, 'mobile', 'mode')).toBe('workspace')
  })
})

describe('F · reload restores the right branch — through the REAL sanitizer', () => {
  it('⛔⛔ sanitizeState carries `presentation`, because it is an ALLOW-LIST', () => {
    // If this regresses, the scoped state is silently dropped on every hydrate
    // and each device wipes the other's branch — the feature would look like it
    // worked in memory and lose everything on reload.
    let s = writeScopedField({ layout: '2x2', cells: [] }, 'desktop', 'mode', 'grid')
    s = writeScopedField(s, 'mobile', 'mode', 'workspace')
    const back = roundTrip(s)
    expect(back.presentation).toBeTruthy()
    expect(back.presentation.desktop.mode).toBe('grid')
    expect(back.presentation.mobile.mode).toBe('workspace')
  })

  it('NON-VACUITY · the same round trip still carries ordinary board fields', () => {
    const back = roundTrip({ layout: '2x2', cells: [{ id: 'z', sym: 'AMD', tf: 'W' }] })
    expect(back.cells[0].sym).toBe('AMD')
  })
})

describe('G · a class this build has never heard of is PRESERVED', () => {
  it('an unknown branch survives a write from a known class', () => {
    const future = { presentation: { watch: { mode: 'grid' }, desktop: { mode: 'grid' } } }
    const after = writeScopedField(future, 'mobile', 'mode', 'workspace')
    expect(after.presentation.watch).toEqual({ mode: 'grid' })
  })

  it('and survives the persisted round trip', () => {
    const back = roundTrip({ presentation: { watch: { mode: 'grid' } }, cells: [] })
    expect(back.presentation.watch).toEqual({ mode: 'grid' })
  })

  it('an unknown FIELD inside a known class survives too', () => {
    const s = { presentation: { mobile: { mode: 'grid', someFutureThing: 7 } } }
    expect(writeScopedField(s, 'mobile', 'mode', 'workspace').presentation.mobile.someFutureThing).toBe(7)
  })
})

describe('H · malformed state can never stop a board loading', () => {
  const bad = [null, undefined, 'nonsense', 42, [], { presentation: 'nope' }, { presentation: 7 },
    { presentation: { mobile: 'not-an-object' } }, { presentation: { mobile: null } }]

  it('every malformed presentation degrades to a safe default, never a throw', () => {
    for (const b of bad) {
      expect(() => readScopedField(b, 'mobile', 'mode')).not.toThrow()
      expect(readScopedField(b, 'mobile', 'mode')).toBe('workspace')
    }
  })

  it('a malformed BRANCH is dropped without taking its siblings with it', () => {
    const mixed = { presentation: { mobile: 'garbage', desktop: { mode: 'grid' } } }
    const norm = normalisePresentation(mixed.presentation)
    expect(norm.desktop).toEqual({ mode: 'grid' })
    // ⛔ AND THE BAD BRANCH IS ACTUALLY GONE. Asserting only that the sibling
    // survived left this rail unable to tell "dropped" from "kept" — a mutation
    // that carried the garbage through passed it. A string where an object
    // belongs would reach `pres[cls][field]` on every later read.
    expect(norm).not.toHaveProperty('mobile')
    expect(readScopedField(mixed, 'desktop', 'mode')).toBe('grid')
  })

  it('an invalid VALUE falls through precedence rather than being stored', () => {
    const s = { presentation: { desktop: { mode: 'sideways' } }, mode: 'grid' }
    expect(readScopedField(s, 'desktop', 'mode')).toBe('grid')     // legacy rescues it
    expect(writeScopedField({}, 'mobile', 'mode', 'sideways').presentation.mobile.mode).toBe('workspace')
  })

  it('⛔ a write onto a malformed root still produces a loadable object', () => {
    const out = writeScopedField('not an object', 'mobile', 'mode', 'grid')
    expect(readScopedField(roundTrip(out), 'mobile', 'mode')).toBe('grid')
  })
})

describe('K/L · no blank board, no lost board state', () => {
  it('scoping never empties cells or the layout id', () => {
    const board = { layout: '2x2', cells: [{ id: 'a', sym: 'SPY', tf: 'D', chartType: null }] }
    const after = roundTrip(writeScopedField(board, 'mobile', 'mode', 'workspace'))
    expect(after.layout).toBe('2x2')
    expect(after.cells.some((c) => c.sym === 'SPY')).toBe(true)
  })

  it('⛔ an unknown field is not a licence to write one — only registry fields scope', () => {
    expect(() => writeScopedField({}, 'mobile', 'symbol', 'NVDA')).toThrow(/not a scoped field/)
    expect(() => readScopedField({}, 'mobile', 'symbol')).toThrow(/not a scoped field/)
  })
})
