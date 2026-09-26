import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './AskInsertView.module.css'

/**
 * G-064 — the block holding an inserted Ask Notebook answer (spec §4.1, §8).
 * The label row is chrome (contentEditable=false); the body is the member's to
 * edit. Styles come through CSS-module classNames, never raw class names
 * (the trap NoteEditorPage.module.css:201-206 records).
 *
 * Wave 7 lane H (H2, ruling D-H1): the SAME node holds an accepted writing-help
 * result, told apart by its optional `action` attr. Its label reads
 * "Compass · Rewrite · claude-sonnet-5 · 09:41". ⛔ A node WITHOUT `action` (every
 * Ask insert, every wave-5 insert) takes the untouched Ask branch below, so it
 * renders exactly as before — AskInsertView.writingHelp.test.jsx pins that.
 */
export function insertedDateLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Writing help's action, as the label says it. Unknown ⇒ '' (never a raw value). */
export const WRITING_HELP_ACTION_LABELS = Object.freeze({
  summarize: 'Summarize',
  rewrite: 'Rewrite',
  continue: 'Continue',
  translate: 'Translate',
})

/** '09:41' — the member's local clock, 24h (the label's own format). */
export function insertedTimeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "Compass · Rewrite · claude-sonnet-5 · 09:41" — only the parts that are known. */
export function writingHelpLabel({ action, model, insertedAt }) {
  const parts = ['Compass']
  const act = WRITING_HELP_ACTION_LABELS[action] || ''
  if (act) parts.push(act)
  if (model) parts.push(String(model))
  const time = insertedTimeLabel(insertedAt)
  if (time) parts.push(time)
  return parts.join(' · ')
}

export default function AskInsertView({ node }) {
  const { insertedAt, question, action, model } = node.attrs
  if (action) {
    const label = writingHelpLabel({ action, model, insertedAt })
    const when = insertedAt && !Number.isNaN(new Date(insertedAt).getTime())
      ? new Date(insertedAt).toLocaleString('en-US') : ''
    return (
      <NodeViewWrapper
        className={styles.block}
        data-type="ask-insert"
        role="group"
        aria-label={`Written with Compass writing help: ${question || label}`}
      >
        <div
          className={styles.header}
          contentEditable={false}
          title={[question && `Asked: ${question}`, when].filter(Boolean).join(' · ') || undefined}
        >
          <UIcon name="sparkle" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          <span className={styles.label}>{label}</span>
        </div>
        <NodeViewContent className={styles.body} />
      </NodeViewWrapper>
    )
  }
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
