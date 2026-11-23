// app/src/components/chart/builder/memberPane/MemberPane.jsx
//
// ─── ⭐⭐ T5 — A MEMBER'S OWN PINE, ON A PANE, BEHIND A FLAG ────────────────
//
// The surface `memberPaneGate.js` was written for. It composes the pieces that
// already exist — `memberPaneDefinition` builds the document, the SHIPPED
// install door validates it, `addInstance` puts it in `indicatorInstances`, and
// `ChartPane` draws it — and adds nothing of its own except the flag and the
// disclosures.
//
// ⛔⛔ FLAG-OFF IS A `null` RETURN BEFORE ANY WORK, AND THAT IS THE WHOLE POINT
// OF PUTTING THE CHECK FIRST. `memberPaneEnabled()` is read INSIDE the component
// (never at module scope, so a test can flip it), and when it is off this
// installs nothing, registers nothing, and renders nothing — a member on the
// default build cannot reach an unfinished pane through any path, including a
// registry listing that outlived a render.
//
// ⛔ AND THE TEARDOWN IS NOT OPTIONAL. `PreviewPane`'s header records what a
// leaked definition costs: it rides `listUserDefinitions()` onto the member's
// REAL chart, which is the same list the settings row, the legend and the alert
// address read. The uninstall runs on unmount and whenever the flag or the
// source changes.
//
// ⭐⭐ T5b — AND THE DOOR OUT OF THE HARNESS. Everything above is a PREVIEW: the
// script lives in React state, the definition installs under a throwaway id, and
// closing the sheet uninstalls all of it. `onAttach` is what makes the preview a
// thing a member keeps — it hands the built document to the caller, which saves
// it to `/api/user-definitions` and adds an instance through `addInstance`, the
// same two doors the Formula tab's Save button has always used.
//
// ⛔ THE BUTTON IS INSIDE THE FLAG, NOT BESIDE IT. `memberPaneEnabled()` already
// returns `null` above for a default build, so on the flag-off path the attach
// control does not exist, cannot be clicked, and no instance can be written. That
// is what makes "flag-off is non-vacuous" a statement about the MEMBER ROUTE
// rather than about a component nobody reaches: no pane, no instance, nothing in
// the DOM, and each of the three is measured separately.
//
// ⚠️ WHAT THIS FILE CANNOT PROVE, STATED HERE RATHER THAN IN A REPORT NOBODY
// OPENS: its tests mock `ChartPane`, so every case is about WHAT the pane is
// HANDED, never about pixels. Whether four series actually paint, whether Scale
// Padding is invisible and scale-setting, and whether the sub-pane is a quarter
// high are SCREENSHOT questions and are owed against the real chart.
import { withoutGuardIds } from '../../engine/ast/guardIdText'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChartPane from '../../pane/ChartPane'
import * as engineRegistry from '../../engine/nativeRegistry'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { memberPaneEnabled } from '../../engine/memberPaneGate'
import { runtimePaneEnabled } from '../../engine/runtimePaneGate'
import {
  latchRuntimeLists, runtimeCapabilityAdmissionOn,
  runtimeAdmissionOf, watchRuntimeAdmission, RUNTIME_KILL_PATH,
  subscribeRuntimeLists, runtimeConsultPendingOf, awaitRuntimeAdmission,
} from '../../engine/runtimeKill'
import { requirementNote } from '../../engine/ast/parse'
import { MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'
import { useMemberDoor, useElapsedSince } from './useMemberDoor'
import { doorFailedAnswer } from './memberDoorAsync'
import { keptForAdd, addSendsFor, addReady } from './addAuthority'
import { CheckingLine } from '../PineEditorStatus'
import { usePineLibraries } from '../usePineLibraries'
import { logRefusalCodes } from '../../supportLoop/supportApi'
import styles from './MemberPane.module.css'
// ⭐ P0 gate (pineack) — the repaint acknowledgement reuses the Formula tab's own
// `.ack` row, so the two doors' checkboxes look and behave alike.
import sheetStyles from '../BuilderSheet.module.css'

const noop = () => {}

// ⭐⭐ WHAT ADD MAY SEND, AND WHETHER IT MAY SEND IT NOW: ONE authority (`addAuthority.js`), read by the render and by
// both handlers below, never a copy (ITEM 2's keep-or-refuse and the paste worker's wait were each written twice).

/** ⭐ The member's real chart already streams and warms this symbol; a second
 *  surface doing both would double the work for one pane. Same recipe
 *  `PreviewPane` uses, and for the same reason. */
const MEMBER_CHART_PROPS = Object.freeze({ liveUpdates: false, backgroundWarm: false })

/** WS-I Part 2 — how long a source must sit still before its capability verdict is asked. */
const ADMISSION_ASK_DEBOUNCE_MS = 250
/** ⭐ U4 — how long a refused source must stay still before its codes are logged. */
const REFUSAL_LOG_SETTLE_MS = 1500

/**
 * @param {object} props
 * @param {string|null} props.sym    the symbol to draw on
 * @param {string|null} props.tf     the timeframe
 * @param {string|null} props.source the member's Pine
 * @param {string} [props.defId]     the id to install under
 * @param {object|null} props.settings the member's own chart settings
 * @param {((definition: object) => Promise<{ok: boolean, error?: string}>)|null}
 *        [props.onAttach] omit for a preview-only pane; supply it and the pane
 *        offers to SAVE the document and put it on the member's real chart.
 * @param {((definition: object|null) => void)|null} [props.onDocument] told the document
 *        this pane installed (the one "Add this script to my chart" adds), or null when
 *        there is none, so a host can describe IT rather than its own state.
 */
export default function MemberPane({
  sym = null, tf = null, source = null, defId = MEMBER_PANE_DEF_PREFIX, settings = null,
  onAttach = null,
  // ⭐ UIE PHASE 5 (M1) — a stored script opened for edit: its host names the save
  // ("Save changes", a revision) and may offer a second one (`onAttachCopy`, a new
  // indicator). Both run the SAME attach below — acknowledgement, errors, notes.
  attachLabel = 'Add this script to my chart',
  doneLabel = 'Saved, and added to this chart.',
  onAttachCopy = null,
  copyLabel = null,
  onDocument = null,
}) {
  // ⛔ FIRST, AND BEFORE ANY BUILD. Reading the flag after `memberPaneDefinition`
  // would translate a member's script on a build that may not show it — work
  // nobody asked for, on the render path.
  const enabled = memberPaneEnabled()
  const live = !!(enabled && sym && tf && source)

  // ⭐⭐ THE BAR COUNT IS A DISCLOSURE, NOT DIAGNOSTICS.
  // `_requirement_tags.window_dependent.why_the_pane_may` is the reason the pane
  // is the ONE consumer allowed to serve `ta.cum`: "a pane is one symbol, one
  // fetch, and the member can see where the data starts… the pane additionally
  // shows a disclosure badge naming the bar count when the value is DISPLAYED."
  // Without this number that permission rests on a badge nobody rendered.
  // ⛔ `onDrawnBarCount`, NOT `onBarsReady`. Ready says the bars question
  // SETTLED — it fires on a fatal error too — and a badge reading "0 bars here"
  // on a dead ticker would be a disclosure about nothing. This is the count that
  // was actually handed to the chart, which is the quantity the sentence names.
  const [drawnBars, setDrawnBars] = useState(null)
  const onDrawnBarCount = useCallback((n) => {
    setDrawnBars((prev) => (Number.isFinite(n) && n !== prev ? n : prev))
  }, [])

  // ⭐⭐ RT1 — THE RUNTIME LANE'S PER-SCRIPT KILL LIST, fetched once per mount and
  // only while the runtime pane is switched on (`engine/runtimeKill.js`). The
  // build below re-runs when it lands, so a script the server lists falls back
  // to the host lane's answer on this preview too. A failed read leaves the list
  // as it was: the store's own door refuses a listed script's SAVE regardless.
  const runtimeOn = live && runtimePaneEnabled()
  const [killVersion, setKillVersion] = useState(0)
  // ⭐ WS-I Part 2 — whether the server admits by capability (the kill read's
  // `capability_admission`, absent while it is off): only then is a verdict asked.
  const [admissionOn, setAdmissionOn] = useState(false)
  useEffect(() => {
    if (!runtimeOn) return undefined
    let alive = true
    fetch(RUNTIME_KILL_PATH, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return
        // ⭐ GT (D6) — the starter allowlist rides the same read. Until it lands
        // the lane declines every script (nothing graded), never the reverse.
        // ⭐ RS RATING L8 — so does the run half's object evidence: ONE latch for every
        // key of this read (`runtimeKill.js::latchRuntimeLists`, also the recheck's).
        latchRuntimeLists(d)
        setAdmissionOn(runtimeCapabilityAdmissionOn())
        setKillVersion((n) => n + 1)
      })
      .catch(() => { /* the list stays as it was; the save door still checks */ })
    return () => { alive = false }
  }, [runtimeOn])

  // ⭐⭐ WS-I Part 2 — THE PER-SCRIPT CAPABILITY VERDICT, beside the kill read. While
  // capability admission is on, this script's verdict is asked once its source has
  // been still for `ADMISSION_ASK_DEBOUNCE_MS` (not per keystroke), and the build
  // re-runs when it lands (`killVersion`). Until then the lane declines it: fail
  // closed, with the "still being checked" sentence (`engine/runtimeKill.js`).
  // ⭐ re-review F2 — and it KEEPS asking while the answer is "still being checked" (the server's
  // detector was busy), on the lists' recheck interval, so the preview recovers by itself.
  useEffect(() => {
    if (!runtimeOn || !admissionOn || !source) return undefined
    if (runtimeAdmissionOf({ source })) return undefined
    return watchRuntimeAdmission(source, () => setKillVersion((n) => n + 1),
      { delayMs: ADMISSION_ASK_DEBOUNCE_MS })
  }, [runtimeOn, admissionOn, source])

  // ⭐⭐ THE PASTE WORKER (2026-11-20) — THE BUILD RUNS OFF THE MAIN THREAD, ONCE PER SCRIPT. `memberPaneDefinition`
  // on a script the door serves takes milliseconds to minutes, and run here (a `useMemo`) every one of them was a
  // frozen tab. It is the page's shared build now (`useMemberDoor` -> `memberDoorAsync.js`): the same function in
  // a Web Worker, over this page's state, under the door's own deadline and a watchdog; the editor's status panel
  // reads the SAME build of the same text, so a paste costs one door call, not two. While a build runs, the pane
  // keeps the last one it drew and says the script is being checked; its Add waits for the build on screen.
  // ⭐ L1 — an `import`ed library arrives from the server's store; the build
  // re-runs once it is in the registry (`revision`), and when the kill list lands (`killVersion`).
  const libRevision = usePineLibraries(live ? source : '')
  const door = useMemberDoor(live ? { source, id: defId } : null, `${libRevision}:${killVersion}`)
  const building = door.pending
  // ⭐ e96: while it builds, for how long ("Checking your script... 0:42"): a slow script never looks like nothing happens
  const buildingFor = useElapsedSince(building ? door.since : null)
  // the build on screen: of THIS pane's id (a stale build of another id never draws under this one)
  const doorArgs = live && door.args && door.args.id === defId ? door.args : null
  const doorSource = doorArgs ? doorArgs.source : null
  const landed = doorArgs ? door.landed : null
  const built = useMemo(() => {
    if (!landed) return null
    // ⛔ a door that threw is a refusal BY NAME here (a crash of the pane, before)
    return landed.error ? doorFailedAnswer(landed.error.message) : landed.built
  }, [landed])
  // ⭐⭐ (2026-11-18, THE FIRST-PASTE RACE) — A BUILD MINTED BEFORE ITS ADMISSION ANSWERED. The build above reads the
  // runtime admission SYNCHRONOUSLY (`runtimeNotGradedOf`): a script the server has not answered for yet fails closed
  // to the host lane ("still being checked"). ⚰️ the 2026-11-18 production check's fresh session: the first paste of
  // supertrend-strategy minted the host copy (5 settings, its backtest declined) while every later paste got the
  // run-lane copy (12 settings), because nothing re-minted this build when the answer landed by another path, and
  // the watcher above waited a full recheck after the server's busy answers.
  // Read right after the build (in the build's own state, where it ran): whether a consult it made answered "still
  // being checked" (`landed.consultPending`).
  const mintedPending = !!(runtimeOn && landed && landed.consultPending)
  // the answer, by WHATEVER path it lands (this pane's watcher, the build's own ask, another consult, the lists'
  // re-read): the build is re-minted on it
  useEffect(() => {
    if (!mintedPending || doorSource === null) return undefined
    const settle = () => { if (!runtimeConsultPendingOf({ source: doorSource })) setKillVersion((n) => n + 1) }
    const unsub = subscribeRuntimeLists(settle)
    settle()   // an answer that landed between the build and this effect
    return unsub
  }, [mintedPending, doorSource])
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])
  const [installed, setInstalled] = useState(null)

  // ⭐ U4 — A REFUSAL THE MEMBER HITS IS A RANKED WORK ITEM (the support loop's gap
  // table, kind `refusal-guard`): the pane's guard code and its runtime decline code,
  // once the source has been still for `REFUSAL_LOG_SETTLE_MS` (a keystroke's
  // half-written script is not a refusal anyone hit), once per distinct set per page.
  // ⛔ CODES ONLY: never the reason sentence (it can quote the script), never the source.
  useEffect(() => {
    if (!built || built.ok) return undefined
    const codes = [built.guard, built.runtimeDeclined && built.runtimeDeclined.code]
      .filter((c) => typeof c === 'string' && c)
    if (!codes.length) return undefined
    const t = setTimeout(() => { logRefusalCodes(codes) }, REFUSAL_LOG_SETTLE_MS)
    return () => clearTimeout(t)
  }, [built])

  useEffect(() => {
    if (!built || !built.ok) {
      engineRegistry.uninstallUserDefinition(defId)
      setInstalled(null)
      return undefined
    }
    // ⭐ THE SHIPPED INSTALL DOOR, WHICH IS ALSO THE VALIDATION DOOR. It re-lints
    // the ast lane and refuses a document whose declared repaint mode disagrees
    // with what it measures; a draft it refuses installs nothing and this pane
    // stays inert rather than drawing on a verdict nobody re-measured.
    const { installed: got } = engineRegistry.installUserDefinitions([built.definition])
    if (got.length === 1) {
      setInstalled(got[0])
      return undefined
    }
    // ⛔ A REFUSAL MUST TAKE THE PREVIOUS ENTRY WITH IT — `installUserDefinitions`
    // drops a refused document BEFORE it writes the registry, so it never touches
    // the entry a good source installed a keystroke earlier, and that stale entry
    // would ride `listUserDefinitions()` onto the member's real chart.
    engineRegistry.uninstallUserDefinition(defId)
    setInstalled(null)
    return undefined
  }, [built, defId])

  // ⭐ THE HOST IS TOLD WHAT THIS PANE WOULD ADD (the installed document, or null), so
  // the sheet's own counts can describe the script and not its empty formula.
  useEffect(() => {
    if (typeof onDocument === 'function') onDocument(installed)
  }, [installed, onDocument])
  useEffect(() => () => { if (typeof onDocument === 'function') onDocument(null) }, [onDocument])

  // ⛔ A SEPARATE, EMPTY-DEP EFFECT for the teardown. Putting it in the cleanup
  // above would fire on every source change — uninstall-then-reinstall bumps the
  // registry generation twice per keystroke and rebuilds every registry-keyed
  // memo on the chart path each time.
  useEffect(() => () => { engineRegistry.uninstallUserDefinition(defId) }, [defId])

  const stored = useMemo(() => {
    if (!installed) return null
    const base = mergeChartSettings(settings || {})
    // ⛔ THE MEMBER'S OWN CANVAS WITH EVERY OTHER INSTANCE REMOVED — their
    // colours and candles, none of their indicators. A pane crowded with the
    // eight they already run does not answer "what does my script look like".
    const bare = { ...base, indicatorInstances: [], indicators: {} }
    return addInstance(bare, defId, engineRegistry)
  }, [installed, settings, defId])

  // ⭐ THE THREE DISCLOSURE CHANNELS ON ONE LIST, each produced where its
  // sentence is declared and rendered here verbatim: the D1 alert note and the
  // `baseTimeframeFolds` note come off the document (`memberPaneDefinition`),
  // the requirement badge is finished here ONLY because it needs the bar count
  // the chart just reported — `parse.js::requirementNote` still owns the wording.
  const disclosures = useMemo(() => {
    const base = (built && built.ok && built.notes) || []
    const tags = (built && built.ok && built.requirementTags) || []
    const badges = tags.map((t2) => requirementNote(t2, drawnBars)).filter(Boolean)
    return [...base, ...badges]
  }, [built, drawnBars])


  // ⭐⭐ T5b — THE ATTACH, AND ITS THREE OUTCOMES SAID OUT LOUD.
  //
  // ⛔ THE DOCUMENT IT HANDS OVER IS THE ONE ON SCREEN, and that is the whole
  // claim of this button: the definition drawn in the pane above is byte-for-byte
  // what gets stored, so a member who likes what they see gets what they saw.
  // Re-translating on click would put a second build between the preview and the
  // artifact, which is where "it looked different once I saved it" comes from.
  //
  // ⛔ AND THE STORE'S REFUSAL IS RENDERED VERBATIM. `saveUserDefinition` owns
  // the caps and their wording (64 KiB a row, 50 live definitions); a paraphrase
  // here is a second vocabulary for one decision — the rule `useUserDefinitions`
  // is written under, applied at its caller.
  const [attach, setAttach] = useState({ state: 'idle', error: null })

  // ⭐⭐ P0 gate (owner decision D) — THE REPAINT ACKNOWLEDGEMENT. The server
  // refuses a NEW-MATHS save of a `preview-repaints` document unless the request
  // carries `repaint_acknowledged` (`user_definitions._admit_new_maths`, 422
  // `repaint-ack`), and refuses `repaints` outright (422 `repaint`). This door
  // had no control to say it, so a preview-repainting import could not attach.
  // ⛔ ONLY FOR `preview-repaints`. `meta.repaint` is the WORST plot's measured
  // mode (`buildDefinition` → `worstRepaint`), so `repaints` anywhere means no
  // checkbox here: the button stays as it was and the server's own refusal
  // sentence is rendered verbatim below. Never persisted, reset per document.
  // ⭐⭐ ITEM 2 (2026-11-21, coordinator ruling) — A PREVIEW THE STORE CANNOT HOLD (`built.oversize`,
  // `memberPaneDefinition.js::withOversizeKeep`). The preview above is the host answer, unchanged; what Add KEEPS is
  // the runtime-lane document of the same script (`saveAs`, its notes shown before the member confirms), or nothing
  // at all: the refusal is said up front by name and no request is sent (`refusal`). ⚰️ Add used to send the 4 MB
  // host document and render the store's internal 400 sentence.
  const oversize = (built && built.ok && built.oversize) || null
  const keepDoc = oversize ? (oversize.saveAs ? oversize.saveAs.definition : null)
    : (built && built.ok ? built.definition : null)
  const repaintMode = (keepDoc && keepDoc.meta && keepDoc.meta.repaint) || null
  const needsAck = repaintMode === 'preview-repaints'
  const [acked, setAcked] = useState(false)
  useEffect(() => { setAcked(false) }, [built])

  // ⭐⭐ (2026-11-18, THE FIRST-PASTE RACE) — AN ADD PRESSED WHILE THIS BUILD WAITS FOR ITS ADMISSION ANSWER waits for
  // the answer (`awaitRuntimeAdmission`, bounded), re-mints the PREVIEW on it, and attaches the build then on screen,
  // so the claim above stands: what is attached is what is drawn. ⚰️ The Add attached the host copy minted before
  // the answer. When the wait runs out with no answer, the re-minted build is what the door mints then (the host
  // copy, as before): an Add is never refused for a server that has not answered.
  const [queuedAttach, setQueuedAttach] = useState(null)
  const attachBuilt = useCallback(async (fn, b, ackGiven, src) => {
    const ack = !!(b.definition && b.definition.meta && b.definition.meta.repaint === 'preview-repaints')
    setAttach({ state: 'busy', error: null })
    let res = null
    try {
      // ⭐⭐ SAVED-SCRIPT AUTO-UPGRADE — the SCRIPT this document was built from rides
      // with it, so the store keeps it beside the document and a later engine can
      // translate it again (`savedScriptUpgrade.js`). The same `source` the
      // build above read (`doorSource`, the build's OWN text: the box may already
      // hold a newer one): the document and its script are one pair.
      res = await fn(b.definition, { ...(ack && ackGiven ? { previewAcked: true } : {}), source: src })
    } catch {
      // ⚠️ A THROW IS A TRANSPORT FAILURE, NOT A REFUSAL. The store never
      // answered, so there is no sentence of its to render and inventing one that
      // sounds like a policy would be worse than saying what happened.
      setAttach({ state: 'error', error: 'Could not reach the store. Nothing was saved.' })
      return
    }
    if (res && res.ok) { setAttach({ state: 'done', error: null }); return }
    setAttach({
      state: 'error',
      error: (res && typeof res.error === 'string' && res.error.trim())
        ? res.error : 'The store refused this definition.',
    })
  }, [])
  const doAttachWith = useCallback(async (fn) => {
    // ITEM 2 (a build Add refuses up front sends nothing) and the paste worker (an Add while a newer build of the box
    // runs would attach the picture of the OLD text): the one authority the button's own state reads (`addAuthority.js`)
    if (!fn || !addReady({ built, building, doorSource, source })) return
    if (needsAck && !acked) return
    if (mintedPending) {
      setAttach({ state: 'busy', error: null, checking: true })
      await awaitRuntimeAdmission(doorSource)
      if (!aliveRef.current) return
      // the re-minted build is the first one landed AFTER this one (`door.seq`)
      setQueuedAttach({ fn, source: doorSource, acked: needsAck && acked, afterSeq: door.seq })
      setKillVersion((n) => n + 1)          // re-mint the preview on the answer
      return
    }
    await attachBuilt(fn, addSendsFor({ built, doorSource, source }), needsAck && acked, doorSource)
  }, [built, building, doorSource, source, door.seq, needsAck, acked, mintedPending, attachBuilt])
  useEffect(() => {
    if (!queuedAttach) return
    const q = queuedAttach
    // ⭐ THE PASTE WORKER — the re-mint runs off the main thread: the queued Add waits for ITS answer
    if (q.source === source && door.seq <= q.afterSeq) return
    setQueuedAttach(null)
    // the member edited the script while it waited: nothing attaches
    if (q.source !== source) { setAttach({ state: 'idle', error: null }); return }
    // the re-minted build is not one this door saves, Add refuses it up front (ITEM 2), or it is of another text: nothing
    // attaches (`addAuthority.js`, the same answer the button reads)
    const kept = addSendsFor({ built, doorSource, source })
    if (!kept) { setAttach({ state: 'idle', error: null }); return }
    // a re-minted build that asks for a repaint acknowledgement the member has not given waits for it, on screen
    const reNeedsAck = !!(kept.definition && kept.definition.meta && kept.definition.meta.repaint === 'preview-repaints')
    if (reNeedsAck && !q.acked) { setAttach({ state: 'idle', error: null }); return }
    attachBuilt(q.fn, kept, q.acked, doorSource)
  }, [queuedAttach, built, building, door.seq, doorSource, source, attachBuilt])
  const doAttach = useCallback(() => doAttachWith(onAttach), [doAttachWith, onAttach])
  const doAttachCopy = useCallback(() => doAttachWith(onAttachCopy), [doAttachWith, onAttachCopy])

  if (!enabled) return null
  if (!live) return null
  // ⭐ THE PASTE WORKER — a build of the box's text is running: said (the editor's own words), never a frozen tab
  const checking = building ? (
    <p data-testid="pine-member-pane-building" role="status" className={styles.building}><CheckingLine elapsedMs={buildingFor} /></p>
  ) : null
  // ⭐ A REFUSAL IS A SENTENCE, NEVER A BLANK. `paneGate` already produced one;
  // this renders it verbatim rather than inventing a second wording.
  if (built && !built.ok) {
    return (
      <>
        <div data-testid="pine-member-pane-refusal" role="status">{withoutGuardIds(built.reason)}</div>
        {checking}
      </>
    )
  }
  if (!stored) return checking

  return (
    <div data-testid="pine-member-pane" data-def-id={defId}>
      {/* ⭐ THE PASTE WORKER — the picture below is the last build; a newer one of the box's text is running */}
      {checking}
      {/* ⚰️ THE FRAME CARRIES THE HEIGHT, AND IT IS LOAD-BEARING. Unstyled, this
          pane drew at 248px and the chart's own chrome left the two panes 29px
          and 28px — four correct series, a correct quarter-height sub-pane, and
          a black rectangle. `MemberPane.module.css` records the measurement;
          `MemberPane.test.jsx` cannot see it, because it mocks `ChartPane`. */}
      <div className={styles.pane}>
        <ChartPane
          sym={sym}
          tf={tf}
          density="mini"
          showTfBar={false}
          stored={stored}
          onStore={noop}
          stockChartProps={{ ...MEMBER_CHART_PROPS, onDrawnBarCount }}
        />
      </div>
      {/* ⭐ THE DISCLOSURES THE RULINGS OWE A MEMBER, rendered VERBATIM and
          composed nowhere: the D1 alert note comes from `memberPaneDefinition`,
          which interpolates the condition's name from the one sentence declared
          in `closedTable.json::_alertconditions`. */}
      {disclosures.length > 0 && (
        <ul data-testid="pine-member-pane-notes" className={styles.notes}>
          {disclosures.map((n) => <li key={n.name}>{withoutGuardIds(n.note)}</li>)}
        </ul>
      )}
      {/* ⭐⭐ T5b — THE ONE CONTROL THAT LEAVES THE HARNESS. Present only when a
          caller supplied a place to put the result; absent on a default build,
          because this whole component already returned `null` above. */}
      {/* ⭐ RT1 — A RUNTIME-LANE DOCUMENT IS OFFERED AS A SAVE TOO: the store has a
          door for it (`api/services/runtime_definitions.py`), and while that door
          is switched off its refusal sentence is rendered verbatim below.
          `saveable: false` still hides the button for any document that says so. */}
      {/* ⭐⭐ ITEM 2 — A PREVIEW THE STORE CANNOT HOLD: Add refused up front, by name, and no control to press. */}
      {onAttach && built && built.saveable !== false && oversize && !oversize.saveAs && (
        <p data-testid="pine-member-pane-keep-refusal" role="status">{withoutGuardIds(oversize.refusal)}</p>
      )}
      {onAttach && keptForAdd(built) && (
        <div data-testid="pine-member-pane-attach">
          {/* ⭐⭐ ITEM 2 — …or kept drawn bar by bar, and what that means said BEFORE the member confirms. */}
          {oversize && oversize.saveAs && (
            <div data-testid="pine-member-pane-keep">
              <p>{oversize.saveAs.lead}</p>
              <ul className={styles.notes}>
                {(oversize.saveAs.notes || []).map((n) => <li key={n.name}>{withoutGuardIds(n.note)}</li>)}
                {oversize.saveAs.forming && <li key="forming">{oversize.saveAs.forming}</li>}
                {oversize.saveAs.budget && <li key="budget" data-testid="pine-member-pane-keep-budget">{oversize.saveAs.budget}</li>}
              </ul>
            </div>
          )}
          {needsAck && (
            <>
              <p data-testid="pine-member-pane-repaint-note">This script can repaint recent signals.</p>
              <label className={sheetStyles.ack}>
                <input
                  type="checkbox"
                  checked={acked}
                  onChange={(e) => setAcked(e.target.checked)}
                  data-testid="pine-member-pane-repaint-ack"
                />
                <span>I understand this indicator may repaint</span>
              </label>
            </>
          )}
          <button
            type="button"
            className={styles.attach}
            disabled={attach.state === 'busy' || !addReady({ built, building, doorSource, source }) || (needsAck && !acked)}
            onClick={doAttach}
          >
            {attach.state === 'busy' ? (onAttachCopy ? 'Saving…' : 'Adding…') : attachLabel}
          </button>
          {onAttachCopy && copyLabel && (
            <button
              type="button"
              className={styles.attach}
              data-testid="pine-member-pane-attach-copy"
              disabled={attach.state === 'busy' || !addReady({ built, building, doorSource, source }) || (needsAck && !acked)}
              onClick={doAttachCopy}
            >
              {copyLabel}
            </button>
          )}
          {attach.state === 'busy' && attach.checking && (
            <span className={styles.attachOk} role="status" data-testid="pine-member-pane-attach-checking">
              Checking this script before it is added…
            </span>
          )}
          {attach.state === 'done' && (
            <span className={styles.attachOk} role="status">
              {doneLabel}
            </span>
          )}
          {attach.state === 'error' && attach.error && (
            <span className={styles.attachErr} role="alert">{attach.error}</span>
          )}
        </div>
      )}
    </div>
  )
}
