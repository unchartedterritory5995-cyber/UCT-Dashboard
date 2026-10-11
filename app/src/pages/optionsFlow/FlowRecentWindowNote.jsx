// Wave 5: the label a partial Search answer must carry. See `flowRecentWindow.js`.
//
// ⛔ A RECENT WINDOW IS A DIFFERENT ANSWER FROM THE FULL HISTORY (a print's direction can depend
// on rows outside the window), so the server only sends one to a caller that promises to say so.
// This is that promise kept: when the product on screen is a window, the member reads which
// sessions it covers; when it is the full history, this renders nothing.
//
// 2026-10-11: the same promise for a head ticker's LAST full build, served for up to 15 min while
// its rebuild runs (`X-Flow-Cache: stale-full`): the member reads when that history was built.
//
// ⛔ PARTNER FILE, REBASE-SAFE HOOK. `OptionsFlow.jsx` mounts this once in the Search view and
// passes the `searchFull` state it already holds. Every string lives in `flowSearchFetch.js`
// (`recentWindowLabel`, `staleFullLabel`), every style in `FlowRecentWindowNote.module.css`.

import { recentWindowLabel, staleFullLabel } from './flowSearchFetch'
import { searchWindowOf, searchStaleOf } from './flowRecentWindow'
import styles from './FlowRecentWindowNote.module.css'

/**
 * @param {object} props
 * @param {string} props.sym the selected ticker
 * @param {{sym: string, data: object}|null} props.searchFull the page's landed Search product
 */
export default function FlowRecentWindowNote({ sym, searchFull }) {
  const product = searchFull && searchFull.sym === sym ? searchFull.data : null
  const w = searchWindowOf(product)
  if (w) {
    return (
      <p className={styles.note} role="note" data-testid="flow-recent-window-note">
        {recentWindowLabel(w)}
      </p>
    )
  }
  const stale = searchStaleOf(product)
  const label = stale ? staleFullLabel(stale.asOf) : ''
  if (!label) return null
  return (
    <p className={styles.note} role="note" data-testid="flow-stale-full-note">
      {label}
    </p>
  )
}
