// §C2 — "Scrub is exposed as a native `<input type="range">` with `aria-valuetext` carrying a
// human-readable string ... a free no-drag path for Scrub specifically."
//
// ── WHY THIS IS THE ONE ACCESSIBILITY GAP THAT WAS REAL ────────────────────────────────────────
// Every ACTION already had a no-drag door before this: the Actions button opens Peek on a single
// tap, and §C2 is explicit that the button — NOT the two-finger gesture — is what satisfies
// WCAG 2.5.1 ("VoiceOver and TalkBack both reserve two-finger single-tap ... It also fails WCAG
// 2.5.1 on its face"). That door shipped in Phase 2.
//
// SCRUB was not in that list. It is a continuous value rather than a list entry, so until this
// control existed the only way to move it was to place a finger on the pad and drag a measured
// distance — the single interaction in the hub with no alternative, for exactly the tremor and
// limited-reach population §C2's motor paragraph exists for.
//
// ⭐ WHAT THIS FILE ASSERTS, AND WHY IT IS NOT "THE RANGE RENDERS": that a real
// `<input type="range">` reaches the SECTION'S OWN scrub. A styled div with `role="slider"` would
// pass a render check and lose the thing that matters — both screen readers give a FOCUSED NATIVE
// range a one-finger swipe adjust, and that behaviour belongs to the element, not to the role.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import HubScrubRange, { scrubAxisOf, readoutText } from './HubScrubRange'
import { validateSectionConfig } from './contracts'

const CTX = { mode: 'breadth', symbol: null, navigate: vi.fn() }

/** A section of the shape the hub actually mounts. */
function section(over = {}) {
  return {
    id: 'breadth',
    onScrub: vi.fn(),
    onScrubCommit: vi.fn(),
    readout: () => 'Data Charts',
    ...over,
  }
}

const range = () => screen.getByTestId('hub-scrub-range')

describe('the no-drag scrub path is a NATIVE range', () => {
  it('⛔ it is a real <input type="range">, not a div wearing role="slider"', () => {
    render(<HubScrubRange config={section()} ctx={CTX} label="Breadth" />)
    const el = range()
    expect(el.tagName, 'the control is not an <input> — a div with role="slider" gets the '
      + 'semantics and LOSES the one-finger swipe adjust VoiceOver and TalkBack give a native '
      + 'range, which is the entire reason §C2 names this element').toBe('INPUT')
    expect(el.getAttribute('type')).toBe('range')
  })

  it('⛔ it carries aria-valuetext — the human sentence, not the raw number', () => {
    render(<HubScrubRange config={section()} ctx={CTX} label="Breadth" />)
    expect(range().getAttribute('aria-valuetext'), 'without aria-valuetext a screen reader reads '
      + '"slider, 0" — a number the member cannot act on').toBe('Data Charts')
    expect(range().getAttribute('aria-label')).toBe('Breadth scrub')
  })

  it('⛔ the valuetext is the SECTION\'S OWN readout — one authority with the chip', () => {
    // The chip renders `readout()` too. If this control formatted its own sentence, a screen
    // reader and a sighted member would be told different things about the same value.
    let tab = 'Monitor'
    const c = section({ readout: () => `${tab} tab` })
    render(<HubScrubRange config={c} ctx={CTX} label="Breadth" />)
    expect(range().getAttribute('aria-valuetext')).toBe('Monitor tab')
    tab = 'Analogues'
    fireEvent.change(range(), { target: { value: '50' } })
    expect(range().getAttribute('aria-valuetext'), 'the announced value did not follow the '
      + 'section — this control is formatting its own string').toBe('Analogues tab')
  })
})

