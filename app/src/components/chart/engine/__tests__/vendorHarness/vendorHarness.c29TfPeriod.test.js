// ─── ⭐⭐ C29 (C15a) — v6 `timeframe.period` is `1D` / `1W` / `1M` ───────────────
//
// Read off the NEW captures `vw-tf-period-spy-{1d,1w,1m}-2026-09-30.json`
// (probe `tools/visual_conformance/probes/vw-tf-period.pine`): TradingView's
// label prints `[1D]`/`[1W]`/`[1M]`, `str.length` is 2, and `== "D"`/`"W"`/`"M"`
// are all false on a `//@version=6` chart. The one value the lanes read is
// `pine.js::periodTextOf`.
//
//   1D — the probe runs through the MEMBER DOOR on the capture's own bars and
//        every row, and the label, are the vendor's.
//   1W / 1M — the door translates ONCE, at the base period (`D`), so the period
//        reads it folded are the DAILY chart's. Bound on a weekly or monthly
//        chart the document is REFUSED BY NAME (`periodReads.js`) — never drawn
//        `[1D]` where TradingView draws `[1W]`. `periodTextOf` itself answers
//        the vendor's `1W`/`1M` (asserted against the captures' labels).
//
// ⚠️ A plot constant over the whole series is hidden at the member door by design
// (`hiddenReason: 'constant'`), so each constant row is read as `<expr> + close * 0`
// — Pine's identity on every captured bar (close is never na there).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide } from './ourSide'
import { periodTextOf, translatePine } from '../../ast/pine.js'
import { PERIOD_READS_GUARD } from '../../periodReads'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (n) => JSON.parse(fs.readFileSync(path.join(H, n), 'utf8'))

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

function vendorColumns(cap) {
  const titleOf = new Map(cap.study.plots.map((p) => [p.id, p.title]))
  const out = new Map()
  cap.plotValues.fields.forEach((f, i) => {
    if (f !== 'time') out.set(titleOf.get(f), cap.plotValues.rows.map((r) => r[i]))
  })
  return out
}
const asSeries = (src) => src.split('\n')
  .map((l) => l.replace(/^plot\((.*?),(\s*)("T\d+_[A-Za-z_]+")\)$/, (m, e, sp, t) => (
    t.startsWith('"T00') ? m : `plot((${e.trim()}) + close * 0,${sp}${t})`))).join('\n')
const withSeries = (cap) => ({ ...cap, source: { ...cap.source, text: asSeries(cap.source.text) } })

describe('C29 — 1D: the probe as TradingView drew it', () => {
  it('every row on all 300 bars, and the label [1D]', () => {
    const cap = load('vw-tf-period-spy-1d-2026-09-30.json')
    expect(cap.source.text).toMatch(/^\/\/@version=6/)
    expect(cap.objects.texts.labels).toEqual(['[1D]'])
    const ours = runOurSide(withSeries(cap))
    expect(ours.ok, ours.refusal).toBe(true)
    const vend = vendorColumns(cap)
    let compared = 0
    for (const p of ours.plots) {
      const v = vend.get(p.title)
      expect(v, p.title).toBeTruthy()
      if (p.title.startsWith('T00')) continue // the control: bar_index, not a period read
      expect(p.column, `${p.title}: ${p.missingReason}`).toBeTruthy()
      const col = Array.from(p.column)
      for (let i = 0; i < v.length; i++) { expect(col[i], `${p.title} bar ${i}`).toBe(v[i]); compared++ }
    }
    expect(compared).toBe(11 * 300)
    expect(ours.objects.texts.labels).toEqual(['[1D]'])
  })
})

describe('C29 — 1W / 1M: refused by name, never the daily chart\'s answer', () => {
  for (const [file, code, label] of [
    ['vw-tf-period-spy-1w-2026-09-30.json', 'W', '[1W]'],
    ['vw-tf-period-spy-1m-2026-09-30.json', 'M', '[1M]'],
  ]) {
    it(`${file}: no period row computes, no label is drawn; the spelling itself is the vendor's`, () => {
      const cap = load(file)
      expect(cap.objects.texts.labels).toEqual([label])
      expect(`[${periodTextOf(code, 6)}]`).toBe(label)
      const ours = runOurSide(withSeries(cap))
      expect(ours.ok, ours.refusal).toBe(true)
      const vend = vendorColumns(cap)
      let served = 0
      for (const p of ours.plots) {
        if (p.title.startsWith('T00')) continue
        const col = p.column ? Array.from(p.column) : []
        if (/^T0[1-7]_/.test(p.title)) {
          // the period's TEXT was folded at `D`: refused on this chart, never drawn
          expect(col.every((x) => !Number.isFinite(x)), `${p.title} computed on a ${code} chart`).toBe(true)
        } else {
          // `multiplier` (1 on D, W and M alike) and the clock flags: this chart's own, served
          const v = vend.get(p.title)
          for (let i = 0; i < v.length; i++) expect(col[i], `${p.title} bar ${i}`).toBe(v[i])
          served += 1
        }
      }
      expect(served).toBe(4)
      // the object lane draws nothing (never `[1D]`)
      expect(ours.objects.ok === false || (ours.objects.texts.labels || []).length === 0).toBe(true)
      expect(JSON.stringify(ours.objects)).not.toContain('[1D]')
    })
  }

  it('the refusal carries its guard and names the read', () => {
    const cap = load('vw-tf-period-spy-1w-2026-09-30.json')
    const t = translatePine(asSeries(cap.source.text), { strict: true })
    expect(t.periodReads.base).toBe('D')
    expect(t.periodReads.reads.map((r) => r.name)).toContain('timeframe.period')
    expect(PERIOD_READS_GUARD).toBe('bind:period-reads')
  })
})

describe('C29 — `periodTextOf`, the one spelling', () => {
  it('v6 daily/weekly/monthly carry the multiplier; intraday and older versions do not change', () => {
    expect(['D', 'W', 'M'].map((c) => periodTextOf(c, 6))).toEqual(['1D', '1W', '1M'])
    expect(periodTextOf('60', 6)).toBe('60')
    expect(periodTextOf('D', 5)).toBe('D')
    expect(periodTextOf('D', null)).toBe('D')
  })

  it('a request at the period is still the chart itself, and records NO folded period value', () => {
    const src = '//@version=6\nindicator("x")\nplot(request.security(syminfo.tickerid, timeframe.period, close))\n'
    const t = translatePine(src, { strict: true })
    expect(t.ok, t.refusal && t.refusal.message).toBe(true)
    expect(t.outputs[0].formula).toBe('close')
    expect(t.periodReads).toBeUndefined()
  })

  it('`timeframe.multiplier` alone is 1 on D, W and M, so a weekly chart still draws it', () => {
    const t = translatePine('//@version=6\nindicator("x")\nplot(close * timeframe.multiplier)\n', { strict: true })
    const { byTf, base } = t.periodReads
    expect(byTf.W).toEqual(byTf[base])
    expect(byTf['60']).not.toEqual(byTf[base])
  })
})
