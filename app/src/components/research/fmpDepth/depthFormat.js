// app/src/components/research/fmpDepth/depthFormat.js
//
// The FA/EE depth views' row specs and value grammars — pure, so the tests can
// drive them without a render. Every number reaches the screen through
// lib/presentation/presentationPrimitives; nothing here formats by hand.
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
} from '../../../lib/presentation/presentationPrimitives'

/** Statement magnitudes span nine orders: $3.12T / $94.93B / $48.8M / $512.0K.
 *  The ladder is a parameter of formatCompact, so this one is declared, not
 *  hand-rolled. */
export const MONEY_TIERS = Object.freeze([
  Object.freeze({ at: 1e12, suffix: 'T', decimals: 2 }),
  Object.freeze({ at: 1e9, suffix: 'B', decimals: 2 }),
  Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 }),
  Object.freeze({ at: 1e3, suffix: 'K', decimals: 1 }),
])

export const fmtMoney = (v) => formatCompact(v, { tiers: MONEY_TIERS, prefix: '$' })
export const fmtEps = (v) => formatCurrency(v)
export const fmtShares = (v) => formatCompact(v)
export const fmtPct = (v) => formatPercent(v, { decimals: 1 })
export const fmtGrowth = (v) => formatPercent(v, { decimals: 1, signed: true })
export const fmtTimes = (v) => {
  const s = formatNumber(v, { decimals: 2 })
  return Number.isFinite(v) ? `${s}×` : s
}
export const fmtCount = (v) => formatNumber(v)

/** The four statement views. `from` names the payload block a row reads:
 *  `series` (line items) or `ratios` (derived server-side from those items). */
export const STATEMENTS = [
  {
    key: 'income', label: 'Income', from: 'series', rows: [
      ['revenue', 'Revenue', fmtMoney, 'total'],
      ['cost_of_revenue', 'Cost of revenue', fmtMoney],
      ['gross_profit', 'Gross profit', fmtMoney, 'total'],
      ['research_and_development', 'R&D', fmtMoney],
      ['sga', 'SG&A', fmtMoney],
      ['operating_expenses', 'Operating expenses', fmtMoney],
      ['operating_income', 'Operating income', fmtMoney, 'total'],
      ['ebitda', 'EBITDA', fmtMoney],
      ['interest_expense', 'Interest expense', fmtMoney],
      ['pretax_income', 'Pretax income', fmtMoney],
      ['income_tax', 'Income tax', fmtMoney],
      ['net_income', 'Net income', fmtMoney, 'total'],
      ['eps', 'EPS', fmtEps],
      ['eps_diluted', 'EPS (diluted)', fmtEps],
      ['shares_diluted', 'Diluted shares', fmtShares],
    ],
  },
  {
    key: 'balance', label: 'Balance sheet', from: 'series', rows: [
      ['cash_and_equivalents', 'Cash & equivalents', fmtMoney],
      ['short_term_investments', 'Short-term investments', fmtMoney],
      ['receivables', 'Receivables', fmtMoney],
      ['inventory', 'Inventory', fmtMoney],
      ['total_current_assets', 'Total current assets', fmtMoney, 'total'],
      ['ppe_net', 'PP&E (net)', fmtMoney],
      ['goodwill', 'Goodwill', fmtMoney],
      ['total_assets', 'Total assets', fmtMoney, 'total'],
      ['accounts_payable', 'Accounts payable', fmtMoney],
      ['total_current_liabilities', 'Total current liabilities', fmtMoney, 'total'],
      ['long_term_debt', 'Long-term debt', fmtMoney],
      ['total_debt', 'Total debt', fmtMoney],
      ['net_debt', 'Net debt', fmtMoney],
      ['total_liabilities', 'Total liabilities', fmtMoney, 'total'],
      ['total_equity', "Shareholders' equity", fmtMoney, 'total'],
    ],
  },
  {
    key: 'cash', label: 'Cash flow', from: 'series', rows: [
      ['operating_cash_flow', 'Operating cash flow', fmtMoney, 'total'],
      ['capital_expenditure', 'Capital expenditure', fmtMoney],
      ['free_cash_flow', 'Free cash flow', fmtMoney, 'total'],
      ['depreciation_amortization', 'D&A', fmtMoney],
      ['stock_based_compensation', 'Stock-based comp', fmtMoney],
      ['acquisitions', 'Acquisitions', fmtMoney],
      ['dividends_paid', 'Dividends paid', fmtMoney],
      ['buybacks', 'Buybacks', fmtMoney],
    ],
  },
  {
    key: 'ratios', label: 'Ratios', from: 'ratios', rows: [
      ['revenue_growth', 'Revenue growth (y/y)', fmtGrowth],
      ['eps_growth', 'EPS growth (y/y)', fmtGrowth],
      ['gross_margin', 'Gross margin', fmtPct],
      ['operating_margin', 'Operating margin', fmtPct],
      ['ebitda_margin', 'EBITDA margin', fmtPct],
      ['net_margin', 'Net margin', fmtPct],
      ['fcf_margin', 'FCF margin', fmtPct],
      ['roe', 'Return on equity', fmtPct, null, 'ttm'],
      ['roa', 'Return on assets', fmtPct, null, 'ttm'],
      ['debt_to_equity', 'Debt / equity', fmtTimes],
      ['current_ratio', 'Current ratio', fmtTimes],
    ],
  },
]

/** A row's label for the period on screen: ROE/ROA on quarterly data are TTM
 *  (the server divides trailing-four-quarter income by the period-end balance),
 *  and the label says so rather than leaving a reader to wonder. */
export function rowLabel(label, basis, period) {
  return basis === 'ttm' && period !== 'annual' ? `${label} (TTM)` : label
}

/**
 * The table body for one statement: columns NEWEST FIRST (the payload is oldest
 * first, which suits a chart; a table is read from the latest period back).
 * A row whose every value is missing is dropped — FMP sends no `inventory` for
 * a bank — rather than shown as a line of dashes that reads like a broken feed.
 */
export function buildTable(payload, statementKey) {
  const spec = STATEMENTS.find((s) => s.key === statementKey) || STATEMENTS[0]
  const periods = payload?.periods || []
  const block = payload?.[spec.from] || {}
  const order = periods.map((_, i) => i).reverse()
  const rows = []
  for (const [key, label, fmt, kind = null, basis = null] of spec.rows) {
    const values = block[key] || []
    if (!values.some((v) => Number.isFinite(v))) continue
    rows.push({ key, label, kind, basis, cells: order.map((i) => fmt(values[i])) })
  }
  return { columns: order.map((i) => periods[i]), rows }
}
