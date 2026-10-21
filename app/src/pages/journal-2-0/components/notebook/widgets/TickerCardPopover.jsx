/**
 * Notebook widgets Task 10: the card a `$TICKER` chip opens (lib/tickerChip.js dispatches TICKER_CARD_EVENT on
 * the editor's own DOM). A LAZY chunk: it listens, and fetches, only once a chip is pressed. The preview IS the
 * card "Insert card" puts in the note (TickerCardEmbed, from the same payload). Touch gets a bottom sheet
 * (ContextPopover). Both inserts go AFTER the top-level block holding the chip (the paragraph itself, or the
 * whole list / table / container it sits in), never at the caret: pressing the chip put the caret inside
 * `$NVDA`, and a block inserted there split the member's sentence.
 */
import { useEffect, useRef, useState } from 'react'
import { NodeSelection } from '@tiptap/pm/state'
import ContextPopover from '../../../../../components/mobile/ContextPopover'
import UIcon from '../../../../../components/ui/UIcon'
import { TICKER_CARD_EVENT } from '../../../lib/tickerChip'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { fetchWidgetPayload } from '../../../lib/notebookWidgetsFetch'
import { chartInsertNodes } from '../../../lib/widgetEmbedCore'
import TickerCardEmbed from './TickerCardEmbed'
import styles from './TickerCardPopover.module.css'

export const loadFailedText = (symbol) => `Couldn't load ${symbol} right now.`

/** R58 (UX I-14): how long the mouse rests on a chip before its card opens. */
export const HOVER_INTENT_MS = 300
/** After an edit or a caret move, how long a mouseover is not read as a hover (a chip redrawn under the mouse). */
export const EDIT_QUIET_MS = 800
/** A desktop pointer: one that hovers and is precise. There a click places the caret and a hover opens the card. */
const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches === true

/** Where a widget goes for a chip at `pos`: after the top-level block holding it. */
export function insertPosAfterBlock(doc, pos) {
  const $p = doc.resolve(Math.max(0, Math.min(Number(pos) || 0, doc.content.size)))
  return $p.depth >= 1 ? $p.after(1) : $p.pos
}

