import { useEffect, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import useNoteFacts from '../../hooks/useNoteFacts'
import UIcon from '../../../../components/ui/UIcon'
import styles from './FinancialFactView.module.css'

function formatObservedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return '—'
  if (unit === 'usd_per_share' || unit === 'usd') {
    const n = Number(value)
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(value)
  }
  if (unit === 'percent') {
    const n = Number(value)
    return Number.isFinite(n) ? `${n.toFixed(2)}%` : String(value)
  }
  return String(value)
}

/**
 * Wave F — the React node view for a `financialFact` atom: a calm, quiet
 * card showing what was CAPTURED (THEN) and, for live_and_snapshot facts,
 * what UCT can currently resolve for comparison (NOW). Deliberately no
 * color-only change signal (directive §46/§104 — accessibility, and an
 * estimate increase isn't inherently "good" the way it might read as green).
 *
 * A resolver failure on the CURRENT half must never hide the ORIGINAL
 * observation (directive §47/§81/§98's single most emphasized rule) — this
 * component renders the captured value from the node's own `factId` lookup
 * regardless of whether `current` resolved.
 */
export default function FinancialFactView({ node, editor, deleteNode }) {
  const factId = node.attrs.factId
  // Node-view effects (and, for a doc's INITIAL content, node-view render
  // itself) can run before NoteEditorPage's onCreate stamps
  // editor.storage.uctJournalWidgets.noteId -- WidgetEmbedView hit this
  // exact race for its own self-archive effect (see that file's "settle
  // window" comment). A synchronous read here loses that race permanently:
  // nothing else ever triggers this node view to re-render once TipTap has
  // mounted it, so a noteId read as undefined on the first render stays
  // undefined forever and useNoteFacts never fetches. Re-check shortly after
  // mount and update local state once it's actually there.
  const [noteId, setNoteId] = useState(() => editor?.storage?.uctJournalWidgets?.noteId || null)
  useEffect(() => {
    if (noteId) return
    const t = setTimeout(() => {
      const resolved = editor?.storage?.uctJournalWidgets?.noteId
      if (resolved) setNoteId(resolved)
    }, 50)
    return () => clearTimeout(t)
  }, [noteId, editor])
  const { facts, isLoading } = useNoteFacts(noteId)
  const fact = facts.find((f) => f.id === factId)

  // !noteId is its OWN loading state, not a "not available" verdict --
  // useNoteFacts(null) reports isLoading:false (SWR never fetches with a
  // null key), so without this check the settle-window gap above would
  // render "no longer available" for ~50ms on every single note open.
  if ((isLoading || !noteId) && !fact) {
    return (
      <NodeViewWrapper as="div" className={styles.wrap} data-financial-fact>
        <div className={styles.card}>
          <span className={styles.muted}>Loading captured fact…</span>
        </div>
      </NodeViewWrapper>
    )
  }

  if (!fact) {
    return (
      <NodeViewWrapper as="div" className={styles.wrap} data-financial-fact>
        <div className={`${styles.card} ${styles.unavailable}`}>
          <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          <span>This captured fact is no longer available</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const hasCurrent = Object.prototype.hasOwnProperty.call(fact, 'current')
  const currentValue = fact.current
  const bothNumeric = typeof fact.value === 'number' && typeof currentValue === 'number'
  const change = bothNumeric ? currentValue - fact.value : null
  const changePct = bothNumeric && fact.value !== 0 ? (change / fact.value) * 100 : null

  return (
    <NodeViewWrapper as="div" className={styles.wrap} data-financial-fact contentEditable={false}>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.ticker}>{fact.ticker}</span>
          <span className={styles.label}>{fact.factLabel}</span>
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => deleteNode()}
            title="Remove from note"
            aria-label="Remove captured fact from note"
          >
            <UIcon name="x" size={12} />
          </button>
        </div>
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Captured</span>
            <span className={styles.rowValue}>{formatValue(fact.value, fact.unit)}</span>
          </div>
          {fact.temporalMode === 'live_and_snapshot' && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Current</span>
              <span className={styles.rowValue}>
                {hasCurrent && currentValue !== null && currentValue !== undefined
                  ? formatValue(currentValue, fact.unit)
                  : <span className={styles.muted}>Couldn&apos;t refresh</span>}
              </span>
            </div>
          )}
          {bothNumeric && change !== null && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Change</span>
              <span className={styles.rowValue}>
                {change >= 0 ? '+' : ''}{formatValue(change, fact.unit)}
                {changePct !== null && ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`}
              </span>
            </div>
          )}
        </div>
        <div className={styles.footer}>
          <span className={styles.captured}>Captured {formatObservedAt(fact.observedAt)}</span>
          {fact.caption && <span className={styles.caption}>{fact.caption}</span>}
        </div>
      </div>
    </NodeViewWrapper>
  )
}
