// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.l7Substituted.test.js
//
// ─── ⭐⭐ L7 (2026-11-14) — A SUBSTITUTED-INPUT GRADE NEVER READS MATCH ───────────
//
// Owner ruling (option a): grade everything except the substituted values, which are
// labelled "UCT data". Peer ask: a substituted series never counts as MATCH anywhere.
// The harness side of that: when our side declares a substituted input
// (`ourSide.js::substitutedInputsOf`, the contract in `compare.mjs`), and was FED the
// vendor's own value for it off the capture, an all-agree grade is `MATCH_SUBSTITUTED`,
// a disagreement is `DIVERGE` as usual, and a declaration that was NOT fed the vendor's
// value is INCONCLUSIVE.
//
// ⚠️ SYNTHETIC: the capture is the SMA observation's REAL vendor bars and values, with one
// synthetic `symbol.industry` field sealed onto it, and our side's result is the real member
// door's, with a STUB declaration of one substituted input. Nothing in the engine emits a
// substitution yet (L3 is the first), so the declaration cannot come from a real run here.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import {
  compareCapture, renderSummary, VERDICTS, MATCH_SUBSTITUTED, vendorValueOf, substitutionProblems,
} from '../../../../../../../tools/vendor_harness/compare.mjs'
import { fromObservation } from '../../../../../../../tools/vendor_harness/adapters.mjs'
import { runOurSide, substitutedInputsOf } from './ourSide'
import { REPO } from './harness'

const clone = (x) => JSON.parse(JSON.stringify(x))
const OBS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/observations/sma-close20-2026-09-06.json'), 'utf8'))
const BASE = fromObservation(OBS, { path: 'observations/sma-close20-2026-09-06.json' })
const INDUSTRY = 'Investment Trusts/Mutual Funds'
const withIndustry = (c) => sealCapture({ ...clone(c), symbol: { ...c.symbol, industry: INDUSTRY } })
const CAPTURE = withIndustry(BASE)
const ENTRY = Object.freeze({ name: 'syminfo.industry', source: 'uct:ticker_meta', vendorValueFrom: 'capture.symbol.industry', value: INDUSTRY })
const OK = { integrity: { ok: true, errors: [] } }

// ONE real run of the member door (it reads only the bars, which every variant below shares)
const OURS = runOurSide(CAPTURE)
const declaring = (...entries) => ({ ...OURS, substituted: entries.map((e) => ({ ...e })) })

describe('L7 — the substituted-input grade', () => {
  it('our side declares no substitution today, and the contract helper refuses a malformed one', () => {
    expect(OURS.ok, OURS.refusal).toBe(true)
    expect(OURS.substituted).toEqual([])
    expect(substitutedInputsOf(CAPTURE, [ENTRY])).toEqual([ENTRY])
    expect(() => substitutedInputsOf(CAPTURE, [{ ...ENTRY, value: 'Semiconductors' }])).toThrow(/not the vendor's/)
    expect(vendorValueOf(CAPTURE, 'capture.symbol.industry')).toEqual({ found: true, value: INDUSTRY })
    expect(vendorValueOf(CAPTURE, 'capture.symbol.sector').found).toBe(false)
    expect(VERDICTS).toContain(MATCH_SUBSTITUTED)
  })

  it('⛔ CONTROL — the same capture with NO substitution declared grades plain MATCH', () => {
    const v = compareCapture(CAPTURE, OURS, OK)
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.substituted).toBeUndefined()
    expect(v.plots.every((p) => p.verdict === 'MATCH')).toBe(true)
  })

  it('⭐ one declared substituted input, fed the vendor value, everything equal: MATCH_SUBSTITUTED, never MATCH', () => {
    const v = compareCapture(CAPTURE, declaring(ENTRY), OK)
    expect(v.verdict, v.reason).toBe(MATCH_SUBSTITUTED)
    expect(v.reason).toMatch(/syminfo\.industry/)
    expect(v.substituted).toEqual([{ name: 'syminfo.industry', source: 'uct:ticker_meta',
      vendorValueFrom: 'capture.symbol.industry', checked: 'by the comparator, against the capture' }])
    // no output of a substituted run reads MATCH, at any level
    expect(v.plots.length).toBeGreaterThan(0)
    expect(v.plots.map((p) => p.verdict)).not.toContain('MATCH')
    expect(v.plots.every((p) => p.verdict === MATCH_SUBSTITUTED)).toBe(true)
    // the values were really compared (the grade is not vacuous)
    expect(v.plots[0].stats.steady.compared).toBeGreaterThan(1900)
  })

  it('⛔ a disagreement under a substitution is DIVERGE, as usual', () => {
    const c = clone(CAPTURE)
    const t = c.bars.rows[1500][0]
    c.plotValues.rows.find((r) => r[0] === t)[1] += 0.01
    const perturbed = sealCapture(c)
    const v = compareCapture(perturbed, declaring(ENTRY), OK)
    expect(v.verdict).toBe('DIVERGE')
    expect(v.plots[0].verdict).toBe('DIVERGE')
    expect(v.substituted.map((e) => e.name)).toEqual(['syminfo.industry'])
    // the control: the same perturbation with no substitution is the same DIVERGE
    expect(compareCapture(perturbed, OURS, OK).verdict).toBe('DIVERGE')
  })

  it('⛔ a substitution NOT fed the vendor value is INCONCLUSIVE, never a grade', () => {
    const cases = [
      [{ ...ENTRY, vendorValueFrom: undefined }, /was not fed the vendor's value/],
      [{ ...ENTRY, value: 'Semiconductors' }, /fed "Semiconductors", not the vendor's/],
      [{ ...ENTRY, vendorValueFrom: 'capture.symbol.sector' }, /not on this capture/],
      [{ name: 'syminfo.industry', source: 'uct:ticker_meta', vendorValueFrom: 'capture.symbol.industry' }, /does not say what our side was fed/],
      [{ ...ENTRY, source: '' }, /names no `source`/],
      [{ ...ENTRY, vendorValueFrom: 'uct:ticker_meta' }, /neither 'capture/],
    ]
    for (const [entry, why] of cases) {
      const v = compareCapture(CAPTURE, declaring(entry), OK)
      expect(v.verdict, JSON.stringify(entry)).toBe('INCONCLUSIVE')
      expect(v.reason).toMatch(why)
    }
    expect(compareCapture(CAPTURE, declaring(ENTRY, ENTRY), OK).reason).toMatch(/declared twice/)
    expect(compareCapture(CAPTURE, { ...OURS, substituted: 'syminfo.industry' }, OK).verdict).toBe('INCONCLUSIVE')
    // a seed series fed from a committed capture is accepted as our side's statement
    expect(substitutionProblems(CAPTURE, [{ name: 'request.seed:RSRATING', source: 'uct:rs_history',
      vendorValueFrom: 'committed:tests/fixtures/vendor/harness/x.json' }])).toEqual([])
  })

  it('the summary counts MATCH_SUBSTITUTED on its own, and leaves the MATCH total alone', () => {
    const table = renderSummary([
      { id: 'a', verdict: 'MATCH', plots: [] },
      { id: 'b', verdict: MATCH_SUBSTITUTED, plots: [] },
    ])
    expect(table).toContain('TOTAL 2 captures — MATCH 1 · DIVERGE 0 · INCONCLUSIVE 0 · MATCH_SUBSTITUTED 1')
    expect(renderSummary([{ id: 'a', verdict: 'MATCH', plots: [] }])).not.toContain('MATCH_SUBSTITUTED')
  })
})
