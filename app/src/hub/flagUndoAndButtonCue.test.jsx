// Two queued items, asserted the way this repo requires them to be asserted: by RENDERED TEXT and
// a RENDERED CLASS, never by a state transition.
//
// ⛔ WHY THAT RULE EXISTS HERE SPECIFICALLY. This feature shipped two toasts that were correct in
// every structural assertion and rendered for ZERO FRAMES — one passed `message` where the
// component reads `msg`, the other was owned by the element its own action unmounts. "The state
// changed" and "the member saw it" are different claims, and only the second one matters.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { ScreenerHubMount } from './sections/screenerSection'
import HubActionsButton from './HubActionsButton'
import haptics from '../components/mobile/haptics.js'

// The hub only mounts on a coarse pointer under 1024px (`useHubActive.js:84`), and
// `ScreenerHubMount` returns null when it cannot. jsdom answers every media query false, so the
// harness has to say yes for the component under test to exist at all.
function eligibleViewport() {
  window.matchMedia = (q) => ({
    matches: /max-width: 1023px|pointer: coarse/.test(q),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  })
  window.visualViewport = window.visualViewport || { width: 393, height: 852, addEventListener() {}, removeEventListener() {} }
  global.CSS = { supports: () => true }
}

describe('Flag — a reversible toggle with an Undo, and no sheet (owner ruling 2026-09-12)', () => {
  beforeEach(eligibleViewport)
  afterEach(cleanup)

  it('renders the Undo beside the toast, as WORDS a member can read', () => {
    render(<ScreenerHubMount apiRef={{ current: {} }} msg="Flagged NVDA" undo={() => {}} />)
    expect(screen.getByText('Flagged NVDA')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('the Undo calls back — and a real BUTTON, so a keyboard and a screen reader can reach it', () => {
    const undo = vi.fn()
    render(<ScreenerHubMount apiRef={{ current: {} }} msg="Flagged NVDA" undo={undo} />)
    const btn = screen.getByRole('button', { name: 'Undo' })
    expect(btn.tagName).toBe('BUTTON')
    fireEvent.click(btn)
    expect(undo).toHaveBeenCalledTimes(1)
  })

  // ⭐ THE CONTROL. Without it, a mount that rendered "Undo" unconditionally would pass both cases
  // above, and every member would see a dangling Undo attached to no message.
  it('shows NO Undo when there is no message to undo', () => {
    render(<ScreenerHubMount apiRef={{ current: {} }} msg={null} undo={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('shows no Undo for a message that has none — a plan-trade toast, say', () => {
    render(<ScreenerHubMount apiRef={{ current: {} }} msg="Planned NVDA" undo={null} />)
    expect(screen.getByText('Planned NVDA')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

describe('The Actions button (the WCAG 2.5.1 door) fires the same cue as the gesture door', () => {
  const ESCALATING = {
    id: 'journal.close', label: 'Close', icon: 'close', ring: 0,
    color: '--hub-journal', kind: 'run', escalate: true, flickable: false,
  }
  const ORDINARY = { id: 'scan.chartIt', label: 'Chart it', icon: 'chart', ring: 0, color: '--hub-mode-chart', kind: 'navigate', to: 'chart' }

  beforeEach(() => { eligibleViewport(); vi.restoreAllMocks() })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  // ⚠️ The sheet's own dismiss control is `aria-label="Close"`, so a role+name query for /Close/
  // matches TWO buttons and throws. The action row is identified by its rendered TEXT — which is
  // also the thing a member reads — and the click goes to the button that owns that text.
  const clickAction = (label) => {
    const node = screen.getByText(label)
    fireEvent.click(node.closest('button') ?? node)
  }

  const openSheet = (actions, extra = {}) => {
    render(
      <HubActionsButton
        mode="Journal"
        actions={actions}
        onAction={() => {}}
        {...extra}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /actions/i }))
  }

  it('applies the visual cue CLASS on activation when the device cannot vibrate', () => {
    // The iPhone case: `haptics.warn()` returns false because `navigator.vibrate` does not exist.
    vi.spyOn(haptics, 'warn').mockReturnValue(false)
    const el = document.createElement('div')
    document.body.appendChild(el)

    openSheet([ESCALATING], { cueEl: el, cueClassName: 'cue-class' })
    clickAction('Close')

    expect(haptics.warn).toHaveBeenCalledTimes(1)
    expect(el.classList.contains('cue-class'), 'the accessible door fired no visible cue').toBe(true)
  })

  // ⭐ CONTROL 1: a device that CAN buzz has already said it — painting as well would make the
  // escalation louder on the platform that never lost it.
  it('does NOT paint when the haptic fired', () => {
    vi.spyOn(haptics, 'warn').mockReturnValue(true)
    const el = document.createElement('div')
    document.body.appendChild(el)
    openSheet([ESCALATING], { cueEl: el, cueClassName: 'cue-class' })
    clickAction('Close')
    expect(el.classList.contains('cue-class')).toBe(false)
  })

  // ⭐ CONTROL 2: a cue on every action is not an escalation.
  it('does NOT paint for an ordinary action', () => {
    vi.spyOn(haptics, 'warn').mockReturnValue(false)
    vi.spyOn(haptics, 'impact').mockReturnValue(false)
    const el = document.createElement('div')
    document.body.appendChild(el)
    openSheet([ORDINARY], { cueEl: el, cueClassName: 'cue-class' })
    clickAction('Chart it')
    expect(haptics.impact).toHaveBeenCalledTimes(1)
    expect(haptics.warn).not.toHaveBeenCalled()
    expect(el.classList.contains('cue-class')).toBe(false)
  })
})
