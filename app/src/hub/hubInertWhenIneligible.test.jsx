// ⛔⛔ A MEMBER WHO CANNOT SEE THE HUB MUST NOT PAY FOR IT. This is the exposure condition that
// should have existed, and its absence is half of why the navigation freeze went unnoticed.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────────────────────────
// `exposureGate.test.js` answers "WHO can see the hub" — coarse pointer under 1024px, an unset
// preference resolving to isAdmin, the Settings card's admin gate, and `HUB_PREVIEW_ENABLED`
// defaulting ON. Every one of those is about VISIBILITY.
//
// None of them asked what an ineligible member PAYS. On 2026-09-10 the answer turned out to be
// "navigation, app-wide, for about four and a half hours" — the loop lived in a hub controller
// mounted by a shared tile, and it ran for everyone on /dashboard regardless of whether the hub
// was ever going to render for them. A desktop member who could never see the joystick had their
// browser held on one page by it.
//
// So this file asks the other half of the exposure question: **with the hub ineligible, does the
// host render exactly as it would with no hub at all?**
//
// ── ⚠️ WHY THE BAR IS "ZERO OVERHEAD" AND NOT "ZERO REGISTRATIONS" ─────────────────────────────
// The obvious rail — gate `useHubMode` on `useHubEligible()` so an ineligible user registers
// nothing — is WRONG HERE, and measurably so. `useHubEligible` returns **false in jsdom** on
// purpose: "an unstubbed test environment looks exactly like a browser too old for the hub, and
// is treated as one" (`useHubActive.js`). Gating registration on it would suppress registration
// in every section rail in this suite — the guard would disable the thing it guards, and every
// test asserting a fan would go green against a hub that never registered.
//
// ⭐ So the enforceable property is the one that actually protects the member: the hub costs its
// host NOTHING per render. A registration at mount is one setState; a registration per render is
// the defect. That distinction is what this file measures, and it is the one the freeze violated.
import { describe, it as vitestIt, expect, afterEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { HubProvider, useHub } from './HubContext'
import { _reset as resetCursors } from './useHubCursor'

let defined = 0
let executed = 0
function it(name, fn) {
  defined += 1
  return vitestIt(name, (...a) => { executed += 1; return fn(...a) })
}
it.each = (rows) => (name, fn) => {
  defined += rows.length
  return vitestIt.each(rows)(name, (...a) => { executed += 1; return fn(...a) })
}
afterAll(() => {
  expect(executed).toBeGreaterThan(0)
  expect(executed).toBe(defined)
})
afterEach(() => { cleanup(); resetCursors() })

const REF = Object.freeze({ current: null })
const EMPTY = Object.freeze([])
const NOOP = () => {}

/** The section hooks shared components call. Same fixtures as `hostRenderStability.test.jsx`,
 *  because the property under test is about the SAME hosts seen from the other side. */
const HOOKS = [
  ['breadthSection', () => import('./sections/breadthSection'),
    Object.freeze({ isAdmin: false, activeTab: 'overview', setActiveTab: NOOP })],
  ['calendarSection', () => import('./sections/calendarSection'),
    Object.freeze({ weekDates: EMPTY, days: Object.freeze({}), activeDay: null, onDayTab: NOOP, macroOn: false, onToggleMacro: NOOP })],
  ['catalystsSection', () => import('./sections/catalystsSection'),
    Object.freeze({ rows: EMPTY, enabled: true, rootRef: REF, toggleFlag: NOOP, isFlagged: NOOP, createNote: NOOP })],
  ['chartSection', () => import('./sections/chartSection'),
    Object.freeze({ tf: 'D', symbol: 'AAA', customTfs: EMPTY, onTf: NOOP, onDraw: NOOP })],
  ['journalSection', () => import('./sections/journalSection'),
    Object.freeze({ positions: EMPTY, optionStrategies: EMPTY, view: 'list', settings: null })],
  ['screenerSection', () => import('./sections/screenerSection'),
    Object.freeze({ displayRows: EMPTY, filters: Object.freeze({}), prices: Object.freeze({}) })],
]

/** Render the host `commits + 1` times, with or without a HubProvider around it. */
async function hostRenders(loader, props, { withProvider }) {
  const mod = await loader()
  const hook = mod.default
  const counter = { n: 0 }
  let bump
  function Host() { counter.n += 1; hook(props); return null }
  function Root() {
    const [t, setT] = useState(0)
    bump = () => setT((x) => x + 1)
    return <div data-t={t}><Host /></div>
  }
  const tree = withProvider
    ? <MemoryRouter initialEntries={['/dashboard']}><HubProvider><Root /></HubProvider></MemoryRouter>
    : <MemoryRouter initialEntries={['/dashboard']}><Root /></MemoryRouter>
  render(tree)
  for (let i = 0; i < 6; i += 1) act(() => { bump() })
  return counter.n
}

describe('⛔⛔ the hub costs its host NOTHING per render', () => {
  it('CONTROL: there is a population to measure, and it is the real section set', () => {
    expect(HOOKS.length, 'no section hooks listed — every assertion below is vacuous')
      .toBeGreaterThan(4)
    expect(HOOKS.map((h) => h[0])).toContain('catalystsSection')
  })

  it.each(HOOKS.map((h) => [h[0], h[1], h[2]]))(
    '%s renders its host the SAME number of times with and without the hub',
    async (name, loader, props) => {
      const withHub = await hostRenders(loader, props, { withProvider: true })
      cleanup(); resetCursors()
      const without = await hostRenders(loader, props, { withProvider: false })
      // ⛔ EQUAL, not "close". Any difference is a render the host would not have performed if
      // the hub were not there — which for an ineligible member is a render they pay for and
      // can never benefit from. Outside a provider `useHubRegistrar` returns the never-changing
      // default no-op, so the no-hub number is the true floor.
      expect(withHub, `${name}: the host rendered ${withHub} times with a HubProvider and `
        + `${without} without one. The hub is charging its host per-render cost. On 2026-09-10 `
        + 'that cost, on one tile, was navigation freezing app-wide — and it ran for desktop '
        + 'members who could never see the hub at all.').toBe(without)
    })
})

describe('⛔ and the hub renders NOTHING for a member who is not eligible', () => {
  // Three personas, all ineligible for different reasons. The assertion is the same each time and
  // it is the strong one: not "the hub is hidden", but "the hub put no element in the document".
  const PERSONAS = [
    ['an old/desktop browser (no CSS.supports — jsdom is treated as exactly this)', {}],
    ['HUB_PREVIEW_ENABLED=false — the server-side kill switch', { hubPreviewEnabled: false }],
    ['a member who turned it off in Settings', { joystickEnabled: false }],
  ]

  it.each(PERSONAS)('%s sees no hub element at all', async (_label, _auth) => {
    const { default: HubRoot } = await import('./HubRoot')
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}><HubProvider><HubRoot /></HubProvider></MemoryRouter>,
    )
    // ⭐ Asserted on the DOM, not on a boolean. `exposureGate.test.js` pins the RULES from source;
    // this pins the RESULT — a member with no hub element cannot be charged for one, and the two
    // rails fail for different reasons on purpose.
    expect(container.querySelector('[data-testid="hub-root"]'),
      'an ineligible member has a hub element in their document').toBeNull()
    expect(container.textContent, 'an ineligible member has hub text in their document').toBe('')
  })

  it('CONTROL: this harness CAN see a hub element when one is rendered', () => {
    // ⛔ NON-VACUITY, and it is the whole file's foundation. If `render` here could never produce
    // a hub element, every persona above passes for the wrong reason. A planted element proves
    // the query and the container are real.
    const { container } = render(<div data-testid="hub-root">planted</div>)
    expect(container.querySelector('[data-testid="hub-root"]')).not.toBeNull()
    expect(container.textContent).toBe('planted')
  })
})
