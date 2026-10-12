// The node view for a Notebook trader block (P2a). WidgetEmbedView dispatches here for every widget id
// the registry marks `block: true`; a block has no embed toolbar, no archive and no resize. Its state is
// its params, changed only through useBlockParams (one editor transaction per change).
import { Component, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { lazyLeaf } from '../../../lib/lazyChunk'
import { isChunkLoadError } from '../../../../../utils/lazyWithRetry'
import { blockLabel } from '../../../lib/journalBlocks'
import { useBlockParams } from './useBlockParams'
import { BlockError, BlockLoading } from './blockStates'
import styles from './Blocks.module.css'

/** ⛔ IR-B2: the ONLY binding of a block id (registry.test.js parses these keys). Each value is the
 *  body's IMPORTER, its own lazy chunk; Tasks 7, 10 and 11 replace the stub files, never this map. */
export const BLOCK_COMPONENTS = {
  preEntryChecklist: () => import('./PreEntryChecklistBlock'),
  priceStamps: () => import('./PriceStampsBlock'),
  positionSizing: () => import('./PositionSizingBlock'),
}

/** A body that throws (or whose chunk fails twice) shows BLOCK_ERROR_SENTENCE inside the block's own
 *  frame; the note around it keeps working. "Try again" calls `onRetry`, which builds a NEW lazy
 *  component (fix round 1, I-1): React.lazy remembers a rejected load forever, so re-rendering the
 *  old one could never succeed.
 *  ⛔ R-T6-3: after a deploy the old chunk is gone for good, so when a RETRY (attempt > 0) also fails
 *  with a chunk-load error -- the app's own predicate, utils/lazyWithRetry -- the error state offers
 *  "Reload" instead (PlaceholderChip's button and name). Any other error keeps "Try again".
 *  ⛔ R-T6-4 N-5: never while the browser says it is offline (a reload would land on the offline page;
 *  "Try again" can still work once the connection is back), and a body that LOADED clears the
 *  escalation, so a much later chunk error starts at "Try again" again. */
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

class BlockBoundary extends Component {
  constructor(p) { super(p); this.state = { failed: false, chunk: false } }
  static getDerivedStateFromError(error) { return { failed: true, chunk: isChunkLoadError(error) } }
  render() {
    if (!this.state.failed) return this.props.children
    if (this.state.chunk && this.props.retried && !offline()) {
      return <BlockError onReload={() => window.location.reload()} reloadName={`Reload to see ${this.props.label}`} />
    }
    return <BlockError onRetry={() => { this.props.onRetry(); this.setState({ failed: false, chunk: false }) }} />
  }
}

/** Commits only once the lazy body beside it has loaded (the Suspense around both shows neither until
 *  then), so its effect is the "the body loaded" signal. `onLoaded` is stable. */
function LoadedMark({ onLoaded }) {
  useEffect(() => { onLoaded() }, [onLoaded])
  return null
}

export default function BlockNodeView({ node, editor, updateAttributes, deleteNode, selected }) {
  const attrs = node?.attrs || {}
  // A public share page renders the block's line only: nothing a block body reads is a stranger's.
  const shareView = !!editor?.storage?.uctJournalWidgets?.shareView
  const editable = editor?.isEditable !== false && !shareView
  const setParams = useBlockParams({ attrs, updateAttributes, editable })
  const label = blockLabel(attrs.widgetId)
  const load = BLOCK_COMPONENTS[attrs.widgetId]
  const [attempt, setAttempt] = useState(0)       // the lazy's cache key: only ever counts up
  const [retried, setRetried] = useState(false)   // a retry is in flight, not yet loaded (R-T6-3, N-5)
  const markLoaded = useCallback(() => setRetried(false), [])
  // One lazy component per (body, attempt): a retry asks for the chunk again instead of re-reading
  // the remembered failure.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- I-1: the lazy is rebuilt per retry attempt ON PURPOSE (React.lazy remembers a rejected load forever; `attempt` is the cache key). Hoisting it out of render reverts the fix. (This also stands for react-hooks/static-components on <Body/>: the compiler-based rules skip a component that carries this suppression.)
  const Body = useMemo(() => (load ? lazyLeaf(load) : null), [load, attempt])
  return (
    <NodeViewWrapper className={`${styles.block} ${selected ? styles.selected : ''}`}
      data-widget-embed-view={attrs.widgetId} contentEditable={false}>
      <div role="group" aria-label={label} className={styles.inner}>
        <div className={styles.head}>
          <span className={styles.title}>{label}</span>
          {editable && deleteNode && (
            <button type="button" className={`btn btn-ghost ${styles.tap}`} aria-label={`Remove ${label}`} onClick={() => deleteNode()}>
              Remove
            </button>
          )}
        </div>
        {shareView || !Body ? <p className={styles.muted}>{attrs.searchText || label}</p> : (
          <BlockBoundary retried={retried} label={label} onRetry={() => { setAttempt((n) => n + 1); setRetried(true) }}>
            <Suspense fallback={<BlockLoading />}>
              <Body params={attrs.params || {}} setParams={setParams} editable={editable} editor={editor} attrs={attrs} />
              <LoadedMark onLoaded={markLoaded} />
            </Suspense>
          </BlockBoundary>
        )}
      </div>
    </NodeViewWrapper>
  )
}
