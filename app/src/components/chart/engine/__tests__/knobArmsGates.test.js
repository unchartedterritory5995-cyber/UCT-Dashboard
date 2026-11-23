// ─── ⭐⭐ TRAIN e95 (the 2b bind audit) — EVERY BROWSER GATE DECIDES ON WHAT A BINDING DRAWS, NEVER ON AN UNPICKED ARM ───
//
// Since e95 unit 2b the member door builds every arm of a `switch` on a member's `input.string` (a live knob) and the
// SAVED document keeps them all; one binding prunes the arms its knobs do not pick (`knobBind.js::boundAtInputs`). Before
// 2b the door folded the switch to its default (2b's own CONTROL: `enumInputs: false`), so a saved document held one
// arm. A gate that read the saved document therefore began to refuse a knob script on an arm the member never picked:
// the VWAP built-in's Earnings arm reads `earnings.standardized` (`EV-ES-11`, a field UCT does not hold).
//
// The gates bind at the instance's settings (`evaluability.js::gateDocument`; `customStatCompute.js` through
// `boundAtInputs`), at the declared defaults when the caller holds no instance; and an arm the member DOES pick still
// refuses by name (the CONTROLS). The server half is `tests/test_knob_arms_gates.py`; mutants
// `ci/mutants/e95-bind-audit.json`. The import screen needs no bind: its translation (`inspectSource`) never asks for
// live knobs, so it folds every switch at the default (pinned last).

import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { evaluability, STATUS, gateDocument } from '../evaluability'
import { customStatOutputRefusal } from '../customStatCompute'
import { symTickersOf } from '../otherSymbols'
import { inspectSource } from '../../builder/inspectSource'
import { importOutcome } from '../ast/importOutcome'

const SRC = ['//@version=6', 'indicator("knob gates", overlay = true)',
  'anchor = input.string("Session", "Anchor Period", options = ["Session", "Week", "Earnings"])',
  'isNew = switch anchor',
  '    "Earnings" =>',
  '        e = request.earnings(syminfo.tickerid, earnings.standardized, barmerge.gaps_on, barmerge.lookahead_on)',
  '        not na(e)',
  '    "Session" => timeframe.change("D")',
  '    "Week" => timeframe.change("W")',
  '    => false',
  'plot(ta.vwap(hlc3, isNew), "VWAP")'].join('\n')

const door = () => {
  const d = memberPaneDefinition({ source: SRC, id: 'u_knob_gates', name: 'g' })
  expect(d.ok, d.reason).toBe(true)
  return d.definition
}
const ctxAt = (inputs) => ({ tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, exchangeOf: () => null,
  secondary: new Map(), ...(inputs ? { inputs } : {}) })
const eventReads = (def) => symTickersOf(def).filter((t) => t.startsWith('EV-ES'))
const keyOf = (def) => def.plots.find((p) => p && p.key).key

describe('the saved document reads the unpicked arm; the bound one does not (non-vacuity)', () => {
  it('the saved trees and stamp read the earnings field; bound at the defaults neither does; bound at Earnings both do', () => {
    const def = door()
    expect(eventReads(def).length).toBeGreaterThan(0)
    expect(JSON.stringify(def.meta.otherSymbols || [])).toContain('EV-ES')
    const atDefaults = gateDocument(def, {})
    expect(eventReads(atDefaults)).toEqual([])
    expect(JSON.stringify(atDefaults.meta.otherSymbols || [])).not.toContain('EV-ES')
    expect(eventReads(gateDocument(def, { inputs: { anchor: 'Earnings' } })).length).toBeGreaterThan(0)
    const plain = memberPaneDefinition({ source: SRC.replace(/anchor = input[^\n]*\n/, 'anchor = "Session"\n'), id: 'u_p', name: 'p' })
    if (plain.ok) expect(gateDocument(plain.definition, {})).toBe(plain.definition)    // nothing to prune: itself
  })
})

describe('evaluability binds at the instance\'s settings (the defaults with none)', () => {
  it('info-value (the header): served at the defaults and at Week; at Earnings refused BY NAME (CONTROL)', () => {
    const def = door()
    const key = keyOf(def)
    expect(evaluability(def, key, 'info-value', ctxAt()).status).not.toBe(STATUS.REFUSED)
    expect(evaluability(def, key, 'info-value', ctxAt({ anchor: 'Week' })).status).not.toBe(STATUS.REFUSED)
    const picked = evaluability(def, key, 'info-value', ctxAt({ anchor: 'Earnings' }))
    expect(picked.status).toBe(STATUS.REFUSED)
    expect(String(picked.guard)).toMatch(/^other-symbol:/)
  })

  it('the alert mirror: admitted at the defaults; at Earnings withheld by name (CONTROL)', () => {
    const def = door()
    const key = keyOf(def)
    expect(evaluability(def, key, 'alert', ctxAt()).status).not.toBe(STATUS.REFUSED)
    const picked = evaluability(def, key, 'alert', ctxAt({ anchor: 'Earnings' }))
    expect(picked.status).toBe(STATUS.REFUSED)
    expect(picked.gate).toBe('withheld')
    expect(picked.codes).toContain('other-symbol:unservable')
  })
})

describe('the header custom stat binds at the stat\'s settings', () => {
  it('offered at the defaults; at Earnings refused for reading another symbol (CONTROL)', () => {
    const def = door()
    const key = keyOf(def)
    expect(customStatOutputRefusal(def, key)).toBe(null)
    expect(customStatOutputRefusal(def, key, undefined, { anchor: 'Week' })).toBe(null)
    expect(customStatOutputRefusal(def, key, undefined, { anchor: 'Earnings' })).toMatch(/another symbol/)
  })
})

describe('the import screen needs no bind: its translation folds every switch at the default', () => {
  it('no output is listed missing for an unpicked arm, and the translation it reads holds no event read', () => {
    const report = inspectSource(SRC, 'pine')
    expect(report.ok, JSON.stringify({ refusal: report.refusal || null, error: report.error || null,
      foreign: report.foreign || null, keys: Object.keys(report) })).toBe(true)
    expect(JSON.stringify(report.outputs)).not.toContain('EV-ES')
    expect(importOutcome(report).missing).toEqual([])
  })
})
