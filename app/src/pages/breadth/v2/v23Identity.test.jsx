/**
 * ⛔⛔ THE OWNER'S V2-3 RAIL: `coverage` absent ⇒ render == V2-2.
 *
 * V2-3 adds honest-coverage chrome. When there is nothing honest to add — every series
 * covers the window, nothing was reconstructed, the universe barely moved — it must add
 * NOTHING, and the rendered tree must be identical to V2-2's.
 *
 * ⭐ WHY THIS IS THE RIGHT RAIL RATHER THAN "the band is hidden". "Hidden" is a claim
 * about one element; equality is a claim about the whole tree, and it catches the failure
 * that actually happens: an empty `markArea`, a zero-height strip, a wrapper div that
 * shifts everything by a pixel. `PRESENT IS NOT SHOWING` is this repo's own lesson, and
 * its converse — ABSENT MUST BE ABSENT — is what this asserts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { AuthContext } from '../../../context/AuthContext'
import BreadthChartsV2 from './BreadthChartsV2'
import { buildOption } from './chartOption'

vi.mock('echarts-for-react', () => ({
  // ⛔ The stub SERIALISES the option into the DOM. A stub that renders a bare <div>
  // would make every option compare equal and this whole file would pass vacuously —
  // the chart config IS the thing under test here.
  default: ({ option }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} />
  ),
}))

const DATES = Array.from({ length: 30 }, (_, i) =>
  `2026-08-${String(i + 1).padStart(2, '0')}`)

/** A window with nothing to disclose: full series, nothing reconstructed, flat universe. */
const CLEAN = {
  dates: DATES,
  series: {
    breadth_score: DATES.map((_, i) => 50 + i),
    pct_above_50sma: DATES.map((_, i) => 40 + i),
    new_52w_highs: DATES.map((_, i) => 10 + i),
    universe_count: DATES.map(() => 2000),
  },
  keys: ['breadth_score', 'pct_above_50sma', 'new_52w_highs'],
  missing: [],
  dropped: [],
  reconstructed: [],
  sessions: DATES.length,
}

/** The same window, but with things to disclose. */
const DIRTY = {
  ...CLEAN,
  series: {
    ...CLEAN.series,
    // a late-starting series and a growing universe
    new_52w_highs: DATES.map((_, i) => (i < 10 ? null : 10 + i)),
    universe_count: DATES.map((_, i) => 1500 + i * 40),
  },
  reconstructed: DATES.slice(0, 6),
}

function mockSeries(payload) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) })))
}

function ctx(flags) {
  return { user: { id: 'u' }, plan: 'pro', loading: false, ...flags }
}

// ⛔⛔ EVERY RENDER GETS ITS OWN SWR KEY, AND THIS IS NOT COSMETIC. SWR's cache is
// module-global and `App.jsx` configures an 8-SECOND dedupe, so two mounts asking the
// same metrics over the same window share one entry: the second paints the FIRST
// payload and never refetches inside the test. Asserting on that frame reports the
// feature broken when only the harness was. A distinct `from` per render makes each
// mount a different key, so each one actually fetches what it was handed.
//
// ⚠️ The window is NOT rendered anywhere — it only forms the request URL — so varying it
// cannot affect the DOM the identity rail compares. Checked, not assumed: the shell
// renders `s.series`/`s.dates` from the PAYLOAD, which is identical across calls.
//
// ⛔ AND IT MUST STAY INSIDE A SERVABLE SPAN. Written first as `2020-01-…`, which is six
// years wide: `seriesRequest` set `tooWide`, the component correctly rendered its refusal
// instead of a chart, and FOUR tests failed waiting for a chart that was never coming.
// The harness had asked for something the product refuses, and the product was right.
let keySeq = 0

