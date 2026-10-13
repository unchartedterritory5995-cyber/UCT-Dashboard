// The post-trade review block (Notebook P2b, Task 11; spec §P2 item 7, R-P2b-4, R-P2b-5, Review Focus 4).
// params { tradeId }: no trade -> a picker over the member's closed trades; a trade -> its card, the
// plan-vs-execution grade (or what it needs), the tags, and the pre-entry items that were NOT ticked.
//
// CONTRACT: every answer is the server's REAL one (`__fixtures__/contract`, written by
// tools/notebook_contract_fixtures.py): the trades list, the review, its no-grading and by-ref
// variants, the 404, and the plan grade for a graded trade. A variant moves one field by spread.
// ⛔ Copy is asserted as RENDERED DOM text after the read settles.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { contractBody, contractResponse } from '../../../__fixtures__/contract'
import { checkDetail, checkVerdict } from '../../../lib/planGradeText'
import { CHECKLIST_ACCOUNT_LINES } from '../../../lib/blocks/checklistItems'
import { BLOCK_ERROR_SENTENCE } from './blockStates'

// The checklist's labels come from the member's own settings (setupRules), read through the block's one
// read seam, which composes these three hooks (as PreEntryChecklistBlock.test.jsx mocks them).
const SETTINGS_FIXTURE = {
  setups: ['VCP'],
  setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] },
}
let SETTINGS = SETTINGS_FIXTURE
let SETTINGS_EXTRA = {}
let ACCOUNT_EXTRA = {}
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: SETTINGS, ...SETTINGS_EXTRA }) }))
vi.mock('../../../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', ...ACCOUNT_EXTRA }) }))
vi.mock('../../../hooks/useJournalRules', () => ({ default: () => ({ rules: [] }) }))

import TradeReviewBlock from './TradeReviewBlock'

const REVIEW = () => contractBody('trader-blocks.review')                  // unplanned, VCP, ticked s1
const NO_GRADING = () => contractBody('trader-blocks.review.no-grading')   // planGrade { needs }
const GONE = 'This trade is no longer in your journal.'

/** A fake server: the first route whose suffix ends the URL answers; anything else is a loud error. */
function serve(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    const hit = Object.entries(routes).find(([suffix]) => String(url).endsWith(suffix))
    if (!hit) throw new Error(`unexpected fetch ${url}`)
    return typeof hit[1] === 'function' ? hit[1]() : hit[1]
  })
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(body)) })

function renderBlock(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter>
        <TradeReviewBlock params={{}} setParams={vi.fn(() => true)} editable {...props} />
      </MemoryRouter>
    </SWRConfig>,
  )
}

beforeEach(() => { globalThis.fetch = vi.fn() })
afterEach(() => {
  vi.restoreAllMocks()
  SETTINGS = SETTINGS_FIXTURE
  SETTINGS_EXTRA = {}
  ACCOUNT_EXTRA = {}
})

