import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

let mockData = null
let mockError = null
vi.mock('swr', () => ({
  default: () => ({ data: mockData, error: mockError, isLoading: false }),
}))

import ArticleReader from './ArticleReader'

// The body is what the server converter emits, including the classes the reader
// styles and hydrates. Keeping the real shape here is the point: a fixture that
// drops data-lightbox or uctTickerChip would test a contract we don't ship.
const BODY = `
<p>We are excited to welcome you back.</p>
<h2 id="market-breadth-data"><strong>Market Breadth Data</strong></h2>
<p>Good participation.</p>
<img src="https://cdn.test/a.png" srcset="https://cdn.test/a.png 424w" sizes="(max-width: 820px) 100vw, 760px"
     width="1456" height="924" alt="QQQ (Daily)" loading="lazy" decoding="async"
     class="uctArticleImage" data-lightbox="1">
<h3 id="charts-covered"><strong>Charts Covered</strong></h3>
<div class="uctTickerChips"><a class="uctTickerChip" data-ticker="INTC" href="/research/INTC">INTC</a></div>
<p class="uctArticleCta"><a class="uctArticleCta" href="https://whop.com/x?utm_source=uct_desk"
   target="_blank" rel="noopener noreferrer">Get Started for $7</a></p>`

const ARTICLE = {
  id: 'https://sub.test/p/sunday-scans-da5',
  slug: 'sunday-scans-da5',
  title: 'Sunday Scans — August 16, 2026',
  source_title: 'SUNDAY SCANS',
  url: 'https://sub.test/p/sunday-scans-da5',
  author: 'Uncharted Territory',
  publication_name: 'Uncharted Territory',
  published_at: 1786902774,
  reading_minutes: 18,
  image_count: 62,
  sections: [
    { id: 'what-we-will-cover-today', text: 'WHAT WE WILL COVER TODAY', level: 2 },
    { id: 'market-breadth-data', text: 'Market Breadth Data', level: 2 },
    { id: 'index-etfs', text: 'Index & ETFs', level: 2 },
    { id: 'charts-covered', text: 'Charts Covered', level: 3 },
  ],
  tickers: ['INTC', 'ALAB', 'ARM', 'DELL', 'HPE', 'MU', 'MRVL', 'AMD',
            'NBIS', 'TER', 'RBRK', 'SNOW', 'PLTR', 'FSLY'],
  related_video: {
    id: 7, youtube_id: 'gdGBGsZQQEE',
    title: 'Sunday Scans — August 16, 2026', category: 'Sunday Scans',
  },
  body_html: BODY,
}

const renderReader = () => render(
  <MemoryRouter initialEntries={['/desk/article/sunday-scans-da5']}>
    <Routes><Route path="/desk/article/:slug" element={<ArticleReader />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  navigate.mockClear()
  mockData = ARTICLE
  mockError = null
})

test('the article renders its own body, not a link to Substack', () => {
  const { container } = renderReader()
  // Scoped to <article>: heading text also appears in the TOC beside it, so an
  // unscoped query would be ambiguous — and would still "pass" against a page
  // that rendered only a table of contents and no prose.
  const body = container.querySelector('article')
  expect(body.textContent).toContain('We are excited to welcome you back')
  expect(body.querySelector('h2#market-breadth-data')).toBeTruthy()
  expect(body.querySelectorAll('p').length).toBeGreaterThan(1)
})

test('the masthead carries the date-stamped title and the reading cost', () => {
  renderReader()
  expect(screen.getByRole('heading', { level: 1 }).textContent)
    .toBe('Sunday Scans — August 16, 2026')
  expect(screen.getByText('18 min read')).toBeTruthy()
  expect(screen.getByText('62 charts')).toBeTruthy()
})

test('the byline is not repeated when the author IS the publication', () => {
  const { container } = renderReader()
  const head = container.querySelector('header')
  expect(head.textContent.split('Uncharted Territory').length - 1).toBe(1)
})

test('only a preview of the tickers shows, so prose is not pushed off a phone screen', () => {
  renderReader()
  expect(screen.getByText('+2 more')).toBeTruthy()
  expect(screen.queryByText('FSLY')).toBeNull()
  fireEvent.click(screen.getByText('+2 more'))
  expect(screen.getByText('FSLY')).toBeTruthy()
})

test('the table of contents is built from the sections the server derived', () => {
  renderReader()
  const nav = screen.getByLabelText('In this article')
  expect(nav.textContent).toContain('Market Breadth Data')
  expect(nav.textContent).toContain('Charts Covered')
})

test('a ticker chip inside the injected body routes in-app instead of reloading', () => {
  const { container } = renderReader()
  const chip = container.querySelector('.uctTickerChip')
  expect(chip.getAttribute('href')).toBe('/research/INTC')  // works without JS too
  fireEvent.click(chip)
  expect(navigate).toHaveBeenCalledWith('/research/INTC')
})

test('clicking a chart opens the lightbox', () => {
  const { container } = renderReader()
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  fireEvent.click(container.querySelector('img[data-lightbox]'))
  expect(container.querySelector('[role="dialog"]')).toBeTruthy()
})

test('the membership CTA survives conversion and stays a real outbound link', () => {
  const { container } = renderReader()
  const cta = container.querySelector('a.uctArticleCta')
  expect(cta.textContent).toContain('Get Started for $7')
  expect(cta.getAttribute('href')).toContain('whop.com')
  expect(cta.getAttribute('href')).toContain('utm_source=uct_desk')
})

test("the charts keep the attributes that make them fast", () => {
  const { container } = renderReader()
  const img = container.querySelector('img[data-lightbox]')
  expect(img.getAttribute('srcset')).toBeTruthy()
  expect(img.getAttribute('loading')).toBe('lazy')
  expect(img.getAttribute('width')).toBe('1456')
  expect(img.getAttribute('sizes')).not.toBe('100vw')
})

test("that week's session is offered, pointing at the video deep-link", () => {
  renderReader()
  const card = screen.getByText('Watch the session').closest('a')
  expect(card.getAttribute('href')).toBe('/desk?section=videos&v=gdGBGsZQQEE')
  expect(card.textContent).toContain('Sunday Scans — August 16, 2026')
})

test('no session card is invented when there is no matching video', () => {
  mockData = { ...ARTICLE, related_video: null }
  renderReader()
  expect(screen.queryByText('Watch the session')).toBeNull()
})

test('the Substack origin is credited', () => {
  renderReader()
  expect(screen.getByText('Substack').getAttribute('href')).toBe(ARTICLE.url)
})

test('a body that is not ready yet says so — that is not the same as missing', () => {
  mockData = null
  mockError = Object.assign(new Error('x'), { status: 409 })
  renderReader()
  expect(screen.getByText(/still being prepared/)).toBeTruthy()
  expect(screen.queryByText(/Article not found/)).toBeNull()
})

test('a short post gets no table of contents — a 2-item TOC is furniture', () => {
  mockData = {
    ...ARTICLE,
    sections: [{ id: 'a', text: 'Only Section', level: 2 }],
  }
  renderReader()
  expect(screen.queryByLabelText('In this article')).toBeNull()
})

test('a genuinely missing article says THAT instead', () => {
  mockData = null
  mockError = Object.assign(new Error('x'), { status: 404 })
  renderReader()
  expect(screen.getByText(/Article not found/)).toBeTruthy()
})
