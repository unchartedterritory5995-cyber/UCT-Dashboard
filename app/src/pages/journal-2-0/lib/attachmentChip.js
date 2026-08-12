import { Node, mergeAttributes } from '@tiptap/core'

/** File-attachment chip: a downloadable non-image file in the note body. */
export const AttachmentChip = Node.create({
  name: 'attachmentChip',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      href: { default: null },
      name: { default: 'file' },
      size: { default: null },
    }
  },
  parseHTML() {
    return [{
      tag: 'a[data-type="attachmentChip"]',
      // Must outrank the Link mark's generic `a[href]` parseHTML rule (default
      // priority 50) — otherwise the chip is absorbed as a linked text run
      // instead of parsing as its own atom node.
      priority: 100,
      getAttrs: (el) => ({
        href: el.getAttribute('href'),
        name: el.getAttribute('data-name') || el.textContent || 'file',
        size: el.getAttribute('data-size') ? Number(el.getAttribute('data-size')) : null,
      }),
    }]
  },
  renderHTML({ node }) {
    return ['a', mergeAttributes({
      'data-type': 'attachmentChip',
      'data-name': node.attrs.name,
      'data-size': node.attrs.size ?? undefined,
      href: node.attrs.href,
      download: node.attrs.name,
      rel: 'noreferrer',
    }), node.attrs.name]
  },
})
