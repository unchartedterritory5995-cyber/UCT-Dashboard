// W11-R80 m-3: a note body as the editor will hold it once it is open, computed BY the editor (the one authority:
// the same schema and extensions NoteEditorPage builds, buildExtensions). A detached editor is built on the body and
// its document read back: the schema fills every attribute default, and TipTap's TrailingNode appends the empty
// paragraph it adds after a last block that is not one (it runs on the construction transaction). A note CREATED in
// this form opens without a document change, so its first open writes nothing.
// ⛔ LAZY. Only dynamic imports reach this file (NotebookTab's member-template create): it pulls in the editor.
// In the app it never throws: a body the editor cannot hold is returned as it came (the create then behaves exactly as
// before) and the fallback is reported on the console. Under test it throws (W11-R82), so the fallback is never silent.
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'

export function editorNormalForm(doc) {
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return doc
  let ed = null
  try {
    ed = new Editor({ element: document.createElement('div'), extensions: buildExtensions(), content: doc, editable: false })
    return ed.getJSON()
  } catch (e) {
    // W11-R82: never silent. Falling back sends the body as given, and a template-made note's first open then writes
    // it (the D2 PUT). Under test it THROWS, so a new plain node view or plugin view() that throws is seen
    // (editorNormalForm.test.jsx); in the app it says so on the console and the create still goes ahead.
    if (import.meta.env?.MODE === 'test') throw e
    console.error('[editorNormalForm] the editor could not hold this body; it is created as given', e)
    return doc
  } finally {
    try { ed?.destroy() } catch { /* nothing held */ }
  }
}
