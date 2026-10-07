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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../ui/UIcon'
import * as engineRegistry from '../../engine/nativeRegistry'
import { presentationLines, vocabularyLines } from '../authoring'
import { converseTurn } from '../authoring/converseClient'
import useIndicatorConversation, { typeWord } from './useIndicatorConversation'
import { STUDIO_PREVIEW_DEF_ID, previewInstanceFor, previewInstanceLike } from './chartPreview'
import { conversationEditability, CARRIED_NOTE } from '../authoring/memberWords'
import styles from './CreateIndicatorPanel.module.css'

const EXAMPLES = Object.freeze(['Add a 20 EMA', 'RSI overbought signal', 'Volume above its 50-day average'])
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
  const plots = (def.plots || []).filter((p) => p && p.style !== 'hlines').map((p) => {
    const color = resolveRef(def, p.color)
    if (p.hidden) return { key: p.key, text: `${p.label || p.key}: hidden`, color: null }
    if (p.style === 'markers' && p.marker) {
      return { key: p.key, color,
        text: `${SHAPE_WORDS[p.marker.shape] || p.marker.shape} ${POSITION_WORDS[p.marker.position] || ''}`.trim() }
    }
    const width = resolveRef(def, p.width)
    return { key: p.key, color, text: `${STYLE_WORDS[p.style || 'line'] || p.style}${Number.isFinite(Number(width)) ? ` · width ${width}` : ''}` }
  })
  // Paints keep the engine's own sentence (`presentationLines`), minus the plot
  // and placement lines rendered above.
  const paints = [...presentationLines(def).filter((l) => /^(candles painted|background shaded|an imported)/.test(l)),
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
export default function CreateIndicatorPanel({
  onClose, settings = null, onChange = null, sym = null, tf = null, anchorRef = null,
  onPreview, onOpenBuilder = null, onOpenLibrary = null, converse = converseTurn,
  dockHost = null, onDocked = null, sessionKey = null, editRow = null, onEditFormula = null,
}) {
  // ⭐ PHASE 4 — held once: the row this studio was opened on (a later list refresh
  // must not re-open it under the member's feet).
  const [open] = useState(() => (editRow && editRow.definition && editRow.def_id
    ? { def: editRow.definition, defId: editRow.def_id, version: Number(editRow.version) || 1 }
    : null))
  const editMode = !!open
  const editability = useMemo(() => (open ? conversationEditability(open.def) : null), [open])
  const blocked = !!(editability && !editability.editable)
  const conv = useIndicatorConversation({ sym, tf, converse, sessionKey, open })
  const { state, transcript, rb, busy, saving, previewDefinition } = conv
  const [message, setMessage] = useState('')
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
  useEffect(() => {
    if (!previewDefinition) {
      engineRegistry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID)
      onPreviewRef.current?.(null)
      return
    }
    const { installed } = engineRegistry.installUserDefinitions([previewDefinition])
    if (installed.length === 1) {
      // ⭐ PHASE 4 — an edit previews IN PLACE of the saved drawing, shaped like it.
      if (open) onPreviewRef.current?.(previewInstanceLike(settingsRef.current, open.defId, engineRegistry), { replaces: open.defId })
      else onPreviewRef.current?.(previewInstanceFor(settingsRef.current, engineRegistry))
    } else {
      engineRegistry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID)
      onPreviewRef.current?.(null)
    }
  }, [previewDefinition, open])

  // ⛔ THE TEARDOWN IS NOT OPTIONAL — Cancel, ✕, Save, a symbol-less remount and
  // an unmount of the chart itself all end here: no registry entry, no instance.
  const clearPreview = useCallback(() => {
    engineRegistry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID)
    onPreviewRef.current?.(null)
  }, [])
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

  const submit = useCallback(async (text) => {
    const words = String(text ?? message).trim()
    if (!words || busy || saving) return
    setMessage('')
    await conv.send(words)
  }, [message, busy, saving, conv])

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
  const askOrClose = useCallback(() => { if (editMode && conv.dirty) setConfirmLeave('close'); else close() }, [editMode, conv.dirty, close])
  const askOrCancel = useCallback(() => { if (editMode && conv.dirty) setConfirmLeave('discard'); else cancel() }, [editMode, conv.dirty, cancel])

  const save = useCallback(async () => {
    const res = await conv.save({ settings: settingsRef.current, onChange, beforeAttach: clearPreview })
    if (res.ok) onClose?.({ saved: res })
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
            UCT Intelligence
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
            {editability.text}
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
          <div className={styles.status} data-testid="create-indicator-restored">
            Draft restored — Discard throws it away.
          </div>
        )}

        {transcript.length > 0 && (
          <ol className={styles.log} data-testid="create-indicator-log" aria-live="polite">
            {transcript.map((t) => (t.role === 'member'
              ? <li key={t.id} className={styles.msgMember} data-role="member">{t.text}</li>
              : (
                <li key={t.id} data-role="uct" data-kind={t.kind} data-updated={t.updated ? 'true' : undefined}
                  className={`${styles.msgUct} ${t.kind === 'refusal' ? styles.msgRefusal : ''} ${t.kind === 'unsupported' ? styles.msgLimit : ''} ${t.kind === 'answer' ? styles.msgAnswer : ''} ${t.kind === 'undo' ? styles.msgQuiet : ''}`}>
                  {/* ⭐ SLICE 2 — a change says so; an answer never does. */}
                  {t.updated && <span className={styles.updated} data-testid="create-indicator-updated">Updated preview</span>}
                  {(t.lines || []).map((l, i) => (
                    <span key={i} className={i === 0 ? styles.lead : undefined}>{l}</span>
                  ))}
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

        {busy && <div className={styles.working} data-testid="create-indicator-working">UCT Intelligence is thinking</div>}
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
                {o.status === 'refused' && <span className={styles.refused}> — {o.reason}</span>}
              </div>
            ))}
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Presentation</span>
            {look.plots.map((p) => (
              <div key={p.key} className={styles.detail}>
                {p.color && <span className={styles.swatch} style={{ background: p.color }} />}
                <span>{p.text}</span>
              </div>
            ))}
            {look.paints.map((l) => <div key={l} className={styles.detail}>{l}</div>)}
            <div className={styles.detail}>{look.placement}</div>
          </div>
          {(rb.alerts.length > 0 || rb.infoValues.length > 0) && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>{rb.alerts.length ? 'Alert' : 'Header'}</span>
              {[...rb.alerts, ...rb.infoValues].map((l) => <div key={l} className={styles.detail}>{l}</div>)}
            </div>
          )}
          {conv.needsAck.length > 0 && (
            <label className={styles.ack}>
              <input type="checkbox" checked={conv.acked} onChange={(e) => conv.setAcked(e.target.checked)}
                data-testid="create-indicator-ack" />
              <span>{conv.needsAck.map((k) => (rb.outputs.find((o) => o.key === k) || {}).name || k).join(', ')} reads a bar ahead and isn't final until more bars close.</span>
            </label>
          )}
        </section>
      )}

      <div className={styles.composer}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          value={message}
          disabled={saving || blocked}
          placeholder={editMode ? 'Describe a change — e.g. "make it 21" or "make the line gold"'
            : (state.working ? 'Refine it — e.g. "make it 50"' : 'Describe the indicator you want to build…')}
          aria-label="Message UCT Intelligence"
          data-testid="create-indicator-input"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
        />
        <button type="button" className={styles.gold} data-testid="create-indicator-send"
          disabled={busy || saving || blocked || !message.trim()} onClick={() => submit()}>Send</button>
      </div>

      <div className={styles.foot}>
        <button type="button" className={styles.ghost} data-testid="create-indicator-undo"
          disabled={!conv.canUndo} onClick={conv.undo}>Undo</button>
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

  if (typeof document === 'undefined') return panel
  return createPortal(panel, dockHost || document.body)
}
