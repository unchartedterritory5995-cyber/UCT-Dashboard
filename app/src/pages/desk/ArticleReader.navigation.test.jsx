// Walking prev/next keeps the SAME component mounted — react-router just feeds
// it a new :slug. That is the case where effect ordering bites, so this file
// deliberately does NOT mock useNavigate: <Link> needs the real one to actually
// move the router, and a mocked navigate would make the test pass by never
// navigating at all.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

let mockData = null
vi.mock('swr', () => ({ default: () => ({ data: mockData, error: null, isLoading: false }) }))

// Not under test here — stubbed so this timing-sensitive file doesn't import
// the popup's chart/voice/hub module graph or start a live-price poll.
vi.mock('../../components/TickerPopup', () => ({ default: () => null }))
vi.mock('../../hooks/useLivePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, error: null, refresh: () => {} }),
}))
vi.mock('../../utils/prefetchBars', () => ({ prefetchBar: vi.fn() }))

import * as progress from './articleProgress'
import ArticleReader from './ArticleReader'

const SECTIONS = [
  { id: 'intro', text: 'INTRO', level: 2 },
  { id: 'market-breadth-data', text: 'Market Breadth Data', level: 2 },
  { id: 'charts-covered', text: 'Charts Covered', level: 3 },
]
// ⛔ The two issues MUST carry different bodies. The scroll-spy effect keys on
// `data.body_html`, so identical fixtures mean it never re-runs on navigation —
// and the ordering bug this file exists to catch never gets a chance to happen.
// Real issues always differ.
const body = (slug) =>
  `<h2 id="intro">INTRO</h2><p>opening of ${slug}</p>` +
  `<h2 id="market-breadth-data">Market Breadth Data</h2><p>breadth for ${slug}</p>` +
  `<h3 id="charts-covered">Charts Covered</h3><p>charts for ${slug}</p>`

const article = (slug) => ({
  id: `https://sub.test/p/${slug}`, slug,
  title: `Sunday Scans — ${slug}`, url: `https://sub.test/p/${slug}`,
  published_at: 1786902774, reading_minutes: 14, image_count: 20,
  sections: SECTIONS, tickers: [], related_video: null,
  adjacent: { previous: null, next: { slug: 'next-issue', title: 'Sunday Scans — next' } },
  body_html: body(slug),
})

// Same browser-shaped defaults as ArticleReader.test.jsx: jsdom neither lays
// out nor scrolls, and the reader deliberately refuses to claim a jump that did
// not happen.
const dim = (k, v) => Object.defineProperty(document.documentElement, k,
  { value: v, configurable: true, writable: true })

beforeEach(() => {
  dim('scrollHeight', 2000); dim('clientHeight', 800); dim('scrollTop', 0)
  Element.prototype.scrollIntoView = vi.fn(() => dim('scrollTop', 900))
  localStorage.clear()
  mockData = article('first-issue')
})

test('stepping to the next issue does not erase ITS saved place', () => {
  // ⛔ The scroll-spy effect re-runs on the new slug BEFORE any effect could
  // re-arm the save gate, at scroll position 0. Re-arming in an effect (rather
  // than during render) therefore wipes the incoming article's bookmark — this
  // is the test that tells the two apart.
  progress.save('next-issue', { sectionId: 'market-breadth-data', pct: 0.5 })

  render(
    <MemoryRouter initialEntries={['/desk/article/first-issue']}>
      <Routes><Route path="/desk/article/:slug" element={<ArticleReader />} /></Routes>
    </MemoryRouter>,
  )
  // The router feeds the same mounted component a new :slug.
  mockData = article('next-issue')
  fireEvent.click(screen.getByText('Sunday Scans — next').closest('a'))

  expect(progress.load('next-issue')).not.toBeNull()
  expect(progress.load('next-issue').sectionId).toBe('market-breadth-data')
})

test('and it puts the reader back in that issue', async () => {
  progress.save('next-issue', { sectionId: 'market-breadth-data', pct: 0.5 })
  render(
    <MemoryRouter initialEntries={['/desk/article/first-issue']}>
      <Routes><Route path="/desk/article/:slug" element={<ArticleReader />} /></Routes>
    </MemoryRouter>,
  )
  mockData = article('next-issue')
  fireEvent.click(screen.getByText('Sunday Scans — next').closest('a'))
  await waitFor(() => expect(screen.getByRole('status').textContent)
    .toContain('Market Breadth Data'))
})
