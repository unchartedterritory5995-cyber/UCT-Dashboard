/**
 * Wave B find-in-note — the TipTap extension. Wave 5 adds REPLACE.
 *
 * Highlighting is a ProseMirror `Decoration` (this file's plugin state),
 * NEVER document content: a decoration is a render-only overlay ProseMirror
 * keeps entirely separate from `doc` — it is structurally impossible for it
 * to reach `editor.getJSON()`/`getHTML()`, which is what "ephemeral, never
 * persisted" means here (not a convention to remember, a property of the
 * data structure). Match-finding itself is the pure `findMatchesInDoc`
 * (./noteFind.js) — this file is only the ProseMirror plumbing around it.
 *
 * Replace (Wave 5) is the one part that DOES edit the document, and it edits
 * only through ordinary transactions on the member's own history:
 *  - a match lies inside ONE text node, so its replacement carries exactly
 *    that node's marks (bold stays bold, a highlight stays highlighted) and
 *    never spans a block edge — inside a callout, a toggle or an inserted Ask
 *    answer it is an in-block edit, which askInsertNode.jsx's filter allows;
 *  - an empty replacement is `tr.delete(from, to)`: exactly the match, and
 *    an emptied paragraph stays as an empty paragraph;
 *  - Replace all is ONE transaction, closed off from the typing before it
 *    (`closeHistory`), so a single undo restores every match at once.
 * After every replace the matches are re-found on the new document.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { closeHistory } from '@tiptap/pm/history'
import { findMatchesInDoc, nextMatchIndex, prevMatchIndex } from './noteFind'

export const noteFindPluginKey = new PluginKey('noteFind')

function decorationsFor(doc, matches, activeIndex) {
  const decos = matches.map((m, i) => Decoration.inline(m.from, m.to, {
    class: i === activeIndex ? 'uct-find-match uct-find-match-active' : 'uct-find-match',
  }))
  return DecorationSet.create(doc, decos)
}

/** Replace [from, to) with `text`, carrying the matched text's own marks. */
function replaceText(tr, from, to, text) {
  if (!text) {
    tr.delete(from, to)
    return
  }
  const marks = tr.doc.nodeAt(from)?.marks || []
  tr.replaceWith(from, to, tr.doc.type.schema.text(text, marks))
}

export const NoteFind = Extension.create({
  name: 'noteFind',

  addStorage() {
    return { term: '', caseSensitive: false, matches: [], activeIndex: -1, lastReplaced: 0 }
  },

  addCommands() {
    const search = (doc) => findMatchesInDoc(doc, this.storage.term, { caseSensitive: this.storage.caseSensitive })
    const publish = (tr, dispatch) => {
      if (dispatch) dispatch(tr.setMeta(noteFindPluginKey, { matches: this.storage.matches, activeIndex: this.storage.activeIndex }))
    }
    return {
      noteFindSet: (term, opts = {}) => ({ editor, tr, dispatch }) => {
        this.storage.term = term
        if (typeof opts.caseSensitive === 'boolean') this.storage.caseSensitive = opts.caseSensitive
        const matches = search(editor.state.doc)
        this.storage.matches = matches
        this.storage.activeIndex = matches.length ? 0 : -1
        publish(tr, dispatch)
        return true
      },
      noteFindNext: () => ({ tr, dispatch }) => {
        const idx = nextMatchIndex(this.storage.matches.length, this.storage.activeIndex)
        this.storage.activeIndex = idx
        publish(tr, dispatch)
        return idx !== -1
      },
      noteFindPrev: () => ({ tr, dispatch }) => {
        const idx = prevMatchIndex(this.storage.matches.length, this.storage.activeIndex)
        this.storage.activeIndex = idx
        publish(tr, dispatch)
        return idx !== -1
      },
      noteFindClear: () => ({ tr, dispatch }) => {
        this.storage.term = ''
        this.storage.matches = []
        this.storage.activeIndex = -1
        publish(tr, dispatch)
        return true
      },
      /**
       * Replace the ACTIVE match, then make the next match after it active
       * (never a match inside the text just written, so "a" -> "aa" advances).
       * False when there is nothing to replace or the editor is read-only.
       */
      noteFindReplace: (replacement = '') => ({ editor, tr, dispatch }) => {
        if (!editor.isEditable) return false
        // ⛔ Stored matches go stale the moment the member types elsewhere
        // (they are only re-found when the term changes), and a stale range
        // addresses different text. So the matches are re-found on the doc
        // as it is NOW, and a replace only ever writes over the match the bar
        // is SHOWING as active; if that match moved, the next one is made
        // active instead and nothing is written until the member asks again.
        const shown = this.storage.matches[this.storage.activeIndex]
        const fresh = search(tr.doc)
        const exact = shown ? fresh.findIndex((x) => x.from === shown.from && x.to === shown.to) : -1
        if (exact === -1) {
          if (dispatch) {
            this.storage.matches = fresh
            const after = shown ? fresh.findIndex((x) => x.from >= shown.from) : 0
            this.storage.activeIndex = fresh.length ? (after === -1 ? 0 : after) : -1
            publish(tr, dispatch)
          }
          return false
        }
        const m = fresh[exact]
        if (!dispatch) return true
        const text = String(replacement ?? '')
        closeHistory(tr)
        replaceText(tr, m.from, m.to, text)
        const resumeAt = m.from + text.length
        const next = search(tr.doc)
        this.storage.matches = next
        const after = next.findIndex((x) => x.from >= resumeAt)
        this.storage.activeIndex = next.length ? (after === -1 ? 0 : after) : -1
        publish(tr, dispatch)
        return true
      },
      /**
       * Replace EVERY match in one transaction — one undo step. Matches are
       * written back to front, so no replacement shifts one not yet written.
       * The count replaced is left in storage (`lastReplaced`) for the bar.
       */
      noteFindReplaceAll: (replacement = '') => ({ editor, tr, dispatch }) => {
        if (!editor.isEditable) return false
        // Re-found NOW, never the stored set (see noteFindReplace).
        const matches = search(tr.doc)
        if (!matches.length) return false
        if (!dispatch) return true
        const text = String(replacement ?? '')
        closeHistory(tr)
        for (let i = matches.length - 1; i >= 0; i -= 1) replaceText(tr, matches[i].from, matches[i].to, text)
        this.storage.lastReplaced = matches.length
        const next = search(tr.doc)
        this.storage.matches = next
        this.storage.activeIndex = next.length ? 0 : -1
        publish(tr, dispatch)
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: noteFindPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const meta = tr.getMeta(noteFindPluginKey)
            if (meta) return decorationsFor(tr.doc, meta.matches, meta.activeIndex)
            // No meta this transaction: a normal edit. Re-map existing
            // decorations across the edit so they don't visually drift out
            // of place, but re-searching happens only when the caller
            // re-issues noteFindSet (e.g. the find bar's own onChange).
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})
