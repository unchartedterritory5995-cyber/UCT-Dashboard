// app/src/pages/journal-2-0/a11y/traderBlockReview.a11y.test.jsx
//
// Notebook P2b, Task 11: the post-trade review block through 8A's axe harness. One recipe renders its
// member-visible shapes, each proved on screen BEFORE axe runs so an empty render cannot pass as clean:
//   · the picker over the member's closed trades;
//   · the card for a graded trade: the plan-check list, the tags, the unticked items, the trade link;
//   · the card for a trade in another account (the sentence that replaces the unticked list);
//   · the 404 state with its "Pick another trade" button.
// Every answer is the server's REAL one (`__fixtures__/contract`).
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, expect, afterEach } from 'vitest'
import { axeSurface } from './surface'
import { contractBody, contractResponse } from '../__fixtures__/contract'

vi.mock('../hooks/useJ2Settings', () => ({
  default: () => ({
    settings: {
      setups: ['VCP'],
      setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] },
    },
  }),
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1' }) }))
vi.mock('../hooks/useJournalRules', () => ({ default: () => ({ rules: [] }) }))
import TradeReviewBlock from '../components/notebook/blocks/TradeReviewBlock'

afterEach(() => vi.unstubAllGlobals())

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

axeSurface('trader-block-review', async () => {
  const graded = { ...contractBody('trader-blocks.review'), planGrade: contractBody('plan-grades.trade.planned') }
  const routes = {
    '/review/trades': () => contractResponse('trader-blocks.review.trades'),
    '/review/graded': () => json(graded),
    '/review/elsewhere': () => json({ ...contractBody('trader-blocks.review'), accountId: 'a2' }),
    '/review/gone': () => contractResponse('trader-blocks.review.not-found'),
  }
  vi.stubGlobal('fetch', vi.fn(async (url) => routes[Object.keys(routes).find((k) => String(url).endsWith(k))]()))
  const set = vi.fn(() => true)
  render(
    <MemoryRouter>
      <section aria-label="picker"><TradeReviewBlock params={{}} setParams={set} editable /></section>
      <section aria-label="graded"><TradeReviewBlock params={{ tradeId: 'graded' }} setParams={set} editable /></section>
      <section aria-label="elsewhere"><TradeReviewBlock params={{ tradeId: 'elsewhere' }} setParams={set} editable /></section>
      <section aria-label="gone"><TradeReviewBlock params={{ tradeId: 'gone' }} setParams={set} editable /></section>
    </MemoryRouter>,
  )
  const area = (name) => within(screen.getByRole('region', { name }))

  const picker = await area('picker').findByRole('combobox', { name: 'Trade to review' })
  expect([...picker.options].map((o) => o.textContent)).toEqual(['Pick a trade', 'NVDA · closed Oct 2 · Win', 'AMD · closed Sep 30 · Loss'])

  expect(await area('graded').findByText('Plan vs execution')).toBeTruthy()
  expect(area('graded').getByRole('list', { name: 'Plan checks' }).querySelectorAll('li')).toHaveLength(4)
  expect(area('graded').getByText('Mistakes: chased')).toBeTruthy()
  expect(area('graded').getByText('Emotions: calm')).toBeTruthy()
  expect(area('graded').getByText('Not ticked before entry: Tight closes')).toBeTruthy()
  expect(area('graded').getByRole('link', { name: 'Open the trade' })).toBeTruthy()

  expect(await area('elsewhere').findByText('This trade is in another account. Switch to that account to see its checklist.')).toBeTruthy()
  expect(area('elsewhere').queryByText(/Not ticked/)).toBeNull()

  expect(await area('gone').findByText('This trade is no longer in your journal.')).toBeTruthy()
  expect(area('gone').getByRole('button', { name: 'Pick another trade' })).toBeTruthy()
})
