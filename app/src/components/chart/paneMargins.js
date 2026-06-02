// app/src/components/chart/paneMargins.js
// Pure helper: compute Lightweight-Charts scaleMargins for the stacked sub-pane
// bands (volume + oscillators) inside pane 0. Extracted from StockChart so the
// stacking math (including volume-overlay exclusion) can be unit-tested.
//
// Each enabled sub-pane gets a band at the bottom of pane 0; `main` is the
// price area above them. `excludeKeys` (Set or array) drops indicators that
// have been overlaid into the volume pane and so no longer reserve a band.

export function computePaneMargins(cs, hasVolume, excludeKeys) {
  const ind = cs.indicators || {}
  const ex = excludeKeys instanceof Set ? excludeKeys : new Set(excludeKeys || [])
  // Sub-panes in stacking order (bottom of chart → top). key, enabled, height.
  const PANES = [
    { key: 'obv',       enabled: !!ind.obv?.enabled       && !ex.has('obv'),       baseH: 0.13 },
    { key: 'atr',       enabled: !!ind.atr?.enabled       && !ex.has('atr'),       baseH: 0.13 },
    { key: 'adx',       enabled: !!ind.adx?.enabled       && !ex.has('adx'),       baseH: 0.15 },
    { key: 'macd',      enabled: !!ind.macd?.enabled      && !ex.has('macd'),      baseH: 0.17 },
    { key: 'cci',       enabled: !!ind.cci?.enabled       && !ex.has('cci'),       baseH: 0.15 },
    { key: 'williamsR', enabled: !!ind.williamsR?.enabled && !ex.has('williamsR'), baseH: 0.15 },
    { key: 'mfi',       enabled: !!ind.mfi?.enabled       && !ex.has('mfi'),       baseH: 0.15 },
    { key: 'stoch',     enabled: !!ind.stoch?.enabled     && !ex.has('stoch'),     baseH: 0.15 },
    { key: 'rsi',       enabled: !!ind.rsi?.enabled       && !ex.has('rsi'),       baseH: 0.15 },
    { key: 'volume',    enabled: hasVolume,                baseH: 0.15 },
  ]
  const active = PANES.filter(p => p.enabled)
  const totalBase = active.reduce((s, p) => s + p.baseH, 0)
  // Cap sub-panes at 72% so the price area always gets ≥28%.
  const scale = totalBase > 0.72 ? 0.72 / totalBase : 1
  let bottom = 0
  const out = {}
  for (const { key, baseH } of active) {
    const h = +((baseH * scale).toFixed(2))
    out[key] = { top: +((1 - bottom - h).toFixed(2)), bottom: +bottom.toFixed(2) }
    bottom = +(bottom + h).toFixed(2)
  }
  // Top margin 0.30 leaves the highest candle ~30% from the top of the chart
  // so there's deliberate headroom above price action (matches TC2000-style layout).
  out.main = { top: 0.30, bottom: bottom }
  return out
}
