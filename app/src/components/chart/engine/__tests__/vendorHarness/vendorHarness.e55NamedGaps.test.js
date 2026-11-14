// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.e55NamedGaps.test.js
//
// ─── ⭐⭐ ENGINE 55 — THE GRADED CAPTURES BEHIND THE THREE FIXES ───────────────────
//
//   1. `support-and-resistance-multi-time-frame` (RDDT + SPY): every weekly / monthly plot
//      MATCHES now (`tf_merge`); the newest finished bar is withheld by name and is the only
//      bar not compared. ⚰️ It read DIVERGE on 213 bars: `tf` showed each period one bar late.
//   2. McClellan (RDDT + SPY): the bare `ADVN` / `DECN` reads are refused by name at the door
//      (`pine:request`, `other-symbol:bare`) — INCONCLUSIVE. ⚰️ Its Osc plot drew an all-`na`
//      line and read DIVERGE.
//   3. K-clustering (RDDT + SPY): the table it partly draws is NAMED (`objects:not-computable`,
//      with a count), and the run half's reason is said in plain words — INCONCLUSIVE.
//      ⚰️ The table drew its header and silently left out the cells whose values were
//      unknown: DIVERGE. Making it exact (a bigger last-bar budget, nested
//      `__uct_runtime_at`) is NOT this engine's work.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'
import { gradeCapture, loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { runtimeUnknownSentence, partlyNotComputableSentence, RUNTIME_UNKNOWN_KEY } from '../../ast/objectLoss'
import { TF_MERGE_NEWEST_CODE } from '../../ast/interpret'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const grade = (f) => gradeCapture(loadCapture(path.join(H, f)).capture)

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

describe('1 — S&R multi time frame: every plot MATCHES, the newest finished bar withheld by name', () => {
  for (const f of ['support-and-resistance-multi-time-frame-rddt-1d-2026-10-02.json',
    'support-and-resistance-multi-time-frame-spy-1d-2026-10-02.json']) {
    it(f, () => {
      const { verdict } = grade(f)
      expect(verdict.verdict, verdict.reason).toBe('MATCH')
      const plots = verdict.plots || []
      expect(plots.length).toBe(6)
      for (const p of plots) expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
      const htf = plots.filter((p) => /Weekly|Monthly/.test(p.title))
      expect(htf.length).toBe(4)
      for (const p of htf) {
        expect(p.withheldNewest, p.title).toBe(TF_MERGE_NEWEST_CODE)
        expect(p.stats.oursUnread, p.title).toBe(1)        // the one bar not compared
        expect(p.stats.steady.compared, p.title).toBeGreaterThan(500)
      }
    }, 120000)
  }
})

describe('2 — McClellan: the bare breadth reads are refused by name, never an all-na line', () => {
  for (const f of ['mcclellan-indicators-rddt-1d-2026-09-28.json', 'mcclellan-indicators-spy-1d-2026-10-03.json']) {
    it(f, () => {
      const { verdict, ours } = grade(f)
      expect(verdict.verdict, verdict.reason).toBe('INCONCLUSIVE')
      const text = [ours.refusal || '', ...(ours.plots || []).map((p) => p.missingReason || '')].join(' | ')
      expect(text).toContain('pine:request')
      expect(text).toContain('other-symbol:bare — ')
      expect(text).toContain('this breadth symbol is not available yet')
      expect((verdict.plots || []).some((p) => p.verdict === 'DIVERGE')).toBe(false)
    }, 120000)
  }
})

describe('3 — K-clustering: the partly drawn table is NAMED, with the run half\'s reason', () => {
  for (const f of ['k-clustering-rddt-1d-2026-09-28.json', 'k-clustering-spy-1d-2026-10-03.json']) {
    it(`${f}: graded INCONCLUSIVE (withheld by name), never DIVERGE`, () => {
      const { verdict } = grade(f)
      expect(verdict.verdict, verdict.reason).toBe('INCONCLUSIVE')
      expect(verdict.objects.verdict).toBe('INCONCLUSIVE')
      expect(verdict.objects.reason).toMatch(/tables, tableCells are withheld by name \(objects:not-computable/)
    }, 120000)
  }

  it('the run names the table under objects:not-computable with the COUNT, and says why the run half is unknown', () => {
    const cap = loadCapture(path.join(H, 'k-clustering-rddt-1d-2026-09-28.json')).capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_e55kc', name: 'kc' })
    expect(d.ok).toBe(true)
    const reader = objectReaderFor(d.definition, bars, { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' },
      newestBarIsForming: false, historyFromListing: true })
    expect(reader.runtime).toEqual({ served: false, reason: 'runtime:INSTRUCTIONS_PER_BAR' })
    const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime,
      readUnknown: reader.readUnknown, readUnknownOther: reader.readUnknownOther, offListing: false,
      unknownBecause: runtimeUnknownSentence(reader.runtime) })
    expect(run.withheldBy['objects:not-computable']).toEqual(expect.arrayContaining(['line', 'linefill', 'table']))
    const n = run.stats.withheldUnknownPartial && run.stats.withheldUnknownPartial.table
    expect(Number.isInteger(n) && n > 0).toBe(true)
    expect(run.withheldWhy.table).toBe(partlyNotComputableSentence('table', n))
    expect(run.withheldWhy[RUNTIME_UNKNOWN_KEY]).toBe('This script’s last-bar calculation is too heavy to run yet.')
    // the table is still DRAWN (the header) — partly, and said so
    expect((run.live || []).some((o) => o.family === 'table')).toBe(true)
  }, 120000)

  it('without a run-half reason nothing extra is said (the key is absent)', () => {
    const cap = loadCapture(path.join(H, 'k-clustering-rddt-1d-2026-09-28.json')).capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_e55kc', name: 'kc' })
    const reader = objectReaderFor(d.definition, bars, { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' },
      newestBarIsForming: false, historyFromListing: true })
    const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime,
      readUnknown: reader.readUnknown, readUnknownOther: reader.readUnknownOther, offListing: false })
    expect(run.withheldWhy[RUNTIME_UNKNOWN_KEY]).toBeUndefined()
    expect(run.withheldBy['objects:not-computable']).toContain('table')
  }, 120000)

  it('runtimeUnknownSentence: plain words, null when served or absent', () => {
    expect(runtimeUnknownSentence({ served: false, reason: 'runtime:INSTRUCTIONS_PER_BAR' })).toBe('This script’s last-bar calculation is too heavy to run yet.')
    expect(runtimeUnknownSentence({ served: true, reason: null })).toBe(null)
    expect(runtimeUnknownSentence(null)).toBe(null)
  })
})
