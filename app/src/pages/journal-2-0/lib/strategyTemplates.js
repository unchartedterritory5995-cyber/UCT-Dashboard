/**
 * Strategy templates — scaffolds the Add Option Strategy modal prefills
 * a list of leg slots with the right side/contract_type, leaving strike,
 * expiration, qty, and entry_price for the user to fill in.
 *
 * The 14+ templates below mirror VALID_STRATEGY_TYPES in options.py.
 * Keep in sync.
 *
 * Each template:
 *  - `type` (matches backend VALID_STRATEGY_TYPES)
 *  - `label` (display)
 *  - `direction` (default — user can override)
 *  - `legs` (template scaffolds — `strike`/`expiration`/`qty`/`entry_price`
 *    start as '' for the user to fill in)
 *  - `hints` (short coaching lines shown in the modal)
 */

const mk = (side, contractType, overrides = {}) => ({
  side,
  contractType,
  strike: '',
  expiration: '',
  qty: 1,
  entryPrice: '',
  ...overrides,
})

export const STRATEGY_TEMPLATES = {
  // ── Single-leg ─────────────────────────────────────────────────────────
  long_call: {
    type: 'long_call',
    label: 'Long Call',
    direction: 'bullish',
    category: 'Single-leg',
    hints: [
      'Max risk = debit paid.',
      'Break-even = strike + debit.',
      'Unlimited upside; loses to theta + IV crush.',
    ],
    legs: [mk('buy', 'call')],
  },
  long_put: {
    type: 'long_put',
    label: 'Long Put',
    direction: 'bearish',
    category: 'Single-leg',
    hints: [
      'Max risk = debit paid.',
      'Break-even = strike − debit.',
      'Hedge or outright bearish bet.',
    ],
    legs: [mk('buy', 'put')],
  },
  short_call: {
    type: 'short_call',
    label: 'Short Call (Naked)',
    direction: 'bearish',
    category: 'Single-leg',
    hints: [
      'UNDEFINED max risk — broker will require margin.',
      'Max reward = credit received.',
      'Only for margin-approved accounts with underlying conviction.',
    ],
    legs: [mk('sell', 'call')],
  },
  short_put: {
    type: 'short_put',
    label: 'Short Put (Naked / Cash-Secured)',
    direction: 'bullish',
    category: 'Single-leg',
    hints: [
      'Max risk = strike × 100 × qty − credit (if assigned).',
      'Cash-secured: set aside full strike × 100 × qty.',
      'Willing to own shares at the strike? Good setup.',
    ],
    legs: [mk('sell', 'put')],
  },

  // ── Two-leg verticals ──────────────────────────────────────────────────
  vertical_debit_call: {
    type: 'vertical_debit_call',
    label: 'Call Debit Spread (Bull Call)',
    direction: 'bullish',
    category: 'Vertical',
    hints: [
      'Buy lower strike, sell higher strike — net debit.',
      'Max risk = debit. Max reward = width − debit.',
      'Direction + defined risk; reduced theta vs long call.',
    ],
    legs: [mk('buy', 'call'), mk('sell', 'call')],
  },
  vertical_credit_call: {
    type: 'vertical_credit_call',
    label: 'Call Credit Spread (Bear Call)',
    direction: 'bearish',
    category: 'Vertical',
    hints: [
      'Sell lower strike, buy higher strike — net credit.',
      'Max risk = width − credit.',
      'Wins on stall or downside; theta-positive.',
    ],
    legs: [mk('sell', 'call'), mk('buy', 'call')],
  },
  vertical_debit_put: {
    type: 'vertical_debit_put',
    label: 'Put Debit Spread (Bear Put)',
    direction: 'bearish',
    category: 'Vertical',
    hints: [
      'Buy higher strike, sell lower strike — net debit.',
      'Max risk = debit. Max reward = width − debit.',
      'Defined-risk bearish bet.',
    ],
    legs: [mk('buy', 'put'), mk('sell', 'put')],
  },
  vertical_credit_put: {
    type: 'vertical_credit_put',
    label: 'Put Credit Spread (Bull Put)',
    direction: 'bullish',
    category: 'Vertical',
    hints: [
      'Sell higher strike, buy lower strike — net credit.',
      'Max risk = width − credit.',
      'High-probability bullish bet at support.',
    ],
    legs: [mk('sell', 'put'), mk('buy', 'put')],
  },

  // ── Two-leg volatility / time ──────────────────────────────────────────
  straddle: {
    type: 'straddle',
    label: 'Long Straddle',
    direction: 'neutral',
    category: 'Volatility',
    hints: [
      'Buy call + put at the same strike, same exp.',
      'Profits from large moves in either direction.',
      'Max risk = total debit. Needs big move to beat theta.',
    ],
    legs: [mk('buy', 'call'), mk('buy', 'put')],
  },
  strangle: {
    type: 'strangle',
    label: 'Long Strangle',
    direction: 'neutral',
    category: 'Volatility',
    hints: [
      'Buy OTM call + OTM put at same exp.',
      'Cheaper than straddle; needs bigger move.',
      'Max risk = total debit.',
    ],
    legs: [mk('buy', 'call'), mk('buy', 'put')],
  },
  calendar: {
    type: 'calendar',
    label: 'Calendar Spread',
    direction: 'neutral',
    category: 'Time',
    hints: [
      'Sell near-term, buy further-dated same strike.',
      'Profits from stability around strike + back-month IV rise.',
      'Max risk = debit paid (usually).',
    ],
    legs: [
      mk('sell', 'call'),   // near-month
      mk('buy', 'call'),    // back-month (same strike, later exp)
    ],
  },
  diagonal: {
    type: 'diagonal',
    label: 'Diagonal Spread',
    direction: 'bullish',
    category: 'Time',
    hints: [
      'Different strike AND different expiration.',
      'Poor-man\'s covered call: buy deep ITM long-dated + sell OTM short-dated.',
      'Max risk ≈ debit; back-month can be rolled.',
    ],
    legs: [
      mk('sell', 'call'),
      mk('buy', 'call'),
    ],
  },

  // ── Four-leg ───────────────────────────────────────────────────────────
  iron_condor: {
    type: 'iron_condor',
    label: 'Iron Condor',
    direction: 'neutral',
    category: 'Four-leg',
    hints: [
      'Sell OTM call spread + sell OTM put spread — net credit.',
      'Max risk = wider wing width − credit.',
      'Theta-positive range-bound play.',
    ],
    legs: [
      mk('sell', 'put'),    // short lower put
      mk('buy', 'put'),     // long further-OTM put
      mk('sell', 'call'),   // short upper call
      mk('buy', 'call'),    // long further-OTM call
    ],
  },
  iron_butterfly: {
    type: 'iron_butterfly',
    label: 'Iron Butterfly',
    direction: 'neutral',
    category: 'Four-leg',
    hints: [
      'Short ATM straddle + long OTM call + long OTM put.',
      'Higher reward than condor; narrower profit range.',
      'Max risk = wing width − credit.',
    ],
    legs: [
      mk('sell', 'put'),   // short ATM put
      mk('buy', 'put'),    // long lower put
      mk('sell', 'call'),  // short ATM call
      mk('buy', 'call'),   // long higher call
    ],
  },
  call_butterfly: {
    type: 'call_butterfly',
    label: 'Call Butterfly',
    direction: 'neutral',
    category: 'Four-leg',
    hints: [
      '1-2-1 call spread: buy, sell 2x at middle, buy higher.',
      'Low-cost pinning play at middle strike.',
      'Max risk = net debit.',
    ],
    legs: [
      mk('buy', 'call'),
      mk('sell', 'call', { qty: 2 }),
      mk('buy', 'call'),
    ],
  },
  put_butterfly: {
    type: 'put_butterfly',
    label: 'Put Butterfly',
    direction: 'neutral',
    category: 'Four-leg',
    hints: [
      '1-2-1 put spread: buy high, sell 2x middle, buy low.',
      'Low-cost pinning play.',
      'Max risk = net debit.',
    ],
    legs: [
      mk('buy', 'put'),
      mk('sell', 'put', { qty: 2 }),
      mk('buy', 'put'),
    ],
  },

  custom: {
    type: 'custom',
    label: 'Custom',
    direction: 'neutral',
    category: 'Other',
    hints: [
      'Build your own. No template structure enforced.',
      'Max risk cannot be auto-computed → R-multiple will be null.',
    ],
    legs: [mk('buy', 'call')],
  },
}

/** Array form, preserving category order for menu rendering. */
export const STRATEGY_TEMPLATE_LIST = [
  'long_call', 'long_put', 'short_call', 'short_put',
  'vertical_debit_call', 'vertical_credit_call',
  'vertical_debit_put', 'vertical_credit_put',
  'straddle', 'strangle',
  'calendar', 'diagonal',
  'iron_condor', 'iron_butterfly',
  'call_butterfly', 'put_butterfly',
  'custom',
].map(k => STRATEGY_TEMPLATES[k])

/** Grouped by category for the picker menu. */
export const STRATEGY_TEMPLATES_BY_CATEGORY = STRATEGY_TEMPLATE_LIST.reduce(
  (acc, tpl) => {
    if (!acc[tpl.category]) acc[tpl.category] = []
    acc[tpl.category].push(tpl)
    return acc
  },
  {},
)
