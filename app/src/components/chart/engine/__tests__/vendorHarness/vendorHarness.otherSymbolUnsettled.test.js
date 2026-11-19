// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.otherSymbolUnsettled.test.js
//
// OTHER-SYMBOL UNSETTLED (coordinator ruling on #1541, 2026-11-17): when committed TradingView evidence
// disagrees with ITSELF about another symbol's value on a bar, that bar is UNSETTLED, not a divergence.
// Measured: rs-rating-fred6724-pm-alab-1d-2026-11-16 (captured 22:53:14Z) read SP:SPX = 7416.59 on its newest
// bar, 2026-11-16 (our side reproduces its RS value exactly when it reads that), while the committed witnesses
// rs-spx-daily-pm-rddt-1d-2026-11-16 (22:52:03Z) and rs-spx-daily-pm-alab-1d-2026-11-16 (22:55:39Z) read
// 7561.67 there. That bar grades INCONCLUSIVE by name; the RS line's verdict follows from the other 667 bars.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture, REPO } from './harness'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { unsettledRecord, MATCH_SUBSTITUTED } from '../../../../../../../tools/vendor_harness/compare.mjs'

vi.setConfig({ testTimeout: 600000 })

const load = (id) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', `${id}.json`), 'utf8'))
const PM_ALAB = 'rs-rating-fred6724-pm-alab-1d-2026-11-16'
const rsLineOf = (verdict) => verdict.plots.find((p) => p.title === 'RS Line')
const CAP = { id: 'c', capturedAtUTC: 't0' }

describe('the record (pure)', () => {
  it('a committed witness reading another value on that date unsettles the bar, naming every read', () => {
    const r = unsettledRecord({ symbol: 'SPX', date: '2026-11-16', implied: 7416.59, capture: CAP,
      witnesses: [{ id: 'w1', capturedAtUTC: 't1', value: 7561.67 }] })
    expect(r).toEqual({ symbol: 'SPX', date: '2026-11-16', readBy: [
      { id: 'c', capturedAtUTC: 't0', value: 7416.59 }, { id: 'w1', capturedAtUTC: 't1', value: 7561.67 }] })
  })
  it('CONTROL: every witness agreeing with the capture settles nothing', () => {
    expect(unsettledRecord({ symbol: 'SPX', date: 'd', implied: 1, capture: CAP,
      witnesses: [{ id: 'w1', value: 1 }, { id: 'w2', value: 1 }] })).toBe(null)
  })
  it('CONTROL: a single source, with no other witness of that date, never unsettles a bar', () => {
    expect(unsettledRecord({ symbol: 'SPX', date: 'd', implied: 1, capture: CAP, witnesses: [] })).toBe(null)
  })
})

describe('RS Rating ALAB, after the close of 2026-11-16 (real capture, supply and witnesses)', () => {
  it('the newest bar is INCONCLUSIVE by name and the RS line grades from the other bars', () => {
    const p = rsLineOf(gradeCapture(load(PM_ALAB)).verdict)
    expect([MATCH_SUBSTITUTED, 'MATCH'], p.reason).toContain(p.verdict)
    expect(p.otherSymbolUnsettled).toHaveLength(1)
    const u = p.otherSymbolUnsettled[0]
    expect(u.verdict).toBe('INCONCLUSIVE')
    expect(u.symbol).toBe('SPX')
    expect(u.date).toBe('2026-11-16')
    expect(u.readBy[0]).toEqual({ id: PM_ALAB, capturedAtUTC: '2026-11-16T22:53:14.524Z', value: 7416.59 })
    expect(u.readBy.slice(1).map((w) => [w.id, w.value])).toEqual(expect.arrayContaining([
      ['rs-spx-daily-pm-alab-1d-2026-11-16', 7561.67], ['rs-spx-daily-pm-rddt-1d-2026-11-16', 7561.67]]))
    expect(p.stats.unsettledBars).toBe(1)
  })

  it('CONTROL: a newest-bar difference no other-symbol read explains stays DIVERGE', () => {
    const cap = load(PM_ALAB)
    const id = cap.study.plots.find((x) => x.title === 'RS Line').id
    const col = cap.plotValues.fields.indexOf(id)
    const last = cap.plotValues.rows[cap.plotValues.rows.length - 1]
    last[col] = last[col] * 1.005                        // neither 7416.59 nor 7592.4 reproduces this
    const p = rsLineOf(gradeCapture(sealCapture(cap)).verdict)
    expect(p.verdict).toBe('DIVERGE')
    expect(p.otherSymbolUnsettled).toBeUndefined()
  })
})
