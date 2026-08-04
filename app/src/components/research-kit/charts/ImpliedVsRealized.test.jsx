import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ImpliedVsRealized, {
  SIZE, VIEWBOX, pairQuarters, coldStartState, impliedVerdict, pairGeometry,
} from './ImpliedVsRealized'

/** Earnings-history rows, oldest-first (§6 row 3). */
const QUARTERS = [
  { quarter: 'Q1 25', report_date: '2025-02-05', reported: true, reaction_pct: 3.0 },
  { quarter: 'Q2 25', report_date: '2025-05-07', reported: true, reaction_pct: -2.0 },
  { quarter: 'Q3 25', report_date: '2025-08-06', reported: true, reaction_pct: 4.0 },
  { quarter: 'Q4 25', report_date: '2025-11-05', reported: true, reaction_pct: -3.0 },
  { quarter: 'Q1 26', report_date: '2026-02-04', reported: false, reaction_pct: null },
]
/** Implied snapshots as `implied_store.get_implied_history` returns them: newest-first. */
const IMPLIED = [
  { sym: 'X', report_date: '2025-11-05', captured_at: '2025-11-04T21:00:00Z', pct: 7.5, dollar: 8.1, expiry: '2025-11-07' },
  { sym: 'X', report_date: '2025-08-06', captured_at: '2025-08-05T21:00:00Z', pct: 6.5, dollar: 7.0, expiry: '2025-08-08' },
  { sym: 'X', report_date: '2025-05-07', captured_at: '2025-05-06T21:00:00Z', pct: 6.0, dollar: 6.2, expiry: '2025-05-09' },
  { sym: 'X', report_date: '2025-02-05', captured_at: '2025-02-04T21:00:00Z', pct: 5.0, dollar: 5.4, expiry: '2025-02-07' },
]
const LIVE = { pct: 6.2, dollar: 6.8, expiry: '2026-02-06', horizon: 'through 2026-02-06', source: 'massive-chain' }

describe('pairQuarters — joins the two payloads on report_date', () => {
  it('pairs every quarter with its pre-report implied snapshot', () => {
    const pairs = pairQuarters(QUARTERS, IMPLIED, LIVE)
    expect(pairs.map((p) => p.quarter)).toEqual(['Q1 25', 'Q2 25', 'Q3 25', 'Q4 25', 'Q1 26'])
    expect(pairs[0].impliedPct).toBe(5.0)
    expect(pairs[0].realizedPct).toBe(3.0)
    expect(pairs[3].impliedPct).toBe(7.5)
  })

  it('fills the current quarter from the LIVE read, and marks it current', () => {
    const pairs = pairQuarters(QUARTERS, IMPLIED, LIVE)
    expect(pairs[4].isCurrent).toBe(true)
    expect(pairs[4].impliedPct).toBe(6.2)
    expect(pairs[4].realizedPct).toBeNull()
  })

  it('tolerates a datetime report_date and ignores unmatched snapshots', () => {
    const pairs = pairQuarters(
      [{ quarter: 'Q1', report_date: '2025-02-05T00:00:00Z', reported: true, reaction_pct: 1 }],
      [{ report_date: '2025-02-05', pct: 4 }, { report_date: '2019-01-01', pct: 99 }],
      null,
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0].impliedPct).toBe(4)
  })

  it('never throws on null inputs', () => {
    expect(pairQuarters(null, null, null)).toEqual([])
    expect(pairQuarters(QUARTERS, null, null)[0].impliedPct).toBeNull()
  })
})

describe('coldStartState (§4.3.1a)', () => {
  it('is cold under three recorded implied quarters and captions honestly', () => {
    const pairs = pairQuarters(QUARTERS.slice(3), IMPLIED.slice(0, 1), LIVE)
    const cold = coldStartState(pairs, '2025-11-05')
    expect(cold.cold).toBe(true)
    expect(cold.recorded).toBe(2)      // Q4 25 snapshot + the live current quarter
    expect(cold.caption).toBe('Implied tracking since 2025-11 · 2/8 recorded')
  })

  it('is warm once three or more quarters are recorded', () => {
    const cold = coldStartState(pairQuarters(QUARTERS, IMPLIED, LIVE), '2025-02-05')
    expect(cold.cold).toBe(false)
    expect(cold.caption).toBeNull()
  })

  it('says em-dash rather than "undefined" when nothing has been recorded', () => {
    expect(coldStartState([], null).caption).toBe('Implied tracking since — · 0/8 recorded')
  })
})

