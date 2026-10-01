// ─── ⭐⭐ C26 — `request.security` OF ANOTHER SYMBOL, through the member door ───
//
// On the vendor's own bars, both sides:
//
//   * the SERVED case — a script on NYSE:RDDT 1D reading `"AMEX:SPY"` is handed
//     SPY's bars from a COMMITTED capture (`vw-bool-cast-spy-1d-2026-09-28.json`,
//     TradingView's own SPY bars), and every RDDT bar reads SPY's close ON THAT
//     DATE — in the plot lane and in an object's text. ⚠️ No capture of this
//     composite script exists, so this is TradingView's SPY bars aligned the way
//     `request.security(…, gaps_off)` aligns them on a shared calendar — not yet a
//     vendor reading of the composite. The capture that would make it one is named
//     in the triage (§ C26).
//   * the REFUSED cases — every other-symbol read in the graded captures is spelled
//     BARE (`"XAUUSD"`, `"ADVN"`, `"EURUSD"`, `"CNXIT"`…), and each is refused by
//     name; and an object that reads a refused symbol is WITHHELD, never drawn off
//     a `NaN` (it used to print "NaN").

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide, toProductBars } from './ourSide'
import { OTHER_SYMBOL_REFUSAL as R } from '../../otherSymbols'

const REPO = path.resolve(process.cwd(), '..')
const H = path.join(REPO, 'tests/fixtures/vendor/harness')
const load = (n) => JSON.parse(fs.readFileSync(path.join(H, n), 'utf8'))
const RDDT = 'liquidity-pools-rddt-1d-2026-09-28.json'
const SPY_CAPTURE = 'vw-bool-cast-spy-1d-2026-09-28.json'
const on = (file, src) => {
  const base = load(file)
  return runOurSide({ ...base, source: { ...base.source, text: src } })
}
const pine = (lines) => ['//@version=5', 'indicator("c26", overlay=true)', ...lines].join('\n')

// ⭐ The objects-only pane door as production runs it (ARMED 2026-09-27): the
// graded captures here are objects-only scripts, and a door that refused them
// would leave nothing to read a refusal off.
beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

describe('C26 served — TradingView\'s SPY bars on an RDDT chart, date for date', () => {
  const spyByDate = new Map(toProductBars(load(SPY_CAPTURE)).map((b) => [b.t, b.c]))
  const rddt = toProductBars(load(RDDT))

  it('the plot lane: every RDDT bar reads SPY\'s vendor close on the same date', () => {
    const ours = on(RDDT, pine(['plot(request.security("AMEX:SPY", timeframe.period, close), "spy")']))
    expect(ours.ok).toBe(true)
    expect(ours.notes).toContain('other symbol SPY: served')
    expect(ours.notes).toContain(`other symbol SPY: bars from the committed capture ${SPY_CAPTURE}`)
    const col = Array.from(ours.plots[0].column)
    expect(col).toHaveLength(rddt.length)
    let compared = 0
    for (let i = 0; i < rddt.length; i++) {
      expect(spyByDate.has(rddt[i].t), rddt[i].t).toBe(true)
      expect(col[i], rddt[i].t).toBe(spyByDate.get(rddt[i].t))
      compared++
    }
    expect(compared).toBe(632)
    // ⭐ AND THE REAL BINDER DREW IT: `drawnColours` runs `binder.sync` with the
    // same supply, so a point on every bar means the chart's own path was served.
    const colours = ours.plots[0].colors || []
    expect(colours.filter((c) => typeof c === 'string').length).toBe(632)
  }, 60000)

  it('the object lane: a last-bar label prints SPY\'s vendor close', () => {
    const ours = on(RDDT, pine([
      'x = request.security("AMEX:SPY", timeframe.period, close)',
      'if barstate.islast',
      '    label.new(bar_index, high, str.tostring(x))',
    ]))
    const last = rddt[rddt.length - 1].t
    expect(ours.objects.counts.labels).toBe(1)
    expect(ours.objects.texts.labels).toEqual([String(spyByDate.get(last))])
  })

  it('control: the same read spelled bare is refused by name, and draws nothing', () => {
    const ours = on(RDDT, pine(['plot(request.security("SPY", timeframe.period, close), "spy")']))
    expect(ours.notes.some((n) => n.startsWith(`other symbol SPY: refused (${R.BARE})`)
      && n.includes('"AMEX:SPY"'))).toBe(true)
    expect(Array.from(ours.plots[0].column).every(Number.isNaN)).toBe(true)
  })
})

describe('C26 refused — the graded captures\' other-symbol reads, each named', () => {
  const CASES = {
    'smt-divergence-ict-01-tradingfinder-smart-money-technique-rddt-1d-2026-09-28.json': ['XAUUSD'],
    'mcclellan-indicators-rddt-1d-2026-09-28.json': ['ADVN', 'DECN'],
    'htf-liquidity-dashboard-tfo-rddt-1d-2026-09-28.json': ['AUDUSD', 'EURUSD', 'GBPUSD', 'USDJPY'],
  }
  for (const [file, tickers] of Object.entries(CASES)) {
    it(`${file.split('-rddt')[0]}: ${tickers.join(', ')} refused as bare spellings, none served`, () => {
      const ours = runOurSide(load(file))
      for (const t of tickers) {
        expect(ours.notes.some((n) => n.startsWith(`other symbol ${t}: refused (${R.BARE})`)), t).toBe(true)
      }
      expect(ours.notes.some((n) => / served$/.test(n))).toBe(false)
    })
  }

  it('⭐ an object that reads a refused symbol is WITHHELD — it used to print "NaN"', () => {
    const ours = on(RDDT, pine([
      'x = request.security("XAUUSD", timeframe.period, close)',
      'if barstate.islast',
      '    label.new(bar_index, high, str.tostring(x))',
    ]))
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.texts.labels).not.toContain('NaN')
    expect(ours.objects.counts.labels).toBe(0)
  })
})