describe('it drives the section, and does not reimplement scrubbing', () => {
  it('⛔⛔ moving it calls the SECTION\'S onScrub, context first', () => {
    const c = section()
    render(<HubScrubRange config={c} ctx={CTX} label="Breadth" />)
    fireEvent.change(range(), { target: { value: '25' } })
    expect(c.onScrub, 'the range did not reach the section at all').toHaveBeenCalledTimes(1)
    const [ctxArg, scrub] = c.onScrub.mock.calls[0]
    expect(ctxArg, 'CONTEXT FIRST — the same shape HubRoot calls with').toBe(CTX)
    expect(typeof scrub.delta).toBe('number')
    expect(Number.isFinite(scrub.delta)).toBe(true)
  })

  it('⛔⛔ it emits a per-move DELTA, never the absolute position', () => {
    // `useJoystick` emits `raw / travelPx` — the change since the LAST move — and sections
    // accumulate it (`pos = clamp(from.pos + delta, 0, 1)`). A range reports an absolute value, so
    // sending that value straight through would compound every step and slam the cursor to an end.
    const c = section()
    render(<HubScrubRange config={c} ctx={CTX} label="Breadth" />)
    fireEvent.change(range(), { target: { value: '40' } })
    fireEvent.change(range(), { target: { value: '60' } })
    const [, first] = c.onScrub.mock.calls[0]
    const [, second] = c.onScrub.mock.calls[1]
    expect(first.delta).toBeCloseTo(0.4, 5)
    expect(second.delta, 'the second move sent 0.6 — an ABSOLUTE position read as a step. Two '
      + 'moves would then travel 100% of the track instead of 60%.').toBeCloseTo(0.2, 5)
  })

  it('⛔ release COMMITS — a preview left uncommitted is a gesture that did nothing', () => {
    // breadth previews on scrub and applies on release (it mounts two chart libraries per tab).
    // Driving onScrub without ever firing onScrubCommit holds the preview forever.
    const c = section()
    render(<HubScrubRange config={c} ctx={CTX} label="Breadth" />)
    fireEvent.change(range(), { target: { value: '30' } })
    expect(c.onScrubCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(range())
    expect(c.onScrubCommit, 'nothing committed on release, so the previewed value is never '
      + 'applied').toHaveBeenCalledWith(CTX)
  })

  it('⛔ a KEYBOARD release commits too — the range is operable without a pointer', () => {
    const c = section()
    render(<HubScrubRange config={c} ctx={CTX} label="Breadth" />)
    fireEvent.change(range(), { target: { value: '10' } })
    fireEvent.keyUp(range(), { key: 'ArrowRight' })
    expect(c.onScrubCommit, 'arrow-key adjustment never commits — the no-drag path works for a '
      + 'pointer and not for a keyboard, which is the population it exists for').toHaveBeenCalled()
  })
})

describe('the axis is DECLARED, never guessed', () => {
  it('⛔⛔ it emits the axis the section declares', () => {
    const x = section({ scrubAxis: 'x' })
    const { unmount } = render(<HubScrubRange config={x} ctx={CTX} label="Breadth" />)
    fireEvent.change(range(), { target: { value: '20' } })
    expect(x.onScrub.mock.calls[0][1].axis).toBe('x')
    unmount()

    const y = section({ scrubAxis: 'y' })
    render(<HubScrubRange config={y} ctx={CTX} label="Wire" />)
    fireEvent.change(range(), { target: { value: '20' } })
    expect(y.onScrub.mock.calls[0][1].axis).toBe('y')
  })

  it('defaults to y, which is what the majority of sections read', () => {
    expect(scrubAxisOf({})).toBe('y')
    expect(scrubAxisOf(undefined)).toBe('y')
    expect(scrubAxisOf({ scrubAxis: 'x' })).toBe('x')
    // A bad value must not become a third axis nothing honours.
    expect(scrubAxisOf({ scrubAxis: 'diagonal' })).toBe('y')
  })

  it('⛔ THE CONTROL: "emit both axes" would DOUBLE-APPLY, which is why the field exists', () => {
    // ⭐ Measured, not assumed — this is the reasoning that produced `scrubAxis`, kept executable.
    // `homeSection`, `notebookSection` and `wireSection` have NO axis guard: they act on whatever
    // arrives. A control that emitted an x AND a y to be safe would move those three twice per
    // step while moving breadth/screener/journal once.
    const unguarded = { seen: 0 }
    const anyAxis = { onScrub: () => { unguarded.seen += 1 } }
    for (const axis of ['x', 'y']) anyAxis.onScrub(CTX, { delta: 0.1, axis })
    expect(unguarded.seen, 'an axis-agnostic section takes BOTH emissions — one declared axis is '
      + 'the only shape that applies exactly once everywhere').toBe(2)
  })

  it('⛔ the contract ENFORCES it — a typedef is a comment', () => {
    const bad = { id: 'breadth', onScrub: () => {}, readout: () => 'x', scrubAxis: 'sideways' }
    expect(() => validateSectionConfig(bad, 'test')).toThrow(/scrubAxis/)

    // And an axis with nothing to read it is refused rather than silently ignored.
    const orphan = { id: 'breadth', scrubAxis: 'x' }
    expect(() => validateSectionConfig(orphan, 'test')).toThrow(/scrubAxis without onScrub/)

    // Non-vacuity: the valid shapes must pass, or the validator rejects everything.
    expect(() => validateSectionConfig(
      { id: 'breadth', onScrub: () => {}, readout: () => 'x', scrubAxis: 'x' }, 'test')).not.toThrow()
    expect(() => validateSectionConfig(
      { id: 'wire', onScrub: () => {}, readout: () => 'x' }, 'test')).not.toThrow()
  })
})

describe('it refuses to lie about what the mode can do', () => {
  it('⛔ a mode with NO scrub renders NOTHING — never an inert slider', () => {
    const { container } = render(
      <HubScrubRange config={{ id: 'flow' }} ctx={CTX} label="Flow" />)
    expect(container.textContent, 'an inert range announces a capability the section does not '
      + 'have — worse than absent, which at least tells the truth').toBe('')
    expect(screen.queryByTestId('hub-scrub-range')).toBeNull()
  })

  it('a readout that throws degrades to "Scrub" instead of taking the sheet down', () => {
    // This sheet is the member's only no-drag door. A cosmetic string must never be able to
    // unmount it.
    const c = section({ readout: () => { throw new Error('boom') } })
    render(<HubScrubRange config={c} ctx={CTX} label="Breadth" />)
    expect(range().getAttribute('aria-valuetext')).toBe('Scrub')
  })

  it('readoutText accepts both shapes the ChipReadout contract allows', () => {
    expect(readoutText({ readout: () => 'plain' }, CTX)).toBe('plain')
    expect(readoutText({ readout: () => ({ label: 'Tab', value: 'Daily' }) }, CTX)).toBe('Tab Daily')
    expect(readoutText({ readout: () => '' }, CTX)).toBe('Scrub')
    expect(readoutText({}, CTX)).toBe('Scrub')
  })
})
