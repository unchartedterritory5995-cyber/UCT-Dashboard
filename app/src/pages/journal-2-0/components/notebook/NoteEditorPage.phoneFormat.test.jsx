import { render, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TEXT_COLOR_MENU_LABEL } from './TextColorMenu'
import { FOCUSABLE_SELECTOR } from '../../../../components/mobile/useFocusTrap'
import { MQ } from '../../../../styles/breakpoints'
import { isFirstRunStageHeld } from '../../../../components/firstRun/firstRunStage'

// Wave 10 lane D3P (D-3 PHONE): at 390 px the editor's formatting row wrapped to about eight
// rows, the note's title sat below the first screen, and the phone's Log FAB covered one of the
// row's controls at rest (lane L3, measured). On a phone the row now keeps Undo / Redo, Bold,
// Italic, the bullet list and the mic (controller ruling), and every other formatting control
// waits behind ONE "Aa Format" disclosure that opens the row IN PLACE.
//
// ⛔ WHAT THIS FILE CAN AND CANNOT SAY. jsdom applies no stylesheet and lays nothing out, so
// "hidden on a phone" and "unchanged on a desktop" are CSS facts, railed structurally in
// a11y/targetFloors.test.js ("D3P") and measured in real Chromium (docs/notebook/proof/d3p-*).
// What a rendered test CAN hold, and does here, through a REAL NoteEditorPage:
//   1. the disclosure owns exactly the moved controls, the kept ones stay out of it, and every
//      control in the row is one or the other (a new control must be classified);
//   2. the keyboard contract (lib/useDisclosureFocus.js): focus in, Tab kept inside, Escape
//      closes and hands focus back to the toggle;
//   3. CONTROL: the row's own order -- which is its desktop order and its Tab order -- is
//      exactly the order it had before D3P, once the phone-only toggle is set aside.

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
  tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
  bodyJson: { type: 'doc', content: [P('Start.')] },
}
// The note the page sees. A cell may swap it (locked / unlocked) and re-render; beforeEach resets it.
let CURRENT = NOTE
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: CURRENT, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
// Paid, so the toolbar mic renders too: it is one of the controls a phone must KEEP in the row.
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isPaid: true }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  const Stub = React.forwardRef(function StubMic(_props, ref) {
    React.useImperativeHandle(ref, () => ({ available: true, start: () => true }))
    return <button type="button" aria-label="Start voice input" />
  })
  return { default: Stub }
})

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

