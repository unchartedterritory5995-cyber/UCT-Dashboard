import { Node, mergeAttributes } from '@tiptap/core'
import { outlineBaseLevel, outlineOf } from './noteOutline'
import { onDocChange } from './onDocChange'

/**
 * Wave 6 item 13 — a table of contents INSIDE the note (`/toc`).
 *
 * A `tableOfContents` block atom that lists the note's headings (H1–H6, in
 * order, the same list the Outline panel reads: lib/noteOutline.outlineOf) and
 * keeps that list LIVE as the note changes. Choosing an entry jumps to it the
 * way the Outline does: every collapsed toggle around the heading opens, the
 * caret lands in the heading, and it scrolls into view (`jumpToHeading`).
 *
 * It holds no text of its own: in the citation tables it is a block leaf that
 * reads as nothing (`_LEAF_TYPES`, one position -- every leaf must be there or
 * the walker counts it as a container), with no `_ATOM_TEXT` row. It exports as
 * a Markdown list of links to the headings' anchors (notes_export.py).
 * Registered at schema 2 (a NEW node type).
 */
export const TOC_LABEL = 'Table of contents'
export const TOC_EMPTY = 'No headings yet — add one and it appears here.'
export const TOC_DEBOUNCE_MS = 150

/**
 * Jump to the heading at `pos` as the Outline panel does: open every collapsed
 * toggle around it (attribute steps move no positions), put the caret in it,
 * scroll it into view. False when `pos` is not a heading any more.
 */
export function jumpToHeading(editor, pos) {
  if (!editor || editor.isDestroyed) return false
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'heading') return false
  editor.chain().focus()
    .command(({ tr }) => {
      const $pos = tr.doc.resolve(pos)
      for (let d = $pos.depth; d > 0; d -= 1) {
        const around = $pos.node(d)
        if (around.type.name === 'toggle' && !around.attrs.open) tr.setNodeAttribute($pos.before(d), 'open', true)
      }
      return true
    })
    .setTextSelection(pos + 1)
    .run()
  const dom = editor.view.nodeDOM(pos)
  dom?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  return true
}

function renderList(root, editor) {
  const outline = outlineOf(editor.state.doc)
  root.textContent = ''
  const title = document.createElement('div')
  title.className = 'uctTocTitle'
  title.textContent = 'Contents'
  root.appendChild(title)
  if (!outline.length) {
    const empty = document.createElement('p')
    empty.className = 'uctTocEmpty'
    empty.textContent = TOC_EMPTY
    root.appendChild(empty)
    return
  }
  const base = outlineBaseLevel(outline)
  const list = document.createElement('ol')
  list.className = 'uctTocList'
  outline.forEach((h) => {
    const li = document.createElement('li')
    li.className = 'uctTocItem'
    li.setAttribute('data-level', String(h.level))
    li.style.paddingLeft = `${(h.level - base) * 14}px`
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'uctTocLink'
    btn.textContent = h.text || 'Untitled heading'
    // The heading is found again by position AT CLICK TIME from a fresh walk
    // (the list may be a debounce behind the note): same index, same text.
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', () => {
      const fresh = outlineOf(editor.state.doc)
      const i = outline.indexOf(h)
      const target = (fresh[i] && fresh[i].text === h.text)
        ? fresh[i]
        : fresh.find((f) => f.text === h.text && f.level === h.level)
      if (target) jumpToHeading(editor, target.pos)
      else renderList(root, editor)
    })
    li.appendChild(btn)
    list.appendChild(li)
  })
  root.appendChild(list)
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'table-of-contents' })]
  },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('nav')
      dom.setAttribute('data-type', 'table-of-contents')
      dom.setAttribute('aria-label', TOC_LABEL)
      dom.className = 'uctToc'
      dom.contentEditable = 'false'
      renderList(dom, editor)
      let timer = null
      const off = onDocChange(editor, () => {
        clearTimeout(timer)
        timer = setTimeout(() => { if (!editor.isDestroyed) renderList(dom, editor) }, TOC_DEBOUNCE_MS)
      })
      return {
        dom,
        destroy() {
          clearTimeout(timer)
          off()
        },
      }
    }
  },
})

/** `/toc`: insert a table of contents at the slash's range. */
export function insertTableOfContents(editor, range = null) {
  if (!editor || !editor.isEditable) return false
  let chain = editor.chain().focus()
  if (range) chain = chain.deleteRange(range)
  return chain.insertContent({ type: 'tableOfContents' }).run()
}
