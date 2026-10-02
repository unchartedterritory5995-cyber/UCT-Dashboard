import { Node, mergeAttributes } from '@tiptap/core'
import { readStoredBoard, sortedLevels, fmtPrice, tfLabel } from './tradeCanvas'

/**
 * Wave 11 lane 11D — the `tradeCanvas` node: a trade-plan canvas's whole board,
 * held in ONE block atom's attributes (`board`, plus the `searchText` the board
 * derives at every commit — what search, Ask and the mentions index read).
 *
 * ⛔⛔ REGISTERED AT SCHEMA LEVEL 3 AND NEVER REVERTED (lib/notebookSchema.js ⇄
 * notebook_schema.py). An editor without this node opens a canvas note EMPTY
 * and its next save writes the empty document over the plan; level 3 makes the
 * server refuse that write. So this node is registered UNCONDITIONALLY — the
 * feature's flag gates the doors that make a canvas and the board's editing,
 * never the schema, or a flag-off tab would declare level 2 and be refused on
 * every note that holds one.
 *
 * The Notebook never edits a canvas through this node: `NoteEditorPage` renders
 * the board (`TradeCanvasBoard`) in place of the text editor, and the board's
 * every change is one transaction on this node's attributes. This node view is
 * what anything ELSE that renders the body shows — a version preview, a note
 * pasted into, an older layout — a compact summary, never an editable surface.
 */
export const TRADE_CANVAS_LABEL = 'Trade-plan canvas'

function summaryLines(board) {
  const charts = board.items.filter((i) => i.kind === 'chart')
  const cards = board.items.length - charts.length
  const head = [
    `${board.items.length} item${board.items.length === 1 ? '' : 's'}`,
    board.levels.length ? `${board.levels.length} level${board.levels.length === 1 ? '' : 's'}` : null,
    board.edges.length ? `${board.edges.length} arrow${board.edges.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ')
  const lines = []
  for (const c of charts.slice(0, 4)) {
    lines.push(`${c.symbol} · ${tfLabel(c.tf)} · ${c.mode === 'frozen' && c.asOf ? `frozen as of ${c.asOf}` : 'live'}`)
  }
  for (const lv of sortedLevels(board.levels).slice(0, 6)) lines.push(`${lv.label}: ${fmtPrice(lv.price)}`)
  if (cards) lines.push(`${cards} card${cards === 1 ? '' : 's'} of notes`)
  return { head, lines }
}

function render(dom, node) {
  const board = readStoredBoard(node.attrs.board)
  const { head, lines } = summaryLines(board)
  dom.textContent = ''
  const title = document.createElement('div')
  title.className = 'uctCanvasNodeTitle'
  title.textContent = `${TRADE_CANVAS_LABEL} — ${head || 'empty'}`
  dom.appendChild(title)
  if (lines.length) {
    const list = document.createElement('ul')
    list.className = 'uctCanvasNodeList'
    for (const l of lines) {
      const li = document.createElement('li')
      li.textContent = l
      list.appendChild(li)
    }
    dom.appendChild(list)
  }
}

export const TradeCanvas = Node.create({
  name: 'tradeCanvas',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      board: {
        default: null,
        parseHTML: (el) => {
          try { return JSON.parse(el.getAttribute('data-board') || 'null') } catch { return null }
        },
        renderHTML: (attrs) => (attrs.board ? { 'data-board': JSON.stringify(attrs.board) } : {}),
      },
      searchText: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-search-text') || '',
        renderHTML: (attrs) => (attrs.searchText ? { 'data-search-text': attrs.searchText } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="trade-canvas"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'trade-canvas' }), TRADE_CANVAS_LABEL]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.setAttribute('data-type', 'trade-canvas')
      dom.setAttribute('role', 'group')
      dom.setAttribute('aria-label', TRADE_CANVAS_LABEL)
      dom.className = 'uctCanvasNode'
      dom.contentEditable = 'false'
      render(dom, node)
      return {
        dom,
        update(next) {
          if (next.type.name !== 'tradeCanvas') return false
          render(dom, next)
          return true
        },
        ignoreMutation: () => true,
      }
    }
  },
})
