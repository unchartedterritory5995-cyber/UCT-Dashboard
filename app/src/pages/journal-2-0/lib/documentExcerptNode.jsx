import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ExcerptView from '../components/notebook/ExcerptView'

/**
 * Wave J (Document Intelligence II) — an atomic block card holding a
 * reference to one immutable `j2_note_excerpts` row.
 *
 * `excerptId` is the ONLY durable attribute, mirroring `financialFactNode.jsx`
 * exactly (see that file's docstring for the full rationale). Everything
 * else (captured text, page, citation, annotation) resolves via
 * `useNoteExcerpts`, batched per note.
 *
 * ⚠️ Never remove this extension from buildExtensions(): TipTap drops
 * unknown node types at parse time (same rule as FinancialFact/NoteLink) --
 * unregistering this would silently delete every saved excerpt card from
 * every note the next time one opens.
 */
export const DocumentExcerpt = Node.create({
  name: 'documentExcerpt',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      excerptId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-excerpt-id'),
        renderHTML: (attrs) => (attrs.excerptId ? { 'data-excerpt-id': attrs.excerptId } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-excerpt-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback for contexts that don't mount the React node view.
    return ['div', mergeAttributes(HTMLAttributes, { class: 'uct-document-excerpt' }), 'saved document excerpt']
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExcerptView)
  },

  addCommands() {
    return {
      insertDocumentExcerpt: (excerptId) => ({ chain }) =>
        chain().insertContent({ type: this.name, attrs: { excerptId } }).run(),
    }
  },
})
