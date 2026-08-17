import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import {
  resolveEmbedRender, embedAutoCaption, countLiveEmbeds, LIVE_EMBEDS_PER_ENTRY,
  retimeChartParams, embedRenderHeight, makeCrosshairBus,
} from '../../lib/widgetEmbedCore'
import { widgetMeta } from '../../../../widgets/registry'
import { chartsLinkPath } from '../../../../lib/chartDeepLink'
import { captureElementPng, storeFallbackImage, kickSnapshotWarm } from '../../lib/embedArchive'
import { RENDER_UNAVAILABLE, showsUnavailableFrame } from '../../../../lib/captureSafety'
import UIcon from '../../../../components/ui/UIcon'
import styles from './WidgetEmbedView.module.css'

// Free-resize bounds (px). MAX_W is generous so a resize can reach the full
// note-column width on wide screens; `.sized { max-width: 100% }` keeps it
// responsive (never wider than the column).
const EMBED_MIN_W = 260
const EMBED_MAX_W = 3200
const EMBED_MIN_H = 160
const EMBED_MAX_H = 1400

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
// ⚠️ A registry entry flipped reconstructable WITHOUT a binding here degrades
// to its archive (never crashes) — flip both together.
const EMBED_COMPONENTS = {
  chart: lazy(() => import('./ChartEmbed')),
  calendar: lazy(() => import('./CalendarEmbed')),
  aisearch: lazy(() => import('./AiSearchEmbed')),
  fundamentals: lazy(() => import('./FundamentalsEmbed')),
  news: lazy(() => import('./NewsEmbed')),
  breadth: lazy(() => import('./BreadthEmbed')),
  alerts: lazy(() => import('./AlertsEmbed')),
  scanner: lazy(() => import('./ScannerEmbed')),
  watchlist: lazy(() => import('./WatchlistEmbed')),
  themes: lazy(() => import('./ThemesEmbed')),
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

// ⭐ EVERY "this is NOT the live widget" frame carries RENDER_UNAVAILABLE, and
// the self-archive refuses to rasterize a body that contains one. Without it the
// archive pipeline will happily freeze the placeholder chip / grey skeleton /
// archived-image-of-an-image as the permanent evidence PNG — which is exactly
// what a double-clicked Re-capture did on 2026-08-16: the second click cleared
// `fallback` while the live chart was still re-settling, the sticky
// `barsReadyRef` meant the bars gate was already satisfied, and the settle
// timer rasterized "[chart: AMD D] · snapshot image not captured yet" over a
// real chart. A marker on the markup (not a guess at component state) is what
// makes that structurally impossible.
//
// ⚠️ This is NOT a duplicate of embedArchive's `canvasesLookPainted` probe, and
// the two must not be collapsed. That one asks "are this widget's canvases
// blank?" and FAILS OPEN (a late frame beats no archive) — and a placeholder
// has no canvases at all, so `sized.length === 0` returns "painted" and it
// waves the chip straight through. This one asks "is this the widget at all?"
// and FAILS CLOSED. Different question, opposite default, both needed.
//
// The mark is SHARED with the widgets themselves (lib/captureSafety): StockChart
// stamps it on its own "Failed to load chart" / empty-range / skeleton frames,
// which live INSIDE the live component and therefore look nothing like an embed
// fallback from out here. Same question — "are these pixels the artifact?" —
// so the same attribute and one selector, never a second string to keep in sync.

function ArchivedImage({ attrs }) {
  return (
    <figure className={styles.archived} {...RENDER_UNAVAILABLE}>
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
    <div className={styles.placeholder} {...RENDER_UNAVAILABLE}>
      <span className={styles.placeholderLine}>{attrs.searchText || '[widget]'}</span>
      <span className={styles.placeholderWhy}>
        {reason === 'unknown-widget' ? 'widget type unavailable' : 'snapshot image not captured yet'}
      </span>
    </div>
  )
}

export default function WidgetEmbedView({ node, selected, editor, updateAttributes, deleteNode }) {
  const attrs = node.attrs || {}
  const decision = resolveEmbedRender(attrs)
  const half = attrs.layout?.width === 'half'
  // Frozen-to-image: render the captured PNG at the embed's own size instead of
  // the live chart (no toolbar, still resizable).
  const frozen = !!attrs.frozen
  // An explicit pixel width (from the corner handle) wins over the full/half
  // breakout system; number = free-sized, string ('full'|'half') = preset.
  const sizedWidth = typeof attrs.layout?.width === 'number' ? attrs.layout.width : null
  const bodyRef = useRef(null)
  const wrapRef = useRef(null)
  const chartRef = useRef(null)          // ChartEmbed imperative handle (openSettings)
  const attrsRef = useRef(attrs)
  attrsRef.current = attrs
  const archivedOnceRef = useRef(false)
  const [toolbarMsg, setToolbarMsg] = useState(null)
  // Toolbar collapse toggle (per the charts "Hide toolbar" affordance).
  const [toolbarOpen, setToolbarOpen] = useState(true)
  const [resizing, setResizing] = useState(false)

  // Public share page (SharedNotePage stamps shareView before the editor
  // view exists): every embed renders its ARCHIVED IMAGE — a public reader
  // never mounts live components that poll auth-scoped APIs. The durable
  // image IS the shared artifact.
  const shareView = !!editor?.storage?.uctJournalWidgets?.shareView

  // Linked crosshair (spec Phase 6 #6): ONE bus per note, shared by every
  // chart embed through editor.storage. Lazily created by the first embed
  // that renders — the page's onCreate can run after node views mount, so
  // stamping it there (the noteId pattern) would hand early mounts a null
  // they never re-read. No bus on the share page (nothing live to link).
  let crosshairBus = editor?.storage?.uctJournalWidgets?.crosshairBus || null
  if (!crosshairBus && !shareView && editor?.storage) {
    crosshairBus = makeCrosshairBus()
    editor.storage.uctJournalWidgets = {
      ...(editor.storage.uctJournalWidgets || {}), crosshairBus,
    }
  }

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
    setPeek(false) // mode changes make the peek moot (live already tracks now)
    if (attrs.mode === 'live') {
      // Freezing an ANNOTATED live embed: the stored archive predates the
      // marks — clear it so self-archive re-freezes what's shown now,
      // drawings included. Unannotated freezes keep their archive (it still
      // matches the frozen params). ⛔ Only clear when the frozen params can
      // still RENDER live: past a re-render ceiling the self-archive never
      // re-arms, and clearing would destroy the only image with nothing to
      // replace it — the same destructive class the Re-capture gate exists
      // for (panel finding: this was a second door to it).
      const hasMarks = Array.isArray(attrs.annotations) && attrs.annotations.length > 0
      const refreezable = resolveEmbedRender({ ...attrs, mode: 'snapshot' }).kind === 'live'
      if (hasMarks && refreezable) archivedOnceRef.current = false
      updateAttributes?.(hasMarks && refreezable ? { mode: 'snapshot', fallback: null } : { mode: 'snapshot' })
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
      setToolbarMsg(`Live limit: ${LIVE_EMBEDS_PER_ENTRY} per note`)
      return
    }
    updateAttributes?.({ mode: 'live' })
  }
  const toggleWidth = () => {
    updateAttributes?.({ layout: { ...(attrs.layout || {}), width: half ? 'full' : 'half' } })
  }
  // "What happened next" (spec Phase 6 #2): VIEW-ONLY peek that extends an
  // anchored snapshot's window through today — anchorDate framing instead of
  // the replayCutoff, nothing persisted, the reader sees the aftermath and
  // toggles back. Local state on purpose: attrs never change, so the frozen
  // evidence stays frozen and a reload always reopens anchored.
  const [peek, setPeek] = useState(false)
  const canPeek = attrs.widgetId === 'chart' && decision.kind === 'live'
    && attrs.mode === 'snapshot' && attrs.params?.to != null
  const togglePeek = () => {
    // Entering the peek: a pending self-archive must never rasterize the
    // extended view as the permanent PNG — needsArchive gates on !peek below,
    // and resetting the once-latch re-arms the archive after the peek ends.
    if (!peek) archivedOnceRef.current = false
    setPeek(!peek)
  }

  const recapture = () => {
    // Clearing the archive re-arms the self-archive effect: fresh settle,
    // fresh PNG, fresh upload — an explicit re-freeze of what's shown NOW.
    // capturedAt is NOT touched: it is the EVIDENCE date the caption renders,
    // and re-stamping it relabeled March evidence "captured June" the moment
    // the user annotated it (panel finding).
    setPeek(false) // never archive the peeked (through-now) view
    archivedOnceRef.current = false
    updateAttributes?.({ fallback: null })
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
    setPeek(false) // a fresh window starts anchored
    archivedOnceRef.current = false
    barsReadyRef.current = false
    kickSnapshotWarm(next.params)
    updateAttributes?.({ params: next.params, searchText: next.searchText, fallback: null })
  }

  // Per-chart settings (spec: the embed's gear opens the standard Chart Settings
  // modal, scoped to THIS chart). ChartPane persists every settings edit through
  // onStore → here, into the embed's OWN params.settings — never the reader's
  // global chart_settings. The stored blob is also the chart's settingsOverride
  // base, so the change applies live to this chart only. The archive is left as
  // is (Re-capture re-freezes it) to avoid churning the capture pipeline on
  // every colour pick.
  const onEmbedSettings = useCallback((next) => {
    if (!next) return
    // A settings change alters the chart's look, so the archived PNG (and the
    // note-card thumbnail derived from it) is now stale. Clear it and re-arm the
    // self-archive to re-freeze with the new settings (the switchTf idiom). The
    // 3.5s settle timer debounces rapid colour picks.
    archivedOnceRef.current = false
    updateAttributes?.({ params: { ...(attrsRef.current.params || {}), settings: next }, fallback: null })
  }, [updateAttributes])
  const openEmbedSettings = () => chartRef.current?.openSettings?.()

  // Freeze: keep the chart as a REAL chart (never rasterize — a PNG loses
  // quality), just make it static — toolbar hidden, pointer-events off so there's
  // no crosshair and no scroll/zoom. It stays crystal clear because it's still
  // the live canvas. Resizable via the corner handle like any chart.
  const freezeChart = () => updateAttributes?.({ frozen: true })

  // Corner resize (all four corners). Live width/height are written straight to
  // the DOM during the drag (no React churn), then committed to attrs.layout on
  // release — so the size persists and re-renders match. First resize converts a
  // full/half preset into an explicit pixel size.
  const startResize = (corner) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const frame = wrapRef.current
    const body = bodyRef.current
    if (!frame) return
    const startW = frame.getBoundingClientRect().width
    const startH = body ? body.getBoundingClientRect().height : height
    const startX = e.clientX, startY = e.clientY
    const signX = (corner === 'ne' || corner === 'se') ? 1 : -1
    const signY = (corner === 'sw' || corner === 'se') ? 1 : -1
    let liveW = startW, liveH = startH
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = (corner === 'ne' || corner === 'sw') ? 'nesw-resize' : 'nwse-resize'
    setResizing(true)
    const onMove = (ev) => {
      liveW = Math.max(EMBED_MIN_W, Math.min(EMBED_MAX_W, startW + signX * (ev.clientX - startX)))
      liveH = Math.max(EMBED_MIN_H, Math.min(EMBED_MAX_H, startH + signY * (ev.clientY - startY)))
      frame.style.width = `${liveW}px`
      if (body) body.style.height = `${liveH}px`
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = prevCursor
      setResizing(false)
      updateAttributes?.({
        layout: { ...(attrsRef.current.layout || {}), width: Math.round(liveW), height: Math.round(liveH) },
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
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
  // !peek: the aftermath view must never become the permanent archive PNG.
  // !shareView: a public reader never uploads anything.
  const needsArchive = decision.kind === 'live' && !attrs.fallback?.url && attrs.mode === 'snapshot' && inView && !peek && !shareView
  useEffect(() => {
    if (!needsArchive || archivedOnceRef.current) return undefined
    archivedOnceRef.current = true
    // The warm needs no note context and the server rail is bounded/throttled
    // — fire it the moment a fresh snapshot mounts.
    kickSnapshotWarm(attrs.params)
    let timer = null
    let retries = 0
    // The body is showing one of the NOT-the-live-widget frames (placeholder
    // chip, grey skeleton, an archived image) rather than the widget itself.
    // Reading the MARKUP, not component state, is the point: every route to a
    // fallback — !inView, Suspense, a thrown render caught by the error
    // boundary — lands here without the archive having to enumerate them.
    const showingFallback = () => showsUnavailableFrame(bodyRef.current)
    const fire = async () => {
      // Don't rasterize a chart that hasn't painted its bars yet — the settle
      // clock alone once archived a candle-less frame (live finding). After
      // the retry budget, capture anyway: non-chart live embeds have no bars
      // signal, and a best-effort late frame beats no archive at all.
      if ((!barsReadyRef.current || showingFallback()) && retries < ARCHIVE_MAX_RETRIES) {
        retries += 1
        timer = setTimeout(fire, ARCHIVE_RETRY_MS)
        return
      }
      // ⛔ …but the fallback check does NOT expire into "capture anyway".
      // `barsReadyRef` is sticky within a mount, so on a RE-capture the bars
      // gate is already satisfied and the budget above would wave a placeholder
      // straight through — freezing "snapshot image not captured yet" as the
      // permanent evidence PNG (observed in prod, 2026-08-16). No archive is
      // strictly better than a wrong one: the embed still renders live, and
      // clearing the once-latch re-arms the whole pipeline on the next open.
      if (showingFallback()) {
        archivedOnceRef.current = false
        console.debug('[widget-embed] archive skipped (body is a fallback, not the live widget)')
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
    if (!exiting) setPeek(false) // draw on the EVIDENCE window, never the peek
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
  // The drawing overlay owns window keydown while editable — Ctrl+Z/V/Escape
  // get preventDefault'd page-wide, and its input guard exempts only
  // INPUT/TEXTAREA, NOT the contenteditable prose editor. Draw mode left on
  // while writing would eat the editor's undo. Returning the caret to the
  // prose is a natural Done — exit draw mode, re-freezing the archive if
  // marks changed, exactly like the button.
  useEffect(() => {
    if (!annotate || typeof editor?.on !== 'function') return undefined
    const exit = () => {
      setAnnotate(false)
      if (annotationsDirtyRef.current) {
        annotationsDirtyRef.current = false
        if (attrs.mode === 'snapshot') recapture()
      }
    }
    editor.on('focus', exit)
    return () => editor.off('focus', exit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotate, editor])

  let body = archived
  if (decision.kind === 'live' && !shareView) {
    const Live = EMBED_COMPONENTS[attrs.widgetId]
    body = !Live ? archived : !inView ? (
      <div className={styles.loading} style={{ height }} {...RENDER_UNAVAILABLE} />
    ) : (
      <EmbedErrorBoundary fallback={archived}>
        <Suspense fallback={<div className={styles.loading} style={{ height }} {...RENDER_UNAVAILABLE} />}>
          <Live
            ref={attrs.widgetId === 'chart' ? chartRef : undefined}
            attrs={attrs}
            height={height}
            annotate={annotate}
            onAnnotationsChange={annotate ? handleAnnotationsChange : null}
            onBarsReady={handleBarsReady}
            crosshairBus={crosshairBus}
            peekToNow={canPeek && peek}
            onStoreSettings={onEmbedSettings}
          />
        </Suspense>
      </EmbedErrorBoundary>
    )
  }

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={`${styles.frame} ${sizedWidth ? styles.sized : (half ? styles.half : styles.full)} ${selected ? styles.selected : ''} ${annotate ? styles.annotating : ''} ${resizing ? styles.resizing : ''} ${frozen ? styles.frozen : ''}`}
      style={sizedWidth ? { width: sizedWidth } : undefined}
      data-widget-embed-view={attrs.widgetId || 'unknown'}
    >
      {editor?.isEditable !== false && !frozen && (
        <div className={styles.toolbar} contentEditable={false}>
          {toolbarMsg && <span className={styles.toolbarMsg}>{toolbarMsg}</span>}
          {/* Collapse toggle — hide/show the rest of the toolbar (the charts
              "Hide toolbar" affordance). Absent in draw mode (Done is the only
              control there). */}
          {!annotate && (
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => setToolbarOpen((o) => !o)}
              title={toolbarOpen ? 'Hide toolbar' : 'Show toolbar'}
              aria-label={toolbarOpen ? 'Hide toolbar' : 'Show toolbar'}
            >
              {toolbarOpen ? '‹' : '›'}
            </button>
          )}
          {(annotate || toolbarOpen) && (<>
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
          {!annotate && widgetMeta(attrs.widgetId)?.liveCapable === true && (
            <button type="button" className={styles.toolBtn} onClick={toggleLive}
              title={attrs.mode === 'live' ? 'Freeze to snapshot' : `Go live (max ${LIVE_EMBEDS_PER_ENTRY} per note)`}>
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
          {/* → Charts: the REVERSE of the capture flow. Captures always went
              charts → journal and nothing came back, so an embed was a dead
              end — you could read March's AMD 15m but not pick the work back
              up on the real workspace. Opens /charts pointed at this embed's
              symbol + timeframe. A plain link (not a click handler) so
              middle-click / ⌘-click open a tab, like any other link. */}
          {!annotate && attrs.widgetId === 'chart' && attrs.params?.symbol && (
            <a
              className={styles.toolBtn}
              href={chartsLinkPath({ symbol: attrs.params.symbol, tf: attrs.params.tf })}
              title={`Open ${attrs.params.symbol} on the Charts page`}
            >
              Charts ↗
            </a>
          )}
          {/* "What happened next" — VIEW-ONLY aftermath peek on an anchored
              chart snapshot (spec Phase 6 #2): the same window extended
              through today; toggling back restores the frozen cutoff. Never
              writes attrs — a reload always reopens anchored. */}
          {!annotate && canPeek && (
            <button
              type="button"
              className={`${styles.toolBtn} ${peek ? styles.toolBtnActive : ''}`}
              onClick={togglePeek}
              title={peek
                ? 'Back to the frozen window'
                : 'What happened next — show this window through today (view-only, nothing saved)'}
            >
              Aftermath
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
          {/* Chart settings — opens the standard Chart Settings modal, scoped to
              THIS chart only. */}
          {!annotate && attrs.widgetId === 'chart' && decision.kind === 'live' && (
            <button type="button" className={styles.toolBtn} onClick={openEmbedSettings}
              title="Chart settings (this chart only)" aria-label="Chart settings">
              <UIcon name="gear" size={13} gold={false} />
            </button>
          )}
          {/* Freeze to a static PNG — replaces the live embed with a plain,
              non-interactive image (no crosshair, no toolbar). */}
          {!annotate && decision.kind === 'live' && (
            <button type="button" className={styles.toolBtn} onClick={freezeChart}
              title="Freeze — make the chart static (no crosshair, not interactive); stays crystal clear">
              Freeze
            </button>
          )}
          {!annotate && (
            <button type="button" className={styles.toolBtn} onClick={() => deleteNode?.()} title="Remove embed" aria-label="Remove embed">
              ✕
            </button>
          )}
          </>)}
        </div>
      )}
      {/* Explicit pixel height + inline-size containment: every workspace
          widget root is height:100% and several use @container queries — a
          content-sized notebook parent collapses them to zero without this. */}
      <div ref={bodyRef} className={styles.body} style={decision.kind === 'live' && !shareView ? { height } : undefined}>
        {body}
      </div>
      {(attrs.mode === 'live') && !frozen && <span className={styles.liveBadge} title="Updates in real time — Snapshot freezes it">LIVE</span>}
      {attrs.caption ? <div className={styles.caption}>{attrs.caption}</div> : null}
      {/* Bottom-right resize handle (editable + not drawing) — works on live
          charts and frozen images alike. */}
      {editor?.isEditable !== false && !annotate && (
        <div className={`${styles.resizeHandle} ${styles.hSE}`} onPointerDown={startResize('se')} aria-hidden="true" />
      )}
    </NodeViewWrapper>
  )
}
