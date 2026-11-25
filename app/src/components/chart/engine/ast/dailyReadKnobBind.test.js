// ─── ⭐⭐ TRAIN e96 — U-DAILY'S DAILY ROUTE AND e95 2b'S BINDING COMPOSE: BIND FIRST, THEN ROUTE ──────────────────────
//
// Coordinator ruling 2026-11-23. e95 unit 2b keeps every arm of a `switch` on a member's `input.string` in the saved
// document, and one binding prunes the arms its knobs do not pick (`bind.js::pruneKnobArms`, `knobBind.js::
// boundDocument`). U-DAILY part A routes a tree that reads a daily value (`tf(x, 'D')`) to ONE evaluator
// (`interpret.js::interpretDailyReads`) and makes the chart fetch, and wait for, the daily bars it reads
// (`dailyReadSupply.js`, `useCalcFrames.js::framesNeeded`). A knob script WITH a daily read is bound first and routed
// second, on every path of the chart:
//   · the compute (`astColumns.js`): the bound document is interpreted, so an unpicked arm's daily read is never
//     routed, and nothing is withheld for daily bars the drawn arm never reads;
//   · the supply (`dailyReadSupplyFor`, the binder) and the fetch (`framesNeeded`): asked of the document the
//     instance's inputs bind, so an unpicked arm's daily read fetches nothing and never holds the instance pending.
// Each has a CONTROL: the arm that reads the day, picked, routes and waits as before. Python half:
// tests/test_e96_knob_daily_read.py. Mutants: ci/mutants/e96-train-integration.json.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { treeReadsDaily, DAILY_READ_NO_DAILY_BARS } from './interpret.js'
import { pruneKnobArms, bindConstsFor } from './bind.js'
import { astColumnsGiven } from '../astColumns.js'
import { dailyReadSupplyFor, dailyReadNeeds, defReadsDaily } from '../dailyReadSupply.js'
import { frameKey } from '../mtfProjection.js'
import { framesNeeded } from '../useCalcFrames.js'

const N = (value) => ({ type: 'num', value })
const S = (name) => ({ type: 'series', name })
const O = (name, ...args) => ({ type: 'op', name, args })
const TF = (value, child) => ({ type: 'tf', value, args: [child] })

const DAY = 2                                     // the option's index: what the knob ternary compares the knob with
const IS_DAY = O('==', S('anchor'), N(DAY))
/** `anchor == Day ? tf(close, 'D') : close`: a knob ternary whose Day arm reads the last finished day */
const KNOB_DAILY = O('?:', IS_DAY, TF('D', S('close')), S('close'))
const DOC = { id: 'u_knob_daily', compute: { kind: 'ast', ast: KNOB_DAILY }, plots: [{ key: 'value', style: 'line' }] }
const SESSION = { anchor: 0 }
const PICKS_DAY = { anchor: DAY }

/** The code with its comments removed (block comments, then line comments not inside a quote on that line), so a call
 *  written in a comment is never read as code. */
function stripComments(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlocks.split('\n').map((line) => {
    let quote = null
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
    }
    return line
  }).join('\n')
}

// THREE SESSIONS of four 5 minute bars (09:30..09:45 New York, EST = UTC-5): Monday 12 to Wednesday 14 January 2026
const CHART = []
for (const d of ['2026-01-12', '2026-01-13', '2026-01-14']) {
  for (let k = 0; k < 4; k += 1) {
    const c = 200 + CHART.length
    CHART.push({ t: Date.parse(`${d}T14:30:00Z`) / 1000 + k * 300, o: c, h: c + 1, l: c - 1, c, v: 1000 })
  }
}

describe('train e96: a knob script with a daily read is bound first, then routed', () => {
  it('non-vacuity: the saved document reads the day; each binding reads what it picks', () => {
    expect(treeReadsDaily(KNOB_DAILY)).toBe(true)
    expect(treeReadsDaily(pruneKnobArms(KNOB_DAILY, bindConstsFor({ inputs: SESSION })))).toBe(false)
    expect(treeReadsDaily(pruneKnobArms(KNOB_DAILY, bindConstsFor({ inputs: PICKS_DAY })))).toBe(true)
  })

  it('⭐⭐ THE COMPUTE: bound at Session the document draws `close` with no daily bars, nothing withheld', () => {
    // (routed first, the saved tree would go to the daily evaluator, and with no daily bars handed every bar would be
    // withheld: `DAILY_READ_NO_DAILY_BARS`)
    expect(DAILY_READ_NO_DAILY_BARS).toBeTruthy()
    const out = astColumnsGiven(DOC, CHART, SESSION, { tf: '5' }, null)
    expect(Array.from(out.value)).toEqual(CHART.map((b) => b.c))
  })

  it('CONTROL: bound at Day with no daily bars handed, every bar is withheld', () => {
    const out = astColumnsGiven(DOC, CHART, PICKS_DAY, { tf: '5' }, null)
    expect(Array.from(out.value).every((v) => Number.isNaN(v))).toBe(true)
  })

  it('⭐⭐ THE SUPPLY: an unpicked daily arm fetches nothing and never holds the instance pending', () => {
    expect(defReadsDaily(DOC, SESSION)).toBe(false)
    expect(dailyReadNeeds(DOC, 'NVDA', SESSION)).toEqual([])
    expect(dailyReadSupplyFor(DOC, new Map(), 'NVDA', '5', SESSION), 'computed now, never pending').toBe(null)
  })

  it('CONTROL: the picked daily arm needs the daily bars and waits for them; the saved document (no inputs) as before', () => {
    expect(dailyReadNeeds(DOC, 'NVDA', PICKS_DAY)).toEqual(['NVDA'])
    expect(dailyReadSupplyFor(DOC, new Map(), 'NVDA', '5', PICKS_DAY)).toEqual({ pending: true })
    expect(dailyReadNeeds(DOC, 'NVDA')).toEqual(['NVDA'])
  })

  it('⭐ THE BINDER\'S CALL (code, comments stripped): the supply is asked with the instance\'s own inputs', () => {
    // the binder's sync is not driven here; its ONE call to the supply is read from the code: every call (the import
    // aside) hands the instance's inputs, the same `inst.inputs` the compute (`registry.computeFor`) is handed
    const code = stripComments(fs.readFileSync(path.resolve(__dirname, '../binder.js'), 'utf8'))
    const calls = code.match(/dailyReadSupplyFor\([^)]*\)/g) || []
    expect(calls.length, 'the binder asks the supply once').toBe(1)
    expect(calls[0]).toBe('dailyReadSupplyFor(def, frameMap, ctx.sym, ctx.tf, inst.inputs || {})')
    expect(code).toMatch(/registry\.computeFor\(def, calcBars, inst\.inputs,/)
  })

  it('⭐ THE FETCH (`framesNeeded`): asked of the document each instance\'s inputs bind', () => {
    const defOf = (id) => (id === DOC.id ? DOC : null)
    const keysFor = (inputs) => framesNeeded([{ instanceId: 'i1', defId: DOC.id, inputs }], defOf, 'NVDA', '5')
      .map((f) => frameKey(f.frame, f.symbol))
    expect(keysFor(SESSION), 'an unpicked daily arm fetches nothing').toEqual([])
    expect(keysFor(PICKS_DAY)).toEqual([frameKey('D', 'NVDA')])
  })
})
