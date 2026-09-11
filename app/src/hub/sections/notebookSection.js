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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import useHubMode from '../useHubMode'
import useHubCursor from '../useHubCursor'
import { modesById } from '../registry'
import { applyTargetToParams } from '../../pages/journal-2-0/lib/searchNavigation'
import { createNoteViaApi } from '../../pages/journal-2-0/lib/noteCreation'
import { createVoiceNote, startVoiceRecording, VOICE_NOTE_MESSAGES } from '../voiceNote'

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
 * ⛔ THE LIST'S IDENTITY IS THE FILTER, NOT THE SELECTION.
 *
 * `useHubCursor` treats a change of identity as "this is a different list" and resets the index.
 * The first version of this folded the WHOLE query string in — including `note` — so opening a note
 * changed the identity and reset the cursor to 0. Tap-to-advance then bounced back to the first
 * card on every single tap, and the member could never get past note one. Its own rail caught it
 * ("tap did not advance the cursor").
 *
 * So the selection params are excluded and the filter params are kept: changing folder or tag IS a
 * different list and should reset; opening a note is not.
 */
const SELECTION_PARAMS = ['note', 'doc', 'page', 'excerpt', 'review']

function listScope(pathname, search) {
  const params = new URLSearchParams(search)
  for (const p of SELECTION_PARAMS) params.delete(p)
  params.sort()   // a stable string regardless of the order the app happened to write them
  const q = params.toString()
  return q ? `${pathname}?${q}` : pathname
}

/**
 * ⭐ THE IDENTITY KEY IS THE NOTE ID, NOT THE POSITION. A member creating a note prepends a row,
 * and a positional identity would leave the cursor pointing at whatever slid into its index. The
 * route is folded in so moving between folders is a genuinely different list.
 */
const makeIdentityKey = (scope) => (id, index) => `notebook:${scope}:${id ?? index}`

/**
 * The chip's scrub readout: "Notebook · 3/12".
 *
 * ⛔⛔ THIS WAS MISSING, AND `contracts.js:422` HAS ALWAYS SAID IT MUST NOT BE. The rule is "a
 * section with onScrub must also supply readout() — a scrub the chip cannot narrate is invisible",
 * and this controller has shipped an `onScrub` with no `readout` since B10. It was never caught
 * because the check runs in `registerHubMode` (`HubContext.jsx:166`) and every existing notebook
 * rail renders the HOOK without a provider, so the mounted boundary — the only place the contract
 * is enforced — was never crossed in a test. D-17's rail mounts the real `NotebookHubSection` under
 * a real `HubProvider`, and the contract threw on the first run.
 *
 * ⚠️ INDEX/COUNT, NOT THE NOTE'S TITLE. The hub knows the ids (R-18's `data-note-card-id`) and
 * nothing else about a card; scraping a title out of `textContent` would be a second authority on
 * what a note is called, drifting the moment the card's layout changes. This is the same form the
 * Screener's own chip uses (`screenerSection.js` `chipLabel`).
 */
export function notebookReadout({ index = 0, count = 0 } = {}) {
  if (!count || count <= 0) return 'No notes'
  const at = Math.min(Math.max(index, 0), count - 1)
  return `Notebook · ${at + 1}/${count}`
}

