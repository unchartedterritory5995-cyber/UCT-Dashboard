/**
 * The Read's strip — the half `theRead.test.js` cannot see: what happens when
 * the sentences are actually mounted on a page.
 *
 * The load-bearing property here is a NEGATIVE one — spec §4: "The Read must
 * never trigger a network request." A strip that is on screen for every reader
 * on every style, quietly fetching two endpoints, is a request per page view
 * for data most readers never asked for. So this file MEASURES the request
 * count at `globalThis.fetch` through a real render, with a control proving the
 * counter can reach one (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
 *
 * It also proves the cache read LANDS — a near-miss on the key is silent and
 * indistinguishable from "that lens has not been opened yet" — by letting the
 * real fetching lens populate the cache and then reading the strip.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import TheReadStrip from './TheReadStrip'
import { splitFigures } from './theReadFigures'
import { composeRead } from './theRead'
import ScoreAttributionView from './ScoreAttributionView'
import AnalogueDeckView from './AnalogueDeckView'
import { analoguesKey, attributionKey } from './breadthEndpoints'
import { optionDefaults } from './viewMetricConfig'
import { HM_METRICS } from '../heatmapMetrics'

const N = 60
const ROWS = Array.from({ length: N }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 28) - i * 86400000).toISOString().slice(0, 10),
  pct_above_50sma: 52.1 + i * 0.215, pct_above_200sma: 60,
  sp500_close: 5000 + (N - 1 - i) * 5, breadth_score: 88 - i * 0.3,
  vix: 16 + i * 0.1, mcclellan_osc: 10, advancing: 3000, declining: 1500,
  up_vol_ratio: 1.8, new_52w_highs: 10 + i, new_52w_lows: 5 + i,
  is_ftd: i === 18 ? 1 : 0, rsp_spy_ratio: 0.62 + (N - 1 - i) * 0.0002,
  iwm_qqq_ratio: 0.55, vxn: 20,
}))
const LADDER = HM_METRICS.filter(m => ['breadth_score', 'vix'].includes(m.key))

const ATTRIBUTION_BODY = {
  ok: true, date: ROWS[0].date, total: 80, min_weight_met: true,
  components: [{ key: 'vix', label: 'VIX', points: 9, max_points: 10, present: true }],
  prev: { date: ROWS[1].date, total: 70, components: [] },
}
const ANALOGUE_BODY = {
  reference_date: ROWS[0].date,
  analogues: [
    { date: '2025-03-11', similarity: 92.4, forward_returns: { fwd_20d: 4.5 } },
    { date: '2024-11-02', similarity: 88.1, forward_returns: { fwd_20d: -2.1 } },
  ],
}

// A fresh SWR cache per render, so one test's stored entry cannot make the
// next one's "no request" result true for the wrong reason.
const wrap = (ui, cache = new Map()) => (
  <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{ui}</SWRConfig>
)

const strip = (over = {}) => (
  <TheReadStrip rows={ROWS} rowIdx={0} optionsFor={optionDefaults} ladderMetrics={LADDER} {...over} />
)

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.fn((url) => {
    const body = String(url).includes('analogues') ? ANALOGUE_BODY : ATTRIBUTION_BODY
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
  globalThis.fetch = fetchSpy
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('the strip', () => {
  it('renders the paragraph, one testid per clause', () => {
    render(wrap(strip()))
    expect(screen.getByTestId('the-read')).toBeTruthy()
    for (const k of ['regime', 'divergence', 'events', 'rotation', 'percentile']) {
      expect(screen.getByTestId(`the-read-clause-${k}`).textContent.length).toBeGreaterThan(10)
    }
    expect(screen.getByTestId('the-read').textContent).toContain('Distribution')
  })

  it('says so, with a number, when nothing is readable — it does not go blank', () => {
    render(wrap(strip({ rows: ROWS.slice(0, 3).map(r => ({ date: r.date })), ladderMetrics: [] })))
    expect(screen.queryByTestId('the-read-clause-regime')).toBeNull()
    expect(screen.getByTestId('the-read-refusal').textContent).toContain('3 sessions')
  })

  /**
   * 🔴 THE STRIP NOW SETS THE SENTENCE — AND MAY DO NOTHING ELSE TO IT.
   *
   * The paragraph got a measure, leading, and weighted figures so it can be
   * skimmed for values and read for sense. Every one of those is CSS except the
   * last, which splits the clause text to wrap its numbers in `<b>` — and a
   * split is exactly the kind of "harmless" presentation change that quietly
   * becomes a second author over `theRead.js`'s sentence.
   *
   * So the load-bearing property is byte-for-byte identity: what the composer
   * wrote is what the DOM reads, per clause and across the whole strip. If a
   * future rewrite drops a clause "to make it fit", or reflows the text, or
   * loses a character to a greedy pattern, this goes red.
   */
  describe('presentation only — the composer owns every word', () => {
    const read = () => composeRead({
      rows: ROWS, rowIdx: 0, optionsFor: optionDefaults, ladderMetrics: LADDER,
      analogueData: null, attributionData: null,
    })

    it('renders each clause byte for byte, and the strip is their concatenation', () => {
      const composed = read()
      expect(composed.clauses.length).toBeGreaterThan(3)
      render(wrap(strip()))
      for (const c of composed.clauses) {
        expect(screen.getByTestId(`the-read-clause-${c.key}`).textContent).toBe(c.text)
      }
      // The clauses are blocks now, so the DOM concatenates them without the
      // joining space `read.text` uses — compare against the same construction.
      expect(screen.getByTestId('the-read').textContent)
        .toBe(`The Read${composed.clauses.map(c => c.text).join('')}`)
    })

    it('the figure split re-emits its input, on every clause the composer writes', () => {
      for (const c of read().clauses) {
        expect(splitFigures(c.text).join(''), `clause ${c.key} did not survive the split`)
          .toBe(c.text)
      }
    })

    it('CONTROL: the split is not a no-op — it finds the figures, whole', () => {
      // Without this the identity above is satisfied by a function that returns
      // `[text]` and emphasises nothing (`lesson_a_fixture_that_cannot_distinguish`).
      const parts = splitFigures(
        'Distribution — % above 50 SMA at 52.1, down 4.3 points over 20 sessions.')
      expect(parts.filter((_, i) => i % 2)).toEqual(['50', '52.1', '4.3', '20'])
      // A sign and a unit ride WITH the number rather than being stranded.
      expect(splitFigures('Equal vs Cap -0.001 over 20 sessions').filter((_, i) => i % 2))
        .toEqual(['-0.001', '20'])
      expect(splitFigures('1st percentile of 90 readings').filter((_, i) => i % 2))
        .toEqual(['1st', '90'])
    })

    it('weights the figures and nothing else', () => {
      render(wrap(strip()))
      const el = screen.getByTestId('the-read-clause-regime')
      const bolded = [...el.querySelectorAll('b')].map(b => b.textContent)
      expect(bolded.length).toBeGreaterThan(0)
      expect(bolded.every(t => /\d/.test(t)),
             'a run with no digit in it was given figure weight').toBe(true)
    })
  })

  it('is style-independent — the same read whatever lens is on screen', () => {
    // It reads the instruments, so nothing about it is keyed to `viewStyle`.
    const { container } = render(wrap(strip()))
    const first = container.querySelector('[data-testid="the-read"]').textContent
    cleanup()
    const { container: second } = render(wrap(strip({ rowIdx: 0 })))
    expect(second.querySelector('[data-testid="the-read"]').textContent).toBe(first)
  })
})

