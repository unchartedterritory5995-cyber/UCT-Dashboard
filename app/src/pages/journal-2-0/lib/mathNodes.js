/**
 * Wave 5 — math in a note: `inlineMath` (inside a sentence) and `blockMath`
 * (a displayed equation), both leaves holding their LaTeX source in `latex`.
 *
 * ⛔ NOT @tiptap/extension-mathematics, and the reasons are measured, not taste:
 *  1. Its inline input rule is the regex LITERAL /(?<!\$)(\$\$([^$\n]+?)\$\$)(?!\$)/.
 *     A lookbehind does not exist before Safari 16.4, and this app's declared
 *     floor is iOS 16 (vite.config.js build.target). esbuild lowers such a
 *     literal to `new RegExp(...)` (this build already does it for one in
 *     TeamSection), which moves the SyntaxError from parse time to the moment
 *     the rule is constructed — editor creation — so on iOS 16.0-16.3 no note
 *     would open. Every regex below is lookbehind-free, and a rail says so.
 *  2. It imports KaTeX STATICALLY into every node view, putting ~270 KB of
 *     KaTeX in the chunk every note opens with. Here KaTeX is only ever reached
 *     through `import()` (./katexRender.js): a note without math never loads it.
 *  3. Its rules are `$$…$$` inline and `$$$…$$$` block. The Notebook's are
 *     `$…$` and `$$…$$`, written for a trader's text (see INLINE_FIND).
 * The SCHEMA is the extension's, deliberately — names, the `latex` attribute,
 * `data-type="inline-math" | "block-math"` and `data-latex` — so a note written
 * here is the same document TipTap's own extension would read.
 *
 * Citation text: a math node reads as its LaTeX source
 * (askCitation.js::citationLeafText ⇄ note_citation_text.py::_ATOM_TEXT, both
 * pinned by tests/fixtures_pm_citation_text.json). Markdown: `$…$` / `$$…$$`
 * (notes_export.py).
 */
