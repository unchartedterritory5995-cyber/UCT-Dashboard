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
import { useContext, useState } from 'react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import { renderWithProviders, screen, fireEvent, act } from '../../test-utils'
import FloatingOrb from './FloatingOrb'
import { VoiceContext, VoiceProvider } from '../../context/VoiceContext'
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
    // Playback ends INSIDE one mounted tree (a `rerender` would drop renderWithProviders'
    // router and providers and remount the orb -- a remount is not "comes back").
    function Playback({ children }) {
      const [playing, setPlaying] = useState(true)
      return (
        <>
          <VoiceOverride voice={playing ? { mode: 'a', status: 'playing' } : {}}>{children}</VoiceOverride>
          <button type="button" onClick={() => setPlaying(false)}>stop</button>
        </>
      )
    }
    act(() => { registerFirstRunSlot(slot) })
    const { container } = renderWithProviders(<Playback><FloatingOrb /></Playback>)
    expect(cluster(container), 'no orb during playback').toBeNull()
    expect(card(), 'so no card').toBeNull()
    fireEvent.click(screen.getByText('stop'))
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

// F5 fix round 2: a page sized to the viewport cannot take the card's height -- measured,
// the card pushed /charts' 1200 px workspace 78 px into a scroll, its bottom 50 px below the
// fold. The card waits there and shows on the next ordinary page. The routes on BOTH sides
// are READ from the committed measurement (never typed here); the list itself is railed
// against it in firstRun/viewportLockedRoutes.test.js.
const routeMeasurement = JSON.parse(readFileSync(join(process.cwd(), '..', 'docs', 'notebook', 'proof',
  'f5-r2-routes', 'routes-before-a0c32d2e2.json'), 'utf8'))
const MEASURED_LOCKED = routeMeasurement.locked
const MEASURED_ORDINARY = routeMeasurement.rows.filter((r) => r.class.verdict === 'ordinary').map((r) => r.route)

function GoTo({ to }) {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(to)}>{`go ${to}`}</button>
}

describe('"Meet Compass" waits on a viewport-locked page', () => {
  it('non-vacuity: the measurement names pages on both sides', () => {
    expect(MEASURED_LOCKED).toContain('/charts')
    expect(MEASURED_ORDINARY.length).toBeGreaterThan(0)
  })

  it.each(MEASURED_LOCKED)('on %s (measured locked): no card, the orb is there, the key is not written', (route) => {
    act(() => { registerFirstRunSlot(slot) })
    const { container } = renderWithProviders(<FloatingOrb />, { route })
    expect(cluster(container), 'the button it would name is on screen').not.toBeNull()
    expect(card(), 'no card pushing the page past the fold').toBeNull()
    expect(localStorage.getItem(KEY), 'waiting, not dismissed').toBeNull()
  })

  it.each(MEASURED_ORDINARY)('on %s (measured ordinary): the card shows', (route) => {
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />, { route })
    expect(card()).not.toBeNull()
    expect(slot.contains(card())).toBe(true)
  })

  it('after leaving a locked page the card appears on the next ordinary one (same mounted orb)', () => {
    const [locked, ordinary] = [MEASURED_LOCKED[0], MEASURED_ORDINARY[0]]
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<><FloatingOrb /><GoTo to={ordinary} /><GoTo to={locked} /></>, { route: locked })
    expect(card(), `waits on ${locked}`).toBeNull()
    fireEvent.click(screen.getByText(`go ${ordinary}`))
    expect(card(), `arrives on ${ordinary}`).not.toBeNull()
    expect(slot.contains(card())).toBe(true)
    fireEvent.click(screen.getByText(`go ${locked}`))
    expect(card(), `steps aside again on ${locked}`).toBeNull()
    expect(localStorage.getItem(KEY), 'still waiting, never dismissed by a route').toBeNull()
  })

  it('control: a route that only starts with the same letters is an ordinary page', () => {
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />, { route: '/chartsx' })
    expect(card()).not.toBeNull()
  })
})