beforeEach(() => {
  CURRENT = NOTE
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

let rerenderPage = null
async function mountToolbar() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const div = document.createElement('div')
  document.body.appendChild(div)
  const page = () => <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>
  const { rerender } = render(page(), { container: div })
  rerenderPage = () => rerender(page())
  await waitFor(() => {
    if (!div.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
  const toolbar = within(div).getByRole('toolbar', { name: 'Editor toolbar' })
  // the lazy mic arrives in its own Suspense boundary
  await within(toolbar).findByRole('button', { name: 'Start voice input' })
  return toolbar
}

const toggleOf = (toolbar) => within(toolbar).getByRole('button', { name: 'Format' })
const runsOf = (toolbar) => {
  const ids = (toggleOf(toolbar).getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean)
  return ids.map((id) => document.getElementById(id))
}
/** A control's accessible name, as the tests below name it: aria-label, else its text without
 *  the aria-hidden decoration (the toggle's "Aa" glyph). */
const nameOf = (el) => {
  const label = el.getAttribute('aria-label')
  if (label) return label.replace(/\s+/g, ' ').trim()
  const copy = el.cloneNode(true)
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
  return (copy.textContent || '').replace(/\s+/g, ' ').trim()
}
/** Every control in `root`, DISABLED ones included (Undo and Redo are disabled with nothing to
 *  undo, and they are still controls the row carries). The Tab ring below uses FOCUSABLE_SELECTOR. */
const controlsIn = (root) => [...root.querySelectorAll('button, select, input, textarea, a[href]')]
const tabRing = (root) => [...root.querySelectorAll(FOCUSABLE_SELECTOR)]
const controlNamed = (toolbar, name) => {
  const hits = controlsIn(toolbar).filter((el) => nameOf(el) === name)
  if (hits.length !== 1) throw new Error(`expected ONE control named ${JSON.stringify(name)}, found ${hits.length}`)
  return hits[0]
}

// What a phone keeps in the row: the 10B touch Undo / Redo, Bold, Italic, the bullet list, and
// the mic (controller ruling: dictation stays one tap away on a phone).
const KEPT = ['Undo', 'Redo', 'B', 'I', '• List', 'Start voice input']
// Everything else the row carries.
const MOVED = [
  'Font family', 'Text size', TEXT_COLOR_MENU_LABEL, 'H1', 'H2',
  '1. List', '❝', '</>', 'Insert link', 'Insert image', 'Scan a document with the camera',
  'Attach a file', 'Horizontal rule', 'Insert widget',
]
// The row BEFORE D3P, in its own (DOM = Tab = desktop visual) order, read off 11349f524.
const ROW_BEFORE_D3P = [
  'Undo', 'Redo', 'Font family', 'Text size', 'B', 'I', TEXT_COLOR_MENU_LABEL, 'H1', 'H2',
  '• List', '1. List', '❝', '</>', 'Insert link', 'Insert image', 'Scan a document with the camera',
  'Attach a file', 'Start voice input', 'Horizontal rule', 'Insert widget',
]

describe('D3P: the phone formatting disclosure holds the moved controls, never the kept ones', () => {
  it('one toggle, collapsed, controlling exactly four runs inside the Editor toolbar', async () => {
    const toolbar = await mountToolbar()
    const toggle = toggleOf(toolbar)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const runs = runsOf(toolbar)
    expect(runs).toHaveLength(4)
    for (const run of runs) {
      expect(run, 'aria-controls names an element that exists').toBeTruthy()
      expect(toolbar.contains(run)).toBe(true)
      expect(run).toHaveAttribute('data-format-run')
    }
    // and nothing else in the row claims to be a run
    expect(toolbar.querySelectorAll('[data-format-run]')).toHaveLength(4)
  }, 60000)

  it('every MOVED control is inside a run; every KEPT control is in the row and in no run', async () => {
    const toolbar = await mountToolbar()
    const runs = runsOf(toolbar)
    const inRun = (el) => runs.some((r) => r.contains(el))
    for (const name of MOVED) expect(inRun(controlNamed(toolbar, name)), `${name} is behind Format`).toBe(true)
    for (const name of KEPT) expect(inRun(controlNamed(toolbar, name)), `${name} stays out`).toBe(false)
    expect(inRun(toggleOf(toolbar)), 'the toggle is not inside what it opens').toBe(false)
  }, 60000)

  it('COMPLETE: every control in the row is kept, moved or the toggle -- a new one must be classified', async () => {
    const toolbar = await mountToolbar()
    const names = controlsIn(toolbar).map(nameOf)
    const known = new Set([...KEPT, ...MOVED, 'Format'])
    expect(names.filter((n) => !known.has(n))).toEqual([])
    // non-vacuity: the classification covers the whole row, not a lucky subset
    expect(names).toHaveLength(KEPT.length + MOVED.length + 1)
  }, 60000)
})

describe('D3P: the disclosure keeps the editor keyboard contract (lib/useDisclosureFocus.js)', () => {
  const tab = (shift = false) => fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: shift })

  it('opening moves focus to the first moved control; Tab and Shift+Tab stay inside; Escape closes and returns', async () => {
    const toolbar = await mountToolbar()
    const toggle = toggleOf(toolbar)
    toggle.focus()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toolbar).toHaveAttribute('data-format-open', 'true')
    expect(document.activeElement).toBe(controlNamed(toolbar, 'Font family'))

    const ring = tabRing(toolbar)
    ring[ring.length - 1].focus()
    tab()
    expect(document.activeElement, 'Tab off the last control wraps inside the toolbar').toBe(ring[0])
    tab(true)
    expect(document.activeElement, 'Shift+Tab off the first wraps to the last').toBe(ring[ring.length - 1])

    controlNamed(toolbar, 'H2').focus()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toolbar).not.toHaveAttribute('data-format-open')
    expect(document.activeElement).toBe(toggle)
  }, 60000)

  it('CONTROL: closed, the toolbar is not a disclosure -- Tab is not trapped and Escape does nothing', async () => {
    const toolbar = await mountToolbar()
    expect(toolbar).not.toHaveAttribute('data-contained-disclosure')
    const ring = tabRing(toolbar)
    ring[ring.length - 1].focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(ev)
    expect(ev.defaultPrevented, 'no trap while closed').toBe(false)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(toggleOf(toolbar)).toHaveAttribute('aria-expanded', 'false')
  }, 60000)

  it('a moved control still ACTS from inside the open disclosure (H1 toggles the heading)', async () => {
    const toolbar = await mountToolbar()
    fireEvent.click(toggleOf(toolbar))
    const h1 = controlNamed(toolbar, 'H1')
    fireEvent.mouseDown(h1)
    fireEvent.click(h1)
    await waitFor(() => expect(document.querySelector('.ProseMirror h1')?.textContent).toBe('Start.'))
  }, 60000)
})

