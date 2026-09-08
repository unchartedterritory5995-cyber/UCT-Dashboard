import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import FinancialFactView from '../components/notebook/FinancialFactView'

/**
 * Wave F (Financial Fact / Snapshot Ledger) — an atomic block card holding a
 * reference to one immutable `j2_fact_observations` row.
 *
 * `factId` is the ONLY durable attribute, mirroring `noteLinkNode.jsx`'s own
 * "id only, resolve live" contract exactly (see that file's docstring for
 * the full rationale — the short version: freezing a value INTO the doc
 * would make it impossible to distinguish "the note's own prose" from "a
 * captured observation," and this node's whole job is to let the ledger,
 * not the document, be the one place a fact's value is ever read from).
 * Everything else (value, unit, observedAt, current comparison) resolves via
 * `useNoteFacts`, batched per note (checkpoint decision 21/24/39).
 *
 * ⚠️ Never remove this extension from buildExtensions(): TipTap drops
 * unknown node types at parse time (same rule as WidgetEmbed/NoteLink) —
 * unregistering this would silently delete every captured fact card from
 * every note the next time one opens.
 */
export const FinancialFact = Node.create({
  name: 'financialFact',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      factId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-fact-id'),
        renderHTML: (attrs) => (attrs.factId ? { 'data-fact-id': attrs.factId } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-fact-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback for contexts that don't mount the React node view
    // (paste-out, HTML export outside this app).
    return ['div', mergeAttributes(HTMLAttributes, { class: 'uct-financial-fact' }), 'captured financial fact']
  },

  addNodeView() {
    return ReactNodeViewRenderer(FinancialFactView)
  },

  addCommands() {
    return {
      insertFinancialFact: (factId) => ({ chain }) =>
        chain().insertContent({ type: this.name, attrs: { factId } }).run(),
    }
  },
})
