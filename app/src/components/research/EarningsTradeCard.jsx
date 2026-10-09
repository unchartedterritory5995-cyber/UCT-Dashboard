// The earnings-trade card (wave 3 lane 13, product item #8): ONE plain sentence comparing what the
// options price for the next report with how the stock has actually moved on its past reports.
//
//   "Options price a ±7.1% move; NVDA has moved ±5.4% on average over its last 8 reports
//    (more than today's implied move 3 of 8 times)."
//
// Every number is one the surface already holds -- the implied move (calendar enrichment's
// `expected_move.pct` / the expected-move research read's `live.pct` / the ERX panel's
// `implied_move.pct`, all `implied_move`/`get_implied_move` readings) and the stock's own past
// post-report moves (calendar enrichment `hist_stats.last_n` / ERX `quarters[].reaction_pct`). It
// computes nothing new and never invents a side of the comparison: with no implied move it says
// "no options read yet"; with no past reactions it says none are on file.
//
// Its own component so a panel mounts it with one line (the CAL/ERN modal, ERX, EE).
import useSWR from 'swr'
import { sectionFetcher } from './sections/sectionFetch'
import { formatPercent } from '../../lib/presentation/presentationPrimitives'
import styles from './EarningsTradeCard.module.css'

const finite = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
const pm = (v) => `±${formatPercent(Math.abs(v), { decimals: 1 })}`

/** Pure: the comparison, or null when there is nothing to say. `moves` are % moves, any order. */
export function earningsTradeRead({ sym, impliedPct, moves }) {
  const s = String(sym || '').toUpperCase().trim() || 'This stock'
  const implied = finite(impliedPct)
  const past = (Array.isArray(moves) ? moves : []).map(finite).filter((m) => m != null)
  const n = past.length
  const avg = n ? past.reduce((a, m) => a + Math.abs(m), 0) / n : null
  const reports = `${n === 1 ? 'its last report' : `its last ${n} reports`}`
  if (implied != null && implied > 0 && n) {
    const bigger = past.filter((m) => Math.abs(m) > implied).length
    const lean = avg > implied * 1.15 ? 'It has usually moved MORE than the options now price.'
      : avg < implied * 0.85 ? 'The options now price MORE than it has usually moved.'
        : 'The options price about what it has usually moved.'
    return {
      sentence: `Options price a ${pm(implied)} move; ${s} has moved ${pm(avg)} on average over ${reports} (more than today's implied move ${bigger} of ${n} ${n === 1 ? 'time' : 'times'}).`,
      lean,
      implied, avg, bigger, n,
    }
  }
  if (n) {
    return {
      sentence: `No options read yet for ${s}'s next report; it has moved ${pm(avg)} on average over ${reports}.`,
      lean: null, implied: null, avg, bigger: null, n,
    }
  }
  if (implied != null && implied > 0) {
    return {
      sentence: `Options price a ${pm(implied)} move for ${s}'s next report; no past earnings reactions are on file to compare it with.`,
      lean: null, implied, avg: null, bigger: null, n: 0,
    }
  }
  return null
}

export default function EarningsTradeCard({ sym, impliedPct = null, moves = null, testId = 'earnings-trade-card' }) {
  const read = earningsTradeRead({ sym, impliedPct, moves })
  if (!read) return null
  return (
    <section className={styles.card} aria-label="Earnings trade" data-testid={testId}>
      <span className={styles.label}>The earnings trade</span>
      <p className={styles.sentence}>{read.sentence}{read.lean ? ` ${read.lean}` : ''}</p>
      <p className={styles.basis}>
        Implied move: the at-the-money straddle for the expiry that holds the report. Past moves: the
        stock&apos;s close-to-close move on each reacting session. Not advice.
      </p>
    </section>
  )
}

/**
 * The card for a panel that holds neither number (EE): the implied move from the expected-move
 * research read (`?grade=0`, no Setup Grade fan-out) and the past reactions from the ERX read.
 * Either read failing or switched off simply leaves that side out of the sentence.
 */
export function EarningsTradeCardForSym({ sym }) {
  const s = String(sym || '').toUpperCase().trim()
  const opts = { refreshInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 60_000 }
  const { data: em } = useSWR(s ? `/api/research/expected-move/${encodeURIComponent(s)}?grade=0` : null, sectionFetcher, opts)
  const { data: rx } = useSWR(s ? `/api/research/earnings-reaction/${encodeURIComponent(s)}` : null, sectionFetcher, opts)
  const impliedPct = em && !em.paywalled ? em.live?.pct ?? null : null
  const moves = rx && !rx.paywalled && rx.state === 'ok' ? (rx.quarters || []).map((q) => q.reaction_pct) : null
  return <EarningsTradeCard sym={s} impliedPct={impliedPct} moves={moves} />
}
