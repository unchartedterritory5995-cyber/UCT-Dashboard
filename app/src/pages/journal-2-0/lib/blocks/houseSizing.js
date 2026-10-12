// The house sizing formula, and nothing else (spec §P2 item 5):
//   Account Risk % = Position Size % × Stop Distance %
// capped at MAX_ACCOUNT_RISK_PCT, with the regime ceilings of the house table. ⛔ The table is
// app/src/constants/houseSizing.json, the ONE in-repo copy (IR-S10), railed against uct-intelligence's
// _SIZING_TABLE by tests/test_house_sizing_table.py. A ceiling of 0 is a skip. Every export below is
// READ from that file; nothing here restates a number from it.
//
// ⛔ ROUNDING IS EXPLICIT (integrator ruling), and tested at the edges in houseSizing.test.js:
//   · the size is computed from the REAL stop distance; only what is SHOWN is rounded. A stop distance
//     that rounds to 0.00% still sizes from its real value, so nothing is ever divided by a rounded 0;
//   · a stop distance of exactly 0 (entry === stop) is refused with a sentence before any division;
//   · shares are whole and rounded DOWN, so neither the regime ceiling nor the 2% cap is exceeded.
//     The quotient is snapped to 6 decimal places before the floor, so float noise (1.10 - 1.00 is
//     0.10000000000000009) never costs a share that the arithmetic says fits exactly;
//   · percents and dollars are RETURNED to 2 places, rounded half UP in decimal (roundPct). How they
//     are SHOWN is the block's choice: PositionSizingBlock shows whole dollars at $10 and above, cents
//     below, and a nonzero percent that rounds to 0.00 as "under 0.01%" (never "$0 at risk (0%)").
import TABLE from '../../../../constants/houseSizing.json'

const freezeRows = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze({ ...v })])))

export const MAX_ACCOUNT_RISK_PCT = TABLE.maxAccountRiskPct
/** The house rule's "prefer under 1%": advice shown beside a size, never a limit applied to it. */
export const PREFERRED_ACCOUNT_RISK_PCT = TABLE.preferredAccountRiskPct
export const PLACEHOLDER_ACCOUNT_SIZE = TABLE.placeholderAccountSize
export const SIZE_CEILING_PCT = freezeRows(TABLE.ceilingPct)
export const REGIME_OF = Object.freeze({ ...TABLE.regimeWords })

/** Two decimal places, half UP, in decimal (1.005 -> 1.01): `Math.round(x * 100) / 100` gives 1.00. */
export function roundPct(x) {
  const n = Number(x)
  if (!Number.isFinite(n)) return n
  const m = Math.abs(n)
  const s = String(m)
  const r = s.includes('e') ? Math.round(m * 100) / 100 : Number(`${Math.round(Number(`${s}e2`))}e-2`)
  return n < 0 ? -r : r
}

/** Whole shares, rounded down, after snapping float noise off the quotient. */
const wholeShares = (q) => Math.max(0, Math.floor(Math.round(q * 1e6) / 1e6))

/** "a" or "an" before a grade or a regime word read aloud (an A+ setup, an ORANGE market). */
export const articleFor = (word) => (/^[AEIOU]/i.test(String(word || '')) ? 'an' : 'a')

const fail = (code, reason, extra = {}) => ({ ok: false, skip: false, code, reason, ...extra })
const positive = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null }

/** The settings value is the server's default, written into every new account: it is not the member's. */
export function isPlaceholderAccount(settings) {
  return Number(settings?.accountSize) === PLACEHOLDER_ACCOUNT_SIZE
}

/** IR-S9: the account size to size against, or null when the member has not set one. The server writes
 *  the placeholder into every new account, so the placeholder means "not set" unless typed in this note. */
export function accountSizeFor({ params, settings }) {
  const own = positive(params?.accountSize)
  if (own != null) return own
  const s = positive(settings?.accountSize)
  return s != null && s !== PLACEHOLDER_ACCOUNT_SIZE ? s : null
}

/**
 * The house size for one trade. `regime` is a house word (GREEN / YELLOW / ORANGE / RED; map a regime
 * id through REGIME_OF first). Returns
 *   { ok: true, skip: false, reason: null, stopPct, sizePct, riskPct, plannedRiskPct, shares,
 *     riskDollars, positionDollars, positionPct, boundBy: 'regime' | 'risk' }
 * or { ok: false, skip, code, reason } with a sentence and no number it could not derive.
 *   sizePct        = min(the regime ceiling for the grade, MAX_ACCOUNT_RISK_PCT / Stop Distance % × 100)
 *   plannedRiskPct = sizePct × stopPct / 100 (the house formula's Account Risk %, before whole shares)
 *   shares         = floor(account × sizePct / 100 / entry), which is floor(risk cap $ / per-share risk)
 *                    when the 2% cap binds (the same number, computed with fewer float steps)
 *   riskPct        = the risk of those whole shares, as a percent of the account (<= plannedRiskPct)
 *   positionPct    = what those whole shares hold, as a percent of the account (<= sizePct)
 * A short (stop above entry) sizes the same way.
 */
export function houseSize({ entry, stop, accountSize, grade, regime }) {
  const row = Object.hasOwn(SIZE_CEILING_PCT, regime || '') ? SIZE_CEILING_PCT[regime] : null
  if (!row) return fail('regime', 'The market regime is not known yet.')
  if (!Object.hasOwn(row, grade || '')) return fail('grade', 'Pick a setup grade.')
  const ceiling = row[grade]
  if (!(ceiling > 0)) {
    return fail('skip', `The house rules skip ${articleFor(grade)} ${grade} setup in ${articleFor(regime)} ${regime} market.`, { skip: true })
  }
  const e = positive(entry)
  const s = positive(stop)
  if (e == null || s == null) return fail('prices', 'Enter an entry and a stop above zero.')
  if (e === s) return fail('same', 'Entry and stop are the same price.')
  const a = positive(accountSize)
  if (a == null) return fail('account', 'Set your account size in Settings.')

  const perShareRisk = Math.abs(e - s)                    // > 0: entry === stop was refused above
  const stopPctExact = (perShareRisk / e) * 100
  const riskCapPct = (MAX_ACCOUNT_RISK_PCT * e) / perShareRisk   // = MAX / stopPct × 100
  const boundBy = ceiling <= riskCapPct ? 'regime' : 'risk'
  const sizeExact = boundBy === 'regime' ? ceiling : riskCapPct
  const shares = boundBy === 'regime'
    ? wholeShares((a * ceiling) / (100 * e))
    : wholeShares((a * MAX_ACCOUNT_RISK_PCT) / (100 * perShareRisk))
  if (shares < 1) return fail('tooSmall', 'At this size the account buys less than one share.', { shares: 0 })
  return {
    ok: true, skip: false, reason: null,
    stopPct: roundPct(stopPctExact),
    sizePct: roundPct(sizeExact),
    plannedRiskPct: roundPct((sizeExact * stopPctExact) / 100),
    riskPct: roundPct(((shares * perShareRisk) / a) * 100),
    shares,
    riskDollars: roundPct(shares * perShareRisk),
    positionDollars: roundPct(shares * e),
    positionPct: roundPct(((shares * e) / a) * 100),
    boundBy,
  }
}
