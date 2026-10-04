import { useEffect, useState } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave 13, lane 13Q-Q1check -- controller follow-up. 13Q-2's own regression
// test (NoteEditorPage.wave13Q2focus.test.jsx) mocks useJ2Note to return the
// loaded note SYNCHRONOUSLY from the very first render -- which is exactly
// the shape useJ2Note has in production ONLY because NotebookTab.jsx now
// primes the SWR cache before this component ever mounts (see createNote's
// comment there). That mock could never have caught the real bug, because it
// never exercises the race the real app has for a note useSWR has nothing
// cached for: `note: null` on mount, `note: {...}` a render or two later.
//
// This file reproduces THAT race directly, against the real, unchanged
// NoteEditorPage.jsx, to pin the mechanism the R-RAW browser trace measured
// (docs/notebook/evidence/wave13-q1check/remount-trace-diagnosis/results.json
// -- a second `.ProseMirror` identity added and removed in the same batch,
// `.ProseMirror` never receiving a focusin, in 10/10 real-browser reps):
// `useEditor` is keyed on `[note?.id]` (NoteEditorPage.jsx's own comment on
// that hook explains why -- an already-templated note must not flash empty
// and risk autosaving a ProseMirror repair transaction), so a note that
// resolves AFTER mount silently rebuilds the editor, tearing down whichever
// instance the 'body' openFocus effect's one-shot call already fired
// against.
//
// ⛔⛔ UPDATED, 13Q-Q1check controller follow-up #2. This WAS a
// characterization of a defect: the old one-shot body-focus effect consumed
// `openFocusDoneRef.current` the instant it ran, whether or not the call
// actually landed -- so a remount after that premature claim stranded focus
// forever, and the only thing standing between a member and that outcome was
// NotebookTab.jsx's upstream SWR-cache prime keeping this component from
// ever seeing the race.
//
// The follow-up #2 fix (poll `editor.view.dom.isConnected` across animation
// frames, claim the one-shot ONLY at the moment focus is actually applied)
// closes this at the EFFECT level too, independent of the upstream prime:
// editor #1 (built while `note?.id` is still undefined) never gets to
// connect its DOM before the note resolves and `useEditor` rebuilds it, so
// it never consumes the one-shot claim either -- the effect's cleanup
// cancels editor #1's pending poll, and the re-run against editor #2 (the
// stable, post-rebuild instance) finds its DOM already connected (by the
// time this effect's dependency array picks up the new `editor` identity,
// `EditorContent`'s own `componentDidMount` for editor #2 has already run in
// the same commit -- React runs child layout effects before parent ones)
// and fires normally. This file now asserts that corrected, self-healing
// behavior rather than the defect it used to characterize. The upstream
// prime in NotebookTab.jsx is UNCHANGED and still correct defense in depth --
// it means the "+ New note" path never has to rely on this effect's own
// recovery at all.

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const blankNote = (id) => ({
  id, title: '', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
})

// A controllable stand-in for useSWR's own null -> loaded transition: starts
// exactly like a cache-miss (`note: null, isLoading: true`), and only reports
// the real note once `resolve()` is called from the test -- same two-phase
// shape useJ2Notes.js's real useSWR hook has for a key nothing has cached yet.
let resolve
let state
function useJ2NoteRaceMock() {
  const [value, setValue] = useState(state)
  useEffect(() => {
    resolve = (note) => { state = { note, isLoading: false }; setValue(state) }
  }, [])
  return { ...value, error: null, refresh: vi.fn(), update: vi.fn(async (p) => ({ ...value.note, ...p })) }
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (...args) => useJ2NoteRaceMock(...args),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  state = { note: null, isLoading: true }
  resolve = null
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => vi.clearAllMocks())

async function renderEditorWaitingOnNote() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const onOpenFocused = vi.fn()
  render(
    <MemoryRouter>
      <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack openFocus="body" onOpenFocused={onOpenFocused} />
    </MemoryRouter>,
  )
  // The pre-load render: `note` is still null, same as a fresh useSWR cache
  // miss -- NoteEditorPage renders its loading skeleton, not the title/body,
  // while isLoading is true. `useEditor` has already run by this point
  // (hooks can't be conditional on isLoading), but with nothing to key a
  // rebuild on yet (`note?.id` is undefined).
  await screen.findByRole('status')
  return { onOpenFocused }
}

describe('13Q-Q1check: the remount a late-arriving note causes is now self-healed', () => {
  it('a note that loads AFTER mount rebuilds the editor, and the retry-based body focus still lands on the post-rebuild editor', async () => {
    const { onOpenFocused } = await renderEditorWaitingOnNote()

    // Now the SWR fetch "resolves" -- same transition NotebookTab.jsx's
    // un-primed cache would have produced before the 13Q-Q1check fix.
    // `note?.id` flips from undefined to 'n1' in this one render, which is
    // exactly the dependency change `useEditor([note?.id])` rebuilds on.
    await act(async () => { resolve(blankNote('n1')) })
    await screen.findByPlaceholderText('Title')

    // Let the rebuild's effects (useEditor's own, then the openFocus one)
    // finish settling -- mirrors the real page's 3s settle window finding
    // no further DOM churn after the swap.
    await new Promise((r) => setTimeout(r, 50))

    // Pre-fix this read FALSY: the guard had already claimed against the
    // pre-rebuild editor (which never connected before being torn down), so
    // the now-stable, post-rebuild editor never got the command at all. The
    // follow-up #2 fix only claims the one-shot at the moment it actually
    // fires, so editor #1's aborted poll never consumes it and editor #2's
    // fresh poll succeeds.
    expect(document.activeElement?.closest('.ProseMirror')).toBeTruthy()
    expect(onOpenFocused).toHaveBeenCalledTimes(1)
  })

  // Non-vacuity control: when the note is ALREADY the one useJ2Note returns
  // (no race -- the shape NotebookTab.jsx's prime produces), the SAME
  // component, SAME effect, lands focus correctly on the first try -- no
  // loading phase at all, so this uses its own render helper rather than
  // `renderEditorWaitingOnNote`'s wait for the loading skeleton. This is
  // what proves the test above is about the RACE and not some unrelated
  // breakage in this mock harness.
  it('CONTROL: no race (note already loaded on mount) -- focus lands, same as 13Q-2', async () => {
    state = { note: blankNote('n1'), isLoading: false }
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    const onOpenFocused = vi.fn()
    render(
      <MemoryRouter>
        <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack openFocus="body" onOpenFocused={onOpenFocused} />
      </MemoryRouter>,
    )
    await screen.findByPlaceholderText('Title')
    await waitFor(() => {
      expect(document.activeElement?.closest('.ProseMirror')).toBeTruthy()
    })
    expect(onOpenFocused).toHaveBeenCalledTimes(1)
  })
})
