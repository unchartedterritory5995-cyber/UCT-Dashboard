// app/src/pages/optionsAnalytics/optionsFormat.js
//
// The options panels' number grammar (VOL / POS / OHIS / TIDE / STRS / chain
// tools), as thin calls into the ONE shared formatter in
// lib/presentation/presentationPrimitives. It replaces five identical local
// `num()` helpers that each called `.toFixed` by hand.
//
// ⛔ NO THOUSANDS SEPARATOR. Strikes, levels, greeks and break-evens sit in
// dense columns a reader compares digit by digit, and the panels have never
// grouped them ("1234.50", not "1,234.50"). `grouping: false` keeps that, and
// with a fixed decimal count it is `toFixed` exactly, so no cell moves.
import { formatNumber, formatPercent } from '../../lib/presentation/presentationPrimitives'

/** A plain number to `d` decimals, ungrouped; the shared em dash when missing. */
export const num = (v, d = 2) => formatNumber(v == null ? NaN : Number(v), { decimals: d, grouping: false })

/** A FRACTION (0.253) read as a percent ("25.3%"); the em dash when missing. */
export const fracPct = (v, d = 1) => formatPercent(v == null ? NaN : Number(v) * 100, { decimals: d })

/** A FRACTION read as volatility points, no "%" ("25.3"); the em dash when missing. */
export const volPts = (v, d = 1) => num(v == null ? null : Number(v) * 100, d)
