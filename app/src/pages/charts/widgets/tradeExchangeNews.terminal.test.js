// News terminal upgrade — the pure model: category filters (AND with the others),
// related-headline grouping, feed health, presets and the calendar-day helpers.
// Synthetic headlines only.
import { describe, expect, it } from 'vitest'
import {
  addDays, archiveTitle, CATEGORY_FILTERS, categoriesLabel, cleanCategories, cleanPresets, cleanTime, dayCmp, dayLabel,
  dayRequest, dayStatus, etDateKey, feedHealth, groupRelated, GROUP_WINDOW_MS, MAX_PRESETS, mergeDay, monthGrid,
  presetPatch, presetSnapshot, relatedHeadlines, timeLabel, visibleItems,
} from './tradeExchangeNewsModel'
import * as model from './tradeExchangeNewsModel'
import { mergeTxnWidgetSettings, txnClampLines } from './tradeExchangeNewsSettings'

const NOW = 1_800_000_000_000
const H = (seq, content, extra = {}) => ({ seq, content, tickers: [], category: 'News', source: 'TX-News',
  received_at_ms: NOW - (100 - seq) * 1000, delayed: false, ...extra })

describe('category filters', () => {
  const items = [H(1, 'a', { category: 'Earnings', tickers: ['AAA'] }), H(2, 'b', { category: 'Macro' }),
    H(3, 'c', { category: 'Earnings', tickers: ['BBB'] }), H(4, 'd', { category: undefined }), H(5, 'e')]

  it('filters by one or several categories, newest first; empty = all', () => {
    expect(visibleItems(items, { categories: ['Earnings'] }).map((i) => i.seq)).toEqual([3, 1])
    expect(visibleItems(items, { categories: ['Earnings', 'Macro'] }).map((i) => i.seq)).toEqual([3, 2, 1])
    expect(visibleItems(items, { categories: [] }).map((i) => i.seq)).toEqual([5, 4, 3, 2, 1])
    expect(visibleItems(items, { categories: CATEGORY_FILTERS }).length).toBe(5)
  })

  it('a headline without a category counts as Other', () => {
    expect(visibleItems(items, { categories: ['Other'] }).map((i) => i.seq)).toEqual([4])
  })

  it('combines with search, linked symbol and watchlist by AND', () => {
    expect(visibleItems(items, { categories: ['Earnings'], linkedSym: 'BBB' }).map((i) => i.seq)).toEqual([3])
    expect(visibleItems(items, { categories: ['Earnings'], watchSet: new Set(['AAA']) }).map((i) => i.seq)).toEqual([1])
    expect(visibleItems(items, { categories: ['Earnings'], query: 'zzz' })).toEqual([])
    expect(visibleItems(items, { categories: ['Macro'], linkedSym: 'BBB' })).toEqual([])
  })

  it('cleans saved selections and labels them compactly', () => {
    expect(cleanCategories(['Macro', 'bogus', 'News'])).toEqual(['News', 'Macro'])
    expect(cleanCategories('x')).toEqual([])
    expect(categoriesLabel([])).toBe('All')
    expect(categoriesLabel(['Macro'])).toBe('Macro')
    expect(categoriesLabel(['Macro', 'Earnings', 'Price'])).toBe('3 types')
  })
})

describe('settings', () => {
  it('the inline % change is retired: no helper, no setting, a saved value is dropped', () => {
    expect(model.pctText).toBeUndefined()
    expect(mergeTxnWidgetSettings({ showPct: 'on' })).not.toHaveProperty('showPct')
    expect(mergeTxnWidgetSettings({})).not.toHaveProperty('showPct')
  })

  it('long-headline setting: 3 lines by default, 5, or always expanded', () => {
    expect(txnClampLines(mergeTxnWidgetSettings({}))).toBe(3)
    expect(txnClampLines(mergeTxnWidgetSettings({ longHeadlines: '5' }))).toBe(5)
    expect(txnClampLines(mergeTxnWidgetSettings({ longHeadlines: 'all' }))).toBe(0)
    expect(txnClampLines(mergeTxnWidgetSettings({ longHeadlines: 7 }))).toBe(3)
  })
})

