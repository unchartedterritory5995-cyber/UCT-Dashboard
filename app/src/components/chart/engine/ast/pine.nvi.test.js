// app/src/components/chart/engine/ast/pine.nvi.test.js
//
// ─── ⭐⭐ ITEM 8, NAME #1: `ta.nvi` — THE SEED IS 1 ──────────────────────────
//
// 25 sites across 2 scripts, the highest-demand name in `r11-remaining-nine.md`.
// It asked two questions and warned about one of them in particular:
//
//   "the SEED value (100? 1000?) … A wrong seed is a constant offset that looks
//    plausible forever."
//
// ⛔⛔ IT IS NEITHER. Read off the vendor at bar_index 0: **1**. NVI is a pure
// multiplicative index starting at unity, and both numbers in the wild were wrong.
//
// ⚠️ THE FIRST CAPTURE COULD NOT SEE IT AND SAID SO. The daily window began at
// bar_index 8061, so the earliest visible value was 2557.16 — accumulated, not a
// seed. The probe's `N02_bar_index_SEED_IS_AT_ZERO` channel is what caught that;
// the full history was then loaded through the chart's own `All` button.
//
// This file does not test the engine — `ta.nvi` is NOT pinned yet. It tests that
// the CAPTURE is internally consistent, so the reading cannot rot into a number
// nobody can re-derive.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { translatePine } from './pine.js'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..', '..')
const cap = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests', 'fixtures', 'vendor', 'r11-nvi-spy-2026-09-11.json'), 'utf8'))

describe('⭐⭐ the seed, and the rule that rides on it', () => {
  it('the seed is 1, at bar_index 0', () => {
    expect(cap.theSeed.value).toBe(1)
    expect(cap.theSeed.atBarIndex).toBe(0)
  })

  it('⛔⛔ THE ARITHMETIC RE-DERIVES, witness by witness', () => {
    // ⭐ THIS IS THE PROOF, NOT THE COUNTS. The counts say nvi moved on every
    // falling-volume bar; these say WHAT it moved to. If the rule in the fixture
    // is wrong, or a number was retyped, this fails — which is the difference
    // between a recorded reading and a re-derivable one.
    const w = cap.theAccumulationRule.arithmeticWitnesses
    expect(w.length).toBeGreaterThanOrEqual(6)
    expect(w[0].nvi).toBe(1)

    for (let i = 1; i < w.length; i++) {
      const prev = w[i - 1]
      const cur = w[i]
      const fell = cur.volume < cur.volumePrev
      expect(fell ? 1 : 0, `witness ${i}: the fixture's own fell flag`).toBe(cur.fell)

      const expected = fell
        ? prev.nvi * (1 + (cur.close - cur.closePrev) / cur.closePrev)
        : prev.nvi
      // the vendor's doubles, to the last significant figure
      expect(cur.nvi, `witness ${i} (bar ${cur.barIndex})`).toBeCloseTo(expected, 12)
    }
  })

  it('⭐ a DOWN close on falling volume pulls it BELOW 1 — the index is not floored', () => {
    const below = cap.theAccumulationRule.arithmeticWitnesses.find((x) => x.nvi < 1)
    expect(below, 'no witness drops below the seed, so "not floored" is untested').toBeTruthy()
    expect(below.fell).toBe(1)
    expect(below.close).toBeLessThan(below.closePrev)
  })

  it('⛔ the daily split is total — no exceptions in either direction', () => {
    const m = cap.theAccumulationRule.measuredOnDaily
    expect(m.volumeFELL.nviHeld).toBe(0)
    expect(m.volumeROSE.nviMoved).toBe(0)
    expect(m.volumeFELL.nviMoved).toBe(m.volumeFELL.n)
    expect(m.volumeROSE.nviHeld).toBe(m.volumeROSE.n)
    // and BOTH regimes were actually exercised, or the split proves nothing
    expect(m.volumeFELL.n).toBeGreaterThan(50)
    expect(m.volumeROSE.n).toBeGreaterThan(50)
  })

  it('⛔⛔ AND THE UNANSWERED CASE IS RECORDED AS UNANSWERED', () => {
    // The probe's unchanged-volume flag read 0 on all 400 bars, so the third
    // case was never exercised. A capture that quietly implied otherwise would
    // be the failure this project keeps naming.
    expect(cap._STILL_OPEN.unchangedVolume.occurrences).toBe(0)
    expect(cap._STILL_OPEN.unchangedVolume.status).toBe('UNANSWERED')
  })
})

describe('⛔ `ta.nvi` is NOT pinned yet, and the door still says so', () => {
  it('it refuses at pine:function', () => {
    const out = translatePine(
      '//@version=6\nindicator("p", overlay=false)\nplot(ta.nvi)\n', { strict: true })
    const r = out.refusals || []
    expect(r.length).toBe(1)
    expect(r[0].guard).toBe('pine:function')
    // ⭐ When it IS pinned, this flips and the seed above is what it must be
    // pinned TO — 1, not 100, not 1000.
  })
})
