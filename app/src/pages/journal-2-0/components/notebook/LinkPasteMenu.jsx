/**
 * Wave 6 item 6 — the choice a pasted link offers: Link · Preview card · Embed.
 *
 * The offer itself (which link, whether a card or an embed is possible) lives
 * in the editor state (lib/linkPasteOffer.js); this is only its menu, floated
 * at the end of the pasted link. The link is ALREADY in the note when this
 * appears — "Link" keeps it as it is, and so do Escape and simply typing on.
 *
 * "Preview card" asks the server for the page's title, description and image
 * (GET /api/j2/link-preview) once, and stores them in the card: the card never
 * fetches again, offline included. A page with no preview says so and the link
 * stays. "Embed" is offered only for the allowlist (webEmbeds.js).
 *
 * The buttons keep the editor's focus (mousedown is prevented), so choosing one
 * never moves the caret and never ends the offer by itself. Touch tier: every
 * button meets var(--tap-min).
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import {
  PREVIEW_FAILURE_TEXT, dismissLinkOffer, embedNode, fetchLinkPreview, linkPasteKey, placeLinkBlock, previewCardNode,
} from '../../lib/linkPasteOffer'
import styles from './LinkPasteMenu.module.css'

export const LINK_PASTE_MENU_LABEL = 'Pasted link'

export default function LinkPasteMenu({ editor }) {
  const [, bump] = useReducer((x) => x + 1, 0)
  const [status, setStatus] = useState(null) // { offer, text, busy }
  const barRef = useRef(null)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    editor.on('transaction', bump)
    return () => { editor.off('transaction', bump) }
  }, [editor])

  const offer = editor && !editor.isDestroyed && editor.isEditable ? linkPasteKey.getState(editor.state) : null
  const mine = status && status.offer === offer ? status : null

  const place = useCallback(() => {
    const bar = barRef.current
    const current = editor && !editor.isDestroyed ? linkPasteKey.getState(editor.state) : null
    if (!bar || !current) return
    let rect = null
    try { rect = editor.view.coordsAtPos(Math.min(current.to, editor.state.doc.content.size)) } catch { rect = null }
    if (!rect) return
    const w = bar.offsetWidth || 0
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0
    const left = Math.max(8, Math.min(rect.left, (vw || rect.left + w + 8) - w - 8))
    bar.style.left = `${Math.round(left)}px`
    bar.style.top = `${Math.round((rect.bottom || 0) + 6)}px`
  }, [editor])

  useLayoutEffect(() => { if (offer) place() })

  if (!offer) return null

  const keep = () => dismissLinkOffer(editor)

  const choosePreview = async () => {
    setStatus({ offer, busy: true, text: 'Fetching a preview…' })
    const answer = await fetchLinkPreview(offer.url)
    // ⛔ M4 (wave 6 fix round 1): THE MEMBER MAY HAVE MOVED ON WHILE IT WAS OUT.
    // "Link", Escape, typing or a caret move ends the offer; an answer arriving
    // after that places nothing and says nothing — their "keep it as a link"
    // stands. (`offerStillValid` alone re-reads only the TEXT, which a Link
    // choice leaves exactly as it was.)
    if (editor.isDestroyed || linkPasteKey.getState(editor.state) !== offer) return
    if (answer.failure) {
      // ⛔ A fixed sentence per reason — never the server's words (rawErrorSurface).
      setStatus({ offer, busy: false, text: `${PREVIEW_FAILURE_TEXT[answer.failure]} Kept as a link.` })
      return
    }
    const placed = placeLinkBlock(editor, offer, previewCardNode(editor.schema, offer.url, answer.preview))
    if (!placed) setStatus({ offer, busy: false, text: "A card can't go here. Kept as a link." })
  }

  const chooseEmbed = () => {
    const node = embedNode(editor.schema, offer)
    if (!node || !placeLinkBlock(editor, offer, node)) {
      setStatus({ offer, busy: false, text: "An embed can't go here. Kept as a link." })
    }
  }

  const hold = (e) => e.preventDefault() // keep the editor's focus and caret

  return (
    <div
      ref={barRef}
      className={styles.bar}
      role="toolbar"
      aria-label={LINK_PASTE_MENU_LABEL}
      aria-busy={mine?.busy ? 'true' : undefined}
    >
      <button type="button" className={styles.btn} onMouseDown={hold} onClick={keep}>
        <UIcon name="link" size={14} /> <span>Link</span>
      </button>
      {offer.preview && (
        <button type="button" className={styles.btn} onMouseDown={hold} onClick={choosePreview} disabled={Boolean(mine?.busy)}>
          <UIcon name="document" size={14} /> <span>Preview card</span>
        </button>
      )}
      {offer.embed && (
        <button type="button" className={styles.btn} onMouseDown={hold} onClick={chooseEmbed} disabled={Boolean(mine?.busy)}>
          <UIcon name="play" size={14} /> <span>Embed</span>
        </button>
      )}
      <span className={styles.status} role="status" aria-live="polite">{mine?.text || ''}</span>
    </div>
  )
}