describe('impliedVerdict', () => {
  it('calls the premium RICH when the name typically moves less than it is priced for', () => {
    const v = impliedVerdict(pairQuarters(QUARTERS, IMPLIED, LIVE), LIVE)
    expect(v.rich).toBe(true)
    expect(v.tone).toBe('gold')
    expect(v.glyph).toBe('▲')
    expect(v.label).toBe('PREMIUM RICH — priced ±6.2% through 2026-02-06, typically moves ±3.0%')
  })

  it('calls it CHEAP when realized routinely exceeds the priced move', () => {
    const big = QUARTERS.map((q) => (q.reaction_pct == null ? q : { ...q, reaction_pct: q.reaction_pct * 4 }))
    const v = impliedVerdict(pairQuarters(big, IMPLIED, LIVE), LIVE)
    expect(v.rich).toBe(false)
    expect(v.glyph).toBe('▼')
    expect(v.label).toMatch(/^PREMIUM CHEAP —/)
  })

  it('states NOTHING on fewer than three fully-paired past quarters', () => {
    expect(impliedVerdict(pairQuarters(QUARTERS.slice(3), IMPLIED.slice(0, 1), LIVE), LIVE)).toBeNull()
    expect(impliedVerdict([], LIVE)).toBeNull()
  })

  it('never uses the word "verdict" in its copy (§12)', () => {
    const v = impliedVerdict(pairQuarters(QUARTERS, IMPLIED, LIVE), LIVE)
    expect(v.label.toLowerCase()).not.toContain('verdict')
  })
})

describe('pairGeometry', () => {
  const pairs = pairQuarters(QUARTERS, IMPLIED, LIVE)

  it('draws the realized bar SIGNED — down-closes descend below the baseline', () => {
    const g = pairGeometry(pairs)
    const up = g.cols[0]      // +3.0%
    const down = g.cols[1]    // -2.0%
    expect(up.realized.y + up.realized.h).toBeCloseTo(g.baselineY, 6)
    expect(down.realized.y).toBeCloseTo(g.baselineY, 6)
  })

  it('draws the hollow implied bar on the SAME side as its realized outcome', () => {
    const g = pairGeometry(pairs)
    expect(g.cols[1].dir).toBe(-1)
    expect(g.cols[1].implied.y).toBeCloseTo(g.baselineY, 6)
  })

  it('draws the current quarter upward when there is no outcome yet', () => {
    const g = pairGeometry(pairs)
    const cur = g.cols[4]
    expect(cur.isCurrent).toBe(true)
    expect(cur.dir).toBe(1)
    expect(cur.realized).toBeNull()
    expect(cur.implied.h).toBeGreaterThan(0)
  })

  it('scales both series against one shared magnitude', () => {
    const g = pairGeometry(pairs)
    expect(g.scaleMax).toBeGreaterThanOrEqual(7.5)
    for (const c of g.cols) {
      if (c.implied) expect(c.implied.h).toBeLessThanOrEqual((VIEWBOX.height - 28) / 2)
    }
  })

  it('never divides by zero on an all-null strip', () => {
    const g = pairGeometry([{ key: 'a', quarter: 'a', impliedPct: null, realizedPct: null, isCurrent: false }])
    expect(Number.isFinite(g.scaleMax)).toBe(true)
    expect(g.cols[0].implied).toBeNull()
    expect(g.cols[0].realized).toBeNull()
  })
})

describe('ImpliedVsRealized', () => {
  const warm = { quarters: QUARTERS, impliedHistory: IMPLIED, live: LIVE, historySince: '2025-02-05' }

  it('renders an EmptyState when there is nothing on either axis', () => {
    render(<ImpliedVsRealized quarters={[]} impliedHistory={[]} live={null} historySince={null} />)
    expect(screen.getByTestId('rk-empty-title')).toBeInTheDocument()
  })

  it('draws a paired column per quarter when history is warm', () => {
    const { container } = render(<ImpliedVsRealized {...warm} />)
    expect(container.querySelectorAll('[data-testid="rk-ivr-implied"]')).toHaveLength(5)
    expect(container.querySelectorAll('[data-testid="rk-ivr-realized"]')).toHaveLength(4)
    expect(container.querySelector('[data-testid="rk-ivr-cold"]')).toBeNull()
  })

  it('renders the RICH/CHEAP chip once history supports it', () => {
    render(<ImpliedVsRealized {...warm} />)
    expect(screen.getByText(/PREMIUM RICH/)).toBeInTheDocument()
  })

  it('COLD START: suppresses the historical hollow bars, keeps the current one, captions it', () => {
    const { container } = render(
      <ImpliedVsRealized
        quarters={QUARTERS.slice(3)}
        impliedHistory={IMPLIED.slice(0, 1)}
        live={LIVE}
        historySince="2025-11-05"
      />,
    )
    expect(container.querySelectorAll('[data-testid="rk-ivr-implied"]')).toHaveLength(1)
    expect(screen.getByTestId('rk-ivr-cold')).toHaveTextContent('Implied tracking since 2025-11 · 2/8 recorded')
    expect(screen.queryByText(/PREMIUM/)).toBeNull()
  })

  it('marks the current quarter without spending the canvas gold (§3.1)', () => {
    const { container } = render(<ImpliedVsRealized {...warm} />)
    const now = container.querySelectorAll('[data-testid="rk-ivr-now"]')
    expect(now).toHaveLength(1)
    expect(now[0].textContent).toBe('NOW')
  })

  it('is one labelled image stating the comparison', () => {
    render(<ImpliedVsRealized {...warm} />)
    const label = screen.getByRole('img').getAttribute('aria-label')
    expect(label).toMatch(/priced ±6\.2%/)
    expect(label).toMatch(/typically moves ±3\.0%/)
  })

  it('exports a SIZE box for SkeletonBlock', () => {
    expect(SIZE).toEqual({ width: '100%', height: VIEWBOX.height })
  })
})