describe('impact marks are retired', () => {
  it('no helper, no setting, no preset key', () => {
    expect(model.impactMark).toBeUndefined()
    expect(model.IMPACT_CRITERIA).toBeUndefined()
    expect(mergeTxnWidgetSettings({ impactMarks: 'on' })).not.toHaveProperty('impactMarks')
    expect(model.PRESET_SETTING_KEYS).not.toContain('impactMarks')
  })
})

describe('related-headline grouping', () => {
  const story = 'Example Corp agrees to sell its cloud unit to Sample Holdings for $2 billion'
  it('groups the same story re-sent in near-identical words', () => {
    const a = H(1, story, { tickers: ['EXMP'] })
    const b = H(2, `EXMP - ${story}`, { tickers: ['EXMP'], source: 'TX-PressRelease' })
    expect(relatedHeadlines(a, b)).toBe(true)
    const g = groupRelated([b, a])
    expect(g).toHaveLength(1)
    expect(g[0].lead.seq).toBe(2)
    expect(g[0].rest.map((i) => i.seq)).toEqual([1])
    expect(g[0].key).toBe(1)                       // the OLDEST seq: stable as updates join
  })

  it('never merges boilerplate from different companies', () => {
    const a = H(1, 'AAAA - Alpha Bancorp, Inc. Announces Third Quarter 2026 Results', { tickers: ['AAAA'] })
    const b = H(2, 'BBBB - Bravo Bancorp, Inc. Announces Third Quarter 2026 Results', { tickers: ['BBBB'] })
    expect(relatedHeadlines(a, b)).toBe(false)
    expect(groupRelated([b, a])).toHaveLength(2)
  })

  it('never merges merely on a shared ticker or a shared topic', () => {
    const a = H(1, 'NVDA shares rise after the chip export ruling', { tickers: ['NVDA'] })
    const b = H(2, 'NVDA announces a new data-center partnership in Japan', { tickers: ['NVDA'] })
    expect(relatedHeadlines(a, b)).toBe(false)
    const c = H(3, 'FED HOLDS RATES STEADY AT 4.25%-4.50%')
    const d = H(4, 'POWELL: WE ARE WELL POSITIONED TO WAIT FOR MORE CLARITY')
    expect(relatedHeadlines(c, d)).toBe(false)
  })

  it('short lines and stories outside the window stay apart', () => {
    expect(relatedHeadlines(H(1, 'GOOGL lows'), H(2, 'GOOGL lows'))).toBe(false)
    const a = H(1, story, { received_at_ms: NOW - GROUP_WINDOW_MS - 1000 })
    const b = H(2, story, { received_at_ms: NOW })
    expect(groupRelated([b, a])).toHaveLength(2)
  })

  it('keeps every headline, in order, and is bounded on a large history', () => {
    const items = []
    for (let i = 1; i <= 1000; i++) items.push(H(i, `Story number ${i} about topic ${i % 7} with detail ${i * 3}`, { received_at_ms: NOW + i * 1000 }))
    items.push(H(1001, items[999].content, { received_at_ms: NOW + 1001 * 1000 }))
    const newestFirst = [...items].reverse()
    const t0 = performance.now()
    const g = groupRelated(newestFirst)
    const ms = performance.now() - t0
    expect(g.reduce((n, x) => n + 1 + x.rest.length, 0)).toBe(1001)
    expect(g[0].lead.seq).toBe(1001)
    expect(g[0].rest.map((i) => i.seq)).toEqual([1000])
    for (let i = 1; i < g.length; i++) expect(g[i - 1].lead.seq).toBeGreaterThan(g[i].lead.seq)
    expect(ms).toBeLessThan(250)
  })
})

