import { Node, mergeAttributes } from '@tiptap/core'
import { safeLinkHref } from './webLinkNodes'
import { importNoticeText, OPEN_ORIGINAL } from './importNoticeText'
import { mountUIcon } from './uiconDom'

/**
 * Connector fidelity (2026-11) — the `importNotice` block: the visible marker an import
 * leaves where something could not come over from Notion, Obsidian, Evernote or a file
 * ("Couldn't copy chart.png"), so nothing is ever dropped in silence.
 *
 *   attrs  { reason, name, sourceUrl, ref, attempts }   (attempts defaults to 0, the rest null)
 *
 * The words are DERIVED from attrs on every render (`importNoticeText`, one copy table pinned
 * against the server's `import_notice.NOTICE_COPY`); nothing a member reads is stored. The
 * " — open the original" link appears only for an http(s) `sourceUrl` (`safeLinkHref`):
 * `javascript:`, `data:`, `vbscript:` and `file:` stay text and never become an href.
 *
 * A block atom with no text of its own: a row in the citation tables' `_LEAF_TYPES` (one
 * position, reads as nothing), `NOTEBOOK_TYPE_SCHEMA` at 5, and dropped by share, publish and
 * gallery (`public_note_payload.NODE_POLICY`). ⛔ Never remove it from `buildExtensions()`:
 * a note holding one would open EMPTY in an editor without it.
 */

const str = (v) => (typeof v === 'string' && v.trim() ? v : null)

const textAttr = (name) => ({
  default: null,
  parseHTML: (el) => str(el.getAttribute(`data-${name}`)),
  renderHTML: (attrs) => (attrs[name] ? { [`data-${name}`]: attrs[name] } : {}),
})

function el(tag, attrs = {}, text = null) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v)
  if (text != null) node.textContent = text
  return node
}

const linkAttrs = (href) => ({ href, target: '_blank', rel: 'noopener noreferrer' })

/** The words and the link, written into `holder` (the node view's text span). */
function renderBody(holder, attrs) {
  holder.textContent = ''
  holder.appendChild(document.createTextNode(importNoticeText(attrs)))
  const href = safeLinkHref(attrs.sourceUrl)
  if (href) {
    holder.appendChild(document.createTextNode(' — '))
    holder.appendChild(el('a', { class: 'uctImportNoticeLink', ...linkAttrs(href) }, OPEN_ORIGINAL))
  }
}

export const ImportNotice = Node.create({
  name: 'importNotice',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      reason: textAttr('reason'),
      name: textAttr('name'),
      sourceUrl: {
        default: null,
        parseHTML: (node) => str(node.getAttribute('data-source-url')),
        renderHTML: (attrs) => (attrs.sourceUrl ? { 'data-source-url': attrs.sourceUrl } : {}),
      },
      ref: textAttr('ref'),
      attempts: {
        default: 0,
        parseHTML: (node) => {
          const n = Number.parseInt(node.getAttribute('data-attempts') ?? '', 10)
          return Number.isInteger(n) && n > 0 ? n : 0
        },
        renderHTML: (attrs) => (attrs.attempts ? { 'data-attempts': String(attrs.attempts) } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="import-notice"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    // The static HTML (a copy, generateHTML): the sentence, and the link only when safe.
    const href = safeLinkHref(node.attrs.sourceUrl)
    const text = importNoticeText(node.attrs)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'import-notice' }),
      href ? ['span', {}, `${text} — `, ['a', linkAttrs(href), OPEN_ORIGINAL]] : ['span', {}, text]]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = el('div', { 'data-type': 'import-notice', class: 'uctImportNotice', contenteditable: 'false', role: 'note' })
      const iconHolder = el('span', { class: 'uctImportNoticeIcon', 'aria-hidden': 'true' })
      const body = el('span', { class: 'uctImportNoticeText' })
      dom.appendChild(iconHolder)
      dom.appendChild(body)
      const icon = mountUIcon(iconHolder, 'warning', { size: 16 })
      let current = node
      renderBody(body, node.attrs)
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false
          if (next.attrs !== current.attrs) renderBody(body, next.attrs)
          current = next
          return true
        },
        destroy() { icon.destroy() },
      }
    }
  },
})
