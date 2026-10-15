// app/src/pages/journal-2-0/lib/alertPhraseHosting.js
/**
 * Tier 2 part A, item 8 -- the "Set alert" chip menu's two handles on the alert plugin (lib/alertPhraseOffer.js):
 * the mount/unmount handshake and the dismissal. Imported ONLY by the menu (components/notebook/AlertPhraseMenu.jsx,
 * a lazy chunk), so they never ship in the note's first open (I5); the plugin itself, which every keystroke runs,
 * stays eager.
 */
import { alertPhraseKey } from './alertPhraseOffer'

/** The menu's mount/unmount handshake. Flips the flag (and, when hosting, stores the parser the menu hands
 *  over), then sends a no-op meta transaction so the plugin state recomputes at once (`meta` is `{}`: it
 *  names no dismissal). Un-hosting also clears `showing`. */
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
