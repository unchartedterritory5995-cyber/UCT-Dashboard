import { Node, mergeAttributes } from '@tiptap/core'

// D2 item 6: the member's own link text (`[the report](q3%20report.pdf)`), shown as the
// chip's text in place of the file name. OPTIONAL: absent (every chip written before it,
// and any chip whose text IS the file name) means today's chip, which shows `name`. The
// download name is always `name`. An attribute on an existing node, so no schema bump
// (the callout `variant` precedent): an older client drops it on load and shows the name.
export function chipLabel(attrs) {
  const label = attrs?.label
  return typeof label === 'string' && label.trim() ? label : null
}

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
      label: {
        default: null,
        parseHTML: (el) => chipLabel({ label: el.getAttribute('data-label') }),
        renderHTML: () => ({}), // written by renderHTML below, beside data-name, only when set
      },
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
        label: chipLabel({ label: el.getAttribute('data-label') }),
      }),
    }]
  },
  renderHTML({ node }) {
    const label = chipLabel(node.attrs)
    return ['a', mergeAttributes({
      'data-type': 'attachmentChip',
      'data-name': node.attrs.name,
      'data-size': node.attrs.size ?? undefined,
      'data-label': label ?? undefined,
      // D2 fix round 1 (M3): a label can say anything (`[invoice.pdf](payload.exe)`), so
      // the real file's name is always on hover; the download is always `name` (below).
      title: label ? node.attrs.name : undefined,
      href: node.attrs.href,
      download: node.attrs.name,
      rel: 'noreferrer',
    }), label ?? node.attrs.name]
  },
})
