// Notebook simplify, Task 5 ("open on your notes"): the notes list's "AI" button opens this, under the list toolbar.
// It is Research home's notebook-wide Ask section, moved (Research home is no longer routed): the question panel
// (AskPanel, scope "notebook") and, while `notebook_ai_actions_enabled` is on, "Or tell Notebook what to change"
// (AiActionsPanel). A cited source opens in place, through the one shared router (lib/openCitation.js), exactly as on
// Research home: a document page in the document viewer, a captured web passage in its sheet, a note as the note.
//
// The panel is a lazy chunk of its own (tabs/NotebookTab.jsx): the Notebook's first open does not carry it.
//
// The question panel opens at once (`autoOpen`). Closing it (its X, or Escape) closes the whole section -- "Or tell
// Notebook what to change" with it (preview fix round 1: a door left behind on its own read as a stray button) -- and
// hands focus back to the AI button through `onClose`. The AI button (on a phone, ⋯ "Ask your Notebook") opens both
// again.
import { Suspense, useState } from 'react'
import lazyChunk from '../../lib/lazyChunk'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { openSpanningCitation } from '../../lib/openCitation'
import AskPanel from './AskPanel'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import CapturedSourceSheet from './CapturedSourceSheet'
import styles from './NotebookAiPanel.module.css'

// Fetched only while its switch is on (the box checks the switch itself too), as on Research home.
const AiActionsBox = lazyChunk(() => import('./AiActionsPanel'))

export default function NotebookAiPanel({ id, onOpenNote, onClose, blockedNoteIds = null }) {
  const actionsOn = notebookFlag('notebook_ai_actions_enabled') === true
  const [previewDoc, setPreviewDoc] = useState(null)
  const [capturedSource, setCapturedSource] = useState(null)
  const closeAsk = () => onClose?.()
  return (
    <section id={id} className={styles.section} aria-label="Ask your Notebook" data-notebook-ai-panel="">
      <div className={styles.askDoor}>
        <AskPanel scope="notebook" autoOpen onClose={closeAsk} onOpenNote={onOpenNote}
          onNavigate={(s, _r, { signal } = {}) => openSpanningCitation(s, {
            signal, openNote: onOpenNote, openDocument: setPreviewDoc, openCapturedSource: setCapturedSource,
          })} />
      </div>
      {actionsOn && (
        <Suspense fallback={null}>
          <AiActionsBox blockedNoteIds={blockedNoteIds} onOpenNote={onOpenNote} />
        </Suspense>
      )}
      <DocumentPreviewSheet
        open={!!previewDoc}
        href={previewDoc?.href}
        name={previewDoc?.name}
        page={previewDoc?.page}
        onClose={() => setPreviewDoc(null)}
        excerpts={previewDoc?.emphasizeExcerpt ? [previewDoc.emphasizeExcerpt] : []}
        emphasizeExcerptId={previewDoc?.emphasizeExcerptId}
        documentId={previewDoc?.documentId}
        onOpenNote={onOpenNote}
      />
      <CapturedSourceSheet
        open={!!capturedSource}
        excerpt={capturedSource}
        onClose={() => setCapturedSource(null)}
        onOpenOwningNote={capturedSource ? () => {
          const noteId = capturedSource.noteId
          setCapturedSource(null)
          onOpenNote?.({ id: noteId })
        } : null}
      />
    </section>
  )
}
