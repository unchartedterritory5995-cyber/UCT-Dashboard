// app/src/pages/Dashboard.heroMount.test.jsx
//
// ⛔ THE HERO IS MOUNTED ONCE IN A BROWSER, AND EXACTLY ONE COPY OWNS THE HUB.
//
// `Dashboard.jsx` renders the session hero from both its desktop cockpit and its mobile stack,
// and CSS hides one. `display: none` does not unmount, so until 2026-09-11 `CatalystTable` — with
// its poll, live-price subscription, flagged sync, logos and hub hook — ran TWICE on every visit,
// doubling the cost of the render loop that froze navigation the night before. The hidden
// branch's hero is now pruned by `useCssDisplayed`, measured off the computed style.
//
// jsdom applies no stylesheets, so both branches read as shown here — which is the case the
// ownership rule still has to hold for: when both are shown, the MOBILE copy owns the hub. The
// browser case is exercised by hiding a branch with an inline style and re-measuring.
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('swr', () => ({
  default: () => ({ data: null, error: null, isLoading: false }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('./dashboard/useSessionState', () => ({
  default: () => 'LIVE',
  resolveSession: () => 'LIVE',
  nextBoundary: () => ({ kind: 'close', ms: 0 }),
  formatCountdown: () => '0m',
  useNextBoundary: () => ({ kind: 'close', ms: 0, label: 'Closes in 0m', holidayToday: false }),
}))
vi.mock('./dashboard/TheWeek', () => ({ default: () => <div>THE WEEK</div> }))
vi.mock('../components/tiles/CatalystTable', () => ({
  default: ({ hubScope }) => <div data-hero data-owns={String(!!hubScope)}>CATALYSTS</div>,
}))

afterEach(cleanup)

async function renderDashboard() {
  const { default: Dashboard } = await import('./Dashboard')
  return render(<MemoryRouter><Dashboard /></MemoryRouter>)
}

const heroes = () => Array.from(document.querySelectorAll('[data-hero]'))
const owners = () => heroes().filter((h) => h.getAttribute('data-owns') === 'true')

describe('the session hero: one mount per visible branch, one hub owner', () => {
  it('⛔ with no stylesheet (jsdom) both branches show and the MOBILE copy owns the hub', async () => {
    await renderDashboard()
    expect(heroes().length).toBe(2)
    expect(owners().length, 'two copies claim the hub — the cursor would address whichever tree '
      + 'came first in the document').toBe(1)
    const owner = owners()[0]
    expect(owner.closest('[class*="mobileOnly"]'), 'the owner is not the mobile copy').not.toBeNull()
  })

  it('⛔⛔ hiding the mobile branch (a desktop or tablet viewport) leaves ONE hero, and it owns the hub', async () => {
    await renderDashboard()
    const mobile = document.querySelector('[class*="mobileOnly"]')
    expect(mobile).not.toBeNull()
    act(() => {
      mobile.style.display = 'none'
      window.dispatchEvent(new Event('resize'))
    })
    expect(heroes().length, 'the hidden branch still mounts a hero — two live tiles again').toBe(1)
    expect(heroes()[0].closest('[class*="desktopOnly"]')).not.toBeNull()
    expect(owners().length, 'the only visible copy must own the hub — on a tablet the old rule '
      + 'handed it to a display:none tree').toBe(1)
  })

  it('⛔⛔ hiding the desktop branch (a phone) leaves ONE hero in the mobile stack, owning the hub', async () => {
    await renderDashboard()
    const desktop = document.querySelector('[class*="desktopOnly"]')
    act(() => {
      desktop.style.display = 'none'
      window.dispatchEvent(new Event('resize'))
    })
    expect(heroes().length).toBe(1)
    expect(heroes()[0].closest('[class*="mobileOnly"]')).not.toBeNull()
    expect(owners().length).toBe(1)
  })

  it('a branch that becomes visible again gets its hero back', async () => {
    await renderDashboard()
    const desktop = document.querySelector('[class*="desktopOnly"]')
    act(() => { desktop.style.display = 'none'; window.dispatchEvent(new Event('resize')) })
    expect(heroes().length).toBe(1)
    act(() => { desktop.style.display = ''; window.dispatchEvent(new Event('resize')) })
    expect(heroes().length).toBe(2)
    expect(screen.getAllByText('CATALYSTS').length).toBe(2)
  })
})
