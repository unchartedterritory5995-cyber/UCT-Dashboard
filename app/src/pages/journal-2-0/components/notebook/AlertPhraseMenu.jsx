// app/src/pages/journal-2-0/components/notebook/AlertPhraseMenu.jsx
/**
 * Tier 2 part A, item 8 -- the "Set alert" chip. The offer lives in editor state
 * (lib/alertPhraseOffer.js); this reads it, asks the server ONCE per sentence whether its word is
 * a ticker here (lib/smartChipsApi.js), and only then shows the chip. "it" / "the stock" / "price"
 * mean the note's ticker and need no question. The chip never sets anything: "Set alert…" (or
 * Alt+Enter) opens TextAlertSheet, filled in, and the member presses there.
 *
 * Like LinkPasteMenu: buttons keep the editor's focus (mousedown prevented); the reducer tracks the
 * plugin's offer OBJECT, so a keystroke that does not change the offer does not re-render (TY7).
 *
 * ⛔ HOSTING. Mounting this menu is what switches the plugin on (`setAlertOfferHosted`); unmounting
 * switches it off. An editor that mounts no menu (the dashboard widget, the rich-text field, the
 * version preview) therefore never has its Escape or Alt+Enter taken.
 */
import { Suspense, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import lazyChunk from '../../lib/lazyChunk'
import { ALERT_OFFER_EVENT, alertPhraseKey } from '../../lib/alertPhraseOffer'
import { dismissAlertOffer, setAlertOfferHosted } from '../../lib/alertPhraseHosting'
import { describeAlert, parseAlertPhrase } from '../../lib/alertPhrase'
import { confirmsSymbol, tickersIn } from '../../lib/smartChipsApi'
import styles from './AlertPhraseMenu.module.css'

// ⛔ Through lazyChunk, never a bare React.lazy (NotebookTab.lazyViews.test.js): the sheet is fetched the
// first time it opens, never on note open.
const TextAlertSheet = lazyChunk(() => import('./TextAlertSheet'))
export const ALERT_MENU_LABEL = 'Alert suggestion'
export const CHECK_DELAY_MS = 600

function offerReducer(prev, editor) {
  if (!editor || editor.isDestroyed) return prev
  const next = editor.isEditable ? alertPhraseKey.getState(editor.state)?.offer ?? null : null
  return next === prev ? prev : next
}

export default function AlertPhraseMenu({ editor, noteTicker }) {
  const [offer, bump] = useReducer(offerReducer, null)
  const [confirmed, setConfirmed] = useState(null) // { offer, symbol }
  const [sheet, setSheet] = useState(null) // initial values while open
  const barRef = useRef(null)

  // Subscribe FIRST, then host: hosting sends one no-op transaction, and that is how a sentence already
  // in the paragraph is picked up on mount.
  // ⛔ The editor's VIEW may not exist yet (it mounts after the page's first render, and `editor.view` is a
  // throwing getter until it does -- R5-1, NoteEditorPage.viewNotMounted.test.jsx). Nothing here reads `.view`
  // unguarded, and every effect that needs the view runs again on tiptap's own `mount` / `create`.
  useEffect(() => {
    if (!editor) return undefined
    const update = () => bump(editor)
    editor.on('transaction', update)
    return () => { editor.off('transaction', update) }
  }, [editor])

  // Hosting also hands the plugin its parser: the grammar lives in THIS lazy chunk, never in the note's first open.
  useEffect(() => {
    if (!editor) return undefined
    const host = () => setAlertOfferHosted(editor, true, parseAlertPhrase)
    host()
    editor.on('mount', host)
    editor.on('create', host)
    return () => {
      editor.off('mount', host)
      editor.off('create', host)
      setAlertOfferHosted(editor, false)
    }
  }, [editor])

  // Which symbol this offer means, confirmed. A pronoun is the note's own ticker (already a validated field),
  // known on the spot. Anything else waits for typing to pause, then asks the server once; the answer is kept
  // with the OFFER it answered, so an answer for an earlier sentence can never confirm a later one.
  useEffect(() => {
    if (!offer || offer.parsed.pronoun) return undefined
    let live = true
    const t = setTimeout(async () => {
      const tickers = await tickersIn(offer.text)
      if (live && confirmsSymbol(tickers, offer.parsed.symbol)) setConfirmed({ offer, symbol: offer.parsed.symbol })
    }, CHECK_DELAY_MS)
    return () => { live = false; clearTimeout(t) }
  }, [offer])

  let ready = null
  if (offer?.parsed.pronoun) {
    if (noteTicker) ready = { offer, symbol: String(noteTicker).toUpperCase() }
  } else if (offer && confirmed && confirmed.offer === offer) {
    ready = confirmed
  }
  const words = ready ? describeAlert(offer.parsed, ready.symbol) : ''
  // DERIVED, not stored: the text is the same string while the caret moves inside one sentence, so the live
  // region speaks once per offer and goes quiet when the offer goes.
  const spoken = ready ? `Alert suggestion: ${words}. Press Alt+Enter to set it, or Escape to dismiss.` : ''

  // ⛔ R-T2A-10: the plugin takes Escape and Alt+Enter ONLY while this toolbar is on screen. Published in a
  // layout effect (before the browser can deliver the next key) and cleared on unmount, beside un-hosting.
  const chipShowing = !!(ready && !sheet)
  useLayoutEffect(() => {
    const store = editor?.storage?.alertPhraseOffer
    if (!store) return undefined
    store.showing = chipShowing
    return () => { store.showing = false }
  }, [editor, chipShowing])

  const open = () => { if (ready) setSheet({ ...offer.parsed, symbol: ready.symbol }) }
  // The listener below is attached once per editor and must call the LATEST `open`, so it reads a ref that
  // is refreshed after every commit (never written during render).
  const openRef = useRef(open)
  useLayoutEffect(() => { openRef.current = open })

  useEffect(() => {
    if (!editor) return undefined
    const onOpen = () => openRef.current()
    let dom = null
    const detach = () => {
      if (dom) dom.removeEventListener(ALERT_OFFER_EVENT, onOpen)
      dom = null
    }
    const attach = () => {
      if (editor.isDestroyed) return // no live view: `editor.view` would throw
      const next = editor.view.dom
      if (next === dom) return
      detach()
      dom = next
      dom.addEventListener(ALERT_OFFER_EVENT, onOpen)
    }
    attach()
    editor.on('mount', attach)
    editor.on('create', attach)
    editor.on('unmount', detach)
    return () => {
      editor.off('mount', attach)
      editor.off('create', attach)
      editor.off('unmount', detach)
      detach()
    }
  }, [editor])

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || !ready || !editor || editor.isDestroyed) return
    let rect = null
    try { rect = editor.view.coordsAtPos(Math.min(offer.to, editor.state.doc.content.size)) } catch { rect = null }
    if (!rect) return
    const w = bar.offsetWidth || 0
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0
    bar.style.left = `${Math.round(Math.max(8, Math.min(rect.left, (vw || rect.left + w + 8) - w - 8)))}px`
    bar.style.top = `${Math.round((rect.bottom || 0) + 6)}px`
  })

  const hold = (e) => e.preventDefault() // keep the editor's focus and caret
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">{spoken}</span>
      {chipShowing && (
        <div ref={barRef} className={styles.bar} role="toolbar" aria-label={ALERT_MENU_LABEL}>
          <UIcon name="bell" size={14} />
          <span className={styles.words}>{words}</span>
          <button type="button" className={styles.btn} onMouseDown={hold} onClick={open}>Set alert…</button>
          <button
            type="button"
            className={styles.icon}
            onMouseDown={hold}
            onClick={() => dismissAlertOffer(editor)}
            aria-label="Dismiss alert suggestion"
          >
            <UIcon name="x" size={14} />
          </button>
        </div>
      )}
      {sheet && (
        <Suspense fallback={null}>
          <TextAlertSheet
            open
            initial={sheet}
            onClose={() => { setSheet(null); editor?.commands?.focus?.() }}
            onDone={(text) => {
              setSheet(null)
              dismissAlertOffer(editor)
              editor?.storage?.uctJournalWidgets?.notify?.(text, 'success')
            }}
          />
        </Suspense>
      )}
    </>
  )
}
