// ─── ⭐⭐ C38 — `x[e]` WITH A PER-BAR `e`, IN A PLOT, THROUGH THE MEMBER DOOR ────
//
// C29 measured the rule (its rule 7) and served it in the object lane and the VM;
// a PLOT of the same read refused `pine:offset-literal`, so the two probes that
// witness the rule were INCONCLUSIVE at the door and proved only by C29's own
// rail. They are graded here by the harness itself — `gradeCapture`, the real
// member door, the real comparator — on the probe's source UNEDITED:
//
//   vw-offset-na-spy-1d-2026-09-30   `close[e]`, `e` na on a third of the bars
//                                    (`max_bars_back = 500`)
//   vw-mbb-auto-spy-1d-2026-09-30    `close[bar_index % 400]`, no `max_bars_back`:
//                                    offsets to 399
//
// ⚠️ WHAT "AT THE DOOR" NEEDS. Both probes key their rows on `bar_index`, which
// TradingView counts from SPY's first bar (8175 on the window's first bar) and
// the door, handed the capture's 300 bars, counts from 0; and `vw-mbb-auto`
// reads up to 399 bars back, past the window. So each is graded twice:
//   · AS CAPTURED (300 bars) — what the committed-directory sweep sees: every
//     row that does not read `bar_index` or a bar before the window MATCHES;
//   · ON TRADINGVIEW'S WHOLE HISTORY (`c38Joined.js`: the 8,175 earlier bars are
//     committed in another capture and the join proves itself against the
//     vendor's own `bar_index`) — every row, every bar, no warm-up excuse.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { gradeCapture } from './harness'
import { parent, joinedFromListing, vendorColumn, SPY_FROM_LISTING } from './c38Joined'
import { AUTO_MAX_BARS_BACK } from '../../ast/objectProgram'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const OFFSET_NA = 'vw-offset-na-spy-1d-2026-09-30'
const MBB_AUTO = 'vw-mbb-auto-spy-1d-2026-09-30'
const notMatch = (v) => (v.plots || []).filter((p) => p.verdict !== 'MATCH').map((p) => `${p.title}: ${p.verdict}`)
const plotOf = (v, title) => v.plots.find((p) => p.title === title)
const formulaOf = (ours, title) => ours.plots.find((p) => p.title === title).formula

describe('C38 — the two probes, as captured (300 bars)', () => {
  it('vw-offset-na: no longer refused; every row but the `bar_index` control MATCHES', () => {
    const { verdict, ours } = gradeCapture(parent(OFFSET_NA))
    expect(ours.ok, ours.refusal).toBe(true)
    // the ONE row that does not match prints `bar_index` itself: the vendor's 8175
    // against this 300-bar window's 0. Not a history read — the window's own index.
    expect(notMatch(verdict)).toEqual(['E00_bar_index_CONTROL: DIVERGE'])
    expect(plotOf(verdict, 'E00_bar_index_CONTROL').stats.firstDivergence)
      .toMatchObject({ bar: 0, kind: 'value', vendor: vendorColumn(parent(OFFSET_NA), 'E00_bar_index_CONTROL')[0], ours: 0 })
    for (const t of ['E02_close_at_e', 'E03_close_at_e_is_na', 'E05_close_at_e_eq_close']) {
      const p = plotOf(verdict, t)
      expect(p.stats.valueMismatches + p.stats.naMismatches, t).toBe(0)
      expect(p.stats.steady.compared, t).toBeGreaterThanOrEqual(298)
    }
  })

  it('…and the read asks for the two bars its index can take, not the script\'s 500', () => {
    const { ours } = gradeCapture(parent(OFFSET_NA))
    // `e` is `na` or 1 — `maxHistoryBack` bounds it at 1, so the buffer written is 2
    // (the declared `max_bars_back = 500` is the ceiling, never the floor)
    expect(formulaOf(ours, 'E02_close_at_e')).toBe('barsAgo(close, mod(barindex, 3) == 0 ? 0 / 0 : 1, 2)')
    expect(ours.plots.find((p) => p.title === 'E02_close_at_e').lookback).toBe(2)
  })

  it('vw-mbb-auto: no longer refused; the buffer written is the measured automatic one', () => {
    const cap = parent(MBB_AUTO)
    // the probe declares no buffer (its COMMENTS name the setting; its code does not)
    const code = cap.source.text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/max_bars_back/)
    const { verdict, ours } = gradeCapture(cap)
    expect(ours.ok, ours.refusal).toBe(true)
    // ⛔ DERIVED FROM THE ONE CONSTANT, never a typed 400
    expect(formulaOf(ours, 'M02_close_at_k')).toBe(`barsAgo(close, mod(barindex, ${AUTO_MAX_BARS_BACK}), ${AUTO_MAX_BARS_BACK})`)
    // on 300 bars every bar is inside the 400-bar reach, so the comparator cannot
    // judge the two history rows; the two index rows diverge on `bar_index`
    expect(notMatch(verdict)).toEqual([
      'M00_bar_index_CONTROL: DIVERGE', 'M01_k: DIVERGE',
      'M02_close_at_k: INCONCLUSIVE', 'M03_close_at_k_is_na: INCONCLUSIVE',
    ])
    expect(plotOf(verdict, 'M02_close_at_k').warmupBars).toBe(AUTO_MAX_BARS_BACK)
  })
})

