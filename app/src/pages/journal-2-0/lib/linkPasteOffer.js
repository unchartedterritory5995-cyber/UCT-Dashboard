import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { insertPoint } from '@tiptap/pm/transform'
import { embedFor, webUrl } from './webEmbeds'
import { safeImageSrc } from './webLinkNodes'

/**
 * Wave 6 item 6 — pasting a lone link offers Link · Preview card · Embed.
 *
 * A paste whose whole text is ONE web link, at a caret (nothing selected), in
 * text that can carry a link, lands as a link immediately — the paste is never
 * held hostage to a choice — and the plugin records an OFFER for it: the link's
 * range, whether a preview card is possible (https: the server-side fetch is
 * https-only), and whether it may embed (webEmbeds.js's allowlist). The menu
 * (components/notebook/LinkPasteMenu.jsx) reads the offer and shows the
 * choices; "Link" (or Escape, or simply typing on) keeps the link as it is.
 *
 * ⛔ THE OFFER ENDS AT THE FIRST OTHER EDIT OR CARET MOVE. A choice made after
 * the note moved on would replace text that is no longer the pasted link, so
 * the offer does not outlive the moment, and `offerStillValid` re-reads the
 * range before anything is replaced.
 *
 * Everything else about a paste is untouched: a URL pasted over a selection is
 * Link's own "wrap the selection" (it needs a selection, this needs none), a
 * paste in a code block stays plain text, and every other paste goes on to
 * pasteContainers.js exactly as before.
 */
export const linkPasteKey = new PluginKey('uctLinkPasteOffer')

/**
 * The pasted text when it is one web link and nothing else, else null: at most
 * one block, holding only text (no chip, no break), whose whole text is a web
 * link — and, when the clipboard's plain text is there to read, that too.
 */
export function lonePastedUrl(event, slice) {
  if (!slice || slice.content.childCount > 1) return null
  let text = ''
  let onlyText = true
  slice.content.descendants((n) => {
    if (n.isText) text += n.text
    else if (n.isInline) onlyText = false
    return onlyText
  })
  text = text.trim()
  if (!onlyText || !webUrl(text)) return null
  const plain = event?.clipboardData?.getData?.('text/plain')
  if (typeof plain === 'string' && plain.trim() && plain.trim() !== text) return null
  return text
}

/** Is the offer's range still exactly the pasted link? */
export function offerStillValid(state, offer) {
  if (!offer || offer.to > state.doc.content.size || offer.from >= offer.to) return false
  try { return state.doc.textBetween(offer.from, offer.to) === offer.url } catch { return false }
}

export const dismissLinkOffer = (editor) => {
  if (!editor || editor.isDestroyed || !linkPasteKey.getState(editor.state)) return
  editor.view.dispatch(editor.state.tr.setMeta(linkPasteKey, { offer: null }))
}

/**
 * Put `node` (a card or an embed) where the pasted link is: in place of its
 * paragraph when the paragraph is just the link, else as the block after it
 * (the sentence around the link keeps its link). False — and nothing changed —
 * when the offer went stale or no block can go there.
 */
export function placeLinkBlock(editor, offer, node) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const { state } = editor
  if (!offerStillValid(state, offer)) return false
  const $from = state.doc.resolve(offer.from)
  const tr = state.tr
  let pos = null
  if ($from.depth > 0 && $from.parent.textContent.trim() === offer.url) {
    const parentDepth = $from.depth - 1
    const index = $from.index(parentDepth)
    if ($from.node(parentDepth).canReplaceWith(index, index + 1, node.type)) {
      tr.replaceWith($from.before(), $from.after(), node)
      pos = $from.before()
    }
  }
  if (pos == null) {
    const at = insertPoint(state.doc, $from.after(), node.type)
    if (at == null) return false
    tr.insert(at, node)
    pos = at
  }
  tr.setMeta(linkPasteKey, { offer: null })
  try { tr.setSelection(NodeSelection.create(tr.doc, pos)) } catch { /* leave the selection mapped */ }
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

const clamp = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

/** The card node from a server preview (every field re-checked on the way in). */
export function previewCardNode(schema, url, preview) {
  return schema.nodes.linkPreview.create({
    url,
    title: clamp(preview?.title, 300),
    description: clamp(preview?.description, 600),
    domain: clamp(preview?.domain, 253),
    image: safeImageSrc(preview?.image),
  })
}

export function embedNode(schema, offer) {
  if (!offer?.embed) return null
  return schema.nodes.webEmbed.create({ provider: offer.embed.provider, ref: offer.embed.ref, url: offer.url })
}

/** GET /api/j2/link-preview — resolves the preview, or throws with the server's reason. */
export async function fetchLinkPreview(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`/api/j2/link-preview?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' })
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok) {
    const err = new Error((body && typeof body.detail === 'string' && body.detail) || 'No preview for this link.')
    err.status = res.status
    throw err
  }
  return body
}

export const LinkPasteOffer = Extension.create({
  name: 'linkPasteOffer',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: linkPasteKey,
      state: {
        init: () => null,
        apply(tr, value) {
          const meta = tr.getMeta(linkPasteKey)
          if (meta !== undefined) return meta.offer || null
          if (!value) return null
          if (tr.docChanged) return null
          if (tr.selectionSet && (!tr.selection.empty || tr.selection.from !== value.to)) return null
          return value
        },
      },
      props: {
        handlePaste(view, event, slice) {
          if (!view.editable) return false
          const { state } = view
          const { selection } = state
          // No `selection.empty` check of our own: a link pasted OVER a
          // selection is Link's (its paste handler wraps the selection, at
          // priority 1000, before this one is asked) -- railed, not repeated.
          const $from = selection.$from
          const link = state.schema.marks.link
          // A code block allows no marks, so `allowsMarkType` is also what
          // keeps a URL pasted there plain text.
          if (!link || !$from.parent.inlineContent || !$from.parent.type.allowsMarkType(link)) return false
          const url = lonePastedUrl(event, slice)
          if (!url) return false
          const preview = webUrl(url).protocol === 'https:'
          const embed = embedFor(url)
          const from = selection.from
          const tr = state.tr.replaceSelectionWith(state.schema.text(url, [link.create({ href: url })]), false)
          if (preview || embed) tr.setMeta(linkPasteKey, { offer: { from, to: from + url.length, url, preview, embed } })
          // `paste` as ProseMirror's own paste marks it; NOT uiEvent 'paste', which
          // would run TipTap's paste rules over the URL (an `_x_` inside a link
          // would turn italic) -- the link is already exactly what was pasted.
          view.dispatch(tr.setMeta('paste', true).scrollIntoView())
          return true
        },
        handleKeyDown(view, event) {
          if (event.key !== 'Escape' || !linkPasteKey.getState(view.state)) return false
          view.dispatch(view.state.tr.setMeta(linkPasteKey, { offer: null }))
          return true
        },
      },
    })]
  },
})