import { Extension, InputRule, Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

export const INLINE_MATH = 'inlineMath'
export const BLOCK_MATH = 'blockMath'
export const MATH_EDIT_EVENT = 'uct:math-edit'

// ── KaTeX, lazily ────────────────────────────────────────────────────────────
let katexModule = null
let katexPromise = null
/** The KaTeX renderer, loaded once, on first use. A failed load (offline, a
 *  stale chunk after a deploy) is forgotten so the next render retries. */
export function loadKatex() {
  if (!katexPromise) {
    katexPromise = import('./katexRender')
      .then((m) => { katexModule = m; return m })
      .catch((err) => { katexPromise = null; throw err })
  }
  return katexPromise
}

const EMPTY_INLINE = 'empty math'
const EMPTY_BLOCK = 'Empty math block — click to write LaTeX'

/**
 * Paint `latex` into `el`. Until KaTeX has loaded the SOURCE is shown, so the
 * formula is never blank and never lost if the chunk cannot load; once loaded,
 * the rendered formula replaces it. A render that lands after the node moved
 * on to other LaTeX is discarded (the `token` check).
 */
function paint(el, latex, display, { editable }) {
  const token = String(latex)
  el.dataset.renderFor = token
  el.classList.toggle('uctMathEmpty', !latex)
  if (!latex) {
    el.textContent = editable ? (display ? EMPTY_BLOCK : EMPTY_INLINE) : ''
    return
  }
  if (katexModule) {
    try { katexModule.renderLatex(el, latex, display) } catch { el.textContent = latex }
    return
  }
  el.textContent = latex
  loadKatex()
    .then((m) => { if (el.dataset.renderFor === token) m.renderLatex(el, latex, display) })
    .catch(() => { /* the source stays visible — honest, and nothing is lost */ })
}

function mathNodeView(display) {
  return ({ node: initial, editor, getPos }) => {
    let node = initial
    const dom = document.createElement(display ? 'div' : 'span')
    dom.className = display ? 'uctMath uctMathBlock' : 'uctMath uctMathInline'
    dom.setAttribute('data-type', display ? 'block-math' : 'inline-math')
    const out = document.createElement(display ? 'div' : 'span')
    out.className = 'uctMathRender'
    dom.appendChild(out)
    let editing = null

    const render = () => {
      const latex = node.attrs.latex || ''
      dom.setAttribute('data-latex', latex)
      if (editor.isEditable) dom.title = display ? 'Edit equation (Enter)' : 'Edit math (Enter)'
      paint(out, latex, display, { editable: editor.isEditable })
    }
    render()

    const posOf = () => (typeof getPos === 'function' ? getPos() : null)

    // Commit (or cancel) the editor, then hand the caret back AFTER the node.
    // Committing nothing deletes the node: an empty formula is not content.
    const finish = (commit) => {
      if (!editing) return
      const { input, preview } = editing
      editing = null
      const value = input.value
      input.remove()
      preview?.remove()
      out.hidden = false
      dom.classList.remove('uctMathEditing')
      const pos = posOf()
      if (typeof pos !== 'number') return
      const { state } = editor
      const current = state.doc.nodeAt(pos)
      if (!current || current.type !== node.type) return
      const latex = commit ? value.trim() : (current.attrs.latex || '')
      const tr = state.tr
      if (!latex) {
        tr.delete(pos, pos + current.nodeSize)
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))))
      } else {
        if (latex !== current.attrs.latex) tr.setNodeMarkup(pos, undefined, { ...current.attrs, latex })
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + current.nodeSize)))
      }
      editor.view.dispatch(tr)
      editor.view.focus()
    }

    const openEditor = () => {
      if (editing || !editor.isEditable) return
      const input = document.createElement(display ? 'textarea' : 'input')
      if (!display) input.type = 'text'
      input.className = 'uctMathInput'
      input.value = node.attrs.latex || ''
      input.setAttribute('aria-label', display ? 'LaTeX for this equation' : 'LaTeX for this inline math')
      input.setAttribute('spellcheck', 'false')
      input.setAttribute('autocomplete', 'off')
      input.setAttribute('autocapitalize', 'off')
      input.placeholder = display ? 'e.g. E = mc^2 — Enter to finish, Shift+Enter for a new line' : 'e.g. x^2'
      let preview = null
      const sizeInput = () => {
        if (display) input.rows = Math.max(2, input.value.split('\n').length)
        else input.size = Math.max(6, input.value.length + 1)
      }
      if (display) {
        preview = document.createElement('div')
        preview.className = 'uctMathPreview'
        preview.setAttribute('aria-hidden', 'true')
      }
      const livePreview = () => { if (preview) paint(preview, input.value.trim(), true, { editable: false }) }
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); finish(false)
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault(); event.stopPropagation(); finish(true)
        }
      })
      input.addEventListener('input', () => { sizeInput(); livePreview() })
      input.addEventListener('blur', () => finish(true))
      editing = { input, preview }
      // An equation's live preview stands in for its render while editing.
      out.hidden = true
      dom.classList.add('uctMathEditing')
      dom.appendChild(input)
      if (preview) dom.appendChild(preview)
      sizeInput()
      livePreview()
      input.focus()
      if (input.value) input.select()
    }

    const onClick = (event) => {
      if (!editor.isEditable || editing) return
      event.preventDefault()
      openEditor()
    }
    dom.addEventListener('click', onClick)
    dom.addEventListener(MATH_EDIT_EVENT, openEditor)

    return {
      dom,
      update(updated) {
        if (updated.type !== node.type) return false
        node = updated
        if (!editing) render()
        return true
      },
      // While the LaTeX editor is open its events are ours, not ProseMirror's.
      stopEvent(event) {
        return Boolean(editing) && editing.input === event.target
      },
      ignoreMutation: () => true,
      destroy() {
        dom.removeEventListener('click', onClick)
        dom.removeEventListener(MATH_EDIT_EVENT, openEditor)
      },
    }
  }
}

const latexAttr = {
  latex: {
    default: '',
    parseHTML: (el) => el.getAttribute('data-latex') || '',
    renderHTML: (attrs) => ({ 'data-latex': attrs.latex || '' }),
  },
}

export const InlineMath = Node.create({
  name: INLINE_MATH,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return latexAttr },
  parseHTML() { return [{ tag: 'span[data-type="inline-math"]' }] },
  // The source rides inside the element too, so a copy into another app (or a
  // print of the raw HTML) carries the formula rather than an empty span.
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' }), `$${node.attrs.latex || ''}$`]
  },
  // The plain-text clipboard (and editor.getText()). Citation text does NOT
  // read this — it passes its own leafText (askCitation.js::citationLeafText).
  renderText: ({ node }) => (node.attrs.latex ? `$${node.attrs.latex}$` : ''),
  addNodeView() { return mathNodeView(false) },
})

export const BlockMath = Node.create({
  name: BLOCK_MATH,
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() { return latexAttr },
  parseHTML() { return [{ tag: 'div[data-type="block-math"]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' }), `$$${node.attrs.latex || ''}$$`]
  },
  renderText: ({ node }) => (node.attrs.latex ? `$$${node.attrs.latex}$$` : ''),
  addNodeView() { return mathNodeView(true) },
})

