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
let mockAnchors = {}
// Key-aware: the reader now runs a SECOND swr call for anchor closes. A
// key-blind mock would hand the ARTICLE object to the anchors consumer.
vi.mock('swr', () => ({
  default: (key) => (String(key || '').includes('/articles/anchors/')
    ? { data: { anchors: mockAnchors }, error: null, isLoading: false }
    : { data: mockData, error: mockError, isLoading: false }),
}))

// The real popup pulls ChartPane + the voice/ticker-hub context graph — none of
// which is under test here. The stub keeps the CONTRACT under test: it renders
// only when open, carries the symbol it was given, and can be closed.
vi.mock('../../components/TickerPopup', () => ({
  default: ({ sym, open, onClose }) => (open ? (
    <div data-testid="ticker-popup" data-sym={sym}>
      <button type="button" onClick={onClose}>close chart</button>
    </div>
  ) : null),
}))

let mockPrices = {}
vi.mock('../../hooks/useLivePrices', () => ({
  default: () => ({ prices: mockPrices, isLoading: false, error: null, refresh: () => {} }),
}))
vi.mock('../../utils/prefetchBars', () => ({ prefetchBar: vi.fn() }))

// The REAL useTickerActions hook (pure state — the wiring under test) with a
// stub menu: the real menu pulls flag/tag/alert hooks that all fetch.
vi.mock('../../components/TickerActions', async () => {
  const actual = await vi.importActual('../../components/TickerActions')
  return {
    ...actual,
    default: ({ menu, onClose }) => (
      <div data-testid="ticker-actions-menu" data-sym={menu?.sym}>
        <button type="button" onClick={onClose}>close actions</button>
      </div>
    ),
  }
})

let mockUserSet = new Set()
vi.mock('../../hooks/useUserTickerSet', () => ({ default: () => mockUserSet }))
vi.mock('../../hooks/useReadAloudFollow', () => ({ default: () => {} }))
vi.mock('../../components/voice/ReadAloudButton', () => ({
  default: ({ children }) => <button type="button">{children || 'Listen'}</button>,
}))

import * as progress from './articleProgress'
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

// jsdom does not implement scrollIntoView. The reader deliberately shows the
// "picked up at…" pill ONLY when the scroll succeeded, so without this stub the
// resume tests would be asserting against a component that correctly declined
// to claim something it hadn't done.
// jsdom lays nothing out and implements no scrolling, so the defaults below
// model a working browser: a page taller than the viewport, and a
// scrollIntoView that actually moves it. Without that the reader correctly
// declines to claim a jump, and every resume assertion fails for the right
// reason at the wrong time.
//
// They are reset per test because a test that stubs them leaks into every test
// after it.
const dim = (k, v) => Object.defineProperty(document.documentElement, k,
  { value: v, configurable: true, writable: true })

const resetDoc = () => { dim('scrollHeight', 2000); dim('clientHeight', 800); dim('scrollTop', 0) }

