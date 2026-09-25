import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './AskInsertView.module.css'

/**
 * G-064 — the block holding an inserted Ask Notebook answer (spec §4.1, §8).
 * The label row is chrome (contentEditable=false); the body is the member's to
 * edit. Styles come through CSS-module classNames, never raw class names
 * (the trap NoteEditorPage.module.css:201-206 records).
 */
export function insertedDateLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AskInsertView({ node }) {
  const { insertedAt, question } = node.attrs
  const date = insertedDateLabel(insertedAt)
  return (
    <NodeViewWrapper
      className={styles.block}
      data-type="ask-insert"
      role="group"
      aria-label={question ? `Answer from Ask Notebook to: ${question}` : 'Answer from Ask Notebook'}
    >
      <div className={styles.header} contentEditable={false} title={question ? `Question: ${question}` : undefined}>
        <UIcon name="sparkle" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
        <span className={styles.label}>From Ask Notebook</span>
        {date && <span className={styles.date}>{` · ${date}`}</span>}
      </div>
      <NodeViewContent className={styles.body} />
    </NodeViewWrapper>
  )
}
