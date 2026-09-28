// app/src/components/voice/FloatingOrb.coachmark.test.jsx
//
// Wave 10 follow-up F5: the one-time "Meet Compass" card lives IN the page flow and
// waits its turn behind a first-run tour.
//
//   * proof walk 10E-1 6b / design review D-2: hung off the orb in the orb's fixed
//     layer, the card sat over the Notebook's Unfiled / Archived / Trash rows at 390 px
//     and over the editor's evidence area at 1200;
//   * proof walk 10E-1 6b: the Notebook tour's card covered its "Got it" at every width.
//
// jsdom lays nothing out, so what is railed here is the STRUCTURE that makes both
// impossible: the card renders inside the page's first-run slot (never inside the
// orb's fixed cluster, never on document.body), not at all without a slot, and not
// while a tour holds the stage. The geometry itself is the proof walk's
// (docs/notebook/proof/f5-*/).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, act } from '../../test-utils'
import FloatingOrb from './FloatingOrb'
import { registerFirstRunSlot, claimFirstRunStage } from '../firstRun/firstRunStage'

vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn(), isConnected: false }),
}))

const KEY = 'voice.orb.coachmarkSeen'
let slot

beforeEach(() => {
  localStorage.removeItem(KEY)
  localStorage.removeItem('voice.orb.minimized')
  slot = document.createElement('div')
  slot.setAttribute('data-first-run-slot', '')
  document.body.appendChild(slot)
})
afterEach(() => {
  act(() => { registerFirstRunSlot(null) })
  slot.remove()
  document.body.style.overflow = ''
})

const card = () => screen.queryByText('Meet Compass')

describe('FloatingOrb "Meet Compass": in the page flow, never over it', () => {
  it('renders INSIDE the page slot -- not in the orb cluster, not loose on the body', () => {
    act(() => { registerFirstRunSlot(slot) })
    const { container } = renderWithProviders(<FloatingOrb />)
    expect(card(), 'the card shows for a member who has not seen it').not.toBeNull()
    expect(slot.contains(card()), 'inside the first-run slot').toBe(true)
    const cluster = container.querySelector('div[class*="orbCluster"]')
    expect(cluster, 'the orb itself still renders').not.toBeNull()
    expect(cluster.contains(card()), 'never inside the orb\'s fixed layer').toBe(false)
  })

  it('carries no floating geometry of its own (no absolute/fixed inline position)', () => {
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />)
    for (let el = card(); el && el !== slot; el = el.parentElement) {
      expect(['absolute', 'fixed']).not.toContain(el.style.position)
    }
  })

  it('with no slot on the page it does not show at all, rather than float', () => {
    renderWithProviders(<FloatingOrb />)
    expect(card()).toBeNull()
  })

  it('waits while a first-run tour holds the stage, and shows once it is released', () => {
    act(() => { registerFirstRunSlot(slot) })
    let release
    act(() => { release = claimFirstRunStage() })
    renderWithProviders(<FloatingOrb />)
    expect(card(), 'the tour goes first').toBeNull()
    act(() => { release() })
    expect(card(), 'then the card').not.toBeNull()
    expect(slot.contains(card())).toBe(true)
  })

  it('"Got it" dismisses it for good (the one-time key is written)', () => {
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(card()).toBeNull()
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('stays in the page while a modal locks scrolling (the orb hides; the page under the card has not changed)', () => {
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />)
    const before = card()
    act(() => { document.body.style.overflow = 'hidden' })
    expect(card(), 'still there').not.toBeNull()
    expect(card(), 'the same node -- the orb hiding never remounts it').toBe(before)
  })

  it('control: a member who has already seen it gets no card, slot or not', () => {
    localStorage.setItem(KEY, '1')
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />)
    expect(card()).toBeNull()
  })
})
