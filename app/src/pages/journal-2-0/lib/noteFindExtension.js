/**
 * Wave B find-in-note — the TipTap extension.
 *
 * Highlighting is a ProseMirror `Decoration` (this file's plugin state),
 * NEVER document content: a decoration is a render-only overlay ProseMirror
 * keeps entirely separate from `doc` — it is structurally impossible for it
 * to reach `editor.getJSON()`/`getHTML()`, which is what "ephemeral, never
 * persisted" means here (not a convention to remember, a property of the
 * data structure). Match-finding itself is the pure `findMatchesInDoc`
 * (./noteFind.js) — this file is only the ProseMirror plumbing around it.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findMatchesInDoc, nextMatchIndex, prevMatchIndex } from './noteFind'

export const noteFindPluginKey = new PluginKey('noteFind')

function decorationsFor(doc, matches, activeIndex) {
  const decos = matches.map((m, i) => Decoration.inline(m.from, m.to, {
    class: i === activeIndex ? 'uct-find-match uct-find-match-active' : 'uct-find-match',
  }))
  return DecorationSet.create(doc, decos)
}

export const NoteFind = Extension.create({
  name: 'noteFind',

  addStorage() {
    return { term: '', matches: [], activeIndex: -1 }
  },

  addCommands() {
    return {
      noteFindSet: (term) => ({ editor, tr, dispatch }) => {
        const matches = findMatchesInDoc(editor.state.doc, term)
        this.storage.term = term
        this.storage.matches = matches
        this.storage.activeIndex = matches.length ? 0 : -1
        if (dispatch) {
          dispatch(tr.setMeta(noteFindPluginKey, {
            matches, activeIndex: this.storage.activeIndex,
          }))
        }
        return true
      },
      noteFindNext: () => ({ tr, dispatch }) => {
        const idx = nextMatchIndex(this.storage.matches.length, this.storage.activeIndex)
        this.storage.activeIndex = idx
        if (dispatch) dispatch(tr.setMeta(noteFindPluginKey, { matches: this.storage.matches, activeIndex: idx }))
        return idx !== -1
      },
      noteFindPrev: () => ({ tr, dispatch }) => {
        const idx = prevMatchIndex(this.storage.matches.length, this.storage.activeIndex)
        this.storage.activeIndex = idx
        if (dispatch) dispatch(tr.setMeta(noteFindPluginKey, { matches: this.storage.matches, activeIndex: idx }))
        return idx !== -1
      },
      noteFindClear: () => ({ tr, dispatch }) => {
        this.storage.term = ''
        this.storage.matches = []
        this.storage.activeIndex = -1
        if (dispatch) dispatch(tr.setMeta(noteFindPluginKey, { matches: [], activeIndex: -1 }))
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
