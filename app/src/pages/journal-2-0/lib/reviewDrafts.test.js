import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildDraftBlocks, reviewDraftsEnabled, fetchDailyDraft, fetchWeeklyDraft, fetchMonthlyDraft,
  draftWeeklyReview, draftMonthlyReview, draftDailyReview, mondayOfIso,
} from './reviewDrafts'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'

// ── fixtures: known n and dollars, mirroring the backend's own enriched-trade /
// finding shape (api/services/journal_two/leak_finder.py's `_finding`). ──────────────

function mkTrade(over = {}) {
  return {
    id: 't1', tradeRef: 'id:t1', symbol: 'NVDA', exitDate: '2026-09-28T19:00:00+00:00',
    pnlDollar: -101, rMultiple: -1.0, ...over,
  }
}

const AGGREGATES = {
  trade_count: 5, wins: 2, losses: 3, bes: 0, win_rate: 0.4, avg_r: -0.2,
  net_pnl_dollar: -123.45, profit_factor: 0.8,
}

const DISCIPLINE = {
  plannedCount: 4, unplannedCount: 1, needsPickCount: 0,
  planRate: { k: 4, n: 5, rate: 0.8, band: 'too_few', wording: 'too few to judge', range: null },
  entry: { k: 3, n: 4, rate: 0.75, band: 'too_few', wording: 'too few to judge', range: null },
  stop: { k: 4, n: 4, rate: 1, band: 'too_few', wording: 'too few to judge', range: null },
  size: { k: 4, n: 4, rate: 1, band: 'too_few', wording: 'too few to judge', range: null },
  targetHitRate: { k: 1, n: 3, rate: 0.33, band: 'too_few', wording: 'too few to judge', range: null },
}

function fixturePayload(overrides = {}) {
  return {
    period: 'weekly',
    range: { start: '2026-09-28', end: '2026-10-02' },
    tradeCount: 5,
    aggregates: AGGREGATES,
    discipline: DISCIPLINE,
    setupChanges: [
      { setup: 'Breakout', periodTradeCount: 3, periodAvgRStat: { n: 3, mean: -0.4, band: 'too_few', wording: 'too few to judge', range: null }, allTimeAvgR: 0.6, allTimeAvgRStat: {}, delta: -1.0 },
    ],
    bestTrade: { id: 'tb', tradeRef: 'id:tb', symbol: 'AAPL', side: 'Long', entryDate: '2026-09-29T14:30:00+00:00', exitDate: '2026-09-29T19:00:00+00:00', entryPrice: 100, exitPrice: 110, rMultiple: 2.0, pnlDollar: 500 },
    worstTrade: { id: 'tw', tradeRef: 'id:tw', symbol: 'TSLA', side: 'Long', entryDate: '2026-09-30T14:30:00+00:00', exitDate: '2026-09-30T19:00:00+00:00', entryPrice: 200, exitPrice: 190, rMultiple: -1.0, pnlDollar: -200 },
    links: {
      plans: [{ noteId: 'n1', noteTitle: 'NVDA plan', symbol: 'NVDA', tradeRef: 'id:t1' }],
      reviews: [{ noteId: 'n2', title: 'Last week’s review', updatedAt: '2026-09-21T00:00:00Z', tag: 'weekly-review' }],
      resurfaced: [],
    },
    leaks: [
      {
        kind: 'revenge_reentry', label: 'Revenge re-entries',
        sample: { n: 1, mean: -1.0, band: 'too_few', wording: 'too few to judge', range: null },
        dollarImpact: { netPnl: -101, avgR: -1.0, baselineAvgR: -0.2, baselineAvgNetPnlPerTrade: -24.69 },
        trades: [mkTrade()],
        detail: {},
      },
      {
        kind: 'unplanned_trades', label: 'Unplanned trades',
        sample: { n: 12, mean: -0.5, band: 'normal', wording: null, range: null },
        dollarImpact: { netPnl: -600, avgR: -0.5, baselineAvgR: -0.2, baselineAvgNetPnlPerTrade: -24.69 },
        trades: Array.from({ length: 12 }, (_, i) => mkTrade({ id: `u${i}`, tradeRef: `id:u${i}`, symbol: 'SPY', pnlDollar: -50 })),
        detail: {},
      },
    ],
    compassText: { text: 'You traded your plan well this week.', kind: 'weekly_review', createdAt: '2026-10-02T00:00:00Z' },
    baseline: { n: 5, avgR: -0.2, avgNetPnlPerTrade: -24.69 },
    sample: { tooFewBelow: 10, normalFrom: 25, rangeZ: 1.96, wording: { too_few: 'too few to judge', thin: 'thin sample', normal: null } },
    ...overrides,
  }
}

