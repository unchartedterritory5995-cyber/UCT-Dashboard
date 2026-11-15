// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.ozNotShown.test.js
//
// ─── ⭐⭐ OZ — A SILENT ZERO BECOMES A STATED REFUSAL ON TRADINGVIEW'S CAPTURES ──
//
// DIVERGE triage 2026-11-08, lane 5 (first step). These scripts ran with the object
// lane `ok`, no refusal, and drew nothing of a family TradingView draws dozens of:
// a confident DIVERGE that was really the engine dropping or withholding the steps.
// The run now names each such family (`objectRuntime.js` `notShown`), the member reads
// the sentence (`objectsNotShownNote.test.jsx`), and the harness grades the family as
// a gap with a name: INCONCLUSIVE where every other family agrees, never a MATCH.
// Control: a capture whose objects MATCH keeps its MATCH and names nothing.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { NOT_SHOWN } from '../../ast/objectLoss'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
beforeAll(() => { vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1') })
afterAll(() => { vi.unstubAllEnvs() })

const T = 120000
const graded = (id) => gradeCapture(loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture)
const row = (v, f) => (v.verdict.objects.counts || []).find((r) => r.family === f)

describe('⭐⭐ OZ — the family the run drew none of is withheld BY NAME, graded as a gap', () => {
  it.each([
    // [capture, family rows withheld, guard]
    ['volume-profile-rddt-1d-2026-09-28', ['lines'], NOT_SHOWN.NOT_CARRIED],
    ['atr-support-and-resistance-rddt-1d-2026-09-28', ['lines', 'boxes'], NOT_SHOWN.NOT_CARRIED],
    ['liquidity-heatmap-nephew-sam-rddt-1d-2026-09-28', ['labels'], NOT_SHOWN.NOT_CARRIED],
    ['poor-man039s-volume-profile-rddt-1d-2026-09-28', ['labels'], NOT_SHOWN.NOT_COMPUTABLE],
  ])('%s: INCONCLUSIVE, withheld by name', (id, rows, guard) => {
    const v = graded(id)
    expect(v.ours.objects.ok).toBe(true)
    expect(v.ours.objects.withheldGuards).toContain(guard)
    expect(v.ours.objects.withheldWhy).toMatch(/is shown on this chart: /)
    for (const f of rows) expect(row(v, f)).toMatchObject({ ours: null, withheld: true })
    expect(v.verdict.objects.verdict).toBe('INCONCLUSIVE')
    expect(v.verdict.objects.withheld).toContain(guard)
    expect(v.verdict.objects.reason).toContain(v.ours.objects.withheldWhy)
  }, T)

  it('⛔ a family still partly drawn is NOT withheld: HTF footprint keeps its 3 boxes and stays DIVERGE on them', () => {
    const v = graded('htf-candle-footprint-cartel-console-rddt-1d-2026-09-28')
    expect(v.ours.objects.withheldFamilies).toEqual(['label', 'line'])
    expect(row(v, 'boxes')).toMatchObject({ ours: 3, agree: false })
    expect(v.verdict.objects.verdict).toBe('DIVERGE')
  }, T)

  it('⛔ CONTROL — fib-retracement-rddt: objects MATCH, nothing named', () => {
    const v = graded('fib-retracement-rddt-1d-2026-10-02')
    expect(v.ours.objects.withheldGuards).toBeUndefined()
    expect(v.verdict.objects.verdict).toBe('MATCH')
  }, T)

  it('⛔ a MATCH stays a MATCH: ADR pivots names its lost labels (TradingView holds 0 here), every drawn family still agrees', () => {
    const v = graded('average-day-range-adr-pivots-rddt-1d-2026-09-28')
    expect(v.ours.objects.withheldFamilies).toEqual(['label'])
    expect(row(v, 'labels')).toMatchObject({ vendor: 0, ours: null, withheld: true })
    for (const f of ['lines', 'boxes', 'tables', 'tableCells']) expect(row(v, f).agree, f).toBe(true)
    expect(v.verdict.objects.verdict).toBe('MATCH')
  }, T)
})
