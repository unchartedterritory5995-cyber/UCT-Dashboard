// app/src/pages/journal-2-0/lib/alertPhraseOffer.js
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
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
 * ⛔ THE PARSER IS HANDED IN, NEVER IMPORTED. The sentence grammar (lib/alertPhrase.js, and through it the
 * terminal's price parser) lives in the menu's LAZY chunk; the menu passes it here when it hosts
 * (`storage.parse`). "Hosted" already means "the menu is mounted", so the parser is present whenever the
 * plugin may offer, and the note's first open pays for neither.
 * ⛔ KEYS ONLY WHILE THE CHIP SHOWS (R-T2A-10). An offer can exist with no chip on screen (a word the server
 * does not confirm, a failed check, a pronoun in a note with no ticker); the menu publishes
 * `storage.showing` and Escape / Alt+Enter are taken only while it is true, so no other Escape handler
 * loses its key to something the member cannot see.
 */
export const alertPhraseKey = new PluginKey('uctAlertPhraseOffer')
export const ALERT_OFFER_EVENT = 'uct:notebook-alert-offer'
const EMPTY = Object.freeze({ offer: null, dismissed: Object.freeze([]) })
const DISMISS_KEEP = 20

function readOffer(state, dismissed, parse) {
  if (typeof parse !== 'function') return null
  const sel = state.selection
  if (!sel.empty) return null
  const $head = sel.$head
  const block = $head.parent
  if (!block.isTextblock || block.type.spec.code) return null
  const text = block.textContent
  if (!/alert/i.test(text) || dismissed.includes(text)) return null
  const parsed = parse(text)
  return parsed ? { from: $head.start(), to: $head.end(), text, parsed } : null
}

/** The caret paragraph's offer, or null. ⛔ NEVER THROWS: it runs inside `apply`, and a throw there breaks
 *  `view.dispatch`, so the member's keystrokes stop landing. A parser defect costs the chip, never the typing. */
export function offerAt(state, dismissed, parse) {
  try {
    return readOffer(state, dismissed, parse)
  } catch {
    return null
  }
}

/** The menu's mount/unmount handshake. Flips the flag (and, when hosting, stores the parser the menu hands
 *  over), then sends a no-op meta transaction so the plugin state recomputes at once (`meta` is `{}`: it
 *  names no dismissal). */
export function setAlertOfferHosted(editor, hosted, parse) {
  const store = editor?.storage?.alertPhraseOffer
  if (!store) return
  store.hosted = hosted === true
  if (store.hosted && typeof parse === 'function') store.parse = parse
  if (!store.hosted) store.showing = false
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
    return { hosted: false, showing: false, parse: null }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: alertPhraseKey,
      state: {
        init: () => EMPTY,
        apply(tr, value, _old, next) {
          if (!smartChipsEnabled()) return EMPTY
          const store = editor?.storage?.alertPhraseOffer
          if (store?.hosted !== true) return EMPTY
          const meta = tr.getMeta(alertPhraseKey)
          let { dismissed } = value
          if (meta?.dismiss) dismissed = [...dismissed, meta.dismiss].slice(-DISMISS_KEEP)
          if (!meta && !tr.docChanged && !tr.selectionSet) return value
          const offer = editor?.isEditable === false ? null : offerAt(next, dismissed, store.parse)
          const same = offer && value.offer && offer.text === value.offer.text && offer.from === value.offer.from
          const kept = same ? value.offer : offer
          if (kept === value.offer && dismissed === value.dismissed) return value
          return { offer: kept, dismissed }
        },
      },
      props: {
        handleKeyDown(view, event) {
          const store = editor?.storage?.alertPhraseOffer
          if (store?.hosted !== true || store.showing !== true) return false
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
