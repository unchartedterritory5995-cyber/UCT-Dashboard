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
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import useHubMode from '../useHubMode'
import useHubCursor from '../useHubCursor'
import { modesById } from '../registry'
import { applyTargetToParams } from '../../pages/journal-2-0/lib/searchNavigation'
import { createNoteViaApi, createNoteFromTemplateViaApi } from '../../pages/journal-2-0/lib/noteCreation'
import { TEMPLATES } from '../../pages/journal-2-0/lib/notebookTemplates'
import { useJ2Note } from '../../pages/journal-2-0/hooks/useJ2Notes'
import { JournalToast } from '../../pages/journal-2-0/lib/useJournalToast'

/** The one DOM contract this controller depends on. R-18; see the header. */
export const NOTE_CARD_SELECTOR = '[data-note-card-id]'
export const NOTEBOOK_ROUTE = '/journal/notebook'
const LIST_ID = 'notebook'

/** Where this section's toast sits: just above the hub's resting corner, as Catalysts' does. */
const TOAST_STYLE = Object.freeze({
  position: 'fixed',
  top: 'auto',
  bottom: 'calc(env(safe-area-inset-bottom) + 68px + 84px + 8px)',
  right: '16px',
  zIndex: 'var(--z-hub-open)',
})

/**
 * The member's typed ticker, or null when what they typed is not one.
 *
 * ⛔ ONE SHAPE CHECK, IN ONE PLACE, AND IT IS NOT A UNIVERSE LOOKUP. This repo has already paid
 * for the other kind (`lesson_a_symbol_universe_does_not_settle_a_ticker_match`): RS, EMA, GAP and
 * PEG are all real tickers, so a list of known symbols rejects real ones and a list of "words that
 * look like tickers" accepts prose. This refuses what CANNOT be a ticker — empty, or carrying a
 * space or a character no symbol uses — and accepts everything else, because the member is naming
 * their own note and the server holds the string verbatim.
 *
 * ⭐ It is what makes the sheet's field REQUIRED: `null` here is the refusal, and the refusal is
 * spoken to the member rather than swallowed.
 */
export function normaliseTicker(raw) {
  const t = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (!t) return null
  return /^[A-Z0-9.\-]{1,10}$/.test(t) ? t : null
}

/**
 * The name a note card is showing, read off the card itself.
 *
 * ⛔ THE HUB HOLDS IDS, NOT TITLES. R-18 gave the grid `data-note-card-id` and nothing else, and
 * the Notebook's own note list is not fetched by this controller — so the only place the title
 * exists on this route is the rendered card. This walks the card's leftmost element spine to the
 * deepest first child, which is `NoteCard`'s title div, rather than taking `textContent` (which
 * concatenates title + subtitle + date + ticker + tags into one run-on string).
 *
 * ⚠️ IT IS A STRUCTURAL READ OF ANOTHER WORKSTREAM'S MARKUP, and it is written to fail SOFT: a
 * reshaped card returns some other text, or nothing, and the caller falls back to the position.
 * That is proportionate because the value is narration on a chip — no write depends on it, and
 * the identity that DOES gate the write is the declared attribute, never this.
 */
export function noteLabelFromCard(node) {
  if (!node) return ''
  let n = node
  while (n.firstElementChild) n = n.firstElementChild
  return (n.textContent || '').trim()
}

/**
 * `notebook.linkTicker`'s sheet — R-17, and the reason the action could come back.
 *
 * ⛔⛔ IT NEVER RETURNS NULL. `HubRoot`'s confirm branch falls back to its own generic payload when
 * a section answers null, and that fallback's primary button calls `action.run?.(ctx, values)` —
 * which this action does not have. A null here would therefore ship the R-09 defect exactly:
 * the member presses a button labelled "Set ticker" and nothing at all happens. The Screener's
 * `alertConfirmPayload` may return null because `scan.alert` KEEPS a `run`; this one may not.
 *
 * ⭐ THE FIELD IS THE SYMBOL SOURCE. `requires: ['symbol']` is gone from the registry entry
 * (see the ⛔⛔ block beside it): the route carries no symbol, so a context precondition could
 * only ever dim the bubble. The field seeds from whatever symbol the hub context is holding and
 * is EMPTY when it holds none — never a fabricated default, because a wrong ticker written
 * silently is worse than an empty box.
 *
 * @param {{noteId: string|null, symbol: string|null,
 *          write: (noteId: string, raw: string) => void}} args
 */
