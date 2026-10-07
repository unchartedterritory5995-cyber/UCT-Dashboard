import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Toggle — Notion's other most-common structural block (see `calloutNode.js`
 * for the callout half and the shared rationale). Notion's classic Markdown
 * export represents a toggle as `<details><summary>title</summary>body</
 * details>` — corroborated by this repo's own `__fixtures__/notion/…/My
 * Page….md` fixture and the notion adapter's own docstring ("`<aside>`/
 * `<details>` HTML islands pass straight through" — for "the converter",
 * i.e. this module + `importer/convert.js`, to handle). `notion.js` needs no
 * change: it already preserves the `<details>`/`<summary>` tags untouched.
 *
 * Three node types, mirroring this file's own Table/TableRow/TableCell
 * pattern (`tiptap.js`) rather than inventing a single mega-node:
 *   - `toggle` (wrapper; owns `open` + the chevron control)
 *   - `toggleSummary` (real inline content — undo/redo, IME, marks all work
 *     normally, unlike a hand-rolled contenteditable attribute field)
 *   - `toggleContent` (the collapsible body; `block+`)
 * `importer/convert.js::mapCalloutsAndToggles` restructures a raw
 * `<details>` into this exact shape (synthesizing an empty `<summary>` if the
 * source lacks one) before `generateJSON` runs, and force-opens every
 * imported toggle (`data-open="true"`) — a freshly imported library should
 * read as "everything arrived", not require clicking every toggle to check.
 *
 * Real `<details>`/`<summary>` tags are used for `toggle`/`toggleSummary`'s
 * DOM (matching Notion's own shape, and giving native find-in-page /
 * print behavior for free), but the browser's default "click anywhere on
 * `<summary>` toggles `open`" action is suppressed in the node view — it
 * would otherwise collapse the block out from under a member clicking into
 * the summary text to edit it. The chevron button is the ONLY control that
 * changes `open`; it lives OUTSIDE `<summary>`'s contentDOM so it can never
 * conflict with ProseMirror's content model for that node (touch target
 * enforced in NoteEditorPage.module.css: 22px desktop, 44px at the ≤1024px
 * touch tier per this codebase's canonical breakpoint, never 640px).
 */

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
  'focusable="false"><path d="M9.5 6l6 6-6 6"/></svg>'

export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  parseHTML() {
    return [{ tag: 'summary' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes), 0]
  },
})

export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  parseHTML() {
    return [{ tag: 'div[data-type="toggleContent"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggleContent' }), 0]
  },
})

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => {
          const explicit = el.getAttribute('data-open')
          if (explicit != null) return explicit !== 'false'
          return el.hasAttribute('open')
        },
        renderHTML: (attrs) => ({ 'data-open': attrs.open === false ? 'false' : 'true' }),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="toggle"]' },
      { tag: 'details' },
    ]
  },

  // Static fallback DOMOutputSpec — used when no node view is mounted (e.g.
  // generateHTML for export/preview paths). Mirrors the node view's real DOM
  // exactly: a real <details> whose first two children are toggleSummary's
  // and toggleContent's own rendered output, in schema order.
  renderHTML({ node, HTMLAttributes }) {
    const extra = { 'data-type': 'toggle' }
    if (node.attrs.open) extra.open = ''
    return ['details', mergeAttributes(HTMLAttributes, extra), 0]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div')
      dom.className = 'uctToggle'
      dom.setAttribute('data-type', 'toggle')

      const chevron = document.createElement('button')
      chevron.type = 'button'
      chevron.className = 'uctToggleChevron'
      chevron.contentEditable = 'false'
      chevron.innerHTML = CHEVRON_SVG
      // Keep the editor from stealing selection/focus on press (same guard
      // VideoTimestamp uses for its own chip button).
      chevron.addEventListener('mousedown', (e) => e.preventDefault())
      chevron.addEventListener('click', () => {
        if (typeof getPos !== 'function') return
        const pos = getPos()
        if (typeof pos !== 'number') return
        const current = editor.state.doc.nodeAt(pos)
        const isOpen = current ? !!current.attrs.open : !!node.attrs.open
        editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'open', !isOpen))
      })

      const details = document.createElement('details')
      details.className = 'uctToggleDetails'
      // The native "click <summary> to toggle `open`" default fires even
      // inside a contenteditable summary (positioning a cursor there would
      // otherwise collapse/expand the block). The chevron above is the only
      // way `open` changes.
      details.addEventListener('click', (e) => {
        if (e.target.closest('summary')) e.preventDefault()
      })

      dom.appendChild(chevron)
      dom.appendChild(details)

      const sync = (n) => {
        const open = !!n.attrs.open
        dom.setAttribute('data-open', String(open))
        details.open = open
        chevron.setAttribute('aria-expanded', String(open))
        chevron.setAttribute('aria-label', open ? 'Collapse toggle' : 'Expand toggle')
      }
      sync(node)

      return {
        dom,
        contentDOM: details,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false
          node = updatedNode
          sync(node)
          return true
        },
      }
    }
  },
})
