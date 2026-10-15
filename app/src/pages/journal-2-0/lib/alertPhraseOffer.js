// app/src/pages/journal-2-0/lib/alertPhraseOffer.js
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { MAX_PHRASE_TEXT, parseAlertPhrase } from './alertPhrase'
import { smartChipsEnabled } from './smartChipsFlag'

/**
 * Tier 2 part A, item 8 -- the OFFER behind the "Set alert" chip. Like linkPasteOffer.js, the
 * offer lives in editor state and a menu (components/notebook/AlertPhraseMenu.jsx) only reads it.
 *
 * ⛔ ON THE TYPING PATH. `apply` reads ONLY the caret's text block, and only when it contains the
 * word "alert"; it returns the IDENTICAL state object whenever what it reads did not change, so
 * the menu's reducer bails (the TY7 lesson in LinkPasteMenu.jsx). Switch off -> one flag read.
 * ⛔ IT NEVER SETS AN ALERT. Alt+Enter asks the editor page to open the sheet; the member presses.
 * ⛔ PRIORITY 50: every suggestion menu (slash, @ dates, note links) sees Enter and Escape first.
 * ⛔ HOSTED ONLY. `buildExtensions()` also feeds the dashboard widget, the rich-text field and the
 * version preview, none of which mounts the chip menu. Offering there would swallow Escape and
 * Alt+Enter with nothing on screen, so the plugin offers nothing until a menu has said it is
 * mounted (`setAlertOfferHosted`, called by AlertPhraseMenu's mount effect).
 */
export const alertPhraseKey = new PluginKey('uctAlertPhraseOffer')
export const ALERT_OFFER_EVENT = 'uct:notebook-alert-offer'
const EMPTY = Object.freeze({ offer: null, dismissed: Object.freeze([]) })
const DISMISS_KEEP = 20

export function offerAt(state, dismissed) {
  const sel = state.selection
  if (!sel.empty) return null
  const $head = sel.$head
  const block = $head.parent
  if (!block.isTextblock || block.type.spec.code) return null
  const text = block.textContent
  if (text.length > MAX_PHRASE_TEXT || !/alert/i.test(text) || dismissed.includes(text)) return null
  const parsed = parseAlertPhrase(text)
  return parsed ? { from: $head.start(), to: $head.end(), text, parsed } : null
}

/** The menu's mount/unmount handshake. Flips the flag, then sends a no-op meta transaction so the
 *  plugin state recomputes at once (`meta` is `{}`: it names no dismissal). */
export function setAlertOfferHosted(editor, hosted) {
  const store = editor?.storage?.alertPhraseOffer
  if (!store) return
  store.hosted = hosted === true
  // ⛔ `editor.view` IS A THROWING GETTER while no view is mounted (R5-1); `isDestroyed` is false exactly
  // when a live view exists. With none, the flag alone is enough: the first transaction reads it.
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(alertPhraseKey, {}))
}

export const dismissAlertOffer = (editor) => {
  if (!editor || editor.isDestroyed) return
  const st = alertPhraseKey.getState(editor.state)
  if (!st?.offer) return
  editor.view.dispatch(editor.state.tr.setMeta(alertPhraseKey, { dismiss: st.offer.text }))
}

export const AlertPhraseOffer = Extension.create({
  name: 'alertPhraseOffer',
  priority: 50,
  addStorage() {
    return { hosted: false }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: alertPhraseKey,
      state: {
        init: () => EMPTY,
        apply(tr, value, _old, next) {
          if (!smartChipsEnabled()) return EMPTY
          if (editor?.storage?.alertPhraseOffer?.hosted !== true) return EMPTY
          const meta = tr.getMeta(alertPhraseKey)
          let { dismissed } = value
          if (meta?.dismiss) dismissed = [...dismissed, meta.dismiss].slice(-DISMISS_KEEP)
          if (!meta && !tr.docChanged && !tr.selectionSet) return value
          const offer = editor?.isEditable === false ? null : offerAt(next, dismissed)
          const same = offer && value.offer && offer.text === value.offer.text && offer.from === value.offer.from
          const kept = same ? value.offer : offer
          if (kept === value.offer && dismissed === value.dismissed) return value
          return { offer: kept, dismissed }
        },
      },
      props: {
        handleKeyDown(view, event) {
          const st = alertPhraseKey.getState(view.state)
          if (!st?.offer) return false
          if (event.key === 'Escape') {
            view.dispatch(view.state.tr.setMeta(alertPhraseKey, { dismiss: st.offer.text }))
            return true
          }
          if (event.key === 'Enter' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            view.dom.dispatchEvent(new CustomEvent(ALERT_OFFER_EVENT, { bubbles: true, detail: st.offer }))
            return true
          }
          return false
        },
      },
    })]
  },
})
