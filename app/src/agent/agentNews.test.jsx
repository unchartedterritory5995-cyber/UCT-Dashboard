// news.latest / news.catalysts — UCT's own stored news and catalyst history. Fixture
// payloads are the real routes' shapes (api/routers/company_news.py `_shape`,
// api/routers/catalysts.py history entries).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { manifestFor, getCapability } from './capabilities'
import { registerBuiltins } from './builtins'

registerBuiltins()
const iso = (daysAgo, h = 14) => new Date(Date.now() - daysAgo * 86400000 + h * 0).toISOString()
let calls, news, cats, status
beforeEach(() => {
  calls = []; status = 200
  news = { NVDA: [
    { id: 1, headline: 'NVIDIA unveils new data-center chip', source: 'Reuters', url: 'https://r/1', published_at: iso(0.1), sentiment: 'bullish', category: 'product' },
    { id: 2, headline: 'Analyst trims NVDA target', source: 'Benzinga', url: 'https://b/2', published_at: iso(1), sentiment: 'bearish', category: 'analyst' },
  ], OLDCO: [{ id: 3, headline: 'Old news', source: 'PR Newswire', url: '', published_at: iso(40), sentiment: '' }] }
  cats = { AMD: [{ market_date: '2026-10-06', tag: 'earnings beat', catalyst_type: 'earnings', grade: 'A', gap_pct: 7.25, thesis_text: 'Beat and raise on data-center demand.' }] }
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url); calls.push(u)
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    if (status !== 200) return json({ detail: 'Payment required' }, status)
    let m = /^\/api\/company-news\/([^?]+)/.exec(u)
    if (m) return json({ symbol: m[1], items: news[m[1]] || [], has_more: false })
    m = /^\/api\/catalysts\/history\/(.+)$/.exec(u)
    if (m) return json({ ticker: m[1], entries: cats[m[1]] || [] })
    return json({})
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('news.latest', () => {
  it('headlines from UCT\'s own feed, each with its ET time, source and tone; the newest time is stated', async () => {
    const a = await getCapability('news.latest').answer(null, { symbol: 'nvda', limit: null })
    expect(calls).toEqual(['/api/company-news/NVDA?limit=8'])
    expect(a.text).toMatch(/^Latest 2 headlines UCT has for NVDA \(newest .* ET\)\.\nSource: UCT's news feed/)
    expect(a.table.rows[0]).toMatchObject({ headline: 'NVIDIA unveils new data-center chip', source: 'Reuters', tone: 'bullish' })
    expect(a.table.rows[0].when).toMatch(/ ET$/)
  })
  it('STALE data is said to be old, never presented as breaking', async () => {
    const a = await getCapability('news.latest').answer(null, { symbol: 'OLDCO', limit: 5 })
    expect(a.text).toMatch(/note: the newest is 40 days old, so this is not breaking news\./)
  })
  it('empty, unpaid, bad input — each said plainly; limit is capped', async () => {
    expect((await getCapability('news.latest').answer(null, { symbol: 'ZZZQ', limit: null })).text).toBe('UCT has no stored news for ZZZQ.')
    expect(await getCapability('news.latest').answer(null, { symbol: 'not a ticker', limit: null })).toMatch(/doesn't look like a ticker/)
    await getCapability('news.latest').answer(null, { symbol: 'NVDA', limit: 500 })
    expect(calls.at(-1)).toBe('/api/company-news/NVDA?limit=15')
    status = 402
    expect(await getCapability('news.latest').answer(null, { symbol: 'NVDA', limit: null })).toBe('News and catalysts need a paid UCT plan.')
  })
})

describe('news.catalysts', () => {
  it('the engine\'s recorded catalysts: date, type/tag, grade, gap, thesis', async () => {
    const a = await getCapability('news.catalysts').answer(null, { symbol: 'AMD' })
    expect(calls).toEqual(['/api/catalysts/history/AMD'])
    expect(a.text).toMatch(/flagged AMD on 1 day; .*newest Oct 6, 2026/)
    expect(a.table.rows[0]).toEqual({ date: 'Oct 6, 2026', what: 'earnings · earnings beat', grade: 'A', gap: '+7.3%', thesis: 'Beat and raise on data-center demand.' })
  })
  it('none recorded → said honestly, pointing to the next-earnings question (no invented events)', async () => {
    expect(await getCapability('news.catalysts').answer(null, { symbol: 'TSLA' })).toMatch(/never flagged TSLA .* ask when TSLA reports/)
  })
})

describe('routing contract', () => {
  it('both are read-only queries on the stock-data target; no model, research or generation route is ever called', async () => {
    for (const n of ['news.latest', 'news.catalysts']) expect(getCapability(n)).toMatchObject({ query: true, target: 'market' })
    expect(manifestFor({ surface: 'charts' }).map(c => c.name)).toEqual(expect.arrayContaining(['news.latest', 'news.catalysts']))
    await getCapability('news.latest').answer(null, { symbol: 'NVDA', limit: null })
    await getCapability('news.catalysts').answer(null, { symbol: 'AMD' })
    expect(calls.some(u => /agent|news-catalysts|explain|perplexity/.test(u))).toBe(false)
  })
})
