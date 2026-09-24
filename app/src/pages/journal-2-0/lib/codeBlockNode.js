/**
 * Wave 5 — the Notebook's code block: syntax highlighting + a language picker.
 *
 * The node is still `codeBlock` with the same `language` attribute and the
 * same `<pre><code class="language-x">` HTML the stock extension writes, so
 * every note stored before this wave loads unchanged, the Markdown export
 * keeps writing ```lang fences (notes_export.py reads `attrs.language`), and
 * the citation tables need no row: a code block is still one textblock whose
 * text is its text. Highlighting is DECORATIONS (lowlight's plugin), never
 * document content — nothing it adds can reach getJSON(), a save, or a paste.
 *
 * The picker is a real `<select>` in a plain DOM node view (no React per code
 * block): keyboard-operable as it stands, and on a phone it opens the native
 * picker. `Mod-Alt-l` with the caret in a code block moves focus to it; Enter
 * or Escape hands focus back to the code. A read-only renderer (the shared
 * note page, a version preview) shows the language as a label and offers no
 * control.
 */
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { TextSelection } from '@tiptap/pm/state'
import { CODE_LANGUAGES, PLAIN_TEXT_LABEL, canonicalLanguage, languageLabel, notebookLowlight } from './codeHighlight'
import { altKeyLabel, modKeyLabel } from './platform'

export const CODE_LANGUAGE_PICKER_LABEL = 'Code block language'

/** The code block holding the selection's head, as `{ pos, node }`, or null. */
function codeBlockAtSelection(state, typeName) {
  const { $head } = state.selection
  for (let d = $head.depth; d > 0; d -= 1) {
    if ($head.node(d).type.name === typeName) return { pos: $head.before(d), node: $head.node(d) }
  }
  return null
}

/**
 * Fill `select` with Plain text + the roster. A stored language the roster
 * does not know (a pasted ```pinescript fence) is offered as itself, selected,
 * so opening the picker never reads as if the member's label was discarded —
 * and choosing another language is the only thing that replaces it.
 */
function fillOptions(select, language) {
  select.textContent = ''
  const add = (value, label) => {
    const opt = document.createElement('option')
    opt.value = value
    opt.textContent = label
    select.appendChild(opt)
  }
  add('', PLAIN_TEXT_LABEL)
  const known = canonicalLanguage(language)
  if (language && !known) add(language, language)
  for (const lang of CODE_LANGUAGES) add(lang.id, lang.label)
  select.value = language ? (known || language) : ''
}

export const NotebookCodeBlock = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Keyboard door to the language picker (the select is also reachable by
      // pointer and touch). Returns false outside a code block so the key
      // falls through to the browser.
      'Mod-Alt-l': () => {
        const hit = codeBlockAtSelection(this.editor.state, this.name)
        if (!hit) return false
        const dom = this.editor.view.nodeDOM(hit.pos)
        const select = dom?.querySelector?.('select.uctCodeLang')
        if (!select) return false
        select.focus()
        return true
      },
    }
  },

  addNodeView() {
    return ({ node: initialNode, editor, getPos }) => {
      let node = initialNode
      const editable = editor.isEditable

      const dom = document.createElement('div')
      dom.className = 'uctCodeBlock'

      const bar = document.createElement('div')
      bar.className = 'uctCodeBlockBar'
      bar.setAttribute('contenteditable', 'false')
      dom.appendChild(bar)

      let select = null
      let label = null
      if (editable) {
        // Chrome, not content: kept out of the PNG / print export exactly like
        // the rest of the editor's controls.
        bar.setAttribute('data-export-exclude', '')
        select = document.createElement('select')
        select.className = 'uctCodeLang'
        select.setAttribute('aria-label', CODE_LANGUAGE_PICKER_LABEL)
        select.title = `${CODE_LANGUAGE_PICKER_LABEL} (${modKeyLabel()}+${altKeyLabel()}+L)`
        bar.appendChild(select)
      } else {
        label = document.createElement('span')
        label.className = 'uctCodeLangLabel'
        bar.appendChild(label)
      }

      const pre = document.createElement('pre')
      const code = document.createElement('code')
      pre.appendChild(code)
      dom.appendChild(pre)

      // update() runs on every keystroke typed inside the block; only a
      // LANGUAGE change touches the DOM, so typing never rebuilds the picker.
      // (`undefined` is never a stored language, so the first paint runs.)
      let painted
      const paint = () => {
        const language = node.attrs.language || null
        if (language === painted) return
        painted = language
        code.className = language ? `language-${language}` : ''
        if (language) dom.setAttribute('data-language', language)
        else dom.removeAttribute('data-language')
        if (select) fillOptions(select, language)
        if (label) {
          label.textContent = languageLabel(language)
          // A plain block has nothing worth labelling on a reading surface.
          bar.hidden = !language
        }
      }
      paint()

      // Synchronous (not the focus command's next-frame focus): the key that
      // hands focus back must leave it in the code before the next key lands.
      const backToCode = () => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (typeof pos !== 'number') return
        const { state } = editor
        editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos + 1 + node.content.size)))
        editor.view.focus()
      }

      let pointerChoice = false
      const onPointerDown = () => { pointerChoice = true }
      const onChange = () => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (typeof pos !== 'number') return
        const current = editor.state.doc.nodeAt(pos)
        if (!current || current.type.name !== node.type.name) return
        const language = select.value || null
        if ((current.attrs.language || null) !== language) {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, language }))
        }
        // A pointer pick is finished the moment it is made; a keyboard user
        // may still be arrowing through the options, so focus stays until
        // they press Enter or Escape.
        if (pointerChoice) {
          pointerChoice = false
          backToCode()
        }
      }
      const onKeyDown = (event) => {
        if (event.key === 'Escape' || event.key === 'Enter') {
          event.preventDefault()
          // Escape here means "done with the picker", never "close the page's
          // find bar / sheet" further up.
          event.stopPropagation()
          backToCode()
        }
      }
      if (select) {
        select.addEventListener('pointerdown', onPointerDown)
        select.addEventListener('change', onChange)
        select.addEventListener('keydown', onKeyDown)
      }

      return {
        dom,
        contentDOM: code,
        update(updated) {
          if (updated.type !== node.type) return false
          node = updated
          paint()
          return true
        },
        // The bar is ours: ProseMirror must neither handle its events (a
        // mousedown on the select is not a caret placement) nor re-read its
        // DOM as document content.
        stopEvent(event) {
          return bar.contains(event.target)
        },
        ignoreMutation(mutation) {
          if (mutation.type === 'selection') return false
          if (bar.contains(mutation.target)) return true
          // Our own class / data-language writes on the wrapper and <code>.
          return mutation.type === 'attributes' && (mutation.target === dom || mutation.target === code)
        },
        destroy() {
          if (!select) return
          select.removeEventListener('pointerdown', onPointerDown)
          select.removeEventListener('change', onChange)
          select.removeEventListener('keydown', onKeyDown)
        },
      }
    }
  },
}).configure({
  lowlight: notebookLowlight,
  defaultLanguage: null,
})
