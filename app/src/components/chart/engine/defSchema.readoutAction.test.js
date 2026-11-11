// app/src/components/chart/engine/defSchema.readoutAction.test.js
//
// ─── UCT RS Phase 3, unit 3-07 · the readout grammar 3-08 needs ─────────────
//
// Three pieces of engine grammar, each validated fail-closed at registration and
// read the same way at render:
//
//   1. `readout[].action` — what a row offers to DO (`pickDate`, `resetInput`,
//      `openRotation`). A closed vocabulary; an input-naming action must name a
//      declared `string` input. `readoutRows` copies a well-formed action onto
//      its row (rendering is StockChart's, unit 3-09).
//   2. the EQUALS gate `when: 'input:<key>=<value>'` — a row printed only under
//      one option of an ENUM input (`input:view=rotation`). The value must be one
//      of that input's declared option codes.
//   3. `activeWhen: {key, equals}` keyed on an ENUM input — accepted, and since
//      3-07 the value must be one of the input's options (a typo would hide the
//      control forever, the same class as an unresolvable key).
//
// The fixture is the real `rsLine` definition with two inputs 3-08 will add (a
// `view` enum and an `anchorDate` string) and a readout block of its own, so
// every acceptance is one the registry would make.

import { describe, it, expect } from 'vitest'
import { validateDefinition } from './defSchema'
import {
  readoutRows, parseReadoutGate, parseReadoutSource, READOUT_ACTION_KINDS, READOUT_ENTRY_FIELDS,
} from './readoutSchema'
import * as engineRegistry from './nativeRegistry'

const RS = engineRegistry.getDefinition('rsLine')

const VIEW = Object.freeze({
  key: 'view', type: 'enum', label: 'Reading', default: 'ratio', group: 'Simple',
  // + 'rating' (rev 5): the registered `legendFallback` and `ratingGuides` gate on it
  options: [['ratio', 'RS line'], ['mansfield', 'Mansfield'], ['rotation', 'Rotation'], ['quality', 'Quality'], ['vars', 'VARS'],
    ['rating', 'RS Rating']],
})
const ANCHOR = Object.freeze({ key: 'anchorDate', type: 'string', label: 'Anchor date', default: '', group: 'Checks' })

const BASE_ROWS = Object.freeze([
  { key: 'resolved', label: 'Benchmark', source: 'scalar:benchmark.resolved', format: 'text' },
])

/** `RS.inputs` with the fixture's own inputs in place of the registered ones of
 *  the same key. ⭐ 3-08 shipped a real `view` and `anchorDate`, so appending
 *  would declare each key twice; the fixture's `view` carries every option the
 *  registered `legendFallback` and guides gate on, so the definition still
 *  registers with the fixture's own control in place of the shipped one. */
const inputsWith = (extra) => [...RS.inputs.filter((i) => !extra.some((x) => x.key === i.key)), ...extra]

/** The rsLine definition with the two inputs and the given readout rows. */
const defWith = (rows, { inputs = [VIEW, ANCHOR] } = {}) => ({
  ...RS,
  inputs: inputsWith(inputs),
  readout: [...BASE_ROWS, ...rows],
})

const accept = (rows, opts) => {
  const r = validateDefinition(defWith(rows, opts))
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.def
}
const refuse = (rows, opts) => {
  const r = validateDefinition(defWith(rows, opts))
  expect(r.ok, 'expected a refusal').toBe(false)
  return r.errors.join('\n')
}

const ROW = (extra) => ({ key: 'anchor', label: 'Anchor', source: 'scalar:checks.anchor.date', format: 'text', ...extra })

describe('control: the fixture itself registers', () => {
  it('rsLine plus a view enum, an anchorDate string and a plain row is a valid definition', () => {
    expect(() => accept([])).not.toThrow()
    expect(READOUT_ENTRY_FIELDS).toContain('action')
    expect(READOUT_ACTION_KINDS).toEqual(['pickDate', 'resetInput', 'openRotation'])
  })
})

