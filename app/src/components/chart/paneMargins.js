// app/src/components/chart/paneMargins.js
// Pure helper: compute Lightweight-Charts scaleMargins for the stacked sub-pane
// bands (volume + oscillators) inside pane 0. Extracted from StockChart so the
// stacking math (including volume-overlay exclusion) can be unit-tested.
//
// Each enabled sub-pane gets a band at the bottom of pane 0; `main` is the
// price area above them. `excludeKeys` (Set or array) drops indicators that
// have been overlaid into the volume pane and so no longer reserve a band.
//
// HARD CONSTRAINT: lightweight-charts throws "Invalid margins - sum of top and
// bottom margins must be less than 1" on ANY band handed to a price scale, and
// StockChart's ErrorBoundary turns that throw into a blank page. `main` is the
// band that runs into it, because it always carries MAIN_TOP *on top of*
// whatever the stack claimed below — see MAX_STACK_C.

// Top margin 0.30 leaves the highest candle ~30% from the top of the chart
// so there's deliberate headroom above price action (matches TC2000-style layout).
const MAIN_TOP = 0.30

// Ceiling on the stacked bands, in whole hundredths so the trim below is exact
// integer arithmetic. `main` is emitted as {top: MAIN_TOP, bottom: stack}, so the
// stack can never be handed the whole 1 - MAIN_TOP — the sum has to land STRICTLY
// under 1. Every value here is quantised to hundredths, so one hundredth is all
// the daylight the constraint needs (main tops out at 0.30 + 0.69 = 0.99), and
// keeping it that tight means no layout that renders today shifts by a pixel.
//
// The old `0.72` cap read as "price keeps >=28%" but forgot that MAIN_TOP is
// charged separately: 0.30 + 0.72 = 1.02, which threw. And the cap was not even
// self-consistent — per-band 2-decimal rounding could push the stack past its own
// 0.72 target (0.74 observed at 5 oscillators + volume), so no single constant
// could have been the guarantee. The trim below is.
const MAX_STACK_C = 100 - Math.round(MAIN_TOP * 100) - 1 // 69 hundredths

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
  // Proportional squeeze: aim the stack at 72% of the pane. This sets the LOOK
  // (the relative band sizes); it is not the safety bound.
  const scale = totalBase > 0.72 ? 0.72 / totalBase : 1
  // Band heights as whole hundredths — the same 2-decimal numbers as before,
  // held as integers so the trim below cannot accumulate float error.
  const heightsC = active.map(p => Math.round(+((p.baseH * scale).toFixed(2)) * 100))

  // The safety bound. Shave one hundredth off the tallest band at a time until
  // the stack fits under the ceiling. Ties go to the lowest band, so the result
  // is deterministic. This runs ONLY for stacks that would otherwise have thrown,
  // so every layout that rendered before renders pixel-identically.
  // Terminates: stackC drops by exactly 1 each pass. Never degenerate: we only
  // enter while stackC > MAX_STACK_C, so the tallest band exceeds MAX_STACK_C/10
  // ≈ 6.9 hundredths and can never be shaved to zero height.
  let stackC = heightsC.reduce((s, h) => s + h, 0)
  while (stackC > MAX_STACK_C) {
    let tallest = 0
    for (let i = 1; i < heightsC.length; i++) {
      if (heightsC[i] > heightsC[tallest]) tallest = i
    }
    heightsC[tallest] -= 1
    stackC -= 1
  }

  let bottomC = 0
  const out = {}
  for (let i = 0; i < active.length; i++) {
    const nextC = bottomC + heightsC[i]
    out[active[i].key] = { top: (100 - nextC) / 100, bottom: bottomC / 100 }
    bottomC = nextC
  }
  out.main = { top: MAIN_TOP, bottom: bottomC / 100 }
  return out
}
