import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import {
  resolveEmbedRender, embedAutoCaption, countLiveEmbeds, LIVE_EMBEDS_PER_ENTRY,
  retimeChartParams, embedRenderHeight,
} from '../../lib/widgetEmbedCore'
import { captureElementPng, storeFallbackImage, kickSnapshotWarm } from '../../lib/embedArchive'
import styles from './WidgetEmbedView.module.css'

// How long a live embed gets to settle (bars fetched, chart painted) before
// the self-archive rasterizes it. A late capture is fine — a blank one isn't.
const ARCHIVE_SETTLE_MS = 3500
// The settle clock alone raced a still-painting chart (live finding: a
// re-capture fired ~4s after the embed scrolled into a cold session and
// archived a candle-less frame). The chart's zero-arg onBarsReady signal
// gates the capture; if it hasn't fired, re-check on this cadence, bounded.
const ARCHIVE_RETRY_MS = 2000
const ARCHIVE_MAX_RETRIES = 5

// The journal's widget-component bindings — which registry ids can mount LIVE
// inside a note, and with what renderer. Everything else renders its archived
// image. Lazy so opening a note with no live embeds never loads chart code.
const EMBED_COMPONENTS = {
  chart: lazy(() => import('./ChartEmbed')),
}

// The never-a-broken-embed rule, enforced at the React layer too: any render
// error inside a live embed drops the block to its archived image (or the
// labeled placeholder), never a crashed entry.
class EmbedErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function ArchivedImage({ attrs }) {
  return (
    <figure className={styles.archived}>
      <img
        className={styles.archivedImg}
        src={attrs.fallback.url}
        width={attrs.fallback.w || undefined}
        height={attrs.fallback.h || undefined}
        alt={embedAutoCaption(attrs)}
        loading="lazy"
      />
      <figcaption className={styles.archivedLabel}>
        archived snapshot · {embedAutoCaption(attrs)}
      </figcaption>
    </figure>
  )
}

function PlaceholderChip({ attrs, reason }) {
  return (
    <div className={styles.placeholder}>
      <span className={styles.placeholderLine}>{attrs.searchText || '[widget]'}</span>
      <span className={styles.placeholderWhy}>
        {reason === 'unknown-widget' ? 'widget type unavailable' : 'no archive yet'}
      </span>
    </div>
  )
}