describe('readout[].action — accepted shapes', () => {
  it('pickDate and resetInput on a declared string input, openRotation bare', () => {
    expect(() => accept([
      ROW({ action: { kind: 'pickDate', input: 'anchorDate' } }),
      ROW({ key: 'reset', action: { kind: 'resetInput', input: 'anchorDate' } }),
      ROW({ key: 'rotation', action: { kind: 'openRotation' } }),
    ])).not.toThrow()
  })

  it('the resolved row carries a fresh copy of its action; a row without one has no field', () => {
    const def = accept([
      ROW({ action: { kind: 'pickDate', input: 'anchorDate' } }),
      ROW({ key: 'rotation', action: { kind: 'openRotation' } }),
    ])
    const scalars = { benchmark: { resolved: 'SPY' }, checks: { anchor: { date: '2026-10-14' } } }
    const rows = readoutRows(def, scalars, { inputs: {} })
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by.anchor.action).toEqual({ kind: 'pickDate', input: 'anchorDate' })
    expect(by.rotation.action).toEqual({ kind: 'openRotation' })
    expect(by.resolved).not.toHaveProperty('action')
    // a fresh object: mutating it cannot reach the definition
    by.anchor.action.input = 'tampered'
    const again = readoutRows(def, scalars, { inputs: {} }).find((r) => r.key === 'anchor')
    expect(again.action.input).toBe('anchorDate')
  })

  it('an action rides a muted fallback row too (the Checks anchor before any date resolves)', () => {
    const def = accept([ROW({ fallback: 'default anchor', action: { kind: 'pickDate', input: 'anchorDate' } })])
    const row = readoutRows(def, { benchmark: { resolved: 'SPY' } }, { inputs: {} }).find((r) => r.key === 'anchor')
    expect(row.muted).toBe(true)
    expect(row.action).toEqual({ kind: 'pickDate', input: 'anchorDate' })
  })

  it('at runtime a malformed action on an unvalidated definition is dropped, never copied', () => {
    const def = { ...defWith([ROW({ action: { kind: 'launchMissiles' } })]) }
    const scalars = { benchmark: { resolved: 'SPY' }, checks: { anchor: { date: '2026-10-14' } } }
    const row = readoutRows(def, scalars, { inputs: {} }).find((r) => r.key === 'anchor')
    expect(row).toBeTruthy()
    expect(row).not.toHaveProperty('action')
  })
})

describe('readout[].action — refusals', () => {
  it('an unknown kind', () => {
    expect(refuse([ROW({ action: { kind: 'openCompare' } })])).toMatch(/readout\[1\]\.action\.kind: .*unknown readout action "openCompare"/)
  })

  it('not an object', () => {
    expect(refuse([ROW({ action: 'pickDate' })])).toMatch(/readout\[1\]\.action: .*expected \{kind, input\?\}/)
  })

  it('pickDate / resetInput without an input, or naming an undeclared one', () => {
    expect(refuse([ROW({ action: { kind: 'pickDate' } })])).toMatch(/action\.input: .*names the input it writes/)
    expect(refuse([ROW({ action: { kind: 'resetInput', input: 'nope' } })])).toMatch(/action\.input: .*"nope" names no declared input/)
  })

  it('pickDate / resetInput on an input that is not a string', () => {
    expect(refuse([ROW({ action: { kind: 'pickDate', input: 'maLength' } })])).toMatch(/writes a "string" input, and "maLength" is "int"/)
    expect(refuse([ROW({ action: { kind: 'resetInput', input: 'view' } })])).toMatch(/"view" is "enum"/)
  })

  it('a field the kind does not carry', () => {
    expect(refuse([ROW({ action: { kind: 'openRotation', input: 'anchorDate' } })])).toMatch(/action\.input: .*"openRotation" action carries only kind/)
    expect(refuse([ROW({ action: { kind: 'pickDate', input: 'anchorDate', label: 'Pick' } })])).toMatch(/action\.label: /)
  })
})

