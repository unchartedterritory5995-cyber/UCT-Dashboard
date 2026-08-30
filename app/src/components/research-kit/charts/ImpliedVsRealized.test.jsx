import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import ImpliedVsRealized, {
  SIZE, VIEWBOX, pairQuarters, coldStartState, impliedVerdict, pairGeometry,
} from './ImpliedVsRealized'
import { buildQuarters } from '../../research/earningsHistoryModel'

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

// P2 T8b — THE REGRESSION TEST. Today, `earningsHistoryModel.buildQuarters`
// keys a PAST quarter's `report_date` off `h.period` (Finnhub /stock/earnings'
// fiscal PERIOD END, e.g. 2026-06-30), while `implied_store.record_implied`
// keys its snapshot on the /calendar/earnings ANNOUNCEMENT date (e.g.
// 2026-07-30, typically 2-8 weeks later). `pairQuarters` joins the two on
// `report_date` string equality, so a real accrued snapshot can never pair
// with its own history row — the hollow implied bar never draws for any past
// quarter. This must FAIL against today's code (no fiscal-key pairing yet)
// and pass once both sides carry + pair on the provider's own quarter/year.
describe('pairQuarters — fiscal-quarter identity (P2 T8b regression)', () => {
  it('pairs a past quarter whose implied snapshot is keyed on the announcement '
    + 'date against a history row keyed on the period end', () => {
    // beat_history row as Finnhub /stock/earnings returns it once
    // earnings_estimates.py carries quarter/year through: period END
    // 2026-06-30, but the print actually happened weeks later.
    const beatHistory = [
      { period: '2026-06-30', actual: 0.91, estimate: 0.88, surprise: 3.4, quarter: 2, year: 2026 },
    ]
    const quarters = buildQuarters({
      beatHistory, histStats: { last_n: [4.1] }, reportDate: null, row: {},
    })
    // implied_store keys the snapshot on the /calendar/earnings ANNOUNCEMENT
    // date, captured the night before — nowhere near the period end above.
    const impliedHistory = [
      { sym: 'X', report_date: '2026-07-30', captured_at: '2026-07-29T21:00:00Z',
        pct: 5.5, dollar: 6.0, fiscal_year: 2026, fiscal_quarter: 2 },
    ]
    const pairs = pairQuarters(quarters, impliedHistory, null)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].impliedPct).toBe(5.5)
  })
})

// Requirement 4 — a snapshot recorded BEFORE this task (no fiscal_year/
// fiscal_quarter column populated) must still pair via the report_date
// fallback, so real accrued history captured before this ships is never
// orphaned.
describe('pairQuarters — report_date fallback for a pre-migration snapshot (Requirement 4)', () => {
  it('pairs via report_date equality when neither side carries a fiscal key', () => {
    const quarters = [
      { quarter: 'Q4 25', report_date: '2025-11-05', reported: true, reaction_pct: -3.0 },
    ]
    const impliedHistory = [{ report_date: '2025-11-05', pct: 7.5 }]  // pre-migration row
    const pairs = pairQuarters(quarters, impliedHistory, null)
    expect(pairs[0].impliedPct).toBe(7.5)
  })

  it('falls back to report_date when the history row has a fiscal key but the stored snapshot does not', () => {
    const quarters = [
      { quarter: 'Q4 25', report_date: '2025-11-05', reported: true, reaction_pct: -3.0,
        fiscal_year: 2025, fiscal_quarter: 4 },
    ]
    const impliedHistory = [{ report_date: '2025-11-05', pct: 7.5 }]  // no fiscal key yet
    const pairs = pairQuarters(quarters, impliedHistory, null)
    expect(pairs[0].impliedPct).toBe(7.5)
  })
})

describe('pairQuarters — fiscal key phantom-zero guard', () => {
  it('a genuine 0 fiscal_quarter/fiscal_year still pairs — 0 is not "absent"', () => {
    const quarters = [{ quarter: 'Q0 00', report_date: null, reported: true, reaction_pct: 1.0,
                         fiscal_year: 0, fiscal_quarter: 0 }]
    const impliedHistory = [{ report_date: '2026-01-01', pct: 3.3, fiscal_year: 0, fiscal_quarter: 0 }]
    expect(pairQuarters(quarters, impliedHistory, null)[0].impliedPct).toBe(3.3)
  })

  it('a null fiscal key never coerces to 0 and so never collides with a genuine 0 on the other side', () => {
    const quarters = [{ quarter: 'Q?', report_date: null, reported: true, reaction_pct: 1.0,
                         fiscal_year: null, fiscal_quarter: null }]
    const impliedHistory = [{ report_date: '2026-01-01', pct: 3.3, fiscal_year: 0, fiscal_quarter: 0 }]
    expect(pairQuarters(quarters, impliedHistory, null)[0].impliedPct).toBeNull()
  })
})