describe('feed health', () => {
  const by = (lines) => Object.fromEntries(lines.map((l) => [l.key, l]))
  it('separates UCT connection from provider freshness and never invents latency', () => {
    const l = by(feedHealth({ status: 'live', items: [H(1, 'a', { received_at_ms: NOW - 120_000 })], lastSeq: 1, replayUntil: 1 }, NOW))
    expect(l.connection.value).toMatch(/Connected/)
    expect(l.latest.value).toMatch(/2m ago · received by UCT/)
    expect(l.provider.value).toMatch(/does not mean Trade Exchange is publishing/)
    expect(l.sync.value).toBe('Caught up')
    expect(l.latency.value).toMatch(/Not measured yet/)
    expect(l.gaps.value).toBe('None known')
    expect(l.recovery.value).toMatch(/No recovered/)
  })

  it('reports replay, recovery, gaps and a real latency sample', () => {
    const l = by(feedHealth({ status: 'live', lastSeq: 40, replayUntil: 55,
      items: [H(1, 'a', { delayed: true }), H(2, 'b', { delayed: true })],
      coverage: { gaps: [{ from_ms: NOW - 3_600_000, to_ms: NOW - 3_000_000, reason: 'journal_unreachable' }] },
      lastLatencyMs: 1240, lastLatencyAt: NOW - 30_000 }, NOW))
    expect(l.sync.value).toMatch(/Replaying missed headlines/)
    expect(l.sync.tone).toBe('warn')
    expect(l.recovery.value).toMatch(/^2 loaded headlines .* were recovered/)
    expect(l.gaps.tone).toBe('warn')
    expect(l.latency.value).toBe('1.2 s from UCT receipt to this screen · measured 30s ago')
  })

  it('reconnecting is said plainly', () => {
    const l = by(feedHealth({ status: 'reconnecting', items: [] }, NOW))
    expect(l.connection.tone).toBe('warn')
    expect(l.sync.value).toMatch(/Reconnecting/)
    expect(l.latest.value).toBe('None received yet')
  })
})

describe('presets', () => {
  const settings = mergeTxnWidgetSettings({ bg: '#123456', longHeadlines: '5', groupRelated: 'on' })
  it('snapshots filters and display preferences only', () => {
    const snap = presetSnapshot({ categories: ['Macro'], linked: true, watchlistId: 'wl1' }, settings, 'fed')
    expect(snap).toEqual({ categories: ['Macro'], linked: true, watchlistId: 'wl1', query: 'fed',
      settings: { longHeadlines: '5', groupRelated: 'on' } })
  })

  it('applying never touches colours, chart symbols or other settings', () => {
    const patch = presetPatch(settings, { id: 'p1', categories: ['Earnings'], linked: false, watchlistId: '',
      settings: { longHeadlines: 'all', bg: '#ff0000', symbol: 'TSLA', showPct: 'on' } })
    expect(patch.categories).toEqual(['Earnings'])
    expect(patch.presetId).toBe('p1')
    expect(patch.watchlistId).toBeNull()
    expect(patch.settings.longHeadlines).toBe('all')
    expect(patch.settings.bg).toBe('#123456')
    expect(patch.settings.symbol).toBeUndefined()
    expect(patch.settings.showPct).toBeUndefined()                // an old preset's retired setting
    expect(Object.keys(patch).sort()).toEqual(['categories', 'linked', 'presetId', 'settings', 'watchlistId'])
  })

  it('tolerates garbled saved presets and caps the count', () => {
    expect(cleanPresets(null)).toEqual([])
    expect(cleanPresets([{ id: 'a', name: ' ' }, { id: 1, name: 'x' }, { id: 'b', name: 'Macro' }])).toEqual([{ id: 'b', name: 'Macro' }])
    expect(cleanPresets(Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })))).toHaveLength(MAX_PRESETS)
  })
})

