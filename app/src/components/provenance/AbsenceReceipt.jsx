// app/src/components/provenance/AbsenceReceipt.jsx
//
// ─── "WHY ISN'T X HERE" AS AN S8 RECEIPT (TERM-057 / FB-A8-03) ───────────────
//
// The negative answer, why a name is absent from a curated surface, is ONE
// shared receipt every curated surface renders, not one tile's affordance. It
// reads `GET /api/catalysts/explain/{sym}` and states the cause in plain words
// off the route's `verdict` field, never off its `reason` prose.
//
// ⛔ "NOT EVALUATED" IS NEVER RENDERED AS "EXCLUDED". A name no source surfaced
// was never looked at by a gate; saying it was excluded claims a judgement that
// did not happen. The two kinds carry different words AND a different
// `data-kind`, and `AbsenceReceipt.test.jsx` asserts the rendered text of each.
//
// ⛔ A QUOTA EXCLUSION SAYS WHICH BUCKET. FB-A8-03's "known it worked" clause:
// a name excluded by the quota rather than by the score says which.
//
// ⛔ A FAILED CHECK IS NOT AN ANSWER. An HTTP error or a network failure says
// so, in those words, and says nothing about the list.
//
// ⛔ THE FEEDBACK HOST OUTLIVES THE CONTROL THAT TRIGGERS IT. The live region
// is mounted for the component's whole life, outside the collapsible panel and
// outside the button, so a result is never torn down by the click that asked
// for it.
//
// Mounted on: `components/tiles/CatalystTable.jsx` (free-text lookup, the
// Dashboard + Morning Wire tile) and `pages/research/tabs/CatalystsTab.jsx`
// (the ticker's own research page, fixed ticker).

import { useRef, useState } from 'react'
import UIcon from '../ui/UIcon'
import { CATALYST_TAG_DISPLAY_ORDER } from '../../lib/taxonomy/a8Taxonomy'
import { formatNumber, formatNumberMax } from '../../lib/presentation/presentationPrimitives'
import styles from './AbsenceReceipt.module.css'

export const DEFAULT_LIST_LABEL = "today's catalyst list"

const GATE_WORDS = Object.freeze({
  quality: {
    name: 'tradeability gate',
    what: 'It checks price, liquidity, market cap and float before anything is scored.',
  },
  real_catalyst: {
    name: 'activity gate',
    what: 'It asks whether anything is actually happening: a real move, a volume surge, or a hard catalyst.',
  },
})

const SIGNAL_LABELS = Object.freeze({
  gap_pct: 'Gap %',
  vol_x: 'Volume vs average',
  price: 'Price',
  market_cap: 'Market cap',
  avg_volume_30d: '30-day average volume',
  sector: 'Sector',
  tweet_mention_count: 'Social mentions',
  rss_headline_count: 'News headlines',
  earnings_reported_recently: 'Reported earnings recently',
  scanner_setup: 'Scanner setup',
})

// S8 provenance rail (presentationSingleFormatter.test.js): a `/.../` literal is
// a shape the family's comment-stripper cannot model, so this is `new RegExp`
// instead -- same pattern, no flags, `.test()` behaves identically.
// Dual-class suffix (BRK.B / BRK-B / BF.B): a single dot or hyphen followed by
// 1-2 letters, mirroring the class-share spelling used elsewhere in this app
// (lib/tickerResolver.js's cashtag suffix, massive.to_polygon_symbol's dot form).
// No spaces, no repeated separators, max length kept tight so garbage still fails.
const TICKER_RE = new RegExp('^[A-Z]{1,6}(?:[.-][A-Z]{1,2})?$')

function ordinalRank(r, n) {
  return Number.isFinite(r) && Number.isFinite(n) ? `${formatNumber(r)} of ${formatNumber(n)}` : null
}

function fmtSignal(v) {
  if (v === true) return 'yes'
  if (v === false) return 'no'
  if (typeof v === 'number') {
    // S8 provenance rail: no locale formatter call in code -- route through S10.
    // absent: null (not the em-dash default) so a non-finite signal is DROPPED
    // by the caller's `!= null` filter, same as the retired direct call.
    return formatNumberMax(v, { maxDecimals: 2, absent: null })
  }
  return typeof v === 'string' && v.trim() ? v : null
}

/**
 * The receipt's words for one explain-route body. Pure, so the sentence a
 * member reads is testable without a network. Returns
 * { kind, headline, detail, facts: [string] }.
 */