// MINOR (P2 T8b review r1) — byFiscal resolves a fiscal key spanning TWO
// report_dates (a rescheduled print, captured twice) to the LATER capture,
// not the temporally-first one — a DIFFERENT rule than byDate's "earliest is
// honest" (byDate's guarantee comes from report_date being the store's own
// PRIMARY KEY; a fiscal key has no such guarantee). Because impliedHistory
// arrives report_date DESC, "first occurrence wins" here means "newest
// report_date wins".
describe('pairQuarters — a rescheduled print resolves to the LATEST fiscal-keyed capture', () => {
  it('report_date DESC array [newer capture, older capture] resolves byFiscal to the newer one', () => {
    const quarters = [{ quarter: 'Q2 26', report_date: null, reported: true, reaction_pct: 1.0,
                         fiscal_year: 2026, fiscal_quarter: 2 }]
    // DESC by report_date, as implied_store.get_implied_history returns it:
    // the RESCHEDULED (newer report_date) capture appears FIRST.
    const impliedHistory = [
      { report_date: '2026-07-30', pct: 9.9, fiscal_year: 2026, fiscal_quarter: 2 },   // rescheduled, newer date
      { report_date: '2026-07-23', pct: 5.5, fiscal_year: 2026, fiscal_quarter: 2 },   // original date
    ]
    expect(pairQuarters(quarters, impliedHistory, null)[0].impliedPct).toBe(9.9)
  })
})

