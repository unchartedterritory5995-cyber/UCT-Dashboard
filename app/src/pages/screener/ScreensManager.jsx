import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../components/ui/UIcon'
import useSavedScreens from './hooks/useSavedScreens'
import { sharedScreenUrl } from './screenShareLink'
import { useUserDefinitions, deleteUserDefinition } from '../../hooks/useUserDefinitions'
import { scannableScreens, SCAN_TF, defaultSession } from '../../components/screener/scanSession'
import ScanResults from '../../components/screener/ScanResults'
import RunNowButton from '../../components/screener/RunNowButton'
import { DEFAULT_BUDGET } from '../../components/chart/engine/ast/budget'
import panelStyles from '../../components/screener/SavedScreensPanel.module.css'
import styles from './ScannerPro.module.css'

// ⭐ THE ONE BUILDER, LAZY. `ChartToolbar` mounts `BuilderSheet` statically;
// this is its SECOND opener (spec §5.5 "`/screener` authoring door") and it
// resolves the SAME module — `Screener.door.test.jsx` reads both files' import
// graphs and asserts they land on one file. Lazy because the builder pulls the
// whole authoring bundle a member who only reads screens should never download;
// `reachable.test.js` follows `lazy(() => import(…))` edges, so the door is
// still on the import graph and an orphan here would still red.
const BuilderSheet = lazy(() => import('../../components/chart/builder/BuilderSheet'))

/** The door the "New scan" button opens on.
 *
 *  ⛔ CONDITIONS, NOT THE LIBRARY. The sheet's own default is the starter
 *  library, which is right for a member who came to write an INDICATOR with
 *  nothing in the box. A member who clicked "New scan" inside the screener is
 *  authoring a SCREEN, and the picker is the door onto that. Spelled once,
 *  exported, and checked against the sheet's OWN mode set (derived off its AST)
 *  rather than against a list retyped here — `ScreensManager.door.test.jsx`. */
export const NEW_SCAN_MODE = 'picker'

/** The bars the concierge computes a proposal against.
 *
 *  The chart hands `BuilderSheet` the window the member is looking at; the
 *  screener has no chart, so it hands the benchmark's daily bars instead.
 *  ⭐ THIS IS NOT DECORATION: `definition_concierge._validate` runs its compute
 *  stage only `if bars`, so a door that handed none could never fire "the
 *  assistant's formula produces no value on the bars in view" — a proposal that
 *  computes nothing would arrive unrefused. A window makes that gate live here.
 *
 *  ⛔ AND THE SIZE IS THE BUDGET'S OWN CEILING, NOT A NUMBER CHOSEN HERE.
 *  `DEFAULT_BUDGET.maxLookback` is the deepest warmup any tree the budget
 *  PERMITS can ask for, and a tree with lookback L produces its first value at
 *  bar L — so `maxLookback + 1` is the tightest window in which every permitted
 *  tree yields the one non-null value `_validate` looks for. Anything smaller
 *  makes this door refuse `compute:empty` on proposals the budget allows, which
 *  is a DOOR-DEPENDENT refusal: the same formula would be accepted from the
 *  chart. `ScreensManager.door.test.jsx` pins the two together, so the window
 *  moves when the ceiling does.
 *
 *  ⚰️ THIS SAID "400 is what the budget's own `_MIN_BARS` floor asks for" and
 *  every clause of that was wrong (review round 1). `_MIN_BARS = 400` is
 *  `scan_evaluator.py`'s — the SWEEP's base window, which the sweep then widens
 *  per tree (`want = min(_MAX_BARS, max(_MIN_BARS, lookback + _MIN_BARS))`). The
 *  budget's lookback ceiling is 960. So the number was a second authority
 *  wearing another module's name, and it was 560 bars short.
 *
 *  ⛔ NO, IT SHOULD NOT TRACK THE SWEEP'S WIDENING, and it cannot: the sweep
 *  widens per TREE, and this window is fetched when the sheet OPENS — before
 *  there is a tree to measure. A fixed window big enough for any permitted tree
 *  is the only shape available, and the budget's ceiling is that number. */
export const SPY_WINDOW_BARS = DEFAULT_BUDGET.maxLookback + 1
export const SPY_WINDOW = `/api/bars/SPY?tf=D&bars=${SPY_WINDOW_BARS}`

