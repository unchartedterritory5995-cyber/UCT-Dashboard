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
 *
 * ⚰️⚰️ STAGE-AWARE SINCE 2026-09-13, AND IT WAS THE FULL GATE THAT CAUGHT IT. Eight cases here
 * asserted "a member who never chose gets NO card" — the STAGE-1 rule. `ROLLOUT_STAGE = 2` makes
 * that false on purpose: at member preview every member has the hub, so every member must be able
 * to reach the switch that turns it off. Hiding the card at stage 2 would be the *original* strand
 * defect with the polarity flipped. ⛔ These cases were red in the six-shard gate while a
 * `src/hub`-scoped run was green, because this file is not under `src/hub` — which is exactly why
 * `vitest.hubGlob.js` now lists it (see that file, and CLAUDE.md → Testing).
 *
 * ⛔ THE EXPECTATIONS BRANCH ON THE STAGE BUT ARE STILL LITERALS. `MEMBER_PREVIEW` is read from
 * `ROLLOUT_STAGE`, so this file needs no edit at stage 3 (where exposure is unchanged) — but each
 * branch asserts `true`/`false` outright rather than calling `cardVisible()` for the answer. A test
 * that asks the implementation what to expect agrees with it by construction and would have stayed
 * green through the very change it exists to catch.
 *
 * ⛔ THE KILL SWITCH IS NOT ASSERTED HERE, DELIBERATELY. `HUB_PREVIEW_ENABLED=false` is read in
 * `hub/useHubActive.js:56` and removes the HUB; this card does not consult it (it imports only
 * `cardVisible`), so a member whose hub is killed still sees the preference control. That is
 * already railed, five ways, in `hub/hubKillSwitch.test.jsx` — including that the flag outranks a
 * stored `enabled:true`. Restating it here would be a second copy of one guard
 * (`lesson_a_guard_repeated_is_a_guard_unproved`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { AuthContext } from '../../context/AuthContext'
import { ROLLOUT_STAGE } from '../../hub/rolloutStage'

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
/** The toggle's own state. At stage >= 2 PRESENCE stops discriminating, so this does. */
const checked = () => screen.getByTestId(TOGGLE).checked

/** Stage 1 = admin preview. Stage >= 2 = every authenticated user has the hub AND the card. */
const MEMBER_PREVIEW = ROLLOUT_STAGE >= 2

beforeEach(() => { cleanup(); mockPrefs = {} })

describe('B6 — Joystick settings card visibility', () => {
  it(`member who NEVER CHOSE: ${MEMBER_PREVIEW ? 'VISIBLE — they have the hub' : 'hidden'}`, () => {
    renderAs('member', {})
    if (MEMBER_PREVIEW) {
      expect(shown(), 'at member preview this member HAS the hub, and hiding the card leaves them '
        + 'no way to turn it off — the strand defect, with the polarity flipped').toBe(true)
    } else {
      expect(shown(), 'a member who never opted in should not be offered the card').toBe(false)
    }
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
  ])('member, never chosen (%s)', (_label, prefs) => {
    renderAs('member', prefs)
    if (MEMBER_PREVIEW) {
      // ⭐ AT STAGE >= 2 PRESENCE CANNOT DISCRIMINATE — the card is there for everyone — so the
      // property this case exists for moves to the TOGGLE'S STATE. "Never chosen" means the unset
      // default applies, which at member preview is ON. A shape wrongly read as a choice would
      // instead render the stored value.
      expect(shown()).toBe(true)
      expect(checked(), 'this shape was treated as an explicit choice, so the unset default did '
        + 'not apply').toBe(true)
    } else {
      expect(shown()).toBe(false)
    }
  })

  it('⛔ `enabled: null` is NOT a choice — the case `!== undefined` would get wrong', () => {
    // `parsePref` folds four shapes to `undefined`, but `{"enabled":null}` yields null. A
    // condition written `storedEnabled !== undefined` admits it as a deliberate choice.
    renderAs('member', { joystick_hub: '{"enabled":null}' })
    if (MEMBER_PREVIEW) {
      // ⛔ THE DISCRIMINATOR, AND IT IS THE POINT OF THE WHOLE CASE: `{"enabled":null}` must behave
      // like "never chose" (unset default -> ON), while `{"enabled":false}` is a real choice and
      // stays OFF. If `null` were admitted as a choice both would render unchecked and this
      // comparison would collapse.
      expect(checked(), 'null was treated as an explicit choice').toBe(true)
      cleanup()
      renderAs('member', { joystick_hub: '{"enabled":false}' })
      expect(checked(), 'an explicit false must still win over the stage default').toBe(false)
    } else {
      expect(shown(), 'null was treated as an explicit choice').toBe(false)
    }
  })

  // ── the negative control: nobody is signed in ─────────────────────────────
  it('⛔ NEGATIVE CONTROL — a signed-out visitor gets no card at any stage', () => {
    // ⭐ Without this, every assertion above is compatible with a card that renders for literally
    // anyone. `renderAs(null, …)` passes `user: null`, the shape `AuthContext` holds before a
    // session exists.
    renderAs(null, {})
    expect(shown(), 'the settings card rendered with no authenticated user').toBe(false)

    // …and it is not merely that the prefs were empty: a signed-out visitor with a stored
    // preference is still not offered the card.
    cleanup()
    renderAs(null, { joystick_hub: '{"enabled":true}' })
    expect(shown(), 'a signed-out visitor with a stored preference reached the card').toBe(false)
  })
})
