/**
 * B6 — who can see the Joystick settings card.
 *
 * ⛔ WHY THE CONDITION IS NOT SIMPLY `isAdmin`. This card shipped to production UNGATED in PR #101
 * (`d3bf38f44`), so for the whole life of that deploy any member could open Settings and switch the
 * hub on. Hiding it from every member now would strand anyone already ON with no way off — the
 * exact defect CLAUDE.md records against this feature: *"A dismissable control needs a recovery
 * path IN THE SAME COMMIT — the joystick 'Hide' defect."* Taking away someone's only way back is
 * the same error as never giving them one.
 *
 * So the card is hidden from members who NEVER CHOSE, and visible to anyone who has ever chosen
 * either way. That needs no count of who opted in — a number nobody can read from the client —
 * because each user is judged against their own preference.
 *
 * ⭐ THE FOUR STATES BELOW ARE THE WHOLE CONTRACT, and the fifth is the one a `!== undefined`
 * condition would get wrong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { AuthContext } from '../../context/AuthContext'

// ⚠️ A mocked module namespace is a Proxy that THROWS on any export the mock omits, and
// `useHubSettings` imports `parsePref` directly — so the mock must provide it, with the REAL
// behaviour. Getting this wrong makes every case below fail for the wrong reason.
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

const { default: JoystickSettingsCard } = await import('./JoystickSettingsCard')

const TOGGLE = 'joystick-enabled-toggle'

function renderAs(role, prefs) {
  mockPrefs = prefs
  return render(
    <AuthContext.Provider value={{ user: role ? { role } : null }}>
      <JoystickSettingsCard />
    </AuthContext.Provider>,
  )
}

const shown = () => screen.queryByTestId(TOGGLE) !== null

beforeEach(() => { cleanup(); mockPrefs = {} })

describe('B6 — Joystick settings card visibility', () => {
  it('member who NEVER CHOSE: hidden', () => {
    renderAs('member', {})
    expect(shown(), 'a member who never opted in should not be offered the card').toBe(false)
  })

  it('member who explicitly chose TRUE: visible — the strand case', () => {
    // ⛔ THE LOAD-BEARING ONE. This member has the hub ON. Hiding the card takes away their only
    // way to turn it off, which is the CLAUDE.md defect this shape exists to avoid.
    renderAs('member', { joystick_hub: '{"enabled":true}' })
    expect(shown(), 'a member with the hub ON was stranded — no way to turn it off').toBe(true)
  })

  it('member who explicitly chose FALSE: visible — their way back ON', () => {
    renderAs('member', { joystick_hub: '{"enabled":false}' })
    expect(shown(), 'a member who turned it off lost their way back on').toBe(true)
  })

  it('admin who NEVER CHOSE: visible', () => {
    renderAs('admin', {})
    expect(shown(), 'an admin must always have the toggle').toBe(true)
  })

  // ── the fifth state: every shape of "never chosen" ────────────────────────────────────────
  it.each([
    ['key absent', {}],
    ['value null', { joystick_hub: null }],
    ['not valid JSON', { joystick_hub: '{oh no' }],
    ['parses to a non-object', { joystick_hub: 'true' }],
    ['object with no enabled', { joystick_hub: '{"handedness":"left"}' }],
    ['enabled explicitly null', { joystick_hub: '{"enabled":null}' }],
  ])('member, never chosen (%s): hidden', (_label, prefs) => {
    renderAs('member', prefs)
    expect(shown()).toBe(false)
  })

  it('⛔ `enabled: null` is NOT a choice — the case `!== undefined` would get wrong', () => {
    // `parsePref` folds four shapes to `undefined`, but `{"enabled":null}` yields null. A
    // condition written `storedEnabled !== undefined` admits it as a deliberate choice and shows
    // the card to a member who never made one.
    renderAs('member', { joystick_hub: '{"enabled":null}' })
    expect(shown(), 'null was treated as an explicit choice').toBe(false)
  })
})
