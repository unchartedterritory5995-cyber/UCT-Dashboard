/**
 * Wave 5 fix round 1 (S3) — "the note's words changed", whatever door changed
 * them.
 *
 * ⛔ TipTap's `update` event skips any transaction marked `preventUpdate`, and
 * the editor page swaps a note's whole content exactly that way (history
 * restore, draft restore, queued-words adoption, conflict reload, note sync —
 * `setContent(…, { emitUpdate: false })`). A readout listening on `update`
 * therefore goes stale precisely when the content changed most: the word
 * count kept the old note's number and the outline kept listing headings that
 * no longer existed, so a click on one was dead.
 *
 * This listens on `transaction` — which every applied change emits — and asks
 * the transaction itself (or anything appended to it) whether the document
 * moved. A caret move or a stored-mark change is not a change. Returns the
 * unsubscribe.
 */
export function onDocChange(editor, fn) {
  const handler = ({ transaction, appendedTransactions }) => {
    if (transaction?.docChanged || appendedTransactions?.some((t) => t.docChanged)) fn()
  }
  editor.on('transaction', handler)
  return () => editor.off('transaction', handler)
}
