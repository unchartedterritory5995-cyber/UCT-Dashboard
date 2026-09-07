// app/src/components/Layout.routeSuspense.test.jsx
//
// App.jsx wraps the WHOLE <Routes> in one <Suspense>, so a section whose chunk
// is not resolved yet unmounted the ENTIRE shell — nav, header, everything —
// behind the full-screen "Loading page" splash. That is what members felt as the
// app reloading itself when they switched sections. Measured on prod 2026-09-07:
// 878 ms entering /uct-20, 1,235 ms entering /options-flow.
//
// Layout now owns a boundary INSIDE <main>, nearer the suspending route, so the
// chrome survives and only the content area swaps. This rail fails if that
// boundary is removed or hoisted above the nav: the outer fallback would take
// over and the nav marker would disappear.
import { Suspense, useState } from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import Layout from './Layout'

vi.mock('./NavBar', () => ({ default: () => <div data-testid="nav-marker">nav</div> }))
vi.mock('./MobileNav', () => ({ default: () => null }))
vi.mock('./FeedbackWidget', () => ({ default: () => null }))
vi.mock('./mobile/MoreSheet', () => ({ default: () => null }))
vi.mock('./mobile/TickerHubSheet', () => ({ default: () => null }))
vi.mock('../hooks/usePreferences', () => ({ default: () => ({ prefs: {} }) }))
vi.mock('../lib/barsPackClient', () => ({ initBarsPack: () => {} }))

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => ({}) })) })
afterEach(() => { vi.restoreAllMocks() })

// A route body that suspends until we let it finish — the stand-in for a page
// chunk still downloading.
function makeSuspendingPage() {
  let release
  const promise = new Promise((res) => { release = res })
  let done = false
  function Page() {
    if (!done) throw promise
    return <div data-testid="page-content">the page</div>
  }
  return { Page, release: async () => { done = true; release(); await promise } }
}

function renderShell(Page) {
  return render(
    <MemoryRouter initialEntries={['/options-flow']}>
      {/* stands in for App.jsx's route-level boundary */}
      <Suspense fallback={<div data-testid="app-splash">Loading page</div>}>
        <Layout><Page /></Layout>
      </Suspense>
    </MemoryRouter>,
  )
}

test('a page still loading does NOT take the app shell down with it', async () => {
  const { Page, release } = makeSuspendingPage()
  renderShell(Page)

  // The whole point: chrome stays on screen while the route resolves.
  expect(screen.getByTestId('nav-marker')).toBeTruthy()
  // ...and the full-screen splash never gets a turn.
  expect(screen.queryByTestId('app-splash')).toBeNull()
  // The content area holds itself open instead of collapsing.
  expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  expect(screen.queryByTestId('page-content')).toBeNull()

  await act(release)

  expect(screen.getByTestId('page-content')).toBeTruthy()
  expect(screen.getByTestId('nav-marker')).toBeTruthy()
  expect(document.querySelector('[aria-busy="true"]')).toBeNull()
})

test('CONTROL: without an inner boundary the same suspend DOES wipe the shell', () => {
  // Proves the assertions above can actually fail — this is the old behaviour,
  // rendered deliberately, so a green run is never green for the wrong reason.
  const { Page } = makeSuspendingPage()
  render(
    <MemoryRouter initialEntries={['/options-flow']}>
      <Suspense fallback={<div data-testid="app-splash">Loading page</div>}>
        <div data-testid="nav-marker">nav</div>
        <Page />
      </Suspense>
    </MemoryRouter>,
  )
  expect(screen.getByTestId('app-splash')).toBeTruthy()
  expect(screen.queryByTestId('nav-marker')).toBeNull()
})

test('a page that never suspends renders with no placeholder at all', () => {
  function Page() { return <div data-testid="page-content">instant</div> }
  renderShell(Page)
  expect(screen.getByTestId('page-content')).toBeTruthy()
  expect(screen.getByTestId('nav-marker')).toBeTruthy()
  expect(document.querySelector('[aria-busy="true"]')).toBeNull()
})

test('the boundary keeps working across a SECOND navigation, not just the first', async () => {
  const first = makeSuspendingPage()
  const { rerender } = renderShell(first.Page)
  await act(first.release)
  expect(screen.getByTestId('page-content')).toBeTruthy()

  const second = makeSuspendingPage()
  rerender(
    <MemoryRouter initialEntries={['/uct-20']}>
      <Suspense fallback={<div data-testid="app-splash">Loading page</div>}>
        <Layout><second.Page /></Layout>
      </Suspense>
    </MemoryRouter>,
  )
  expect(screen.getByTestId('nav-marker')).toBeTruthy()
  expect(screen.queryByTestId('app-splash')).toBeNull()
  await act(second.release)
  expect(screen.getByTestId('page-content')).toBeTruthy()
})

test('Layout still renders <Outlet/> when given no children', () => {
  // The children-vs-Outlet fork is what the boundary wraps; if a refactor drops
  // the Outlet branch, every real route renders nothing inside a live shell.
  render(<MemoryRouter initialEntries={['/dashboard']}><Layout /></MemoryRouter>)
  expect(screen.getByTestId('nav-marker')).toBeTruthy()
})
