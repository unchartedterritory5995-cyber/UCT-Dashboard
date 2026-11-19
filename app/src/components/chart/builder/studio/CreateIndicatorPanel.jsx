// app/src/components/chart/builder/studio/CreateIndicatorPanel.jsx
//
// ─── ⭐⭐ CREATE INDICATOR — UCT INTELLIGENCE (P2 Track B, Slice 1) ──────────
//
// conversation → interpretation → LIVE PREVIEW ON THE REAL CHART → refinement → save.
//
// ONE conversation owns ONE working definition (Track A's authoring state, via
// `useIndicatorConversation`) and ONE preview identity on the chart it was
// opened from (`chartPreview.js`): turn 1 installs preview A, every later turn
// re-installs preview A, Cancel removes preview A, Save hands the working
// definition to the existing save doors and preview A is replaced by the one
// durable instance those doors add.
//
// ⛔ THE PREVIEW IS NEVER CHART STATE. It is reported up through `onPreview` to
// StockChart, which lays it over its read view (`csView`) only. `settings` here
// is the STORED blob, and the only write this component makes is Save's, through
// `onChange` — the chart's own settings writer, exactly as BuilderSheet does.

import { withoutGuardIds } from '../../engine/ast/guardIdText'
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../ui/UIcon'
import * as engineRegistry from '../../engine/nativeRegistry'
import { presentationLines, vocabularyLines } from '../authoring'
import { colorRuleWords, outputNamer } from '../authoring/readback'
import { helpersOfDefinition, plotColorRule } from '../authoring/colorRules'
import { converseTurn } from '../authoring/converseClient'
import { offerableBuiltIns, applyOffer } from '../authoring/builtInOffer'
import { isDefinitionOffered, subscribeServerDefinitions, serverDefinitionsVersion } from '../../engine/serverCompute'
import useIndicatorConversation, { typeWord } from './useIndicatorConversation'
import { claimPreview, releasePreview, installPreview, removePreview } from './previewChannel'
import { withPendingInputs } from './editPreview'
import { conversationEditability, CARRIED_NOTE } from '../authoring/memberWords'
import { ackCheckboxText } from '../authoring/repaintWarning'
import styles from './CreateIndicatorPanel.module.css'
import useReportsConfig from '../../supportLoop/useReportsConfig'
import { hasSomethingToSend } from './sendConversation'
// ⭐ L8 — loaded on the press: most conversations are never sent
const SendConversationDialog = lazy(() => import('./SendConversationDialog'))
import { safeCssColour } from '../../engine/objectColour'
import SettingsFields from './SettingsFields'
import { restoreNote } from '../authoring/restoreVersion'

const EXAMPLES = Object.freeze(['Add a 20 EMA', 'RSI overbought signal', 'Volume above its 50-day average'])
/** The hint inside the message box, by what the member is doing.
 *  ⛔ ONE SHORT LINE EACH. The box is one row tall until something is typed, so a hint that wraps is
 *  cut off mid-word (seen on a phone, 2026-11-17: "Describe the indicator you want to" and a sliver
 *  of the rest). The sentence above the box already says it in full; the stylesheet keeps whatever
 *  is here on one line as the second guard. */
export const BOX_HINT = Object.freeze({
  fresh: 'Describe your indicator…',
  working: 'Refine it — e.g. "make it 50"',
  edit: 'Describe a change — e.g. "make it 21"',
})
/** The longest a hint may be and still fit the box on a 360 px phone at the touch text size. */
export const BOX_HINT_MAX = 38
const PANEL_W = 360
const INSET = 8

/** A plot's `$input` reference → the value it resolves to. */
function resolveRef(def, v) {
  if (typeof v !== 'string' || !v.startsWith('$')) return v
  const spec = (def.inputs || []).find((s) => s && s.key === v.slice(1))
  return spec ? spec.default : v
}

const STYLE_WORDS = Object.freeze({ line: 'Line', stepline: 'Step line', histogram: 'Histogram', area: 'Area', baseline: 'Baseline', markers: 'Markers' })
const SHAPE_WORDS = Object.freeze({ circle: 'Circle', square: 'Square', arrowUp: 'Up arrow', arrowDown: 'Down arrow' })
const POSITION_WORDS = Object.freeze({ aboveBar: 'above the candle', belowBar: 'below the candle', inBar: 'on the candle' })

/** The presentation, from the working definition itself — never from prose. */
function lookOf(def) {
  if (!def) return { plots: [], paints: [], placement: null }
  // ⭐ PHASE 5 — a colour rule's / cloud's hidden column is described through its
  // owner ("coloured green while it rises"), never as a line of its own.
  const helpers = helpersOfDefinition(def)
  const nameOf = outputNamer(def)
  const plots = (def.plots || []).filter((p) => p && p.style !== 'hlines' && !helpers.has(p.key)).map((p) => {
    const color = resolveRef(def, p.color)
    // the member-facing name (a one-output definition's chip label is its name cut to 12
    // characters — "High <: hidden" was read on the real-model inside-day turn)
    if (p.hidden) return { key: p.key, text: `${nameOf(p.key)}: hidden`, color: null }
    if (p.style === 'markers' && p.marker) {
      return { key: p.key, color,
        text: `${SHAPE_WORDS[p.marker.shape] || p.marker.shape} ${POSITION_WORDS[p.marker.position] || ''}`.trim()
          + (Number.isFinite(p.marker.size) && p.marker.size !== 1 ? ` · size ${p.marker.size}` : '') }
    }
    const width = resolveRef(def, p.width)
    return { key: p.key, color, text: `${STYLE_WORDS[p.style || 'line'] || p.style}${Number.isFinite(Number(width)) ? ` · width ${width}` : ''}${colorRuleWords(plotColorRule(def, p, helpers), nameOf)}` }
  })
  // Paints keep the engine's own sentence (`presentationLines`), minus the plot
  // and placement lines rendered above.
  const paints = [...presentationLines(def).filter((l) => /^(candles painted|background shaded|an imported|a table in|table row|a chart table)/.test(l)),
    // ⭐ P3 — line styles, bands and levels, in the engine's own words.
    ...vocabularyLines(def)]
  const placement = def.placement && def.placement.target === 'price' ? 'On the price chart' : 'In its own pane'
  return { plots, paints, placement }
}

