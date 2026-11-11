// app/src/components/chart/IndicatorSettingsDialog.jsx
//
// ─── SPEC §6's SETTINGS FORM, SCOPED TO ONE *INSTANCE* ──────────────────────
//
// "RSI settings…" opened the GLOBAL five-tab modal (Price Style / Canvas /
// Indicators / Header / Markers) — a chart-wide surface reached from a menu row
// that named one indicator. Spec §6 asks for a THREE-tab form over ONE instance:
// Inputs / Style / Visibility, live-applied, Cancel-rollable, 250 ms debounced,
// clamped where the user can see the clamp.
//
// ⛔ THE GENERATOR IS NOT REWRITTEN. Every control below comes from
// `fieldsForInstance`, which is `fieldsFromDefinition` (the call the global
// modal's Indicators tab already makes) resolved against ONE instance's inputs.
// A second generator would be a second answer to "what controls does RSI have",
// which is the defect the whole indicator platform exists to retire.
//
// ⛔ AND IT IS NOT A CONTROL DOOR. Every write routes at `instanceControls` —
// `setInstanceInput` for a declared input, `setInstanceHidden` for the eye,
// `withInstances` for the placement target — the same module the toolbar
// checkbox, both right-click doors, the four chords and the generated settings
// rows share. A refused write returns the settings object BY IDENTITY and this
// file skips `onChange`, so nothing persists.
//
// ⛔ PERSISTS ONLY INSIDE `indicatorInstances[]`. `mergeChartSettings`
// (`chartDefaults.js:336`) is a hard allow-list whose return literal DESTROYS an
// undeclared top-level key — the mechanism that deleted `engineEnabled` at seven
// sites. And `mergeSettingsOverride`'s instance branch (`instanceShape.js:71`) is
// a SHALLOW spread with `inputs` the only deep-merged child, so a nested object
// added to an instance is replaced wholesale by a grid-cell override. Nothing
// here adds a top-level key or a nested object: `inputs` is the deep-merged
// child, `hidden` is a scalar and `placement` is written in the same
// `{target}` shape `addInstance` already writes.
//
// 🔴 THE PIXEL GATE CANNOT SEE ANY OF THIS. `ChartRender.jsx:527` injects
// `#chart-export [class*="legend" i]{display:none !important}` into the only
// route `tools/chart_parity.py` photographs, and that route mounts no dialog and
// clicks nothing. A total regression of this file reports 0 changed pixels on
// all 46 cases. The gate is `IndicatorSettingsDialog.test.jsx` — in particular
// the byte-equality rollback, which carries a positive control proving the edit
// was observable BEFORE it proves Cancel undid it.
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useId, useSyncExternalStore } from 'react'
import Sheet from '../mobile/Sheet'
import ColorPicker, { PORTAL_POPUP_ATTR } from './ColorPicker'
import { effectiveColourFor } from './engine/pool'
import { fieldsForInstance, evalActiveWhen, timeInputText, timeInputMs,
         sectionize, initialCollapsed, INLINE_MAX,
         visiblePresets, textInputCommit, textInputDraft } from './indicatorRegistry'
// ⭐ UCT RS Phase 3, unit 3-02 — what the LIVE server row declares, so a
// `requiresServer` control, option or preset stays hidden until it can answer.
import { serverDeclares, subscribeServerDefinitions } from './engine/serverCompute'
import { findInstance, setInstanceInput, setInstanceHidden,
         setInstanceDisplayTarget, applyPresetInputs, setInstanceDotSize,
         presetsOf, detectPreset, CUSTOM_PRESET, dotPlotsOf, DOT_SIZE_OPTIONS,
         instanceDotSizeReading, DOT_SIZE_MIXED,
         saveInstanceAsDefault, resetInstanceToUctDefault, memberDefaultState,
         withIndicatorDefaultsOf } from './engine/instanceControls'
import { memberDefaultNote, saveDefaultIsNoop, SAVE_DEFAULT_LABEL, RESET_DEFAULT_LABEL } from './memberDefaultCopy'
// ⭐ 2a-12 — the preset readers moved into the engine (`presetsOf`, `detectPreset`,
// `CUSTOM_PRESET`) so this dialog and the phone sheet read ONE copy. The id is
// re-exported here for the callers that always imported it from the dialog.
export { CUSTOM_PRESET } from './engine/instanceControls'
import { PLACEMENT_TARGETS, isSessionString } from './engine/defSchema'
import { chipsFrom } from './engine/readout'
import styles from './IndicatorSettingsDialog.module.css'

/** Spec §6's debounced recompute window. Exported so the tests wait on the
 *  system's number rather than on a copy of it. */
export const DEBOUNCE_MS = 250

/** §6: `inline` packs up to THREE same-type controls onto one row; a fourth wraps.
 *  ⭐ 2a-15 — the number is the REGISTRY's (`indicatorRegistry.INLINE_MAX`), where
 *  `sectionize` / `packRows` / `initialCollapsed` moved at unit 2a-11 so this
 *  dialog and the phone sheet read ONE grouping rule. Re-exported so a caller
 *  that read it off the dialog still can. */
export { INLINE_MAX }

const TABS = Object.freeze([
  ['inputs', 'Inputs'],
  ['style', 'Style'],
  ['visibility', 'Visibility'],
])

/** The three targets `validateInstance` accepts, read from the schema's own
 *  frozen vocabulary so a target added there reaches this control without an
 *  edit here — and one that is NOT in it can never be offered. */
