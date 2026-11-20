// app/src/components/chart/engine/runtime/__tests__/strToNumberVendor.test.js
//
// ─── ⭐⭐ STR-TONUMBER (NUMBER PENDING) — `str.tonumber` AS TRADINGVIEW READS TEXT, EVERY ROW, EVERY BAR ───────
//
// Witness: `vw-bi-str-tonumber-spy-1d-2026-11-19` (committed; our own probe `vw-bi-str-tonumber.pine`). Each row
// plots `na(str.tonumber(s)) ? -999 : str.tonumber(s)` for one spelling. TradingView reads " 3" and "3 " as 3,
// and "1e3" / "1E-2" as `na`; this lane read the first two as `na` and the exponents as 1000 and 0.01, so four
// rows DIVERGED on every bar (a served wrong value). The rule is `runtime/text.js::toNumber`: the spaces around
// the text dropped, then an optional sign, digits, an optional point and fraction, and nothing else.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const CAP = JSON.parse(fs.readFileSync(path.join(REPO,
  'tests/fixtures/vendor/harness/vw-bi-str-tonumber-spy-1d-2026-11-19.json'), 'utf8'))
const BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const TITLES = CAP.study.plots.map((p) => p.title)
const TV = Object.fromEntries(CAP.study.plots.map((p) => {
  const at = CAP.plotValues.fields.indexOf(p.id)
  return [p.title, CAP.plotValues.rows.map((r) => (r[at] === null ? NaN : r[at]))]
}))
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

function ours() {
  const keys = TITLES.map((_, i) => `p${i}`)
  const out = computeRuntimeColumns({
    id: 'stn', meta: { runtimeHistory: 'listing' },
    compute: { kind: 'runtime', fn: 'runtime:stn', outputs: Object.fromEntries(keys.map((k, i) => [k, i])), source: CAP.source.text },
  }, BARS, CTX)
  return Object.fromEntries(TITLES.map((t, i) => [t, Array.from(out[keys[i]] || [])]))
}
const offBars = (got, want) => want.map((_, i) => i).filter((i) => !(Object.is(got[i], want[i])
  || (Number.isNaN(got[i]) && Number.isNaN(want[i]))))

describe('`str.tonumber` reads TradingView\'s text, all 21 rows, every bar', () => {
  it('the witness is what this file says: 22 rows, " 3" / "3 " are 3, the exponents are na', () => {
    expect(TITLES).toHaveLength(22)
    expect(TV.N05_lead_space.every((v) => v === 3)).toBe(true)
    expect(TV.N06_trail_space.every((v) => v === 3)).toBe(true)
    expect(TV.N07_exponent.every((v) => v === -999)).toBe(true)
    expect(TV.N08_exponent_neg.every((v) => v === -999)).toBe(true)
  })
  it('the runtime lane draws every row TradingView draws, bit for bit', () => {
    const got = ours()
    for (const t of TITLES) {
      expect(got[t].length, t).toBe(BARS.length)
      expect(offBars(got[t], TV[t]), t).toEqual([])
    }
  })
})

describe('⛔ only the SPACE is measured: another blank around the text stops the run by name', () => {
  const head = '//@version=6\nindicator("t", overlay = true)\n'
  const N = 4
  const bars = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 99, h: 101, l: 98, c: 100 + i, v: 1 }))
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const run = (text) => {
    const src = `${head}string s = "!none"\nif close > open\n    s := ${text}\nplot(str.tonumber(s))\n`
    const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: { ticker: 'SPY', exchange: 'NYSE Arca' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    const program = lowerIrProgram(built.ir)
    return Array.from(execute(program, { bars: N, series, columns: program.columns, confirmed: true }).outputs[0])
  }
  it('two spaces either side are dropped as one is', () => {
    expect(run('"  5  "')).toEqual(new Array(N).fill(5))
  })
  it('a line break or a no-break space at either end is not read either way', () => {
    // `\n` is the one Pine escape this engine's lexer reads (`pine.js`); a no-break space is written as itself
    for (const text of ['"5\\n"', '"\\n5"', '" 5"', '"5 "']) expect(() => run(text), text).toThrow(/not measured/)
  })
})
