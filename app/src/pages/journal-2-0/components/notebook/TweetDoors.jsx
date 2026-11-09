import { Suspense, useEffect, useState } from 'react'
import lazyChunk from '../../lib/lazyChunk'
import { TOOLBAR_ICON } from '../../lib/notebookIcons'
import UIcon from '../../../../components/ui/UIcon'
import { TWEET_EVENT, tweetImportEnabled } from '../../lib/tweetImport'

/**
 * Import a tweet -- the two doors, kept SMALL: the sheet (`ImportTweetSheet.jsx`) loads only when
 * a door is used, so the Notebook's first open does not carry it (`docs/notebook/perf-budgets.json`).
 * This module loads on demand too: the editor page imports `TweetInsertHost`, its default export,
 * through `lazyChunk`, only while `notebook_tweet_import_enabled` is on.
 * Both render nothing while the flag is off.
 */
const ImportTweetSheet = lazyChunk(() => import('./ImportTweetSheet'))

/** The ticker page's door: a button, then the sheet with a Save to picker. */
export function ImportTweetButton({ symbol, notes = null, onSaved, onOpenNote, disabled }) {
  const [open, setOpen] = useState(false)
  if (!tweetImportEnabled()) return null
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" aria-haspopup="dialog"
        onClick={() => setOpen(true)} disabled={disabled}>
        <UIcon name="xLogo" {...TOOLBAR_ICON} /> Import a tweet
      </button>
      {open && (
        <Suspense fallback={null}>
          <ImportTweetSheet open={open} onClose={() => setOpen(false)} symbol={symbol}
            notes={notes} onSaved={onSaved} onOpenNote={onOpenNote} />
        </Suspense>
      )}
    </>
  )
}

/**
 * The note editor's door: /tweet and the toolbar button dispatch TWEET_EVENT on THIS editor's DOM
 * root; the sheet saves into this note and the cards land at the caret, in the order ticked (the
 * server also placed them, as the transcript door's does; the editor's body is the one the next
 * save keeps).
 */
export default function TweetInsertHost({ editor, noteId, ticker, noteTitle }) {
  const [open, setOpen] = useState(false)
  const enabled = tweetImportEnabled()
  useEffect(() => {
    if (!editor || !enabled) return undefined
    const onOpen = () => setOpen(true)
    let dom = null
    const detach = () => { if (dom) dom.removeEventListener(TWEET_EVENT, onOpen); dom = null }
    const attach = () => {
      if (editor.isDestroyed) return
      const next = editor.view?.dom
      if (!next || next === dom) return
      detach()
      dom = next
      dom.addEventListener(TWEET_EVENT, onOpen)
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
    if (!editor || editor.isDestroyed) return
    const inDoc = new Set()
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'documentExcerpt') inDoc.add(n.attrs.excerptId)
      return true
    })
    // One card per excerpt: a post already here stays where the member put it.
    const nodes = []
    for (const excerpt of out?.excerpts || []) {
      if (!excerpt?.id || inDoc.has(excerpt.id)) continue
      inDoc.add(excerpt.id)
      nodes.push({ type: 'documentExcerpt', attrs: { excerptId: excerpt.id } })
    }
    if (nodes.length) editor.chain().focus().insertContentAt(editor.state.selection.to, nodes).run()
  }
  return open ? (
    <Suspense fallback={null}>
      <ImportTweetSheet open={open} onClose={() => setOpen(false)} symbol={ticker || ''}
        fixedNoteId={noteId} noteTitle={noteTitle} onSaved={onSaved} />
    </Suspense>
  ) : null
}
