// app/src/components/chart/engine/__tests__/switchedServedScripts.test.js
//
// ─── C12s — THE CORPUS SCRIPTS A SWITCHED RECURRENCE BROUGHT TO THE DOOR ──────
//
// Two committed scripts attach at the member door for the first time because a
// counter / trailing value with a RESET arm is now a SWITCHED recurrence
// (`interpret.js::switchedVarSeed`):
//
//   btc-charlie-trader-xo-macro-trend-scanner   countBuy / countSell, cross-reset
//   keltner-center-of-gravity-channel           up / dn, reset through `naz ? … : na`
//
// Neither has a TradingView capture, so each served value is held to the one
// independent reading of Pine this engine has: the SAME tree run from the listing
// (C12w's listing pass — every `var` carried from bar 0 with its real seed, which
// is Pine's own value when bar 0 is the symbol's first bar). A switched value does
// not depend on where the series starts, so on every bar the curtain publishes it
// must equal the listing run's value, and the curtain may publish no bar the
// listing run withholds. Two series: AGEN 1D (2,000 bars) and RDDT 1D (632).
//
// ⛔ AND IT CAUGHT THE PROBE'S BLIND SPOT FIRST. Before the dependency mask
// (`switchedDependencyMask`) btc-charlie's Bear shape read a confident 0 on AGEN
// bar 24 where the listing run reads 1: `countSell > 0 and countSell < 2 and
// countBuy < 1` over two UNKNOWN counters is false under every single probe value.
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
const SRC = (f) => fs.readFileSync(path.join(REPO, 'corpus/committed', f), 'utf8')
const CHARLIE = 'btc-charlie-trader-xo-macro-trend-scanner__1f1c092d6a.pine'
const KELTNER = 'keltner-center-of-gravity-channel__e4a81d76f6.pine'

afterEach(() => { vi.unstubAllEnvs() })

function compare(src, bars) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source: src, id: 'u_c12s_served', name: 'c12s' })
  expect(d.ok, d.reason).toBe(true)
  const ctx = { tf: 'D', newestBarIsForming: false }
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

describe('C12s — a newly served script publishes only Pine\'s value (the listing run is the reference)', () => {
  it.each([
    [CHARLIE, 'AGEN', AGEN], [CHARLIE, 'RDDT', RDDT],
    [KELTNER, 'AGEN', AGEN], [KELTNER, 'RDDT', RDDT],
  ])('⭐ %s over %s: every published bar equals the listing run, and none is published it withholds', (f, _n, bars) => {
    const { both, wrong, extra } = compare(SRC(f), bars)
    expect(wrong).toEqual([])
    expect(extra).toEqual([])
    expect(both).toBeGreaterThan(1000) // non-vacuity
  })

  it('⭐ keltner with its supertrend mode ON — the switched `up` / `dn` path itself — still never disagrees', () => {
    // At the member door `jz` folds to its default (off), so `naz` is false and
    // `up` / `dn` are `na`. Flipped on, their reset arm is `na` under `naz` and
    // is never taken, so the curtain must withhold them — and it does.
    const on = SRC(KELTNER).replace(
      'jz = input.bool(title="toggle channel mode (off) supertrend mode (on)", defval=false',
      'jz = input.bool(title="toggle channel mode (off) supertrend mode (on)", defval=true')
    expect(on).not.toBe(SRC(KELTNER))
    for (const bars of [AGEN, RDDT]) {
      const { both, wrong, extra } = compare(on, bars)
      expect(wrong).toEqual([])
      expect(extra).toEqual([])
      expect(both).toBeGreaterThan(500)
    }
  })
})
