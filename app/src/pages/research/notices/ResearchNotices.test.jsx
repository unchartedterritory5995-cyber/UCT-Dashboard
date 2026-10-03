// Lane R — the Research notices under the header (D-9, D-11, D-12), asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import ResearchNotices, { interestReasons } from './ResearchNotices'
import { readResearchNotices, RESEARCH_NOTICE_KEYS } from './researchNoticeFlags'

let replies
beforeEach(() => {
  replies = {}
  global.fetch = vi.fn((url) => {
    const r = Object.entries(replies).find(([k]) => url.startsWith(k))
    if (!r) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    const [status, body] = r[1]
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const ALL = { member_interest_line_enabled: true, entity_rename_notice_enabled: true, metric_disagreement_enabled: true }
const renderIt = (flags, sym = 'meta') => render(
  <MemoryRouter>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ResearchNotices sym={sym} flags={flags} />
    </SWRConfig>
  </MemoryRouter>,
)

describe('flags', () => {
  it('reads each key strictly === true and absent as false', () => {
    expect(readResearchNotices({ entity_rename_notice_enabled: 'yes' }).entity_rename_notice_enabled).toBe(false)
    expect(readResearchNotices(null)).toEqual(Object.fromEntries(RESEARCH_NOTICE_KEYS.map((k) => [k, false])))
  })
  it('with every flag off nothing renders and nothing is requested', () => {
    renderIt({})
    expect(screen.queryByTestId('research-notices')).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('D-9 member interest line', () => {
  it('says why the ticker is already the member’s, from the route’s own because[]', async () => {
    replies['/api/member/interest'] = [200, { entities: { META: { weight: 5, because: ['watchlist', 'positions'] } } }]
    renderIt({ member_interest_line_enabled: true })
    const line = await screen.findByTestId('member-interest-line')
    expect(line.textContent).toContain('META is on your watchlists · in your open Journal positions.')
  })
  it('never says "not on your watchlist": a ticker absent from the answer renders nothing', async () => {
    replies['/api/member/interest'] = [200, { entities: { NVDA: { weight: 2, because: ['watchlist'] } } }]
    renderIt({ member_interest_line_enabled: true })
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('member-interest-line')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/not on your/i)
  })
  it('an unknown source is shown by its own name, never dropped', () => {
    expect(interestReasons({ X: { because: ['tags'] } }, 'X')).toEqual(['tags'])
  })
})

describe('D-11 rename notice', () => {
  it('the current holder says what it formerly traded as', async () => {
    replies['/api/research/rename-notice/META'] = [200, {
      sym: 'META', state: 'ok', source: 'UCT Entity Master',
      current: { entity_id: 'e1', ambiguous: false, formerly: [{ alias: 'FB', valid_from: '2012-05-18', valid_to: '2022-06-09' }] },
      previous_holders: [] }]
    renderIt({ entity_rename_notice_enabled: true })
    const el = await screen.findByTestId('rename-formerly')
    expect(el.textContent).toContain('META formerly traded as FB (2012-05-18 to 2022-06-09).')
  })
  it('an old ticker links to what the company trades as now', async () => {
    replies['/api/research/rename-notice/FB'] = [200, {
      sym: 'FB', state: 'ok', source: 'UCT Entity Master', current: null,
      previous_holders: [{ entity_id: 'e1', held_from: '2012-05-18', held_to: '2022-06-09',
        now_trades_as: [{ alias: 'META', valid_from: '2022-06-09' }], lifecycle_state: 'active', lifecycle_since: null }] }]
    renderIt({ entity_rename_notice_enabled: true }, 'FB')
    const el = await screen.findByTestId('rename-previous')
    expect(el.textContent).toContain('belonged to a company that now trades as META.')
    expect(screen.getByRole('link', { name: 'META' }).getAttribute('href')).toBe('/research/META')
  })
  it('a reused ticker names the old holder as delisted and the current one as different', async () => {
    replies['/api/research/rename-notice/GM'] = [200, {
      sym: 'GM', state: 'ok', source: 's', current: { entity_id: 'new', ambiguous: false, formerly: [] },
      previous_holders: [{ entity_id: 'old', held_from: '1990-01-01', held_to: '2009-06-01', now_trades_as: [],
        lifecycle_state: 'delisted', lifecycle_since: '2009-06-01' }] }]
    renderIt({ entity_rename_notice_enabled: true }, 'GM')
    const el = await screen.findByTestId('rename-previous')
    expect(el.textContent).toContain('no longer trades under any ticker we hold (delisted 2009-06-01). Today GM is a different company.')
  })
  it('a store that could not be read renders nothing, not a notice', async () => {
    replies['/api/research/rename-notice/META'] = [200, { sym: 'META', state: 'store_unavailable', current: null, previous_holders: [], reason: 'x' }]
    renderIt({ entity_rename_notice_enabled: true })
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('rename-notice')).not.toBeInTheDocument()
  })
})

const MD = {
  sym: 'META', counts: { agree: 1, disagree: 1, cannot_compare: 1 },
  sides: { research: { state: 'ok', source: 'yf' }, screener: { state: 'ok', source: 'fmp', bars_asof: '2026-10-01' } },
  pairs: [
    { key: 'market_cap', label: 'Market cap', research: 1.02e12, screener: 1.0e12, gap_pct: 2.0, tolerance_pct: 5, verdict: 'agree', missing: [] },
    { key: 'pe_trailing', label: 'P/E (trailing)', research: 36, screener: 30, gap_pct: 16.7, tolerance_pct: 10, verdict: 'disagree', missing: [] },
    { key: 'pb', label: 'Price / book', research: null, screener: 5, gap_pct: null, tolerance_pct: 10, verdict: 'cannot_compare', missing: ['research'] },
  ],
}

describe('D-12 metric disagreement', () => {
  it('names how many figures disagree and shows both values with the tolerance on demand', async () => {
    replies['/api/research/metric-disagreement/META'] = [200, MD]
    renderIt({ metric_disagreement_enabled: true })
    const el = await screen.findByTestId('metric-disagreement')
    expect(el.textContent).toContain('Our two sources disagree on 1 of 3 figures for META.')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    const rows = screen.getAllByTestId('disagreement-row')
    expect(rows[1].textContent).toContain('36.00')
    expect(rows[1].textContent).toContain('30.00')
    expect(rows[1].textContent).toContain('16.7%')
    expect(rows[1].textContent).toContain('DISAGREE')
    expect(rows[2].textContent).toContain('cannot compare (no research value)')
  })
  it('nothing disagreeing renders nothing', async () => {
    replies['/api/research/metric-disagreement/META'] = [200, { ...MD, counts: { agree: 2, disagree: 0, cannot_compare: 1 } }]
    renderIt({ metric_disagreement_enabled: true })
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('metric-disagreement')).not.toBeInTheDocument()
  })
  it('a check that could not run says so instead of looking like agreement', async () => {
    replies['/api/research/metric-disagreement/META'] = [500, {}]
    renderIt({ metric_disagreement_enabled: true })
    expect(await screen.findByTestId('disagreement-unavailable')).toBeInTheDocument()
  })
})

describe('container', () => {
  it('renders all three when all are on', async () => {
    replies['/api/member/interest'] = [200, { entities: { META: { because: ['flagged'] } } }]
    replies['/api/research/rename-notice/META'] = [200, { sym: 'META', state: 'ok', source: 's',
      current: { entity_id: 'e', ambiguous: false, formerly: [{ alias: 'FB', valid_from: 'a', valid_to: 'b' }] }, previous_holders: [] }]
    replies['/api/research/metric-disagreement/META'] = [200, MD]
    renderIt(ALL)
    expect(await screen.findByTestId('member-interest-line')).toBeInTheDocument()
    expect(await screen.findByTestId('rename-formerly')).toBeInTheDocument()
    expect(await screen.findByTestId('metric-disagreement')).toBeInTheDocument()
  })
})
