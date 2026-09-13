/**
 * ⛔⛔ THE G0 TRACE CONTROLS — the half that talks to the owner.
 *
 * ⭐ EVERY OUTCOME IS ASSERTED BY RENDERED TEXT, never by state. CLAUDE.md's ruling of 2026-09-09
 * comes from this very feature: two joystick toasts shipped with every structural assertion green
 * and the copy blank or rendered for zero frames, because a test that asserts "the setter was
 * called" proves nothing about whether a human ever saw the sentence. The status line here lives
 * ABOVE the buttons that write it, in a card neither button unmounts.
 *
 * ⛔ AND THE EMPTY CASE IS A FIRST-CLASS OUTCOME. `glass-acceptance.md` opens with "absence is not
 * PASS" because this program has already had four blank templates come back. A "Copied." message
 * over an empty buffer would hand the owner a file that looks like a clean device.
 */
import { describe, it as vitestIt, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

import { AuthContext } from '../../context/AuthContext'
import {
  GESTURE_TRACE_CAP,
  clearGestureTrace,
  readGestureTrace,
  recordGestureEvent,
} from '../../hub/gestureTrace'

// ⛔ `vitest -t` is a REGEX: a filter matching nothing exits 0 and reads as a PASS. House idiom.
let defined = 0
let executed = 0
function it(name, fn) {
  defined += 1
  return vitestIt(name, (...a) => { executed += 1; return fn(...a) })
}
afterAll(() => {
  expect(executed).toBeGreaterThan(0)
  expect(executed).toBe(defined)
})

// ⚠️ A mocked module namespace is a Proxy that THROWS on any export the mock omits, and
// `useHubSettings` imports `parsePref` directly — so the mock must provide it with the REAL
// behaviour, or every case fails for the wrong reason.
let mockPrefs = {}
const setPrefMerged = vi.fn()
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

const { default: JoystickSettingsCard } = await import('./JoystickSettingsCard')

const TOGGLE = 'joystick-trace-toggle'
const SECTION = 'joystick-trace-section'
const COPY = 'joystick-trace-copy'
const CLEAR = 'joystick-trace-clear'
const STATUS = 'joystick-trace-status'
const FALLBACK = 'joystick-trace-fallback'

function renderAs(role, stored = { enabled: true }) {
  mockPrefs = { joystick_hub: JSON.stringify(stored) }
  return render(
    <AuthContext.Provider value={{ user: role ? { role } : null }}>
      <JoystickSettingsCard />
    </AuthContext.Provider>,
  )
}

/** Apply the updater the card handed `setPrefMerged` to the blob it was holding — a round trip,
 *  not a spy call. */
const written = (current) => {
  expect(setPrefMerged, 'nothing was written').toHaveBeenCalled()
  const [key, updater] = setPrefMerged.mock.calls.at(-1)
  expect(key).toBe('joystick_hub')
  return updater(current)
}

function stubClipboard(impl) {
  const writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

const row = (n) => ({
  type: 'pointerup', pointerType: 'touch', clientX: n, decision: 'flick-fire', elapsed: 41,
})

const click = async (testid) => {
  await act(async () => { fireEvent.click(screen.getByTestId(testid)) })
}

beforeEach(() => {
  cleanup()
  setPrefMerged.mockReset()
  mockPrefs = {}
  clearGestureTrace()
  stubClipboard(() => Promise.resolve())
})

describe('⛔⛔ ADMIN ONLY — who can see the trace controls', () => {
  it('an admin sees them', () => {
    renderAs('admin')
    expect(screen.queryByTestId(SECTION), 'an admin lost the G0 diagnostic').not.toBeNull()
    expect(screen.getByText('Record gesture trace')).toBeTruthy()
  })

  it('⛔ a MEMBER who already chose sees the card but NOT the trace controls', () => {
    renderAs('member', { enabled: true })
    // CONTROL: this member does see the card — so the absence below is the trace gate, not B6's.
    expect(
      screen.queryByTestId('joystick-enabled-toggle'),
      'this member cannot see the card at all — the assertion below would pass for the wrong reason',
    ).not.toBeNull()
    expect(
      screen.queryByTestId(SECTION),
      'a member was offered a diagnostic that records their own pointer stream',
    ).toBeNull()
    expect(screen.queryByTestId(COPY)).toBeNull()
  })
})

describe('the toggle', () => {
  it('⛔ is OFF for an admin who never chose', () => {
    mockPrefs = {}
    render(
      <AuthContext.Provider value={{ user: { role: 'admin' } }}>
        <JoystickSettingsCard />
      </AuthContext.Provider>,
    )
    expect(screen.getByTestId(TOGGLE).checked, 'the G0 trace defaulted ON').toBe(false)
  })

  it('renders a stored true, and turning it on writes traceGestures: true', () => {
    renderAs('admin', { enabled: true, traceGestures: true })
    expect(screen.getByTestId(TOGGLE).checked).toBe(true)

    cleanup()
    setPrefMerged.mockReset()
    renderAs('admin', { enabled: true })
    expect(screen.getByTestId(TOGGLE).checked).toBe(false)
    fireEvent.click(screen.getByTestId(TOGGLE))
    const next = written({ enabled: true })
    expect(next.traceGestures, 'the toggle wrote the wrong key').toBe(true)
    expect(next.enabled, 'the toggle clobbered an unrelated setting').toBe(true)
  })
})

describe('⛔ Copy trace — the ONE export path', () => {
  it('⛔ AN EMPTY BUFFER SAYS SO, and nothing is copied', async () => {
    const writeText = stubClipboard(() => Promise.resolve())
    renderAs('admin', { enabled: true, traceGestures: true })
    await click(COPY)

    expect(screen.getByTestId(STATUS).textContent, 'an empty capture reported as a success')
      .toContain('Nothing recorded')
    expect(writeText, 'an empty buffer was still put on the clipboard').not.toHaveBeenCalled()
  })

  it('copies the buffer as JSON and NAMES what it copied', async () => {
    const writeText = stubClipboard(() => Promise.resolve())
    for (let i = 1; i <= 3; i += 1) recordGestureEvent(row(i))
    renderAs('admin', { enabled: true, traceGestures: true })
    await click(COPY)

    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(writeText.mock.calls[0][0])
    expect(payload.trace, 'the pasted blob does not identify itself').toBe('uct-joystick-g0')
    expect(payload.rows.map((r) => r.clientX)).toEqual([1, 2, 3])
    expect(payload.rows[0].decision).toBe('flick-fire')
    expect(payload.window.kept).toBe(3)
    expect(payload.device, 'a pasted trace must identify its own device').toBeTruthy()

    const status = screen.getByTestId(STATUS).textContent
    expect(status).toContain('Copied')
    expect(status, 'the message does not say how much was copied').toContain('3 events')
    expect(status, 'the message does not say WHICH events').toContain('seq 1-3')
  })

  it('⛔ a SATURATED buffer says how much it lost', async () => {
    stubClipboard(() => Promise.resolve())
    for (let i = 0; i < GESTURE_TRACE_CAP + 7; i += 1) recordGestureEvent(row(i))
    renderAs('admin', { enabled: true, traceGestures: true })
    await click(COPY)

    const status = screen.getByTestId(STATUS).textContent
    expect(status, 'a full ring reported as a complete capture — `lesson_a_saturated_instrument_'
      + 'reports_zero`: 500 rows and 5,000 events look identical unless the message says otherwise')
      .toContain('7 older dropped')
  })

  it('⛔ NO SINK — copying writes no preference and reaches nothing but the clipboard', async () => {
    stubClipboard(() => Promise.resolve())
    recordGestureEvent(row(1))
    renderAs('admin', { enabled: true, traceGestures: true })
    setPrefMerged.mockReset()
    await click(COPY)
    expect(
      setPrefMerged,
      'the trace was written into the preferences blob. §8 is "no analytics": the rows must never '
      + 'leave the device except through the clipboard, and the preferences endpoint is a server.',
    ).not.toHaveBeenCalled()
  })

  it('⛔ a clipboard that refuses gets a RECOVERY PATH in the same commit, not an apology', async () => {
    // `navigator.clipboard` is secure-context-only. A capture the owner cannot get off the device
    // is a device run they have to perform again — and "documented workaround" is not a recovery
    // path (CLAUDE.md).
    stubClipboard(() => Promise.reject(new Error('not allowed')))
    recordGestureEvent(row(9))
    renderAs('admin', { enabled: true, traceGestures: true })
    await click(COPY)

    const status = screen.getByTestId(STATUS).textContent
    expect(status).toContain('Could not reach the clipboard')
    expect(status, 'it does not say what to do instead').toContain('copy it by hand')
    const box = screen.getByTestId(FALLBACK)
    const payload = JSON.parse(box.value)
    expect(payload.rows[0].clientX, 'the fallback box does not hold the trace').toBe(9)
  })

  it('CONTROL: the fallback box is ABSENT on a successful copy', async () => {
    stubClipboard(() => Promise.resolve())
    recordGestureEvent(row(1))
    renderAs('admin', { enabled: true, traceGestures: true })
    await click(COPY)
    expect(
      screen.queryByTestId(FALLBACK),
      'the manual-copy box renders on the happy path too — the case above proves nothing',
    ).toBeNull()
  })
})

describe('Clear', () => {
  it('empties the buffer and says so — the SE run cannot bleed into the 15 Pro run', async () => {
    recordGestureEvent(row(1))
    expect(readGestureTrace().kept).toBe(1)
    renderAs('admin', { enabled: true, traceGestures: true })
    await click(CLEAR)
    expect(readGestureTrace().kept).toBe(0)
    expect(screen.getByTestId(STATUS).textContent).toContain('Trace cleared')
  })
})

// ── THE MIRROR ATTRIBUTE — the read path for a device nobody can plug a cable into ────────────
//
// G0-1 runs on BrowserStack **Live**: a screen mirror in a browser, with no automation transport
// to return a value through and a clipboard that belongs to the REMOTE device. The attribute is
// how the trace gets out. These cases are about the two gates and the absent case, because an
// attribute that leaked to a member, or that read as an empty capture, would be worse than none.
describe('the trace mirror attribute', () => {
  it('carries the SAME JSON the Copy button would have produced, for an admin with the toggle on', () => {
    clearGestureTrace()
    recordGestureEvent({ type: 'pointerdown', pointerType: 'touch', decision: null })
    recordGestureEvent({ type: 'pointerup', pointerType: 'touch', decision: 'flick-fire', elapsed: 88 })
    renderAs('admin', { enabled: true, traceGestures: true })

    const raw = screen.getByTestId(SECTION).getAttribute('data-hub-trace')
    expect(raw, 'the mirror is absent while the toggle is ON').toBeTruthy()

    // ⭐ Parsed, not string-matched: the point is that the operator can feed it straight to
    // `tools/hub_trace_analyze.py`, which refuses anything that is not a whole payload.
    const parsed = JSON.parse(raw)
    expect(parsed.trace).toBe('uct-joystick-g0')
    expect(parsed.window.recorded).toBe(2)
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[1].decision).toBe('flick-fire')
    // The thresholds ship with the rows — a trace whose flickMs disagrees with the build that
    // produced it is unreadable, which is why `constants` is part of the payload.
    expect(parsed.constants.FLICK_MS).toBeGreaterThan(0)
  })

  // ⭐ CONTROL 1. Without this, an attribute rendered unconditionally would pass the case above
  // and sit in every admin's DOM for ever.
  it('is ABSENT — not empty — when the toggle is off', () => {
    clearGestureTrace()
    recordGestureEvent({ type: 'pointerdown', pointerType: 'touch' })
    renderAs('admin', { enabled: true, traceGestures: false })
    const section = screen.getByTestId(SECTION)
    expect(section.hasAttribute('data-hub-trace')).toBe(false)
    // ⛔ Absent and empty are different facts: an empty string reads as "a capture that recorded
    // nothing", which is not the same as "nobody is capturing".
    expect(section.getAttribute('data-hub-trace')).toBeNull()
  })

  // ⭐ CONTROL 2. The gate that matters for members.
  it('renders nothing at all for a non-admin, even with the preference set true', () => {
    clearGestureTrace()
    recordGestureEvent({ type: 'pointerdown', pointerType: 'touch' })
    renderAs('member', { enabled: true, traceGestures: true })
    expect(screen.queryByTestId(SECTION), 'the whole section leaked to a member').toBeNull()
    expect(document.querySelector('[data-hub-trace]'), 'the mirror leaked to a member').toBeNull()
  })

  it('adds no endpoint — the mirror is a string in the DOM and nothing else', () => {
    // ⛔ The spec's "no analytics" is the rule this attribute had to stay inside. A fetch here
    // would be invisible in a screenshot and obvious in a network log, so assert it directly.
    clearGestureTrace()
    recordGestureEvent({ type: 'pointerdown', pointerType: 'touch' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderAs('admin', { enabled: true, traceGestures: true })
    expect(screen.getByTestId(SECTION).getAttribute('data-hub-trace')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
