// ─── ⭐⭐ RS RATING L3 — `syminfo.industry` through the vendor harness, on the L7 contract ──
//
// The grade feeds our side the VENDOR's own value of each substituted input (the capture's
// `symbol.industry`, read with `compare.mjs::vendorValueOf`), and our side declares it:
// `substituted: [{name, source, vendorValueFrom, value}]`. The comparator then grades the run
// MATCH_SUBSTITUTED, never MATCH. The bars and vendor values are a committed SMA/EMA observation;
// its script is replaced by one whose first plot DEPENDS on `syminfo.industry` (SMA for a fund,
// EMA otherwise), so the vendor's SMA column is matched only when the vendor's industry was fed.
// ⚠️ No committed capture carries `symbol.industry` yet (Q-RS4 is queued), so the capture is given
// the field it would carry, and resealed: that is the shape under test, not a measurement.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { fromObservation } from '../../../../../../../tools/vendor_harness/adapters.mjs'
import { sealCapture, sha256Hex } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { runOurSide } from './ourSide'
import { gradeCapture, REPO } from './harness'

vi.setConfig({ testTimeout: 60000 })

const clone = (x) => JSON.parse(JSON.stringify(x))
const OBS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/observations/sma-close20-2026-09-06.json'), 'utf8'))
const BASE = fromObservation(OBS, { path: 'observations/sma-close20-2026-09-06.json' })
const FUND = 'Investment Trusts/Mutual Funds'
const SCRIPT = `//@version=5
indicator("uct-sma-ema-parity-v1", overlay=false)
isFund = syminfo.industry == '${FUND}'
sma20 = ta.sma(close, 20)
ema20 = ta.ema(close, 20)
plot(isFund ? sma20 : ema20, title="sma20")
plot(ema20, title="ema20")
`
const capture = ({ source = SCRIPT, symbol = {} } = {}) => {
  const c = clone(BASE)
  // the observation pairs its one vendor column by FORMULA (`sma(close, 20)`); the replaced script
  // spells it as a `?:`, so the vendor column is paired by its title instead, the same column
  const study = { ...c.study, plots: c.study.plots.map((p) => ({ ...p, selector: { title: 'sma20' } })) }
  return sealCapture({ ...c, study, source: { ...c.source, text: source, sha256: sha256Hex(source) },
    symbol: { ...c.symbol, ...symbol } })
}
const TAG = (value) => ({ name: 'syminfo.industry', source: 'uct:ticker_meta', vendorValueFrom: 'capture.symbol.industry', value })

describe('L3 — the harness feeds the vendor\'s industry and declares it', () => {
  it('⭐ fed the vendor\'s industry: the plot folds on it and the run grades MATCH_SUBSTITUTED', () => {
    const cap = capture({ symbol: { industry: FUND } })
    const { verdict, ours } = gradeCapture(cap)
    expect(ours.ctx.symbol.industry).toBe(FUND)
    expect(ours.substituted).toEqual([TAG(FUND)])
    expect(verdict.verdict, verdict.reason).toBe('MATCH_SUBSTITUTED')
    expect(verdict.substituted.map((e) => e.name)).toEqual(['syminfo.industry'])
  })
  it('⛔ CONTROL — the vendor files the symbol elsewhere: the same script now draws EMA, and the grade sees it', () => {
    const cap = capture({ symbol: { industry: 'Asset Management' } })
    const { verdict, ours } = gradeCapture(cap)
    expect(ours.substituted).toEqual([TAG('Asset Management')])
    expect(verdict.verdict).toBe('DIVERGE')
  })
  it('⛔ no industry on the capture: nothing is fed or declared, and the plot is refused by name', () => {
    const cap = capture()
    const ours = runOurSide(cap)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.substituted).toEqual([])
    const p = ours.plots.find((x) => x.title === 'sma20')
    expect(p.column).toBeNull()
    expect(p.missingReason).toContain('interpret:bind-time-text')
    expect(compareCapture(cap, ours, { integrity: { ok: true, errors: [] } }).verdict).not.toMatch(/^MATCH/)
  })
  it('a script that reads no classification field declares nothing, whatever the capture carries', () => {
    const cap = capture({ source: OBS.script.source, symbol: { industry: FUND } })
    const { verdict, ours } = gradeCapture(cap)
    expect(ours.substituted).toEqual([])
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
  })
})
