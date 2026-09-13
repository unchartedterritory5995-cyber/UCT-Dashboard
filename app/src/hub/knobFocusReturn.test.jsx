/**
 * D-46 — spec §C4:952: "Any action that opens a sheet returns focus to the knob on close."
 *
 * ⚰️ THAT SENTENCE WAS FALSE FOR THE LIFE OF THE FEATURE, and it took the full-scope
 * reconciliation to notice, because nothing failed: `components/mobile/Sheet.jsx:81` captures
 * `document.activeElement` when it opens and restores it at `:126`, so a sheet always restored
 * focus to SOMETHING and the behaviour looked implemented. On the gesture path nothing had been
 * focused, so the captured element was `<body>` and a closing sheet dropped a screen-reader user
 * at the top of the document.
 *
 * ⛔ THERE WERE TWO HALVES AND ONLY ONE WAS OBVIOUS. The missing focus CALL is the one a reader
 * predicts. Underneath it, `HubKnob`'s `<div role="button">` carried **no `tabIndex`**, and
 * `focus()` on such a node is a silent no-op — so shipping the call alone would have produced a
 * second no-op that tests written against `focus()` being *called* would have happily passed.
 * This file asserts `document.activeElement`, never that a spy ran.
 *
 * ⭐ THE MECHANISM IS PRE-FOCUS, NOT POST-CLOSE. `HubRoot` puts the knob into `activeElement`
 * BEFORE a sheet opens, so `Sheet.jsx`'s existing restore does the right thing with **no change to
 * `Sheet.jsx` at all** — one authority over focus restore instead of two. All four sheets the hub
 * can open (`HubConfirmSheet`, this button's, `StopConfirmSheet`, `PlanTradeSheet`) mount that
 * same component, so one call covers every path — including the two the Journal page mounts,
 * which this build may not edit (rule 12) and does not need to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { forwardRef } from 'react'
import { MemoryRouter } from 'react-router-dom'

import HubRoot from './HubRoot'
import { HubProvider } from './HubContext'
import { AuthContext } from '../context/AuthContext'

vi.mock('../hooks/usePreferences', () => ({
  // `useHubSettings.js:105` — unset `enabled` means admin-only, so the user below carries the
  // role rather than this stubbing `enabled` true and hiding which gate is being satisfied.
  default: () => ({ prefs: {}, setPrefMerged: vi.fn(), loading: false }),
  parsePref: () => ({}),
}))

// The pad is mocked only so a gesture is DRIVABLE; the knob, the Actions button and the sheet are
// all the real components, because they are the three things under test.
vi.mock('./HubPad', () => ({
  default: forwardRef(function MockHubPad(props, ref) {
    return <div ref={ref} data-testid="mock-hub-pad" {...props} />
  }),
}))
vi.mock('../components/FeedbackWidget', () => ({ default: () => null }))

function stubHubCapable() {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = {
    width: 375, height: 812, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: /max-width:\s*1023px/.test(q),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}

const renderHub = () => render(
  <AuthContext.Provider value={{ user: { id: 1, email: 'x@y.z', role: 'admin' }, hubPreviewEnabled: true }}>
    <MemoryRouter initialEntries={['/screener']}>
      <HubProvider>
        <HubRoot />
      </HubProvider>
    </MemoryRouter>
  </AuthContext.Provider>,
)

/** The knob, by the name a screen reader would read. */
const knob = () => screen.getByRole('button', { name: /^Joystick, / })

beforeEach(stubHubCapable)
afterEach(() => {
  cleanup()
  delete window.visualViewport
  vi.restoreAllMocks()
})

describe('D-46 — the knob is the focus destination §C4 always promised', () => {
  it('⛔ the knob is FOCUSABLE — the half that made the promise impossible', () => {
    renderHub()
    const el = knob()
    // `role="button"` alone is not focusable. Without tabIndex this is a no-op and every
    // assertion below would pass against a knob nobody can reach.
    expect(el.getAttribute('tabindex'), 'the knob has no tabIndex, so focus() cannot reach it')
      .toBe('-1')

    el.focus()
    expect(document.activeElement, 'the knob accepted focus but did not become activeElement')
      .toBe(el)
  })

  it('⭐ it is named "Joystick, <mode>" — what a screen reader reads on arrival', () => {
    renderHub()
    const name = knob().getAttribute('aria-label')
    // §C2 requires the knob be "named for the current mode"; the mode must actually be IN it.
    expect(name).toMatch(/^Joystick, .+/)
    expect(name, 'the name is the literal template, so `mode` never reached it')
      .not.toMatch(/\{|undefined/)
    // ⛔ THE CONTROL. The previous name was "<mode> mode" — a heading for the page rather than a
    // name for the control. If this file is ever "fixed" by relaxing the matcher, this line is
    // what notices.
    expect(name, 'the knob is still using the pre-D-46 name').not.toMatch(/ mode$/)
  })

  it('⛔ opening the Actions sheet puts the knob into activeElement FIRST', () => {
    renderHub()
    const el = knob()

    // NON-VACUITY: nothing is focused before the gesture, which is exactly the state that made
    // §C4 false. If this ever starts out focused, the assertion after it proves nothing.
    expect(document.activeElement, 'something already had focus — this test cannot show the change')
      .not.toBe(el)

    const actions = screen.getByRole('button', { name: /actions/i })
    act(() => { fireEvent.click(actions) })

    expect(document.activeElement, 'the hub did not focus the knob before opening its sheet')
      .toBe(el)
  })

  it('⭐ …so when the sheet CLOSES, focus is on the knob — the §C4 promise, end to end', () => {
    renderHub()
    const el = knob()
    const actions = screen.getByRole('button', { name: /actions/i })

    act(() => { fireEvent.click(actions) })
    // The sheet is genuinely open — otherwise "focus is on the knob" is true for the boring
    // reason that nothing ever happened.
    expect(document.querySelector('[role="dialog"]'), 'no sheet opened, so nothing was restored')
      .not.toBeNull()

    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })

    expect(document.querySelector('[role="dialog"]'), 'the sheet did not close').toBeNull()
    expect(document.activeElement, 'focus did not come back to the knob when the sheet closed')
      .toBe(el)
  })
})

// ── MUTATION PROOF, PERFORMED 2026-09-13 ───────────────────────────────────────────────────────
// Not a claim — two runs.
//
//   1. `tabIndex={-1}` removed from HubKnob.jsx:
//        × the knob is FOCUSABLE — expected null to be '-1'
//        × opening the Actions sheet puts the knob into activeElement FIRST
//        × …so when the sheet CLOSES, focus is on the knob
//      The NAME case stayed green, which is what proves the three reds came from focusability and
//      not from the harness failing to render.
//
//   2. `onBeforeOpen={focusKnob}` removed from HubRoot's <HubActionsButton>:
//        × opening the Actions sheet puts the knob into activeElement FIRST
//        × …so when the sheet CLOSES, focus is on the knob
//      The focusable and name cases stayed green — the knob was still reachable, nobody reached
//      for it. That is the original D-46 defect reproduced exactly.
//
// Both reverted by writing the original bytes back, never `git checkout`
// (`feedback_mutation_check_never_git_checkout`), and byte-compared.