// ── Typing math ──────────────────────────────────────────────────────────────
// ⛔ A TRADER'S TEXT IS FULL OF DOLLAR SIGNS. "$5-$10", "bought at $45 and sold
// at $52", "$NVDA/$AMD" must never turn into math. So `$…$` follows Pandoc's
// rule and one more:
//  - the opening `$` starts the text or follows a space or an opening bracket,
//    and a non-space character follows it;
//  - the closing `$` follows a non-space character, and the rule fires only
//    when the member types a SPACE or punctuation right after it — so
//    "$NVDA/$AMD" (a letter after the `$`) never fires;
//  - content that is only a number, range or amount ("5-", "1.5k") is money,
//    never math.
// No lookbehind anywhere (Safari < 16.4; see the header). The lead character
// is CAPTURED instead, and the handler skips over it.
const INLINE_FIND = /(^|[\s([{])\$([^$\s](?:[^$\n]*?[^$\s])?)\$([\s.,;:!?)\]}])$/
// `$$…$$`: on a line of its own it becomes an equation block; mid-sentence it
// is inline math (the Notion habit). Fires as the closing `$` is typed.
const DOUBLE_FIND = /(^|[\s([{])\$\$([^$\n]+)\$\$$/
const MONEY_LIKE = /^(?=.*\d)[\d\s.,%+\-:/kKmMbB]*$/

export const MATH_INPUT_PATTERNS = Object.freeze({ INLINE_FIND, DOUBLE_FIND, MONEY_LIKE })

function isMathContent(latex) {
  return Boolean(latex) && !MONEY_LIKE.test(latex)
}

export const Mathematics = Extension.create({
  name: 'uctMathematics',
  // Above the core keymap: Enter on a selected formula must open its editor,
  // never replace the formula with a paragraph split. (An Extension, not the
  // nodes: a node's priority also sets its schema ORDER, and the first block
  // type is what an empty doc is filled with.)
  priority: 1000,

  addExtensions() {
    return [InlineMath, BlockMath]
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => openSelectedMath(this.editor),
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: DOUBLE_FIND,
        handler: ({ state, range, match }) => {
          const [, lead, raw] = match
          const latex = raw.trim()
          if (!isMathContent(latex)) return null
          const { tr, schema } = state
          const start = range.from + lead.length
          const $start = tr.doc.resolve(start)
          const parent = $start.parent
          const wholeLine = !lead && $start.parentOffset === 0 && range.to === $start.end()
            && parent.type.name === 'paragraph'
          if (wholeLine && $start.node(-1).canReplaceWith($start.index(-1), $start.index(-1) + 1, schema.nodes[BLOCK_MATH])) {
            const before = $start.before()
            tr.replaceWith(before, $start.after(), [
              schema.nodes[BLOCK_MATH].create({ latex }),
              schema.nodes.paragraph.create(),
            ])
            tr.setSelection(TextSelection.create(tr.doc, before + 2))
            return undefined
          }
          tr.replaceWith(start, range.to, schema.nodes[INLINE_MATH].create({ latex }))
          tr.setSelection(TextSelection.create(tr.doc, start + 1))
          return undefined
        },
      }),
      new InputRule({
        find: INLINE_FIND,
        handler: ({ state, range, match }) => {
          const [, lead, latex, trail] = match
          if (!isMathContent(latex)) return null
          const { tr, schema } = state
          const start = range.from + lead.length
          tr.replaceWith(start, range.to, schema.nodes[INLINE_MATH].create({ latex }))
          tr.insertText(trail, start + 1)
          tr.setSelection(TextSelection.create(tr.doc, start + 1 + trail.length))
          return undefined
        },
      }),
    ]
  },
})

/** Open the LaTeX editor of the formula a NodeSelection holds. */
export function openSelectedMath(editor) {
  const sel = editor.state.selection
  if (!(sel instanceof NodeSelection)) return false
  const name = sel.node.type.name
  if (name !== INLINE_MATH && name !== BLOCK_MATH) return false
  const dom = editor.view.nodeDOM(sel.from)
  if (!dom) return false
  dom.dispatchEvent(new CustomEvent(MATH_EDIT_EVENT))
  return true
}

/**
 * The slash menu's door: insert an empty formula at the cursor and open its
 * editor. Returns true when one was inserted.
 */
export function insertMathAndEdit(editor, typeName) {
  const ok = editor.chain().focus().insertContent({ type: typeName, attrs: { latex: '' } }).run()
  if (!ok) return false
  // The new, empty formula nearest the caret is the one just inserted (an
  // empty formula never outlives its editor: committing nothing deletes it).
  const head = editor.state.selection.head
  let best = null
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name !== typeName || n.attrs.latex) return
    if (!best || Math.abs(pos - head) < Math.abs(best - head)) best = pos
  })
  if (best == null) return false
  editor.view.nodeDOM(best)?.dispatchEvent(new CustomEvent(MATH_EDIT_EVENT))
  return true
}
