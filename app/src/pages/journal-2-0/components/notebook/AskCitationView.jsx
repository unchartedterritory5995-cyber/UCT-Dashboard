import { NodeViewWrapper } from '@tiptap/react'
import { useNavigate } from 'react-router-dom'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import askStyles from './AskPanel.module.css'
import styles from './AskCitationView.module.css'

/**
 * G-064 — the chip for an `askCitation` atom (spec §6.6).
 *
 * The chip class is AskPanel's own `.citationChip`, imported, not copied, so a
 * citation looks the same in the panel and in a note. Degradation is stated in
 * WORDS, never by colour alone (AskPanel.jsx:300): a stale chip reads
 * `[n · edited]`, and the insert-time precision uses AskPanel's own Sources-row
 * words (AskPanel.jsx:303-305).
 */
export const PRECISION_WORDS = Object.freeze({
  page_only: 'page only', note_only: 'note only', record_only: 'record', unavailable: 'unavailable',
})

export function citationDescription({ n, label, citation }, stale) {
  const parts = [`Source ${n}: ${label || 'source'}`]
  if (citation && citation !== 'exact') parts.push(PRECISION_WORDS[citation] || 'unavailable')
  if (stale) parts.push('text edited since inserted')
  return parts.join(', ')
}

export default function AskCitationView({ node, decorations }) {
  const { n, label, nav, citation } = node.attrs
  const navigate = useNavigate()
  const stale = Array.isArray(decorations) && decorations.some((d) => d?.spec?.askStale)
  const noteId = nav && typeof nav === 'object' && typeof nav.note_id === 'string' ? nav.note_id : null
  const text = stale ? `[${n} · edited]` : `[${n}]`
  const described = citationDescription({ n, label, citation }, stale)
  const cls = `${askStyles.citationChip} ${stale ? styles.stale : ''}`

  return (
    <NodeViewWrapper as="span" className={styles.wrap} data-ask-citation>
      {noteId ? (
        <button
          type="button"
          className={cls}
          contentEditable={false}
          aria-label={described}
          title={described}
          onClick={(e) => { e.preventDefault(); navigate(notePath(noteId)) }}
        >
          {text}
        </button>
      ) : (
        <span className={cls} contentEditable={false} title={described}>
          {text}
          <span className={askStyles.srOnly}>{described}</span>
        </span>
      )}
    </NodeViewWrapper>
  )
}