describe('C38 — the two probes on TradingView\'s whole history: MATCH, every row, every bar', () => {
  it('the join is the series TradingView ran: the window starts at the vendor\'s own bar_index', () => {
    const hist = parent(SPY_FROM_LISTING)
    expect(hist.history.startsAtBar0).toBe(true)
    for (const [id, control] of [[OFFSET_NA, 'E00_bar_index_CONTROL'], [MBB_AUTO, 'M00_bar_index_CONTROL']]) {
      const cap = parent(id)
      const joined = joinedFromListing(cap, { control })
      const b0 = vendorColumn(cap, control)[0]
      expect(b0).toBeGreaterThan(8000)
      expect(joined.bars.rows.length).toBe(b0 + cap.bars.rows.length)
      expect(joined.bars.rows[b0][0]).toBe(cap.bars.rows[0][0])
      expect(joined.source.text).toBe(cap.source.text)          // the probe's source, unedited
    }
  })

  it('vw-offset-na: MATCH — `close[na]` is the bar\'s own close on all 100 na bars', () => {
    const cap = parent(OFFSET_NA)
    const { verdict, integrity } = gradeCapture(joinedFromListing(cap, { control: 'E00_bar_index_CONTROL' }))
    expect(integrity.ok, (integrity.errors || []).join('; ')).toBe(true)
    expect(notMatch(verdict)).toEqual([])
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    expect(verdict.plots.length).toBe(6)
    for (const p of verdict.plots) {
      expect(p.warmupBars, p.title).toBe(0)                     // from the listing: no warm-up excuse
      expect(p.stats.steady.compared, p.title).toBe(300)
      expect(p.stats.matching, p.title).toBe(300)
    }
    // ⛔ NON-VACUITY, read off the capture: 100 na-offset bars, and on the other
    // 200 the read is a DIFFERENT bar's close than the bar's own on most of them
    const isNa = vendorColumn(cap, 'E01_e_is_na')
    const same = vendorColumn(cap, 'E05_close_at_e_eq_close')
    expect(isNa.filter((x) => x === 1).length).toBe(100)
    expect(isNa.every((x, i) => x !== 1 || same[i] === 1)).toBe(true)
    expect(same.filter((x) => x === 0).length).toBeGreaterThan(190)
  })

  it('vw-mbb-auto: MATCH — offsets 0..399 with no `max_bars_back`, each the vendor\'s own bar', () => {
    const cap = parent(MBB_AUTO)
    const { verdict, ours, integrity } = gradeCapture(joinedFromListing(cap, { control: 'M00_bar_index_CONTROL' }))
    expect(integrity.ok, (integrity.errors || []).join('; ')).toBe(true)
    expect(notMatch(verdict)).toEqual([])
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    expect(verdict.plots.length).toBe(4)
    for (const p of verdict.plots) {
      expect(p.stats.steady.compared, p.title).toBe(300)
      expect(p.stats.matching, p.title).toBe(300)
    }
    // ⛔ NON-VACUITY: the offsets really reach the bound's last served value, and
    // 225 of the 300 reads land on bars BEFORE the probe's own window
    const k = vendorColumn(cap, 'M01_k')
    expect(Math.max(...k)).toBe(AUTO_MAX_BARS_BACK - 1)
    expect(k.filter((x, i) => x > i).length).toBe(225)
    // …and what our column holds there is a bar the probe's own window never had:
    // `bar_index - bar_index % 400` is bar 8000 for the first 225 bars (175 bars
    // BEFORE the window opens at 8175), then bar 8400
    const joined = joinedFromListing(cap, { control: 'M00_bar_index_CONTROL' })
    const b0 = vendorColumn(cap, 'M00_bar_index_CONTROL')[0]
    const anchor = b0 - (b0 % AUTO_MAX_BARS_BACK)
    expect(anchor).toBeLessThan(b0)
    const col = Array.from(ours.plots.find((p) => p.title === 'M02_close_at_k').column).slice(-300)
    expect(col.slice(0, 225).every((v) => v === joined.bars.rows[anchor][4])).toBe(true)
    expect(col.slice(225).every((v) => v === joined.bars.rows[anchor + AUTO_MAX_BARS_BACK][4])).toBe(true)
    expect(col[0]).not.toBe(col[299])
    expect(col[0]).not.toBe(cap.bars.rows[0][4])
  })

  it('CONTROL — the grade can fail: one vendor value moved is one DIVERGE, at that bar', () => {
    const cap = parent(MBB_AUTO)
    const moved = joinedFromListing(cap, {
      control: 'M00_bar_index_CONTROL',
      id: 'control',
      mutateVendor: (fields, rows) => {
        const at = fields.indexOf(cap.study.plots.find((p) => p.title === 'M02_close_at_k').id)
        rows[10][at] += 1
      },
    })
    const { verdict } = gradeCapture(moved)
    expect(notMatch(verdict)).toEqual(['M02_close_at_k: DIVERGE'])
    expect(plotOf(verdict, 'M02_close_at_k').stats.valueMismatches).toBe(1)
    expect(plotOf(verdict, 'M02_close_at_k').stats.firstDivergence).toMatchObject({ kind: 'value', time: cap.bars.rows[10][0] })
  })
})
