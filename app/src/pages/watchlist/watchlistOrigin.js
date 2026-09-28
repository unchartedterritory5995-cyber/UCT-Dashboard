/**
 * TERM-077 / FB-A12-03 — what a saved list says about where it came from.
 *
 * The server attaches `origin` to a list only when the member saved it from
 * another list AND the gate is on (`api/services/watchlist_origin.py`). No
 * origin => this module returns null and nothing is drawn, so an ordinary list
 * is untouched.
 *
 * ⛔ STALENESS IS SAID IN WORDS. A linked list whose source vanished, or that
 * was edited while it could not be guarded, keeps its mode and says so — it
 * never quietly reads like a healthy link, and never quietly becomes a copy.
 */

function when(iso) {
  if (!iso) return 'an unknown time'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'an unknown time'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function isLinkedList(wl) {
  return wl?.origin?.mode === 'link'
}

/** @returns {{text: string, stale: boolean} | null} */
export function originLine(origin) {
  if (!origin || !origin.mode) return null
  const name = origin.source_name || 'another list'
  if (origin.mode === 'copy') {
    return {
      text: `Copied from ${name} on ${when(origin.created_at)} · a snapshot, independent of the source`,
      stale: false,
    }
  }
  switch (origin.state) {
    case 'current':
      return { text: `Linked to ${name} · follows the source · last change applied ${when(origin.synced_at)}`, stale: false }
    case 'source_unavailable':
      return { text: `Linked to ${name} · source unavailable — showing the list as of ${when(origin.synced_at)}`, stale: true }
    case 'paused_edited':
      return {
        text: `Linked to ${name} · not following — this list was edited after its last sync (${when(origin.synced_at)}), so the source is not applied over those edits`,
        stale: true,
      }
    default:
      return { text: `Linked to ${name} · sync status unknown`, stale: true }
  }
}
