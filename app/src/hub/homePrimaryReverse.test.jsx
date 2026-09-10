// Home's Primary and Reverse — §C3:905, and the one rule that is easy to get backwards.
//
//     "- Primary: last-used section. Reverse: Morning Wire."
//     "- On a first-ever visit with nothing stored, Primary is inert — disabled, no navigation.
//        Defaulting it to Wire was rejected: Primary and Reverse would fire the same destination
//        on a new account, which reads as a bug rather than a design."
//
// ⛔⛔ THE TRAP, AND IT IS ONE LINE AWAY FROM THE OBVIOUS IMPLEMENTATION. `homeSection` already
// computes `items = recentSections(lastSection)` for the scrub, and `items[0]` looks exactly like
// "the last-used section". It is not. `recentSections(null)` returns the FULL declared order —
// there is nothing to promote, so nothing is promoted — which means `items[0]` on a first-ever
// visit is simply the first route-backed section in registry order. Wiring Primary to `items[0]`
// would navigate a brand-new member somewhere arbitrary while reading as correct in every test
// that happened to seed a `lastSection`.
//
// So `onTap` reads `lastSection` DIRECTLY, and these tests pin the inert case first.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import useHomeSection, { recentSections, DECLARED_SECTION_ORDER } from './sections/homeSection'

let lastSection = null
let pathname = '/dashboard'
const registered = { current: null }

vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname }) }))
vi.mock('./HubContext', () => ({ useHub: () => ({ lastSection }) }))
vi.mock('./useHubMode', () => ({ default: (config) => { registered.current = config } }))
vi.mock('./useHubCursor', () => ({
  default: () => ({ index: 0, count: 0, itemProps: () => ({}) }),
}))

const ctx = () => ({ navigate: vi.fn(), mode: 'home', symbol: null })

beforeEach(() => { lastSection = null; pathname = '/dashboard'; registered.current = null })
afterEach(() => vi.clearAllMocks())

/** Mount the section and hand back whatever it registered with the hub. */
function mount() {
  renderHook(() => useHomeSection())
  return registered.current
}

describe("Home's Primary (tap) and Reverse (double-tap)", () => {
  it('the trap is real — recentSections(null) does NOT yield an empty list', () => {
    // ⭐ NON-VACUITY FOR THE INERT TEST BELOW. If `recentSections(null)` returned [], then
    // "items[0] is undefined" would make Primary inert by accident, and the inert assertion would
    // pass without anyone having decided anything. It returns the full order, so the inert
    // behaviour has to be a real decision in the code.
    const items = recentSections(null)
    expect(items.length, 'nothing to promote should still yield the declared order')
      .toBe(DECLARED_SECTION_ORDER.length)
    expect(items[0], 'items[0] with nothing stored is a REAL section id — which is exactly why '
      + 'Primary must not use it').toBeTruthy()
  })

  it('⛔⛔ INERT on a first-ever visit — nothing stored, nothing happens', () => {
    lastSection = null
    const c = mount()
    const k = ctx()
    c.onTap(k)
    expect(k.navigate, 'Primary navigated with nothing stored. §C3 rejects defaulting it — a new '
      + 'account would have Primary and Reverse firing the same destination, which reads as a bug. '
      + 'The likely cause is reading items[0] instead of lastSection.').not.toHaveBeenCalled()
  })

  it('⛔ INERT when the stored value is not a route-backed section', () => {
    // A stale or hand-edited preference must not navigate somewhere the registry does not own.
    lastSection = 'not-a-real-section'
    const c = mount()
    const k = ctx()
    c.onTap(k)
    expect(k.navigate).not.toHaveBeenCalled()
  })

  it('⛔ Primary navigates to the LAST-USED section, by mode id', () => {
    const target = DECLARED_SECTION_ORDER[DECLARED_SECTION_ORDER.length - 1]
    lastSection = target
    const c = mount()
    const k = ctx()
    c.onTap(k)
    expect(k.navigate, `tap should navigate to the stored section (${target})`)
      .toHaveBeenCalledWith(target)
  })

  it('⛔ Reverse goes to Morning Wire, and is NEVER inert', () => {
    // Reverse is a fixed destination: it needs nothing stored, so it works on a brand-new account —
    // which is the whole reason §C3 refuses to let Primary default to the same place.
    lastSection = null
    const c = mount()
    const k = ctx()
    c.onDoubleTap(k)
    expect(k.navigate, 'Reverse must work with nothing stored').toHaveBeenCalledWith('wire')
  })

  it('⛔ Primary and Reverse never fire the same destination — the §C3 rejection, as a test', () => {
    // The stated reason defaulting Primary was rejected. With a stored section they must differ;
    // with nothing stored Primary is silent, so they cannot collide either.
    lastSection = 'wire'
    const c = mount()
    const a = ctx(); const b = ctx()
    c.onTap(a)
    c.onDoubleTap(b)
    const primary = a.navigate.mock.calls[0]?.[0] ?? null
    const reverse = b.navigate.mock.calls[0]?.[0] ?? null
    // `wire` stored is the one case where they legitimately coincide — the member's last section
    // IS Wire. That is a true answer, not the rejected default, and the distinction is the point.
    expect(reverse).toBe('wire')
    expect(primary).toBe('wire')

    lastSection = 'journal'
    const c2 = mount()
    const a2 = ctx(); const b2 = ctx()
    c2.onTap(a2); c2.onDoubleTap(b2)
    expect(a2.navigate.mock.calls[0][0], 'Primary must follow the stored section, not a default')
      .toBe('journal')
    expect(b2.navigate.mock.calls[0][0]).toBe('wire')
  })

  it('registers nothing when the member is not on /dashboard', () => {
    pathname = '/screener'
    expect(mount(), 'Home must not register its callbacks off-route').toBeUndefined()
  })
})