beforeEach(() => {
  resetDoc()
  Element.prototype.scrollIntoView = vi.fn(() => dim('scrollTop', 900))
  navigate.mockClear()
  localStorage.clear()
  mockData = ARTICLE
  mockError = null
  mockPrices = {}
  mockAnchors = {}
  mockUserSet = new Set()
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

test('a ticker chip inside the injected body opens the chart popup in place', () => {
  const { container } = renderReader()
  const chip = container.querySelector('.uctTickerChip')
  expect(chip.getAttribute('href')).toBe('/research/INTC')  // works without JS too
  expect(screen.queryByTestId('ticker-popup')).toBeNull()
  fireEvent.click(chip)
  // The popup is the member's own chart (TickerPopup → ChartPane). The reader
  // must NOT be navigated away mid-article — that was the old behavior.
  expect(screen.getByTestId('ticker-popup').getAttribute('data-sym')).toBe('INTC')
  expect(navigate).not.toHaveBeenCalled()
})

test('a Covered chip opens the chart popup, and closing returns to the article', () => {
  renderReader()
  fireEvent.click(screen.getByRole('button', { name: 'ALAB' }))
  expect(screen.getByTestId('ticker-popup').getAttribute('data-sym')).toBe('ALAB')
  fireEvent.click(screen.getByText('close chart'))
  expect(screen.queryByTestId('ticker-popup')).toBeNull()
  expect(navigate).not.toHaveBeenCalled()
})

test('covered chips carry the live day move when the price store has one', () => {
  mockPrices = {
    INTC: { price: 102.5, change_pct: 2.34 },
    ALAB: { price: 50.1, change_pct: -1.42 },
  }
  renderReader()
  expect(screen.getByText('+2.3%')).toBeTruthy()
  expect(screen.getByText('-1.4%')).toBeTruthy()
  // A name the store has no price for renders bare — no stray zero or plus.
  expect(screen.getByRole('button', { name: 'ARM' })).toBeTruthy()
})

test('related issues render as cards linking into the reader', () => {
  mockData = {
    ...ARTICLE,
    related: [{
      slug: 'sunday-scans-1ad', title: 'Sunday Scans — August 9, 2026',
      published_at: 1786297974, shared_count: 12,
      shared: ['INTC', 'MU', 'ARM', 'DELL'],
    }],
  }
  renderReader()
  const nav = screen.getByLabelText('Issues on the same names')
  const card = nav.querySelector('a')
  expect(card.getAttribute('href')).toBe('/desk/article/sunday-scans-1ad')
  expect(card.textContent).toContain('12 shared names')
  expect(card.textContent).toContain('INTC · MU · ARM · DELL')
})

test('no related section renders when the payload carries none', () => {
  renderReader()  // ARTICLE has no `related` key
  expect(screen.queryByLabelText('Issues on the same names')).toBeNull()
})

test('right-click on a body chip opens the ticker-actions menu, not the chart', () => {
  const { container } = renderReader()
  fireEvent.contextMenu(container.querySelector('.uctTickerChip'))
  expect(screen.getByTestId('ticker-actions-menu').getAttribute('data-sym')).toBe('INTC')
  expect(screen.queryByTestId('ticker-popup')).toBeNull()
  fireEvent.click(screen.getByText('close actions'))
  expect(screen.queryByTestId('ticker-actions-menu')).toBeNull()
})

test('right-click on a Covered chip opens the ticker-actions menu for that name', () => {
  renderReader()
  fireEvent.contextMenu(screen.getByRole('button', { name: 'ALAB' }))
  expect(screen.getByTestId('ticker-actions-menu').getAttribute('data-sym')).toBe('ALAB')
})

test('names on the reader\'s own lists are starred — covered row and body chips', () => {
  mockUserSet = new Set(['INTC', 'MU'])
  const { container } = renderReader()
  // Covered chip carries the star marker; a name not on any list stays bare…
  expect(container.querySelector('button[data-sym="MU"]').textContent).toContain('★')
  expect(container.querySelector('button[data-sym="ARM"]').textContent).not.toContain('★')
  // …and the static body chip gets the membership class.
  // ⛔ This assertion is also the rail on the MEMOIZED {__html} object: React
  // 19 diffs dangerouslySetInnerHTML by object identity, so an inline literal
  // re-sets the body on the next re-render and silently wipes this class.
  expect(container.querySelector('.uctTickerChip').classList.contains('uctChipMine')).toBe(true)
})

test('the Since-issue lens shows the move off the anchor close, not today\'s', () => {
  mockPrices = { INTC: { price: 110, change_pct: -6.6 } }
  mockAnchors = { INTC: 100 }
  renderReader()
  expect(screen.getByText('-6.6%')).toBeTruthy()          // default lens = Today
  fireEvent.click(screen.getByRole('button', { name: 'Since issue' }))
  expect(screen.getByText('+10.0%')).toBeTruthy()
  expect(screen.queryByText('-6.6%')).toBeNull()
  // A name with no anchor renders bare rather than a fabricated number.
  expect(screen.getByRole('button', { name: 'ALAB' })).toBeTruthy()
  // The choice sticks.
  expect(localStorage.getItem('uct.desk.articles.chipLens')).toBe('since')
})

test('the reader offers Listen (read-aloud) in the masthead', () => {
  renderReader()
  expect(screen.getByRole('button', { name: 'Listen' })).toBeTruthy()
})

test('a reference to an earlier issue routes in-app, not a full page reload', () => {
  mockData = {
    ...ARTICLE,
    body_html: BODY + '<p>See <a href="/desk/article/sunday-scans-1ad">last week</a>.</p>',
  }
  const { container } = renderReader()
  fireEvent.click(container.querySelector('a[href="/desk/article/sunday-scans-1ad"]'))
  expect(navigate).toHaveBeenCalledWith('/desk/article/sunday-scans-1ad')
})

test('an OUTBOUND link is left alone for the browser to handle', () => {
  const { container } = renderReader()
  fireEvent.click(container.querySelector('a.uctArticleCta'))
  expect(navigate).not.toHaveBeenCalled()
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

test('the archive can be walked in both directions from the foot of an article', () => {
  mockData = {
    ...ARTICLE,
    adjacent: {
      previous: { slug: 'sunday-scans-1ad', title: 'Sunday Scans — August 9, 2026' },
      next: { slug: 'sunday-scans-zzz', title: 'Sunday Scans — August 23, 2026' },
    },
  }
  renderReader()
  expect(screen.getByText('Sunday Scans — August 9, 2026').closest('a').getAttribute('href'))
    .toBe('/desk/article/sunday-scans-1ad')
  expect(screen.getByText('Sunday Scans — August 23, 2026').closest('a').getAttribute('href'))
    .toBe('/desk/article/sunday-scans-zzz')
})

test('the newest issue offers no Next, and the block is not rendered empty', () => {
  mockData = { ...ARTICLE, adjacent: { previous: null, next: null } }
  renderReader()
  expect(screen.queryByLabelText('More issues')).toBeNull()
})

test('one neighbour still renders the block', () => {
  mockData = {
    ...ARTICLE,
    adjacent: { previous: { slug: 's1', title: 'Sunday Scans — August 9, 2026' }, next: null },
  }
  renderReader()
  expect(screen.getByLabelText('More issues')).toBeTruthy()
  expect(screen.queryByText(/Next issue/)).toBeNull()
})

test('scrolling through an article CREATES a bookmark', async () => {
  // The most basic rail, and the one that was missing: does it save at all?
  // jsdom reports zero heights, so the scroll-spy computes pct=0 and correctly
  // declines to store — the page has to be given a real size for the save path
  // to be exercised at all.
  dim('scrollTop', 600)
  renderReader()
  // Dispatch on the element the component RESOLVED as its scroller. Firing at
  // `window` would miss a listener bound to documentElement and the test would
  // fail for a reason that has nothing to do with saving.
  fireEvent.scroll(document.documentElement)
  await waitFor(() => expect(progress.load('sunday-scans-da5')).not.toBeNull())
  expect(progress.load('sunday-scans-da5').pct).toBeCloseTo(0.5, 2)
})

test('a returning reader is put back, and TOLD where they were put', async () => {
  // ⛔ Moving someone silently is worse than not moving them: the pill names
  // the section and offers the way back.
  const el = { scrollIntoView: vi.fn() }
  const spy = vi.spyOn(HTMLElement.prototype, 'querySelector')
  progress.save('sunday-scans-da5', { sectionId: 'market-breadth-data', pct: 0.42 })
  renderReader()
  await waitFor(() => expect(screen.getByRole('status').textContent)
    .toContain('Market Breadth Data'))
  spy.mockRestore()
  void el
})

test('"start from the top" forgets the place so it is not offered again', async () => {
  progress.save('sunday-scans-da5', { sectionId: 'market-breadth-data', pct: 0.42 })
  renderReader()
  await waitFor(() => screen.getByText('Start from the top'))
  fireEvent.click(screen.getByText('Start from the top'))
  expect(screen.queryByRole('status')).toBeNull()
  expect(progress.load('sunday-scans-da5')).toBeNull()
})

test('walking to the NEXT article does not wipe its bookmark on the way in', () => {
  // ⛔ Prev/next swaps the article without unmounting. The scroll-spy effect
  // re-runs first, at scroll position 0 — if the gate were re-armed in an
  // effect it would fire too late and erase the incoming article's place.
  progress.save('sunday-scans-1ad', { sectionId: 'market-breadth-data', pct: 0.5 })
  const { rerender } = render(
    <MemoryRouter initialEntries={['/desk/article/sunday-scans-1ad']}>
      <Routes><Route path="/desk/article/:slug" element={<ArticleReader />} /></Routes>
    </MemoryRouter>,
  )
  rerender(
    <MemoryRouter initialEntries={['/desk/article/sunday-scans-1ad']}>
      <Routes><Route path="/desk/article/:slug" element={<ArticleReader />} /></Routes>
    </MemoryRouter>,
  )
  expect(progress.load('sunday-scans-1ad')).not.toBeNull()
})

test('if the scroll itself fails, no pill is shown — we did not move them', async () => {
  // ⛔ Otherwise the pill says "picked up at Market Breadth Data" over a page
  // sitting at the top: a claim about something that did not happen.
  Element.prototype.scrollIntoView = vi.fn(() => { throw new Error('unsupported') })
  progress.save('sunday-scans-da5', { sectionId: 'market-breadth-data', pct: 0.42 })
  renderReader()
  expect(screen.queryByRole('status')).toBeNull()
})

test('a scroll that does not stick on the first frame is RE-ASSERTED', async () => {
  // ⛔ Production hits this every time: the effect fires before the browser has
  // laid out ~100 KB of article HTML, so the container is not yet tall enough
  // and the first scrollIntoView silently no-ops.
  let landed = false
  dim('scrollTop', 0)
  let calls = 0
  Element.prototype.scrollIntoView = vi.fn(() => {
    if (++calls >= 3) { landed = true; dim('scrollTop', 900) }
  })
  progress.save('sunday-scans-da5', { sectionId: 'market-breadth-data', pct: 0.42 })
  renderReader()
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull())
  expect(landed).toBe(true)
  expect(calls).toBeGreaterThanOrEqual(3)
})

test('a first-time reader is never moved and sees no pill', () => {
  renderReader()
  expect(screen.queryByRole('status')).toBeNull()
})

test('a section that no longer exists does not strand the reader', () => {
  // The letter was re-converted and that heading is gone. Render normally.
  progress.save('sunday-scans-da5', { sectionId: 'a-heading-that-vanished', pct: 0.42 })
  const { container } = renderReader()
  expect(screen.queryByRole('status')).toBeNull()
  expect(container.querySelector('article')).toBeTruthy()
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
