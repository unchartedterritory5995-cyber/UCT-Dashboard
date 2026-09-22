/**
 * G-035 (competitive-gap-ledger) — the narrowed placeholder extension.
 *
 * ⚰️⚰️ WHY THIS EXISTS, MEASURED, NOT GUESSED. `@tiptap/extension-placeholder`
 * (a thin re-export of `Placeholder` from `@tiptap/extensions`) registers a
 * `view(view) { ... }` plugin-view whose `update(_, prevState)` calls
 * `getViewportBoundaryPositions()` -- TWO `view.posAtCoords()` calls -- every
 * time `doc.content.size` changes, i.e. on essentially every keystroke. That
 * function only exists to support `showOnlyCurrent: false` (decorate EVERY
 * empty node, so the plugin culls to the visible viewport to avoid a
 * full-document walk of off-screen nodes).
 *
 * Notebook has never configured that option -- `buildExtensions()` calls
 * `Placeholder.configure({ placeholder })`, so `showOnlyCurrent` stays at its
 * DEFAULT, `true`. Under `showOnlyCurrent: true` the library's own
 * `decorations` prop takes a completely different, O(depth) branch
 * (`doc.resolve(anchor)`, decorate just the current textblock if empty) and
 * NEVER reads the viewport positions the plugin-view computed. Notebook was
 * paying for a computation whose result it structurally never consumes.
 *
 * On the ledger's own worst-case note (8,100 paragraphs, ~930KB, the
 * MAX_BODY_JSON_BYTES ceiling), `view.posAtCoords()` resolves through
 * `caretPositionFromPoint`/`getClientRects` on an UNVIRTUALIZED ~8,100-node
 * DOM -- exactly the two calls a CDP JS-CPU-profile of a real typing burst
 * showed hot, with the real (unminified) call stack:
 *   getViewportBoundaryPositions -> view.posAtCoords -> caretPositionFromPoint
 * A/B measured in a real Chromium tab (this file absent vs. present, same
 * 8,100-paragraph note, same burst, same rig):
 *
 *               END of note        START of note
 *   WITH Placeholder    89.7-98.1 ms/char   70.2-74.6 ms/char
 *   WITHOUT (this file) 54.9-61.3 ms/char   49.2-50.0 ms/char
 *
 * ~35-40ms/char recovered at the end of the note (the ledger's own measured
 * case), zero decoration-output change (see the header of the test file next
 * to this one). The REMAINING ~50-61ms/char is ProseMirror's own
 * `scrollToSelection` -> `coordsAtPos` (confirmed via the SAME profiled call
 * stack: `coordsAtPos -> scrollToSelection -> updateStateInner`, core
 * `prosemirror-view`, not this file) -- genuinely not ours to fix; out of
 * scope here.
 *
 * This file is EXACTLY the `showOnlyCurrent: true, includeChildren: false`
 * branch of `@tiptap/extensions`' `Placeholder.addProseMirrorPlugins()`
 * `decorations` prop, copied so its OUTPUT is unchanged -- no `view()`
 * plugin-view, no scroll listener, no viewport-boundary computation, because
 * Notebook never reads what that machinery produces. `isNodeEmpty` is
 * imported from `@tiptap/core`'s own public surface (stable, documented
 * export) rather than reimplemented.
 *
 * ⛔ If Notebook ever needs `showOnlyCurrent: false` (a placeholder in every
 * empty paragraph, not just the focused one), this narrowed extension is the
 * wrong tool -- go back to the stock `@tiptap/extension-placeholder`, which
 * still works for that mode (its viewport culling exists precisely because
 * that mode CAN touch the whole document).
 *
 * ⛔⛔ ONE SURVIVING SIDE EFFECT FROM THE ORIGINAL `view()`, KEPT ON PURPOSE.
 * A brand-new `EditorView` resolves `.focus('end')` against a doc ending in
 * an atom (e.g. `widgetEmbed`) to a NodeSelection ON that atom, not a text
 * position after it, UNTIL at least one transaction has been dispatched.
 * Reproduced with NO placeholder extension of any kind (a bare
 * StarterKit+WidgetEmbed editor) -- this is a pre-existing ProseMirror/TipTap
 * property, unrelated to either placeholder implementation. Stock
 * `@tiptap/extension-placeholder`'s `view()` supplied that first transaction
 * as an incidental side effect of `computeAndDispatch()` firing once,
 * unconditionally, at construction (its own comment: "Fire once to populate
 * initial viewport (bypass throttle)") -- and `widgetEmbedInsert.test.jsx`'s
 * "focus('end') appends after a trailing embed instead of replacing it" (a
 * real P5-audit finding) was, it turns out, ALSO relying on that side effect
 * without anyone intending it to. Deleting `view()` outright breaks that
 * test: confirmed by reverting this one block and watching it fail with the
 * SPY embed silently replaced by the newly-inserted one instead of both
 * surviving -- exactly the NodeSelection-swallows-insert bug the test exists
 * to catch, just from an unrelated cause. This keeps JUST that one dispatch
 * -- fired once, at construction, never again -- so callers that (knowingly
 * or not) depended on "some transaction has already happened" keep working,
 * while the per-keystroke `update()`/`posAtCoords` cost stays gone.
 */
