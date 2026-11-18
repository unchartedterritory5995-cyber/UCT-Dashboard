// app/src/pages/journal-2-0/a11y/tweetImport.a11y.test.jsx
//
// Import a tweet through 8A's axe harness. The home and research recipes run with the gate OFF,
// so they never render these controls. Each proves its state rendered before axe runs:
//   * ticker-research-tweet  -- the workspace with its "Import a tweet" door;
//   * import-tweet-sheet     -- the sheet: posts, a ticked row, an already-saved row, a warning;
//   * tweet-card             -- a saved post with its price line and My take, and one that left X.
import { describe, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import TickerResearchWorkspace from '../components/notebook/TickerResearchWorkspace'
import ImportTweetSheet from '../components/notebook/ImportTweetSheet'
import TweetCard from '../components/notebook/TweetCard'

vi.mock('../lib/offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => null) }))

const SUMMARY = {
  identity: { symbol: 'NVDA', displayName: 'NVIDIA Corporation', entityId: null, symbols: ['NVDA'] },
  notes: [{ id: 'n1', title: 'NVDA thesis', updatedAt: '2026-10-01T00:00:00Z' }],
  activeTheses: [], pastTheses: [], facts: [], documents: [],
  tradeSummary: { openPositions: 0, closedTrades: 0 },
}
const NOW = Math.floor(Date.now() / 1000)
const post = (id, name, handle, kind) => ({
  id, name, handle, kind, text: `$NVDA words from ${name}`, avatarUrl: null, postedAt: NOW - 3600,
  url: `https://x.com/${handle}/status/${id}`, tickers: ['NVDA'], media: [],
})
const POSTS = { posts: [post('1', 'Northgate Newswire', 'northgate_wire', 'news'), post('2', 'Alder Street Desk', 'alderstreetdesk', 'commentary')] }
const SAVED = { excerpts: [{ id: 'e1', tweet: { tweetId: '2' } }], note: { id: 'n1', updatedAt: 'x' }, warnings: ['An image could not be copied.'] }

describe('Import a tweet (axe)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_tweet_import_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  axeSurface('ticker-research-tweet', async () => {
    installFetch([[/^\/api\/j2\/notes\/research\/[^/]+\/summary$/, SUMMARY]])
    render(<Providers><TickerResearchWorkspace symbol="NVDA" onOpenNote={() => {}} /></Providers>)
    await screen.findByText('NVIDIA Corporation')
    screen.getByRole('button', { name: /Import a tweet/ })
  }, { level: 'page' })

  axeSurface('import-tweet-sheet', async () => {
    installFetch([
      [/\/tweets\/save$/, SAVED],
      [/\/tweets\/recent/, POSTS],
      [/\/notes\/n1\/excerpts$/, { excerpts: [{ id: 'e9', tweet: { tweetId: '1' } }] }],
    ])
    render(<Providers><ImportTweetSheet open onClose={() => {}} symbol="NVDA" fixedNoteId="n1" noteTitle="NVDA thesis" /></Providers>)
    await screen.findByText('Already in this note')
    fireEvent.click(await screen.findByRole('checkbox', { name: /Alder Street Desk/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('An image could not be copied.')
  })

  axeSurface('tweet-card', async () => {
    installFetch([[/^\/api\/snapshot\/NVDA$/, { close: 200 }]])
    const tweet = {
      name: 'Alder Street Desk', handle: 'alderstreetdesk', avatarUrl: null, postedAt: NOW - 3600,
      url: 'https://x.com/alderstreetdesk/status/2', media: [],
      price: { symbol: 'NVDA', price: 188.2, label: 'posted' },
    }
    render(
      <Providers>
        <TweetCard excerpt={{ id: 'e1', capturedText: '$NVDA words', annotation: '', tweet }} deleteNode={() => {}} noteId="n1" />
        <TweetCard excerpt={{ id: 'e2', capturedText: '', annotation: '', tweet: { ...tweet, removed: true, price: null } }} deleteNode={() => {}} noteId="n1" />
      </Providers>,
    )
    await screen.findByText(/since$/)
    screen.getByText('This post is no longer on X.')
    if (screen.getAllByLabelText('My take').length !== 2) throw new Error('both My take fields should render')
  })
})
