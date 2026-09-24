import { Node, Extension, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

/**
 * Wave 6 item 5 — side-by-side columns.
 *
 *   columns   block container, content `column{2,3}` — two or three columns
 *   column    content `block+`, isolating (the caret never leaks out of one)
 *
 * At ≤640px the columns stack (noteContent.css); nothing about the document
 * changes with the screen.
 *
 * ⛔ COLUMNS NEVER NEST. A column holds blocks, and `columns` is a block, so
 * the schema alone would allow it — and a column inside a column is unreadable
 * at any width. Enforced at the one place every change passes: a transaction
 * whose document would hold columns inside columns is REFUSED (`noNesting`).
 * The doors that would otherwise hit that refusal are handled before it:
 * the slash menu does not offer Columns inside a column, and a paste into a
 * column spills any columns it carries into plain blocks
 * (pasteContainers.js). A DRAG of a columns block into a column is simply
 * refused — the block stays where it was, whole.
 *
 * Both types are rows in the citation tables (containers: no text of their
 * own) and are registered at schema 2; both are PASTE_CONTAINERS.
 */
export const COLUMN_COUNTS = Object.freeze([2, 3])

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'uctColumn' }), 0]
  },
})

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns', class: 'uctColumns' }), 0]
  },
})

/** Is this resolved position inside a column? */
export function inColumn($pos) {
  if (!$pos) return false
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type.name === 'column') return true
  }
  return false
}

/** Does `doc` hold columns inside columns anywhere? */
export function hasNestedColumns(doc) {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.type.name === 'columns') {
      node.descendants((inner) => {
        if (inner.type.name === 'columns') found = true
        return !found
      })
      return false
    }
    return true
  })
  return found
}

/**
 * Insert `count` columns (2 or 3) at the selection, each holding one empty
 * paragraph, with the caret in the first. Refused inside a column (no
 * nesting) and on a read-only editor.
 */
export function insertColumns(editor, count = 2, range = null) {
  if (!editor || !editor.isEditable || !COLUMN_COUNTS.includes(count)) return false
  const { state } = editor
  if (inColumn(state.selection.$from)) return false
  const { schema } = state
  const node = schema.nodes.columns.create(null,
    Array.from({ length: count }, () => schema.nodes.column.create(null, schema.nodes.paragraph.create())))
  let chain = editor.chain().focus()
  if (range) chain = chain.deleteRange(range)
  const ok = chain.insertContent(node.toJSON()).run()
  if (!ok) return false
  // The caret into the first column's paragraph: insertContent leaves the
  // selection just AFTER what it inserted, so the inserted columns are the
  // last columns node that starts before it.
  const after = editor.state
  let target = null
  after.doc.descendants((n, pos) => {
    if (pos >= after.selection.from) return false
    if (n.type.name === 'columns') target = pos + 3 // columns open, column open, paragraph open
    return true
  })
  if (target != null && target <= after.doc.content.size) {
    editor.view.dispatch(after.tr.setSelection(TextSelection.create(after.doc, target)))
  }
  return true
}

/** The rule itself: a transaction that would nest columns is refused. */
export const ColumnsGuard = Extension.create({
  name: 'columnsGuard',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('uctColumnsGuard'),
      filterTransaction: (tr) => !tr.docChanged || !hasNestedColumns(tr.doc),
    })]
  },
})
