/**
 * Shared TipTap/ProseMirror document builders for template catalogs.
 *
 * Consumers: `pages/journal-2-0/lib/notebookTemplates.js` (Notebook) and
 * `pages/modelbook/builder/upbTemplates.js` (My Playbook). Both editors run
 * the same extension set (journal-2-0/lib/tiptap.js `buildExtensions`).
 *
 * ⚠️ That extension set has NO table extension — never emit table-family
 * nodes from a builder; TipTap silently drops unknown nodes on load and
 * corrupts the doc. Structure is headings + paragraphs + bullet lists +
 * horizontal rules ONLY.
 */

/** Heading node (level 2 = section, level 3 = sub-section). */
export const h = (level, text) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})

/**
 * Paragraph node. Empty/omitted text ⇒ a truly empty paragraph
 * ({type:'paragraph'}) — a text node may never carry an empty string.
 */
export const p = (text) =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }

/** Paragraph starting with a bold label: **Label** rest. */
export const labeled = (label, rest) => ({
  type: 'paragraph',
  content: [
    { type: 'text', marks: [{ type: 'bold' }], text: label },
    ...(rest ? [{ type: 'text', text: ` ${rest}` }] : []),
  ],
})

/** Paragraph whose whole text is a link. */
export const linkP = (text, href) => ({
  type: 'paragraph',
  content: [{ type: 'text', marks: [{ type: 'link', attrs: { href } }], text }],
})

/** Bullet list from an array of plain strings. */
export const bullets = (items) => ({
  type: 'bulletList',
  content: items.map((text) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })),
})

/** Horizontal rule separator. */
export const hr = () => ({ type: 'horizontalRule' })

export const doc = (content) => ({ type: 'doc', content })

/** Section list: each title becomes a heading + an empty paragraph to write into. */
export const sections = (titles) => doc(titles.flatMap((t) => [h(2, t), p()]))
