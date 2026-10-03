import { Suspense, lazy, useEffect, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { TRANSCRIPT_EVENT, transcriptCaptureEnabled } from '../../lib/researchCapture'

/**
 * Wave 13 lane 13G-1 -- the two doors onto "save a transcript passage", kept SMALL: the sheet
 * itself (`SaveTranscriptPassage.jsx`) loads only when a door is used, so neither the Notebook's
 * first open nor the research workspace carries it (`docs/notebook/perf-budgets.json`).
 * Both render nothing while `notebook_transcript_capture_enabled` is off.
 */
const SaveTranscriptPassage = lazy(() => import('./SaveTranscriptPassage'))

/** The ticker research workspace's door: a button, then the sheet with a destination picker. */
export function SaveTranscriptButton({ symbol, notes = null, quarter = null, onSaved, onOpenNote, disabled }) {
  const [open, setOpen] = useState(false)
  if (!transcriptCaptureEnabled()) return null
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} disabled={disabled}>
        <UIcon name="document" size={13} gold={false} /> Save from a transcript
      </button>
      {open && (
        <Suspense fallback={null}>
          <SaveTranscriptPassage open={open} onClose={() => setOpen(false)} symbol={symbol}
            notes={notes} quarter={quarter} onSaved={onSaved} onOpenNote={onOpenNote} />
        </Suspense>
      )}
    </>
  )
}

/**
 * The note editor's door: the slash menu's "Transcript passage" dispatches TRANSCRIPT_EVENT on
 * THIS editor's DOM root; the sheet saves into this note and the node lands at the caret (the
 * server also placed it, exactly as the PDF "Save excerpt" does; the editor's body is the one
 * the next save keeps).
 */
export function TranscriptInsertHost({ editor, noteId, ticker }) {
  const [open, setOpen] = useState(false)
  const enabled = transcriptCaptureEnabled()
  useEffect(() => {
    if (!editor || !enabled) return undefined
    const onOpen = () => setOpen(true)
    let dom = null
    const detach = () => { if (dom) dom.removeEventListener(TRANSCRIPT_EVENT, onOpen); dom = null }
    const attach = () => {
      if (editor.isDestroyed) return
      const next = editor.view?.dom
      if (!next || next === dom) return
      detach()
      dom = next
      dom.addEventListener(TRANSCRIPT_EVENT, onOpen)
    }
    attach()
    editor.on('mount', attach)
    editor.on('create', attach)
    editor.on('unmount', detach)
    return () => {
      editor.off('mount', attach)
      editor.off('create', attach)
      editor.off('unmount', detach)
      detach()
    }
  }, [editor, enabled])
  if (!enabled || !noteId) return null
  const onSaved = (out) => {
    const id = out?.excerpt?.id
    if (!id || !editor || editor.isDestroyed) return
    // The same quote again is the same excerpt: one node per excerpt in this note.
    let present = false
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'documentExcerpt' && n.attrs.excerptId === id) present = true
      return !present
    })
    if (present) return
    editor.chain().focus().insertContentAt(editor.state.selection.to, {
      type: 'documentExcerpt', attrs: { excerptId: id },
    }).run()
  }
  return open ? (
    <Suspense fallback={null}>
      <SaveTranscriptPassage open={open} onClose={() => setOpen(false)} symbol={ticker || ''}
        fixedNoteId={noteId} onSaved={onSaved} />
    </Suspense>
  ) : null
}
