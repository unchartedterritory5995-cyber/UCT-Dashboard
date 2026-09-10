// Two pieces of member-visible COPY that shipped with nothing asserting them.
//
// ── WHY THESE TWO, AND WHY TOGETHER ────────────────────────────────────────────────────────────
// The 2026-09-09 ruling exists because of two toast defects that left every structural assertion
// green: a toast passed `message` where the component read `msg` (rendered blank), and two toasts
// owned by the branch their own action unmounts (rendered for zero frames). In both cases the
// state was right, the control worked, and the ONLY broken part was the half that talks to the
// member. So: assert RENDERED TEXT, never state.
//
// These are the two remaining hub surfaces of that shape:
//
//   1. THE RING NAME. §C1.1 calls it "the ONLY thing that teaches a user the fan has two rings" —
//      reach mode makes both reachable, and without a label the inner ring stays folklore. A grep
//      for `ringName` or `'Tools'` across every hub test returned NOTHING.
//   2. THE FIRST-RUN COACH MARK. Every new member reads "Drag for shortcuts · hold to go home"
//      exactly once. A grep for that sentence across the whole app returned NOTHING.
//      (`hubHideRestore.test.jsx` touches `coachMarkSeen` — the PREFERENCE KEY — which is a
//      different thing from the component or its copy, and asserting the key proves nothing about
//      whether a human ever saw the sentence.)
//
// Both are asserted here through the real components, by rendered text.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import HubChip from './HubChip'
import HubCoachMark from './HubCoachMark'
import { RING_NAMES } from './constants'

const HUB = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

describe('the chip names the ring while selecting', () => {
  it('non-vacuity — there are two ring names and they differ', () => {
    // If RING_NAMES collapsed to one value, every assertion below could pass while the chip
    // taught the member nothing about there being two rings.
    expect(RING_NAMES.length).toBe(2)
    expect(RING_NAMES[0]).not.toBe(RING_NAMES[1])
  })

  it('⛔ OUTER ring: the chip renders its name', () => {
    render(<HubChip label="Home" tapHint="tap: last section" open ringName={RING_NAMES[0]} />)
    expect(screen.getByText(RING_NAMES[0]), `the outer ring's name (${RING_NAMES[0]}) is not on `
      + 'screen while selecting').toBeTruthy()
  })

  it('⛔ INNER ring: the chip renders its name — the only thing that teaches the ring exists', () => {
    render(<HubChip label="Home" tapHint="tap: last section" open ringName={RING_NAMES[1]} />)
    expect(screen.getByText(RING_NAMES[1]), `the inner ring's name (${RING_NAMES[1]}) is not on `
      + 'screen. §C1.1: "The chip names the ring while selecting ... without a label the inner ring '
      + 'stays folklore." Reach mode makes it reachable; this is what makes it discoverable.')
      .toBeTruthy()
  })

  it('⛔ the ring name REPLACES the tap hint while selecting, not sits beside it', () => {
    render(<HubChip label="Home" tapHint="tap: last section" open ringName={RING_NAMES[1]} />)
    expect(screen.queryByText('tap: last section'), 'the tap hint is still on screen during a '
      + 'selection — the chip should be the ring readout while the thumb is down').toBeNull()
  })

  it('⛔ a scrub readout wins over the tap hint, and an empty one still says something', () => {
    // `scrubReadout || 'Scrub'` — a section whose readout returns '' must not blank the chip
    // mid-gesture, which would look like the hub had died.
    const { rerender } = render(<HubChip label="Wire" tapHint="tap: next segment" scrubbing scrubReadout="Segment 3 of 9" />)
    expect(screen.getByText('Segment 3 of 9')).toBeTruthy()
    expect(screen.queryByText('tap: next segment')).toBeNull()

    rerender(<HubChip label="Wire" tapHint="tap: next segment" scrubbing scrubReadout="" />)
    expect(screen.getByText('Scrub'), 'an empty readout blanked the chip during a gesture')
      .toBeTruthy()
  })

  it('⛔ open with NO ring name renders nothing — the fan is open, nothing is selected', () => {
    const { container } = render(<HubChip label="Home" tapHint="tap: last section" open ringName={null} />)
    expect(container.textContent, 'the chip should be absent when the fan is open and no wedge is '
      + 'under the thumb').toBe('')
  })
})

describe('the first-run coach mark', () => {
  const copy = 'Drag for shortcuts · hold to go home'

  it('⛔ a new member reads the sentence, verbatim', () => {
    render(<HubCoachMark show used={false} onDismiss={() => {}} />)
    expect(screen.getByText(copy), 'the coach mark copy changed or vanished. This is the one '
      + 'sentence that teaches the gesture; every new member reads it exactly once.').toBeTruthy()
  })

  it('⛔ it is announced, not merely drawn', () => {
    render(<HubCoachMark show used={false} onDismiss={() => {}} />)
    const live = screen.getByRole('status')
    expect(live.getAttribute('aria-live'), 'the coach mark must be a polite live region — a hint '
      + 'nobody hears is a hint only sighted members get').toBe('polite')
    expect(live.textContent).toContain(copy)
  })

  it('⛔ the ✕ dismisses it — and the button says what it does', () => {
    const onDismiss = vi.fn()
    render(<HubCoachMark show used={false} onDismiss={onDismiss} />)
    const close = screen.getByLabelText('Dismiss hint')
    fireEvent.click(close)
    expect(onDismiss, 'clicking ✕ did not report a dismissal, so the mark would return on every '
      + 'visit').toHaveBeenCalled()
  })

  it('⛔ USING the hub dismisses it too — the mark is gone once the gesture is known', () => {
    const { container } = render(<HubCoachMark show used onDismiss={() => {}} />)
    expect(container.textContent, 'the coach mark is still on screen after the member has used the '
      + 'fan — it teaches a gesture they have now performed').toBe('')
  })

  it('⛔ it reports that dismissal ONCE, not on every render', () => {
    // The dismissal writes a preference. Firing it repeatedly would mean a write per render on
    // the universal hub path — the shape of the 524 outage (an unthrottled per-request write).
    const onDismiss = vi.fn()
    const { rerender } = render(<HubCoachMark show used onDismiss={onDismiss} />)
    rerender(<HubCoachMark show used onDismiss={onDismiss} />)
    rerender(<HubCoachMark show used onDismiss={onDismiss} />)
    expect(onDismiss.mock.calls.length, 'the coach mark reported its dismissal more than once')
      .toBe(1)
  })

  it('⛔ the copy in the component is the copy this rail pins — no second authority', () => {
    // If someone edits the sentence in the component, this rail must fail rather than quietly
    // pinning a string that no longer ships.
    const src = readFileSync(path.join(HUB, 'HubCoachMark.jsx'), 'utf8')
    expect(src, 'the component no longer contains the sentence this rail asserts').toContain(copy)
  })
})