describe('D3P fix round 1: the disclosure never outlives what it was opened on', () => {
  // M-5. Locking the note unmounts the toolbar row. Before the fix `formatOpen` survived that, so
  // on unlock the row came back EXPANDED with nothing having moved focus into it.
  it('open -> lock -> unlock: the row comes back COLLAPSED (aria-expanded false)', async () => {
    const toolbar = await mountToolbar()
    fireEvent.click(toggleOf(toolbar))
    expect(toggleOf(toolbar)).toHaveAttribute('aria-expanded', 'true')

    CURRENT = { ...NOTE, locked: true }
    rerenderPage()
    // non-vacuity: the lock really took the row away, so the reset below is a reset, not a no-op
    await waitFor(() => expect(document.querySelector('[data-format-toggle]')).toBeNull())

    CURRENT = { ...NOTE, locked: false }
    rerenderPage()
    const back = await waitFor(() => {
      const t = document.querySelector('[data-format-toggle]')
      if (!t) throw new Error('toolbar not back')
      return t
    })
    expect(back).toHaveAttribute('aria-expanded', 'false')
    expect(back.closest('[role="toolbar"]')).not.toHaveAttribute('data-format-open')
  }, 60000)

  /** A matchMedia whose queries all answer `matches`, with 'change' listeners kept PER QUERY so
   *  a cell can fire the canonical phone query's change alone (other media hooks untouched).
   *  Every MQ.phone listener is fired -- the disclosure's AND useIsPhone's (round 2's gate). */
  function mockMatchMedia(matches) {
    const listeners = new Map()
    const setFor = (q) => { if (!listeners.has(q)) listeners.set(q, new Set()); return listeners.get(q) }
    const original = window.matchMedia
    window.matchMedia = vi.fn((query) => ({
      matches, media: query, onchange: null,
      addEventListener: (type, fn) => { if (type === 'change') setFor(query).add(fn) },
      removeEventListener: (type, fn) => { if (type === 'change') setFor(query).delete(fn) },
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }))
    const fire = (to) => act(() => { for (const fn of [...setFor(MQ.phone)]) fn({ matches: to, media: MQ.phone }) })
    return { phone: () => setFor(MQ.phone), fire, restore: () => { window.matchMedia = original } }
  }

  // M-4a. Widening past 640 px with it open closes it (the toggle does not exist up there).
  // Re-review m-1: the same change RELEASES round 2's first-run hold (the card may show now).
  it('a matchMedia change that leaves the phone tier closes an open disclosure and releases the first-run stage', async () => {
    const mm = mockMatchMedia(true)
    try {
      const toolbar = await mountToolbar()
      fireEvent.click(toggleOf(toolbar))
      expect(toggleOf(toolbar)).toHaveAttribute('aria-expanded', 'true')
      expect(mm.phone().size, 'non-vacuity: the open disclosure listens on the canonical phone query').toBeGreaterThan(0)
      expect(isFirstRunStageHeld(), 'at phone width the open editor holds the first-run stage').toBe(true)
      mm.fire(false)
      expect(isFirstRunStageHeld(), 'widened past 640 px, the editor lets go of it').toBe(false)
      expect(toggleOf(toolbar)).toHaveAttribute('aria-expanded', 'false')
      expect(toolbar).not.toHaveAttribute('data-format-open')
    } finally {
      mm.restore()
    }
  }, 60000)

  // Re-review m-1, the reverse: narrowing INTO the phone tier with the editor open claims the stage.
  it('a matchMedia change that enters the phone tier with the editor open claims the first-run stage', async () => {
    const mm = mockMatchMedia(false)
    try {
      await mountToolbar()
      expect(isFirstRunStageHeld(), 'above 640 px the editor holds nothing').toBe(false)
      expect(mm.phone().size, 'non-vacuity: something listens on the canonical phone query').toBeGreaterThan(0)
      mm.fire(true)
      expect(isFirstRunStageHeld(), 'narrowed to a phone, the open editor now holds the stage').toBe(true)
    } finally {
      mm.restore()
    }
  }, 60000)
})

describe('D3P CONTROL: above 640 px nothing changes', () => {
  it("the row's own order (its desktop order and Tab order) is the pre-D3P row, the phone-only toggle aside", async () => {
    const toolbar = await mountToolbar()
    const names = controlsIn(toolbar).map(nameOf).filter((n) => n !== 'Format')
    expect(names).toEqual(ROW_BEFORE_D3P)
  }, 60000)

  it('the toggle is the only element D3P added that can take focus, and it carries the phone-only class', async () => {
    const toolbar = await mountToolbar()
    const toggle = toggleOf(toolbar)
    expect(toggle.className).toMatch(/formatToggle/)
    for (const run of runsOf(toolbar)) {
      expect(run.className).toMatch(/formatRun/)
      expect(run.matches(FOCUSABLE_SELECTOR), 'a run is a wrapper, never a tab stop').toBe(false)
    }
  }, 60000)
})
