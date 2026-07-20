// app/src/pages/charts/grid/peerFill.js
//
// Commit-triggered peer fill for Groups mode. A monotonic request id makes a
// slow earlier response lose to a faster later one (type AAPL then MSFT fast ->
// only MSFT's peers land). The id lives in a caller-shared counter (`seq`) so
// OTHER fill sources (the also-in group switcher) participate in the same
// ordering — a stale switch can't clobber a newer typed fill or vice versa.
//
// Mega-review #14: never pre-blank the board. The seed lands optimistically in
// the TYPED cell only (updateCellAt); the full grid reseeds ONLY after the
// backend returns a real group. A mistyped ticker keeps the rest of the board.

export function makePeerFiller({
  fetchPeers,
  fillCells,
  updateCellAt = null,   // (index, cell) — optimistic seed into the typed cell
  clearGroup = null,     // () — drop the group header when a fill has no group
  onUndoAvailable,
  onNotice = null,       // (msg) — surfaced as a transient toast (never silent)
  seq = null,            // shared {n} counter across fill sources
}) {
  const counter = seq || { n: 0 }
  async function run(seedSym, { n = 8, cellIndex = null, cellNext = null, group = null, snapshot = null } = {}) {
    const mine = ++counter.n
    const seed = (seedSym || '').toUpperCase()
    // Seed appears instantly in ITS cell (the peer fetch — especially a cold AI
    // resolve — can take 1-2s); the rest of the board is untouched until the
    // backend confirms a group.
    if (cellIndex != null && cellNext && updateCellAt) updateCellAt(cellIndex, cellNext)
    let res = null
    try {
      res = await fetchPeers(seed, { n: Math.max(1, n - 1) })
    } catch { res = null }
    if (mine !== counter.n) return               // a newer commit superseded this one
    const peers = (res && Array.isArray(res.peers)) ? res.peers : []

    if (!res || !res.group_id) {
      // No persistent group (orphan with AI peers, or nothing at all). Never
      // leave the PREVIOUS group's header/chips over the new board.
      if (peers.length) {
        fillCells([seed, ...peers].slice(0, n), null)
        clearGroup?.()
        if (snapshot) onUndoAvailable?.({ label: `filled AI peers of ${seed}`, snapshot })
      } else {
        clearGroup?.()
        onNotice?.(`No group found for ${seed} — kept your board`)
      }
      return
    }

    const syms = [seed, ...peers].slice(0, n)
    // Carry also_in (the seed's OTHER theme memberships) + name + seed so the
    // group header can offer a "also in: [groups]" switcher for multi-membership.
    const nextGroup = {
      id: res.group_id,
      name: res.group_name || null,
      by: 'today', n, seed,
      alsoIn: Array.isArray(res.also_in) ? res.also_in : [],
    }
    fillCells(syms, nextGroup)
    if (snapshot) onUndoAvailable?.({ label: `filled peers of ${seed}`, snapshot })
  }
  return { run }
}
