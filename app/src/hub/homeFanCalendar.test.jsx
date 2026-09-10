// Joystick hub — Phase 3 §3.8(b): Calendar is back on Home's fan, and the RENDERED fan is the
// thing asserted. See docs/plans/joystick/60-phase3-plan.md:331 ("Phase 3 adds the scrub (recent
// sections) and restores `Calendar` to the inner ring alongside `Wire`") and R-C
// (docs/plans/joystick/RESUME-inc3.md:24-26).
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ WHY THESE ASSERT `fanFor(home)` AND NOT `modesById.home.fan`
// ─────────────────────────────────────────────────────────────────────────────
// `home` is still in `PREVIEW_MODES`, so the fan a member actually sees is the PREVIEW_HOME
// projection, not the declared fan. The declared fan has carried `home.calendar` on ring 1 since
// Phase 1 — asserting there would have passed on the day Calendar was invisible on the product,
// which is the exact shape of "green suite, dead feature" this hub has already paid for twice.
//
// ⛔ AND WHY `validateRegistry` DOES NOT COVER THIS. It reads `mode.fan` (`registry.js:684-685`:
// `const outer = mode.fan.filter((a) => a.ring === 0)`), so the ring caps it enforces have never
// once been applied to a projection. Restoring Calendar took Home's projected inner ring to five
// against an `INNER_MAX` of 4 and NOTHING in the suite would have said so — that gap is what
// rail 2 below closes, for every preview mode rather than just this one.
//
// ⛔ "CALENDAR STAYS DARK" IS DELIBERATELY NOT RE-ASSERTED HERE. `hubWiring.test.jsx`'s "every
// non-Home mode STILL in the preview is exactly [Voice, Home]" already owns that claim and walks
// `calendar` on every run. A second copy here would be a guard repeated and therefore a guard
// unproved (`lesson_a_guard_repeated_is_a_guard_unproved`) — and one this file could not
// mutation-prove without editing `PREVIEW_MODES`, which this stream does not own.
//
// ⛔ RAIL (house convention — mirrors hubWiring.test.jsx / useJoystick.test.js):
// `vitest -t <regex>` is a regex filter, and a filter matching nothing exits 0 and reads as a
// PASS. `definedCount`/`executedCount` catch a `-t` typo or a stray `.only`/`.skip`.
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { forwardRef } from 'react'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => {
    executedCount += 1
    return fn(...args)
  })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

// ── Leaf mocks ──────────────────────────────────────────────────────────────
// ⭐ `HubFan` is deliberately NOT mocked — it is the component under test here. The bubble is the
// artifact a member touches, so a rail that stops at the registry proves the data and not the
// door. Everything else is stubbed exactly as `hubWiring.test.jsx` stubs it, so this file
// exercises the real HubRoot / HubContext / registry / fanGeometry / useJoystick chain.
let mockPrefs = {}
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged: vi.fn(), loading: false }),
  // A mocked module namespace is a Proxy that THROWS on any export the mock omits, and
  // useHubSettings.js imports `parsePref` directly.
  parsePref: (raw) => {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return undefined }
  },
}))

vi.mock('./HubPad', () => ({
  default: forwardRef(function MockHubPad(
    { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }, ref,
  ) {
    return (
      <div
        data-testid="mock-hub-pad"
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    )
  }),
}))
vi.mock('./HubKnob', () => ({ default: () => null }))
vi.mock('./HubChip', () => ({ default: () => null }))
vi.mock('./HubScrim', () => ({ default: () => null }))
vi.mock('./HubActionsButton', () => ({ default: () => null }))

/** Every capability HubRoot's own `useHubActive()` checks, forced ON — same shape as
 *  `hubWiring.test.jsx`'s `stubHubCapable`, so "the hub is active" means what HubRoot means. */
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
function unstubHubCapable() {
  delete globalThis.CSS
  delete window.visualViewport
  vi.unstubAllGlobals()
}

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="loc">{pathname}</div>
}

async function renderHub(route) {
  const { default: HubRoot } = await import('./HubRoot')
  const { HubProvider } = await import('./HubContext')
  return render(
    <MemoryRouter initialEntries={[route]}>
      <HubProvider>
        <HubRoot />
        <LocationProbe />
      </HubProvider>
    </MemoryRouter>,
  )
}

/** The exact inverse of `fanGeometry.pointerAngle` — same fixture idiom as useJoystick.test.js,
 *  rather than a second hand-typed table of coordinates. */
