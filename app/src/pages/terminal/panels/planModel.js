// PLAN: the trade-plan arithmetic and words, pure (wave 8, lane G). No reads, no state.
//
// A plan is a buy point and a stop, with an optional target and an optional size. The side is
// DERIVED from the two prices (stop below the buy point is a long), never typed a second time, the
// same rule hub/plannedTradesClient.js states. Size comes from sizeMath.js, never a second copy.
//
// ⭐ The two writes a plan can make each reuse an EXISTING path:
//   alerts   the buy point and the stop through alertCommand.setAlert (POST /api/watchlist-alerts,
//            the one ALRT, the bell and the chart menus use)
//   journal  one Journal 2.0 notebook note (POST /api/j2/notes, the door SaveQuoteButton and the
//            chart menu's "Save to Notebook" use), tagged `trade-plan` like J2's own Trade Plan
//            template. No new table, no new route.
import { formatCurrency, formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { computeSize, parseNum } from './sizeMath'

export const NOTES_URL = '/api/j2/notes'
export const PLAN_TAGS = Object.freeze(['trade-plan'])

const money = (v) => formatCurrency(v, { decimals: 2, grouping: true, absent: 'n/a' })
const rText = (v) => `${formatNumber(v, { decimals: 1 })}R`

/**
 * `{ ok: true, side, buy, stop, target, perShare, rTarget, size }` or `{ ok: false, error }`.
 * `size` is null when no account was given, else sizeMath's own answer (ok or its error).
 */
export function readPlan({ buy, stop, target = '', account = '', riskPct = '' }) {
  const B = parseNum(buy)
  const S = parseNum(stop)
  const T = parseNum(target)
  if (B === null || B <= 0) return { ok: false, error: 'Enter a buy point above zero.' }
  if (S === null || S <= 0) return { ok: false, error: 'Enter a stop above zero.' }
  if (S === B) return { ok: false, error: 'The stop must differ from the buy point.' }
  const side = S < B ? 'long' : 'short'
  const perShare = Math.abs(B - S)
  let rTarget = null
  if (String(target ?? '').trim() !== '') {
    if (T === null || T <= 0) return { ok: false, error: 'Enter a target above zero, or leave it blank.' }
    const right = side === 'long' ? T > B : T < B
    if (!right) {
      return { ok: false, error: side === 'long'
        ? 'For a long, the target must be above the buy point.'
        : 'For a short, the target must be below the buy point.' }
    }
    rTarget = Math.abs(T - B) / perShare
  }
  const size = String(account ?? '').trim() === ''
    ? null
    : computeSize({ account, riskPct, entry: B, stop: S, side })
  return { ok: true, side, buy: B, stop: S, target: rTarget == null ? null : T, perShare, rTarget, size }
}

/** The two alerts a plan sets: the buy point, then the stop, each crossing the way the trade goes. */
export function alertLegs(plan) {
  const long = plan.side === 'long'
  return [
    { key: 'buy', label: 'buy point', price: plan.buy, direction: long ? 'above' : 'below' },
    { key: 'stop', label: 'stop', price: plan.stop, direction: long ? 'below' : 'above' },
  ]
}

const legText = (sym, leg) => `${sym} ${leg.direction} ${money(leg.price)} (${leg.label})`

/**
 * The one sentence after a Set alerts press. `results` is one `{ leg, ok, text? }` per leg, in
 * order; `text` is setAlert's own member sentence for a refusal.
 */
export function alertsResultText(sym, results) {
  const done = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  if (!failed.length) {
    return `Alerts set: ${done.map((r) => legText(sym, r.leg)).join(' and ')}. ALRT lists them.`
  }
  const why = failed.map((r) => `The ${r.leg.label} alert was not set: ${r.text}`).join(' ')
  if (!done.length) return `No alerts were set. ${why}`
  return `Alert set: ${done.map((r) => legText(sym, r.leg)).join(' and ')}. ${why}`
}

/** Plain words for a failed note save. Nothing was saved in every case. */
export function journalFailureText(err) {
  if (err?.status === 401) return 'Your session has ended. Sign in again, then log the plan.'
  if (err?.status === 402) return 'The journal needs a paid plan. Nothing was saved.'
  if (err?.timedOut) return 'The journal did not answer in time. Nothing was saved; try again.'
  return 'The plan could not be saved to your journal just now. Nothing was saved; try again.'
}

/** The plan's lines, the same words in the panel summary and in the note. */
export function planLines(plan) {
  const lines = [
    `Side: ${plan.side === 'long' ? 'Long' : 'Short'}`,
    `Buy point: ${money(plan.buy)}`,
    `Stop: ${money(plan.stop)} (risk ${money(plan.perShare)} a share)`,
  ]
  if (plan.target != null) lines.push(`Target: ${money(plan.target)} (${rText(plan.rTarget)})`)
  if (plan.size?.ok) {
    lines.push(`Size: ${formatNumber(plan.size.shares, { decimals: 0 })} shares, ${money(plan.size.dollarRisk)} at risk, ${money(plan.size.position)} position`)
  }
  return lines
}

const text = (t) => ({ type: 'text', text: t })
const para = (t) => ({ type: 'paragraph', content: [text(t)] })

/** The note POST /api/j2/notes takes: a TipTap doc of plain paragraphs and one bullet list. */
export function planNote(sym, plan) {
  return {
    title: `${sym} trade plan`,
    subtitle: `Buy ${money(plan.buy)}, stop ${money(plan.stop)}`,
    ticker: sym,
    tags: [...PLAN_TAGS],
    bodyJson: {
      type: 'doc',
      content: [
        para(`Trade plan for ${sym}, written in the UCT Terminal.`),
        { type: 'bulletList', content: planLines(plan).map((l) => ({ type: 'listItem', content: [para(l)] })) },
        para('Invalidation, management and the result go below.'),
      ],
    },
  }
}

/** The deep link J2's own doors use to open one note. */
export function noteHref(id) {
  return `/journal?j2tab=notebook&note=${encodeURIComponent(id)}`
}