const MOVE_TARGETS = PLACEMENT_TARGETS
const MOVE_LABELS = { price: 'Price pane (over the candles)', pane: 'Its own pane', volume: 'Volume pane' }

const EMPTY_SERIES_DATA = new Map()
/** `chipsFrom` needs a truthy `series` handle to look up; it finds nothing in an
 *  empty map and falls through to `lastValue`, which is what makes it usable as
 *  a pure formatter here. */
const SERIES_SENTINEL = Object.freeze({ __previewOnly: true })

/**
 * The chip facts for this instance, READ FROM THE ONE FORMATTING PIPELINE.
 *
 * ⭐ `readout.chipsFrom` is called — not re-implemented. It is the same function
 * the crosshair readout and the persistent legend strip call, so the name this
 * dialog shows and the number of decimals it reports cannot drift from the chip
 * the user is looking at. Task 2 set those decimals per definition (obv 0;
 * mfi/cci/williamsR/adx 1; bb/vwap/avwap/donchian/atrBands 2), and this reads
 * them rather than carrying a second table.
 */
function chipFacts(def, instanceId, values, registry) {
  if (!def) return null
  const entries = (Array.isArray(def.plots) ? def.plots : []).map((p) => ({
    defId: def.id, plotKey: p && p.key, series: SERIES_SENTINEL, lastValue: 0, instanceId,
  }))
  let chips = []
  try { chips = chipsFrom(entries, EMPTY_SERIES_DATA, registry, () => values) } catch { chips = [] }
  return chips[0] || null
}

// ⭐ 2a-15 — `packRows` (a run of consecutive same-type fields sharing an `inline`
// name, chunked at `INLINE_MAX`) and `sectionize` (sections by declared `group`,
// first-appearance order, a headerless section for the ungrouped) were this
// file's until unit 2a-11 lifted them, byte for byte in effect, into
// `indicatorRegistry.js`. The registry's `sectionize(def, fields)` packs each
// section's rows itself (`section.rows`, the shape this file called
// `section.items`) and reads `meta.groupsCollapsed` through `initialCollapsed`.

