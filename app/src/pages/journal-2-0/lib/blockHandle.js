import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { mountUIcon } from './uiconDom'

/**
 * Wave 6 item 4 — moving a block: a drag handle, and the keys.
 *
 * THREE DOORS, ONE MOVE:
 *  - DESKTOP: hovering a top-level block shows a grip beside it; dragging the
 *    grip drags THAT block (a NodeSelection, exactly the drag ProseMirror makes
 *    of a selected node).
 *  - TOUCH: hover never fires and HTML5 drag never starts from a finger, so the
 *    grip is shown VISIBLY beside the block the caret is in, and a tap on it
 *    offers "Move up" / "Move down" (44px, the touch tier).
 *  - KEYBOARD: Alt+Shift+↑ / ↓ moves the current block (the grip's menu is the
 *    same two moves, for a mouse that would rather not drag).
 *
 * ⛔⛔ EVERY DROP GOES THROUGH `pasteContainers.handleDrop`. This file never
 * inserts a dragged block itself: dragstart hands prosemirror-view the SAME
 * `view.dragging` a node drag makes ({slice, move: true, node}), and the drop is
 * prosemirror-view's own editHandlers.drop, which asks the handleDrop props —
 * pasteContainers' among them — before anything lands. So the embedId rule (a
 * moved chart keeps its id; pasteContainers.js::freshEmbedIds) and the title
 * rules hold for a handle drag exactly as for any other drag.
 *
 * A keyboard or menu move is one transaction that MOVES the same node — its
 * attrs, an embedId among them, are untouched — and one undo puts it back.
 */
export const BLOCK_HANDLE_KEY = new PluginKey('uctBlockHandle')
export const BLOCK_HANDLE_LABEL = 'Move this block'
export const MOVE_MENU_LABEL = 'Move block'

/** The top-level block at document position `pos`: `{ pos, node, index }`, or null. */
export function topBlockAt(doc, pos) {
  if (!doc || typeof pos !== 'number' || pos < 0 || pos > doc.content.size) return null
  const $pos = doc.resolve(pos)
  if ($pos.depth === 0) {
    const node = $pos.nodeAfter
    return node ? { pos, node, index: $pos.index(0) } : null
  }
  return { pos: $pos.before(1), node: $pos.node(1), index: $pos.index(0) }
}

/** The range of top-level blocks the selection touches: `{ first, last }` indexes. */
function selectedTopRange(state) {
  const { from, to, empty } = state.selection
  const first = state.doc.resolve(from).index(0)
  const last = empty ? first : state.doc.resolve(Math.max(from, to - 1)).index(0)
  return { first, last }
}

/** The document position before top-level child `index`. */
function posOfIndex(doc, index) {
  let pos = 0
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize
  return pos
}

/**
 * Move the top-level block(s) the selection is in one step up (`dir` -1) or
 * down (+1). Returns false — and changes nothing — at the edge of the note or
 * on a read-only editor. The selection travels with the moved blocks.
 */
export function moveBlock(editor, dir) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const { state } = editor
  const { doc } = state
  const { first, last } = selectedTopRange(state)
  const tr = state.tr
  if (dir < 0) {
    if (first === 0) return false
    const prev = doc.child(first - 1)
    const prevPos = posOfIndex(doc, first - 1)
    const rangeEnd = posOfIndex(doc, last + 1)
    tr.delete(prevPos, prevPos + prev.nodeSize)
    tr.insert(rangeEnd - prev.nodeSize, prev)
  } else {
    if (last >= doc.childCount - 1) return false
    const next = doc.child(last + 1)
    const nextPos = posOfIndex(doc, last + 1)
    const rangeStart = posOfIndex(doc, first)
    tr.delete(nextPos, nextPos + next.nodeSize)
    tr.insert(rangeStart, next)
  }
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

const isTouch = () => {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none), (pointer: coarse)').matches
  } catch {
    return false
  }
}

