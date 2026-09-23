import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import AskInsertView from '../components/notebook/AskInsertView'

/**
 * G-064 — an inserted Ask Notebook answer (spec §4.1).
 *
 * `isolating` is P1's mechanism: Backspace at the start and Delete at the end
 * never merge the body out of the block, and `content: 'block+'` keeps the
 * wrapper when every paragraph is deleted. Removing the block is an ordinary
 * node delete; there is no unwrap command.
 *
 * ⚠️ Never remove this extension from buildExtensions(): TipTap drops unknown
 * node types at parse time, so unregistering it would delete every inserted
 * answer from every note the next time one opens.
 */
export const AskInsert = Node.create({
  name: 'askInsert',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  draggable: false,

  addAttributes() {
    return {
      insertedAt: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-inserted-at'),
        renderHTML: (a) => (a.insertedAt ? { 'data-inserted-at': a.insertedAt } : {}),
      },
      scope: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-scope'),
        renderHTML: (a) => (a.scope ? { 'data-scope': a.scope } : {}),
      },
      question: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-question') || '',
        renderHTML: (a) => (a.question ? { 'data-question': a.question } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="ask-insert"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'ask-insert' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AskInsertView)
  },
})