export default function IndicatorSettingsDialog({ open, instanceId, settings, onChange, onClose, registry, sheetClassName = '' }) {
  const uid = useId()
  const rootRef = useRef(null)
  const [tab, setTab] = useState('inputs')
  const [draft, setDraft] = useState({})
  const [notes, setNotes] = useState({})
  const [collapsed, setCollapsed] = useState({})

  // ⭐ SNAPSHOT ON OPEN — the whole of Cancel-rollback.
  //
  // Taken ONCE, on the transition to open, never on every render: a snapshot
  // refreshed while the user types is a snapshot of their edits, and Cancel would
  // "restore" them. The test that proves this proves the EDIT WAS OBSERVABLE
  // FIRST, then that Cancel restores byte-for-byte — without that positive
  // control a dialog that wrote nothing at all would pass the rollback assertion.
  const snapshotRef = useRef(null)
  useEffect(() => {
    if (open && !snapshotRef.current) snapshotRef.current = settings
    if (!open) snapshotRef.current = null
  }, [open, settings])

  // The blob the writes chain from. Assigned during render so a flush that
  // commits two keys builds the second on top of the first rather than on a
  // prop the parent has not re-rendered yet.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const instance = open ? findInstance(settings, instanceId) : null
  const def = useMemo(() => {
    if (!instance || !registry) return null
    return typeof registry.getDefinition === 'function' ? registry.getDefinition(instance.defId) : null
  }, [instance, registry])

  // ⭐ 3-02 — the server gate. Only a `server` definition can carry a gate
  // (`defSchema.validateServerGates`), so only one asks: opening RSI's settings
  // never spends the page's one definitions GET. The snapshot is memoised and
  // frozen per definition, so it is reference-stable between landings.
  const gateId = def && def.compute && def.compute.kind === 'server' ? def.id : null
  const declared = useSyncExternalStore(
    subscribeServerDefinitions,
    () => (gateId ? serverDeclares(gateId) : null),
    () => null,
  )

  const model = useMemo(
    () => (def && instance ? fieldsForInstance(def, instance, { declared }) : { values: {}, all: [], inputs: [], style: [] }),
    [def, instance, declared],
  )

  // The values the FORM is showing: the stored ones with the user's uncommitted
  // draft over them. `activeWhen` reads these, so a control governed by another
  // wakes on the keystroke rather than 250 ms later.
  const shown = useMemo(() => {
    const out = { ...model.values }
    for (const f of model.all) {
      if (!Object.prototype.hasOwnProperty.call(draft, f.key)) continue
      const raw = draft[f.key]
      if (f.type === 'number') {
        const n = Number(raw)
        out[f.key] = Number.isFinite(n) ? n : model.values[f.key]
      } else if (f.type === 'text') {
        // ⭐ 3-02 — a text draft governs only once it is a value the input accepts:
        // a half-typed ticker must not flip the preset to Custom or wake a row.
        const c = textInputCommit(f, raw)
        out[f.key] = c.ok ? c.value : model.values[f.key]
      } else {
        out[f.key] = raw
      }
    }
    return out
  }, [model, draft])

  // ── the debounced write ───────────────────────────────────────────────────
  //
  // ONE window per burst: the timer is NOT restarted by each keystroke, so a
  // continuous typer gets a bounded write rate instead of nothing until they
  // stop. Which is precisely why the callback MUST read the pending value from a
  // REF and not from the closure it was scheduled with — closing over the value
  // commits the FIRST keystroke of the burst and discards the rest.
  // `feedback_tiptap_onupdate_stale_closure` is the recorded version of that bug
  // in this repo.
  const pendingRef = useRef(new Map())
  const timerRef = useRef(null)
  const flushRef = useRef(() => {})

  flushRef.current = () => {
    const pending = pendingRef.current
    if (!pending.size) return
    let next = settingsRef.current
    for (const [key, value] of pending) next = setInstanceInput(next, instanceId, key, value, registry)
    pending.clear()
    // Identity, not deep equality: `setInstanceInput` returns `cs` itself when it
    // refuses, and persisting a refused write would mark the preset custom for a
    // keystroke that changed nothing.
    if (next !== settingsRef.current) {
      settingsRef.current = next
      onChangeRef.current?.(next)
    }
  }

  const schedule = useCallback((key, value) => {
    pendingRef.current.set(key, value)
    if (timerRef.current) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      flushRef.current()          // ⭐ the ref, never the closure
    }, DEBOUNCE_MS)
  }, [])

  const flushNow = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    flushRef.current()
  }, [])

  const discardPending = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    pendingRef.current.clear()
  }, [])

  // Reset per open / per instance, and never leave a timer behind.
  useEffect(() => {
    if (!open) { discardPending(); setDraft({}); setNotes({}); setTab('inputs') }
  }, [open, discardPending])
  useEffect(() => { setDraft({}); setNotes({}) }, [instanceId])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // ── numeric commit on blur / Enter, WITH A VISIBLE CLAMP ──────────────────
  //
  // `setInstanceInput` REFUSES an out-of-range value (`validateInputValue`), so
  // without the clamp the box keeps the number the user typed and the chart keeps
  // the old one — a control that looks like it worked and did not. Clamping
  // silently is the mirror defect: the chart changes to a number the user never
  // asked for and nothing says so. Both halves ship: the clamped value is written
  // BACK INTO THE CONTROL, and the row announces the bound it hit.
  const commitNumber = useCallback((field) => {
    const raw = draft[field.key]
    if (raw === undefined) return
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n)) {
      // Not a number at all: restore what is stored rather than committing NaN.
      setDraft((d) => { const { [field.key]: _drop, ...rest } = d; return rest })
      setNotes((s) => ({ ...s, [field.key]: null }))
      return
    }
    let v = field.isInt ? Math.round(n) : n
    let note = null
    if (Number.isFinite(field.min) && v < field.min) { v = field.min; note = `Minimum is ${field.min}` }
    if (Number.isFinite(field.max) && v > field.max) { v = field.max; note = `Maximum is ${field.max}` }
    setDraft((d) => ({ ...d, [field.key]: String(v) }))
    setNotes((s) => ({ ...s, [field.key]: note }))
    pendingRef.current.set(field.key, v)
    flushNow()
  }, [draft, flushNow])

  const onNumberKeyDown = useCallback((e, field) => {
    if (e.key === 'Enter') { e.preventDefault(); commitNumber(field) }
  }, [commitNumber])

  // ⭐ PHASE 3 WS-D — a SESSION commits only a session (`defSchema.isSessionString`). A typed
  // value that is not one is put back to what is stored, and the row says what a session reads
  // like — the number field's visible-clamp rule, for text.
  const commitSession = useCallback((field) => {
    const raw = draft[field.key]
    if (raw === undefined) return
    if (!isSessionString(raw)) {
      setDraft((d) => { const { [field.key]: _drop, ...rest } = d; return rest })
      setNotes((s) => ({ ...s, [field.key]: 'A session reads HHMM-HHMM, for example 0930-1600 or 0930-1600:23456' }))
      return
    }
    setNotes((s) => ({ ...s, [field.key]: null }))
    pendingRef.current.set(field.key, raw)
    flushNow()
  }, [draft, flushNow])

  // ⭐ UCT RS Phase 3, unit 3-02 — a TEXT box commits on Enter or blur, and only a
  // value the input accepts (`textInputCommit`: trimmed, upper-cased when the
  // input says so, then the engine's own `validateInputValue`). A miss writes
  // NOTHING: the typed text stays in the box so it can be fixed, the box is
  // `aria-invalid`, and a muted line under it says what reads (the input's own
  // `hint`). The note is an OBJECT, so every place that clears notes (a preset, a
  // reset, a new instance, a close) clears the miss with them.
  const commitText = useCallback((field) => {
    const raw = draft[field.key]
    if (raw === undefined) return
    const c = textInputCommit(field, raw)
    if (!c.ok) {
      setNotes((s) => ({ ...s, [field.key]: { miss: c.hint } }))
      return
    }
    setDraft((d) => { const { [field.key]: _drop, ...rest } = d; return rest })
    setNotes((s) => ({ ...s, [field.key]: null }))
    const stored = model.values[field.key]
    if (c.value === (stored === undefined ? '' : stored)) return
    pendingRef.current.set(field.key, c.value)
    flushNow()
  }, [draft, flushNow, model])

  // ── the instance-level writes (Visibility) ────────────────────────────────
  const writeSettings = useCallback((next) => {
    if (!next || next === settingsRef.current) return
    settingsRef.current = next
    onChangeRef.current?.(next)
  }, [])

  const setHidden = useCallback((hidden) => {
    writeSettings(setInstanceHidden(settingsRef.current, instanceId, hidden, registry))
  }, [instanceId, registry, writeSettings])

  // ⚰️⚰️ THE THIRD WRITER, AND IT WAS HAND-ROLLED (2026-09-15). "Move to" wrote
  // `placement.target` straight onto the instance: no return-to-default delete, no
  // legacy `volumeOverlayIndicators` mirror, and — once intent became a stored
  // fact — no provenance marker. So the same gesture meant one thing in Chart Data
  // and another here, and a member moving `close` to its own pane from THIS dialog
  // produced a marker-less restatement the resolver would go on ignoring.
  //
  // ⛔ `setInstanceDisplayTarget` IS THE ONE WRITER. Chart Data
  // (`ChartSettingsIndicators`), the on-chart chip menu (`StockChart`) and this
  // dialog now all go through it, which is what makes "the destination a control
  // NAMES and the pane the series LANDS IN cannot disagree" true across surfaces
  // rather than on one of them.
  const setTarget = useCallback((target) => {
    writeSettings(setInstanceDisplayTarget(settingsRef.current, instanceId, target, registry))
  }, [instanceId, registry, writeSettings])

  // ⭐ 2a-12 — DOT SIZE, the Style tab's one control that is not an input. It writes
  // the instance level (every dot output of this copy) through `setInstanceDotSize`,
  // the writer the Chart Data row and the `setDotSize` agent op share; "Default"
  // DELETES the key, so a copy nobody resized stores nothing. ⚠️ It lives in
  // `presentation`, the nested object the Inspector's Plot style already writes —
  // the same grid-cell-override caveat as that control, and no new one.
  const setDotSize = useCallback((size) => {
    writeSettings(setInstanceDotSize(settingsRef.current, instanceId, size, registry))
  }, [instanceId, registry, writeSettings])

  // ── the preset picker (generic: `def.meta.presets`) ───────────────────────
  //
  // Rendered only when the definition declares presets. A preset is a named set
  // of input values; choosing one applies EVERY key through `applyPresetInputs`,
  // which is a loop over `setInstanceInput` — the same door every row above
  // writes through — so the snapshot-on-open Cancel rollback undoes it like any
  // other edit. "Which preset is this" is DERIVED from the shown values
  // (`detectPreset`); nothing is stored on the instance.
  //
  // `pickedPresetId` remembers the preset the member last chose or the form last
  // matched, so "Reset to preset" has a target after a tweak flips the select to
  // Custom. It is dialog-local UI state, reset per open and per instance.
  // ⭐ 3-02 — through `visiblePresets`: a `requiresServer` preset, or one that
  // sets a hidden gated input or option, is not listed until the server declares it.
  const presets = useMemo(() => {
    const shownPresets = new Set(visiblePresets(def, declared))
    return presetsOf(def).filter((p) => shownPresets.has(p))
  }, [def, declared])
  // ⭐ 2a-12 — the instance rides along, so a preset that also declares a dot size,
  // a visibility or a display target is "current" only while the instance carries
  // them; a Dot size change away from the preset's word reads as Custom.
  const currentPreset = useMemo(
    () => detectPreset(presets, shown, { instance, def, cs: settings }),
    [presets, shown, instance, def, settings],
  )
  const [pickedPresetId, setPickedPresetId] = useState(null)
  // ⛔ ORDER MATTERS: effects run in declaration order, so the two RESETS come
  // first and the "remember the match" effect last. Reversed, a mount that
  // matches a preset remembers it and then forgets it in the same commit, and
  // Reset is dead until the member changes something twice.
  useEffect(() => { if (!open) setPickedPresetId(null) }, [open])
  useEffect(() => { setPickedPresetId(null) }, [instanceId])
  useEffect(() => { if (currentPreset) setPickedPresetId(currentPreset.id) }, [currentPreset])

  const applyPreset = useCallback((preset) => {
    if (!preset || !def) return
    // A pending keystroke on a key the preset also sets would re-apply itself
    // 250 ms after the preset — commit what is pending FIRST, then the preset
    // writes over it, and the draft for those keys is cleared so the form shows
    // the preset's values rather than the stale text.
    flushNow()
    const keys = Object.keys(preset.inputs)
    setDraft((d) => { const out = { ...d }; for (const k of keys) delete out[k]; return out })
    setNotes((s) => { const out = { ...s }; for (const k of keys) out[k] = null; return out })
    setPickedPresetId(preset.id)
    // (the `rs_preset` count was retired with the presets, RS split U9)
    writeSettings(applyPresetInputs(settingsRef.current, instanceId, def, preset, registry))
  }, [def, instanceId, registry, flushNow, writeSettings])

  const onPresetSelect = useCallback((e) => {
    const id = e.target.value
    if (id === CUSTOM_PRESET) return
    applyPreset(presets.find((p) => p.id === id))
  }, [presets, applyPreset])

  // ── ⭐ VA2 (UCT RS §17.8) — "Save as my default" / "Reset to UCT default" ──
  //
  // Generic: every shipped indicator with a savable input (`canSaveAsDefault`).
  // The saved default lives in `cs.indicatorDefaults` and is read only when a NEW
  // copy is built, so saving never moves a line already on a chart.
  //
  // ⛔ CANCEL DOES NOT UNDO A SAVED DEFAULT. Cancel restores the snapshot taken at
  // open; a member who pressed "Save as my default" and then Cancel meant to keep
  // the default and drop the edits, so the defaults key is carried onto the
  // snapshot the moment it changes. The copy's own inputs stay cancellable.
  const defaultState = memberDefaultState(settings, instance, def)
  const writeDefaults = useCallback((next) => {
    if (!next || next === settingsRef.current) return
    if (snapshotRef.current) snapshotRef.current = withIndicatorDefaultsOf(snapshotRef.current, next)
    settingsRef.current = next
    onChangeRef.current?.(next)
  }, [])
  const saveDefault = useCallback(() => {
    flushNow()
    writeDefaults(saveInstanceAsDefault(settingsRef.current, instanceId, registry))
  }, [flushNow, writeDefaults, instanceId, registry])
  const resetToUct = useCallback(() => {
    discardPending()
    setDraft({})
    setNotes({})
    writeDefaults(resetInstanceToUctDefault(settingsRef.current, instanceId, registry))
  }, [discardPending, writeDefaults, instanceId, registry])

  const resetPreset = useCallback(() => {
    const target = currentPreset || presets.find((p) => p.id === pickedPresetId) || null
    applyPreset(target)
  }, [currentPreset, presets, pickedPresetId, applyPreset])

  // ── close paths ───────────────────────────────────────────────────────────
  //
  // Escape, the × and Done all KEEP the edit — live-apply means it is already
  // applied — so a pending keystroke is flushed rather than dropped. Only Cancel
  // rolls back, and it discards the pending write first: a timer that fires after
  // the rollback would re-apply the very edit that was just undone.
  const handleDone = useCallback(() => { flushNow(); onClose?.() }, [flushNow, onClose])
  const handleCancel = useCallback(() => {
    discardPending()
    const snap = snapshotRef.current
    if (snap && snap !== settingsRef.current) {
      settingsRef.current = snap
      onChangeRef.current?.(snap)
    }
    onClose?.()
  }, [discardPending, onClose])

  // ── focus trap ────────────────────────────────────────────────────────────
  //
  // ⚰️ THERE IS NO TRAP HERE ANY MORE, AND THAT IS THE FIX. This dialog rolled
  // its own because `Sheet` shipped none; `Sheet` gained a real one on
  // 2026-09-01 (nesting-aware, computed over the whole `[data-sheet-panel]`),
  // and this body renders INSIDE that panel — so the copy was a second
  // authority computing the same ring, and the two selectors had already
  // diverged (`[href]` vs `a[href]`, and only `Sheet`'s skips hidden nodes).
  // The wrap lives in `components/mobile/useFocusTrap.js`; `Sheet` consumes it.
  //
  // The rail is this file's own "Tab from the last control returns to the
  // first" case, which is mutation-checked against `trapTabKey`: no-op the
  // shared wrap and it goes red, which is what proves `Sheet` is doing the
  // trapping rather than nothing at all.

  const chip = useMemo(
    () => chipFacts(def, instanceId, shown, registry),
    [def, instanceId, shown, registry],
  )

  // ── THE BODY REMEMBERS THE TALLEST TAB IT HAS SHOWN ───────────────────────
  //
  // `Sheet` centres the panel, so a tab whose content is taller moves the TAB
  // STRIP and the footer out from under the pointer. The CSS floor in
  // `.module.css` levels the tabs that come in UNDER it; it cannot level one that
  // comes in over.
  //
  // ⚰️ MEASURED ON PRODUCTION 2026-08-15 — Ichimoku is the worst case, because its
  // Style tab carries five colour rows (tenkan, kijun, spanA, spanB, chikou):
  //
  //     tab          rows   panel h
  //     Inputs       3      404.5
  //     Style        5      519.5
  //     Visibility   2      404.5
  //
  // …which is 57.6px of tab-strip travel, worse than the 45.3px MACD case the CSS
  // floor was measured against.
  //
  // This grows a floor to the tallest body seen for THIS instance and never
  // shrinks it, so the panel settles after the first visit to the tallest tab and
  // every switch after that is motionless. ⚠️ It does NOT remove that first jump —
  // the only way to do that is to render all three panes at once and take the max,
  // which changes the `role="tabpanel"` structure this dialog's suites are written
  // against. Named rather than quietly half-done.
  //
  // ⛔ Reset per OPEN and per INSTANCE. A floor carried from a five-row Ichimoku
  // into a one-row RSI would leave the next dialog padded with empty space.
  const bodyRef = useRef(null)
  const [bodyFloor, setBodyFloor] = useState(0)
  useEffect(() => { setBodyFloor(0) }, [instanceId, open])
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    // `scrollHeight` already accounts for the floor in effect, so this is
    // monotonic by construction and cannot oscillate.
    const h = el.scrollHeight
    setBodyFloor((m) => (h > m ? h : m))
  }, [tab, model, instance, chip])

  if (!open || !instance || !def) return null

  const title = `${chip?.label || def.meta?.shortName || def.id} settings`
  const panelId = `${uid}-panel`

  const renderField = (field, inPack) => {
    const active = evalActiveWhen(field.activeWhen, shown)
    const id = `${uid}-${field.key}`
    const labelId = `${id}-lbl`
    const tipId = field.tooltip ? `${id}-tip` : null
    const value = Object.prototype.hasOwnProperty.call(draft, field.key) ? draft[field.key] : model.values[field.key]
    const rawNote = notes[field.key]
    // ⭐ 3-02 — a text box's miss is `{miss}`; every other note is a sentence.
    const miss = rawNote && typeof rawNote === 'object' ? rawNote.miss : null
    const note = rawNote && typeof rawNote === 'object' ? null : rawNote
    const missId = miss ? `${id}-miss` : null
    const aria = {
      id,
      'aria-labelledby': labelId,
      ...(tipId ? { 'aria-describedby': tipId } : null),
      // ⛔ `activeWhen` DIMS, NEVER REMOVES. A control that vanishes teaches the
      // user it does not exist; one that is visibly inert teaches them what to
      // change first. `aria-disabled` alongside `disabled` so the reason reaches
      // assistive tech, which a bare `disabled` attribute does not carry.
      disabled: !active,
      'aria-disabled': String(!active),
    }
    return (
      <div className={styles.row} data-input-key={field.key} key={field.key}>
        {/* ⛔ THE TOOLTIP IS A SIBLING OF THE LABEL, NEVER A CHILD OF IT. Nested,
            it joins the label's text and every control's ACCESSIBLE NAME becomes
            "Period How many bars" — the description read out as part of the name,
            on every control that has one. It is `aria-describedby`'s job. */}
        <label className={`${styles.label} ${active ? '' : styles.labelOff}`} id={labelId} htmlFor={id}>
          {field.label}
        </label>
        <span className={styles.control}>
          {field.type === 'number' && (
            <input
              type="number" className={styles.num} {...aria}
              min={field.min} max={field.max} step={field.step}
              value={value ?? ''}
              onChange={(e) => {
                setDraft((d) => ({ ...d, [field.key]: e.target.value }))
                const n = Number(e.target.value)
                // Only a value the definition would ACCEPT is scheduled; anything
                // out of range waits for the blur/Enter commit, which clamps it
                // where the user can see the clamp.
                if (Number.isFinite(n)
                    && !(Number.isFinite(field.min) && n < field.min)
                    && !(Number.isFinite(field.max) && n > field.max)) {
                  schedule(field.key, field.isInt ? Math.round(n) : n)
                }
              }}
              onBlur={() => commitNumber(field)}
              onKeyDown={(e) => onNumberKeyDown(e, field)}
            />
          )}
          {field.type === 'select' && (
            <select
              className={styles.sel} {...aria}
              value={value ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                const opt = (field.options || []).find(([v]) => String(v) === raw)
                const val = opt ? opt[0] : raw
                setDraft((d) => ({ ...d, [field.key]: val }))
                pendingRef.current.set(field.key, val)
                flushNow()
              }}
            >
              {/* ⭐ 3-02 — a third element `{disabled: true}` is a STORED gated value the
                  live server does not declare: shown, so the select tells the truth,
                  and not choosable (`fieldsForInstance`). */}
              {(field.options || []).map(([v, l, extra]) => (
                <option key={String(v)} value={v} disabled={!!(extra && extra.disabled)}>{l}</option>
              ))}
            </select>
          )}
          {field.type === 'datetime' && (
            // ⭐ PHASE 3 WS-D — a Pine `input.time`: one date-and-time control, read and
            // written in UTC (the instant the script compares `time` against), labelled so.
            <>
              <input
                type="datetime-local" step="60" className={styles.when} {...aria}
                value={timeInputText(value)}
                onChange={(e) => {
                  const ms = timeInputMs(e.target.value)
                  if (ms === null) return
                  setDraft((d) => ({ ...d, [field.key]: ms }))
                  schedule(field.key, ms)
                }}
              />
              <span className={styles.unit} aria-hidden="true">UTC</span>
            </>
          )}
          {field.type === 'session' && (
            <input
              type="text" inputMode="numeric" spellCheck={false} className={styles.when} {...aria}
              placeholder="0930-1600"
              value={value ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                setDraft((d) => ({ ...d, [field.key]: raw }))
                if (isSessionString(raw)) schedule(field.key, raw)
              }}
              onBlur={() => commitSession(field)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitSession(field) } }}
            />
          )}
          {field.type === 'text' && (
            // ⭐ UCT RS Phase 3, unit 3-02 — the generic text box (a `string` input).
            <input
              type="text" className={styles.text} {...aria}
              aria-describedby={[tipId, missId].filter(Boolean).join(' ') || undefined}
              aria-invalid={miss ? 'true' : undefined}
              placeholder={field.placeholder}
              maxLength={Number.isInteger(field.maxLength) ? field.maxLength : undefined}
              autoCapitalize={field.case === 'upper' ? 'characters' : undefined}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              value={value ?? ''}
              onChange={(e) => {
                const text = textInputDraft(field, e.target.value)
                setDraft((d) => ({ ...d, [field.key]: text }))
                // a miss clears the moment the text reads right, never sooner
                if (miss && textInputCommit(field, text).ok) setNotes((s) => ({ ...s, [field.key]: null }))
              }}
              onBlur={() => commitText(field)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(field) } }}
            />
          )}
          {field.type === 'toggle' && (
            <button
              type="button" role="switch" {...aria}
              aria-checked={value !== false}
              className={`${styles.toggle} ${value !== false ? styles.toggleOn : ''}`}
              onClick={() => {
                const val = value === false
                setDraft((d) => ({ ...d, [field.key]: val }))
                pendingRef.current.set(field.key, val)
                flushNow()
              }}
            ><span className={styles.toggleKnob} /></button>
          )}
          {field.type === 'color' && (
            // ⚠️ `ColorPicker` is a SHIPPED component this task does not own and it
            // accepts no aria props, so its swatch takes its accessible name from
            // `title`. A tooltip therefore cannot become its `aria-describedby` —
            // it is rendered as visible row text above instead, which every user
            // can read. Named rather than quietly dropped.
            <ColorPicker
              // ⭐⭐ COLOUR + OPACITY for a PINE script's colour: a pick is the whole
              // colour, alpha included, as TradingView's style colour is. A native
              // indicator keeps the plain picker (its `opacity` is its own multiplier).
              withOpacity={!!(def && def.meta && def.meta.recurrenceOrigin === 'pine')}
              // ⭐ the EFFECTIVE colour: an old-shape default shows its stored alpha
              value={effectiveColourFor(def, field.key, value)} title={field.label} disabled={!active}
              onChange={(hex) => { setDraft((d) => ({ ...d, [field.key]: hex })); schedule(field.key, hex) }}
            />
          )}
        </span>
        {field.tooltip && <span className={styles.tip} id={tipId}>{field.tooltip}</span>}
        {note && <span className={styles.note} role="status">{note}</span>}
        {miss && <span className={styles.textMiss} id={missId} role="status">{miss}</span>}
        {inPack ? null : null}
      </div>
    )
  }

  // `meta.groupsCollapsed` names the groups that START collapsed (plan §6.3). It
  // is a default, not a lock: `collapsed` holds only the member's own toggles,
  // and a group they have not touched reads the definition's hint. Everything
  // else — a group not named, a definition with no hint — opens as before.
  //
  // ⛔ THE HINT IS THE INPUTS TAB'S (§6.3, "Settings dialog: Inputs tab"). A
  // colour input shares its group name with the inputs beside it, so the same
  // set applied on the Style tab (§6.4, the plot-referenced colours and widths)
  // would open that tab with EVERY control folded away — for UCT RS the Style tab
  // holds nothing but the two hinted groups. Style groups start expanded.
  const startsCollapsed = initialCollapsed(def)

  const renderFields = (fields, { hint = false } = {}) => sectionize(def, fields).map((section, si) => {
    const gid = `${uid}-g${si}`
    const ckey = section.group || `__${si}`
    const isOpen = Object.prototype.hasOwnProperty.call(collapsed, ckey)
      ? !collapsed[ckey]
      : !(hint && section.group && startsCollapsed.has(section.group))
    const body = section.rows.map((item, ii) => (
      item.kind === 'row'
        ? renderField(item.field, false)
        : (
          <div className={styles.inlinePack} data-inline-group={item.inline} key={`${gid}-p${ii}`}>
            {item.fields.map((f) => renderField(f, true))}
          </div>
        )
    ))
    if (!section.group) return <div className={styles.group} key={gid}>{body}</div>
    return (
      <div className={styles.group} key={gid}>
        <button
          type="button" className={styles.groupHead}
          aria-expanded={isOpen} aria-controls={`${gid}-body`}
          onClick={() => setCollapsed((c) => ({ ...c, [section.group]: isOpen }))}
        >{section.group}</button>
        {isOpen && <div id={`${gid}-body`}>{body}</div>}
      </div>
    )
  })

  const placementTarget = instance.placement?.target || def.placement?.target || MOVE_TARGETS[0]
  // ⭐ 2a-12 — the Dot size control's facts: which outputs draw dots (none ⇒ no
  // control) and the word every dot draws at (nothing stored ⇒ "Default").
  // ⭐ U8 #11 (2026-11-07): "Mixed" while a per-dot size (Stress's Large
  // before-price dot) disagrees with the instance level, so the control never
  // says Default over a Large dot, and any word chosen is a real change (the
  // writer then deletes the per-dot sizes).
  const dotPlots = dotPlotsOf(def)
  const dotSize = instanceDotSizeReading(instance, def)

  return (
    <Sheet open={open} onClose={handleDone} variant="auto" title={title} maxWidth={520} className={sheetClassName}>
      {/* The portal exemption — `ColorPicker`'s popup portals to <body>, and the
          toolbar's close-on-outside-mousedown would otherwise close the panel
          underneath on the very click that picks a colour. */}
      <div
        ref={rootRef} className={styles.root}
        {...{ [PORTAL_POPUP_ATTR]: 'indicator-settings' }}
      >
        {presets.length > 0 && (
          <div className={styles.presetBar} data-testid="preset-picker">
            <div className={styles.presetRow}>
              <label className={styles.presetLabel} id={`${uid}-preset-lbl`} htmlFor={`${uid}-preset`}>
                Preset
              </label>
              <span className={styles.presetControls}>
                <select
                  className={styles.sel} id={`${uid}-preset`}
                  aria-labelledby={`${uid}-preset-lbl`}
                  aria-describedby={currentPreset && currentPreset.origin ? `${uid}-preset-origin` : undefined}
                  value={currentPreset ? currentPreset.id : CUSTOM_PRESET}
                  onChange={onPresetSelect}
                >
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  <option value={CUSTOM_PRESET}>Custom</option>
                </select>
                <button
                  type="button" className={styles.presetBtn}
                  onClick={resetPreset}
                  disabled={!currentPreset && !presets.some((p) => p.id === pickedPresetId)}
                >Reset to preset</button>
              </span>
            </div>
            {currentPreset && currentPreset.origin && (
              <span className={styles.presetOrigin} id={`${uid}-preset-origin`} data-testid="preset-origin">
                {currentPreset.origin}
              </span>
            )}
          </div>
        )}

        <div className={styles.tabs} role="tablist" aria-label="Indicator settings">
          {TABS.map(([key, label]) => (
            <button
              key={key} type="button" role="tab" id={`${uid}-tab-${key}`}
              aria-selected={tab === key} aria-controls={panelId}
              className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
              onClick={() => setTab(key)}
            >{label}</button>
          ))}
        </div>

        <div
          ref={bodyRef} className={styles.body} role="tabpanel" id={panelId}
          aria-labelledby={`${uid}-tab-${tab}`}
          style={bodyFloor ? { minHeight: bodyFloor } : undefined}
        >
          {tab === 'inputs' && (
            model.inputs.length
              ? renderFields(model.inputs, { hint: true })
              : <div className={styles.empty}>This indicator declares no computed inputs.</div>
          )}

          {tab === 'style' && (<>
            {model.style.length
              ? renderFields(model.style)
              : (dotPlots.length ? null : <div className={styles.empty}>This indicator declares no styled inputs.</div>)}
            {dotPlots.length > 0 && (
              // ⭐ 2a-12 — shown only for a definition that draws dots (a `markers`
              // output or a series `marker` glyph). One control for the copy: the
              // three words `storedDotSize` reads, "Default" = the declared radius.
              <div className={styles.group} data-style-group="dots">
                <div className={styles.row} data-style-key="dotSize">
                  <label className={styles.label} id={`${uid}-dot-lbl`} htmlFor={`${uid}-dot`}>
                    Dot size
                  </label>
                  <span className={styles.control}>
                    <select
                      className={styles.sel} id={`${uid}-dot`}
                      aria-labelledby={`${uid}-dot-lbl`} aria-describedby={`${uid}-dot-tip`}
                      value={dotSize}
                      onChange={(e) => setDotSize(e.target.value)}
                    >
                      {dotSize === DOT_SIZE_MIXED && <option value={DOT_SIZE_MIXED} disabled>Mixed</option>}
                      {DOT_SIZE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </span>
                  <span className={styles.tip} id={`${uid}-dot-tip`}>
                    How large this copy&apos;s dots draw. Default keeps the size the indicator declares.
                  </span>
                </div>
              </div>
            )}
            <div className={styles.chipBox}>
              <div className={styles.chipRow}>
                <span className={styles.chipKey}>Legend chip</span>
                <span className={styles.chipVal} data-testid="chip-name">{chip?.label ?? '—'}</span>
              </div>
              <div className={styles.chipRow}>
                <span className={styles.chipKey}>Precision</span>
                <span className={styles.chipVal} data-testid="chip-precision">
                  {chip ? String(chip.decimals) : '—'}
                </span>
              </div>
              {/* ⛔ READ-ONLY, AND THE REASON IS THE POINT. `readout.chipsFrom`
                  reads `plot.legend.decimals` off the DEFINITION; there is no
                  per-instance store for it, and adding one would mean a nested
                  `legend` object on the instance that a grid-cell override
                  replaces wholesale (`instanceShape.js:71`) plus a change to
                  `readout.js`, which this task does not own. A box that wrote
                  nowhere would be worse than no box: "a control that appears and
                  writes nowhere is a support ticket with no answer in it". */}
              <div className={styles.why} data-testid="chip-precision-why">
                Precision is declared by the indicator, not per copy of it — every
                copy of this indicator prints the same number of decimals.
              </div>
            </div>
          </>)}

          {tab === 'visibility' && (
            <div className={styles.group}>
              {/* §6 marked this tab "deferred to C". The honest v1 content is the
                  two visibility facts the INSTANCE already carries. Per-timeframe
                  visibility is deliberately absent: it would need `meta.timeframes`
                  semantics no instance stores, and inventing them here would be a
                  control with nothing behind it. */}
              <div className={styles.row} data-visibility-key="hidden">
                <label className={styles.label} id={`${uid}-vis-lbl`} htmlFor={`${uid}-vis`}>
                  Visible on the chart
                </label>
                <span className={styles.control}>
                  <button
                    type="button" role="switch" id={`${uid}-vis`}
                    aria-labelledby={`${uid}-vis-lbl`} aria-describedby={`${uid}-vis-tip`}
                    aria-checked={instance.hidden !== true}
                    className={`${styles.toggle} ${instance.hidden !== true ? styles.toggleOn : ''}`}
                    onClick={() => setHidden(instance.hidden !== true)}
                  ><span className={styles.toggleKnob} /></button>
                </span>
                <span className={styles.tip} id={`${uid}-vis-tip`}>
                  Hiding removes this copy from the chart and keeps its settings.
                </span>
              </div>
              <div className={styles.row} data-visibility-key="placement">
                <label className={styles.label} id={`${uid}-mv-lbl`} htmlFor={`${uid}-mv`}>
                  Move to
                </label>
                <span className={styles.control}>
                  <select
                    className={styles.sel} id={`${uid}-mv`}
                    aria-labelledby={`${uid}-mv-lbl`} aria-describedby={`${uid}-mv-tip`}
                    value={placementTarget}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    {MOVE_TARGETS.map((t) => <option key={t} value={t}>{MOVE_LABELS[t] || t}</option>)}
                  </select>
                </span>
                <span className={styles.tip} id={`${uid}-mv-tip`}>
                  Copies of one indicator share a pane and a scale, so moving one moves both.
                </span>
              </div>
            </div>
          )}
        </div>

        {defaultState.available && (
          // ⭐ VA2 — the member's default for NEW copies of this indicator. Both
          // buttons always render; each is disabled when it would change nothing,
          // and the line under them says what a new copy will start with.
          <div className={styles.defaults} data-testid="my-default">
            <div className={styles.defaultsRow}>
              <button
                type="button" className={styles.presetBtn} data-testid="save-default"
                onClick={saveDefault}
                disabled={saveDefaultIsNoop(defaultState)}
              >{SAVE_DEFAULT_LABEL}</button>
              <button
                type="button" className={styles.presetBtn} data-testid="reset-default"
                onClick={resetToUct}
                disabled={defaultState.atUct}
              >{RESET_DEFAULT_LABEL}</button>
            </div>
            <span className={styles.defaultsNote} data-testid="my-default-note" role="status">
              {memberDefaultNote(defaultState)}
            </span>
          </div>
        )}

        <div className={styles.foot}>
          <button type="button" className={styles.btn} onClick={handleCancel}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleDone}>Done</button>
        </div>
      </div>
    </Sheet>
  )
}
