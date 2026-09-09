import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import NoteLinkView from '../components/notebook/NoteLinkView'

/**
 * Wave D (Internal Links / Backlinks) — an atomic inline "chip" linking to
 * another note in this member's own Notebook.
 *
 * `noteId` is the ONLY durable attribute -- deliberately NOT the target's
 * title. A plain TipTap `Link` mark stores its visible text as literal
 * document content, which would freeze the label at insert time; renaming
 * the target note would then require rewriting every OTHER note that links
 * to it just to keep labels honest -- a side-effecting write on content the
 * member didn't touch, and a violation of "note save is authoritative"
 * (only the note being saved should ever be written). A custom atom node
 * instead stores only the id and resolves the CURRENT title live, in
 * `NoteLinkView`, every time it renders -- renaming a target is instantly
 * correct everywhere it's linked from, with zero writes anywhere else.
 *
 * ⚠️ Never remove this extension from buildExtensions(): TipTap drops
 * unknown node types at parse time (same rule as widgetEmbed above it) --
 * unregistering this would silently delete every internal link from every
 * note the next time one opens.
 */
export const NoteLink = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-note-id'),
        renderHTML: (attrs) => (attrs.noteId ? { 'data-note-id': attrs.noteId } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-note-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // Static fallback for contexts that don't mount the React node view
    // (paste-out, HTML export outside this app). The visible text here is
    // deliberately generic, not a frozen title -- see the class docstring.
    return ['span', mergeAttributes(HTMLAttributes, { class: 'uct-note-link' }), 'linked note']
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkView)
  },

  addCommands() {
    return {
      insertNoteLink: (noteId) => ({ chain }) =>
        chain().insertContent({ type: this.name, attrs: { noteId } }).run(),
    }
  },
})
