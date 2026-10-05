// app/src/components/chart/builder/memberPane/h9HostBudget.test.js
//
// ─── ⭐⭐ H9 — THE MEMBER DOOR: THREE CORPUS SCRIPTS THE INSTALL DOOR REFUSED ON A
// MIS-COUNT NOW INSTALL ON THE HOST LANE ─────────────────────────────────────────
//
// Pane flags OFF (the host lane alone), so nothing here depends on the runtime lane:
//   * pivot-high-low-points            — was `resolve:window` (`(5 + 5) + 1` read at registration)
//   * mtf-key-levels-support-and-resistance — was `budget:series` 10 > 8
//   * vwap-fibo-dev-extensions-strategy     — was `budget:series` 9 > 8
// and two that stay refused because the cost is real:
//   * rsi-vwap-indicator                — `budget:lookback` 976 > 960 (`rsi(vwapOf(close), 16)`)
//   * volume-spikes-growing-volume-signals-with-alerts-scanner — `budget:lookback`
//     1000 > 960 (`ta.median(volume, 1000)`, a literal 1000-bar window)
//
// pivot-high-low-points' value is compared to a HAND replay of the Pine source
// (no engine code): `iff(not na(high[mb]), iff(highestbars(mb) == -lb, high[lb], na), na)`.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'

const DEF_ID = 'u_member-pane-h9-host-budget'
const CORPUS = path.resolve(process.cwd(), '..', 'corpus', 'committed')
const corpus = (slug) => {
  const f = fs.readdirSync(CORPUS).find((x) => x.split('__')[0] === slug)
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}

afterEach(() => {
  registry.uninstallUserDefinition(DEF_ID)
  vi.unstubAllEnvs()
})

function door(slug) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const built = memberPaneDefinition({ source: corpus(slug), id: DEF_ID })
  expect(built.ok, `${slug}: ${built.reason}`).toBe(true)
  const res = registry.installUserDefinitions([built.definition])
  return { built, ...res }
}

// Distinct highs and lows (no ties: the replay need not state a tie rule).
const N = 200
const BARS = Array.from({ length: N }, (_, i) => {
  const base = 100 + 8 * Math.sin(i / 4) + 3 * Math.sin(i / 1.7)
  return { t: 1700000000 + i * 86400, o: base, h: base + 2 + ((i * 37) % 11) / 10 + i * 1e-6, l: base - 2 - ((i * 53) % 13) / 10 - i * 1e-6, c: base + 0.5, v: 1000 + i }
})

/** Pine's `highestbars(src, n)` on bar i: the NON-POSITIVE offset of the highest value of the last n bars. */
function pineBars(src, i, n, better) {
  if (i - n + 1 < 0) return NaN
  let best = i
  for (let j = i - 1; j >= i - n + 1; j--) if (better(src[j], src[best])) best = j
  return best - i
}

describe('⭐ H9 — host-lane budget mis-counts, at the member door (pane flags off)', () => {
  for (const slug of ['pivot-high-low-points', 'mtf-key-levels-support-and-resistance', 'vwap-fibo-dev-extensions-strategy']) {
    it(`${slug} installs on the host lane`, () => {
      const { built, installed, errors } = door(slug)
      expect(built.lane || 'host').toBe('host')
      expect(installed.length, errors.join(' | ')).toBe(1)
    })
  }

  it('pivot-high-low-points draws the hand replay of its Pine source, displaced by -lb', () => {
    const { built, installed } = door('pivot-high-low-points')
    expect(installed.length).toBe(1)
    const def = installed[0]
    const H = BARS.map((b) => b.h)
    const L = BARS.map((b) => b.l)
    const lb = 5
    const mb = 5 + 5 + 1
    const want = (src, better) => BARS.map((_, i) => {
      if (i - mb < 0) return NaN // na(high[mb])
      return pineBars(src, i, mb, better) === -lb ? src[i - lb] : NaN
    })
    const wantHi = want(H, (a, b) => a > b)
    const wantLo = want(L, (a, b) => a < b)
    // ⭐ THROUGH THE REGISTRY, so the bind stage folds `(5 + 5) + 1` as on a chart.
    const cols = registry.computeFor(def, BARS, undefined, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    const gotHi = Array.from(cols.value || [])
    const gotLo = Array.from(cols.out2 || [])
    for (const [got, exp, tag] of [[gotHi, wantHi, 'high'], [gotLo, wantLo, 'low']]) {
      expect(got.length).toBe(N)
      got.forEach((v, i) => {
        if (Number.isNaN(exp[i])) expect(Number.isFinite(v), `${tag} bar ${i}`).toBe(false)
        else expect(v, `${tag} bar ${i}`).toBeCloseTo(exp[i], 12)
      })
      expect(exp.filter(Number.isFinite).length, `${tag}: the replay marks some pivots`).toBeGreaterThan(3)
    }
    for (const p of built.definition.plots) expect(p.displace, p.key).toBe(-5)
  })

  it('⛔ rsi-vwap-indicator stays refused: `budget:lookback` 976 > 960 is a real lookback', () => {
    const { installed, errors } = door('rsi-vwap-indicator')
    expect(installed.length).toBe(0)
    expect(errors.join(' | ')).toMatch(/budget:lookback/)
    expect(errors.join(' | ')).toMatch(/measures 976 and the cap is 960/)
  })

  it('⛔ volume-spikes stays refused: a literal 1000-bar median is over the 960 cap', () => {
    const { installed, errors } = door('volume-spikes-growing-volume-signals-with-alerts-scanner')
    expect(installed.length).toBe(0)
    expect(errors.join(' | ')).toMatch(/measures 1000 and the cap is 960/)
  })
})
