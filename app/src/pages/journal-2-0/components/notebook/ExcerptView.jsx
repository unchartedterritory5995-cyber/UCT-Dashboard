import { useEffect, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import useNoteExcerpts from '../../hooks/useNoteExcerpts'
import UIcon from '../../../../components/ui/UIcon'
import styles from './ExcerptView.module.css'

/**
 * Wave J — the React node view for a `documentExcerpt` atom: a quiet card
 * showing the CAPTURED passage, its page citation, and an optional
 * annotation. Mirrors `FinancialFactView.jsx`'s own shape and settle-window
 * handling exactly (see that file's comments for why the noteId re-check
 * exists) -- deliberately quieter than authored thesis prose (checkpoint
 * decision 25), never a bright color badge.
 *
 * "Remove" here is EDITOR-LOCAL (`deleteNode()`) only -- it does NOT delete
 * the underlying `j2_note_excerpts` row (checkpoint decision 56): the same
 * excerpt may still be referenced by a thesis in a different note, exactly
 * like removing a `financialFact` node never deletes the fact observation.
 */
export default function ExcerptView({ node, editor, deleteNode }) {
  const excerptId = node.attrs.excerptId
  const [noteId, setNoteId] = useState(() => editor?.storage?.uctJournalWidgets?.noteId || null)
  useEffect(() => {
    if (noteId) return
    const t = setTimeout(() => {
      const resolved = editor?.storage?.uctJournalWidgets?.noteId
      if (resolved) setNoteId(resolved)
    }, 50)
    return () => clearTimeout(t)
  }, [noteId, editor])
  const { excerpts, isLoading } = useNoteExcerpts(noteId)
  const excerpt = excerpts.find((e) => e.id === excerptId)

  if ((isLoading || !noteId) && !excerpt) {
    return (
      <NodeViewWrapper as="div" className={styles.wrap} data-document-excerpt>
        <div className={styles.card}>
          <span className={styles.muted}>Loading excerpt…</span>
        </div>
      </NodeViewWrapper>
    )
  }

  if (!excerpt) {
    return (
      <NodeViewWrapper as="div" className={styles.wrap} data-document-excerpt>
        <div className={`${styles.card} ${styles.unavailable}`}>
          <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          <span>This excerpt's source is no longer available</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const documentName = excerpt.documentName || 'Document'

  return (
    <NodeViewWrapper as="div" className={styles.wrap} data-document-excerpt contentEditable={false}>
      <div className={styles.card}>
        <div className={styles.header}>
          <UIcon name="document" size={12} gold={false} style={{ verticalAlign: '-1px', marginRight: 5 }} />
          <span className={styles.quoteText}>&ldquo;{excerpt.capturedText}&rdquo;</span>
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => deleteNode()}
            title="Remove from note"
            aria-label="Remove excerpt from note"
          >
            <UIcon name="x" size={12} />
          </button>
        </div>
        {/*
          Wave I established the pattern this reuses: a chip's "open
          something" action is a plain DOM click carrying data-attrs,
          recognized by NoteEditorPage's own capture-phase click handler
          (handleEditorClickCapture) rather than a TipTap-extension-level
          callback -- one bridge from "atom node click" to "parent opens a
          Sheet", not two.
        */}
        <button
          type="button"
          className={styles.citation}
          data-type="documentExcerptCitation"
          data-document-id={excerpt.documentId}
          data-page={excerpt.pageNumber}
          data-excerpt-id={excerpt.id}
        >
          <UIcon name="link" size={11} gold={false} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          {documentName} · p.{excerpt.pageNumber}
        </button>
        {excerpt.annotation && <div className={styles.annotation}>{excerpt.annotation}</div>}
      </div>
    </NodeViewWrapper>
  )
}