describe('the equals gate — `when: input:<key>=<value>`', () => {
  const GLANCE = (view) => ({
    key: `glance_${view}`, label: 'Reading', source: 'scalar:benchmark.resolved', format: 'text', when: `input:view=${view}`,
  })

  it('parses into {kind: input, path, equals}; the source grammar does NOT take it', () => {
    expect(parseReadoutGate('input:view=rotation')).toEqual({ kind: 'input', path: ['view'], equals: 'rotation' })
    expect(parseReadoutGate('scalar:benchmark.note')).toEqual(parseReadoutSource('scalar:benchmark.note'))
    expect(parseReadoutSource('input:view=rotation')).toBeNull()
    // closed: no scalar equals, no empty value, no second `=`
    for (const bad of ['scalar:a.b=c', 'input:view=', 'input:view==rotation', 'input:view=a=b', 'input:=rotation']) {
      expect(parseReadoutGate(bad), bad).toBeNull()
    }
  })

  it('registers, and each row prints only under its own view (default, stored, and other)', () => {
    const def = accept([GLANCE('ratio'), GLANCE('rotation')])
    const scalars = { benchmark: { resolved: 'SPY' } }
    const keys = (inputs) => readoutRows(def, scalars, { inputs }).map((r) => r.key)
    expect(keys({})).toEqual(['resolved', 'glance_ratio'])                    // the declared default
    expect(keys({ view: 'rotation' })).toEqual(['resolved', 'glance_rotation'])
    expect(keys({ view: 'quality' })).toEqual(['resolved'])
  })

  it('works on a band gate too', () => {
    const def = accept([{
      key: 'rated', label: 'Rating', source: 'scalar:rating.ibd', format: 'int',
      band: { source: 'scalar:rating.ibd', when: 'input:view=ratio' },
    }])
    const scalars = { benchmark: { resolved: 'SPY' }, rating: { ibd: 94 } }
    const rated = (inputs) => readoutRows(def, scalars, { inputs }).find((r) => r.key === 'rated')
    expect(rated({}).band).toBe('lead')
    expect(rated({ view: 'rotation' })).not.toHaveProperty('band')
  })

  it('refuses a value the enum does not declare (a typo would hide the row forever)', () => {
    expect(refuse([GLANCE('rotaion')])).toMatch(/readout\[1\]\.when: .*"rotaion" is not one of "view"'s option values: "ratio", "mansfield", "rotation", "quality", "vars"/)
  })

  it('refuses an undeclared key, and a key that is not an enum', () => {
    expect(refuse([{ ...GLANCE('ratio'), when: 'input:viewMode=ratio' }])).toMatch(/\.when: .*"viewMode" names no declared input/)
    expect(refuse([{ ...GLANCE('ratio'), when: 'input:anchorDate=x' }])).toMatch(/compares an ENUM input .* "anchorDate" is "string"/)
    expect(refuse([{ ...GLANCE('ratio'), when: 'input:showMansfield=true' }])).toMatch(/"showMansfield" is "bool"/)
  })

  it('a band gate is held to the same rule', () => {
    expect(refuse([{
      key: 'rated', label: 'Rating', source: 'scalar:rating.ibd', format: 'int',
      band: { source: 'scalar:rating.ibd', when: 'input:view=nope' },
    }])).toMatch(/band\.when: .*"nope" is not one of/)
  })

  it('a note does not take the equals form (only a gate is a condition)', () => {
    expect(refuse([ROW({ note: 'input:view=ratio' })])).toMatch(/readout\[1\]\.note: .*is not a readout source/)
  })

  it('at runtime an unvalidated equals gate on an absent input stays closed', () => {
    const def = { ...defWith([]), readout: [...BASE_ROWS, { ...GLANCE('ratio'), when: 'input:ghost=ratio' }] }
    expect(readoutRows(def, { benchmark: { resolved: 'SPY' } }, { inputs: {} }).map((r) => r.key)).toEqual(['resolved'])
  })
})

describe('activeWhen {key, equals} on an ENUM input', () => {
  const withInput = (extra) => validateDefinition({
    ...RS,
    inputs: inputsWith([VIEW, ANCHOR, { key: 'customBenchmark', type: 'string', label: 'Your symbol', default: '', group: 'Simple', ...extra }]),
  })

  it('accepted on an option value (the 3-08 customBenchmark shape on the real benchmark enum)', () => {
    const r = withInput({ activeWhen: { key: 'benchmark', equals: 'SECTOR' } })
    expect(r.ok, r.errors && r.errors.join('\n')).toBe(true)
    expect(withInput({ activeWhen: { key: 'view', in: ['rotation', 'quality'] } }).ok).toBe(true)
    expect(withInput({ activeWhen: { key: 'view', notEquals: 'ratio' } }).ok).toBe(true)
  })

  it('refused on a value no option carries (equals, notEquals, in)', () => {
    expect(withInput({ activeWhen: { key: 'benchmark', equals: 'CUSTUM' } }).errors.join('\n'))
      .toMatch(/activeWhen\.equals: "CUSTUM" is not one of "benchmark"'s option values/)
    expect(withInput({ activeWhen: { key: 'view', notEquals: 'Ratio' } }).errors.join('\n'))
      .toMatch(/activeWhen\.notEquals: "Ratio"/)
    expect(withInput({ activeWhen: { key: 'view', in: ['rotation', 'rrg'] } }).errors.join('\n'))
      .toMatch(/activeWhen\.in: "rrg" is not among "view"'s option values/)
  })

  it('a bool-keyed condition keeps its old latitude (the shipped RS rows)', () => {
    expect(withInput({ activeWhen: { key: 'showMansfield', equals: true } }).ok).toBe(true)
  })

  it('an hlines guide keyed on the enum is held to the same rule', () => {
    // The shipped Mansfield zero guide's shape, as the Rotation 100 guide 3-08 adds.
    const guide = (equals) => ({
      key: 'rotation100', label: '100', style: 'hlines', levels: [100], color: 'rgba(255,255,255,0.12)', width: 1,
      lineStyle: 'solid', role: 'context', activeWhen: { key: 'view', equals },
    })
    const run = (equals) => validateDefinition({ ...RS, inputs: inputsWith([VIEW]), plots: [...RS.plots, guide(equals)] })
    const okRun = run('rotation')
    expect(okRun.ok, okRun.errors && okRun.errors.join('\n')).toBe(true)
    expect(run('rotaion').errors.join('\n')).toMatch(/activeWhen\.equals: "rotaion" is not one of "view"'s option values/)
  })
})
