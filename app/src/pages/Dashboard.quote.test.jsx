// app/src/pages/Dashboard.quote.test.jsx
//
// ─── 🔴 THE QUOTE OF THE DAY RENDERED TWICE, EVERY WEEKEND ──────────────────
//
// Two tasks, each correct alone, and nobody owned the pair:
//   * Task 12 gave the quote a first-class panel inside `TheWeek`, the WEEKEND
//     hero — which is what the spec asks for.
//   * The S4 fix gave Zone A its one-line quote on every session state — which
//     is also what the spec asks for.
// On a Saturday both fire, from the SAME `useQuoteOfTheDay`, on the same day,
// with the same string. And because that hook falls back to a local rotation
// when the endpoint is unavailable, `quote` is ALWAYS truthy — the duplicate was
// guaranteed, not occasional. The mobile stack had the same shape through
// `FuturesStrip`'s own quote panel.
//
// ⭐ THE INVARIANT IS PER BRANCH, NOT PER PAGE. jsdom renders the desktop and
// mobile trees together (CSS hides one, and jsdom computes no CSS), so a naive
// page-wide count would report 2 on a weekday and call it a bug. Each branch is
// counted on its own, which is what a member actually sees.
import { renderWithProviders, screen, cleanup } from '../test-utils'
import { describe, test, expect, vi, afterEach } from 'vitest'

const QUOTE = 'MARKER-QUOTE-TEXT'

// ⛔ A HOISTED MUTABLE SESSION, NOT `vi.doMock` + `vi.resetModules()`.
// Dashboard.session.test.jsx can use the reset-and-dynamic-import idiom because
// it never mounts a provider; this file must, and a reset registry hands
// `renderWithProviders` an AuthProvider from the OLD module graph while the
// freshly-imported tree reads a NEW AuthContext — so `useAuth` throws
// "must be used within AuthProvider" on a tree that is correctly wrapped.
// `holiday` is the closure answer `useNextBoundary` hands the page: `true` on a
// NYSE full closure, `false` on a session day, `null` whenever the served
// calendar cannot say. Dashboard.jsx composes it with `session` to pick the
// hero, so it decides which surface owns the quote just as `session` does.
const h = vi.hoisted(() => ({ session: 'LIVE', holiday: null }))

vi.mock('../hooks/useQuoteOfTheDay', () => ({
  default: () => ({ quote: { t: QUOTE, a: 'Marker Author' }, label: null, source: 'server' }),
}))

// FuturesStrip renders its quote panel only once a snapshot has arrived, and
// TheWeek needs an article to render at all (it returns null with nothing to
// say). Both come through SWR wrappers; stub the data, not the components.
const SNAPSHOT = {
  futures: { BTC: { price: '67,105', chg: '+1.20%', css: 'pos' } },
  etfs: {
    QQQ: { price: '495.79', chg: '+0.50%', css: 'pos' },
    SPY: { price: '580.00', chg: '+0.40%', css: 'pos' },
    IWM: { price: '210.00', chg: '+0.10%', css: 'pos' },
    DIA: { price: '430.00', chg: '+0.20%', css: 'pos' },
    VIX: { price: '19.62', chg: '-3.30%', css: 'neg' },
  },
}
const DESK = { articles: [{ slug: 'sunday-scans-x', title: 'Sunday Scans', url: '#' }] }

const swrFor = (key) => {
  const k = String(key)
  if (k.includes('/api/snapshot')) return { data: SNAPSHOT }
  if (k.includes('/api/desk/articles')) return { data: DESK }
  return { data: null, error: null, isLoading: false, mutate: () => {} }
}