/** A refused bars read answers `null`, never `[]` — the fetcher's contract is
 *  "the window, or none", and `null` is what a 503 actually means.
 *
 *  ⚰️ AND THE REASON THIS ORIGINALLY GAVE WAS FICTION (review round 1). It
 *  claimed `[]` would reach the concierge as "computed and found nothing".
 *  Measured: `ConciergeBox.jsx` sends `bars: bars || []` and
 *  `definition_concierge._validate` gates on `if bars`, so `[]` and `None` are
 *  INDISTINGUISHABLE by the time they get there. The behaviour is still the one
 *  worth having — a failed read must not put a fabricated empty window in SWR's
 *  cache, where `data === null` (read finished, no window) and `data === []`
 *  (read finished, market has no bars) are different facts to anyone who later
 *  branches on it — but it protects THIS module's contract, not the server's
 *  gate, and saying otherwise put a false instruction in the file. */
const barsFetcher = (url) => fetch(url, { credentials: 'include' })
  .then((r) => (r.ok ? r.json() : null))
  .then((b) => (b && Array.isArray(b.bars) ? b.bars : null))

// ScreensManager — replaces SaveScreenBar (commit A of the E-4 unification
// cutover, docs/superpowers/plans/2026-08-22-screener-wave4-e4-unification.md
// supersession #5). Same trigger, same share-panel behavior (copied verbatim
// from SaveScreenBar.jsx, which this file now supersedes), PLUS a second
// section listing the member's SCANNABLE formula definitions with a
// "Use as filter" action that adds the formula's hash to the `scan` filter.
//
// ─── 🔴 THE PUBLISH DOOR (carried verbatim from SaveScreenBar) ─────────────
//
// `saved_screens.update` mints `share_token` ONLY when a screen's owner sets
// `is_public`. NOTHING HERE PUBLISHES ANYTHING BY ITSELF — `create(name, spec)`
// still leaves `is_public` at its default false; `screenSharing.mount.test.jsx`
// is the rail (its owner-file list now names this component).
//
// ⛔ ERROR ≠ EMPTY (K7). `useSavedScreens`' fetcher now throws on a non-ok
// response, and `useUserDefinitions` already did — a refused read renders
// `data-testid="screens-manager-error--screens"` (My screens) or `--scans`
// (My scans), role=alert, never "None saved yet" or an empty scans list. The
// two pictures look identical and send a member to different fixes.
//
// ─── DEFINITION DETAIL (Task 6) ─────────────────────────────────────────────
//
// Clicking a My-scans row's name expands `ScanResults` beneath it, seeded
// with the same session control `SavedScreensPanel` carried (`defaultSession`,
// a member-driven `<input type="date">` — the exchange's calendar day is a
// CONTROL, not a re-derivation of a server-owned fact; see `scanSession.js`
// and the panel's own header for why).
//
// ⛔ THIS FILE IMPORTS `ScanResults`, NEVER `CoverageLine` DIRECTLY.
// `CoverageLine` is reached only through `ScanResults` — `reachable.test.js`'s
// planted-cut control (re-pointed at this file in Task 7) asserts exactly
// that chain. Importing `CoverageLine` here would give the four-outcome
// receipt a second door into the app, which is the thing that rail exists to
// prevent.
//
// ─── RUN IT NOW, ON A LIST THE MEMBER NAMES (W4a) ───────────────────────────
//
// `RunNowButton` sits inside the open scan detail and hands its finished answer
// UP here; this feeds it to the ONE `ScanResults` mount above as `payload`. The
// button renders no result of its own for the same reason this file imports no
// `CoverageLine`: one answer, one mount, one door.
//
// ⛔ A RUN BELONGS TO THE (SCAN, SESSION) IT WAS RUN FOR, and that is why the
// held run carries both and is matched rather than merely stored. A payload kept
// across a session change would caption Friday's hits with Monday's date; kept
// across a row change it would show one scan's names under another's formula —
// the same coincidence `ScanResults` clears its open chart to prevent. Matching
// on the pair means no effect has to remember to clear it.
//
// ─── THE AUTHORING DOOR (W4a.5) ─────────────────────────────────────────────
//
// "New scan" mounts the ONE `BuilderSheet` (lazy) on the Conditions picker;
// "Edit" mounts the SAME sheet on the row. Saving goes through the sheet's own
// `saveUserDefinition` — this file imports NO save function and spells NO
// `/api/user-definitions` URL (`Screener.door.test.jsx`'s AST rail), because a
// second write door onto one object is how two callers end up disagreeing about
// what a definition is.
//
// ⛔ AND THIS FILE SAYS NOTHING ABOUT THE RUN IT IS SHOWING. `RunNowButton`
// already captions the set below it (`run-now-done` — "Showing on-demand
// results over N symbols from L"), and that caption is hoisted out of its own
// collapse gate precisely so it is always beside the answer. A chip here
// restating the tier would be a second voice for one fact. What was genuinely
// missing is the way BACK to the nightly answer, and that control belongs
// beside the caption it retracts — inside the button, which owns it.
//
// ─── 🔴 DELETE — THE FIRST IRREVERSIBLE THING ON THIS SURFACE (W4a.6) ────────
//
// Publish, run, open a row: every other action here is undone by repeating it.
// Delete is not, and its control sits one icon from the pencil that EDITS. So:
//
// ⛔ IT ASKS FIRST, AND THE QUESTION NAMES THE SCAN. Not "this item" — the rows
//    in this menu are one line of member-chosen text apart, and the member is
//    about to lose one of them permanently. Same arm-then-confirm two-step
//    `BuilderSheet` already uses on its own saved list: one idiom for one act.
//
// ⛔ THE ROW LEAVES WHEN THE STORE SAYS IT IS GONE — NEVER OPTIMISTICALLY. This
//    file holds no removal list. `deleteUserDefinition` revalidates the store
//    and the next answer is what the list renders, so a delete that failed
//    never takes a row off screen and puts it back. A row that vanishes and
//    returns is a lie told twice, and the second one is the one a member acts on.
//
// ⛔ A REFUSAL IS THE STORE'S OWN SENTENCE, RENDERED ONCE, WITH NOTHING OF OURS
//    OVER IT. `deleteUserDefinition` now carries the words back (its hand-back
//    note says why); this file interpolates them and adds no frame. The same
//    rule the run caption above is written under, applied to a harder case:
//    "That scan could not be deleted" reads like help and is a second
//    vocabulary for a decision the router already worded.
//
// ⛔ AND A DELETED SCAN'S ANSWERS GO WITH IT. The open detail pane and any
//    on-demand run held for that def_id are retracted the moment the delete
//    SUCCEEDS — not when it is merely asked for. The store's re-read is
//    asynchronous, so between the 200 and the new list the row is still on
//    screen; leaving `ScanResults` and the run caption mounted through that
//    window shows a member results for something that no longer exists.