/** Dock on the LEFT edge of the chart: the newest bars and the price axis stay visible. */
function measureDock(anchorRef) {
  if (typeof window === 'undefined') return { top: INSET, left: INSET, height: 600 }
  const el = anchorRef && anchorRef.current
  const vh = window.innerHeight
  if (!el) return { top: INSET, left: INSET, height: vh - 2 * INSET }
  const r = el.getBoundingClientRect()
  const top = Math.max(INSET, r.top + INSET)
  const bottom = Math.min(vh - INSET, r.bottom - INSET)
  const left = Math.max(INSET, Math.min(r.left + INSET, window.innerWidth - PANEL_W - INSET))
  return { top, left, height: Math.max(360, bottom - top) }
}

// ⛔ FOCUS CONTRACT (2026-10-06 production defect): the panel is VISIBLE and placed
// from its FIRST commit — measured synchronously, never a `visibility: hidden`
// placeholder (a hidden element cannot take focus).
function useDockRect(anchorRef, open) {
  const [rect, setRect] = useState(() => measureDock(null))   // the chart edge is measured before paint, below
  useLayoutEffect(() => {
    if (!open) return undefined
    const measure = () => setRect(measureDock(anchorRef))
    measure()
    let ro = null
    if (typeof ResizeObserver !== 'undefined' && anchorRef && anchorRef.current) {
      ro = new ResizeObserver(measure)
      ro.observe(anchorRef.current)
    }
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorRef, open])
  return rect
}

const isEditable = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

// Keys typed inside the panel are the panel's. They stop at its root, so the
// document/window handlers underneath (the drill board's Escape-closes-the-board,
// the chart's symbol/shortcut keys, the list's arrow keys) never see them.
// Scoped to this panel — chart shortcuts elsewhere are untouched.
const keepKeysInPanel = (e) => e.stopPropagation()

/**
 * @param {object} props
 * @param {Function} props.onClose          close the panel (the preview goes with it)
 * @param {object|null} props.settings     the chart's STORED settings
 * @param {Function|null} props.onChange   the chart's settings writer (Save only)
 * @param {string|null} props.sym / props.tf
 * @param {{current: Element|null}} [props.anchorRef] the chart container to dock against
 * @param {Function} props.onPreview       `(instance|null)` — the ephemeral preview instance
 * @param {Function|null} [props.onOpenBuilder] `(mode)` — the existing builder's doors
 * @param {Function|null} [props.onOpenLibrary] Chart Settings → Indicators → Add to Chart
 * @param {Function} [props.converse]       injectable client (tests / harness)
 * @param {Element|null} [props.dockHost]   the pane's RIGHT WORKSPACE DOCK: render inside it,
 *                                         full height, instead of floating over the chart
 * @param {Function|null} [props.onDocked] `(bool)` — tells the pane to make (or give back) room
 * @param {string|null} [props.sessionKey]  SLICE 2 — the opaque create context the conversation
 *                                         is kept under while the dock is closed (✕ keeps it;
 *                                         Discard and Add to Chart end it)
 * @param {{def_id: string, version: number, definition: object}|null} [props.editRow]
 *   ⭐ PHASE 4 — MODIFY WITH UCT INTELLIGENCE: the STORE's row of an existing user
 *   definition. The studio opens it as its working snapshot (OPEN != MUTATE: no write
 *   until Save), previews the change IN PLACE of the saved drawing, and saves it
 *   revision-aware as a new version of the SAME definition.
 * @param {Function|null} [props.onEditFormula] ⭐ PHASE 4 — open the manual editor on
 *   the same definition (offered when the conversation cannot edit it)
 */
/** How long a preview usually takes, said to the member while they wait. Measured on
 *  production 2026-11-15 (about 14 s to a first preview); a range, never a promise. */
export const USUAL_WAIT = 'Usually 10 to 20 seconds'
/** After this many seconds the line says so instead. */
export const LONG_WAIT_S = 30

/**
 * ⭐ WHILE IT WORKS (2026-11-16). The wait showed one unchanging line and no way out. It now
 * counts the seconds, says what is usual, and offers Stop. Mounted only while a turn is in
 * flight, so its one-second tick ends with the turn.
 */
function Working({ onStop }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className={styles.workingRow}>
      <div className={styles.workingText}>
        <div className={styles.working} data-testid="create-indicator-working">The UCT Agent is thinking</div>
        <div className={styles.workingNote} data-testid="create-indicator-working-note" aria-live="off">
          {secs >= LONG_WAIT_S ? `${secs}s. This one is taking longer than usual` : `${secs}s. ${USUAL_WAIT}`}
        </div>
      </div>
      <button type="button" className={styles.ghost} data-testid="create-indicator-stop"
        onClick={() => onStop && onStop()}>Stop</button>
    </div>
  )
}

