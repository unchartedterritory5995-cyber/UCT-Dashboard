import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Callout — one of Notion's two most common structural blocks (the other is
 * Toggle, in `toggleNode.js`). Spec: docs/superpowers/specs/2026-09-01-
 * notebook-migration-program-design.md §8 item 2 — without these two,
 * imported Notion pages "do not merely lose styling, they look broken."
 *
 * Notion's classic Markdown export ("Export > Markdown & CSV", the format the
 * file importer reads) represents a callout as a raw `<aside>` HTML island
 * with the emoji as a leading character in its text content — confirmed by
 * this repo's own `__fixtures__/notion/…/My Page….md` fixture (authored
 * against a real export) and the adapter's own docstring ("Markdown lane via
 * mdToHtml — `<aside>`/`<details>` HTML islands pass straight through"),
 * corroborated by Notion's own help docs ("Callout blocks will be exported as
 * HTML, as there is no Markdown equivalent") and independent write-ups
 * describing the `<aside>` tag specifically. `notion.js` deliberately leaves
 * these tags untouched for "the converter" (this module + `importer/
 * convert.js`) to handle — no change needed there.
 *
 * The leading emoji is extracted into the `emoji` attr by
 * `importer/convert.js::mapCalloutsAndToggles` (which also stamps
 * `data-type="callout"` on the source `<aside>`) BEFORE `generateJSON` ever
 * sees the HTML — this node's own `parseHTML` stays a plain tag match so it
 * degrades gracefully (default emoji, unstripped leading character kept as
 * body text) if that preprocessing is ever bypassed, rather than depending on
 * it to avoid dropping content.
 *
 * No custom node view: the emoji badge is rendered as a nested, `0`-holed
 * DOMOutputSpec child (a standard ProseMirror pattern — see prosemirror-model's
 * `DOMOutputSpec` docs) so it stays OUTSIDE the node's contentDOM without any
 * imperative DOM code. The emoji is the user's own content (carried over from
 * Notion), not UI chrome, so it renders as plain text/data — no `UIcon`.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-emoji') || '💡',
        renderHTML: (attrs) => ({ 'data-emoji': attrs.emoji || '💡' }),
      },
    }
  },

  parseHTML() {
    return [
      // Renders back out with `data-type="callout"` (below) — matches on
      // copy/paste of our own output, including into another note.
      // `contentElement` is load-bearing: without it the parser would also
      // walk into `.uctCalloutIcon` (a DECORATION, not content — see
      // renderHTML) and absorb the emoji character as a stray leading text
      // run in the body, duplicating what `data-emoji` already carries.
      { tag: 'div[data-type="callout"]', contentElement: '.uctCalloutBody' },
      // Raw Notion export shape (or an `<aside>` that reached generateJSON
      // without the convert.js preprocessing pass) — its children ARE the
      // content directly, no wrapper to select.
      { tag: 'aside' },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }),
      ['div', { class: 'uctCalloutIcon', contenteditable: 'false' }, node.attrs.emoji || '💡'],
      ['div', { class: 'uctCalloutBody' }, 0],
    ]
  },
})