describe('calendar days', () => {
  // Late October 2026 is EDT (UTC-4); Nov 1 2026 falls back to EST (UTC-5).
  const ET = (m, d, h, min = 0, off = 4) => Date.UTC(2026, m - 1, d, h + off, min)

  it('a request carries every filter', () => {
    expect(dayRequest({ query: '  fed ', linkedSym: 'NVDA', watchSet: new Set(['MSFT', 'AMD']), categories: ['Macro', 'bogus'], hidePlaceholders: true }))
      .toEqual({ query: 'fed', categories: ['Macro'], symbol: 'NVDA', symbols: ['AMD', 'MSFT'], hide_placeholders: true })
    expect(dayRequest({})).toEqual({ query: '', categories: [], symbol: null, symbols: null, hide_placeholders: false })
  })

  it('dates are New York calendar dates, across midnight and DST', () => {
    expect(etDateKey(ET(10, 30, 0, 0))).toBe('2026-10-30')
    expect(etDateKey(ET(10, 30, 0, 0) - 1)).toBe('2026-10-29')                   // 11:59:59.999 PM the day before
    expect(etDateKey(ET(10, 30, 23, 59))).toBe('2026-10-30')
    expect(etDateKey(ET(11, 1, 23, 30, 5))).toBe('2026-11-01')                     // EST after fall-back
    expect(etDateKey(ET(11, 2, 0, 0, 5))).toBe('2026-11-02')
    expect(etDateKey(Date.UTC(2026, 9, 31, 2, 0))).toBe('2026-10-30')             // 02:00 UTC = 10 PM ET
  })

  it('date arithmetic, labels and times', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')                           // a 25-hour day is still one date
    expect(dayLabel('2026-10-30', '2026-10-30')).toBe('Fri, Oct 30')
    expect(dayLabel('2025-12-31', '2026-01-02')).toBe('Wed, Dec 31, 2025')
    expect(timeLabel('09:30')).toBe('9:30 AM')
    expect(timeLabel('00:05')).toBe('12:05 AM')
    expect(timeLabel('16:00')).toBe('4:00 PM')
    expect(cleanTime('9:30')).toBe('09:30')
    for (const bad of ['24:00', '9:60', '930', '', 'noon']) expect(cleanTime(bad)).toBeNull()
  })

  it('a month grid is six Sunday-first weeks', () => {
    const g = monthGrid(2026, 9)                                                   // October 2026
    expect(g).toHaveLength(42)
    expect(g[0]).toEqual({ key: '2026-09-27', inMonth: false })
    expect(g.find((c) => c.key === '2026-10-01').inMonth).toBe(true)
    expect(g.filter((c) => c.inMonth)).toHaveLength(31)
  })

  it('availability is only what the server reports', () => {
    const meta = { today: '2026-10-30', first_day: '2026-10-24', days: [{ date: '2026-10-26', count: 200 }] }
    expect(dayStatus('2026-10-31', meta).kind).toBe('future')
    expect(dayStatus('2026-10-23', meta).kind).toBe('unretained')
    expect(dayStatus('2026-10-26', meta)).toEqual({ kind: 'news', count: 200 })
    expect(dayStatus('2026-10-27', meta)).toEqual({ kind: 'empty', count: 0 })
    expect(dayStatus('2026-10-27', null).kind).toBe('unknown')
  })

  it('the day order is (received, seq) newest first; live rows merge only beside what is loaded', () => {
    const at = (h) => ET(10, 30, h)
    const srv = [H(10, 'a', { received_at_ms: at(12) }), H(9, 'b', { received_at_ms: at(11) })]
    const pool = [H(12, 'live', { received_at_ms: at(13) }), H(11, 'tie', { received_at_ms: at(12) }),
      H(9, 'b', { received_at_ms: at(11), repeat_count: 2 }), H(8, 'old', { received_at_ms: at(9) }),
      H(13, 'yesterday', { received_at_ms: ET(10, 29, 22) })]
    expect([...srv, ...pool].sort(dayCmp).map((i) => i.seq)).toEqual([12, 11, 10, 9, 9, 8, 13])
    expect(mergeDay(srv, pool, { dateKey: '2026-10-30' }).map((i) => i.seq)).toEqual([12, 11, 10, 9, 8])
    expect(mergeDay(srv, pool, { dateKey: '2026-10-30' }).find((i) => i.seq === 9).repeat_count).toBe(2)
    expect(mergeDay(srv, pool, { dateKey: '2026-10-30', hasNewer: true, hasOlder: true }).map((i) => i.seq)).toEqual([10, 9])
    expect(mergeDay(srv, pool, { dateKey: '2026-10-29' }).map((i) => i.seq)).toEqual([10, 9, 13])
  })

  it('the archive note states the real reach and the retention bound', () => {
    expect(archiveTitle(NOW - 3 * 86_400_000, NOW)).toMatch(/^The retained archive reaches back to .+\. UCT keeps about 7 days of headlines, up to 5,000; nothing older is available\.$/)
    expect(archiveTitle(null, NOW)).toMatch(/empty so far/)
  })
})
