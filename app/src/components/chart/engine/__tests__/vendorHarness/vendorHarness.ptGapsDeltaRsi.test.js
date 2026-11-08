// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.ptGapsDeltaRsi.test.js
//
// ─── PT-GAPS r2 — delta-rsi's shape: the host-lane gap fixes never reach it ─────
//
// `delta-rsi-oscillator-strategy` is a Pine v4 script whose host translation refuses
// every row (`pine:tuple`: `[drsi, nrmse] = diff(…)`, a helper built from `for` loops),
// and whose RUNTIME pane MATCHES TradingView on RDDT from the listing (all four
// signals; `vendorHarness.coverageAudit`). PT-GAPS changed only the host plot lane's
// stamps (L3, L4, L6, G-c, G-h) and the info row (G-d). A landing run reported this
// capture refused with the host lane's sentence; it did not reproduce (r2, EVIDENCE).
// This rail holds both halves of the shape at once, so a host-lane change that leaks
// into the runtime pane goes red here by name:
//   1. the host translation is what it was: no `meta.blockRuns`, every row `pine:tuple`;
//   2. the runtime pane still draws it and still MATCHES on the captured signals.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { translatePine } from '../../ast/pine'

afterEach(() => { vi.unstubAllEnvs() })

const REPO = path.resolve(process.cwd(), '..')
const SRC = fs.readFileSync(path.join(REPO, 'corpus/committed/delta-rsi-oscillator-strategy__z4Yj46FVTX.pine'), 'utf8')
const CAPTURE = 'delta-rsi-oscillator-strategy-rddt-1d-2026-10-02'
const T = 600000

describe('PT-GAPS r2 — delta-rsi (v4, runtime-only) is untouched by the host-lane gap fixes', () => {
  it('the host translation: no block-run stamps, every row refused `pine:tuple`', () => {
    const t = translatePine(SRC, { strict: true, paramManifest: true })
    expect(t.blockRuns).toBeUndefined()
    expect(t.outputs.length).toBe(8)
    for (const o of t.outputs) {
      expect(o.refusal && o.refusal.guard).toBe('pine:tuple')
      expect(o.refusal.message).toMatch(/`for` \(reached through `diff`\)/)
    }
  })

  it('the runtime pane draws it and MATCHES TradingView on Buy / Sell / Exit Long / Exit Short', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const cap = loadCapture(path.join(HARNESS_DIR, `${CAPTURE}.json`)).capture
    const v = gradeCapture(cap).verdict
    expect(v.reason).not.toMatch(/member door refused/)
    expect(v.verdict).toBe('MATCH')
    for (const title of ['Buy', 'Sell', 'Exit Long', 'Exit Short']) {
      const hits = v.plots.filter((p) => p.title === title)
      expect(hits.length, title).toBe(1)
      expect(hits[0].verdict, title).toBe('MATCH')
    }
    // 🔴 CONTROL — with the runtime pane off the same capture is refused by the host
    // lane's own sentence: the MATCH above is the runtime pane's, not a vacuous pass
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const off = gradeCapture(cap).verdict
    expect(off.verdict).toBe('INCONCLUSIVE')
    expect(off.reason).toMatch(/member door refused \(pine:tuple\)/)
  }, T)
})
