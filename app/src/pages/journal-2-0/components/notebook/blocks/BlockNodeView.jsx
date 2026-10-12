// The node view for a Notebook trader block (P2a). WidgetEmbedView dispatches here for every widget id
// the registry marks `block: true`; a block has no embed toolbar, no archive and no resize. Its state is
// its params, changed only through useBlockParams (one editor transaction per change).
import { Component, Suspense } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { lazyLeaf } from '../../../lib/lazyChunk'
import { blockLabel } from '../../../lib/journalBlocks'
import { useBlockParams } from './useBlockParams'
import { BlockError, BlockLoading } from './blockStates'
import styles from './Blocks.module.css'

/** ⛔ IR-B2: the ONLY binding of a block id (registry.test.js parses these keys). Each body is its own
 *  lazy chunk; Tasks 7, 10 and 11 replace the stub files, never this map. */
export const BLOCK_COMPONENTS = {
  preEntryChecklist: lazyLeaf(() => import('./PreEntryChecklistBlock')),
  priceStamps: lazyLeaf(() => import('./PriceStampsBlock')),
  positionSizing: lazyLeaf(() => import('./PositionSizingBlock')),
}

/** A body that throws (or whose chunk fails twice) shows BLOCK_ERROR_SENTENCE inside the block's own
 *  frame; the note around it keeps working. "Try again" re-renders the body. */
export class BlockBoundary extends Component {
  constructor(p) { super(p); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <BlockError onRetry={() => this.setState({ failed: false })} />
      : this.props.children
  }
}

export default function BlockNodeView({ node, editor, updateAttributes, deleteNode, selected }) {
  const attrs = node?.attrs || {}
  // A public share page renders the block's line only: nothing a block body reads is a stranger's.
  const shareView = !!editor?.storage?.uctJournalWidgets?.shareView
  const editable = editor?.isEditable !== false && !shareView
  const setParams = useBlockParams({ attrs, updateAttributes, editable })
  const label = blockLabel(attrs.widgetId)
  const Body = BLOCK_COMPONENTS[attrs.widgetId]
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
          <BlockBoundary>
            <Suspense fallback={<BlockLoading />}>
              <Body params={attrs.params || {}} setParams={setParams} editable={editable} editor={editor} attrs={attrs} />
            </Suspense>
          </BlockBoundary>
        )}
      </div>
    </NodeViewWrapper>
  )
}
