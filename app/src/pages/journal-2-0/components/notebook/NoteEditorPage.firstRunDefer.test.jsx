import { render, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MQ } from '../../../../styles/breakpoints'
import FloatingOrb from '../../../../components/voice/FloatingOrb'
import { VoiceProvider } from '../../../../context/VoiceContext'
import { registerFirstRunSlot, isFirstRunStageHeld } from '../../../../components/firstRun/firstRunStage'
import VoiceInputButton from '../VoiceInputButton'

// Wave 10 lane D3P round 2 -- OWNER-DELEGATED RULING (a): on a PHONE (<= 640 px, MQ.phone),
// while the note EDITOR is open, the two first-run moments WAIT: the "Meet Compass" coach card
// (FloatingOrb, portaled into Layout's first-run slot) and the mic's in-flow dictation hint
// (VoiceInputButton). They stay PENDING and show on the next surface that is not the editor.
// At 390x844 on a first visit they pushed the first body line 78-188 px below the fold
// (docs/notebook/proof/d3p-raw/after, 3ba27d37e).
//
// What this file holds, through the REAL editor, the REAL orb and the REAL mic:
//   1. phone: while the editor is open neither shows; the persisted first-run state is
//      byte-identical before and after the visit; once the editor closes the card is back in
//      the slot and a non-editor mic shows the hint -- both still pending;
//   2. CONTROL (above 640 px): nothing changes -- the card and the in-flow hint both show IN
//      the editor, as they did before this round;
//   3. the mic itself stays in the phone toolbar (the earlier ruling); only its HINT waits.
// The authorities are unchanged: FloatingOrb's `coachmarkOn` already waits while the first-run
// stage is held (the Notebook tour's mechanism), and VoiceInputButton's `showHint` is left
// alone -- only its render condition reads the host's `hintDeferred`.

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
  tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
  bodyJson: { type: 'doc', content: [P('Start.')] },
}
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
// Paid, so the editor mounts its mic. Only `useAuth` is replaced: the real `useIsPaid` reads
// the context directly and, with no AuthProvider mounted, answers paid.
vi.mock('../../../../context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: { id: 'u1' }, isPaid: true }),
}))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../../../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn(), isConnected: false }),
}))
vi.mock('../../../../hooks/useHideOnScroll', () => ({ default: () => false }))

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const COACH_KEY = 'voice.orb.coachmarkSeen'
const HINT_KEY = 'voice.dictation.hintSeen'
/** Every persisted first-run flag, as one string. Byte-compared before and after a visit. */
const firstRunState = () => JSON.stringify(
  Object.keys(localStorage).sort()
    .filter((k) => /seen|dismiss|coach|hint|tour|onboard|first.?run/i.test(k))
    .map((k) => [k, localStorage.getItem(k)]),
)

/** A viewport of `width` px: each (max-width)/(min-width) clause is evaluated, nothing else matches. */
function setViewport(width) {
  window.matchMedia = vi.fn((query) => {
    const clauses = [...String(query).matchAll(/\((max|min)-width:\s*(\d+)px\)/g)]
    const matches = clauses.length > 0 && clauses.every(([, kind, n]) => (kind === 'max' ? width <= Number(n) : width >= Number(n)))
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }
  })
}