class BlockHandleView {
  constructor(view, editor) {
    this.view = view
    this.editor = editor
    this.block = null // { pos, node } the grip currently stands beside
    this.menu = null

    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className = 'uctBlockHandle'
    handle.setAttribute('draggable', 'true')
    handle.setAttribute('aria-label', BLOCK_HANDLE_LABEL)
    handle.setAttribute('aria-expanded', 'false')
    handle.title = 'Drag to move — or Alt+Shift+↑ / ↓'
    handle.hidden = true
    // The grip's glyph (a UIcon) is mounted the first time the grip is shown:
    // a read-only editor — a preview, a shared page — never pays for one.
    this.glyph = document.createElement('span')
    handle.appendChild(this.glyph)
    this.icon = null
    document.body.appendChild(handle)
    this.handle = handle

    this.onMove = this.onMove.bind(this)
    this.onLeave = this.onLeave.bind(this)
    this.onDragStart = this.onDragStart.bind(this)
    this.onDragEnd = this.onDragEnd.bind(this)
    this.onClick = this.onClick.bind(this)
    this.onOutside = this.onOutside.bind(this)
    this.onScroll = () => this.place()

    view.dom.addEventListener('mousemove', this.onMove)
    view.dom.addEventListener('mouseleave', this.onLeave)
    handle.addEventListener('mouseleave', this.onLeave)
    handle.addEventListener('dragstart', this.onDragStart)
    handle.addEventListener('dragend', this.onDragEnd)
    handle.addEventListener('click', this.onClick)
    window.addEventListener('scroll', this.onScroll, true)
    window.addEventListener('resize', this.onScroll)
  }

  get editable() {
    return this.editor.isEditable && !this.editor.isDestroyed
  }

  // Callers decide editability (onMove refuses, update() hides): one guard
  // each, never a second copy here that no rail could tell from the first.
  show(block) {
    if (!block) { this.hide(); return }
    if (!this.icon) this.icon = mountUIcon(this.glyph, 'menu', { size: 14 })
    this.block = block
    this.handle.hidden = false
    this.handle.dataset.pos = String(block.pos)
    this.place()
  }

  hide() {
    this.closeMenu()
    this.block = null
    this.handle.hidden = true
  }

  place() {
    if (!this.block || this.handle.hidden) return
    let dom = null
    try { dom = this.view.nodeDOM(this.block.pos) } catch { dom = null }
    const rect = dom && typeof dom.getBoundingClientRect === 'function' ? dom.getBoundingClientRect() : null
    if (!rect) return
    const w = this.handle.offsetWidth || 24
    this.handle.style.left = `${Math.max(0, Math.round(rect.left - w - 6))}px`
    this.handle.style.top = `${Math.round(rect.top + 2)}px`
  }

  onMove(e) {
    if (isTouch() || !this.editable) return
    let found = null
    try { found = this.view.posAtCoords({ left: e.clientX, top: e.clientY }) } catch { found = null }
    if (!found) return
    const block = topBlockAt(this.view.state.doc, found.inside >= 0 ? found.inside : found.pos)
    if (block && (!this.block || block.pos !== this.block.pos)) this.show(block)
  }

  onLeave(e) {
    if (isTouch() || this.menu) return
    const to = e.relatedTarget
    if (to && (this.handle.contains(to) || this.view.dom.contains(to))) return
    this.hide()
  }

  onDragStart(e) {
    if (!this.block || !this.editable) { e.preventDefault(); return }
    this.closeMenu()
    const { view } = this
    const sel = NodeSelection.create(view.state.doc, this.block.pos)
    view.dispatch(view.state.tr.setSelection(sel))
    const slice = view.state.selection.content()
    const { dom, text } = view.serializeForClipboard(slice)
    if (e.dataTransfer) {
      e.dataTransfer.clearData?.()
      e.dataTransfer.setData('text/html', dom.innerHTML)
      e.dataTransfer.setData('text/plain', text)
      e.dataTransfer.effectAllowed = 'copyMove'
      const blockDom = view.nodeDOM(this.block.pos)
      if (blockDom && typeof e.dataTransfer.setDragImage === 'function') e.dataTransfer.setDragImage(blockDom, 0, 0)
    }
    // ⛔ The drag ProseMirror itself makes of a selected node: its own drop
    // handler reads exactly these three, and asks handleDrop before inserting.
    this.dragging = { slice, move: true, node: view.state.selection }
    view.dragging = this.dragging
  }