describe('no trade picked', () => {
  it('picks a trade through setParams: the select lists the closed trades, newest first', async () => {
    serve({ '/review/trades': contractResponse('trader-blocks.review.trades') })
    const setParams = vi.fn(() => true)
    renderBlock({ setParams })
    const select = await screen.findByRole('combobox', { name: 'Trade to review' })
    expect(screen.getByRole('option', { name: 'NVDA · closed Oct 2 · Win' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'AMD · closed Sep 30 · Loss' })).toBeTruthy()
    // N15: what the note stores is the trade's STABLE ref, which survives a broker resync
    fireEvent.change(select, { target: { value: 'id:review-1' } })
    expect(setParams).toHaveBeenCalledWith({ tradeId: 'id:review-1' })
    fireEvent.change(select, { target: { value: 'ext:FP-REVIEW-2' } })
    expect(setParams).toHaveBeenLastCalledWith({ tradeId: 'ext:FP-REVIEW-2' })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)                       // the list only, no review read
  })

  it('a reader sees "No trade linked yet." and no picker, and nothing is read', () => {
    renderBlock({ editable: false })
    expect(screen.getByText('No trade linked yet.')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('no closed trades yet says so instead of an empty box', async () => {
    serve({ '/review/trades': json({ trades: [] }) })
    renderBlock()
    expect(await screen.findByText('You have no closed trades to review yet.')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('a list that cannot be read says so, and Try again reads it again', async () => {
    let ok = false
    serve({ '/review/trades': () => (ok ? contractResponse('trader-blocks.review.trades') : json({}, 500)) })
    renderBlock()
    expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
    ok = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('combobox', { name: 'Trade to review' })).toBeTruthy()
  })
})

describe('a trade is picked', () => {
  it('shows the card, what the grade needs, the tags and the unticked items', async () => {
    serve({ '/review/review-1': json(NO_GRADING()) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText(/NVDA/)).toBeTruthy()
    expect(screen.getByText('Entry 100.00 → exit 110.00 · +2.00R · closed Oct 2')).toBeTruthy()
    expect(screen.getByText('This block needs plan grading, which is not on for you.')).toBeTruthy()
    expect(screen.getByText('Mistakes: chased')).toBeTruthy()
    expect(screen.getByText('Emotions: calm')).toBeTruthy()
    expect(screen.getByText('Not ticked before entry: Tight closes')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the trade' }).getAttribute('href')).toBe('/journal-2-0/trade/review-1')
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/review/review-1', expect.anything())
  })

  it('a trade known by its stable ref is read by that ref, encoded', async () => {
    serve({ '/review/ext%3AFP-REVIEW-2': contractResponse('trader-blocks.review.by-ref') })
    renderBlock({ params: { tradeId: 'ext:FP-REVIEW-2' } })
    expect(await screen.findByText(/AMD/)).toBeTruthy()
    expect(screen.getByText('Entry 100.00 → exit 95.00 · -1.00R · closed Sep 30')).toBeTruthy()
  })

  it('the plan grade reads in the trade page\'s own words: each check, its verdict and its numbers', async () => {
    const grade = contractBody('plan-grades.trade.planned')
    serve({ '/review/review-1': json({ ...REVIEW(), planGrade: grade }) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText('Plan vs execution')).toBeTruthy()
    for (const [key, label] of [['entry', 'Entry'], ['stop', 'Stop'], ['size', 'Size'], ['target', 'Target']]) {
      const verdict = checkVerdict(key, grade.checks[key]).word
      expect(screen.getByText(`${label}: ${verdict}. ${checkDetail(key, grade.checks[key], grade.plan)}`)).toBeTruthy()
    }
    expect(screen.getByText(/^Size: Oversized\./)).toBeTruthy()       // 150 entered against a plan of 100
  })

  it('an ungraded trade says why, not a blank', async () => {
    serve({ '/review/review-1': json(REVIEW()) })                       // planGrade.status "unplanned"
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText('No plan for this trade was written before entry.')).toBeTruthy()
  })

  it('tags: one kind alone is shown alone; none at all is said, with the way to add them', async () => {
    serve({ '/review/review-1': json({ ...REVIEW(), tags: { mistakes: ['no_stop'], emotions: [] } }) })
    const { unmount } = renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText('Mistakes: no stop')).toBeTruthy()
    expect(screen.queryByText(/^Emotions/)).toBeNull()
    expect(screen.queryByText(/No tags yet/)).toBeNull()
    unmount()
    serve({ '/review/review-1': json({ ...REVIEW(), tags: { mistakes: [], emotions: [] } }) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText("No tags yet. Add them on the trade's page.")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the trade' })).toBeTruthy()
  })
})

describe('the pre-entry items', () => {
  it('everything ticked says so; CONTROL: nothing is called unticked then', async () => {
    const r = REVIEW()
    serve({ '/review/review-1': json({ ...r, preEntry: { ...r.preEntry, checkedRuleIds: ['s1', 's2'] } }) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText('All 2 checklist items were ticked before entry.')).toBeTruthy()
    expect(screen.queryByText(/Not ticked/)).toBeNull()
  })

  it('every unticked item is named, in the checklist\'s order', async () => {
    const r = REVIEW()
    serve({ '/review/review-1': json({ ...r, preEntry: { ...r.preEntry, checkedRuleIds: [] } }) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText('Not ticked before entry: Volume dry-up, Tight closes')).toBeTruthy()
  })

  it('a trade logged with no pre-entry record says so (never "all ticked")', async () => {
    serve({ '/review/ext%3AFP-REVIEW-2': contractResponse('trader-blocks.review.by-ref') })   // preEntry null
    renderBlock({ params: { tradeId: 'ext:FP-REVIEW-2' } })
    expect(await screen.findByText('No pre-entry checklist was recorded for this trade.')).toBeTruthy()
    expect(screen.queryByText(/Not ticked/)).toBeNull()
  })

  it('with no one account selected the labels are not the legacy row\'s: the account line says why', async () => {
    ACCOUNT_EXTRA = { accountId: null, isAllAccounts: true, accounts: [{ id: 'a1' }] }
    serve({ '/review/review-1': json(REVIEW()) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText(CHECKLIST_ACCOUNT_LINES['no-account'])).toBeTruthy()
    expect(screen.queryByText(/Not ticked/)).toBeNull()
    expect(screen.getByText('Mistakes: chased')).toBeTruthy()           // the rest of the review still reads
  })

  it('settings that cannot be read say so in words of their own', async () => {
    SETTINGS = undefined
    SETTINGS_EXTRA = { error: new Error('500'), isLoading: false }
    serve({ '/review/review-1': json(REVIEW()) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText("Your checklist couldn't load, so the items not ticked aren't listed here.")).toBeTruthy()
    expect(screen.queryByText(/Not ticked/)).toBeNull()
  })

  it('a setup that has since lost its checklist lists nothing it cannot resolve', async () => {
    SETTINGS = { setups: ['VCP'], setupRules: {} }
    serve({ '/review/review-1': json(REVIEW()) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText('Mistakes: chased')).toBeTruthy()
    expect(screen.queryByText(/Not ticked|were ticked/)).toBeNull()
  })
})

describe('a trade that is gone, or cannot be read', () => {
  it('404 says the trade is gone, and "Pick another trade" clears the choice', async () => {
    serve({ '/review/t1': contractResponse('trader-blocks.review.not-found') })
    const setParams = vi.fn(() => true)
    renderBlock({ params: { tradeId: 't1' }, setParams })
    expect(await screen.findByText(GONE)).toBeTruthy()
    expect(screen.queryByText(BLOCK_ERROR_SENTENCE)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pick another trade' }))
    expect(setParams).toHaveBeenCalledWith({ tradeId: '' })
  })

  it('a reader is told the same and offered no button', async () => {
    serve({ '/review/t1': contractResponse('trader-blocks.review.not-found') })
    renderBlock({ params: { tradeId: 't1' }, editable: false })
    expect(await screen.findByText(GONE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pick another trade' })).toBeNull()
  })

  it('CONTROL: any other failure is "couldn\'t load", never "no longer in your journal"', async () => {
    let ok = false
    serve({ '/review/review-1': () => (ok ? json(REVIEW()) : json({ detail: 'boom' }, 500)) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
    expect(screen.queryByText(GONE)).toBeNull()
    ok = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('Mistakes: chased')).toBeTruthy())
  })

  it('while the read is in flight it says loading, not gone', async () => {
    serve({ '/review/review-1': () => new Promise(() => {}) })
    renderBlock({ params: { tradeId: 'review-1' } })
    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(GONE)).toBeNull()
  })
})