export default function useNotebookSection() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const onRoute = location.pathname.startsWith(NOTEBOOK_ROUTE)

  // The rendered list, read out of the document. Re-read when the route or the query changes,
  // which is when the grid can have re-rendered.
  const [ids, setIds] = useState([])
  const scope = listScope(location.pathname, location.search)

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

  // ── D-17, the voice note ──────────────────────────────────────────────────────────────────────
  //
  // ⭐ A TOGGLE, NOT PUSH-TO-TALK, AND THAT MIRRORS THE APP'S OWN DICTATION CONTROL.
  // `VoiceInputButton.jsx:185-188` is a toggle too (`if (recording) stopRecording(); else
  // startRecording()`), so "fire once to start, again to save" is the behaviour this app already
  // teaches. A fan bubble has no press-and-hold anyway: the gesture that fires it ENDS on release.
  //
  // ⛔ THE LABEL CARRIES THE STATE, for the same reason `calendar.macro`'s does: a bubble that reads
  // the same in both positions tells the member nothing about which way the next fire will go.
  const [voiceMsg, setVoiceMsg] = useState(null)
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef(null)
  // ⛔ A REF, NOT STATE, FOR THE BUSY LATCH. Two fires inside one render would both read the same
  // stale `false` from state and open two microphones; a ref is written before the first await.
  const busyRef = useRef(false)

  // The message clears itself EXCEPT while recording, which is a state the member needs to keep
  // reading — a 2.2s auto-clear would take "Recording…" away mid-sentence and leave a fired gesture
  // with nothing on screen to say it is still live.
  useEffect(() => {
    if (!voiceMsg || recording) return undefined
    const t = setTimeout(() => setVoiceMsg(null), 4000)
    return () => clearTimeout(t)
  }, [voiceMsg, recording])

  // An open microphone must not outlive the controller, OR the route. Leaving the track live would
  // keep the browser's recording indicator on over a page whose fan no longer carries the bubble
  // that would stop it — a recording the member cannot end. Navigating away ABANDONS it rather than
  // saving it: the member left before the second fire, and writing a note they never confirmed
  // would be the hub deciding on their behalf.
  useEffect(() => {
    if (onRoute) return undefined
    if (recorderRef.current) {
      recorderRef.current.cancel?.()
      recorderRef.current = null
      setRecording(false)
      setVoiceMsg('Recording stopped — you left the Notebook.')
    }
    return undefined
  }, [onRoute])

  useEffect(() => () => {
    recorderRef.current?.cancel?.()
    recorderRef.current = null
  }, [])

  const toggleVoiceNote = useCallback(async () => {
    if (busyRef.current) return
    const active = recorderRef.current

    if (active) {
      recorderRef.current = null
      setRecording(false)
      busyRef.current = true
      try {
        const blob = await active.stop()
        setVoiceMsg('Transcribing…')
        const note = await createVoiceNote({ blob })
        setVoiceMsg(null)
        openNote(note?.id)
      } catch (err) {
        // ⛔ EVERY FAILURE ENDS IN A SENTENCE. The transcribe endpoint refuses four ways a member can
        // act on (paid plan, voice disabled in settings, monthly cap, provider down) and each
        // carries its own words; `transcribeVoiceNote` surfaces them. A swallowed error here would
        // be a gesture that records the member's voice and then throws it away in silence.
        setVoiceMsg(err?.message || VOICE_NOTE_MESSAGES.failed)
      } finally {
        busyRef.current = false
      }
      return
    }

    busyRef.current = true
    try {
      recorderRef.current = await startVoiceRecording()
      setRecording(true)
      setVoiceMsg('Recording — fire Voice note again to save.')
    } catch (err) {
      setVoiceMsg(err?.message || VOICE_NOTE_MESSAGES.failed)
    } finally {
      busyRef.current = false
    }
  }, [openNote])

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
      readout: () => notebookReadout({ index, count }),
      fan: mode.fan.map((action) => {
        if (action.id === 'notebook.newNote') {
          return { ...action, run: async () => { const note = await createNoteViaApi({}); openNote(note?.id) } }
        }
        if (action.id === 'notebook.voiceNote') {
          return { ...action, label: recording ? 'Stop' : action.label, run: toggleVoiceNote }
        }
        return action
      }),
    }
  }, [onRoute, ids, index, count, next, scrubTo, openNote, recording, toggleVoiceNote])

  useHubMode(config)

  return { onRoute, ids, index, count, next, prev, openNote, voiceMsg, recording }
}

function sameOrder(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}