const badgeStyle = {
  fontSize: 9, letterSpacing: '.5px', color: 'var(--text-muted)',
  border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px',
  marginLeft: 6, textTransform: 'uppercase', fontWeight: 600, verticalAlign: 'middle',
}

/** The "My scans" header carries a control on its right. `.saveMenuHdr` is a
 *  label, not a row, so the layout is stated here rather than by borrowing
 *  `.saveMenuItem` — which also paints a hover background this is not. */
const hdrRowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
}

/** The delete prompt sits BELOW its row, not inside `.saveMenuAct` — that strip
 *  is a fixed run of icon buttons and this question has to fit a scan's NAME,
 *  which is as long as a member made it. The share panel is placed the same way
 *  for the same reason.
 *
 *  ⚠️ INLINE RATHER THAN A NEW CSS-MODULE CLASS, deliberately: under vitest the
 *  CSS-module proxy fabricates a class for ANY key, so `styles.deleteAsk` is
 *  truthy whether or not the stylesheet declares it — an undeclared selector
 *  here is a hole no test in this file could ever fail on. `ScannerPro.module.css`
 *  has no stylesheet rail, so the safe move is not to add a key to it. */
const deleteAskStyle = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  padding: '4px 8px 6px', fontSize: 11, color: 'var(--text-muted)',
}
const deleteErrStyle = {
  margin: 0, padding: '0 8px 6px', fontSize: 11,
  color: 'var(--color-danger, #f87171)',
}

function TypeBadge({ children }) {
  return <span style={badgeStyle}>{children}</span>
}

/** The name a member gave a scan, or its handle, so a row is never blank.
 *  Mirrors `SavedScreensPanel`'s unexported `screenName` — small enough that
 *  duplicating the fallback chain here beats exporting a third name for it. */
function scanName(row) {
  const meta = row && row.definition && row.definition.meta
  const name = meta && typeof meta.name === 'string' ? meta.name.trim() : ''
  return name || (row && row.def_id) || 'Untitled screen'
}

