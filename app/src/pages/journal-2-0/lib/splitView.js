/**
 * Wave 6 (lane E, item 7) — split view: a second note beside the first,
 * desktop only (≥1025px).
 *
 * The URL carries it: `?note=<main>&side=<side>`. Each pane is an ordinary
 * `NoteEditorPage` — the same component, the same save path, the same owner
 * lock — so nothing about how a note is written changes because it is on the
 * right.
 *
 * ⛔⛔ THE SAME NOTE IS NEVER OPEN IN BOTH PANES. Two editors on one note are
 * two writers, and the offline layer forks the note. `NotebookTab` refuses it
 * at every door and focuses the pane that already holds the note.
 *
 * Two contexts, so the components inside a pane can open notes the right way
 * WITHOUT a prop threaded through `NoteEditorPage` (lane D's file):
 *   · `SplitViewContext` — the tab: can it split here, and "open this beside".
 *   · `NotePaneContext`  — the pane a component sits in: "open this HERE".
 * Rendered outside `NotebookTab` (another host of the editor), both are null
 * and `useNoteNavigation` does exactly what these links always did.
 */
import { createContext, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { notePath } from '../../../hooks/useNoteBacklinks'

export const SIDE_PARAM = 'side'

/** `{ canSplit, openToSide(id) }` — null outside NotebookTab. */
export const SplitViewContext = createContext(null)
/** `{ pane: 'main' | 'side', open(id) }` — null when the page is not split. */
export const NotePaneContext = createContext(null)

export const useSplitView = () => useContext(SplitViewContext)
export const useNotePane = () => useContext(NotePaneContext)

/**
 * Ctrl+click (Cmd+click on a Mac) — the "open to the side" gesture. A plain
 * primary-button click with Ctrl or Cmd held, nothing else: Shift and Alt
 * already mean other things to a browser, and a middle click is the browser's.
 */
export function isOpenBesideClick(e) {
  if (!e || !(e.metaKey || e.ctrlKey)) return false
  if (e.shiftKey || e.altKey) return false
  return e.button == null || e.button === 0
}

/**
 * → `(note, event) => void` for a LIST of notes (the sidebar): Ctrl/Cmd+click
 * opens the row's note beside, where the page can split; any other click is
 * the list's own `onOpen(note)`, exactly as before.
 */
export function useOpenFromList(onOpen) {
  const split = useContext(SplitViewContext)
  return useCallback((note, e) => {
    if (split?.canSplit && note?.id && isOpenBesideClick(e)) {
      e?.preventDefault?.()
      split.openToSide(note.id)
      return
    }
    onOpen?.(note)
  }, [split, onOpen])
}

/**
 * → `(noteId, event?) => void`, the one way a link to a note inside the
 * Notebook opens it: beside on Ctrl/Cmd+click where the page can split, in
 * its own pane when the page is split, and otherwise the route every note
 * link has always used.
 */
export function useNoteNavigation() {
  const split = useContext(SplitViewContext)
  const pane = useContext(NotePaneContext)
  const navigate = useNavigate()
  return useCallback((noteId, e) => {
    if (!noteId) return
    if (split?.canSplit && isOpenBesideClick(e)) {
      e?.preventDefault?.()
      split.openToSide(noteId)
      return
    }
    if (pane?.open) { pane.open(noteId); return }
    navigate(notePath(noteId))
  }, [split, pane, navigate])
}
