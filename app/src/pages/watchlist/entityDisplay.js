// app/src/pages/watchlist/entityDisplay.js
//
// Entity Master UC-2, the member-facing half. When WATCHLIST_ENTITY_KEYS_ENABLED is armed,
// `get_watchlist` / `list_user_watchlists` (api/services/watchlist_entity_keys.py `annotate`)
// decorate a member list's rows with `entity_id`, `display_sym` and `entity_marker`
// ('renamed' | 'delisted' | null). `sym` is never changed: it stays the row's identity (remove,
// notes, reorder, prices all key on it). This file only answers "what does the row SAY".
//
// ⛔ Fields absent (flag unset, a prebuilt index list, an unknown or ambiguous ticker keyed to
// NULL) => `null`, and every caller renders exactly as before.

const up = (v) => String(v ?? '').trim().toUpperCase()

/**
 * Pure: the current symbol and a plain-words marker for one watchlist row, or `null` when the
 * row should render as it always has.
 *
 *   renamed   NVDA added, company now trades as NVDX  => { shown: 'NVDX', note: 'renamed from NVDA' }
 *   delisted  the company no longer trades            => { shown: <last ticker>, note: 'delisted' }
 *
 * `title` is the full sentence for a hover / screen reader.
 */
export function entityDisplay(item) {
  if (!item || typeof item !== 'object') return null
  const sym = up(item.sym)
  const shown = up(item.display_sym)
  if (!sym || !shown) return null
  const marker = item.entity_marker
  if (marker === 'delisted') {
    return {
      shown, note: 'delisted', tone: 'danger',
      title: shown === sym
        ? `${sym} is delisted. The company no longer trades.`
        : `This company is delisted. You added it as ${sym}; its last ticker was ${shown}.`,
    }
  }
  if (shown === sym) return null
  return {
    shown, note: `renamed from ${sym}`, tone: null,
    title: `This company now trades as ${shown}. You added it as ${sym}.`,
  }
}

/** Pure: `{ [sym]: entityDisplay }` for a list's rows that carry a marker; `{}` when none do. */
export function entityDisplayBySym(items) {
  const out = {}
  for (const it of Array.isArray(items) ? items : []) {
    const d = entityDisplay(it)
    if (d && !out[up(it.sym)]) out[up(it.sym)] = d
  }
  return out
}
