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
import { useCallback, useEffect, useMemo, useState } from 'react'
import ChartPane from '../../pane/ChartPane'
import * as engineRegistry from '../../engine/nativeRegistry'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { memberPaneEnabled } from '../../engine/memberPaneGate'
import { requirementNote } from '../../engine/ast/parse'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'
import styles from './MemberPane.module.css'

const noop = () => {}

/** ⭐ The member's real chart already streams and warms this symbol; a second
 *  surface doing both would double the work for one pane. Same recipe
 *  `PreviewPane` uses, and for the same reason. */
const MEMBER_CHART_PROPS = Object.freeze({ liveUpdates: false, backgroundWarm: false })

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
 */
export default function MemberPane({
  sym = null, tf = null, source = null, defId = MEMBER_PANE_DEF_PREFIX, settings = null,
  onAttach = null,
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

  // ⭐ THE BUILD IS MEMOISED ON THE SOURCE, not run per render: `translatePine`
  // on a real script is milliseconds, and milliseconds on every keystroke is a
  // frame budget.
  const built = useMemo(
    () => (live ? memberPaneDefinition({ source, id: defId }) : null),
    [live, source, defId],
  )
  const [installed, setInstalled] = useState(null)

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
  const doAttach = useCallback(async () => {
    if (!onAttach || !built || !built.ok) return
    setAttach({ state: 'busy', error: null })
    let res = null
    try {
      res = await onAttach(built.definition)
    } catch (e) {
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
  }, [onAttach, built])

  if (!enabled) return null
  if (!live) return null
  // ⭐ A REFUSAL IS A SENTENCE, NEVER A BLANK. `paneGate` already produced one;
  // this renders it verbatim rather than inventing a second wording.
  if (built && !built.ok) {
    return (
      <div data-testid="pine-member-pane-refusal" role="status">{built.reason}</div>
    )
  }
  if (!stored) return null

  return (
    <div data-testid="pine-member-pane" data-def-id={defId}>
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
          {disclosures.map((n) => <li key={n.name}>{n.note}</li>)}
        </ul>
      )}
      {/* ⭐⭐ T5b — THE ONE CONTROL THAT LEAVES THE HARNESS. Present only when a
          caller supplied a place to put the result; absent on a default build,
          because this whole component already returned `null` above. */}
      {onAttach && (
        <div data-testid="pine-member-pane-attach">
          <button
            type="button"
            className={styles.attach}
            disabled={attach.state === 'busy'}
            onClick={doAttach}
          >
            {attach.state === 'busy' ? 'Adding…' : 'Add this script to my chart'}
          </button>
          {attach.state === 'done' && (
            <span className={styles.attachOk} role="status">
              Saved, and added to this chart.
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
