// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h8ConstantRows.test.js
//
// ─── ⭐⭐ H8 (step 95) — CONSTANT ROWS TRADINGVIEW DRAWS, DRAWN AND GRADED ─────
//
// Before H8 each row below graded NOT DRAWN (F8): the member pane drew no series
// for a row the host translator hid as "reads no bar" (`hiddenReason:
// 'constant'`, a SCREENER rule). The pane now asks `pine.js::hiddenOnChart`, so
// each is drawn and graded on value AND colour, bar by bar. The control is the
// other direction: cc-yata's b1..b5 / s1..s5 fold to `na` and TradingView never
// draws them visibly, so they stay hidden (`vendorHarness.f8Ungraded.test.js`).

import { describe, it, expect, afterEach, vi } from 'vitest'
import path from 'node:path'
import { gradeCapture, loadCapture, HARNESS_DIR, withDoorState } from './harness'

afterEach(() => { vi.unstubAllEnvs() })

const T = 600000
const memo = new Map()
function grade(id, state) {
  const key = `${id}|${state}`
  if (!memo.has(key)) {
    const cap = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
    expect(cap, `${id} is a v1 capture`).toBeTruthy()
    memo.set(key, withDoorState(state, () => gradeCapture(cap)).verdict)
  }
  return memo.get(key)
}

const CASES = [
  ['w4-cross-round-spy-1d-2026-09-30', 'on', ['X06_round_2p5_HALF_UP_OR_EVEN', 'X07_round_3p5_THE_SAME_QUESTION',
    'X08_round_neg2p5_WHICH_WAY', 'X09_round_negHalf_IS_IT_MINUS_ZERO', 'X11_sign_of_zero', 'X12_mintick',
    'X13_pointvalue', 'X14_in_seconds_D', 'X15_tf_multiplier']],
  ['vw-gradient-spy-1d-2026-09-30', 'on', ['G14_g3_t_new30', 'G17_new_red_70p5_t', 'G18_new_red_70p5_r',
    'G19_new_0064C8_70p5_t', 'G20_new_0064C8_70p4_t', 'G21_cA_t_CONTROL']],
  ['rt1-na-test-v5-rddt-1d-2026-10-02', 'on', ['A05_na_bool_test']],
  ['rt3-na-logic-rddt-1d-2026-10-02', 'on', ['B01_naBool_or_true', 'B06_naLiteral_or_true', 'B07_not_naLiteral', 'B09_naFloat_or_true']],
  ['vw-bar-counters-rddt-60-2026-09-30', 'on', ['C05_ta_cum_1']],
  ['vw-deadband-ticks-aapl-1d-2026-09-28', 'runtime', ['D01_mintick']],
  ['fvg-trend-rddt-1d-2026-09-27', 'runtime', [null]],
]

describe('H8 — every constant row TradingView draws is drawn and MATCHES, colour compared', () => {
  it.each(CASES)('%s (%s)', (id, state, titles) => {
    const v = grade(id, state)
    for (const t of titles) {
      const p = t === null ? v.plots.find((x) => x.title === 'Plot' || x.title == null) : v.plots.find((x) => x.title === t)
      expect(p, `${id} ${t}`).toBeTruthy()
      expect(p.verdict, `${t}: ${p.reason}`).toBe('MATCH')
      expect(p.color, t).toBe('compared')
      expect(p.reason).not.toMatch(/NOT DRAWN/)
    }
    // ⛔ and nothing on the capture is NOT DRAWN any more
    expect(v.plots.filter((p) => /NOT DRAWN/.test(p.reason || '')).map((p) => p.title)).toEqual([])
  }, T)
})

describe('H8 — a drawn constant another wall withholds is named by THAT wall, never NOT DRAWN', () => {
  it('vw-tf-period SPY 1W: the period rows are withheld by `bind:period-reads`, by name', () => {
    const v = grade('vw-tf-period-spy-1w-2026-09-30', 'on')
    for (const t of ['T01_len_period', 'T02_eq_D', 'T07_eq_1M']) {
      const p = v.plots.find((x) => x.title === t)
      expect(p.verdict, t).toBe('INCONCLUSIVE')
      expect(p.reason, t).toMatch(/bind:period-reads/)
      expect(p.reason, t).not.toMatch(/NOT DRAWN|hiddenReason/)
    }
  }, T)
})
