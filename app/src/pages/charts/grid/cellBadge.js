// Per-cell scanner badge data: live today% + the group's static tier/rationale.
// Index-aligned to cells; null for empty cells so manual grids show nothing.

export function buildCellBadges(cells, metaBySym, livePrices) {
  return (cells || []).map(c => {
    if (!c || !c.sym) return null
    const m = (metaBySym && metaBySym[c.sym]) || {}
    const lp = (livePrices && livePrices[c.sym]) || {}
    const changePct = Number.isFinite(lp.change_pct) ? lp.change_pct : null
    // Provenance mark (spec §4c): engine-added members get a muted dot so a
    // trader can tell them from curated names at a glance. Absent source = owner.
    return { changePct, tier: m.tier || null, rationale: m.rationale || '', engine: m.source === 'engine' }
  })
}