export default function WidgetEmbedView({ node, selected, editor, updateAttributes, deleteNode }) {
  const attrs = node.attrs || {}
  const decision = resolveEmbedRender(attrs)
  const half = attrs.layout?.width === 'half'
  const bodyRef = useRef(null)
  const wrapRef = useRef(null)
  const archivedOnceRef = useRef(false)
  const [toolbarMsg, setToolbarMsg] = useState(null)

  // Screenshot-like proportions: with no explicit height, derive it from the
  // embed's own rendered width at ~the chart page's aspect. Track width via
  // ResizeObserver so Half/Full toggles and window resizes re-proportion.
  const [wrapWidth, setWrapWidth] = useState(0)
  // Chart-paint signal for the self-archive gate (zero-arg contract; carries
  // no data). Sticky within a mount: once bars have painted, later
  // re-captures in the same session need no wait.
  const barsReadyRef = useRef(false)
  const handleBarsReady = useCallback(() => { barsReadyRef.current = true }, [])
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (Number.isFinite(w) && w > 0) setWrapWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const height = embedRenderHeight(attrs.layout?.height, wrapWidth)

  // ── Below-the-fold laziness (Phase 6 #10, ~20-embeds/entry target) ────────
  // A live component only mounts once the block nears the viewport; until
  // then the archived image (or skeleton) holds its exact box. Once revealed
  // it STAYS mounted — no unmount thrash while scrolling. Environments
  // without IntersectionObserver (jsdom) render eagerly.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (inView || typeof IntersectionObserver === 'undefined') return undefined
    const el = wrapRef.current
    if (!el) { setInView(true); return undefined }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect() }
    }, { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  useEffect(() => {
    if (!toolbarMsg) return undefined
    const t = setTimeout(() => setToolbarMsg(null), 1800)
    return () => clearTimeout(t)
  }, [toolbarMsg])

  // ── Toolbar actions (owner spec Phase 5; explicit actions are the ONLY
  //    writes — scroll/zoom inside the chart never persist anything) ────────
  const toggleLive = () => {
    if (attrs.mode === 'live') {
      // Freezing an ANNOTATED live embed: the stored archive predates the
      // marks — clear it so self-archive re-freezes what's shown now,
      // drawings included. Unannotated freezes keep their archive (it still
      // matches the frozen params).
      const hasMarks = Array.isArray(attrs.annotations) && attrs.annotations.length > 0
      if (hasMarks) archivedOnceRef.current = false
      updateAttributes?.(hasMarks ? { mode: 'snapshot', fallback: null } : { mode: 'snapshot' })
      return
    }
    // Count over the live ProseMirror doc, not editor.getJSON(): getJSON
    // serializes the ENTIRE document (every embed dragging its multi-KB
    // frozen settings blob) just to count nodes — a main-thread hitch that
    // grows with note length, on every toolbar click. countLiveEmbeds stays
    // the JSON-shaped twin for callers that hold a doc JSON.
    let liveCount = 0
    if (editor?.state?.doc) {
      editor.state.doc.descendants((n) => {
        if (n.type.name === 'widgetEmbed' && n.attrs?.mode === 'live') liveCount += 1
        return true
      })
    } else {
      liveCount = countLiveEmbeds(editor?.getJSON?.() || {})
    }
    if (liveCount >= LIVE_EMBEDS_PER_ENTRY) {
      setToolbarMsg(`live cap: ${LIVE_EMBEDS_PER_ENTRY} per entry`)
      return
    }
    updateAttributes?.({ mode: 'live' })
  }
  const toggleWidth = () => {
    updateAttributes?.({ layout: { ...(attrs.layout || {}), width: half ? 'full' : 'half' } })
  }
  const recapture = () => {
    // Clearing the archive re-arms the self-archive effect: fresh settle,
    // fresh PNG, fresh upload — an explicit re-freeze of what's shown NOW.
    archivedOnceRef.current = false
    updateAttributes?.({ fallback: null, capturedAt: new Date().toISOString() })
    setToolbarMsg('re-capturing…')
  }
  // Timeframe switch (chart embeds; spec Phase 4): re-anchor around the SAME
  // CENTER at the new tf — never jump to now. Explicit toolbar action = the
  // only kind of write an embed takes. Native tfs only: custom multipliers
  // fall through both durability rails (no to=, no warm) by design.
  const switchTf = (newTf) => {
    const next = retimeChartParams(attrs, newTf)
    if (!next) return
    // Refuse a switch the render chain can't serve live (e.g. 1m beyond its
    // 60-day wall): the archive shows the OLD tf, so relabeling it would lie.
    if (resolveEmbedRender({ ...attrs, params: next.params }).kind !== 'live') {
      setToolbarMsg('no data that far back at that timeframe')
      return
    }
    // The old archive PNG shows the old tf — clear it so self-archive
    // re-freezes at the new one, and warm the new tf's history. The new tf's
    // bars haven't painted yet: reset the ready gate or the re-freeze could
    // rasterize the OLD tf mid-swap.
    archivedOnceRef.current = false
    barsReadyRef.current = false
    kickSnapshotWarm(next.params)
    updateAttributes?.({ params: next.params, searchText: next.searchText, fallback: null })
  }

  // ── Self-archive + capture-time warm (the durability pipeline) ────────────
  // A freshly-inserted snapshot has no archive yet: once the live render has
  // settled, rasterize the embed, upload through the note-image pipeline, and
  // patch fallback onto the node (autosave persists it). Fire the bars warm
  // immediately so the (symbol, tf) history lands in the forever-store.
  // Owner-editing sessions only (editor.isEditable) — a reader never uploads.
  // inView gates the archive too (review finding): below the fold the body
  // holds only the grey loading skeleton — rasterizing THAT would upload a
  // blank PNG as the permanent archive. The settle clock starts once the
  // live component is actually mounting.
  const needsArchive = decision.kind === 'live' && !attrs.fallback?.url && attrs.mode === 'snapshot' && inView
  useEffect(() => {
    if (!needsArchive || archivedOnceRef.current) return undefined
    archivedOnceRef.current = true
    // The warm needs no note context and the server rail is bounded/throttled
    // — fire it the moment a fresh snapshot mounts.
    kickSnapshotWarm(attrs.params)
    let timer = null
    let retries = 0
    const fire = async () => {
      // Don't rasterize a chart that hasn't painted its bars yet — the settle
      // clock alone once archived a candle-less frame (live finding). After
      // the retry budget, capture anyway: non-chart live embeds have no bars
      // signal, and a best-effort late frame beats no archive at all.
      if (!barsReadyRef.current && retries < ARCHIVE_MAX_RETRIES) {
        retries += 1
        timer = setTimeout(fire, ARCHIVE_RETRY_MS)
        return
      }
      // Resolve the gates HERE, after the settle window — node-view effects
      // can run before the page's onCreate stamps editor.storage, and gating
      // at effect time silently killed the archive on every mount.
      const noteId = editor?.storage?.uctJournalWidgets?.noteId
      if (!noteId || editor?.isEditable === false) {
        archivedOnceRef.current = false
        console.debug('[widget-embed] archive skipped (noteId=%s editable=%s)', noteId, editor?.isEditable)
        return
      }
      try {
        const blob = await captureElementPng(bodyRef.current)
        if (!blob) return
        const up = await storeFallbackImage(noteId, blob)
        updateAttributes?.({ fallback: { url: up.url, w: up.width || null, h: up.height || null } })
      } catch (e) {
        // Best-effort: the embed stays live; the next editing session retries.
        archivedOnceRef.current = false
        console.debug('[widget-embed] archive failed: %s', e?.message || e)
      }
    }
    timer = setTimeout(fire, ARCHIVE_SETTLE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsArchive, editor, inView])

  const archived = attrs.fallback?.url
    ? <ArchivedImage attrs={attrs} />
    : <PlaceholderChip attrs={attrs} reason={decision.reason} />

  // ── Per-embed annotations (drawings + text saved ON the snapshot) ────────
  // Draw mode mounts StockChart's controlled annotation toolbar inside the
  // embed; every add/edit/remove streams into attrs.annotations (autosave
  // persists), renders read-only on later opens, and never touches the
  // global /charts drawing store — frozen evidence stays frozen.
  const [annotate, setAnnotate] = useState(false)
  // Marks changed this draw session → the stored archive PNG no longer shows
  // what the reader sees. Cleared when the exit re-freeze fires.
  const annotationsDirtyRef = useRef(false)
  const handleAnnotationsChange = useCallback(
    (drawings) => {
      annotationsDirtyRef.current = true
      updateAttributes?.({ annotations: Array.isArray(drawings) ? drawings : [] })
    },
    [updateAttributes],
  )
  const toggleAnnotate = () => {
    const exiting = annotate
    setAnnotate(!annotate)
    // Done after changed marks: re-arm the self-archive so the fallback
    // re-freezes WITH the drawings — otherwise annotations exist only on the
    // live render path and vanish the day the embed degrades to its image.
    // Snapshot mode only: self-archive never runs for mode:'live' (clearing
    // there would orphan the archive); toggleLive's freeze re-freezes instead.
    if (exiting && annotationsDirtyRef.current) {
      annotationsDirtyRef.current = false
      if (attrs.mode === 'snapshot') recapture()
    }
  }

  let body = archived
  if (decision.kind === 'live') {
    const Live = EMBED_COMPONENTS[attrs.widgetId]
    body = !Live ? archived : !inView ? (
      <div className={styles.loading} style={{ height }} />
    ) : (
      <EmbedErrorBoundary fallback={archived}>
        <Suspense fallback={<div className={styles.loading} style={{ height }} />}>
          <Live
            attrs={attrs}
            height={height}
            annotate={annotate}
            onAnnotationsChange={annotate ? handleAnnotationsChange : null}
            onBarsReady={handleBarsReady}
          />
        </Suspense>
      </EmbedErrorBoundary>
    )
  }

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={`${styles.frame} ${half ? styles.half : styles.full} ${selected ? styles.selected : ''} ${annotate ? styles.annotating : ''}`}
      data-widget-embed-view={attrs.widgetId || 'unknown'}
    >
      {editor?.isEditable !== false && (
        <div className={styles.toolbar} contentEditable={false}>
          {toolbarMsg && <span className={styles.toolbarMsg}>{toolbarMsg}</span>}
          {/* TF switch — chart embeds, live render path only (the archive of
              an out-of-ceiling snapshot shows the OLD tf; switchTf refuses).
              Native tfs only — custom multipliers skip both durability rails.
              Draw mode collapses the toolbar to the lone Done button: the
              chart's own drawing toolbar owns the top strip (z 5–20, and it
              WIDENS once a mark exists), so everything else is unreachable
              anyway — and ✕ next to a drawing gesture is a destructive
              misclick (the 8/10 builder-sweep defect class). */}
          {!annotate && attrs.widgetId === 'chart' && decision.kind === 'live' && (
            <select
              className={styles.toolSelect}
              value={String(attrs.params?.tf ?? 'D')}
              onChange={(e) => switchTf(e.target.value)}
              title="Switch timeframe (re-anchors around the same moment)"
              aria-label="Embed timeframe"
            >
              {[['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'], ['60', '1h'],
                ['D', 'D'], ['W', 'W'], ['M', 'M']].map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
              ))}
            </select>
          )}
          {!annotate && (
            <button type="button" className={styles.toolBtn} onClick={toggleLive}
              title={attrs.mode === 'live' ? 'Freeze to snapshot' : `Go live (max ${LIVE_EMBEDS_PER_ENTRY}/entry)`}>
              {attrs.mode === 'live' ? 'Snapshot' : 'Live'}
            </button>
          )}
          {!annotate && (
            <button type="button" className={styles.toolBtn} onClick={toggleWidth}
              title={half ? 'Full width' : 'Half width (pair two side-by-side)'}>
              {half ? 'Full' : 'Half'}
            </button>
          )}
          {/* Draw mode — chart embeds on the live render path. Done exits;
              the marks are already persisted per-edit. */}
          {attrs.widgetId === 'chart' && decision.kind === 'live' && (
            <button
              type="button"
              className={`${styles.toolBtn} ${annotate ? styles.toolBtnActive : ''}`}
              onClick={toggleAnnotate}
              title={annotate ? 'Exit drawing mode' : 'Draw on this snapshot (lines, text — saved with the embed)'}
            >
              {annotate ? 'Done' : 'Draw'}
            </button>
          )}
          {/* Re-capture only where a NEW capture can actually happen — for
              image-only widget types the archive IS the capture, and clearing
              it would permanently destroy the only image with nothing to
              re-arm the pipeline (review finding: destructive control with no
              recovery, the 8/10 builder-sweep defect class). */}
          {!annotate && decision.kind === 'live' && (
            <button type="button" className={styles.toolBtn} onClick={recapture} title="Re-capture the archive image">
              Re-capture
            </button>
          )}
          {!annotate && (
            <button type="button" className={styles.toolBtn} onClick={() => deleteNode?.()} title="Remove embed">
              ✕
            </button>
          )}
        </div>
      )}
      {/* Explicit pixel height + inline-size containment: every workspace
          widget root is height:100% and several use @container queries — a
          content-sized notebook parent collapses them to zero without this. */}
      <div ref={bodyRef} className={styles.body} style={decision.kind === 'live' ? { height } : undefined}>
        {body}
      </div>
      {(attrs.mode === 'live') && <span className={styles.liveBadge}>LIVE</span>}
      {attrs.caption ? <div className={styles.caption}>{attrs.caption}</div> : null}
    </NodeViewWrapper>
  )
}
