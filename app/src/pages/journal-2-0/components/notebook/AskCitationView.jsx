import { NodeViewWrapper } from '@tiptap/react'
import { useNavigate } from 'react-router-dom'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import { precisionWords } from '../../lib/askCitation'
import askStyles from './AskPanel.module.css'
import styles from './AskCitationView.module.css'

/**
 * G-064 — the chip for an `askCitation` atom (spec §6.6).
 *
 * The chip class is AskPanel's own `.citationChip`, imported, not copied, so a
 * citation looks the same in the panel and in a note. Degradation is stated in
 * WORDS, never by colour alone (AskPanel.jsx:300): a stale chip reads
 * `[n · edited]`, and the insert-time precision uses AskPanel's own Sources-row
 * words — `precisionWords` over `PRECISION_WORDS` (G-064 fix round 1, Finding
 * F5; own-key guard added in the final fix wave) is now the ONE
 * export both surfaces read, in `lib/askCitation.js`.
 */
export function citationDescription({ n, label, citation }, stale) {
  // G-064 fix round 1 (Finding F4): a shared/reduced copy of this chip can
  // carry no `n` at all -- render `?`, matching renderHTML's `[${n ?? '?'}]`
  // server-render fallback, never `Source null: …` / `Source undefined: …`.
  const num = n == null ? '?' : n
  const parts = [`Source ${num}: ${label || 'source'}`]
  if (citation && citation !== 'exact') parts.push(precisionWords(citation))
  if (stale) parts.push('text edited since inserted')
  return parts.join(', ')
}

export default function AskCitationView({ node, decorations }) {
  const { n, label, nav, citation } = node.attrs
  const navigate = useNavigate()
  const stale = Array.isArray(decorations) && decorations.some((d) => d?.spec?.askStale)
  const noteId = nav && typeof nav === 'object' && typeof nav.note_id === 'string' ? nav.note_id : null
  const num = n == null ? '?' : n
  const text = stale ? `[${num} · edited]` : `[${num}]`
  const described = citationDescription({ n, label, citation }, stale)
  const cls = `${askStyles.citationChip} ${styles.chip} ${stale ? styles.stale : ''}`

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
          {/* G-064 fix round 1 (Finding F6): aria-hidden on the visible glyph
              so a screen reader hears only the sr-only description once,
              never the raw "[n]" text plus the description back to back. */}
          <span aria-hidden="true">{text}</span>
          <span className={askStyles.srOnly}>{described}</span>
        </span>
      )}
    </NodeViewWrapper>
  )
}
