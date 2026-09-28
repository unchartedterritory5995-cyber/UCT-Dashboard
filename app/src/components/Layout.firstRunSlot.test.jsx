// app/src/components/Layout.firstRunSlot.test.jsx
//
// Wave 10 follow-up F5: Layout keeps ONE empty element at the top of <main> -- the
// first-run slot -- and registers it with components/firstRun/firstRunStage.js. The
// voice orb's one-time "Meet Compass" card is portaled into it, so the card sits in
// the page flow above the page instead of floating over a control (proof walk 10E-1
// 6b, design review D-2). This rails the host half: the slot exists, it is the FIRST
// thing in <main> (above the page, never inside a route's own layout), it is the
// element the store hands out, and it is forgotten when the shell unmounts.
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import Layout from './Layout'
import { getFirstRunSlot } from './firstRun/firstRunStage'

vi.mock('./NavBar', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => <div data-testid="nav-marker">nav</div>,
}))
vi.mock('./MobileNav', () => ({ default: () => null }))
vi.mock('./FeedbackWidget', () => ({ default: () => null }))
vi.mock('./mobile/MoreSheet', () => ({ default: () => null }))
vi.mock('./mobile/TickerHubSheet', () => ({ default: () => null }))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {} }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))
vi.mock('../lib/barsPackClient', () => ({ initBarsPack: () => {} }))

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => ({}) })) })
afterEach(() => { vi.restoreAllMocks() })

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/journal/notebook']}>
      <Layout><div data-testid="page-content">the page</div></Layout>
    </MemoryRouter>,
  )
}

test('the first-run slot is the first child of <main>, above the page', () => {
  const { container } = renderShell()
  const main = container.querySelector('main')
  expect(main, 'the shell renders its <main>').not.toBeNull()
  const slot = main.querySelector('[data-first-run-slot]')
  expect(slot, 'the slot exists').not.toBeNull()
  expect(main.firstElementChild, 'first thing in <main>').toBe(slot)
  // Non-vacuity: the page really is in the same <main>, AFTER the slot.
  const page = main.querySelector('[data-testid="page-content"]')
  expect(page).not.toBeNull()
  expect(slot.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('the slot is empty (it takes no space until a card is portaled into it)', () => {
  const { container } = renderShell()
  const slot = container.querySelector('main [data-first-run-slot]')
  expect(slot.childNodes.length).toBe(0)
  expect(slot.getAttribute('style')).toBeNull()
})

test('the store hands out exactly this element, and forgets it when the shell unmounts', () => {
  const { container, unmount } = renderShell()
  expect(getFirstRunSlot()).toBe(container.querySelector('main [data-first-run-slot]'))
  unmount()
  expect(getFirstRunSlot()).toBe(null)
})