async function renderWith(flags, payload) {
  mockSeries(payload)
  keySeq += 1
  const { container } = render(
    <AuthContext.Provider value={ctx(flags)}>
      <BreadthChartsV2
        keys={CLEAN.keys}
        from={`2026-07-${String(keySeq).padStart(2, '0')}`}
        to={DATES[DATES.length - 1]}
      />
    </AuthContext.Provider>,
  )
  await waitFor(() => expect(screen.getByTestId('echart')).toBeInTheDocument())
  return container.innerHTML
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

describe('⛔⛔ coverage absent ⇒ V2-3 renders exactly what V2-2 renders', () => {
  it('the trees are IDENTICAL when there is nothing to disclose', async () => {
    const v22Only = await renderWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: false }, CLEAN)
    cleanup()
    const both = await renderWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true }, CLEAN)
    expect(both).toBe(v22Only)
  })

  it('⭐ CONTROL — with something to disclose they DIFFER, so the rail is not vacuous', async () => {
    const v22Only = await renderWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: false }, DIRTY)
    cleanup()
    const both = await renderWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true }, DIRTY)
    expect(both).not.toBe(v22Only)
  })

  it('the era note appears only when the universe actually moved', async () => {
    await renderWith({ breadthDcV22Enabled: true, breadthDcV23Enabled: true }, CLEAN)
    expect(screen.queryByTestId('v2-era-note')).toBeNull()
    cleanup()
    await renderWith({ breadthDcV22Enabled: true, breadthDcV23Enabled: true }, DIRTY)
    // ⛔ `findBy`, NOT `getBy`. SWR's cache is module-global and both renders share one
    // key (same metrics, same window), so the second mount paints the FIRST payload from
    // cache and only then revalidates to this one. A synchronous assertion here reads the
    // cached frame and reports the note missing — a harness artefact that looks exactly
    // like the feature being broken.
    expect(await screen.findByTestId('v2-era-note')).toBeInTheDocument()
  })

  it('⛔ the era note states the WINDOW\'S numbers, not the audit\'s example', async () => {
    await renderWith({ breadthDcV22Enabled: true, breadthDcV23Enabled: true }, DIRTY)
    const text = screen.getByTestId('v2-era-note').textContent
    expect(text).toContain('1,500')          // DIRTY's own first universe_count
    expect(text).not.toContain('1,521')      // the audit's illustrative pair
    expect(text).toContain('% versions compare across years')
  })
})

describe('the option itself carries no empty chrome', () => {
  it('⛔ a null coverage model contributes NO KEYS to the series', () => {
    // An empty `markArea: {data: []}` still serialises and would make two options
    // unequal while looking harmless — which is exactly how the identity rail above
    // would start failing for a reason nobody could see on screen.
    const a = buildOption(DATES, CLEAN.series, CLEAN.keys, { coverage: null })
    const b = buildOption(DATES, CLEAN.series, CLEAN.keys)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    for (const sr of a.series) expect('markArea' in sr).toBe(false)
  })

  it('⭐ CONTROL — a real coverage model DOES add a markArea', () => {
    const coverage = {
      regions: { breadth_score: { fromIndex: 0, toIndex: 4 } },
      runs: [],
      perKey: {},
      era: null,
    }
    const o = buildOption(DATES, CLEAN.series, CLEAN.keys, { coverage })
    const withArea = o.series.filter(sr => 'markArea' in sr)
    expect(withArea.length).toBe(1)
    expect(withArea[0].id).toBe('breadth_score')
  })

  it('not-recorded and reconstructed use DIFFERENT inks — two facts, two colours', () => {
    const coverage = {
      regions: { breadth_score: { fromIndex: 0, toIndex: 2 } },
      runs: [{ fromIndex: 5, toIndex: 8 }],
      perKey: {},
      era: null,
    }
    const o = buildOption(DATES, CLEAN.series, CLEAN.keys, { coverage })
    const areas = o.series.find(sr => sr.id === 'breadth_score').markArea.data
    const inks = areas.map(pair => pair[0].itemStyle.color)
    expect(new Set(inks).size, 'one ink would merge "never recorded" with "reconstructed"')
      .toBe(2)
  })
})