export function describeAbsence(body, { listLabel = DEFAULT_LIST_LABEL } = {}) {
  const sym = (body && body.ticker) || 'This ticker'
  const verdict = body && body.verdict
  const facts = []
  const rankText = ordinalRank(body?.rank_among_scored, body?.total_scored)
  if (Number.isFinite(body?.score)) facts.push(`Score on this check: ${body.score.toFixed(2)}`)
  if (rankText) facts.push(`Rank among scored names: ${rankText}`)

  switch (verdict) {
    case 'on_list':
      return {
        kind: 'on_list',
        headline: Number.isFinite(body.list_rank)
          ? `${sym} is on ${listLabel}, at #${body.list_rank}.`
          : `${sym} is on ${listLabel}.`,
        detail: 'Nothing is keeping it off. It is on the list the engine last published.',
        facts,
      }
    case 'not_evaluated':
      return {
        kind: 'not_evaluated',
        headline: `${sym} was not evaluated today.`,
        detail: body.pool_size === 0
          ? 'No catalyst source returned anything on this check, so the engine had nothing to evaluate. This says nothing about the ticker itself.'
          : "None of the engine's sources (movers, earnings, news, social, scanner, analyst actions, options flow) surfaced it, so no gate or score ever ran on it. It was not filtered out; it was never looked at.",
        facts: [],
      }
    case 'excluded_by_gate': {
      const g = GATE_WORDS[body.gate]
      const gateName = g ? `the ${g.name}` : 'a pre-scoring gate'
      const why = typeof body.gate_reason === 'string' && body.gate_reason.trim()
        ? ` The gate's reason: ${body.gate_reason.trim()}.`
        : ''
      return {
        kind: 'excluded_by_gate',
        headline: `${sym} was excluded by ${gateName}.`,
        detail: `${g ? g.what : 'It was dropped before scoring.'}${why}`,
        facts: [],
      }
    }
    case 'no_qualifying_signal':
      return {
        kind: 'no_qualifying_signal',
        headline: `${sym} had no qualifying signal today.`,
        detail: `A source mentioned it and it cleared both gates, but none of the catalyst tags (${CATALYST_TAG_DISPLAY_ORDER.join(', ')}) applied, so it was never ranked.`,
        facts,
      }
    case 'quota_full': {
      const q = body.quota || {}
      const tag = typeof q.tag === 'string' && q.tag ? q.tag : null
      const slots = Number.isFinite(q.slots) ? q.slots : null
      const place = ordinalRank(q.rank_in_tag, q.in_tag)
      return {
        kind: 'quota_full',
        headline: tag
          ? `${sym} missed ${listLabel} because the ${tag} bucket was full.`
          : `${sym} missed ${listLabel} because its quota bucket was full.`,
        detail: [
          slots != null && tag ? `The list takes ${formatNumber(slots)} ${tag} ${slots === 1 ? 'name' : 'names'}.` : null,
          place && tag ? `${sym} ranked ${place} ${tag} names by score.` : null,
        ].filter(Boolean).join(' '),
        facts,
      }
    }
    case 'cut_by_curator':
      return {
        kind: 'cut_by_curator',
        headline: `${sym} was cut by the curator.`,
        detail: `It cleared the gates${body.tag ? ` and was tagged ${body.tag}` : ''}, but the news-desk curator that picks ${listLabel} cut it by name.`,
        facts,
      }
    case 'not_selected':
      return {
        kind: 'not_selected',
        headline: `${sym} scored but was not picked for ${listLabel}.`,
        detail: `It cleared the gates${body.tag ? ` and was tagged ${body.tag}` : ''}. No single gate or quota removed it; the picked names took the places.`,
        facts,
      }
    case 'qualifies_now':
      return {
        kind: 'qualifies_now',
        headline: `${sym} qualifies on this check but is not on the list yet.`,
        detail: `The list comes from the engine's last refresh. This check pulls the sources again now, and on this pull ${sym} would be picked${body.tag ? ` as ${body.tag}` : ''}. The next refresh may add it.`,
        facts,
      }
    default:
      return {
        kind: 'unclassified',
        headline: `The engine did not classify why ${sym} is absent.`,
        detail: typeof body?.reason === 'string' && body.reason.trim()
          ? `In the engine's own words: ${body.reason.trim()}`
          : 'No reason was returned.',
        facts,
      }
  }
}

/** The words for a check that FAILED. Never an answer about the list. */
export function describeFailure(sym, status) {
  return {
    kind: 'failed',
    headline: `Could not check ${sym} right now${status ? ` (HTTP ${status})` : ' (network error)'}.`,
    detail: 'This is a failed check, not an answer about the list. Try again in a moment.',
    facts: [],
  }
}