/**
 * The template catalog, as the sheet's picker sees it — R-19.
 *
 * ⛔ DERIVED FROM `lib/notebookTemplates.js`, NEVER TYPED. The keys are stable API
 * (`daily-prep` / `weekly-plan` / `trade-review` predate the catalog and are deep-linkable), and
 * the catalog has grown since its own file header last counted it. A list copied here would agree
 * with the catalog exactly once — on the day it was written — and this repo has paid for that
 * shape in the writer index, the COT router's "4 routes" and the setup catalog's "24".
 */
export function templateOptions(templates = TEMPLATES) {
  return (templates ?? [])
    .filter((t) => t && typeof t.key === 'string' && t.key && typeof t.label === 'string' && t.label)
    .map((t) => ({ value: t.key, label: t.label }))
}

/**
 * `notebook.templates`'s sheet — R-19, and the reason that action could come back.
 *
 * ⛔ IT NEVER RETURNS NULL, for the same reason `linkTickerConfirmPayload` does not: `HubRoot`
 * falls back to its own generic payload when a section answers null, and that fallback's primary
 * calls `action.run?.(ctx, values)` — which this action does not have.
 *
 * ⭐ THE PRESELECTED OPTION IS A PICKER'S STARTING POSITION, NOT A HARDCODED KEY. R-19 rejects
 * "Templates that always makes the same one"; a select whose every option is one tap away is the
 * opposite of that, and `validateConfirmPayload` REQUIRES the initial value to be one of the
 * options (a <select> silently shows its first option otherwise, so the sheet would display one
 * choice and commit another).
 *
 * @param {{options?: Array<{value: string, label: string}>,
 *          write: (templateKey: string) => void}} args
 */
export function templatesConfirmPayload({ options = templateOptions(), write } = {}) {
  const list = options.length ? options : null
  if (!list) {
    // The catalog is empty or unreadable. A picker with nothing to pick is the dead control the
    // contract refuses, so the sheet says so rather than opening a blank one.
    return {
      title: 'Templates',
      body: 'No templates are available right now.',
      primaryLabel: 'Close',
      onConfirm: () => {},
    }
  }
  return {
    title: 'Templates',
    body: 'Start a note from one of the firm\'s templates. Pick one, and the note opens ready to write in.',
    primaryLabel: 'Start note',
    fields: [{ name: 'template', type: 'select', value: list[0].value, options: list }],
    onConfirm: (values) => write?.(values?.template),
  }
}

