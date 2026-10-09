import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import OptionsHistoryPanel, { pastEarnings } from './OptionsHistoryPanel'

// Shapes from api/services/options_analytics/log_history.py (tests/test_options_log_history.py).
const STRADDLE = { label: 'computed from vendor quotes', method: 'S.', n: 2, logging_began: '2026-09-30', missing_sessions: [],
  points: [{ date: '2026-09-30', straddle: 4, straddle_pct: 4, underlying_price: 100, front_expiration: '2026-10-02', front_dte: 2 },
    { date: '2026-10-01', straddle: 4, straddle_pct: 5, underlying_price: 80, front_expiration: '2026-10-02', front_dte: 1 }] }
const DAILY = { label: 'computed', method: 'D.', n: 2, logging_began: '2026-09-30', missing_sessions: [], summary: null,
  summary_note: '2 pairs so far; how often the move stayed inside the implied move needs 20 (first possible 2026-10-28).',
  pairs: [{ date: '2026-09-30', next: '2026-10-01', implied_move_pct: 2, actual_move_pct: 1, ratio: 0.5, inside: true }] }
const CRUSH = { label: 'computed', method: 'C.', offsets: [-1, 0, 1], complete_prints: 0, summary: null,
  summary_note: '0 prints with all 11 sessions logged; average/max/min rows need 4. Logging began 2026-09-30; prints before it cannot be read.',
  prints: [{ report_date: '2026-10-08', iv: { '-1': 0.5, 0: 0.6, 1: null }, crush_pct: null }] }

function stub(map) {
  vi.stubGlobal('fetch', vi.fn((u) => {
    const hit = Object.entries(map).find(([k]) => u.includes(k))
    const [status, body] = hit ? hit[1] : [404, {}]
    return Promise.resolve({ status, ok: status === 200, json: () => Promise.resolve(body) })
  }))
}
const mount = () => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><OptionsHistoryPanel sym="tst" /></SWRConfig>)

