// The Map view's model (Finviz's map): the screen's results as tiles sized by market cap and
// coloured by the day's change, grouped by sector, industry or theme. Pure, so the sizing,
// colouring and grouping rules are tested without a canvas.

export const GROUP_BYS = [
  { key: 'sector', label: 'Sector', none: 'Other' },
  { key: 'industry', label: 'Industry', none: 'Other' },
  { key: 'theme', label: 'Theme', none: 'No theme' },
]

/** The day's change → a tier of the app's heat ladder (heatTiles.TIER_HEAT_TOKEN), symmetric
 *  around flat. Under half a percent either way, or no reading at all, has no heat. */
export function chgTier(chg) {
  if (chg == null || !Number.isFinite(chg)) return ''
  if (chg >= 4) return 'g3'
  if (chg >= 2) return 'g2'
  if (chg >= 0.5) return 'g1'
  if (chg <= -4) return 'r3'
  if (chg <= -2) return 'r2'
  if (chg <= -0.5) return 'r1'
  return ''
}

const num = v => (v == null || v === '' ? null : Number(v))

/**
 * @returns {{ groups: { name, value, children: { ticker, company, value, cap, chg, tier }[] }[], missingCap: number }}
 * A stock with no market cap is drawn at the smallest cap on the map (counted in `missingCap`),
 * never dropped: a map that silently loses names reads as a smaller screen than it is.
 */
export function buildHeatMap(rows = [], { groupBy = 'sector', themeData = {}, livePrices = {} } = {}) {
  const by = GROUP_BYS.find(g => g.key === groupBy) || GROUP_BYS[0]
  const caps = rows.map(r => num(r.market_cap)).filter(c => Number.isFinite(c) && c > 0)
  const floor = caps.length ? Math.min(...caps) : 1
  let missingCap = 0
  const byName = new Map()
  for (const r of rows) {
    if (!r?.ticker) continue
    const raw = by.key === 'theme' ? themeData[r.ticker] : r[by.key]
    const name = (typeof raw === 'string' && raw.trim()) || by.none
    const cap = num(r.market_cap)
    const hasCap = Number.isFinite(cap) && cap > 0
    if (!hasCap) missingCap += 1
    const live = num(livePrices?.[r.ticker]?.change_pct)
    const chg = Number.isFinite(live) ? live : num(r.chg_pct_1d)
    const tile = { ticker: r.ticker, company: r.company || null, value: hasCap ? cap : floor, cap: hasCap ? cap : null,
      chg: Number.isFinite(chg) ? chg : null, tier: chgTier(chg) }
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(tile)
  }
  const groups = [...byName].map(([name, children]) => {
    children.sort((a, b) => b.value - a.value)
    return { name, value: children.reduce((s, c) => s + c.value, 0), children }
  })
  groups.sort((a, b) => b.value - a.value)
  return { groups, missingCap }
}

// A tile's label grows with its share of the map (Finviz's big-name labels): [ticker, change] px.
export const LABEL_SIZES = { xl: [26, 15], l: [18, 12], m: [13, 10], s: [10, 9] }
export const labelSize = share => (share > 0.08 ? 'xl' : share > 0.03 ? 'l' : share > 0.008 ? 'm' : 's')
export const LINE_T = tf => Math.round(tf * 1.25)
export const LINE_C = cf => Math.round(cf * 1.3)
// The two-line label's height at each size (the rich lineHeights ScreenerHeatMap draws with).
const LABEL_H = Object.fromEntries(Object.entries(LABEL_SIZES).map(([k, [tf, cf]]) => [k, LINE_T(tf) + LINE_C(cf)]))
// ⛔ ECharts centres a PLAIN-text label in its tile, but a RICH-text label (ours: a big ticker over
// a small change) is laid out from the TOP of the tile-sized text box, whatever `verticalAlign`
// says (zrender Text: rich lines start at boxY of the fixed outer height). So once the treemap has
// laid the tiles out, each tile gets a top padding of half its spare height: measured from the
// chart's own layout, never guessed (tilePads).
export function tilePads(leaves) {
  const out = {}
  for (const { ticker, height, size } of leaves) {
    out[ticker] = Math.max(0, Math.floor((height - (LABEL_H[size] ?? LABEL_H.s)) / 2))
  }
  return out
}
