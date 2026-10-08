// The Layout Dock's "＋ New layout": create an EMPTY layout under the typed name.
//
// ⛔ CREATE-ONLY. POST /api/charts/layouts without `create_only` is a name-keyed UPSERT
// (api/routers/charts_layouts.py save_layout → svc.upsert), so typing the name of a layout
// you already have used to REPLACE it with an empty board, silently. The save now goes
// first and create-only: a clash is refused by the server (409) and nothing on the board
// changes; only after the row exists is the board blanked and the new layout made active.
// UCT Agent's layout.create uses the same create-only door.

/**
 * @param {string} name
 * @param {{ saveLayout: Function, cols: number }} deps
 * @returns {Promise<{ok: true, saved: object} | {ok: false, reason: string}>}
 */
export async function createEmptyNamedLayout(name, { saveLayout, cols }) {
  const n = String(name || '').trim()
  if (!n) return { ok: false, reason: 'A layout needs a name.' }
  try {
    const saved = await saveLayout({ name: n, layout: { widgets: [], cols }, groups: null, scope: 'user', createOnly: true })
    return saved?.id != null ? { ok: true, saved } : { ok: false, reason: 'The layout could not be created.' }
  } catch (e) {
    const msg = String(e?.message || '')
    return { ok: false, reason: /already have a layout/i.test(msg)
      ? `You already have a layout named “${n}” — nothing was replaced. Pick another name.`
      : (msg || 'The layout could not be created.') }
  }
}
