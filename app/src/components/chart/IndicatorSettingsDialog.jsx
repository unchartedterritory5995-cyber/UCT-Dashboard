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
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useId } from 'react'
import Sheet from '../mobile/Sheet'
import ColorPicker, { PORTAL_POPUP_ATTR } from './ColorPicker'
import { fieldsForInstance, evalActiveWhen } from './indicatorRegistry'
import { findInstance, setInstanceInput, setInstanceHidden, withInstances } from './engine/instanceControls'
import { PLACEMENT_TARGETS } from './engine/defSchema'
import { chipsFrom } from './engine/readout'
import styles from './IndicatorSettingsDialog.module.css'

/** Spec §6's debounced recompute window. Exported so the tests wait on the
 *  system's number rather than on a copy of it. */
export const DEBOUNCE_MS = 250

/** §6: `inline` packs up to THREE same-type controls onto one row; a fourth wraps. */
export const INLINE_MAX = 3

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

/** A group of consecutive same-type fields sharing an `inline` name, chunked at
 *  `INLINE_MAX`. Anything else is its own row. Layout only — every field that
 *  arrives here leaves here. */
function packRows(fields) {
  const out = []
  let i = 0
  while (i < fields.length) {
    const f = fields[i]
    if (!f.inline) { out.push({ kind: 'row', field: f }); i += 1; continue }
    let j = i + 1
    while (j < fields.length && fields[j].inline === f.inline && fields[j].type === f.type) j += 1
    for (let k = i; k < j; k += INLINE_MAX) {
      out.push({ kind: 'pack', inline: f.inline, fields: fields.slice(k, Math.min(k + INLINE_MAX, j)) })
    }
    i = j
  }
  return out
}

/** Sections by declared `group`, in first-appearance order. Ungrouped fields keep
 *  a headerless section so a definition that declares no group renders exactly
 *  what it did before groups existed. */
function sectionize(fields) {
  const order = []
  const byGroup = new Map()
  for (const f of fields) {
    const g = f.group || null
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g) }
    byGroup.get(g).push(f)
  }
  return order.map((g) => ({ group: g, items: packRows(byGroup.get(g)) }))
}

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),'
  + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function IndicatorSettingsDialog({ open, instanceId, settings, onChange, onClose, registry }) {
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

  const model = useMemo(
    () => (def && instance ? fieldsForInstance(def, instance) : { values: {}, all: [], inputs: [], style: [] }),
    [def, instance],
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

  // ── the instance-level writes (Visibility) ────────────────────────────────
  const writeSettings = useCallback((next) => {
    if (!next || next === settingsRef.current) return
    settingsRef.current = next
    onChangeRef.current?.(next)
  }, [])

  const setHidden = useCallback((hidden) => {
    writeSettings(setInstanceHidden(settingsRef.current, instanceId, hidden, registry))
  }, [instanceId, registry, writeSettings])

  const setTarget = useCallback((target) => {
    const cs = settingsRef.current
    const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
    if (!list.some((i) => i && i.instanceId === instanceId)) return
    // `placement` is written in EXACTLY the shape `addInstance`/`setIndicatorEnabled`
    // already write (`{target}`) — no new nested object, so allow-list #2's shallow
    // instance spread has nothing new to replace wholesale.
    const next = list.map((i) => (i && i.instanceId === instanceId
      ? { ...i, placement: { ...(i.placement || {}), target } }
      : i))
    writeSettings(withInstances(cs, next, registry))
  }, [instanceId, registry, writeSettings])

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
  // ⚠️ `Sheet` does NOT ship one. It focuses the panel on open, handles Escape,
  // locks body scroll and restores focus on close — but nothing stops Tab walking
  // out of the modal into the page behind it. The trap is this dialog's, and it
  // is computed over the whole `[role="dialog"]` panel so the Sheet's own close
  // button is inside it rather than a leak on the first Shift+Tab.
  //
  // ⛔ AND IT IS BOUND TO THE PANEL, NOT TO THIS SUBTREE. `Sheet`'s header — and
  // its × button, which is the FIRST focusable in the ring — is a SIBLING of the
  // body this component renders into, so a React `onKeyDown` here never sees the
  // Shift+Tab that leaks out of the modal from the very element the ring starts
  // at. Measured: the forward wrap passed and the backward one walked to `body`.
  const trapTab = useCallback((e) => {
    if (e.key !== 'Tab') return
    const panel = rootRef.current?.closest('[role="dialog"]') || rootRef.current
    if (!panel) return
    const items = [...panel.querySelectorAll(FOCUSABLE)]
    if (items.length < 2) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // Focus sitting on the PANEL itself is the normal state right after open —
    // `Sheet` focuses it on an rAF — and it is not in `items` (tabindex="-1").
    // Tab from there must enter the trap, not walk out of the modal.
    if (items.indexOf(active) === -1) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }, [])

  const trapRef = useRef(trapTab)
  trapRef.current = trapTab
  const trapMounted = !!(open && instance && def)
  useEffect(() => {
    if (!trapMounted) return undefined
    const panel = rootRef.current?.closest('[role="dialog"]')
    if (!panel) return undefined
    const h = (e) => trapRef.current(e)
    panel.addEventListener('keydown', h)
    return () => panel.removeEventListener('keydown', h)
  }, [trapMounted])

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
    const note = notes[field.key]
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
              {(field.options || []).map(([v, l]) => <option key={String(v)} value={v}>{l}</option>)}
            </select>
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
              value={value} title={field.label} disabled={!active}
              onChange={(hex) => { setDraft((d) => ({ ...d, [field.key]: hex })); schedule(field.key, hex) }}
            />
          )}
        </span>
        {field.tooltip && <span className={styles.tip} id={tipId}>{field.tooltip}</span>}
        {note && <span className={styles.note} role="status">{note}</span>}
        {inPack ? null : null}
      </div>
    )
  }

  const renderFields = (fields) => sectionize(fields).map((section, si) => {
    const gid = `${uid}-g${si}`
    const isOpen = !collapsed[section.group || `__${si}`]
    const body = section.items.map((item, ii) => (
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

  return (
    <Sheet open={open} onClose={handleDone} variant="auto" title={title} maxWidth={520}>
      {/* The portal exemption — `ColorPicker`'s popup portals to <body>, and the
          toolbar's close-on-outside-mousedown would otherwise close the panel
          underneath on the very click that picks a colour. */}
      <div
        ref={rootRef} className={styles.root}
        {...{ [PORTAL_POPUP_ATTR]: 'indicator-settings' }}
      >
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
              ? renderFields(model.inputs)
              : <div className={styles.empty}>This indicator declares no computed inputs.</div>
          )}

          {tab === 'style' && (<>
            {model.style.length
              ? renderFields(model.style)
              : <div className={styles.empty}>This indicator declares no styled inputs.</div>}
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

        <div className={styles.foot}>
          <button type="button" className={styles.btn} onClick={handleCancel}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleDone}>Done</button>
        </div>
      </div>
    </Sheet>
  )
}
