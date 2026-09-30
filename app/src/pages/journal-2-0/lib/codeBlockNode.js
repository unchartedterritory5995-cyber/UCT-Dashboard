/**
 * Wave 5 — the Notebook's code block: syntax highlighting + a language picker.
 *
 * The node is still `codeBlock` with the same `language` attribute and the
 * same `<pre><code class="language-x">` HTML the stock extension writes, so
 * every note stored before this wave loads unchanged, the Markdown export
 * keeps writing ```lang fences (notes_export.py reads `attrs.language`), and
 * the citation tables need no row: a code block is still one textblock whose
 * text is its text. Highlighting is DECORATIONS, never document content —
 * nothing it adds can reach getJSON(), a save, or a paste.
 *
 * Wave 7 (lane I3): the highlighter is LOADED ON DEMAND. highlight.js core, the 19
 * grammars and lowlight (~100 KB) used to ride in the editor chunk of every note; now
 * the decoration plugin below asks for them (`codeLanguages.loadHighlighter`) the first
 * time a document holds a code block, renders the block as plain `<pre>` text until
 * they arrive, and then re-decorates once. That is why this extends the plain
 * `CodeBlock` rather than `CodeBlockLowlight`: the stock extension imports
 * highlight.js core at module load, which is exactly the byte this wave moves out.
 * The plugin keeps the stock plugin's rules for WHEN to re-highlight (a change inside
 * a code block, a block added or removed, a step spanning a whole block) and adds one:
 * the highlighter arriving.
 *
 * The picker is a real `<select>` in a plain DOM node view (no React per code
 * block): keyboard-operable as it stands, and on a phone it opens the native
 * picker. `Mod-Alt-l` with the caret in a code block moves focus to it; Enter
 * or Escape hands focus back to the code. A read-only renderer (the shared
 * note page, a version preview) shows the language as a label and offers no
 * control.
 */
import { CodeBlock } from '@tiptap/extension-code-block'
import { findChildren } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { CODE_LANGUAGES, PLAIN_TEXT_LABEL, canonicalLanguage, languageLabel, loadHighlighter, loadedHighlighter } from './codeLanguages'
import { altKeyLabel, modKeyLabel } from './platform'
import { stepsIntroduceNodeType } from './stepInsertsNodeType'

export const CODE_LANGUAGE_PICKER_LABEL = 'Code block language'

export const codeHighlightPluginKey = new PluginKey('notebookCodeHighlight')

// lowlight's HAST -> flat runs of text with the classes that wrap them.
function parseNodes(nodes, className = []) {
  return nodes.flatMap((node) => {
    const classes = [...className, ...(node.properties ? node.properties.className : [])]
    if (node.children) return parseNodes(node.children, classes)
    return { text: node.value, classes }
  })
}

/** Every code block's highlight decorations. A block with no language, or one the
 *  roster does not know, gets none (no auto-detection: codeHighlight.js). */
function decorationsFor(doc, name, lowlight) {
  const decorations = []
  findChildren(doc, (node) => node.type.name === name).forEach((block) => {
    const language = canonicalLanguage(block.node.attrs.language)
    if (!language) return
    const tree = lowlight.highlight(language, block.node.textContent)
    let from = block.pos + 1
    parseNodes(tree.children || []).forEach((run) => {
      const to = from + run.text.length
      if (run.classes.length) decorations.push(Decoration.inline(from, to, { class: run.classes.join(' ') }))
      from = to
    })
  })
  return DecorationSet.create(doc, decorations)
}

const hasCodeBlock = (doc, name) => {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.type.name === name) { found = true; return false }
    return true
  })
  return found
}