// Requirement 2 — impliedVerdict (the RICH/CHEAP chip) requires 3 fully-paired
// PAST quarters. Before this task that bar was structurally unreachable for
// any real accrued history (report_date never matched); the fiscal key makes
// it reachable.
describe('impliedVerdict — reachable via fiscal-key pairing (Requirement 2)', () => {
  const beatHistory = [   // newest-first, as Finnhub returns it
    { period: '2026-06-30', actual: 0.95, estimate: 1.00, surprise: -5.0, quarter: 2, year: 2026 },
    { period: '2026-03-31', actual: 0.80, estimate: 0.75, surprise: 6.7, quarter: 1, year: 2026 },
    { period: '2025-12-31', actual: 0.70, estimate: 0.65, surprise: 7.7, quarter: 4, year: 2025 },
  ]
  const histStats = { last_n: [2.0, -1.5, 3.0] }  // newest-first realized reactions
  // Snapshots keyed on the ANNOUNCEMENT date (weeks after each period end
  // above) — exactly the shape that never paired before this task.
  const impliedHistory = [
    { report_date: '2026-07-30', pct: 6.0, fiscal_year: 2026, fiscal_quarter: 2 },
    { report_date: '2026-04-29', pct: 5.5, fiscal_year: 2026, fiscal_quarter: 1 },
    { report_date: '2026-01-28', pct: 5.0, fiscal_year: 2025, fiscal_quarter: 4 },
  ]

  it('three past quarters pair fully via the fiscal key, and impliedVerdict returns a chip', () => {
    const quarters = buildQuarters({ beatHistory, histStats, reportDate: null, row: {} })
    const pairs = pairQuarters(quarters, impliedHistory, null)
    expect(pairs).toHaveLength(3)
    expect(pairs.every((p) => p.impliedPct != null && p.realizedPct != null)).toBe(true)
    expect(impliedVerdict(pairs, null)).not.toBeNull()
  })

  it('renders the RICH/CHEAP chip in the hero once three past quarters pair', () => {
    const quarters = buildQuarters({ beatHistory, histStats, reportDate: null, row: {} })
    render(
      <ImpliedVsRealized
        quarters={quarters}
        impliedHistory={impliedHistory}
        live={null}
        historySince="2025-10-01"
        recordedCount={impliedHistory.length}
      />,
    )
    expect(screen.getByText(/PREMIUM (RICH|CHEAP)/)).toBeInTheDocument()
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

  // I2 — coldStartState.cold counts the LIVE current quarter as "recorded",
  // so a warm-by-that-count sample can still fall below impliedVerdict's
  // stricter 3-fully-paired-PAST-quarters bar. 2 stored (Q3 25, Q4 25) + the
  // live current quarter = 3 "recorded" (not cold), but only 2 fully-paired
  // past quarters (below MIN_PAIRED) — no chip. The gap must not go silent:
  // the coverage caption renders anyway.
  it('I2: renders the coverage caption when there is no chip, even though coldStartState reads warm', () => {
    const pairs = pairQuarters(QUARTERS.slice(2), IMPLIED.slice(0, 2), LIVE)
    const cold = coldStartState(pairs, '2025-08-06')
    expect(cold.cold).toBe(false)
    expect(cold.caption).toBeNull()
    expect(impliedVerdict(pairs, LIVE)).toBeNull()

    render(
      <ImpliedVsRealized
        quarters={QUARTERS.slice(2)}
        impliedHistory={IMPLIED.slice(0, 2)}
        live={LIVE}
        historySince="2025-08-06"
      />,
    )
    expect(screen.queryByText(/PREMIUM/)).toBeNull()
    expect(screen.getByTestId('rk-ivr-cold')).toHaveTextContent('Implied tracking since 2025-08 · 3/8 recorded')
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

describe('recordedCount (P2 ruling: n counts STORED snapshots only)', () => {
  const quarters = [
    { quarter: 'Q1 26', report_date: '2026-02-05', reported: true, reaction_pct: 4.1 },
    { quarter: 'Q2 26', report_date: '2026-05-06', reported: true, reaction_pct: -2.2 },
    { quarter: 'Q3 26', report_date: '2026-08-06', reported: false, reaction_pct: null },
  ]

  it('coldStartState prefers the passed stored count over the pair count', () => {
    const pairs = pairQuarters(quarters, [], { pct: 6.8 })   // only the LIVE one is filled
    expect(coldStartState(pairs, '2026-08').recorded).toBe(1)        // legacy behaviour
    expect(coldStartState(pairs, '2026-08', { recorded: 0 }).recorded).toBe(0)
    expect(coldStartState(pairs, '2026-08', { recorded: 0 }).coverageText)
      .toBe('Implied tracking since 2026-08 · 0/8 recorded')
  })

  it('null/undefined recordedCount falls back to the internal count (not zero)', () => {
    const pairs = pairQuarters(quarters, [], { pct: 6.8 })
    expect(coldStartState(pairs, '2026-08', { recorded: null }).recorded).toBe(1)
    expect(coldStartState(pairs, '2026-08', {}).recorded).toBe(1)
  })

  it('the caption never counts tonight’s live implied', () => {
    render(<ImpliedVsRealized quarters={quarters} impliedHistory={[]}
                              live={{ pct: 6.8 }} historySince="2026-08" recordedCount={0} />)
    expect(screen.getByTestId('rk-ivr-cold').textContent).toBe(
      'Implied tracking since 2026-08 · 0/8 recorded')
  })
})

// ── the viewBox tracks the CONTAINER, not a constant ─────────────────────────
//
// WHY THIS SUITE NEEDS AN EXPLICIT RAIL: jsdom ships no ResizeObserver, so
// `useMeasuredWidth` short-circuits to the fallback and every OTHER test in
// this file renders the old 320-unit box. That is deliberate (it keeps the
// pairGeometry unit tests meaningful), but it also means the whole reason this
// component was changed — filling its container instead of drawing 320px
// centred inside a ~604px canvas — is invisible to a green run. This block
// installs a stub so the measured path is actually executed, and asserts BOTH
// directions so it cannot pass against a component that ignores the measurement.
describe('viewBox tracks the measured container width', () => {
  const WARM = { quarters: QUARTERS, impliedHistory: IMPLIED, live: LIVE, historySince: '2025-02-05' }

  const roCallbacks = []

  function withMeasuredWidth(px, fn) {
    const realRO = globalThis.ResizeObserver
    const proto = Object.getPrototypeOf(document.createElement('div'))
    const realClientWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
    // Captures the callback so a test can SIMULATE a resize. jsdom has no
    // layout, and a real browser cannot help here either: a backgrounded tab
    // suspends the rendering lifecycle, so ResizeObserver never fires there
    // (verified live — 0 rAF frames, 0 RO callbacks). This stub is the only
    // place the resize-tracking wire can actually be exercised.
    roCallbacks.length = 0
    globalThis.ResizeObserver = class {
      // Registers on observe(), NOT in the constructor: a stub that collects
      // the callback at construction stays green when `ro.observe(node)` is
      // deleted, which is the exact wire these tests exist to protect.
      constructor(cb) { this._cb = cb }
      observe() { roCallbacks.push(this._cb) }
      disconnect() { const i = roCallbacks.indexOf(this._cb); if (i >= 0) roCallbacks.splice(i, 1) }
    }
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => px })
    try {
      return fn()
    } finally {
      if (realClientWidth) Object.defineProperty(proto, 'clientWidth', realClientWidth)
      else delete proto.clientWidth
      if (realRO) globalThis.ResizeObserver = realRO
      else delete globalThis.ResizeObserver
    }
  }

  const viewBoxOf = (container) =>
    container.querySelector('[data-testid="rk-ivr"]')?.getAttribute('viewBox')

  it('cuts the box to the wrapper width once it can be measured', () => {
    const { container } = withMeasuredWidth(604, () =>
      render(<ImpliedVsRealized {...WARM} />))
    expect(viewBoxOf(container)).toBe(`0 0 604 ${VIEWBOX.height}`)
  })

  it('is a DIFFERENT box at a different width — the measurement is read, not ignored', () => {
    const { container } = withMeasuredWidth(880, () =>
      render(<ImpliedVsRealized {...WARM} />))
    expect(viewBoxOf(container)).toBe(`0 0 880 ${VIEWBOX.height}`)
  })

  it('measures after mounting EMPTY first — the real SWR arrival order', () => {
    // ⛔ THE RAIL THAT MATTERS. Every other test here renders with the payload
    // already present, so the wrapper div exists on the first pass and a
    // `useRef` + `useEffect(..., [ref])` measures it by luck. In the real modal
    // SWR has not resolved on first render, `hasAnything` is false, and the
    // component returns <EmptyState/> — no wrapper to measure. A stable useRef
    // object never re-triggers the effect when the div appears later, so the
    // chart stayed pinned at the 320 fallback FOREVER while this whole suite
    // stayed green. Measured live in a browser: viewBox "0 0 320 140" inside a
    // 714px box, ink covering 36% of the width. A callback ref is what fixes
    // it, and this ordering is what proves the fix.
    const { container } = withMeasuredWidth(604, () => {
      const r = render(<ImpliedVsRealized quarters={[]} impliedHistory={[]} live={null} />)
      // Precondition: the first render really is the empty state, so this test
      // cannot pass by accidentally rendering a chart from the start.
      expect(r.container.querySelector('[data-testid="rk-ivr"]')).toBeNull()
      r.rerender(<ImpliedVsRealized {...WARM} />)
      return r
    })
    expect(viewBoxOf(container)).toBe(`0 0 604 ${VIEWBOX.height}`)
  })

  it('falls back to VIEWBOX.width when the element measures 0 (detached/hidden)', () => {
    // A 0-wide viewBox divides the slot by zero and puts every bar at x=NaN.
    const { container } = withMeasuredWidth(0, () =>
      render(<ImpliedVsRealized {...WARM} />))
    expect(viewBoxOf(container)).toBe(`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`)
  })

  it('re-cuts the box when the container later RESIZES', () => {
    // The synchronous read on mount is what fixes the modal; this asserts the
    // OTHER half — that the observer callback actually re-reads and re-renders,
    // rather than being an observer wired to nothing.
    let width = 604
    const proto = Object.getPrototypeOf(document.createElement('div'))
    const realClientWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
    const realRO = globalThis.ResizeObserver
    roCallbacks.length = 0
    globalThis.ResizeObserver = class {
      // Registers on observe(), NOT in the constructor: a stub that collects
      // the callback at construction stays green when `ro.observe(node)` is
      // deleted, which is the exact wire these tests exist to protect.
      constructor(cb) { this._cb = cb }
      observe() { roCallbacks.push(this._cb) }
      disconnect() { const i = roCallbacks.indexOf(this._cb); if (i >= 0) roCallbacks.splice(i, 1) }
    }
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => width })
    try {
      const { container } = render(<ImpliedVsRealized {...WARM} />)
      expect(viewBoxOf(container)).toBe(`0 0 604 ${VIEWBOX.height}`)
      width = 880
      act(() => { roCallbacks.forEach((cb) => cb()) })
      expect(viewBoxOf(container)).toBe(`0 0 880 ${VIEWBOX.height}`)
    } finally {
      if (realClientWidth) Object.defineProperty(proto, 'clientWidth', realClientWidth)
      else delete proto.clientWidth
      if (realRO) globalThis.ResizeObserver = realRO
      else delete globalThis.ResizeObserver
    }
  })

  it('bars get WIDER in a wider box — the point of the change', () => {
    // pairGeometry is pure, so this is the honest way to assert the visual
    // outcome: the same pairs, two box widths, and the bar must grow.
    const pairs = pairQuarters(QUARTERS, IMPLIED, LIVE)
    const narrow = pairGeometry(pairs, { width: 320, height: VIEWBOX.height })
    const wide = pairGeometry(pairs, { width: 604, height: VIEWBOX.height })
    const barOf = (geo) => geo.cols.find((c) => c.realized)?.realized.w
    expect(barOf(wide)).toBeGreaterThan(barOf(narrow))
    // ...and it must still be capped, not scale without limit.
    expect(barOf(pairGeometry(pairs, { width: 4000, height: VIEWBOX.height })))
      .toBe(barOf(wide))
  })

  it('the whole box is used: the last column stays inside it', () => {
    const pairs = pairQuarters(QUARTERS, IMPLIED, LIVE)
    const geo = pairGeometry(pairs, { width: 604, height: VIEWBOX.height })
    const last = geo.cols[geo.cols.length - 1]
    // Centre of the final slot sits in the last sixth of the box — i.e. the
    // columns spread across the full width instead of bunching at 320.
    expect(last.cx).toBeGreaterThan(604 * 0.8)
    expect(last.cx).toBeLessThan(604)
  })
})
