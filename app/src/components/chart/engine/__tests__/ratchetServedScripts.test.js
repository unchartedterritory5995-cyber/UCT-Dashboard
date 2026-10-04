// app/src/components/chart/engine/__tests__/ratchetServedScripts.test.js
//
// ─── H1 — THE SCRIPTS A RATCHET BROUGHT TO THE DOOR ───────────────────────────
//
// A trailing stop whose reset test reads the stop (`close[1] > up1 ? max(up, up1) :
// up`) is a SWITCHED recurrence decided by the RANGE window
// (`interpret.js::RANGE_TOP`): a bar is published only where every earlier history
// gives one value. These scripts attach (or translate) for that reason:
//
//   corpus/committed  atr-trailing-stop-by-ceyhun · pivot-point-supertrend ·
//                     qqe-signals · supertrend-explorer · supertrend-strategy
//   pine_community    04-ut-bot-alerts · 05-chandelier-exit   (refused by R-F)
//   pine              10-supertrend                            (refused by R-F)
//
// Only `pivot-point-supertrend` has a TradingView capture
// (`vendorHarness.h1Ratchet.test.js`); every served value here is held to the one
// independent reading of Pine this engine has — the SAME tree from the listing
// (C12w), every state carried from bar 0. On every bar the curtain publishes it
// must equal the listing run, and it may publish no bar the listing run withholds.
// Two series: RDDT 1D (632 bars) for all, AGEN 1D (2,000) for the quick ones.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor } from '../nativeRegistry'
import { loadCapture } from './vendorHarness/harness'
import { toProductBars } from './vendorHarness/ourSide'

const REPO = path.resolve(process.cwd(), '..')
const AGEN = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/agen-1d-bars-2000-2026-09-13.json'), 'utf8')).bars
const RDDT = toProductBars(loadCapture(path.join(REPO, 'tests/fixtures/vendor/harness/artemis-oscillator-pro-rddt-1d-2026-09-28.json')).capture)
const COMMITTED = path.join(REPO, 'corpus/committed')
const committed = (slug) => path.join(COMMITTED, fs.readdirSync(COMMITTED).find((f) => f.startsWith(`${slug}__`)))
const SCRIPTS = [
  [committed('atr-trailing-stop-by-ceyhun'), true],
  [committed('pivot-point-supertrend'), false],
  [committed('qqe-signals'), false],
  [committed('supertrend-explorer'), false],
  [committed('supertrend-strategy'), false],
  [path.join(REPO, 'tests/fixtures/pine_community/04-ut-bot-alerts.pine'), true],
  [path.join(REPO, 'tests/fixtures/pine_community/05-chandelier-exit.pine'), true],
  [path.join(REPO, 'tests/fixtures/pine/10-supertrend.pine'), false],
]

afterEach(() => { vi.unstubAllEnvs() })

function compare(src, bars) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source: src, id: 'u_h1_ratchet', name: 'h1' })
  expect(d.ok, d.reason).toBe(true)
  // ⭐ F5 — `barIndexFromFirstBar`: these rails compare the RATCHET machinery behind
  // the curtain with the listing run; the seed warm-up (`interpret.js::seedWarmupMask`)
  // is a different rule with its own rails (`seedWarmup.test.js`), so it is stated
  // off here — bar 0 of these bars is the reference's bar 0.
  const ctx = { tf: 'D', newestBarIsForming: false, barIndexFromFirstBar: true }
  const curtain = computeFor(d.definition, bars, undefined, ctx)
  const listed = computeFor(d.definition, bars, undefined, { ...ctx, historyFromListing: true })
  let both = 0
  const wrong = []
  const extra = []
  for (const k of Object.keys(curtain)) {
    const a = curtain[k]
    const b = listed[k]
    if (!a || typeof a.length !== 'number') continue
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) continue
      if (!Number.isFinite(b[i])) { extra.push(`${k}@${i}`); continue }
      both += 1
      if (Math.abs(a[i] - b[i]) > 1e-9 * Math.max(1, Math.abs(a[i]))) wrong.push(`${k}@${i}: ${a[i]} vs ${b[i]}`)
    }
  }
  return { both, wrong, extra }
}

describe('H1 — a newly served ratchet publishes only Pine\'s value (the listing run is the reference)', () => {
  const cases = SCRIPTS.flatMap(([f, quick]) => [[path.basename(f), 'RDDT', f, RDDT], ...(quick ? [[path.basename(f), 'AGEN', f, AGEN]] : [])])
  it.each(cases)('⭐ %s over %s: every published bar equals the listing run, none published it withholds', (_n, _s, f, bars) => {
    const { both, wrong, extra } = compare(fs.readFileSync(f, 'utf8'), bars)
    expect(wrong).toEqual([])
    expect(extra).toEqual([])
    expect(both).toBeGreaterThan(0) // non-vacuity: the curtain serves something
  }, 120000)
})