function SignalList({ summary }) {
  const rows = Object.entries(summary || {})
    .map(([k, v]) => [SIGNAL_LABELS[k] || k, fmtSignal(v)])
    .filter(([, v]) => v != null)
  if (!rows.length) return null
  return (
    <details className={styles.details} data-testid="absence-receipt-signals">
      <summary className={styles.summary}>Signals on this check</summary>
      <dl className={styles.signals}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.signalRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function Receipt({ result, listLabel }) {
  const d = result.words
  return (
    <div className={styles.receipt} data-testid="absence-receipt" data-kind={d.kind}>
      <p className={styles.headline}>
        <UIcon name={d.kind === 'failed' ? 'warning' : d.kind === 'on_list' ? 'check' : 'info'} size={14} />
        <span data-testid="absence-receipt-headline">{d.headline}</span>
      </p>
      {d.detail ? <p className={styles.detail} data-testid="absence-receipt-detail">{d.detail}</p> : null}
      {d.facts.length > 0 && (
        <p className={styles.facts}>{d.facts.join(' · ')}</p>
      )}
      {result.body ? <SignalList summary={result.body.signal_summary} /> : null}
      {result.body && d.kind !== 'failed' ? (
        <p className={styles.source}>
          Source: UCT Catalyst Engine, checked against {listLabel}
          {result.body.market_date ? ` (${result.body.market_date})` : ''}.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Props:
 *  - ticker: fixed symbol (a ticker's own page). Absent → a free-text input.
 *  - collapsible: render behind a disclosure toggle (the tile, where space is short).
 *  - listLabel: the curated list the question is about.
 */
export default function AbsenceReceipt({ ticker = null, collapsible = false, listLabel = DEFAULT_LIST_LABEL }) {
  const fixed = typeof ticker === 'string' && ticker.trim() ? ticker.trim().toUpperCase() : null
  const [open, setOpen] = useState(!collapsible)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const seq = useRef(0)
  const panelId = useRef(`absence-receipt-${Math.random().toString(36).slice(2, 9)}`).current

  async function check() {
    const sym = fixed || input.trim().toUpperCase()
    if (!TICKER_RE.test(sym)) {
      seq.current += 1                          // supersede any check in flight
      setLoading(false)
      setResult({ words: { kind: 'invalid', headline: 'Enter a ticker, e.g. NVDA or BRK.B.', detail: '', facts: [] } })
      return
    }
    const mine = ++seq.current
    setLoading(true)
    let next
    try {
      const r = await fetch(`/api/catalysts/explain/${encodeURIComponent(sym)}`)
      if (!r.ok) {
        next = { words: describeFailure(sym, r.status) }
      } else {
        const body = await r.json()
        next = { body, words: describeAbsence(body, { listLabel }) }
      }
    } catch {
      next = { words: describeFailure(sym, null) }
    }
    if (mine !== seq.current) return            // a newer check superseded this one
    setResult(next)
    setLoading(false)
  }

  const showPanel = !collapsible || open
  const askLabel = fixed ? `Why isn't ${fixed} on ${listLabel}?` : 'Why isn\'t X on the list?'

  return (
    <div className={styles.wrap} data-testid="absence-receipt-root">
      {collapsible && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(o => !o)}
        >
          <UIcon name="search" size={13} />
          {open ? 'Close lookup' : askLabel}
        </button>
      )}
      {showPanel && (
        <div className={styles.panel} id={panelId}>
          <div className={styles.inputRow}>
            {!fixed && (
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') check() }}
                placeholder="Ticker (e.g. NVDA)"
                aria-label="Ticker to check"
                className={styles.input}
                maxLength={9}
              />
            )}
            <button type="button" className={styles.check} disabled={loading} onClick={check}>
              {loading ? 'Checking' : fixed ? (result ? 'Check again' : askLabel) : 'Check'}
            </button>
          </div>
        </div>
      )}
      {/* The host: mounted for the component's whole life, outside the panel and
          outside the button, so the answer is never torn down by its own trigger. */}
      <div className={styles.host} role="status" aria-live="polite" data-testid="absence-receipt-host">
        {showPanel && loading && !result ? <p className={styles.pending}>Checking the engine…</p> : null}
        {showPanel && result ? <Receipt result={result} listLabel={listLabel} /> : null}
      </div>
    </div>
  )
}