describe('OptionsHistoryPanel (FT-007/009/010)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('all switches off: nothing', async () => {
    stub({})
    mount()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('options-history').children.length).toBe(0)
  })

  it('standalone with one read switched off and the rest paid-gated says so, not a blank panel (wave 3)', async () => {
    stub({ '/straddle': [402, {}], '/daily-move': [402, {}] })   // iv-crush answers 404
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><OptionsHistoryPanel sym="tst" offNotice /></SWRConfig>)
    expect((await screen.findByTestId('feature-paywalled')).textContent).toBe('Options history requires a paid plan.')
    expect(screen.queryByTestId('feature-off')).toBeNull()
  })

  it('shows the straddle in dollars and percent, with n and when the log began', async () => {
    stub({ '/straddle': [200, STRADDLE] })
    mount()
    const s = await screen.findByTestId('straddle-history')
    expect(s.textContent).toContain('2026-10-01: $4.00 = 5.00% of 80.00')
    expect(s.textContent).toContain('Our options log began 2026-09-30 · n = 2')
  })

  it('the daily-move summary below 20 pairs is the server sentence, not a percentage', async () => {
    stub({ '/daily-move': [200, DAILY] })
    mount()
    const sum = await screen.findByTestId('daily-move-summary')
    expect(sum.textContent).toBe(DAILY.summary_note)
    expect(sum.textContent).not.toMatch(/inside the implied move \d+%/)
  })

  // Audit 2026-10-08 (OHIS, point 27): inside / outside the implied move is said in words, not
  // told by the colour of the number alone.
  it('each daily-move row says inside or outside in words', async () => {
    stub({ '/daily-move': [200, { ...DAILY, pairs: [
      ...DAILY.pairs,
      { date: '2026-10-01', next: '2026-10-02', implied_move_pct: 2, actual_move_pct: -3, ratio: 1.5, inside: false },
    ] }] })
    mount()
    const d = await screen.findByTestId('daily-move')
    const rows = d.querySelectorAll('li')
    expect(rows[0].textContent).toContain('actual -3.00% outside the implied move')
    expect(rows[1].textContent).toContain('actual +1.00% inside the implied move')
  })

  it('the IV-crush summary rows are labelled in words and the offsets are explained', async () => {
    const summary = { average: { '-1': 0.5, 0: 0.6, 1: 0.4 }, max: { '-1': 0.6, 0: 0.7, 1: 0.5 }, min: { '-1': 0.4, 0: 0.5, 1: 0.3 } }
    stub({ '/iv-crush': [200, { ...CRUSH, summary }] })
    mount()
    const t = await screen.findByTestId('iv-crush')
    const heads = [...t.querySelectorAll('tbody th[scope="row"]')].map((th) => th.textContent)
    expect(heads.slice(-3)).toEqual(['Average', 'Max', 'Min'])
    expect(screen.getByTestId('iv-crush-key').textContent).toMatch(/0 is the last session that closed before the print/)
  })

  it('the IV-crush table leaves an unlogged session blank and states why no average exists', async () => {
    stub({ '/iv-crush': [200, CRUSH] })
    mount()
    const t = await screen.findByTestId('iv-crush')
    const cells = t.querySelectorAll('tbody td')
    expect([cells[0].textContent, cells[1].textContent, cells[2].textContent]).toEqual(['50.0%', '60.0%', ''])
    expect(screen.getByTestId('iv-crush-note').textContent).toContain('need 4')
  })

  // Spec #8 remainder (wave 5): past earnings dates are marked on the straddle timeline and the
  // daily-move rows, from the IV-crush read the panel already makes (no extra request).
  it('marks past earnings reports on the straddle chart, its rows and the daily-move rows', async () => {
    const pts = [...STRADDLE.points, { date: '2026-10-02', straddle: 3, straddle_pct: 3, underlying_price: 100, front_expiration: '2026-10-09', front_dte: 5 }]
    stub({
      '/straddle': [200, { ...STRADDLE, points: pts, n: 3 }],
      '/daily-move': [200, { ...DAILY, pairs: [...DAILY.pairs, { date: '2026-10-01', next: '2026-10-02', implied_move_pct: 2, actual_move_pct: -3, ratio: 1.5, inside: false }] }],
      '/iv-crush': [200, { ...CRUSH, prints: [
        { report_date: '2026-10-01', timing: 'post-market', iv: {}, crush_pct: null },
        { report_date: '2026-07-01', timing: 'pre-market', iv: {}, crush_pct: null },   // before the log
      ] }],
    })
    mount()
    const s = await screen.findByTestId('straddle-history')
    await waitFor(() => expect(s.querySelectorAll('[data-testid="earnings-marker"]').length).toBe(1))
    expect(s.querySelector('[data-testid="earnings-marker"] title').textContent).toBe('Earnings report 2026-10-01 (after the close)')
    expect(screen.getByTestId('earnings-markers-key').textContent).toContain('Dashed line marks the earnings report: 2026-10-01 (after the close).')
    expect(screen.getAllByTestId('earnings-row').map((b) => b.textContent)).toEqual([' · earnings report (after the close)'])
    // the after-close print on 10-01 lands in the 10-01 → 10-02 move, not the 09-30 → 10-01 one
    const rows = screen.getByTestId('daily-move').querySelectorAll('li')
    expect(rows[0].textContent).toContain('earnings report 2026-10-01 (after the close) in this move')
    expect(rows[1].textContent).not.toContain('earnings')
  })

  it('pastEarnings keeps only reports inside the shown range, deduped and oldest first', () => {
    const crush = { prints: [{ report_date: '2026-10-05', timing: 'unknown' }, { report_date: '2026-10-01', timing: 'pre-market' },
      { report_date: '2026-10-05' }, { report_date: '2026-11-01' }, { report_date: null }] }
    expect(pastEarnings(crush, '2026-09-30', '2026-10-08')).toEqual([{ date: '2026-10-01', when: 'before' }, { date: '2026-10-05', when: null }])
    expect(pastEarnings(undefined, '2026-09-30', '2026-10-08')).toEqual([])
  })
})