export default function ScreensManager({ currentSpec, onApply, onUseScan }) {
  const { saved, starters, create, update, remove, error: savedError } = useSavedScreens()
  const { rows: defRows, error: defsError, refresh: refreshDefs } = useUserDefinitions()
  const scans = useMemo(() => scannableScreens(defRows), [defRows])
  // ⭐⭐ THE ONES THAT CANNOT SCAN, AND WHY — the server already knows and nobody
  // was showing it. `GET /api/user-definitions` stamps `scannable` +
  // `scan_refusal` on every row (`routers/user_definitions.py::_stamped`), and
  // until now the ONLY consumer was the filter above: a member pasted an
  // indicator, saved it with no warning, and it simply never appeared here.
  // ⛔ A SILENT DROP IS THE WORST OF THE THREE POSSIBLE ANSWERS. "It scans" is
  // fine; "it cannot scan, because it answers a NUMBER and a screen needs a
  // yes/no" is actionable. Vanishing is neither — the member concludes the save
  // failed, or that we lost it. MEASURED 2026-08-29: of 71 pasted-and-translated
  // columns, 41 refuse `gate:yields` and every one of them disappeared here.
  const unscannable = useMemo(
    () => (Array.isArray(defRows) ? defRows : []).filter((r) => r && r.scannable === false),
    [defRows],
  )

  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameId, setRenameId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [shareId, setShareId] = useState(null)
  const [copied, setCopied] = useState(false)
  // Definition detail (Task 6): which My-scans row is expanded, and the one
  // session control shared by whichever row is open — mirrors
  // `SavedScreensPanel`'s single selected-screen + single session state.
  const [detailId, setDetailId] = useState(null)
  const [session, setSession] = useState(defaultSession)
  // The on-demand run currently on screen: `{defId, session, payload}`. Matched,
  // never assumed — see the header note.
  const [run, setRun] = useState(null)
  // The authoring door: null (closed) | {row: null} (a new scan, on the
  // Conditions picker) | {row} (edit that row).
  //
  // ⛔ ONE OBJECT, HELD IN STATE, SO `editRow`'s IDENTITY IS STABLE. The sheet
  // re-runs `openForEdit` whenever that prop changes; a row rebuilt inline on
  // each render would re-open it every time and throw away what the member has
  // typed since.
  const [builder, setBuilder] = useState(null)
  // ─── DELETE: armed → in flight → answered BY THE STORE ────────────────────
  // `pendingDelete` is the ONE row whose confirm is showing (so a stray tap can
  // never arm two), `deleting` is the one whose request is out, and
  // `deleteError` is `{defId, message}` — keyed by row so the store's sentence
  // renders beside the scan it is about and nowhere else.
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  // ─── DELETE (My screens), THE SAME IDIOM — X26 / W9c.1 ─────────────────────
  // ⛔ THIS LIST USED TO DELETE ON ONE CLICK: `onClick={() => remove(s.id)}`,
  // no confirmation, no name, no error surface. It now goes through the
  // identical arm → confirm → store-answers three lines above, applied to the
  // OTHER list — but with its OWN state, never the scans state above. The two
  // lists' ids live in disjoint namespaces (a numeric saved-screen id can
  // never equal a string def_id), but a shared variable would still be one
  // state machine doing two jobs, and the review-round-1 cross-row disarm
  // found in the scans lane (see confirmDelete below) is exactly the bug
  // class a shared variable invites — keeping them apart makes that class
  // structurally impossible for the two LISTS, not merely unlikely.
  const [pendingDeleteScreen, setPendingDeleteScreen] = useState(null)
  const [deletingScreen, setDeletingScreen] = useState(null)
  const [deleteScreenError, setDeleteScreenError] = useState(null)
  // Fetched only while the sheet is open — a member reading their screens never
  // asks for a window they are not going to compute anything against.
  const { data: spyBars } = useSWR(builder ? SPY_WINDOW : null, barsFetcher,
    { revalidateOnFocus: false })
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const apply = s => { onApply(s.spec); setOpen(false) }
  const saveCurrent = async () => {
    const name = newName.trim()
    if (!name) return
    await create(name, currentSpec)
    setNewName('')
  }
  const commitRename = async id => {
    const name = renameVal.trim()
    if (name) await update(id, { name })
    setRenameId(null); setRenameVal('')
  }

  // ⭐ REVERSIBLE, AND THE SERVER MAKES IT SO — see SaveScreenBar's original
  // note: unpublishing stops every copy of the link resolving immediately, and
  // the token is kept on the row so re-publishing restores the SAME link.
  const setPublic = async (id, isPublic) => {
    setCopied(false)
    await update(id, { is_public: isPublic })
  }

  const armDelete = defId => { setPendingDelete(defId); setDeleteError(null) }
  const keepScan = () => { setPendingDelete(null); setDeleteError(null) }

  /** ⛔ THE ONLY DESTRUCTIVE CALL IN THIS FILE, and it goes through the store's
   *  own door — the same module `BuilderSheet` deletes through. A hand-rolled
   *  `fetch` here would be a second write door onto one object, which is what
   *  `Screener.door.test.jsx`'s AST rail forbids for the save side.
   *
   *  ⛔ NOTHING IS REMOVED LOCALLY. The row leaves because the store's next
   *  answer no longer carries it. What IS retracted, and only on success, are
   *  this file's own claims ABOUT that scan: the open detail and any on-demand
   *  run held for it. Both name a def_id the store has just destroyed. */
  const confirmDelete = async defId => {
    setDeleting(defId)
    setDeleteError(null)
    const res = await deleteUserDefinition(defId)
    setDeleting(null)
    if (!res.ok) {
      // ⛔ VERBATIM. The store worded this refusal; a sentence composed here
      // would be a second vocabulary for one decision, and the member would be
      // reading ours instead of the one the router can actually change.
      setDeleteError({ defId, message: res.error })
      return
    }
    // ⛔ DEF-SCOPED, LIKE ITS TWO NEIGHBOURS. ⚰️ This was a bare
    // `setPendingDelete(null)` while the lines under it were already keyed on
    // `defId` — so arming B while A's request was still out, then having A
    // succeed, DISARMED B (review round 1, fold-in). It failed safe (a stray
    // disarm never deletes anything) but it contradicted the two lines below it,
    // and a rule that holds on two of three lines is not a rule.
    setPendingDelete(id => (id === defId ? null : id))
    setDetailId(id => (id === defId ? null : id))
    setRun(r => (r && r.defId === defId ? null : r))
  }

  const armDeleteScreen = id => { setPendingDeleteScreen(id); setDeleteScreenError(null) }
  const keepScreen = () => { setPendingDeleteScreen(null); setDeleteScreenError(null) }

  /** ⛔ THE SAME CONTRACT AS confirmDelete ABOVE, applied to My screens:
   *  goes through `useSavedScreens`'s own `remove` (the only write door onto
   *  a saved screen), never removes the row locally — it leaves because the
   *  store's next read no longer carries it — and a refusal renders VERBATIM,
   *  never paraphrased.
   *
   *  ⛔ DEF-SCOPED ON SUCCESS, not a bare `setPendingDeleteScreen(null)` — the
   *  exact review-round-1 fix confirmDelete above carries, repeated here on
   *  purpose rather than trusted to have been "already covered" by the other
   *  list: arming a SECOND screen's confirm while a FIRST screen's delete is
   *  still in flight, then letting the first land, must not wipe the second's
   *  prompt. A confirm left live invites a second DELETE, and this store's own
   *  `delete()` reports an already-gone row as 404 `not found` — so the member
   *  would see a refusal for a delete that already worked. */
  const confirmDeleteScreen = async id => {
    setDeletingScreen(id)
    setDeleteScreenError(null)
    const res = await remove(id)
    setDeletingScreen(null)
    if (!res.ok) {
      setDeleteScreenError({ id, message: res.error })
      return
    }
    setPendingDeleteScreen(pid => (pid === id ? null : pid))
    // The share panel is a claim ABOUT this screen too — close it on the same
    // success signal the scans lane retracts its detail pane and run on.
    setShareId(sid => (sid === id ? null : sid))
  }

  const copyLink = async url => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Clipboard is permission-gated and absent over plain http. The input
      // below is selectable, so the link is still gettable by hand — a failed
      // copy must not read as a failed share.
      setCopied(false)
    }
  }

  return (
    <div className={styles.saveMenuWrap} ref={wrapRef}>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(o => !o)}>
        Screens ▾
      </button>
      {open && (
        <div className={styles.saveMenuPop} role="menu">
          {starters.length > 0 && (
            <div className={styles.saveMenuSection}>
              <div className={styles.saveMenuHdr}>Starters</div>
              {starters.map(s => (
                <div key={s.id} className={styles.saveMenuItem}>
                  <button type="button" className={styles.saveMenuName} onClick={() => apply(s)}>{s.name}</button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.saveMenuSection}>
            <div className={styles.saveMenuHdr}>My screens<TypeBadge>SCREEN</TypeBadge></div>
            {savedError ? (
              <p role="alert" data-testid="screens-manager-error--screens" className={styles.saveMenuEmpty}>
                Your saved screens could not be read ({String(savedError.message || savedError)}).
              </p>
            ) : saved.length === 0 ? (
              <div className={styles.saveMenuEmpty}>None saved yet</div>
            ) : saved.map(s => (
              <div key={s.id}>
                <div className={styles.saveMenuItem}>
                  {renameId === s.id ? (
                    <input className={styles.saveMenuInput} autoFocus value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && commitRename(s.id)}
                      onBlur={() => commitRename(s.id)} />
                  ) : (
                    <button type="button" className={styles.saveMenuName} onClick={() => apply(s)}>{s.name}</button>
                  )}
                  <span className={styles.saveMenuAct}>
                    {/* 🔴 THE DOOR. Opens the panel below; the panel is where
                        the member actually publishes. */}
                    <button type="button" aria-label={`Share ${s.name}`}
                      aria-expanded={shareId === s.id}
                      onClick={() => { setShareId(id => (id === s.id ? null : s.id)); setCopied(false) }}>
                      <UIcon name={s.is_public ? 'globe' : 'link'} size={12} />
                    </button>
                    <button type="button" aria-label={`Rename ${s.name}`}
                      onClick={() => { setRenameId(s.id); setRenameVal(s.name) }}>✎</button>
                    {/* 🔴 IT ARMS A CONFIRM; IT DOES NOT DELETE — X26 / W9c.1,
                        the same idiom as the My-scans row below. Swapped out
                        once armed so one tap can never mean two things. */}
                    {pendingDeleteScreen !== s.id && (
                      <button type="button" aria-label={`Delete ${s.name}`}
                        onClick={() => armDeleteScreen(s.id)}>✕</button>
                    )}
                  </span>
                </div>

                {pendingDeleteScreen === s.id && (
                  <div style={deleteAskStyle} data-testid={`delete-ask-screen-${s.id}`}>
                    {/* ⛔ NAMED. A member must be able to tell WHAT they are
                        about to lose without reading the row above it. */}
                    <span>{deletingScreen === s.id
                      ? `Deleting “${s.name}”…`
                      : `Delete “${s.name}”?`}</span>
                    <button type="button" aria-label={`Keep ${s.name}`}
                      disabled={deletingScreen === s.id}
                      onClick={keepScreen}>Keep</button>
                    <button type="button" aria-label={`Confirm delete ${s.name}`}
                      disabled={deletingScreen === s.id}
                      onClick={() => confirmDeleteScreen(s.id)}>Confirm delete</button>
                  </div>
                )}

                {deleteScreenError && deleteScreenError.id === s.id && (
                  <p role="alert" data-testid="screens-manager-error--delete-screen"
                    style={deleteErrStyle}>
                    {deleteScreenError.message}
                  </p>
                )}

                {shareId === s.id && (
                  <div className={styles.sharePanel} data-testid={`share-panel-${s.id}`}>
                    {s.is_public && s.share_token ? (
                      <>
                        <div className={styles.shareState}>
                          <UIcon name="globe" size={11} /> Anyone with this link can open it
                        </div>
                        <div className={styles.shareLinkRow}>
                          <input className={styles.saveMenuInput} readOnly
                            aria-label={`Share link for ${s.name}`}
                            value={sharedScreenUrl(s.share_token)}
                            onFocus={e => e.target.select()} />
                          <button type="button" className="btn btn-primary"
                            onClick={() => copyLink(sharedScreenUrl(s.share_token))}>
                            <UIcon name={copied ? 'check' : 'copy'} size={12} />{' '}
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        {/* ⭐ WHAT THE RECIPIENT SEES, STATED WHERE THE MEMBER
                            DECIDES. */}
                        <p className={styles.shareNote}>
                          They see this screen&rsquo;s <strong>filters</strong> only — no results,
                          no watchlist, no positions. Running it needs their own plan.
                        </p>
                        <button type="button" className={styles.shareUnpublish}
                          onClick={() => setPublic(s.id, false)}>
                          <UIcon name="lock" size={11} /> Unpublish — the link stops working
                        </button>
                      </>
                    ) : (
                      <>
                        <div className={styles.shareState}>
                          <UIcon name="lock" size={11} /> Private — only you can see this screen
                        </div>
                        <p className={styles.shareNote}>
                          Publishing creates a secret link. Whoever opens it sees this
                          screen&rsquo;s <strong>filters</strong> only — no results, no watchlist,
                          no positions — and running it needs their own plan. You can
                          unpublish at any time.
                        </p>
                        <button type="button" className="btn btn-primary"
                          onClick={() => setPublic(s.id, true)}>
                          <UIcon name="link" size={12} /> Publish a share link
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className={styles.saveMenuSection}>
            <div className={styles.saveMenuHdr} style={hdrRowStyle}>
              <span>My scans<TypeBadge>SCAN</TypeBadge></span>
              {/* 🔴 THE AUTHORING DOOR. Closes the menu first: the sheet is a
                  `Sheet` portalled to document.body, i.e. OUTSIDE `wrapRef`,
                  so the menu's own outside-click handler would fire on the
                  first click inside the sheet and shut the menu underneath it
                  anyway — this just does it deliberately, before the sheet is
                  on screen. */}
              <span className={styles.saveMenuAct}>
                <button type="button" aria-label="New scan"
                  onClick={() => { setOpen(false); setBuilder({ row: null }) }}>
                  <UIcon name="plus" size={11} /> New scan
                </button>
              </span>
            </div>
            {defsError ? (
              <p role="alert" data-testid="screens-manager-error--scans" className={styles.saveMenuEmpty}>
                Your saved scans could not be read ({String(defsError.message || defsError)}).
              </p>
            ) : (scans.length === 0 && unscannable.length === 0) ? (
              <div className={styles.saveMenuEmpty}>No scannable formulas yet</div>
            ) : scans.map(row => {
              const name = scanName(row)
              const isOpen = detailId === row.def_id
              return (
                <div key={row.def_id}>
                  <div className={styles.saveMenuItem}>
                    {/* 🔴 THE DOOR. Toggles the detail below — the name is the
                        click target, mirroring the panel's tab-button rows. */}
                    <button type="button" className={styles.saveMenuName}
                      aria-expanded={isOpen}
                      onClick={() => setDetailId(id => (id === row.def_id ? null : row.def_id))}>
                      {name}
                    </button>
                    <span className={styles.saveMenuAct}>
                      <button type="button" aria-label={`Use ${name} as filter`}
                        onClick={() => onUseScan(row.ast_hash, name)}>
                        Use as filter
                      </button>
                      {/* ⛔ THE SAME SHEET, NOT A SECOND ONE, and it opens on
                          the ROW rather than on `NEW_SCAN_MODE` — an edit lands
                          on the Formula because `openForEdit` says so, and a
                          mode forced from here would override the sheet's own
                          rule about its own doors. */}
                      <button type="button" aria-label={`Edit ${name}`}
                        onClick={() => { setOpen(false); setBuilder({ row }) }}>
                        <UIcon name="edit" size={12} />
                      </button>
                      {/* 🔴 IT ARMS A CONFIRM; IT DOES NOT DELETE. Swapped out
                          once armed so one tap can never mean two things, and
                          so a test cannot satisfy itself by clicking the same
                          control twice. */}
                      {pendingDelete !== row.def_id && (
                        <button type="button" aria-label={`Delete ${name}`}
                          onClick={() => armDelete(row.def_id)}>
                          <UIcon name="trash" size={12} />
                        </button>
                      )}
                    </span>
                  </div>

                  {pendingDelete === row.def_id && (
                    <div style={deleteAskStyle} data-testid={`delete-ask-${row.def_id}`}>
                      {/* ⛔ NAMED. A member must be able to tell WHAT they are
                          about to lose without reading the row above it. */}
                      <span>{deleting === row.def_id
                        ? `Deleting \u201C${name}\u201D\u2026`
                        : `Delete \u201C${name}\u201D?`}</span>
                      {/* Both accessible names CONTAIN their visible text
                          (WCAG 2.5.3): a member using voice control says what
                          they can read and the right button is pressed. */}
                      <button type="button" aria-label={`Keep ${name}`}
                        disabled={deleting === row.def_id}
                        onClick={keepScan}>Keep</button>
                      <button type="button" aria-label={`Confirm delete ${name}`}
                        disabled={deleting === row.def_id}
                        onClick={() => confirmDelete(row.def_id)}>Confirm delete</button>
                    </div>
                  )}

                  {deleteError && deleteError.defId === row.def_id && (
                    <p role="alert" data-testid="screens-manager-error--delete"
                      style={deleteErrStyle}>
                      {deleteError.message}
                    </p>
                  )}

                  {isOpen && (
                    <div data-testid={`scan-detail-${row.def_id}`}>
                      <label className={panelStyles.session}>
                        <span className={panelStyles.sessionLabel}>Session</span>
                        <input
                          type="date"
                          className={panelStyles.sessionInput}
                          value={session}
                          onChange={(e) => setSession(e.target.value)}
                        />
                      </label>
                      <RunNowButton
                        defId={row.def_id}
                        name={name}
                        session={session}
                        onResult={(payload) => setRun({ defId: row.def_id, session, payload })}
                        /* ⭐ THE WAY BACK. Without it an on-demand run is a
                           one-way door: the nightly receipt is only
                           recoverable by changing the session or closing the
                           row, both of which throw away something else. It is
                           passed from HERE because this is where the run is
                           held, and rendered THERE because the caption it
                           retracts lives there — one control, beside the
                           sentence it makes false. */
                        onClear={() => setRun(null)}
                      />
                      <ScanResults
                        definition={row.definition}
                        asOf={session}
                        tf={SCAN_TF}
                        payload={run && run.defId === row.def_id && run.session === session
                          ? run.payload : null}
                      />
                    </div>
                  )}
                </div>
              )
            })}

            {/* ⭐⭐ THE SENTENCE THE SERVER ALREADY WROTE. A saved formula that
                cannot be a screen used to VANISH from this list — a member
                pasted an indicator, saved it with no warning, and it was simply
                not here. `GET /api/user-definitions` stamps `scan_refusal` on
                every row (`routers/user_definitions.py::_stamped`) and no
                component rendered it; this is that field reaching a person.
                ⛔ A SILENT DROP IS THE WORST OF THE THREE POSSIBLE ANSWERS.
                "It scans" is fine. "It cannot, because it answers a NUMBER and a
                screen needs a yes/no" is actionable. Vanishing is neither — the
                member concludes the save failed or that we lost it. MEASURED
                2026-08-29: of 71 pasted-and-translated columns, 41 refuse
                `gate:yields`, and every one of them disappeared here.
                ⛔ THE REFUSAL IS SHOWN VERBATIM — it names the gate and what the
                tree answers, and rewording it would put a second authority over a
                decision `assert_scannable` already made. */}
            {unscannable.length > 0 && (
              <div className={styles.saveMenuEmpty} data-testid="screens-unscannable">
                <div className={styles.unscannableHead}>
                  {unscannable.length === 1
                    ? '1 saved formula cannot be a screen yet'
                    : `${unscannable.length} saved formulas cannot be a screen yet`}
                </div>
                {unscannable.map((row) => (
                  <div
                    key={row.def_id}
                    className={styles.unscannableRow}
                    data-unscannable={row.def_id}
                  >
                    <span className={styles.unscannableName}>{scanName(row)}</span>
                    {/* ⛔ `scan_refusal` IS `{gate, detail}`, NOT A STRING. The
                        `detail` is the sentence; the `gate` names which check
                        decided, which is what makes a report actionable rather
                        than a complaint. Rendering the object itself throws. */}
                    <span className={styles.unscannableWhy}>
                      {(row.scan_refusal && row.scan_refusal.detail)
                        || 'the server did not say why — please report this'}
                    </span>
                  </div>
                ))}
                {/* ⭐ AND WHAT TO DO ABOUT IT, once, rather than on every row. */}
                <div className={styles.unscannableHow}>
                  A screen needs a yes/no answer. Open one, add a plot that compares
                  it — e.g. <code>rsi(close, 14) &lt; 30</code> — and mark that plot
                  &ldquo;Scan&rdquo;.
                </div>
              </div>
            )}
          </div>

          <div className={styles.saveMenuFoot}>
            <input className={styles.saveMenuInput} placeholder="Name this screen…"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCurrent()} />
            <button type="button" className="btn btn-primary" onClick={saveCurrent}>Save current</button>
          </div>
        </div>
      )}

      {/* ⛔ MOUNTED OUTSIDE `{open && …}`. The menu closes when the door is
          used, and a sheet nested inside that block would unmount with it —
          the member would click "New scan" and get nothing. */}
      {builder && (
        <Suspense fallback={null}>
          <BuilderSheet
            open
            onClose={() => setBuilder(null)}
            initialMode={builder.row ? null : NEW_SCAN_MODE}
            editRow={builder.row}
            bars={spyBars || null}
            onSaved={(savedRow) => {
              // ⛔ THIS DECIDES WHAT IS ON SCREEN NEXT, AND NOTHING ELSE. The
              // sheet already wrote the definition through its own
              // `saveUserDefinition`; `refreshDefs` re-reads the store that
              // owns what exists. A save performed here would be a second
              // write door onto one object.
              setBuilder(null)
              refreshDefs()
              if (savedRow && savedRow.def_id) { setDetailId(savedRow.def_id); setOpen(true) }
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