/** ⭐ F1 — the dock speaks about the allowance only once less than this share is left. */
export const ALLOWANCE_NOTE_BELOW = 0.5

/** The sentence for a share left, or null while there is plenty. No times: the allowance
 *  renews with the market day, which this line does not try to pin to a clock. */
/** True while the conversation's LAST entry is the spent-allowance refusal: the line above the box
 *  would say the same thing twice. */
export function spentJustSaid(transcript, left) {
  if (!(typeof left === 'number' && left <= 0)) return false
  const last = Array.isArray(transcript) && transcript.length ? transcript[transcript.length - 1] : null
  return !!(last && last.kind === 'refusal' && last.gate === 'cost:user')
}

/** When a saved version was stored, as a short date; '' when the store gave none. */
export function versionWhen(at) {
  if (!Number.isFinite(at) || at <= 0) return ''
  try {
    return new Date(at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '' }
}

export function allowanceLine(left) {
  if (typeof left !== 'number' || !(left < ALLOWANCE_NOTE_BELOW)) return null
  if (left <= 0) return "Today's UCT Agent allowance is used up. It renews each day."
  return `About ${Math.max(5, Math.round(left * 100))}% of today's UCT Agent allowance is left.`
}

export default function CreateIndicatorPanel({
  onClose, settings = null, onChange = null, sym = null, tf = null, anchorRef = null, onOpenScript = null,
  onPreview, onOpenBuilder = null, onOpenLibrary = null, converse = converseTurn,
  dockHost = null, onDocked = null, sessionKey = null, editRow = null, onEditFormula = null,
  seed = null, sendSeed = false, previewChartRef = null, readHistory = undefined,
  engineChart = null,
}) {
  // ⭐ THE CHART THIS DOCK SITS BESIDE, as the engine sees it (`StockChart`'s `engineChart`: the bars
  // its binder computes on and the compute context it hands that binder). Kept in a ref and read
  // through a stable getter, so a new bar does not re-render the conversation and a script is run on
  // the bars of the moment it is checked.
  const chartRef = useRef(engineChart)
  useEffect(() => { chartRef.current = engineChart }, [engineChart])
  const chartOf = useCallback(() => {
    const c = chartRef.current
    return c && c.ctx && Array.isArray(c.bars) ? c : null
  }, [])
  // ⭐ PHASE 4 — held once: the row this studio was opened on (a later list refresh
  // must not re-open it under the member's feet).
  const [open] = useState(() => (editRow && editRow.definition && editRow.def_id
    ? { def: editRow.definition, defId: editRow.def_id, version: Number(editRow.version) || 1 }
    : null))
  const editMode = !!open
  const editability = useMemo(() => (open ? conversationEditability(open.def) : null), [open])
  const blocked = !!(editability && !editability.editable)
  // ⭐ WHAT THIS WINDOW CAN ADD TO THE CHART RIGHT NOW (`builtInOffer.js`, rule 1): the library's
  // built-in names this build's registry offers, re-read when the live server's list arrives.
  // Nothing while the chart cannot be written from here.
  const serverVersion = useSyncExternalStore(subscribeServerDefinitions, serverDefinitionsVersion, () => 0)
  const builtIns = useMemo(
    () => offerableBuiltIns({ registry: engineRegistry, isOffered: isDefinitionOffered, canWrite: !!onChange }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serverVersion is the re-read signal
    [serverVersion, onChange])
  const conv = useIndicatorConversation({ sym, tf, converse, sessionKey, open, builtIns, chartOf,
    ...(readHistory ? { readHistory } : {}) })
  const { state, transcript, rb, busy, saving, previewDefinition } = conv
  const previewCalcTf = (state && state.requests && state.requests.calculationTimeframe) || null
  const previewBase = (state && state.base) || null
  // ⭐ AGENT M1 — a PREFILLED request (UCT Agent's hand-off): it sits in the box for the
  // member to read, edit and send. Never sent here, and never over a restored draft.
  const [message, setMessage] = useState(() => (!conv.restored && typeof seed === 'string' ? seed : ''))
  // Floating geometry is measured only when there is no dock to live in.
  const rect = useDockRect(anchorRef, !dockHost)
  // ⭐ THE ROOM IS MADE IN THE SAME PAINT THE DOCK APPEARS IN. A layout effect, so
  // the pane's reflow (padding-right) commits before the browser paints: the dock
  // never overlaps the chart, not even for a frame, and the chart never paints at
  // its old width beside it. Closing (unmount) hands the width straight back.
  const onDockedRef = useRef(onDocked)
  useLayoutEffect(() => { onDockedRef.current = onDocked })
  useLayoutEffect(() => {
    if (!dockHost) return undefined
    onDockedRef.current?.(true)
    return () => onDockedRef.current?.(false)
  }, [dockHost])
  const logEndRef = useRef(null)
  const inputRef = useRef(null)
  // The latest stored blob and preview channel, read inside effects/handlers.
  const settingsRef = useRef(settings)
  const onPreviewRef = useRef(onPreview)
  useLayoutEffect(() => {
    settingsRef.current = settings
    onPreviewRef.current = onPreview
  })

  // ─── THE PREVIEW: ONE ID, RE-INSTALLED PER WORKING REVISION ──────────────
  // `installUserDefinitions` is the shipped install door AND the validation door:
  // a working definition it refuses draws nothing (and takes the previous preview
  // with it), exactly as the Builder's PreviewPane behaves.
  // ⭐ M3 S3 — the install-and-show step lives in `previewChannel.installPreview` (moved, the
  // SAME steps), and the dock CLAIMS the tab's one preview (D3): a preview UCT Agent showed on
  // another chart is cleared first, so the one registry id is never shared by two charts.
  const [previewToken] = useState(() => ({ surface: 'dock' }))
  useEffect(() => {
    if (!previewDefinition) {
      removePreview(engineRegistry, onPreviewRef.current)
      releasePreview(previewToken)
      return
    }
    claimPreview(previewToken, previewChartRef, () => removePreview(engineRegistry, onPreviewRef.current), 'dock')
    installPreview({ definition: previewDefinition, edit: open ? { defId: open.defId } : null, base: previewBase,
      calcTf: previewCalcTf, settings: settingsRef.current, registry: engineRegistry, onPreview: onPreviewRef.current,
      shapeEdit: withPendingInputs })
  }, [previewDefinition, previewBase, open, previewCalcTf, previewChartRef, previewToken])

  // ⛔ THE TEARDOWN IS NOT OPTIONAL — Cancel, ✕, Save, a symbol-less remount and
  // an unmount of the chart itself all end here: no registry entry, no instance.
  const clearPreview = useCallback(() => {
    removePreview(engineRegistry, onPreviewRef.current)
    releasePreview(previewToken)
  }, [previewToken])
  useEffect(() => clearPreview, [clearPreview])

  // ⛔ NOT `scrollIntoView` — that scrolls every ancestor, the page included.
  useEffect(() => {
    const body = logEndRef.current && logEndRef.current.parentElement
    if (body) body.scrollTop = body.scrollHeight
  }, [transcript.length, busy])

  // ⛔ FOCUS CONTRACT (2026-10-06 production defect): the composer takes focus
  // when the panel opens and again when a turn completes. SYNCHRONOUS — the old
  // one-frame-late `requestAnimationFrame` never ran in a backgrounded/occluded
  // tab, so focus stayed on <body> and keystrokes drove the drill list/chart.
  //   • OPEN is an explicit request: focus moves here from wherever it was (the
  //     drill dialog, the toolbar button) — except out of a text field the member
  //     is typing in.
  //   • A COMPLETED TURN never steals: only from <body> (Send disabled itself) or
  //     from inside the panel.
  const panelRef = useRef(null)
  const focusComposer = useCallback((allowFrom) => {
    const input = inputRef.current
    if (!input || input.disabled || typeof document === 'undefined') return
    const active = document.activeElement
    if (active === input) return
    const inPanel = !!(active && panelRef.current && panelRef.current.contains(active))
    if (!active || active === document.body || inPanel || (allowFrom && allowFrom(active))) {
      input.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const fromAnythingButAField = (el) => !isEditable(el) || !el.isConnected
    focusComposer(fromAnythingButAField)
    // Opening from Chart Settings closes that modal in the same commit; a focus
    // restore it schedules can land on its trigger. One macrotask later (timers
    // run in hidden tabs; frames do not) take focus back on the same terms.
    const t = setTimeout(() => focusComposer(fromAnythingButAField), 0)
    return () => clearTimeout(t)
  }, [focusComposer])
  //   • A CLARIFICATION with choices asks for explicit interaction: the composer
  //     is not pulled to; focus lost to <body> (or parked on an inert panel button)
  //     goes to the first choice instead
  //     (still inside the panel, so keys stay isolated).
  const hasChoices = conv.questions.some((q) => Array.isArray(q.choices) && q.choices.length)
  useEffect(() => {
    if (busy) return
    if (!hasChoices) { focusComposer(null); return }
    if (typeof document === 'undefined') return
    const active = document.activeElement
    const lost = !active || active === document.body
      || (panelRef.current && panelRef.current.contains(active) && !isEditable(active))   // e.g. Send, which disabled itself
    if (lost) panelRef.current?.querySelector('[data-testid="create-indicator-choices"] button:not(:disabled)')?.focus({ preventScroll: true })
  }, [busy, hasChoices, focusComposer])

  /** ⭐ THE TAP ON AN OFFER: asks again whether this build offers it, makes the Indicators
   *  list's own write, and says what happened. One tap settles the offer either way. */
  const takeOffer = useCallback((entry) => {
    if (!entry || !entry.offer || busy || saving) return
    // (`tf`: so the line can say when a built-in that draws only on some timeframes will not show here)
    const out = applyOffer(entry.offer, { settings: settingsRef.current, registry: engineRegistry, isOffered: isDefinitionOffered, tf })
    if (out.ok && onChange) onChange(out.next)
    conv.settleOffer(entry.id, out.ok && !onChange ? 'This chart cannot be changed from here, so nothing was added.' : out.line)
  }, [busy, saving, conv, onChange, tf])

  const submit = useCallback(async (text) => {
    const words = String(text ?? message).trim()
    if (!words || busy || saving) return
    setMessage('')
    await conv.send(words)
  }, [message, busy, saving, conv])

  // ⭐ 2026-11-16 — THE MEMBER'S OWN WORDS, SENT ONCE. The Indicators window's plain-words box
  // was submitted by the member (`sendSeed`), so the seed goes as the first turn instead of
  // waiting in the box. ⛔ Once per opening, never over a restored draft, never on an indicator
  // that cannot be changed here, and never for UCT Agent's seed (its door cannot set the flag).
  const seedSentRef = useRef(false)
  useEffect(() => {
    if (!sendSeed || seedSentRef.current) return
    if (conv.restored || blocked || typeof seed !== 'string' || !seed.trim()) return
    seedSentRef.current = true
    submit(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at the opening that carried it
  }, [])

  // ⭐ SLICE 2 — TWO WAYS OUT, AND THEY MEAN DIFFERENT THINGS.
  //   ✕       closes the dock and KEEPS the draft: reopening Create Indicator on
  //           this chart restores the conversation and its preview.
  //   Discard throws the draft away on purpose (the footer button — "Cancel"
  //           while there is nothing to lose).
  // Neither asks a question: closing is never destructive, so there is nothing
  // to confirm, and an answer-only conversation never needed saving.
  const close = useCallback(() => { clearPreview(); onClose?.() }, [clearPreview, onClose])
  const cancel = useCallback(() => { conv.discard(); clearPreview(); onClose?.() }, [conv, clearPreview, onClose])
  // ⭐ PHASE 4 — leaving an EDIT with unsaved changes asks first (keep the draft,
  // discard it, or keep editing). An opened-but-untouched or just-saved definition
  // closes without a question; a create keeps the accepted no-prompt contract.
  const [confirmLeave, setConfirmLeave] = useState(null)   // 'close' | 'discard' | null
  // ⭐ L8 — the support loop's report door: asked once a member has written something
  const reportsCfg = useReportsConfig(hasSomethingToSend(transcript))
  const [sendOpen, setSendOpen] = useState(false)
  // ⭐ V1 — the History list (the earlier steps of this draft). Closed by a pick, by Esc,
  // by its own button, and whenever there is no longer more than one step to offer.
  const [historyOpen, setHistoryOpen] = useState(false)
  const stepCount = conv.steps.length
  // ⭐ SAVED VERSIONS (backlog 30) — an indicator saved more than once has earlier versions to go
  // back to, so History is offered on an edit even before the draft has a step of its own. The
  // list is read when History is opened, never when the dock opens.
  const hasSavedVersions = editMode && open.version > 1
  const historyAvailable = stepCount >= 2 || hasSavedVersions
  useEffect(() => { if (!historyAvailable) setHistoryOpen(false) }, [historyAvailable])
  const loadVersions = conv.loadVersions
  useEffect(() => { if (historyOpen && hasSavedVersions) loadVersions() }, [historyOpen, hasSavedVersions, loadVersions])
  const askOrClose = useCallback(() => { if (editMode && conv.dirty) setConfirmLeave('close'); else close() }, [editMode, conv.dirty, close])
  const askOrCancel = useCallback(() => { if (editMode && conv.dirty) setConfirmLeave('discard'); else cancel() }, [editMode, conv.dirty, cancel])

  const save = useCallback(async () => {
    const res = await conv.save({ settings: settingsRef.current, onChange, beforeAttach: clearPreview })
    // ⭐ BATCH 1 — the receipt goes WITH the close: the toolbar keeps it on screen
    // after this panel is gone (`SaveReceipt`), so a step that failed is seen.
    if (res.ok) onClose?.({ saved: res, receipt: res.receipt })
  }, [conv, onChange, clearPreview, onClose])

  const openDoor = useCallback((fn) => { clearPreview(); fn() }, [clearPreview])

  const look = useMemo(() => lookOf(state.working), [state.working])
  const started = transcript.length > 0 || !!state.working
  const panelTitle = editMode ? 'Modify Indicator' : 'Create Indicator'
  const editName = (open && open.def && open.def.meta && open.def.meta.name) || 'this indicator'

  const panel = (
    <aside
      className={dockHost ? `${styles.panel} ${styles.panelDocked}` : styles.panel}
      ref={panelRef}
      style={dockHost ? undefined : { top: rect.top, left: rect.left, height: rect.height }}
      onKeyDown={keepKeysInPanel}
      onKeyUp={keepKeysInPanel}
      onKeyPress={keepKeysInPanel}
      role="dialog"
      aria-modal="false"
      aria-label={panelTitle}
      data-testid="create-indicator"
      data-mode={editMode ? 'edit' : 'create'}
      data-def-id={state.defId || ''}
      data-dirty={conv.dirty ? 'true' : 'false'}
      data-lineage={state.lineage}
      data-revision={state.revision}
    >
      <header className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.title}>{panelTitle}</span>
          <span className={styles.identity}>
            <UIcon name="ind-formula" size={11} gold={false} />
            UCT Agent
          </span>
        </div>
        <button type="button" className={styles.close} onClick={askOrClose} aria-label={`Close ${panelTitle} (your draft is kept)`}
          title="Close — your draft is kept" data-testid="create-indicator-close">✕</button>
      </header>

      {confirmLeave && (
        <div className={styles.status} role="alertdialog" aria-label="Unsaved changes" data-testid="create-indicator-confirm-leave">
          <span>{confirmLeave === 'discard'
            ? `Discard your unsaved changes to “${editName}”? The saved version stays as it is.`
            : 'You have unsaved changes. Keep them as a draft for later, or discard them?'}</span>
          <div className={styles.doors}>
            {confirmLeave === 'close' && (
              <button type="button" className={styles.door} data-testid="create-indicator-keep-draft"
                onClick={() => { setConfirmLeave(null); close() }}>Keep draft</button>
            )}
            <button type="button" className={styles.door} data-testid="create-indicator-discard-confirm"
              onClick={() => { setConfirmLeave(null); cancel() }}>Discard changes</button>
            <button type="button" className={styles.door} data-testid="create-indicator-keep-editing"
              onClick={() => setConfirmLeave(null)}>Keep editing</button>
          </div>
        </div>
      )}

      <div className={styles.body}>
        {!started && (
          <div className={styles.intro} data-testid="create-indicator-intro">
            <div className={styles.introLede}>Describe the indicator you want to build.</div>
            <div className={styles.introNote}>
              It appears on this chart as you go. Refine it in plain words, then add it.
            </div>
            <div className={styles.examples}>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className={styles.chip} disabled={busy} onClick={() => submit(ex)}>{ex}</button>
              ))}
            </div>
            {(onOpenBuilder || onOpenLibrary) && (
              <div className={styles.doors} data-testid="create-indicator-doors">
                <span>Or start from</span>
                {onOpenBuilder && (
                  <button type="button" className={styles.door} onClick={() => openDoor(() => onOpenBuilder('formula'))}>Formula</button>
                )}
                {onOpenBuilder && (
                  <button type="button" className={styles.door} onClick={() => openDoor(() => onOpenBuilder('pine'))}>Import</button>
                )}
                {onOpenLibrary && (
                  <button type="button" className={styles.door} onClick={() => openDoor(onOpenLibrary)}>Library</button>
                )}
                {onOpenBuilder && (
                  <button type="button" className={styles.door} onClick={() => openDoor(() => onOpenBuilder('image'))}>Screenshot</button>
                )}
              </div>
            )}
          </div>
        )}

        {editMode && blocked && (
          <div className={styles.status} role="note" data-testid="create-indicator-not-editable" data-code={editability.code}>
            {withoutGuardIds(editability.text)}
            {onEditFormula && (
              <div className={styles.doors}>
                <button type="button" className={styles.door} data-testid="create-indicator-edit-formula"
                  onClick={() => openDoor(onEditFormula)}>Edit formula instead</button>
              </div>
            )}
          </div>
        )}
        {editMode && !blocked && editability && editability.carried > 0 && (
          <div className={styles.status} role="note" data-testid="create-indicator-carried">{CARRIED_NOTE}</div>
        )}

        {conv.restored && (
          <div className={styles.status} data-testid="create-indicator-restored" data-recovered={conv.recovered ? 'true' : undefined}>
            {conv.recovered
              ? 'Recovered your unsaved draft from before the page reloaded — nothing is saved until you choose Save. Discard throws it away.'
              : 'Draft restored — Discard throws it away.'}
          </div>
        )}
        {/* ⭐ BATCH 1 — a kept draft that could not be opened safely, and why. */}
        {conv.dropped && (
          <div className={styles.status} role="note" data-testid="create-indicator-draft-dropped" data-reason={withoutGuardIds(conv.dropped.reason)}>
            {conv.dropped.reason === 'stale'
              ? `Your unsaved changes were made to version ${conv.dropped.from ?? 'an earlier version'}, and this indicator has been saved since (now version ${conv.dropped.now}). They were not restored, so nothing newer is overwritten.`
              : 'An unsaved draft from before the page reloaded could not be restored.'}
          </div>
        )}

        {transcript.length > 0 && (
          <ol className={styles.log} data-testid="create-indicator-log" aria-live="polite">
            {transcript.map((t) => (t.role === 'member'
              ? <li key={t.id} className={styles.msgMember} data-role="member">{t.text}</li>
              : (
                <li key={t.id} data-role="uct" data-kind={t.kind} data-updated={t.updated ? 'true' : undefined}
                  className={`${styles.msgUct} ${t.kind === 'refusal' ? styles.msgRefusal : ''} ${t.kind === 'unsupported' ? styles.msgLimit : ''} ${t.kind === 'answer' ? styles.msgAnswer : ''} ${t.kind === 'undo' || t.kind === 'stopped' ? styles.msgQuiet : ''}`}>
                  {/* ⭐ SLICE 2 — a change says so; an answer never does. */}
                  {t.updated && <span className={styles.updated} data-testid="create-indicator-updated">Updated preview</span>}
                  {(t.lines || []).map((l, i) => (
                    <span key={i} className={i === 0 ? styles.lead : undefined}>{l}</span>
                  ))}
                  {/* ⭐ What the assistant says it built: below the engine's words, and labelled as
                      the assistant's, never mixed into them (Studio plan, section 5). Plain text. */}
                  {typeof t.said === 'string' && t.said && (
                    <span className={styles.said} data-testid="create-indicator-said">
                      <span className={styles.saidLabel}>What the assistant says it built</span>
                      {t.said}
                    </span>
                  )}
                  {/* ⭐ AN OFFER — the one action this answer is about (add one of UCT's own built-in
                      indicators). One tap; the entry stops offering once it is settled. */}
                  {t.offer && (
                    <button type="button" className={styles.chip} data-testid="create-indicator-offer"
                      disabled={busy || saving} onClick={() => takeOffer(t)}>{t.offer.label}</button>
                  )}
                  {/* ⭐ A SCRIPT ANSWER — the lines above are the ENGINE's verdict. The script itself opens
                      in the script editor, where it is checked again, previewed and saved like any
                      pasted script. Nothing is put on the chart from here. */}
                  {t.script && typeof t.script.pine === 'string' && (
                    <span className={styles.said} data-testid="create-indicator-script" data-runs={t.script.runs ? 'true' : 'false'}>
                      {onOpenScript && (
                        <button type="button" className={styles.chip} data-testid="create-indicator-open-script"
                          disabled={busy || saving} onClick={() => onOpenScript({ pine: t.script.pine, name: t.script.name })}>
                          {t.script.runs ? 'Open this script' : 'Open this script to fix it'}
                        </button>
                      )}
                      <details data-testid="create-indicator-script-text">
                        <summary>The script the assistant wrote</summary>
                        <pre>{t.script.pine}</pre>
                      </details>
                    </span>
                  )}
                  {/* P3 UX — the engine's code, for support, behind the member sentence */}
                  {Array.isArray(t.details) && t.details.length > 0 && (
                    <details data-testid="create-indicator-error-detail">
                      <summary>Details for support</summary>
                      {t.details.map((d, i) => <div key={i}>{d}</div>)}
                    </details>
                  )}
                </li>
              )))}
          </ol>
        )}

        {hasChoices && (
          <div className={styles.examples} data-testid="create-indicator-choices">
            {conv.questions.flatMap((q) => (q.choices || []).map((c) => (
              <button key={`${q.id}:${c}`} type="button" className={styles.chip} disabled={busy} onClick={() => submit(c)}>{c}</button>
            )))}
          </div>
        )}

        {busy && <Working onStop={conv.stop} />}
        {/* ⭐ L8 — "SEND THIS TO UCT": offered only while the support loop's report door is on
            (`PINE_SUPPORT_REPORTS_ENABLED`) and once the member has said something. Nothing is
            sent from here: the press opens the dialog that shows what would be sent and asks. */}
        {!busy && reportsCfg && reportsCfg.reportsEnabled && hasSomethingToSend(transcript) && (
          <div className={styles.sendRow}>
            <button type="button" className={styles.sendLink} data-testid="create-indicator-send-to-uct"
              onClick={() => setSendOpen(true)}>Something not right? Send this conversation to UCT</button>
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      {state.working && (
        <section className={styles.card} data-testid="create-indicator-readback"
          data-status={rb.status} aria-label="Indicator summary">
          <div className={styles.cardHead}>
            {/* The FULL authored name (it wraps to two lines before it ever cuts);
                the title carries it whole wherever it does. */}
            <span className={styles.cardName} title={rb.name || undefined}
              data-testid="create-indicator-name">{rb.name || 'Untitled indicator'}</span>
            {/* "Updated preview" — a short cue on the summary, never on the chart.
                Re-keyed per applied change, so the CSS fade replays with no state.
                An answer, a question or a refusal never bumps it. */}
            {conv.changeSeq > 0 && (
              <span key={conv.changeSeq} className={styles.cue} data-testid="create-indicator-cue">Updated preview</span>
            )}
          </div>
          <div className={styles.section}>
            {rb.outputs.map((o) => (
              <div key={o.key} className={styles.formula} data-output={o.key}>
                <span className={styles.typeTag}>{typeWord(o.type)}</span>
                <span>{o.phrase || o.sentence || o.label}</span>
                {/* ⭐ PHASE 5 — a pending refusal is another symbol's bars still loading */}
                {o.status === 'refused' && !o.pending && <span className={styles.refused}> — {withoutGuardIds(o.reason)}</span>}
              </div>
            ))}
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Presentation</span>
            {look.plots.map((p) => (
              <div key={p.key} className={styles.detail}>
                {safeCssColour(p.color) && <span className={styles.swatch} style={{ background: safeCssColour(p.color) }} />}
                <span>{withoutGuardIds(p.text)}</span>
              </div>
            ))}
            {look.paints.map((l) => <div key={l} className={styles.detail}>{l}</div>)}
            <div className={styles.detail}>{look.placement}</div>
          </div>
          {/* ⭐ PHASE 5 — what it reads beyond this chart's own bars */}
          {(rb.otherSymbols || rb.calculationTimeframe) && (
            <div className={styles.section} data-testid="studio-data">
              <span className={styles.sectionLabel}>Data</span>
              {rb.otherSymbols && <div className={styles.detail}>{rb.otherSymbols}</div>}
              {rb.calculationTimeframe && <div className={styles.detail}>{rb.calculationTimeframe}</div>}
            </div>
          )}
          {(rb.alerts.length > 0 || rb.infoValues.length > 0) && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>{rb.alerts.length ? 'Alert' : 'Header'}</span>
              {[...rb.alerts, ...rb.infoValues].map((l) => <div key={l} className={styles.detail}>{l}</div>)}
            </div>
          )}
          {/* ⭐ SETTINGS (2026-11-17) — every length, level and multiple of the indicator, as a field.
              A change is the ordinary slot edit: the preview redraws and Undo takes it back. */}
          <SettingsFields settings={conv.settings} onSet={conv.setNumber} disabled={busy || saving} />
          {conv.needsAck.length > 0 && (
            <label className={styles.ack}>
              <input type="checkbox" checked={conv.acked} onChange={(e) => conv.setAcked(e.target.checked)}
                data-testid="create-indicator-ack" />
              {/* ⭐ S6 — the measured window, the same items the readback line states */}
              <span>{ackCheckboxText(rb.ack)}</span>
            </label>
          )}
        </section>
      )}

      {/* ⭐ SAID ONCE (2026-11-17). When the last thing in the conversation is the spent-allowance
          answer itself, this line would repeat it directly underneath; it returns as soon as that
          answer is no longer the last thing said. */}
      {allowanceLine(conv.allowanceLeft) && !spentJustSaid(transcript, conv.allowanceLeft) && (
        <p className={styles.allowance} data-testid="create-indicator-allowance" role="status">
          {allowanceLine(conv.allowanceLeft)}
        </p>
      )}
      <div className={styles.composer}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          value={message}
          disabled={saving || blocked}
          placeholder={editMode ? BOX_HINT.edit : (state.working ? BOX_HINT.working : BOX_HINT.fresh)}
          aria-label="Message the UCT Agent"
          data-testid="create-indicator-input"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
        />
        <button type="button" className={styles.gold} data-testid="create-indicator-send"
          disabled={busy || saving || blocked || !message.trim()} onClick={() => submit()}>Send</button>
      </div>

      {/* ⭐ V1 — HISTORY: every earlier step of this draft, newest first, each one press away.
          What a step WAS is the read-back's own sentence for that step. Nothing here saves:
          going back is a preview change like any other, and Undo-able in the sense that the
          steps before it are still listed. */}
      {historyOpen && historyAvailable && (
        <div className={styles.history} role="region"
          aria-label={hasSavedVersions ? 'Earlier steps of this draft and saved versions' : 'Earlier steps of this draft'}
          data-testid="create-indicator-history"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setHistoryOpen(false) } }}>
          <div className={styles.historyHead}>
            <span>{stepCount >= 2 ? 'Earlier steps' : 'Saved versions'}</span>
            <button type="button" className={styles.historyClose} aria-label="Close history"
              data-testid="create-indicator-history-close" onClick={() => setHistoryOpen(false)}>Close</button>
          </div>
          {stepCount >= 2 && (
          <ol className={styles.historyList} reversed>
            {[...conv.steps].reverse().map((st) => (
              <li key={st.index} className={styles.historyRow} data-testid="create-indicator-history-step"
                data-step={st.step}>
                <div className={styles.historyWhat}>
                  <span className={styles.historyStep}>Step {st.step}</span>
                  {st.empty
                    ? <span className={styles.historyLine}>Before anything was built</span>
                    : (st.lines.length ? st.lines : [st.name || 'Indicator']).map((l, i) => (
                      <span key={i} className={styles.historyLine}>{l}</span>))}
                </div>
                <button type="button" className={styles.ghost} disabled={!conv.canUndo}
                  data-testid="create-indicator-history-go"
                  onClick={() => { if (conv.goBackTo(st.index)) setHistoryOpen(false) }}>Go back to this</button>
              </li>
            ))}
          </ol>
          )}
          {/* ⭐ SAVED VERSIONS — what the store kept at each save, newest first. Using one makes it
              the draft again as ONE step (Undo takes it back); nothing is saved until Save changes.
              A version that cannot come back says why. */}
          {hasSavedVersions && (
            <div className={styles.historyVersions} data-testid="create-indicator-versions">
              {stepCount >= 2 && <div className={styles.historySub}>Saved versions</div>}
              {conv.savedVersionsError ? (
                <p className={styles.historyNote} role="alert" data-testid="create-indicator-versions-error">{conv.savedVersionsError}</p>
              ) : !conv.savedVersions ? (
                <p className={styles.historyNote} data-testid="create-indicator-versions-loading">Reading the saved versions…</p>
              ) : (
                <ul className={styles.historyList}>
                  {conv.savedVersions.map((v) => (
                    <li key={v.version} className={styles.historyRow} data-testid="create-indicator-version"
                      data-version={v.version} data-usable={v.usable ? 'yes' : 'no'}>
                      <div className={styles.historyWhat}>
                        <span className={styles.historyStep}>Version {v.version}{versionWhen(v.at) ? `, ${versionWhen(v.at)}` : ''}</span>
                        <span className={styles.historyLine}>{v.name}</span>
                        {(v.usable ? restoreNote(v.lines) : v.text) ? (
                          <span className={`${styles.historyLine} ${styles.historyWrap}`} data-testid="create-indicator-version-note">
                            {v.usable ? restoreNote(v.lines) : v.text}</span>
                        ) : null}
                      </div>
                      {v.usable && (
                        <button type="button" className={styles.ghost} disabled={busy || saving}
                          data-testid="create-indicator-version-use"
                          onClick={() => { if (conv.restoreVersion(v.version).ok) setHistoryOpen(false) }}>Use this version</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className={styles.foot}>
        <button type="button" className={styles.ghost} data-testid="create-indicator-undo"
          disabled={!conv.canUndo} onClick={conv.undo}>Undo</button>
        {historyAvailable && (
          <button type="button" className={styles.ghost} data-testid="create-indicator-history-toggle"
            aria-expanded={historyOpen} disabled={busy || saving || (!conv.canUndo && !hasSavedVersions)}
            onClick={() => setHistoryOpen((v) => !v)}>History</button>
        )}
        <span className={styles.footSpacer} />
        {editMode ? (
          <button type="button" className={styles.ghost} data-testid="create-indicator-cancel" onClick={askOrCancel}
            title={conv.dirty ? 'Discard your changes and close' : 'Close'}>{conv.dirty ? 'Discard' : 'Cancel'}</button>
        ) : (
          <button type="button" className={styles.ghost} data-testid="create-indicator-cancel" onClick={cancel}
            title={started ? 'Discard this draft and close' : 'Close'}>{started ? 'Discard' : 'Cancel'}</button>
        )}
        <button type="button" className={styles.gold} data-testid="create-indicator-save"
          disabled={!conv.canSave || (!onChange && !editMode)} onClick={save}>
          {editMode ? (saving ? 'Saving…' : 'Save changes') : (saving ? 'Adding…' : 'Add to Chart')}
        </button>
      </div>
    </aside>
  )

  const withSend = sendOpen ? (
    <>
      {panel}
      <Suspense fallback={null}>
        <SendConversationDialog open onClose={() => setSendOpen(false)} transcript={transcript}
          working={state.working} readbackLines={rb.lines} sym={sym} tf={tf}
          maxSourceBytes={reportsCfg ? reportsCfg.maxSourceBytes : undefined}
          maxNoteChars={reportsCfg ? reportsCfg.maxNoteChars : undefined} />
      </Suspense>
    </>
  ) : panel
  if (typeof document === 'undefined') return withSend
  return createPortal(withSend, dockHost || document.body)
}