function flattenText(node, out = []) {
  if (!node) return out
  if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
  if (Array.isArray(node.content)) node.content.forEach((c) => flattenText(c, out))
  return out
}

function allText(blocks) {
  return blocks.map((b) => flattenText(b).join('')).join(' | ')
}

describe('buildDraftBlocks — structure', () => {
  it('renders the numbers section from the authority’s own aggregate fields, not recomputed', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('-$123.45')          // net_pnl_dollar, verbatim
    expect(text).toContain('40%')                // win_rate 0.4
  })

  it('words the discipline record by its own sample (R3): too_few shows wording, no bare number', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('too few to judge')
  })

  it('renders setup changes with the period AND the all-time baseline side by side', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('Breakout')
    expect(text).toContain('+0.60R')   // allTimeAvgR
  })

  it('links section lists the real plan/review notes as anchors, and says so plainly when empty', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const text = allText(blocks)
    expect(text).toContain('NVDA plan')
    expect(text).toContain('Nothing resurfaced this period.')
  })

  it('charts best and worst trade as frozen widgetEmbed nodes, anchored to the exit', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const charts = blocks.filter((b) => b.type === 'widgetEmbed')
    expect(charts).toHaveLength(2)
    expect(charts.map((c) => c.attrs.params.symbol)).toEqual(['AAPL', 'TSLA'])
    // frozen, never the live/rolling window
    expect(charts.every((c) => c.attrs.mode === 'snapshot')).toBe(true)
    // no live-workspace drawings bleed into a frozen review chart
    expect(charts.every((c) => Array.isArray(c.attrs.annotations) && c.attrs.annotations.length === 0)).toBe(true)
  })

  it('quotes Compass only when the payload carries one, as a G-064 askInsert node (labelled AI)', () => {
    const withQuote = buildDraftBlocks(fixturePayload())
    expect(withQuote.some((b) => b.type === 'askInsert')).toBe(true)

    const without = buildDraftBlocks(fixturePayload({ compassText: null }))
    expect(without.some((b) => b.type === 'askInsert')).toBe(false)
  })
})

describe('buildDraftBlocks — leaks: the reveal, and the dollars', () => {
  it('a finding below n=10 is BEHIND THE REVEAL (a collapsed toggle)', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const toggles = blocks.filter((b) => b.type === 'toggle')
    const revenge = toggles.find((t) => flattenText(t).join('').includes('Revenge re-entries'))
    expect(revenge).toBeTruthy()
    expect(revenge.attrs.open).toBe(false)
  })

  it('a finding at n>=10 is shown plainly (open)', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const toggles = blocks.filter((b) => b.type === 'toggle')
    const unplanned = toggles.find((t) => flattenText(t).join('').includes('Unplanned trades'))
    expect(unplanned).toBeTruthy()
    expect(unplanned.attrs.open).toBe(true)
  })

  it('a finding’s rendered trade list sums to its own stated dollar figure', () => {
    const payload = fixturePayload()
    const finding = payload.leaks[1] // 12 trades, net -600 declared
    const sum = finding.trades.reduce((s, t) => s + t.pnlDollar, 0)
    // the fixture itself is internally consistent (mirrors the backend invariant);
    // the renderer must not alter the figure it was handed.
    expect(sum).toBeCloseTo(finding.dollarImpact.netPnl, 2)
    const blocks = buildDraftBlocks(payload)
    const text = allText(blocks)
    expect(text).toContain('-$600.00')
  })

  it('no leaks → a plain "none found" callout, never an empty section', () => {
    const blocks = buildDraftBlocks(fixturePayload({ leaks: [] }))
    expect(blocks.some((b) => b.type === 'callout')).toBe(true)
    expect(blocks.some((b) => b.type === 'toggle')).toBe(false)
  })

  it('each leak’s toggle body links every cited trade to its trade page', () => {
    const blocks = buildDraftBlocks(fixturePayload())
    const toggles = blocks.filter((b) => b.type === 'toggle')
    const revenge = toggles.find((t) => flattenText(t).join('').includes('Revenge re-entries'))
    const json = JSON.stringify(revenge)
    expect(json).toContain('/journal-2-0/trade/t1')
  })
})

describe('mondayOfIso', () => {
  it('a Wednesday resolves to that week’s Monday', () => {
    expect(mondayOfIso(new Date('2026-10-01T12:00:00Z'))).toBe('2026-09-28') // a Thursday->Monday
  })
  it('a Sunday resolves to the PRIOR Monday (not the next)', () => {
    expect(mondayOfIso(new Date('2026-10-04T12:00:00Z'))).toBe('2026-09-28')
  })
  it('a Monday resolves to itself', () => {
    expect(mondayOfIso(new Date('2026-09-28T12:00:00Z'))).toBe('2026-09-28')
  })
})