function vecAtAngle(dist, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — the projection places Calendar on the inner ring, beside Wire
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.8(b) — Calendar in the fan Home actually shows', () => {
  it('the RENDERED Home fan carries home.calendar on the inner ring, beside home.wire', async () => {
    const { modesById, fanFor, isPreviewMode, HOME_MODE_ID } = await import('./registry')

    // Non-vacuity: this whole file is about a PROJECTION, so if home ever leaves the preview the
    // assertions below stop measuring what they claim to and must be re-pointed at `mode.fan`.
    expect(isPreviewMode(HOME_MODE_ID),
      'home has left PREVIEW_MODES — fanFor now returns mode.fan and this rail is testing the '
      + 'declared fan, not the projection it was written for').toBe(true)

    const shown = fanFor(modesById.home)
    const ids = shown.map((a) => a.id)
    // Named members, never a count — a count passes over the wrong list.
    expect(ids).toContain('home.calendar')
    expect(ids).toContain('home.wire')

    const calendar = shown.find((a) => a.id === 'home.calendar')
    const wire = shown.find((a) => a.id === 'home.wire')
    expect(calendar.ring, 'Calendar must sit on the INNER ring (plan §3.8)').toBe(1)
    expect(wire.ring, 'Calendar is restored ALONGSIDE Wire — both inner').toBe(1)

    // The door, not the mode: it navigates to the calendar mode, which stays dark.
    expect(calendar.kind).toBe('navigate')
    expect(calendar.to).toBe('calendar')
    expect(modesById.calendar.route).toBe('/calendar')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2 — the ring caps, applied to the PROJECTION (validateRegistry never does)
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.8(b) — the ring caps hold for the fan that is SHOWN, not just the one declared', () => {
  it('every preview mode\'s projected fan is within OUTER_MAX / INNER_MAX', async () => {
    const { modes, fanFor, isPreviewMode, OUTER_MAX, INNER_MAX } = await import('./registry')

    let checked = 0
    const problems = []
    for (const mode of modes) {
      if (!isPreviewMode(mode.id)) continue
      checked += 1
      const shown = fanFor(mode)
      const outer = shown.filter((a) => a.ring === 0).length
      const inner = shown.filter((a) => a.ring === 1).length
      if (outer > OUTER_MAX) problems.push(`${mode.id}: projected outer ${outer} > ${OUTER_MAX}`)
      if (inner > INNER_MAX) problems.push(`${mode.id}: projected inner ${inner} > ${INNER_MAX}`)
    }
    expect(problems, 'a projected fan is over a ring cap — validateRegistry reads mode.fan and '
      + 'cannot see this').toEqual([])

    // Non-vacuity: an empty preview set would make the loop above assert nothing at all.
    expect(checked, 'no preview mode was walked — this rail is asserting nothing')
      .toBeGreaterThan(0)
  })

  it('Home\'s projected rings are exactly 5 outer / 4 inner — both legal, both at the line', async () => {
    const { modesById, fanFor, OUTER_MAX, INNER_MAX } = await import('./registry')
    const shown = fanFor(modesById.home)
    const outer = shown.filter((a) => a.ring === 0).map((a) => a.id)
    const inner = shown.filter((a) => a.ring === 1).map((a) => a.id)

    expect(outer.length, `outer ring: ${outer.join(', ')}`).toBe(5)
    expect(inner.length, `inner ring: ${inner.join(', ')}`).toBe(4)
    expect(outer.length).toBeLessThanOrEqual(OUTER_MAX)
    expect(inner.length).toBeLessThanOrEqual(INNER_MAX)

    // Home is the ONE mode whose inner ring does not end with Home — Voice ends it instead
    // (registry.js:479, `validateRegistry`'s HOME_MODE_ID branch). Restoring Calendar must not
    // have pushed Voice out of last place.
    expect(inner[inner.length - 1]).toBe('home.voice')
    expect(shown.some((a) => a.kind === 'home'),
      'the home mode must NOT carry a Home action').toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3 — real execution: the bubble renders on /dashboard and pushing it navigates
// ═════════════════════════════════════════════════════════════════════════════
describe('§3.8(b) — the Calendar bubble is a real door on /dashboard', () => {
  beforeEach(() => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    stubHubCapable()
  })
  afterEach(() => {
    vi.useRealTimers()
    unstubHubCapable()
  })

  it('HubRoot renders a Calendar bubble in Home\'s fan', async () => {
    await renderHub('/dashboard')
    expect(screen.getByTestId('loc').textContent).toBe('/dashboard')

    // Control: the hub mounted and drew SOME fan at all, so a missing Calendar bubble below
    // cannot be "the hub never rendered".
    expect(screen.getByTestId('hub-bubble-home.voice')).toBeInTheDocument()
    expect(screen.getByTestId('hub-bubble-home.calendar')).toBeInTheDocument()
  })

  it('pushing onto the Calendar bubble navigates to /calendar', async () => {
    const { wedgeAngles } = await import('./fanGeometry')
    const { modesById, fanFor } = await import('./registry')
    const { FAN_RADIUS_INNER, FLICK_MS } = await import('./constants')

    await renderHub('/dashboard')

    // Aim from the PROJECTION, never `mode.fan` — the rings differ, so an angle taken from the
    // declared fan would resolve to a different bubble and this test would pass or fail for a
    // reason unrelated to what a member sees.
    const inner = fanFor(modesById.home).filter((a) => a.ring === 1)
    const idx = inner.findIndex((a) => a.id === 'home.calendar')
    expect(idx, 'home.calendar is not on the projected inner ring').toBeGreaterThanOrEqual(0)
    const { dx, dy } = vecAtAngle(FAN_RADIUS_INNER, wedgeAngles(inner.length)[idx])

    const pad = screen.getByTestId('mock-hub-pad')
    vi.useFakeTimers() // engaged AFTER the tree mounted on real timers
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    // Past FLICK_MS so release resolves through the ordinary push path, not the forced-outer flick.
    act(() => { vi.advanceTimersByTime(FLICK_MS + 20) })
    fireEvent.pointerMove(pad, { clientX: dx, clientY: dy, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: dx, clientY: dy, pointerId: 1 })

    expect(screen.getByTestId('loc').textContent).toBe('/calendar')
  })
})