export function linkTickerConfirmPayload({ noteId = null, symbol = null, write } = {}) {
  const seed = normaliseTicker(symbol) ?? ''
  return {
    title: 'Set ticker',
    body: seed
      ? `File this note under a ticker. ${seed} is the symbol in scope — change it if it is not the one.`
      : 'File this note under a ticker. Type the symbol, e.g. NVDA.',
    primaryLabel: 'Set ticker',
    fields: [{ name: 'ticker', type: 'text', value: seed }],
    onConfirm: (values) => write?.(noteId, values?.ticker),
  }
}

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

  // ── R-17 — the ticker write, and the one client that performs it ─────────
  //
  // ⛔ THE WRITE IS THE NOTEBOOK'S OWN, NOT THE HUB'S. `useJ2Note(id).update(patch)` is the
  // Notebook's note client (`hooks/useJ2Notes.js:159-181`); it PUTs `/api/j2/notes/{id}` and then
  // invalidates BOTH the note's SWR entry and the noteLink title cache. A hub-local `fetch` to the
  // same URL would keep the write-path COUNT identical and silently bypass all of that — the
  // precise regression `writePaths.test.js`'s ownership assertion exists for, which is why the
  // manifest entry for this write is `owner: 'app'`.
  //
  // ⚠️ THERE IS NO `PATCH` CLIENT FOR A NOTE. The whole of `app/src` performs exactly nine PATCH
  // calls and none of them touch a note; the Notebook's own ticker control
  // (`NoteEditorPage.jsx:1743 onTickerChange`) goes through this same `update`, i.e. a PUT with a
  // partial body. The hub uses the member's own door rather than inventing a second one.
  //
  // ⛔⛔ THE CLIENT IS ARMED AT THE GESTURE, NOT AT EVERY CURSOR STEP, and that is not tidiness.
  // `useJ2Note(id)` opens an SWR subscription keyed on the id, so keying it to the CURSOR would
  // fire a GET for every index change — and the index changes on every frame of a scrub. One drag
  // down a fifty-note grid would be fifty requests on a phone. Arming happens inside
  // `confirmPayload`, which runs once, on the gesture that opened the sheet, for the one note the
  // member is about to tag; by the time the sheet's primary button can be pressed the re-render
  // that rebuilt `update` has already committed.
  const [armedNoteId, setArmedNoteId] = useState(null)
  const { update } = useJ2Note(armedNoteId)
  const armedRef = useRef({ noteId: null, update: null })
  armedRef.current = { noteId: armedNoteId, update }

  const [msg, setMsg] = useState(null)
  const toast = useCallback((text) => {
    setMsg(text)
    if (text) window.setTimeout(() => setMsg(null), 2600)
  }, [])

  /** The note the cursor is on RIGHT NOW — read at gesture time, so the fan need not re-register
   *  on every scrub step just to know it. */
  const cursorRef = useRef({ ids, index })
  cursorRef.current = { ids, index }
  const noteUnderCursor = useCallback(() => {
    const { ids: list, index: at } = cursorRef.current
    return list[at] ?? list[0] ?? null
  }, [])

  /**
   * The write. ⛔ IT REFUSES IN TWO WAYS AND SPEAKS BOTH OF THEM.
   *
   *   · an empty or unparseable ticker — this is what "required field" MEANS here, because
   *     `HubConfirmSheet` has no required-field concept: the sheet closes on its primary button
   *     either way, so a refusal that said nothing would be indistinguishable from a success.
   *   · a client armed for a DIFFERENT note than the sheet was built for. `update` bakes its note
   *     id in at render, so writing through an un-armed client would PUT to `/api/j2/notes/null`
   *     or, worse, tag the wrong note. One guard, one place, and it is railed.
   */
  const linkTicker = useCallback(async (noteId, raw) => {
    const ticker = normaliseTicker(raw)
    if (!ticker) { toast('Type a ticker first — nothing was changed.'); return }
    const armed = armedRef.current
    if (!noteId || !armed.update || armed.noteId !== noteId) {
      toast('Could not reach that note — nothing was changed.')
      return
    }
    try {
      await armed.update({ ticker })
      toast(`Tagged ${ticker}`)
    } catch (e) {
      // The server's own message, verbatim: its 4xx bodies name what a member can fix.
      toast(`Could not set the ticker: ${String(e?.message || e)}`)
    }
  }, [toast])

  /**
   * R-19 — start a note from a template the member CHOSE, and open it.
   *
   * ⛔ NO HUB WRITE OF ITS OWN. `createNoteFromTemplateViaApi` is the Notebook's own path — the
   * same `assembleTemplateContext` → `build` → `defaultTitle` chain every other template entry
   * point uses — and it reaches `POST /api/j2/notes`, which the manifest already declares through
   * `noteCreation.js`. No template in the catalog declares `properties`, so the guarded second
   * write inside `createNoteViaApi` stays closed on this path too (railed in
   * `writePathsTransitive.test.js`).
   */
  const startFromTemplate = useCallback(async (key) => {
    const chosen = templateOptions().find((o) => o.value === key)
    if (!chosen) { toast('Pick a template first — nothing was created.'); return }
    try {
      const note = await createNoteFromTemplateViaApi(chosen.value)
      openNote(note?.id)
      toast(`Started ${chosen.label}`)
    } catch (e) {
      toast(`Could not start that note: ${String(e?.message || e)}`)
    }
  }, [openNote, toast])

  const hasNotes = ids.length > 0

  const config = useMemo(() => {
    if (!onRoute) return undefined
    const mode = modesById[LIST_ID]
    if (!mode) return undefined
    return {
      ...mode,
      /**
       * Tap advances the cursor and opens what it LANDS ON — the registry's `tap: next note`.
       *
       * ⚰️ THIS READ `const at = next(); openNote(ids[at ?? 0])`, AND `next()` RETURNS NOTHING.
       * `useHubCursor.next` mutates its store and notifies; it has no return value, so `at` was
       * `undefined` on every tap and `at ?? 0` opened NOTE ONE — forever. The cursor walked away
       * from the note the member kept being shown, and the chip promised "tap: next note" the
       * whole time. Found while wiring R-17, because `linkTicker` writes to the note the cursor
       * is on and the two had to agree.
       *
       * ⭐ ITS OWN RAIL COULD NOT SEE IT: the tap case ran `next(); openNote(ids[before + 1])` —
       * the harness performing the tap ITSELF instead of invoking the `onTap` the product
       * registers. That is the R-05 shape exactly ("a harness that restates the contract"), and
       * the rail is now driven through the registered config.
       *
       * ⛔ THE TARGET IS COMPUTED, NOT RE-READ. `next()` writes the store synchronously while
       * this closure still holds the PRE-tap index, so re-reading the cursor here would name the
       * note it just left. The clamp mirrors `useHubCursor.next`'s — same idiom, same caveat, as
       * `screenerSection.js`'s `onTap`.
       */
      onTap: () => {
        const { ids: list, index: at } = cursorRef.current
        next()
        if (list.length) openNote(list[Math.min(at + 1, list.length - 1)])
      },
      onScrub: (_ctx, scrub) => { if (scrub && typeof scrub.delta === 'number') scrubTo(scrub.delta) },
      /**
       * ⛔⛔ THIS WAS MISSING, AND THE CONTRACT ALREADY FORBADE THAT.
       * `validateSectionConfig` refuses `onScrub` without `readout()` — "a scrub the chip cannot
       * narrate is invisible" — and this controller has shipped a scrub with no readout since
       * §3.7. It never went red because this section's own suite mounted the hook with NO
       * `HubProvider`, so `useHubMode` reached `HubContext`'s no-op default and `registerHubMode`
       * — the single place that validates — was never called. The check ran for the first time
       * when R-17's rail mounted the provider.
       * ⭐ The failure in production is silent by design: `report()` only THROWS in dev, so a
       * member scrubbing the note grid saw a chip that said nothing about where they were.
       *
       * ⭐ The title comes from the card (see `noteLabelFromCard`); the position is always there
       * as the floor, so the chip never goes blank even on a reshaped card.
       */
      readout: () => {
        const at = index
        if (count <= 0 || at < 0) return null
        const where = `${at + 1} of ${count}`
        const title = noteLabelFromCard(noteCardNodes()[at])
        return title ? { label: title, value: where } : { label: 'Note', value: where }
      },
      fan: mode.fan.flatMap((action) => {
        if (action.id === 'notebook.newNote') {
          return [{
            ...action,
            run: async () => { const note = await createNoteViaApi({}); openNote(note?.id) },
          }]
        }
        if (action.id === 'notebook.templates') {
          // ⭐ Unlike linkTicker, this needs NOTHING from the page — it creates a note rather than
          // editing one — so it is present whether or not the grid holds anything. On an empty
          // notebook it is the most useful bubble on the fan.
          return [{ ...action, confirmPayload: () => templatesConfirmPayload({ write: startFromTemplate }) }]
        }
        if (action.id === 'notebook.linkTicker') {
          // ⛔ ABSENT, NEVER PRESENT-AND-INERT (registry.js header). With no note in the grid
          // there is nothing to file under a ticker, and a bubble that can only ever tell the
          // member it cannot work is the dead bubble R-09 was about. This is the presence half
          // of the gate that replaced `requires: ['symbol']`; the field is the other half.
          if (!hasNotes) return []
          return [{
            ...action,
            confirmPayload: (ctx) => {
              const noteId = noteUnderCursor()
              setArmedNoteId(noteId)
              return linkTickerConfirmPayload({
                noteId,
                // ⭐ "the symbol in scope", exactly as R-17 asks — and empty when there is none.
                // The Notebook publishes no symbol of its own (`symbolContext.test.jsx`), so this
                // is whatever the hub context is holding; the member sees it in the box and can
                // change it before anything is written.
                symbol: ctx?.symbol ?? null,
                write: linkTicker,
              })
            },
          }]
        }
        return [action]
      }),
    }
    // ⚠️ `index`/`count` ARE DEPS ON PURPOSE, even though it means re-registering on every scrub
    // step. `HubRoot` recomputes `scrubReadout` from `[state.scrubbing, activeModeConfig, ctx]`,
    // so a `readout` closed over a ref would narrate the step the member started on and never
    // move. `screenerSection` carries the same cost for the same reason. A registration is one
    // setState; what must never ride the cursor is a FETCH, which is why the note client is armed
    // at the gesture instead (see above).
  }, [onRoute, ids, index, count, next, scrubTo, openNote, hasNotes, noteUnderCursor, linkTicker,
    startFromTemplate])

  useHubMode(config)

  return {
    onRoute,
    ids,
    index,
    count,
    next,
    prev,
    openNote,
    // Rendered by `NotebookHubSection`. The host outlives every control that writes to it, so the
    // message is never destroyed in the same commit that sets it.
    hubMount: onRoute ? createElement(JournalToast, { key: 'notebook-toast', msg, style: TOAST_STYLE }) : null,
  }
}

function sameOrder(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}