/**
 * ⛔⛔ Wave 10 (TY, standard 4 -- typing budget): whether the doc has EVER held a
 * `name` node since this editor mounted, tracked INCREMENTALLY instead of
 * re-walked with `hasCodeBlock` on every keystroke -- which is what `view()`
 * below used to do, forever, in every note that has never held a code block
 * (nearly all of them), because nothing ever set `requested` to short-circuit
 * it. STICKY on purpose: `view()`'s loader is the only reader, and it never
 * asks again once it has EITHER started loading (`requested`) or the
 * highlighter is already loaded (`loadedHighlighter()`) -- both of which
 * happen at, or immediately after, the first `true` -- so re-proving a block
 * might have since been deleted would buy nothing observable. `false` can only
 * become `true` by THIS transaction inserting the node type
 * (`stepsIntroduceNodeType`) or landing the selection inside one it just
 * created (`touchesType` -- the very same signal the decoration rules below
 * already trust for the "has code blocks" case). This changes NOTHING about
 * what gets highlighted; only the decoration rules below decide that, and they
 * are the pre-existing ones, byte for byte.
 */
function nextHasBlock(tr, prevHasBlock, touchesType, name) {
  return prevHasBlock || touchesType || stepsIntroduceNodeType(tr, name)
}

/**
 * The highlighting plugin. Plain text until the highlighter has loaded; the load is
 * started by the FIRST code block a document holds (at mount, or when one is added),
 * and its arrival is one meta transaction that re-decorates the whole document.
 */
function codeHighlightPlugin(name) {
  return new Plugin({
    key: codeHighlightPluginKey,
    state: {
      init: (_, { doc }) => {
        const lowlight = loadedHighlighter()
        return {
          decorations: lowlight ? decorationsFor(doc, name, lowlight) : DecorationSet.empty,
          hasBlock: hasCodeBlock(doc, name),
        }
      },
      apply: (tr, prev, oldState, newState) => {
        const lowlight = loadedHighlighter()
        const meta = tr.getMeta(codeHighlightPluginKey)?.highlighterReady
        if (!tr.docChanged) {
          const hasBlock = prev.hasBlock
          if (!lowlight) return { decorations: DecorationSet.empty, hasBlock }
          if (meta) return { decorations: decorationsFor(tr.doc, name, lowlight), hasBlock }
          return { decorations: prev.decorations.map(tr.mapping, tr.doc), hasBlock }
        }
        // The stock lowlight plugin's rules for when a change can alter highlighting.
        const oldNodeName = oldState.selection.$head.parent.type.name
        const newNodeName = newState.selection.$head.parent.type.name
        const touchesType = oldNodeName === name || newNodeName === name
        const hasBlock = nextHasBlock(tr, prev.hasBlock, touchesType, name)
        if (!lowlight) return { decorations: DecorationSet.empty, hasBlock }
        if (meta) return { decorations: decorationsFor(tr.doc, name, lowlight), hasBlock }
        const oldNodes = findChildren(oldState.doc, (node) => node.type.name === name)
        const newNodes = findChildren(newState.doc, (node) => node.type.name === name)
        if (touchesType
          || newNodes.length !== oldNodes.length
          || tr.steps.some((step) => step.from !== undefined && step.to !== undefined
            && oldNodes.some((node) => node.pos >= step.from && node.pos + node.node.nodeSize <= step.to))) {
          return { decorations: decorationsFor(tr.doc, name, lowlight), hasBlock }
        }
        return { decorations: prev.decorations.map(tr.mapping, tr.doc), hasBlock }
      },
    },
    props: {
      decorations(state) {
        return codeHighlightPluginKey.getState(state).decorations
      },
    },
    view(editorView) {
      let destroyed = false
      let requested = false
      const request = (view) => {
        if (requested || loadedHighlighter() || !codeHighlightPluginKey.getState(view.state).hasBlock) return
        requested = true
        loadHighlighter().then(() => {
          if (destroyed || editorView.isDestroyed) return
          editorView.dispatch(editorView.state.tr
            .setMeta(codeHighlightPluginKey, { highlighterReady: true })
            .setMeta('addToHistory', false))
        }, () => {
          // A failed load leaves the code as plain text; the next code block retries.
          requested = false
        })
      }
      request(editorView)
      return {
        update(view, prevState) {
          if (view.state.doc !== prevState.doc) request(view)
        },
        destroy() { destroyed = true },
      }
    },
  })
}

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

export const NotebookCodeBlock = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), codeHighlightPlugin(this.name)]
  },

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
  defaultLanguage: null,
})