import { Extension, isNodeEmpty } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const NOTEBOOK_PLACEHOLDER_PLUGIN_KEY = new PluginKey('notebookPlaceholder')

/** Mirrors `@tiptap/extensions`' internal `createPlaceholderDecoration` byte
 *  for byte (same class list, same data-attribute), so switching to this
 *  extension changes nothing about what a member sees or what existing CSS
 *  (`.proseEditor p.is-editor-empty:first-child::before`) matches against. */
function placeholderDecoration({ editor, placeholder, dataAttribute, pos, node, isEmptyDoc, hasAnchor, classes: { emptyNode, emptyEditor } }) {
  const cls = [emptyNode]
  if (isEmptyDoc) cls.push(emptyEditor)
  return Decoration.node(pos, pos + node.nodeSize, {
    class: cls.join(' '),
    [dataAttribute]: typeof placeholder === 'function'
      ? placeholder({ editor, node, pos, hasAnchor })
      : placeholder,
  })
}

export const NotebookPlaceholder = Extension.create({
  name: 'notebookPlaceholder',

  addOptions() {
    return {
      emptyEditorClass: 'is-editor-empty',
      emptyNodeClass: 'is-empty',
      dataAttribute: 'placeholder',
      placeholder: 'Write something …',
      showOnlyWhenEditable: true,
    }
  },

  addProseMirrorPlugins() {
    const dataAttribute = `data-${this.options.dataAttribute}`

    return [
      new Plugin({
        key: NOTEBOOK_PLACEHOLDER_PLUGIN_KEY,
        // See the "ONE SURVIVING SIDE EFFECT" block in the header comment.
        // ⛔ No `update()`, no `destroy()`, no scroll listener -- this view
        // does the ONE dispatch and nothing else, ever. That is what makes it
        // O(1) per editor instance rather than O(1) per keystroke.
        view(editorView) {
          editorView.dispatch(editorView.state.tr.setMeta(NOTEBOOK_PLACEHOLDER_PLUGIN_KEY, 'mount'))
          return {}
        },
        props: {
          decorations: ({ doc, selection }) => {
            const active = this.editor.isEditable || !this.options.showOnlyWhenEditable
            if (!active) return null

            const { anchor } = selection
            const isEmptyDoc = this.editor.isEmpty
            const resolved = doc.resolve(anchor)
            if (resolved.depth === 0) return DecorationSet.create(doc, [])

            const node = resolved.node(1)
            const nodeStart = resolved.before(1)
            if (!node.type.isTextblock || !isNodeEmpty(node)) return DecorationSet.create(doc, [])

            const hasAnchor = anchor >= nodeStart && anchor <= nodeStart + node.nodeSize
            const decoration = placeholderDecoration({
              editor: this.editor,
              placeholder: this.options.placeholder,
              dataAttribute,
              pos: nodeStart,
              node,
              isEmptyDoc,
              hasAnchor,
              classes: { emptyNode: this.options.emptyNodeClass, emptyEditor: this.options.emptyEditorClass },
            })
            return DecorationSet.create(doc, [decoration])
          },
        },
      }),
    ]
  },
})
