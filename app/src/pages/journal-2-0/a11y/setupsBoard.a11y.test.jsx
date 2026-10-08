// app/src/pages/journal-2-0/a11y/setupsBoard.a11y.test.jsx
//
// Wave 13 lane 13J (the active setups board, find more like this) through 8A's axe harness.
// Both surfaces are dark behind their own flags on their own route, so no other recipe ever
// renders them -- hence recipes of their own. Each proves its state rendered before axe runs:
//   * setups-board   -- three cards (waiting, triggered, no price), the find-similar door on
//                       the tagged one, the template list below;
//   * similar-names  -- one template's matches with their reasons and the every-field list.
// StockChart is a canvas engine jsdom cannot run; it is stood in by an inert element, which
// is what an assistive technology meets in the real page too (the canvas carries no names).
import { describe, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'

vi.mock('../../../components/StockChart', async () => {
  const React = await import('react')
  return { default: () => React.createElement('div', { 'data-chart': 'stub' }) }
})
vi.mock('../../../utils/prefetchBars', () => ({ prefetchListAllTimeframes: () => {} }))

import SetupsBoard from '../components/notebook/SetupsBoard'
import SimilarNames from '../components/notebook/SimilarNames'

const card = (i, over) => ({
  noteId: `n${i}`, noteTitle: `Plan ${i}`, symbol: ['NVDA', 'AMD', 'META'][i], entry: 105, stop: 100,
  target: 120, levelShape: 'chart', setupTag: 'VCP', daysInSetup: i, since: '2026-09-28',
  similarEmbedKey: i === 0 ? 'e-0' : null, side: 'long', state: 'waiting', price: 102,
  priceSource: 'close', priceAsOf: '2026-10-01', distancePct: 2.94, distanceR: 0.6, ...over,
})
const BOARD = {
  cards: [card(0), card(1, { state: 'triggered', distancePct: -0.94, distanceR: -0.2 }),
    card(2, { state: 'no_price', price: null, distancePct: null, distanceR: null })],
  count: 3, today: '2026-10-02', pageSize: 16, scanned: 3, capped: false,
}
const TEMPLATES = { templates: [{ noteId: 'n0', embedKey: 'e-0', noteTitle: 'Plan 0', symbol: 'NVDA',
  setupTag: 'VCP', asOf: '2026-09-30', frozen: true, matchesAsOf: '2026-10-01', matchCount: 10 }],
  count: 1, maxTemplates: 25 }
const MATCHES = {
  template: TEMPLATES.templates[0], asOf: '2026-10-01', computedAt: 'x', status: 'ready',
  matches: [{ rank: 1, symbol: 'CRWD', score: 88, distance: 0.12, coverage: 1, reasons: {
    fields: [
      { field: 'rs_rank', label: 'RS', unit: '', template: 92, candidate: 94, delta: 2, same: null, d: 0.08 },
      { field: 'ma_stack', label: 'MA stack', unit: '', template: 'full-bull', candidate: 'full-bull', delta: null, same: true, d: 0 },
    ],
    patterns: { shared: ['vcp'], templateOnly: [], missing: null } } }],
}

describe('lane 13J surfaces (setups board, find similar)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_setups_board_enabled: true, notebook_find_similar_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  axeSurface('setups-board', async () => {
    installFetch([
      [/^\/api\/j2\/setups-board$/, BOARD],
      [/^\/api\/j2\/similar-names\/templates$/, TEMPLATES],
    ])
    render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)
    await screen.findByText('Plan 2')
    screen.getByRole('button', { name: 'Find more like NVDA' })
    await screen.findByRole('button', { name: 'Find more like NVDA (VCP)' })
  }, { level: 'page' })

  axeSurface('similar-names', async () => {
    installFetch([[/^\/api\/j2\/similar-names\/n0\/e-0$/, MATCHES]])
    render(<Providers><SimilarNames noteId="n0" embedKey="e-0" /></Providers>)
    await screen.findByText('MA stack full-bull · RS 94 vs 92 · VCP')   // closest field first
  })
})
