/**
 * B13 — §8's settings schema becomes reachable.
 *
 * Every one of these keys already existed in `useHubSettings`'s defaults and was already persisted
 * through `POST /api/auth/preferences`; none of them was reachable from any screen. The card
 * exposed exactly one of nine.
 *
 * ⭐ EACH CONTROL IS RAILED THE SAME THREE WAYS: it RENDERS the stored value, CHANGING it writes
 * the right key, and the written value READS BACK — the updater is applied to the stored blob and
 * fed back in, so the assertion is a round trip rather than a spy call.
 *
 * ⛔ AND ONE RAIL THAT IS NOT ABOUT ANY CONTROL: nothing writes on mount. `hubHideRestore` asserts
 * `setPrefMerged` is called exactly once after one toggle click, so a write during render breaks
 * it — but the real damage is worse than a red test. B6 gates the card on
 * `typeof storedEnabled === 'boolean'`, so a write-on-mount would convert "never chose" into a
 * choice for every member who ever opened Settings, and hand them the card permanently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import { AuthContext } from '../../context/AuthContext'

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

const renderCard = (stored = {}) => {
  mockPrefs = { joystick_hub: JSON.stringify({ enabled: true, ...stored }) }
  return render(
    <AuthContext.Provider value={{ user: { role: 'admin' } }}>
      <JoystickSettingsCard />
    </AuthContext.Provider>,
  )
}

/** Apply the updater the card handed `setPrefMerged` to the blob it was holding. */
const written = (current) => {
  expect(setPrefMerged, 'nothing was written').toHaveBeenCalled()
  const [key, updater] = setPrefMerged.mock.calls.at(-1)
  expect(key).toBe('joystick_hub')
  return updater(current)
}

beforeEach(() => { cleanup(); setPrefMerged.mockReset(); mockPrefs = {} })

describe('B13 — every §8 key has a control', () => {
  it('⛔ NOTHING is written on mount', () => {
    renderCard({ handedness: 'left', holdMs: 700 })
    expect(
      setPrefMerged,
      'the card wrote while rendering — that turns "never chose" into a choice for every member '
      + 'who opens Settings once, and B6 then shows them the card forever',
    ).not.toHaveBeenCalled()
  })

  it.each([
    ['joystick-haptics', 'haptics', true, false],
    ['joystick-sticky-fan', 'stickyFan', true, false],
    ['joystick-high-contrast', 'highContrast', false, true],
  ])('%s renders, changes and reads back', (testid, key, from, to) => {
    renderCard({ [key]: from })
    const box = screen.getByTestId(testid)
    expect(box.checked, `${key} did not render its stored value`).toBe(from)

    fireEvent.click(box)
    const next = written({ enabled: true, [key]: from })
    expect(next[key], `${key} did not write the new value`).toBe(to)

    cleanup()
    renderCard({ [key]: next[key] })
    expect(screen.getByTestId(testid).checked, `${key} did not read back`).toBe(to)
  })

  it('handedness renders, changes and reads back', () => {
    renderCard({ handedness: 'right' })
    const sel = screen.getByTestId('joystick-handedness')
    expect(sel.value).toBe('right')

    fireEvent.change(sel, { target: { value: 'left' } })
    const next = written({ enabled: true, handedness: 'right' })
    expect(next.handedness).toBe('left')

    cleanup()
    renderCard({ handedness: next.handedness })
    expect(screen.getByTestId('joystick-handedness').value).toBe('left')
  })

  it.each([
    ['joystick-hold-ms', 'holdMs', 500, 900, 300, 1200],
    ['joystick-travel-px', 'travelPx', 24, 40, 16, 48],
    ['joystick-double-tap-ms', 'doubleTapMs', 280, 420, 200, 600],
  ])('%s renders, changes, reads back — and persists a NUMBER', (testid, key, from, to, min, max) => {
    renderCard({ [key]: from })
    const range = screen.getByTestId(testid)
    expect(range.value).toBe(String(from))
    expect(screen.getByTestId(`${testid}-value`).textContent).toContain(String(from))
    // The spec's bounds, on the control rather than in a comment.
    expect(range.min).toBe(String(min))
    expect(range.max).toBe(String(max))

    fireEvent.change(range, { target: { value: String(to) } })
    const next = written({ enabled: true, [key]: from })
    expect(next[key]).toBe(to)
    // ⛔ A NUMBER, not "900". A range input hands back a string, and the engine compares these
    // numerically — under string comparison "90" > "1200" is TRUE, so a stray string passes every
    // boundary check and misbehaves only at some values.
    expect(typeof next[key], `${key} persisted a string`).toBe('number')

    cleanup()
    renderCard({ [key]: next[key] })
    expect(screen.getByTestId(testid).value).toBe(String(to))
  })

  it('overrides: shows none, shows a count, and resets to the registry', () => {
    renderCard({})
    expect(screen.getByTestId('joystick-overrides-count').textContent).toBe('none')
    expect(screen.queryByTestId('joystick-overrides-reset'), 'nothing to reset').toBeNull()

    cleanup()
    renderCard({ overrides: { 'journal.close': { label: 'Close it' } } })
    expect(screen.getByTestId('joystick-overrides-count').textContent).toBe('1 set')

    fireEvent.click(screen.getByTestId('joystick-overrides-reset'))
    const next = written({ enabled: true, overrides: { 'journal.close': {} } })
    expect(next.overrides).toEqual({})
  })

  it('⛔ the card is still admin-gated — B13 adds controls, not exposure', () => {
    mockPrefs = {}
    render(
      <AuthContext.Provider value={{ user: { role: 'member' } }}>
        <JoystickSettingsCard />
      </AuthContext.Provider>,
    )
    expect(screen.queryByTestId('joystick-enabled-toggle')).toBeNull()
    expect(screen.queryByTestId('joystick-handedness'), 'a member reached the new controls').toBeNull()
  })
})