  onDragEnd() {
    // The grip is outside the editor, so prosemirror-view never sees this
    // dragend; clear a drag the drop did not consume (dropped outside), the way
    // its own dragend handler does.
    const d = this.dragging
    this.dragging = null
    setTimeout(() => { if (this.view.dragging === d) this.view.dragging = null }, 50)
  }

  onClick() {
    if (!this.block || !this.editable) return
    if (this.menu) { this.closeMenu(); return }
    this.openMenu()
  }

  openMenu() {
    const { view } = this
    // The moves act on the block beside the grip: select it first.
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, this.block.pos)))
    const menu = document.createElement('div')
    menu.className = 'uctBlockMoveMenu'
    menu.setAttribute('role', 'group')
    menu.setAttribute('aria-label', MOVE_MENU_LABEL)
    const { index } = topBlockAt(view.state.doc, this.block.pos) || { index: 0 }
    const add = (label, dir, disabled) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'uctBlockMoveOption'
      b.textContent = label
      b.disabled = disabled
      b.addEventListener('mousedown', (ev) => ev.preventDefault())
      b.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const moved = moveBlock(this.editor, dir)
        this.closeMenu()
        if (moved) {
          const sel = this.view.state.selection
          this.show(topBlockAt(this.view.state.doc, sel.from))
          this.handle.focus()
        }
      })
      menu.appendChild(b)
    }
    add('Move up', -1, index === 0)
    add('Move down', 1, index >= view.state.doc.childCount - 1)
    menu.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        this.closeMenu()
        this.handle.focus()
      }
    })
    // A sibling of the grip, never inside it: a button may not hold buttons.
    document.body.appendChild(menu)
    const r = this.handle.getBoundingClientRect()
    menu.style.left = `${Math.round(r.left)}px`
    menu.style.top = `${Math.round(r.bottom + 4)}px`
    this.menu = menu
    this.handle.setAttribute('aria-expanded', 'true')
    document.addEventListener('mousedown', this.onOutside, true)
    menu.querySelector('button:not([disabled])')?.focus()
  }

  closeMenu() {
    if (!this.menu) return
    this.menu.remove()
    this.menu = null
    this.handle.setAttribute('aria-expanded', 'false')
    document.removeEventListener('mousedown', this.onOutside, true)
  }

  onOutside(e) {
    if (this.menu && !this.handle.contains(e.target) && !this.menu.contains(e.target)) this.closeMenu()
  }

  update(view) {
    this.view = view
    if (!this.editable) { this.hide(); return }
    if (isTouch()) {
      // Touch: the grip stands beside the block the caret is in, visibly.
      if (!view.hasFocus() && !this.menu) { this.hide(); return }
      const block = topBlockAt(view.state.doc, view.state.selection.from)
      if (this.menu && this.block && block && block.pos === this.block.pos) { this.place(); return }
      this.show(block)
      return
    }
    // Desktop: keep the grip where it is, unless its block moved or went.
    if (this.block) {
      const still = topBlockAt(view.state.doc, this.block.pos)
      if (!still || still.pos !== this.block.pos) this.hide()
      else { this.block = still; this.place() }
    }
  }

  destroy() {
    this.closeMenu()
    this.view.dom.removeEventListener('mousemove', this.onMove)
    this.view.dom.removeEventListener('mouseleave', this.onLeave)
    window.removeEventListener('scroll', this.onScroll, true)
    window.removeEventListener('resize', this.onScroll)
    this.icon?.destroy()
    this.handle.remove()
  }
}

export const BlockHandle = Extension.create({
  name: 'blockHandle',
  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': () => moveBlock(this.editor, -1),
      'Alt-Shift-ArrowDown': () => moveBlock(this.editor, 1),
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({ key: BLOCK_HANDLE_KEY, view: (view) => new BlockHandleView(view, editor) })]
  },
})
