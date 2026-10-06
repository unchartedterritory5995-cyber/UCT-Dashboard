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
import { presentationLines } from '../authoring'
import { converseTurn } from '../authoring/converseClient'
import useIndicatorConversation, { typeWord } from './useIndicatorConversation'
import { STUDIO_PREVIEW_DEF_ID, previewInstanceFor } from './chartPreview'
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
  const paints = presentationLines(def).filter((l) => /^(candles painted|background shaded|an imported)/.test(l))
  const placement = def.placement && def.placement.target === 'price' ? 'On the price chart' : 'In its own pane'
  return { plots, paints, placement }
}

/** Dock on the LEFT edge of the chart: the newest bars and the price axis stay visible. */
function useDockRect(anchorRef, open) {
  const [rect, setRect] = useState(null)
  useLayoutEffect(() => {
    if (!open) return undefined
    const measure = () => {
      const el = anchorRef && anchorRef.current
      const vh = window.innerHeight
      if (!el) { setRect({ top: INSET, left: INSET, height: vh - 2 * INSET }); return }
      const r = el.getBoundingClientRect()
      const top = Math.max(INSET, r.top + INSET)
      const bottom = Math.min(vh - INSET, r.bottom - INSET)
      const left = Math.max(INSET, Math.min(r.left + INSET, window.innerWidth - PANEL_W - INSET))
      setRect({ top, left, height: Math.max(360, bottom - top) })
    }
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
 */
export default function CreateIndicatorPanel({
  onClose, settings = null, onChange = null, sym = null, tf = null, anchorRef = null,
  onPreview, onOpenBuilder = null, onOpenLibrary = null, converse = converseTurn,
}) {
  const conv = useIndicatorConversation({ sym, tf, converse })
  const { state, transcript, rb, busy, saving, previewDefinition } = conv
  const [message, setMessage] = useState('')
  const rect = useDockRect(anchorRef, true)
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
      onPreviewRef.current?.(previewInstanceFor(settingsRef.current, engineRegistry))
    } else {
      engineRegistry.uninstallUserDefinition(STUDIO_PREVIEW_DEF_ID)
      onPreviewRef.current?.(null)
    }
  }, [previewDefinition])

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

  // The composer keeps focus across turns: it is never disabled while UCT builds
  // (only Send is), so a member can type the next refinement immediately.
  // ⚠️ One frame late on purpose: opening from Chart Settings closes that modal in
  // the same commit, and its focus-restore would otherwise win.
  useEffect(() => {
    if (busy) return undefined
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [busy])

  const submit = useCallback(async (text) => {
    const words = String(text ?? message).trim()
    if (!words || busy || saving) return
    setMessage('')
    await conv.send(words)
  }, [message, busy, saving, conv])

  const cancel = useCallback(() => { clearPreview(); onClose?.() }, [clearPreview, onClose])

  const save = useCallback(async () => {
    const res = await conv.save({ settings: settingsRef.current, onChange, beforeAttach: clearPreview })
    if (res.ok) onClose?.({ saved: res })
  }, [conv, onChange, clearPreview, onClose])

  const openDoor = useCallback((fn) => { clearPreview(); fn() }, [clearPreview])

  const look = useMemo(() => lookOf(state.working), [state.working])
  const started = transcript.length > 0 || !!state.working

  const panel = (
    <aside
      className={styles.panel}
      style={rect ? { top: rect.top, left: rect.left, height: rect.height } : { visibility: 'hidden' }}
      role="dialog"
      aria-modal="false"
      aria-label="Create Indicator"
      data-testid="create-indicator"
      data-lineage={state.lineage}
      data-revision={state.revision}
    >
      <header className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.title}>Create Indicator</span>
          <span className={styles.identity}>
            <UIcon name="ind-formula" size={11} gold={false} />
            UCT Intelligence
          </span>
        </div>
        <button type="button" className={styles.close} onClick={cancel} aria-label="Close Create Indicator"
          data-testid="create-indicator-close">✕</button>
      </header>

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

        {transcript.length > 0 && (
          <ol className={styles.log} data-testid="create-indicator-log" aria-live="polite">
            {transcript.map((t) => (t.role === 'member'
              ? <li key={t.id} className={styles.msgMember} data-role="member">{t.text}</li>
              : (
                <li key={t.id} data-role="uct" data-kind={t.kind}
                  className={`${styles.msgUct} ${t.kind === 'refusal' ? styles.msgRefusal : ''} ${t.kind === 'undo' ? styles.msgQuiet : ''}`}>
                  {(t.lines || []).map((l, i) => <span key={i} className={i === 0 ? styles.lead : undefined}>{l}</span>)}
                </li>
              )))}
          </ol>
        )}

        {conv.questions.some((q) => Array.isArray(q.choices) && q.choices.length) && (
          <div className={styles.examples} data-testid="create-indicator-choices">
            {conv.questions.flatMap((q) => (q.choices || []).map((c) => (
              <button key={`${q.id}:${c}`} type="button" className={styles.chip} disabled={busy} onClick={() => submit(c)}>{c}</button>
            )))}
          </div>
        )}

        {busy && <div className={styles.working} data-testid="create-indicator-working">UCT Intelligence is building</div>}
        <div ref={logEndRef} />
      </div>

      {state.working && (
        <section className={styles.card} data-testid="create-indicator-readback"
          data-status={rb.status} aria-label="Indicator summary">
          <div className={styles.cardHead}>
            <span className={styles.cardName}>{rb.name || 'Untitled indicator'}</span>
            {/* "Updated on chart" — a short cue on the summary, never on the chart.
                Re-keyed per applied change, so the CSS fade replays with no state. */}
            {conv.changeSeq > 0 && (
              <span key={conv.changeSeq} className={styles.cue} data-testid="create-indicator-cue">Updated on chart</span>
            )}
          </div>
          <div className={styles.section}>
            {rb.outputs.map((o) => (
              <div key={o.key} className={styles.formula} data-output={o.key}>
                <span className={styles.typeTag}>{typeWord(o.type)}</span>
                <span>{o.sentence || o.label}</span>
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
              <span>{conv.needsAck.join(', ')} reads a bar ahead and isn't final until more bars close.</span>
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
          disabled={saving}
          placeholder={state.working ? 'Refine it — e.g. "make it 50"' : 'Describe the indicator you want to build…'}
          aria-label="Message UCT Intelligence"
          data-testid="create-indicator-input"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          }}
        />
        <button type="button" className={styles.gold} data-testid="create-indicator-send"
          disabled={busy || saving || !message.trim()} onClick={() => submit()}>Send</button>
      </div>

      <div className={styles.foot}>
        <button type="button" className={styles.ghost} data-testid="create-indicator-undo"
          disabled={!conv.canUndo} onClick={conv.undo}>Undo</button>
        <span className={styles.footSpacer} />
        <button type="button" className={styles.ghost} data-testid="create-indicator-cancel" onClick={cancel}>Cancel</button>
        <button type="button" className={styles.gold} data-testid="create-indicator-save"
          disabled={!conv.canSave || !onChange} onClick={save}>
          {saving ? 'Adding…' : 'Add to Chart'}
        </button>
      </div>
    </aside>
  )

  return typeof document !== 'undefined' ? createPortal(panel, document.body) : panel
}
