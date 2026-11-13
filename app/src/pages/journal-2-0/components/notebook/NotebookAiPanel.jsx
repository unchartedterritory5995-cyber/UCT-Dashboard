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
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { RELOAD_TO_RECOVER, heldModule, pageReload, useHeldModule } from '../../lib/heldModule'
import whenIdle from '../../lib/whenIdle'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { openSpanningCitation } from '../../lib/openCitation'
import AskPanel from './AskPanel'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import CapturedSourceSheet from './CapturedSourceSheet'
import styles from './NotebookAiPanel.module.css'
import actionStyles from './AiActionsPanel.module.css'

// Fetched only while its switch is on (the box checks the switch itself too), as on Research home.
// Follow-up B fix round 1 (item 5): held, not `lazyChunk` + Suspense (whose reveal is held back about 300 ms even with
// the chunk in hand). It is asked for once this panel's chunk is in hand and the page is idle (the panel's chunk is
// itself fetched when the list is idle and when a pointer or focus reaches "AI", NotebookAiPanelSlot.jsx), and again
// when the section mounts; with it in hand the box is drawn in the section's own commit. Before it lands a frame with
// the same toggle is drawn: pressing it puts focus on a status line at once, and the box opens with the request field
// focused when it lands. A failed fetch says so, with a Reload the member presses.
export const aiActionsLoaders = { box: () => import('./AiActionsPanel') }
export const aiActionsModule = heldModule(() => aiActionsLoaders.box())
const actionsOn = () => notebookFlag('notebook_ai_actions_enabled') === true
if (typeof window !== 'undefined') whenIdle(() => { if (actionsOn()) aiActionsModule.warm() })
export const AI_ACTIONS_UNAVAILABLE = 'Tell Notebook what to change could not be loaded.'
export const AI_ACTIONS_LOADING = 'Loading…'

function AiActionsFrame({ failed, wantOpen, onOpen }) {
  const statusRef = useRef(null)
  useLayoutEffect(() => { if (wantOpen) statusRef.current?.focus() }, [wantOpen])
  return (
    <section className={actionStyles.wrap} aria-label="Or tell Notebook what to change" data-ai-actions-stand-in="">
      <button type="button" className={actionStyles.toggle} aria-expanded={wantOpen} onClick={onOpen}>
        <UIcon name="sparkle" size={13} gold={false} /> Or tell Notebook what to change
      </button>
      {(wantOpen || failed) && (
        <p ref={statusRef} tabIndex={-1} role={failed ? 'alert' : 'status'}>
          {failed ? `${AI_ACTIONS_UNAVAILABLE} ${RELOAD_TO_RECOVER}` : AI_ACTIONS_LOADING}
          {failed && <> <button type="button" className="btn btn-secondary btn-sm" onClick={pageReload.run}>Reload</button></>}
        </p>
      )}
    </section>
  )
}

export function AiActionsSlot(props) {
  const { status, Component } = useHeldModule(aiActionsModule)
  // A press on the frame's toggle before the box lands: the box opens (request field focused) when it does.
  const [wantOpen, setWantOpen] = useState(false)
  useEffect(() => { aiActionsModule.warm() }, [])
  if (Component) return <Component {...props} defaultOpen={wantOpen} />
  return <AiActionsFrame failed={status === 'failed'} wantOpen={wantOpen} onOpen={() => setWantOpen(true)} />
}

export default function NotebookAiPanel({ id, onOpenNote, onClose, blockedNoteIds = null }) {
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
      {actionsOn() && <AiActionsSlot blockedNoteIds={blockedNoteIds} onOpenNote={onOpenNote} />}
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
