// app/src/hub/sections/notebookSection.js — the Notebook's hub controller (§3.7).
//
// ⛔ MOUNTED FROM THE HUB, NOT THE PAGE, AND THAT IS A DEPARTURE. Every other controller mounts
// from its page — wireSection from MorningWire.jsx, breadthSection from Breadth.jsx,
// screenerSection from ScannerShell.jsx, journalSection from OpenPositionsTab.jsx — and
// `Layout.jsx:116-121` states the reason: "the hub cannot own an index into a list it cannot see
// (spec §2 exception (b))".
//
// ⭐ THAT REASON NO LONGER HOLDS HERE, WHICH IS WHY THE DEPARTURE IS ALLOWED. R-18 put
// `data-note-card-id` on every grid card, so the note list IS visible from the DOM — the same
// position Morning Wire has always been in, where the segments live inside a
// `dangerouslySetInnerHTML` blob the hub does not own and `paintCursor` reads them out of the
// document. The alternative was editing `NotebookTab.jsx`, which rule 12 forbids outright.
//
// ⚠️ SO THE SELECTOR IS A CONTRACT WITH ANOTHER WORKSTREAM, and it is railed twice: once that the
// attribute renders at all (`hub/noteCardIdentity.test.jsx`) and once that a change to that file
// can only ever be the attribute (`hub/rule12Paths.test.js`). If the cards stop carrying it, this
// controller finds zero notes and the failure is loud in our suite rather than silent on a phone.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import useHubMode from '../useHubMode'
import useHubCursor from '../useHubCursor'
import { modesById } from '../registry'
import { applyTargetToParams } from '../../pages/journal-2-0/lib/searchNavigation'
import { createNoteViaApi } from '../../pages/journal-2-0/lib/noteCreation'

/** The one DOM contract this controller depends on. R-18; see the header. */
export const NOTE_CARD_SELECTOR = '[data-note-card-id]'
export const NOTEBOOK_ROUTE = '/journal/notebook'
const LIST_ID = 'notebook'

/** Note ids, in the order the grid rendered them. */
export function noteIdsInDocument(root = typeof document === 'undefined' ? null : document) {
  if (!root) return []
  return [...root.querySelectorAll(NOTE_CARD_SELECTOR)]
    .map((el) => el.getAttribute('data-note-card-id'))
    .filter(Boolean)
}

/** Card nodes, in the same order as `noteIdsInDocument` — what `paintCursor` is handed. */
export function noteCardNodes(root = typeof document === 'undefined' ? null : document) {
  return root ? [...root.querySelectorAll(NOTE_CARD_SELECTOR)] : []
}

/**
 * ⭐ THE IDENTITY KEY IS THE NOTE ID, NOT THE POSITION. A member creating a note prepends a row,
 * and a positional identity would leave the cursor pointing at whatever slid into its index. The
 * route is folded in so moving between folders is a genuinely different list.
 */
const makeIdentityKey = (scope) => (id, index) => `notebook:${scope}:${id ?? index}`

export default function useNotebookSection() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const onRoute = location.pathname.startsWith(NOTEBOOK_ROUTE)

  // The rendered list, read out of the document. Re-read when the route or the query changes,
  // which is when the grid can have re-rendered.
  const [ids, setIds] = useState([])
  const scope = `${location.pathname}${location.search}`

  useEffect(() => {
    if (!onRoute) {
      setIds((cur) => (cur.length ? [] : cur))
      return undefined
    }
    const sync = () => setIds((cur) => {
      const next = noteIdsInDocument()
      return sameOrder(cur, next) ? cur : next
    })
    sync()
    // The grid arrives after its fetch resolves, so one read at mount is not enough. A
    // MutationObserver over the subtree is cheaper and more honest than a poll.
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [onRoute, scope])

  const identityKey = useMemo(() => makeIdentityKey(scope), [scope])
  const cursor = useHubCursor(LIST_ID, ids, { key: identityKey })
  const { index, count, next, prev, scrubTo, paintCursor } = cursor

  // Paint the cursor onto whichever nodes are on screen now. Same imperative path Morning Wire
  // uses for markup it does not own; `itemProps` is unavailable because these rows are not our JSX.
  useEffect(() => {
    if (!onRoute) return
    paintCursor(noteCardNodes())
  }, [onRoute, index, ids, paintCursor])

  /**
   * Open a note by writing the URL — never by clicking the card.
   *
   * ⛔ THROUGH `applyTargetToParams`, NOT `params.set('note', id)`. That helper DELETES
   * `doc`/`page`/`excerpt`/`review` before setting `note`, so moving the cursor cannot leave a
   * stale `?doc=&page=47` pointing into a DIFFERENT note — the half-retrieval its own module
   * header says it exists to close.
   *
   * ⛔ PUSH, NOT REPLACE. Both of the Notebook's own writers use `{ replace: false }`
   * (`NotebookTab.jsx:355`, `:367`), so the back button unwinds a hub selection exactly as it
   * unwinds a tap. Replace would make the hub's action invisible to history while the page's
   * identical action is not.
   */
  const openNote = useCallback((noteId) => {
    if (!noteId) return
    setSearchParams((prev) => applyTargetToParams(prev, { noteId, depth: 'note' }),
      { replace: false })
  }, [setSearchParams])

  const config = useMemo(() => {
    if (!onRoute) return undefined
    const mode = modesById[LIST_ID]
    if (!mode) return undefined
    return {
      ...mode,
      // Tap advances the cursor and opens what it lands on — the registry's `tap: next note`.
      onTap: () => {
        const at = next()
        openNote(ids[at ?? 0])
      },
      onScrub: (_ctx, scrub) => { if (scrub && typeof scrub.delta === 'number') scrubTo(scrub.delta) },
      fan: mode.fan.map((action) => (
        action.id === 'notebook.newNote'
          ? { ...action, run: async () => { const note = await createNoteViaApi({}); openNote(note?.id) } }
          : action
      )),
    }
  }, [onRoute, ids, next, scrubTo, openNote])

  useHubMode(config)

  return { onRoute, ids, index, count, next, prev, openNote }
}

function sameOrder(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}
