import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import {
  resolveEmbedRender, embedAutoCaption, countLiveEmbeds, LIVE_EMBEDS_PER_ENTRY,
} from '../../lib/widgetEmbedCore'
import { captureElementPng, storeFallbackImage, kickSnapshotWarm } from '../../lib/embedArchive'
import styles from './WidgetEmbedView.module.css'

// How long a live embed gets to settle (bars fetched, chart painted) before
// the self-archive rasterizes it. A late capture is fine — a blank one isn't.
const ARCHIVE_SETTLE_MS = 3500

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
  const height = attrs.layout?.height || 320
  const half = attrs.layout?.width === 'half'
  const bodyRef = useRef(null)
  const wrapRef = useRef(null)
  const archivedOnceRef = useRef(false)
  const [toolbarMsg, setToolbarMsg] = useState(null)

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
    if (attrs.mode === 'live') { updateAttributes?.({ mode: 'snapshot' }); return }
    const liveCount = countLiveEmbeds(editor?.getJSON?.() || {})
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
    const t = setTimeout(async () => {
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
    }, ARCHIVE_SETTLE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsArchive, editor, inView])

  const archived = attrs.fallback?.url
    ? <ArchivedImage attrs={attrs} />
    : <PlaceholderChip attrs={attrs} reason={decision.reason} />

  let body = archived
  if (decision.kind === 'live') {
    const Live = EMBED_COMPONENTS[attrs.widgetId]
    body = !Live ? archived : !inView ? (
      <div className={styles.loading} style={{ height }} />
    ) : (
      <EmbedErrorBoundary fallback={archived}>
        <Suspense fallback={<div className={styles.loading} style={{ height }} />}>
          <Live attrs={attrs} height={height} />
        </Suspense>
      </EmbedErrorBoundary>
    )
  }

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={`${styles.frame} ${half ? styles.half : styles.full} ${selected ? styles.selected : ''}`}
      data-widget-embed-view={attrs.widgetId || 'unknown'}
    >
      {editor?.isEditable !== false && (
        <div className={styles.toolbar} contentEditable={false}>
          {toolbarMsg && <span className={styles.toolbarMsg}>{toolbarMsg}</span>}
          <button type="button" className={styles.toolBtn} onClick={toggleLive}
            title={attrs.mode === 'live' ? 'Freeze to snapshot' : `Go live (max ${LIVE_EMBEDS_PER_ENTRY}/entry)`}>
            {attrs.mode === 'live' ? 'Snapshot' : 'Live'}
          </button>
          <button type="button" className={styles.toolBtn} onClick={toggleWidth}
            title={half ? 'Full width' : 'Half width (pair two side-by-side)'}>
            {half ? 'Full' : 'Half'}
          </button>
          {/* Re-capture only where a NEW capture can actually happen — for
              image-only widget types the archive IS the capture, and clearing
              it would permanently destroy the only image with nothing to
              re-arm the pipeline (review finding: destructive control with no
              recovery, the 8/10 builder-sweep defect class). */}
          {decision.kind === 'live' && (
            <button type="button" className={styles.toolBtn} onClick={recapture} title="Re-capture the archive image">
              Re-capture
            </button>
          )}
          <button type="button" className={styles.toolBtn} onClick={() => deleteNode?.()} title="Remove embed">
            ✕
          </button>
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
