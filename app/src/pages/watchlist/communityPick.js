// The ONE resolver for a widget's `community:` watch key.
//
// A Watchlist widget remembers the list it was pinned to as `community:<id>`.
// That is exact and stable for a list that lives (a dated Sunday Scans issue keeps
// its id for its 12-week life) — but it can never FOLLOW: a widget pinned to
// "August 16" stays on August 16 while the issues roll on. So the server may tag
// one row with a stable `alias` (e.g. the newest Sunday Scans issue carries
// `alias: "sunday-scans-latest"`), and a widget pinned to `community:alias:<alias>`
// resolves to whichever row carries that alias THIS week.
//
// Every site that turns a pick key into a list row goes through here — the
// 2026-08-21 dead-widget ("Sunday Scans · 0 stocks") was three hand-rolled
// `community:${w.id} === pickList` matches that no alias could ever satisfy.

export const COMMUNITY_PREFIX = 'community:'
export const ALIAS_PREFIX = 'community:alias:'

export function communityKey(wl) {
  return `${COMMUNITY_PREFIX}${wl.id}`
}

export function aliasKey(alias) {
  return `${ALIAS_PREFIX}${alias}`
}

export function isCommunityPick(pickList) {
  return typeof pickList === 'string' && pickList.startsWith(COMMUNITY_PREFIX)
}

/** The list row a `community:` pick key names, or null. `pool` = community + prebuilt rows. */
export function resolveCommunityPick(pool, pickList) {
  if (!isCommunityPick(pickList)) return null
  const rows = Array.isArray(pool) ? pool : []
  if (pickList.startsWith(ALIAS_PREFIX)) {
    const alias = pickList.slice(ALIAS_PREFIX.length)
    if (!alias) return null
    return rows.find(w => w && w.alias === alias) || null
  }
  return rows.find(w => w && communityKey(w) === pickList) || null
}