vi.mock('swr', () => ({
  default: (key) => swrFor(key),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('../hooks/useMobileSWR', () => ({ default: (key) => swrFor(key) }))

vi.mock('./dashboard/useSessionState', () => ({
  default: () => h.session,
  resolveSession: () => h.session,
  nextBoundary: () => ({ kind: 'close', ms: 0 }),
  formatCountdown: () => '0m',
  useNextBoundary: () => ({ kind: 'close', ms: 0, label: 'Closes in 0m', holidayToday: h.holiday }),
}))

import Dashboard from './Dashboard'

afterEach(cleanup)

function renderAt(session, holiday = null) {
  h.session = session
  h.holiday = holiday
  // ⛔ renderWithProviders, not a bare MemoryRouter: with a real snapshot in
  // hand FuturesStrip renders real cells, and TickerPopup reads AuthContext.
  renderWithProviders(<Dashboard />)
}

/** How many times the quote's text appears inside one branch of the page. */
const countIn = (selector) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`branch ${selector} is not on the page`)
  return el.textContent.split(QUOTE).length - 1
}

describe('the Quote of the Day appears exactly once per session state', () => {
  for (const session of ['PREMARKET', 'LIVE', 'CLOSED', 'WEEKEND']) {
    test(`${session}: once in the desktop cockpit`, () => {
      renderAt(session)
      expect(countIn('[class*="desktopOnly"]'),
        session === 'WEEKEND'
          ? 'Zone A rendered its one-liner alongside TheWeek’s panel — the '
            + 'same quote twice on the paid home'
          : 'the weekday quote is missing or doubled in Zone A')
        .toBe(1)
    })

    test(`${session}: once in the mobile stack`, () => {
      renderAt(session)
      expect(countIn('[class*="mobileOnly"]'),
        'FuturesStrip’s quote panel and TheWeek’s panel both rendered')
        .toBe(1)
    })
  }
})

describe('the controls that keep this honest', () => {
  test('WEEKEND really is the state where TheWeek owns the quote', () => {
    // If the weekend hero stopped rendering a quote at all, "exactly once"
    // above would be satisfied by Zone A alone and the spec item would be
    // silently gone. Anchor on TheWeek's own panel heading.
    renderAt('WEEKEND')
    expect(screen.getAllByText(/quote of the day/i).length).toBeGreaterThan(0)
  })

  test('and a weekday does NOT render that panel heading in the cockpit', () => {
    // The mirror: on a weekday the quote is Zone A's one-liner, which carries no
    // heading — so a heading in the desktop branch would mean TheWeek leaked
    // into a weekday state.
    renderAt('LIVE')
    const desktop = document.querySelector('[class*="desktopOnly"]')
    expect(desktop.textContent).not.toMatch(/quote of the day/i)
    // …while the quote itself is still there, as one line.
    expect(countIn('[class*="desktopOnly"]')).toBe(1)
  })
})

// ─── 🔴 THE SAME PAIR, ONE STATE FURTHER ────────────────────────────────────
//
// The duplicate above was "two tasks each correct alone, and nobody owned the
// pair". Making Zone B holiday-aware adds a THIRD composition in which
// `TheWeek` owns the quote — and the two suppression flags were written as
// `session === 'WEEKEND'`, which is still LIVE on Labor Day. Gating them on the
// raw session would have re-created the exact defect this file exists for, on
// every closure, while every assertion above stayed green.
describe('a market closure is a THIRD state where TheWeek owns the quote', () => {
  for (const session of ['PREMARKET', 'LIVE', 'CLOSED']) {
    test(`${session} on a closure: once in the desktop cockpit`, () => {
      renderAt(session, true)
      expect(countIn('[class*="desktopOnly"]'),
        'Zone A rendered its one-liner alongside TheWeek’s panel — the same '
        + 'quote twice, because the suppression flag read `session` instead of '
        + 'the hero the page actually chose')
        .toBe(1)
    })

    test(`${session} on a closure: once in the mobile stack`, () => {
      renderAt(session, true)
      expect(countIn('[class*="mobileOnly"]'),
        'FuturesStrip’s quote panel and TheWeek’s panel both rendered')
        .toBe(1)
    })
  }

  test('and it really is TheWeek’s panel that survives, not Zone A’s line', () => {
    // Without this, "exactly once" is satisfied by the weekday arrangement —
    // Zone A's one-liner over a Zone B that never swapped at all.
    renderAt('LIVE', true)
    const desktop = document.querySelector('[class*="desktopOnly"]')
    expect(desktop.textContent).toMatch(/quote of the day/i)
  })

  test('CONTROL: the same session with the calendar saying NOT a closure is unchanged', () => {
    renderAt('LIVE', false)
    const desktop = document.querySelector('[class*="desktopOnly"]')
    expect(desktop.textContent).not.toMatch(/quote of the day/i)
    expect(countIn('[class*="desktopOnly"]')).toBe(1)
  })
})
