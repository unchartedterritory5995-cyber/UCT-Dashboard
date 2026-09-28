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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useContext } from 'react'
import { renderWithProviders, screen, fireEvent, act } from '../../test-utils'
import FloatingOrb from './FloatingOrb'
import { VoiceContext } from '../../context/VoiceContext'
import { registerFirstRunSlot, claimFirstRunStage } from '../firstRun/firstRunStage'

vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn(), isConnected: false }),
}))
// The scroll tuck, driven from the test (the hook itself is railed in its own file).
const { scrollTuck } = vi.hoisted(() => ({ scrollTuck: { value: false } }))
vi.mock('../../hooks/useHideOnScroll', () => ({ default: () => scrollTuck.value }))

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
  scrollTuck.value = false
})

const card = () => screen.queryByText('Meet Compass')
const cluster = (container) => container.querySelector('div[class*="orbCluster"]')

/** The real VoiceProvider's value with `mode` / `status` overridden -- read-aloud playback
 *  is the branch where the orb renders nothing. */
function VoiceOverride({ voice, children }) {
  const real = useContext(VoiceContext)
  return <VoiceContext.Provider value={{ ...real, ...voice }}>{children}</VoiceContext.Provider>
}

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

  // F5 fix round 1 (review Critical): the card names the compass button, so it shows ONLY
  // while the orb cluster is on screen. Hidden is not dismissed: it comes back with the orb.
  // useScrollLocked reads the body's style through a MutationObserver (a microtask), so the
  // lock and the unlock are awaited.
  const lock = (v) => act(async () => { document.body.style.overflow = v })

  it('an open sheet (scroll locked) hides the orb AND the card -- and the key is not written', async () => {
    act(() => { registerFirstRunSlot(slot) })
    const { container } = renderWithProviders(<FloatingOrb />)
    expect(card()).not.toBeNull()
    await lock('hidden')
    expect(cluster(container), 'the orb sits out behind a sheet').toBeNull()
    expect(card(), 'no card naming a button that is not there').toBeNull()
    expect(localStorage.getItem(KEY), 'hidden, not dismissed').toBeNull()
  })

  it('the card returns when the orb does (the sheet closes)', async () => {
    act(() => { registerFirstRunSlot(slot) })
    const { container } = renderWithProviders(<FloatingOrb />)
    await lock('hidden')
    expect(card()).toBeNull()
    await lock('')
    expect(cluster(container)).not.toBeNull()
    expect(card(), 'back with the orb').not.toBeNull()
    expect(slot.contains(card())).toBe(true)
  })

  it('read-aloud playback (the orb renders nothing) hides the card; it returns when playback ends', () => {
    act(() => { registerFirstRunSlot(slot) })
    const { container, rerender } = renderWithProviders(
      <VoiceOverride voice={{ mode: 'a', status: 'playing' }}><FloatingOrb /></VoiceOverride>,
    )
    expect(cluster(container), 'no orb during playback').toBeNull()
    expect(card(), 'so no card').toBeNull()
    rerender(<VoiceOverride voice={{ mode: null, status: 'idle' }}><FloatingOrb /></VoiceOverride>)
    expect(cluster(container)).not.toBeNull()
    expect(card(), 'back with the orb').not.toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('while the card is up, a scroll does not tuck the orb into a sliver', () => {
    scrollTuck.value = true
    act(() => { registerFirstRunSlot(slot) })
    const { container } = renderWithProviders(<FloatingOrb />)
    expect(card()).not.toBeNull()
    expect(cluster(container).className, 'the named button stays out').not.toMatch(/tucked/)
  })

  it('control: with no card pending, the same scroll does tuck the orb', () => {
    scrollTuck.value = true
    localStorage.setItem(KEY, '1')
    act(() => { registerFirstRunSlot(slot) })
    const { container } = renderWithProviders(<FloatingOrb />)
    expect(card()).toBeNull()
    expect(cluster(container).className).toMatch(/tucked/)
  })

  it('control: a member who has already seen it gets no card, slot or not', () => {
    localStorage.setItem(KEY, '1')
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />)
    expect(card()).toBeNull()
  })
})

describe('"Meet Compass" at the desktop width keeps clear of the feedback "?"', () => {
  // After run on aa2417c2c (docs/notebook/proof/f5-after-aa2417c2c/geometry.json.gz,
  // nb-note-first-run @1200): "Got it" [1104,23,63,44] and the fixed "?" [1162,10,24,24]
  // shared a 5x11 px corner. Structural (jsdom lays nothing out): the card's desktop right
  // margin must clear the "?" -- whose numbers are READ from FeedbackWidget.jsx, the one
  // authority over where it sits, never retyped here.
  const SRC = join(process.cwd(), 'src', 'components')
  const css = readFileSync(join(SRC, 'voice', 'FloatingOrb.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const fw = readFileSync(join(SRC, 'FeedbackWidget.jsx'), 'utf8')

  it('reads the "?" button geometry from FeedbackWidget.jsx (non-vacuity)', () => {
    expect(/position: 'fixed', top: \d+, right: \d+, width: \d+, height: \d+/.test(fw)).toBe(true)
  })

  it('the desktop margin-right is wider than the "?" reaches in from the right edge', () => {
    const [, right, width] = /position: 'fixed', top: \d+, right: (\d+), width: (\d+), height: \d+/.exec(fw).map(Number)
    const desk = /@media \(min-width: 1025px\)\s*\{\s*\.coachmark\s*\{\s*margin-right:\s*(\d+)px;?\s*\}\s*\}/.exec(css)
    expect(desk, 'a desktop .coachmark margin-right rule').not.toBeNull()
    expect(Number(desk[1])).toBeGreaterThan(right + width)
  })
})
