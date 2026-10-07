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
import { formatCompactTerminal, formatCurrency, formatNumber, formatPercent } from '../../lib/presentation/presentationPrimitives'

/** A plain number to `d` decimals, ungrouped; the shared em dash when missing. */
export const num = (v, d = 2) => formatNumber(v == null ? NaN : Number(v), { decimals: d, grouping: false })

/** A FRACTION (0.253) read as a percent ("25.3%"); the em dash when missing. */
export const fracPct = (v, d = 1) => formatPercent(v == null ? NaN : Number(v) * 100, { decimals: d })

/** A FRACTION read as volatility points, no "%" ("25.3"); the em dash when missing. */
export const volPts = (v, d = 1) => num(v == null ? null : Number(v) * 100, d)

// ── completeness audit 2026-10-07, column f: the hand-assembled cells, on the primitives ──
// Each is byte-identical to the `${num(v)}%` / `toLocaleString()` / `$${…}` it replaces for every
// value a row carries (oracle tests: optionsFormat.cells.test.js). Two edges are fixes, and pinned:
// a missing value is ONE em dash (never "—%" / "$—" / "NaN"), and a value that rounds to zero
// reads without a minus ("0.00%", never "-0.00%").

/** A value ALREADY in percent units (12.5 -> "12.50%"), `d` decimals. */
export const pctNum = (v, d = 2) => formatPercent(v == null ? NaN : Number(v), { decimals: d })

/** As `pctNum`, with a "+" on a value above zero (a flat 0 reads unsigned, as before). */
export const signedPct = (v, d = 2) => {
  const n = v == null ? NaN : Number(v)
  return formatPercent(n, { decimals: d, signed: n > 0 })
}

/** A whole count (contracts, shares, open interest) grouped: "12,500". */
export const count = (v) => formatNumber(v == null ? NaN : Number(v))

/** A dollar amount a member reads as a total, whole dollars, grouped: "$12,500". */
export const dollars = (v) => formatCurrency(v == null ? NaN : Number(v), { decimals: 0, grouping: true })

/** A flow premium on the terminal ladder, "+" above zero: "+$40K", "-$1.3M", "$0". */
export const signedPremium = (v) => {
  const n = v == null ? NaN : Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${formatCompactTerminal(n, { money: true })}`
}