// VIS-4 follow-up (Tier 2): found on production after Tier 1a at 1440x900 -- the card arrived late IN FLOW at the
// top of the Journal shell and pushed the whole page down. It is a toast now (the "New in your Notebook" offer's
// pattern): fixed, in the --z-toast layer, at every width. ⚰️ This block used to rail a desktop margin-right that
// kept the in-flow card clear of the corner "?"; a bottom-right toast cannot reach a top-right button.
describe('"Meet Compass" is a toast: out of flow, so its arrival moves nothing', () => {
  const SRC = join(process.cwd(), 'src', 'components')
  const css = readFileSync(join(SRC, 'voice', 'FloatingOrb.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // the body of `.coachmark { ... }` (exactly that selector, not .coachmarkText), within `at`
  const rule = (at = css) => {
    const m = /(?:^|\n)\s*\.coachmark\s*\{([^}]*)\}/.exec(at)
    return m ? m[1] : null
  }

  it('the card is position: fixed in the --z-toast layer with no margin (never in flow)', () => {
    const card = rule()
    expect(card, 'a .coachmark rule').not.toBeNull()
    expect(card).toMatch(/position\s*:\s*fixed/)
    expect(card).toMatch(/z-index\s*:\s*var\(--z-toast\)/)
    expect(card).toMatch(/bottom\s*:/)
    expect(card).toMatch(/margin\s*:\s*0\s*;/)
  })

  it('no width puts it back in flow (no media rule overrides position or adds a margin)', () => {
    const medias = [...css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
    expect(medias.length).toBeGreaterThan(0)                  // non-vacuity: the file has media blocks
    expect(medias.some((b) => rule(b))).toBe(true)            // non-vacuity: the phone rule is among them
    for (const body of medias) {
      const r = rule(body)
      if (!r) continue
      expect(r).not.toMatch(/position\s*:\s*(static|relative|sticky)/)
      expect(r).not.toMatch(/margin/)
    }
  })

  it('it still lands in the first-run slot, which is out of the page flow only through the card itself', () => {
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />, { route: '/journal/trades' })
    const c = card()?.closest('[data-orb-coachmark]')
    expect(c, 'the card is on screen').toBeTruthy()
    expect(slot.contains(c)).toBe(true)
    expect(c.className).toMatch(/coachmark/)
  })
})

// Tier 1b fix round 1 (review Important 5): on a PHONE's Notebook the orb cluster gives way to the Notebook's "+"
// (S12), so the card -- "Tap the compass button" -- WAITS there, exactly as on a viewport-locked page: not shown, not
// dismissed. The slot itself stays (the tour-offer toast lives in it too).
describe('"Meet Compass" waits on the phone Notebook', () => {
  const realMM = window.matchMedia
  const phone = (on) => {
    window.matchMedia = (q) => ({ matches: on && /max-width:\s*640px/.test(q) && !/min-width/.test(q), media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  }
  afterEach(() => { window.matchMedia = realMM })

  it('phone + /journal/notebook: no card, the key is not written', () => {
    phone(true)
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />, { route: '/journal/notebook' })
    expect(card()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('control: a phone on another page shows it', () => {
    phone(true)
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />, { route: '/journal/trades' })
    expect(card()).not.toBeNull()
  })

  it('Notebook simplify: the Notebook on a wider screen waits too (the card is off the Notebook at every width)', () => {
    phone(false)
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />, { route: '/journal/notebook' })
    expect(card()).toBeNull()
  })
})

// Review Minors 9 + 19, fix round 2 (re-review N6): the phone Notebook hides the cluster unless `data-in-session` is
// on it, and the "+" steps up while <html> carries `data-orb-in-session`. Both are set for a live call, and for a call
// that STARTED and then fell into error (its glyph says it failed) -- never for an error with no call behind it (a
// denied microphone), so neither the orb nor the raised "+" lingers. The <html> attribute is cleared on unmount.
describe('the orb says when a call is live or failing (data-in-session, html[data-orb-in-session])', () => {
  const html = () => document.documentElement.hasAttribute('data-orb-in-session')
  function Driven({ status }) {
    return <VoiceOverride voice={{ mode: 'c', status }}><FloatingOrb /></VoiceOverride>
  }
  it.each([['connected', true], ['idle', false]])('status %s -> %s', (status, on) => {
    const { container } = renderWithProviders(<Driven status={status} />)
    expect(cluster(container).hasAttribute('data-in-session')).toBe(on)
    expect(html()).toBe(on)
  })

  it('an error with no call behind it (the connect never started) sets neither', () => {
    const { container } = renderWithProviders(<Driven status="error" />)
    expect(cluster(container).hasAttribute('data-in-session')).toBe(false)
    expect(html()).toBe(false)
  })

  it('a call that started and then failed keeps both; back to idle clears them; unmount clears <html>', () => {
    const view = renderWithProviders(<Driven status="connected" />)
    view.rerender(<MemoryRouter><AuthProvider><VoiceProvider><Driven status="error" /></VoiceProvider></AuthProvider></MemoryRouter>)
    expect(cluster(view.container).hasAttribute('data-in-session')).toBe(true)
    expect(html()).toBe(true)
    view.unmount()
    expect(html()).toBe(false)
  })
})

// Tier 2 fix round 1 (review minor 14): on a phone the toast sits above the Journal "+ Log" button. Both numbers are
// READ from their stylesheets (the button's bottom plus the 44 px tap floor it is drawn at), never retyped here.
describe('"Meet Compass" on a phone clears the Journal "+ Log" button', () => {
  it('its bottom offset is above the +Log button\'s top', () => {
    const SRC = join(process.cwd(), 'src')
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    const orb = strip(readFileSync(join(SRC, 'components', 'voice', 'FloatingOrb.module.css'), 'utf8'))
    const jl = strip(readFileSync(join(SRC, 'pages', 'journal-2-0', 'JournalLayout.module.css'), 'utf8'))
    const card = /@media \(max-width: 640px\) \{\s*\.coachmark \{[^}]*bottom: calc\((\d+)px/.exec(orb)
    const fab = /\.logFab \{[^}]*bottom: calc\((\d+)px/.exec(jl)
    expect(card, 'the phone .coachmark bottom').not.toBeNull()
    expect(fab, 'the phone .logFab bottom').not.toBeNull()
    expect(Number(card[1])).toBeGreaterThan(Number(fab[1]) + 44)
  })
})

// Notebook simplify (task 1): the card never shows on the Notebook, at any width. It waits (not dismissed).
describe('"Meet Compass" on the Notebook', () => {
  it.each(['/journal/notebook', '/journal/notebook/research/NVDA'])('on %s: no card, the orb is there, the key is not written', (route) => {
    act(() => { registerFirstRunSlot(slot) })
    const { container } = renderWithProviders(<FloatingOrb />, { route })
    expect(card()).toBeNull()
    expect(cluster(container)).not.toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('CONTROL: on another Journal page the card still shows once', () => {
    act(() => { registerFirstRunSlot(slot) })
    renderWithProviders(<FloatingOrb />, { route: '/journal/trades' })
    expect(card()).not.toBeNull()
  })
})
