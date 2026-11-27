// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.boundedWindow.test.js
//
// ⭐⭐ e98 — `VENDOR_HARNESS_WINDOW=<n>`: grade only a capture's NEWEST n bars. Our engine still runs from bar 0 (every
// value keeps its whole history); only the grading is bounded. The verdict is LABELLED "bounded-window (newest n)"
// (`boundedWindow`), and the snapshot writers refuse such a run, so it is never stored as the full-history verdict.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { harnessWindowOf, BOUNDED_WINDOW_LABEL, gradeCapture, loadCapture, REPO } from './harness'
import { compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'

afterEach(() => vi.unstubAllEnvs())

const T = [1, 2, 3, 4, 5]
/** One untitled line plot over five bars; ours agrees except where `wrongAt` says. */
const capture = () => ({
  symbol: { pricescale: 100 },
  history: { startsAtBar0: true },
  bars: { rows: T.map((t) => [t, 1, 1, 1, 1, 1]) },
  plotValues: { rows: T.map((t, i) => [t, 10 + i]) },
  study: { plots: [{ id: 'plot_0', type: 'line', title: null }], styles: {}, styleState: {} },
})
const ours = (wrongAt) => ({ ok: true, plots: [{ title: null, kind: 'plot', key: 'value', lookback: 0,
  column: T.map((_, i) => (i === wrongAt ? 99 : 10 + i)) }] })

describe('e98 — the bounded window', () => {
  it('reads the variable strictly: unset is the full history, anything but a positive whole number throws', () => {
    expect(harnessWindowOf({})).toBe(null)
    vi.stubEnv('VENDOR_HARNESS_WINDOW', '1500')
    expect(harnessWindowOf({})).toBe(1500)
    expect(harnessWindowOf({ window: 7 })).toBe(7)
    for (const bad of ['abc', '0', '-3', '1.5']) expect(() => harnessWindowOf({ window: bad }), bad).toThrow(/positive whole number/)
  })

  it('a bar outside the newest n is not graded; one inside still is (our values are computed from bar 0 either way)', () => {
    expect(compareCapture(capture(), ours(0)).plots[0].verdict).toBe('DIVERGE')
    const windowed = compareCapture(capture(), ours(0), { window: 2 }).plots[0]
    expect(windowed.verdict).toBe('MATCH')
    expect(windowed.warmupSource).toBe('bounded window: only the newest 2 bars are graded')
    expect(windowed.stats.steady.compared).toBe(2)
    // CONTROL: a wrong value inside the window still DIVERGEs
    expect(compareCapture(capture(), ours(4), { window: 2 }).plots[0].verdict).toBe('DIVERGE')
  })

  it('the verdict is LABELLED bounded-window (newest n), never the full-history verdict', () => {
    const { capture: cap } = loadCapture(path.join(REPO, 'tests/fixtures/vendor/seed-warmup-spy-12m-2026-09-21.json'))
    const full = gradeCapture(cap).verdict
    expect(full.boundedWindow).toBeUndefined()
    const bounded = gradeCapture(cap, { window: 3 }).verdict
    expect(bounded.boundedWindow).toEqual({ newest: 3 })
    expect(bounded.reason.startsWith(`${BOUNDED_WINDOW_LABEL(3)}: `)).toBe(true)
  }, 120000)

  it('⛔ a bounded-window run is refused by the snapshot splicers', () => {
    const snap = path.join(REPO, 'docs/pine/vendor-harness/production/verdicts.json')
    const sub = JSON.parse(fs.readFileSync(snap, 'utf8'))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e98-window-'))
    const subset = path.join(dir, 'subset.json')
    fs.writeFileSync(subset, JSON.stringify({ ...sub, boundedWindow: { newest: 1500 }, results: sub.results.slice(0, 1) }))
    for (const tool of ['splice_rows.mjs', 'splice_held.mjs']) {
      const args = tool === 'splice_held.mjs' ? [snap, subset, sub.results[0].file] : ['--check', snap, subset]
      const rr = spawnSync(process.execPath, [path.join(REPO, 'tools/vendor_harness', tool), ...args], { encoding: 'utf8' })
      expect(rr.status, tool).not.toBe(0)
      expect(rr.stderr, tool).toMatch(/bounded-window grade/)
    }
  }, 60000)

  it('⛔ no committed snapshot holds a bounded-window verdict', () => {
    for (const lane of ['production', 'runtime-on']) {
      const doc = JSON.parse(fs.readFileSync(path.join(REPO, `docs/pine/vendor-harness/${lane}/verdicts.json`), 'utf8'))
      expect(doc.boundedWindow, lane).toBeUndefined()
      expect(doc.results.filter((r) => r && r.boundedWindow).length, lane).toBe(0)
    }
  })
})