export default function TickerCardPopover({ editor }) {
  const [card, setCard] = useState(null) // { seq, symbol, anchor, status: 'loading'|'ok'|'error', payload }
  const seqRef = useRef(0)
  const cardRef = useRef(null)
  cardRef.current = card

  useEffect(() => {
    if (!editor) return undefined
    const openFor = async (symbol, r = {}, pos) => {
      const seq = ++seqRef.current
      setCard({ seq, symbol, pos: Number.isInteger(pos) ? pos : null, anchor: { x: r.left || 0, y: (r.bottom || 0) + 6 }, status: 'loading', payload: null })
      const got = await fetchWidgetPayload('tickerCard', { symbol })
      // Only the latest chip's answer may fill the card.
      setCard((c) => (c && c.seq === seq
        ? { ...c, status: got.ok ? 'ok' : 'error', payload: got.ok ? got.payload : null } : c))
    }
    // R58 (UX I-14): a click opens the card only from a touch (or a pen). A mouse click is the member placing the
    // caret in `$NVDA` to edit it; on a desktop pointer the card opens on hover instead. A click that does not say
    // its pointer (an older browser) is read by the device: a desktop pointer places the caret.
    const onOpen = (e) => {
      const d = e?.detail || {}
      if (!d.symbol || d.via === 'mouse' || (!d.via && finePointer())) return
      openFor(d.symbol, d.rect, d.pos)
    }
    // F2 fix round 1 (review I-1): a hover becomes an open only if nothing else happened first. A press (the click
    // that places the caret), an edit or a caret move cancels a pending hover; and a chip redrawn under a resting
    // mouse while the member types (the browser sends it a fresh mouseover) starts nothing for EDIT_QUIET_MS.
    let hoverTimer = null
    let editedAt = 0
    const cancel = () => clearTimeout(hoverTimer)
    const onEdit = () => { editedAt = Date.now(); cancel() }
    const chipOf = (t) => (t?.closest ? t.closest('.tickerChip') : null)
    const onOver = (e) => {
      const el = chipOf(e.target)
      if (!el || !finePointer() || !editor.isEditable || Date.now() - editedAt < EDIT_QUIET_MS) return
      const sym = el.getAttribute('data-symbol')
      // Review m-9: the card already open for this symbol is not opened (and fetched) again.
      if (cardRef.current?.symbol === sym) return
      clearTimeout(hoverTimer)
      hoverTimer = setTimeout(() => {
        let pos = null
        try { pos = editor.view.posAtDOM(el, 0) } catch { pos = null }
        openFor(sym, el.getBoundingClientRect(), pos)
      }, HOVER_INTENT_MS)
    }
    const onOut = (e) => {
      const el = chipOf(e.target)
      if (el && !el.contains(e.relatedTarget)) clearTimeout(hoverTimer)
    }
    // The editor's VIEW is a throwing getter until it mounts: attach now if it exists, and on mount/create.
    let dom = null
    const detach = () => {
      clearTimeout(hoverTimer)
      dom?.removeEventListener(TICKER_CARD_EVENT, onOpen)
      dom?.removeEventListener('mouseover', onOver)
      dom?.removeEventListener('mouseout', onOut)
      dom?.removeEventListener('mousedown', cancel)
      dom = null
    }
    const attach = () => {
      if (editor.isDestroyed) return
      let next = null
      try { next = editor.view.dom } catch { return } // no view yet: `mount` / `create` attach again
      if (next === dom) return
      detach()
      dom = next
      dom.addEventListener(TICKER_CARD_EVENT, onOpen)
      dom.addEventListener('mouseover', onOver)
      dom.addEventListener('mouseout', onOut)
      dom.addEventListener('mousedown', cancel)
    }
    attach()
    editor.on('mount', attach)
    editor.on('create', attach)
    editor.on('unmount', detach)
    editor.on('update', onEdit)
    editor.on('selectionUpdate', onEdit)
    return () => {
      editor.off('update', onEdit)
      editor.off('selectionUpdate', onEdit)
      editor.off('mount', attach)
      editor.off('create', attach)
      editor.off('unmount', detach)
      detach()
    }
  }, [editor])

  if (!card) return null
  const { symbol, status, payload } = card
  const close = () => setCard(null)
  const insert = (nodes) => {
    close()
    if (!nodes?.length || !editor || editor.isDestroyed) return
    const at = insertPosAfterBlock(editor.state.doc, card.pos ?? editor.state.selection.from)
    editor.chain().focus().command(({ tr }) => {
      const size = tr.doc.content.size
      tr.insert(at, nodes.map((n) => editor.schema.nodeFromJSON(n)))
      const end = at + tr.doc.content.size - size
      const last = tr.doc.resolve(end).nodeBefore
      // Select the inserted embed so caretAfterWidgetEmbed parks the caret after it.
      if (last) tr.setSelection(NodeSelection.create(tr.doc, end - last.nodeSize))
      return true
    }).caretAfterWidgetEmbed().run()
  }
  const insertChart = () => insert(chartInsertNodes('chart', { symbol, tf: 'D' }, editor?.storage?.uctJournalWidgets?.chartSettings))
  const insertCard = () => { if (status === 'ok') insert([widgetEmbedNode('tickerCard', payload)]) }

  return (
    <ContextPopover open onClose={close} anchor={card.anchor} title={`$${symbol}`} width={320}>
      <div className={styles.body} data-testid="ticker-card-popover">
        {status === 'loading' && <p className={styles.note} role="status">Loading {symbol}…</p>}
        {status === 'error' && <p className={styles.note} role="alert">{loadFailedText(symbol)}</p>}
        {status === 'ok' && <TickerCardEmbed attrs={widgetEmbedNode('tickerCard', payload).attrs} height="auto" />}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={insertChart}>
            <UIcon name="chart" size={14} /> Insert chart
          </button>
          <button type="button" className={styles.btn} onClick={insertCard} disabled={status !== 'ok'}>
            <UIcon name="plus" size={14} /> Insert card
          </button>
        </div>
      </div>
    </ContextPopover>
  )
}