let slot
let originalMatchMedia
let originalSR
beforeEach(() => {
  localStorage.clear()
  originalMatchMedia = window.matchMedia
  originalSR = window.SpeechRecognition
  // a browser that can dictate, so the mic -- and its first-run hint -- are real
  window.SpeechRecognition = class { start() {} stop() {} abort() {} }
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  slot = document.createElement('div')
  slot.setAttribute('data-first-run-slot', '')
  document.body.appendChild(slot)
  act(() => { registerFirstRunSlot(slot) })
})
afterEach(() => {
  act(() => { registerFirstRunSlot(null) })
  window.matchMedia = originalMatchMedia
  window.SpeechRecognition = originalSR
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

const card = () => slot.querySelector('[data-orb-coachmark]')

function mountOrb() {
  const div = document.createElement('div')
  document.body.appendChild(div)
  return render(
    <MemoryRouter initialEntries={['/journal/notebook']}><VoiceProvider><FloatingOrb /></VoiceProvider></MemoryRouter>,
    { container: div },
  )
}

async function mountEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const div = document.createElement('div')
  document.body.appendChild(div)
  const view = render(
    <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>,
    { container: div },
  )
  await waitFor(() => {
    if (!div.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
  const toolbar = within(div).getByRole('toolbar', { name: 'Editor toolbar' })
  // the lazy mic arrives in its own Suspense boundary
  await within(toolbar).findByRole('button', { name: /voice input/i })
  return { ...view, toolbar }
}

describe('D3P round 2: on a phone the editor DEFERS the first-run card and hint -- never dismisses them', () => {
  it('390 px: neither shows while the editor is open, nothing is marked seen, and both show on the next surface', async () => {
    setViewport(390)
    mountOrb()
    // CONTROL: the card is pending and would show -- before the editor opens it is in the slot
    expect(card(), 'the card is pending before the editor opens').not.toBeNull()
    const before = firstRunState()
    expect(localStorage.getItem(COACH_KEY)).toBeNull()
    expect(localStorage.getItem(HINT_KEY)).toBeNull()

    const editor = await mountEditor()
    expect(isFirstRunStageHeld(), 'the phone editor holds the first-run stage').toBe(true)
    await waitFor(() => expect(card(), 'the card waits while the editor is open').toBeNull())
    // the mic stays (the earlier ruling); only its first-run hint waits
    expect(within(editor.toolbar).getByRole('button', { name: /voice input/i })).toBeTruthy()
    expect(editor.toolbar.querySelector('[data-hint-placement]'), 'the in-flow hint waits').toBeNull()
    expect(within(editor.toolbar).queryByRole('button', { name: 'Dismiss tip' })).toBeNull()

    // ⛔ the persisted first-run state is byte-identical: waiting is never "seen"
    expect(firstRunState()).toBe(before)

    editor.unmount()
    expect(isFirstRunStageHeld(), 'closing the editor releases the stage').toBe(false)
    await waitFor(() => expect(card(), 'the card shows on the next surface').not.toBeNull())
    expect(firstRunState()).toBe(before)

    // a surface that is not the editor (the Day notes' mic, a floating hint)
    const other = render(<VoiceInputButton onTranscript={vi.fn()} />)
    expect(within(other.container).getByRole('button', { name: 'Dismiss tip' }), 'the hint shows on the next mic').toBeTruthy()
    expect(firstRunState()).toBe(before)
    expect(localStorage.getItem(COACH_KEY)).toBeNull()
    expect(localStorage.getItem(HINT_KEY)).toBeNull()
  }, 60000)
})

describe('D3P round 2 CONTROL: above 640 px nothing changes', () => {
  it('1200 px: the card and the in-flow hint both show IN the editor, as before', async () => {
    setViewport(1200)
    mountOrb()
    const editor = await mountEditor()
    expect(isFirstRunStageHeld(), 'the desktop editor holds nothing').toBe(false)
    expect(card(), 'the card shows with the editor open').not.toBeNull()
    expect(editor.toolbar.querySelector('[data-hint-placement="in-flow"]'), 'the in-flow hint shows').not.toBeNull()
    editor.unmount()
  }, 60000)

  it('641 px (the first tablet width): unchanged too', async () => {
    setViewport(641)
    mountOrb()
    const editor = await mountEditor()
    expect(isFirstRunStageHeld()).toBe(false)
    expect(card()).not.toBeNull()
    expect(editor.toolbar.querySelector('[data-hint-placement="in-flow"]')).not.toBeNull()
    editor.unmount()
  }, 60000)
})
