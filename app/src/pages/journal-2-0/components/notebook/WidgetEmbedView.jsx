import { Component, Suspense, lazy } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { resolveEmbedRender, embedAutoCaption } from '../../lib/widgetEmbedCore'
import styles from './WidgetEmbedView.module.css'

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

export default function WidgetEmbedView({ node, selected }) {
  const attrs = node.attrs || {}
  const decision = resolveEmbedRender(attrs)
  const height = attrs.layout?.height || 320
  const half = attrs.layout?.width === 'half'

  const archived = attrs.fallback?.url
    ? <ArchivedImage attrs={attrs} />
    : <PlaceholderChip attrs={attrs} reason={decision.reason} />

  let body = archived
  if (decision.kind === 'live') {
    const Live = EMBED_COMPONENTS[attrs.widgetId]
    body = Live ? (
      <EmbedErrorBoundary fallback={archived}>
        <Suspense fallback={<div className={styles.loading} style={{ height }} />}>
          <Live attrs={attrs} height={height} />
        </Suspense>
      </EmbedErrorBoundary>
    ) : archived
  }

  return (
    <NodeViewWrapper
      className={`${styles.frame} ${half ? styles.half : styles.full} ${selected ? styles.selected : ''}`}
      data-widget-embed-view={attrs.widgetId || 'unknown'}
    >
      {/* Explicit pixel height + inline-size containment: every workspace
          widget root is height:100% and several use @container queries — a
          content-sized notebook parent collapses them to zero without this. */}
      <div className={styles.body} style={decision.kind === 'live' ? { height } : undefined}>
        {body}
      </div>
      {(attrs.mode === 'live') && <span className={styles.liveBadge}>LIVE</span>}
      {attrs.caption ? <div className={styles.caption}>{attrs.caption}</div> : null}
    </NodeViewWrapper>
  )
}
