import { Node, mergeAttributes } from '@tiptap/core'
import { EMBED_PROVIDERS, embedHref, embedSrc, webUrl } from './webEmbeds'

/**
 * Wave 6 item 6 — the two things a pasted link can become besides a link.
 *
 *   linkPreview  a card: title, description, domain, image — fetched ONCE,
 *                server-side, when the member chose "Preview card", and kept in
 *                the node's attrs. It renders from those attrs for ever after:
 *                offline, and without a request of any kind when a note opens.
 *   webEmbed     an allowlisted player (YouTube via youtube-nocookie.com,
 *                TradingView) in a sandboxed iframe whose address is REBUILT
 *                from `{ provider, ref }` on every render (webEmbeds.js), never
 *                read from a stored or pasted string.
 *
 * Both are block atoms with no text of their own: rows in the citation tables'
 * `_LEAF_TYPES` (one position, reads as nothing), not in `_ATOM_TEXT`.
 * Registered at schema 2 (both are NEW node types).
 *
 * ⛔ A remote image renders with referrerPolicy="no-referrer" and
 * loading="lazy", and only from an https address. Their static HTML (the
 * clipboard, an HTML export) is a plain link — never an iframe, never an image.
 */

const str = (v) => (typeof v === 'string' && v.trim() ? v : null)

/** A card's link target: an http(s) URL as the browser will use it, or null. */
export function safeLinkHref(value) {
  const url = webUrl(value)
  return url ? url.href : null
}

/** A card's image: https only (the page is https; nothing mixed, nothing local). */
export function safeImageSrc(value) {
  const url = webUrl(value)
  return url && url.protocol === 'https:' ? url.href : null
}

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

function renderCard(dom, attrs) {
  dom.textContent = ''
  const href = safeLinkHref(attrs.url)
  const title = str(attrs.title) || str(attrs.domain) || href || 'Link'
  const card = href
    ? el('a', { class: 'uctLinkPreviewCard', href, target: '_blank', rel: 'noopener noreferrer nofollow' })
    : el('div', { class: 'uctLinkPreviewCard' })
  const image = safeImageSrc(attrs.image)
  if (image) {
    const img = el('img', { class: 'uctLinkPreviewImage', src: image, alt: '', loading: 'lazy', decoding: 'async' })
    img.referrerPolicy = 'no-referrer'
    img.setAttribute('referrerpolicy', 'no-referrer')
    img.addEventListener('error', () => img.remove(), { once: true })
    card.appendChild(img)
  }
  const text = el('span', { class: 'uctLinkPreviewText' })
  text.appendChild(el('span', { class: 'uctLinkPreviewTitle' }, title))
  if (str(attrs.description)) text.appendChild(el('span', { class: 'uctLinkPreviewDesc' }, attrs.description))
  if (str(attrs.domain)) text.appendChild(el('span', { class: 'uctLinkPreviewDomain' }, attrs.domain))
  card.appendChild(text)
  dom.appendChild(card)
}

export const LinkPreview = Node.create({
  name: 'linkPreview',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      url: textAttr('url'),
      title: textAttr('title'),
      description: textAttr('description'),
      domain: textAttr('domain'),
      image: textAttr('image'),
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="link-preview"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const href = safeLinkHref(node.attrs.url)
    const label = str(node.attrs.title) || str(node.attrs.domain) || href || ''
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'link-preview' }),
      href ? ['a', { href, rel: 'noopener noreferrer nofollow', target: '_blank' }, label] : ['span', {}, label]]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = el('div', { 'data-type': 'link-preview', class: 'uctLinkPreview', contenteditable: 'false' })
      let current = node
      renderCard(dom, node.attrs)
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false
          if (next.attrs !== current.attrs) renderCard(dom, next.attrs)
          current = next
          return true
        },
      }
    }
  },
})

const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox'

function renderEmbed(dom, attrs) {
  dom.textContent = ''
  const src = embedSrc(attrs.provider, attrs.ref)
  const href = embedHref(attrs.provider, attrs.ref) || safeLinkHref(attrs.url)
  if (!src) {
    // Fails the allowlist: never an iframe. The link, if there is a safe one.
    dom.setAttribute('data-embed', 'refused')
    dom.appendChild(href
      ? el('a', { href, target: '_blank', rel: 'noopener noreferrer nofollow' }, href)
      : el('span', {}, 'Embed unavailable'))
    return
  }
  dom.removeAttribute('data-embed')
  const label = EMBED_PROVIDERS[attrs.provider].label
  const bar = el('div', { class: 'uctWebEmbedBar' })
  bar.appendChild(el('span', { class: 'uctWebEmbedLabel' }, label))
  bar.appendChild(el('a', { class: 'uctWebEmbedOpen', href, target: '_blank', rel: 'noopener noreferrer nofollow' }, 'Open'))
  const frame = el('div', { class: 'uctWebEmbedFrame', 'data-provider': attrs.provider })
  const iframe = el('iframe', {
    src,
    title: label,
    sandbox: SANDBOX,
    referrerpolicy: 'no-referrer',
    loading: 'lazy',
    allow: 'fullscreen; picture-in-picture; encrypted-media',
    allowfullscreen: 'true',
  })
  frame.appendChild(iframe)
  dom.appendChild(bar)
  dom.appendChild(frame)
}

export const WebEmbed = Node.create({
  name: 'webEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      provider: textAttr('provider'),
      ref: textAttr('ref'),
      url: textAttr('url'),
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="web-embed"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const href = embedHref(node.attrs.provider, node.attrs.ref) || safeLinkHref(node.attrs.url)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'web-embed' }),
      href ? ['a', { href, rel: 'noopener noreferrer nofollow', target: '_blank' }, href] : ['span', {}, '']]
  },
  addNodeView() {
    return ({ node }) => {
      const dom = el('div', { 'data-type': 'web-embed', class: 'uctWebEmbed', contenteditable: 'false' })
      let current = node
      renderEmbed(dom, node.attrs)
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false
          // Same player: leave the iframe alone (a re-render would restart it).
          if (next.attrs.provider !== current.attrs.provider || next.attrs.ref !== current.attrs.ref
            || next.attrs.url !== current.attrs.url) renderEmbed(dom, next.attrs)
          current = next
          return true
        },
      }
    }
  },
})