describe('reviewDraftsEnabled — the flag gate', () => {
  afterEach(() => __resetNotebookFlags())

  it('reads false before any payload has latched', () => {
    expect(reviewDraftsEnabled()).toBe(false)
  })

  it('reads true once a payload latches the flag on', () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    expect(reviewDraftsEnabled()).toBe(true)
  })
})

describe('fetch* — the query shape', () => {
  let calledUrl = null
  beforeEach(() => {
    calledUrl = null
    global.fetch = vi.fn((url) => {
      calledUrl = url
      return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload()) })
    })
  })

  it('fetchDailyDraft sends day and accountId as query params', async () => {
    await fetchDailyDraft({ day: '2026-10-02', accountId: 'acc1' })
    expect(calledUrl).toBe('/api/j2/review-drafts/daily?day=2026-10-02&accountId=acc1')
  })

  it('fetchWeeklyDraft omits accountId when absent', async () => {
    await fetchWeeklyDraft({ weekStart: '2026-09-28' })
    expect(calledUrl).toBe('/api/j2/review-drafts/weekly?weekStart=2026-09-28')
  })

  it('fetchMonthlyDraft hits the monthly route', async () => {
    await fetchMonthlyDraft({ month: '2026-09' })
    expect(calledUrl).toBe('/api/j2/review-drafts/monthly?month=2026-09')
  })

  it('a non-ok response throws rather than returning a falsy payload', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }))
    await expect(fetchDailyDraft({ day: '2026-10-02' })).rejects.toThrow()
  })
})

describe('draftWeeklyReview / draftMonthlyReview — land through the ONE create door', () => {
  let posted = null
  beforeEach(() => {
    posted = null
    global.fetch = vi.fn((url, opts) => {
      if (typeof url === 'string' && url.startsWith('/api/j2/review-drafts/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload()) })
      }
      if (url === '/api/j2/notes' && opts?.method === 'POST') {
        posted = JSON.parse(opts.body)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'new1' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  it('weekly: creates a note tagged weekly-review, titled from the catalog’s own format', async () => {
    const { note } = await draftWeeklyReview({ weekStart: '2026-09-28' })
    expect(note.id).toBe('new1')
    expect(posted.tags).toEqual(['weekly-review'])
    expect(posted.title).toMatch(/Weekly Review/)
    expect(posted.bodyJson.type).toBe('doc')
  })

  it('monthly: creates a note tagged monthly-review', async () => {
    const { note } = await draftMonthlyReview({ month: '2026-09' })
    expect(note.id).toBe('new1')
    expect(posted.tags).toEqual(['monthly-review'])
    expect(posted.title).toMatch(/Monthly Review/)
  })
})

describe('draftDailyReview — appends to the member’s OWN daily note, never a second note', () => {
  let putBody = null
  let putUrl = null
  beforeEach(() => {
    putBody = null
    putUrl = null
    global.fetch = vi.fn((url, opts) => {
      if (typeof url === 'string' && url.startsWith('/api/j2/review-drafts/daily')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(fixturePayload({ period: 'daily' })) })
      }
      if (url === '/api/j2/notes/daily' && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            note: {
              id: 'daily1', updatedAt: '2026-10-02T12:00:00Z',
              bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Morning plan' }] }] },
            },
            created: false,
          }),
        })
      }
      if (typeof url === 'string' && url.startsWith('/api/j2/notes/daily1') && opts?.method === 'PUT') {
        putUrl = url
        putBody = JSON.parse(opts.body)
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ note: { id: 'daily1', updatedAt: '2026-10-02T18:00:00Z', bodyJson: putBody.bodyJson } }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  it('PUTs the daily note with the CAS baseline it was just read at', async () => {
    const { note } = await draftDailyReview({ day: '2026-10-02' })
    expect(note.id).toBe('daily1')
    expect(putUrl).toBe('/api/j2/notes/daily1')
    expect(putBody.baseUpdatedAt).toBe('2026-10-02T12:00:00Z')
  })

  it('preserves the note’s existing content and APPENDS the recap after it', async () => {
    await draftDailyReview({ day: '2026-10-02' })
    const texts = flattenText(putBody.bodyJson)
    const morningIdx = texts.findIndex((t) => t.includes('Morning plan'))
    const recapIdx = texts.findIndex((t) => t.includes("Today's recap"))
    expect(morningIdx).toBeGreaterThanOrEqual(0)
    expect(recapIdx).toBeGreaterThan(morningIdx)
  })
})
