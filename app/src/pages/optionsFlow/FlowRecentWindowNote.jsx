// Wave 5: the label a partial Search answer must carry. See `flowRecentWindow.js`.
//
// ⛔ A RECENT WINDOW IS A DIFFERENT ANSWER FROM THE FULL HISTORY (a print's direction can depend
// on rows outside the window), so the server only sends one to a caller that promises to say so.
// This is that promise kept: when the product on screen is a window, the member reads which
// sessions it covers; when it is the full history, this renders nothing.
//
// ⛔ PARTNER FILE, REBASE-SAFE HOOK. `OptionsFlow.jsx` mounts this once in the Search view and
// passes the `searchFull` state it already holds. Every string lives in `flowSearchFetch.js`
// (`recentWindowLabel`), every style in `FlowRecentWindowNote.module.css`.

import { recentWindowLabel } from './flowSearchFetch'
import { searchWindowOf } from './flowRecentWindow'
import styles from './FlowRecentWindowNote.module.css'

/**
 * @param {object} props
 * @param {string} props.sym the selected ticker
 * @param {{sym: string, data: object}|null} props.searchFull the page's landed Search product
 */
export default function FlowRecentWindowNote({ sym, searchFull }) {
  const product = searchFull && searchFull.sym === sym ? searchFull.data : null
  const w = searchWindowOf(product)
  if (!w) return null
  return (
    <p className={styles.note} role="note" data-testid="flow-recent-window-note">
      {recentWindowLabel(w)}
    </p>
  )
}
