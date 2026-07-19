// app/src/pages/charts/grid/peerFill.js
//
// Commit-triggered peer fill for Groups mode. A monotonic request id makes a
// slow earlier response lose to a faster later one (type AAPL then MSFT fast ->
// only MSFT's peers land). On success it hands the caller an undo snapshot.

export function makePeerFiller({ fetchPeers, fillCells, onUndoAvailable }) {
  let gen = 0
  async function run(seedSym, { n = 8, group = null, snapshot = null } = {}) {
    const mine = ++gen
    const seed = (seedSym || '').toUpperCase()
    // Seed appears instantly (the peer fetch — especially a cold AI resolve —
    // can take 1-2s; the trader sees their ticker immediately, peers stream in).
    fillCells([seed], group || null)
    const res = await fetchPeers(seed, { n: Math.max(1, n - 1) })
    if (mine !== gen) return                     // a newer commit superseded this one
    const peers = (res && Array.isArray(res.peers)) ? res.peers : []
    const syms = [seed, ...peers].slice(0, n)
    // Carry also_in (the seed's OTHER theme memberships) + name + seed so the
    // group header can offer a "also in: [groups]" switcher for multi-membership.
    const nextGroup = res && res.group_id
      ? {
          id: res.group_id,
          name: res.group_name || (group && group.name) || null,
          by: 'today', n, seed,
          alsoIn: Array.isArray(res.also_in) ? res.also_in : [],
        }
      : group
    fillCells(syms, nextGroup || null)
    if (snapshot) onUndoAvailable?.({ label: `filled peers of ${seed}`, snapshot })
  }
  return { run }
}