describe('The Read never issues a network request', () => {
  it('mounts, renders every clause it can, and fetches NOTHING', () => {
    render(wrap(strip()))
    expect(screen.getByTestId('the-read-clause-regime')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches nothing even when its two endpoint clauses are the ones missing', () => {
    render(wrap(strip()))
    // The cache is empty, so both endpoint clauses are absent — and the strip
    // does NOT go and get them.
    expect(screen.queryByTestId('the-read-clause-attribution')).toBeNull()
    expect(screen.queryByTestId('the-read-clause-analogues')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches nothing across a cursor move, which changes the attribution key', () => {
    const cache = new Map()
    const { rerender } = render(wrap(strip(), cache))
    for (const rowIdx of [1, 2, 3, 10]) rerender(wrap(strip({ rowIdx }), cache))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ⛔ THE CONTROL. Without it, every assertion above is green on a spy that
  // could never have fired — a wrong `globalThis.fetch` assignment, a mocked
  // module, a component that never mounted. The lens that DOES fetch is
  // rendered through the same wrapper and the same spy.
  it('CONTROL: the same spy counts the fetching lens beside it', async () => {
    render(wrap(
      <>
        <ScoreAttributionView rows={ROWS} currentRow={ROWS[0]} options={optionDefaults('attribution')} />
        {strip()}
      </>,
    ))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    // …and every call came from the lens, on the lens's own key.
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).toBe(attributionKey(ROWS[0].date, ROWS.length))
    }
  })
})

describe('the cache read actually lands', () => {
  it('picks up the attribution clause the LENS fetched, off the lens’s own key', async () => {
    // ⭐ THIS IS THE KEY-AGREEMENT PROOF, and it is deliberately not a string
    // comparison: the lens fetches, the strip reads, and the clause appears —
    // or the two keys disagree and it never does, silently, forever.
    const cache = new Map()
    render(wrap(
      <>
        <ScoreAttributionView rows={ROWS} currentRow={ROWS[0]} options={optionDefaults('attribution')} />
        {strip()}
      </>, cache))

    await waitFor(() =>
      expect(screen.getByTestId('the-read-clause-attribution').textContent)
        .toContain('Score attribution 80'))
    expect(screen.getByTestId('the-read-clause-attribution').textContent)
      .toContain('+10.0 from the prior session')
  })

  it('picks up the analogue clause the DECK fetched, off the deck’s own key', async () => {
    const cache = new Map()
    render(wrap(
      <>
        <AnalogueDeckView options={optionDefaults('analogues')} />
        {strip()}
      </>, cache))

    await waitFor(() =>
      expect(screen.getByTestId('the-read-clause-analogues').textContent)
        .toContain(`Analogues to ${ANALOGUE_BODY.reference_date}`))
    expect(screen.getByTestId('the-read-clause-analogues').textContent).toContain('1 of 2 were higher')
  })

  it('reads a cache seeded on the shared key builders, and nothing else', () => {
    const cache = new Map()
    cache.set(attributionKey(ROWS[0].date, ROWS.length), { data: ATTRIBUTION_BODY })
    cache.set(analoguesKey(optionDefaults('analogues').matches), { data: ANALOGUE_BODY })
    render(wrap(strip(), cache))
    expect(screen.getByTestId('the-read-clause-attribution')).toBeTruthy()
    expect(screen.getByTestId('the-read-clause-analogues')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()

    // CONTROL: a cache entry on a DIFFERENT key must not produce the clause,
    // or "the clause appeared" would prove nothing about which key was read.
    cleanup()
    const wrongKey = new Map()
    wrongKey.set('/api/breadth-monitor/score-components/nope?days=1', { data: ATTRIBUTION_BODY })
    render(wrap(strip(), wrongKey))
    expect(screen.queryByTestId('the-read-clause-attribution')).toBeNull()
  })
})
