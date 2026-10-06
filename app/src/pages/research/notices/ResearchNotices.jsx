import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { useState } from 'react'
import { depthFetcher } from '../depth/depthFetch'
import styles from './Notices.module.css'
import { formatCompact, formatNumber } from '../../../lib/presentation/presentationPrimitives'

// Research notices under the header (lane R). A container only: each notice is its
// own surface behind its own server flag (researchNoticeFlags.js); a notice whose
// flag is off is not rendered and never requests anything.
//
//   D-9   MemberInterestLine   reads the existing GET /api/member/interest
//   D-11  RenameNotice         GET /api/research/rename-notice/{sym}
//   D-12  MetricDisagreement   GET /api/research/metric-disagreement/{sym}

const SWR_OPTS = { revalidateOnFocus: false }

// ── D-9: the member's own signal reaches a surface that did not compute it ──

// The resolver's source vocabulary (api/services/member_interest.SOURCES), in words.
// A source this list does not know is shown by its own name, never dropped.
const BECAUSE = {
  positions: 'in your open Journal positions',
  flagged: 'flagged by you',
  watchlist: 'on your watchlists',
  uct20: 'on the UCT 20',
}

export function interestReasons(entities, sym) {
  const e = entities?.[sym]
  if (!e || !Array.isArray(e.because) || e.because.length === 0) return []
  return e.because.map((b) => BECAUSE[b] || b)
}

function MemberInterestLine({ sym }) {
  // One shared key per member: every surface asking shares the server's 15s cache.
  const { data } = useSWR('/api/member/interest', depthFetcher, SWR_OPTS)
  // ⛔ PRESENCE ONLY. The resolver folds a failing source into "nothing", so the
  // absence of a reason is never rendered as "not on your watchlist".
  if (!data || data.paywalled) return null
  const reasons = interestReasons(data.entities, sym)
  if (reasons.length === 0) return null
  return (
    <div className={styles.line} data-testid="member-interest-line"
      title="From your watchlists, your flags, your open Journal 2.0 positions and the UCT 20: the same signal the Calendar's My Stocks uses. Nothing here re-orders this page.">
      <span className={styles.chip}>Already on your radar</span>
      {sym} is {reasons.join(' · ')}.
    </div>
  )
}

// ── D-11: "formerly / now trades as" ────────────────────────────────────────

function heldSpan(from, to) {
  return to ? `${from} to ${to}` : `since ${from}`
}

function RenameNotice({ sym }) {
  const { data } = useSWR(`/api/research/rename-notice/${encodeURIComponent(sym)}`, depthFetcher, SWR_OPTS)
  // `not_in_store`, `store_unavailable`, a paywall and a failed read are all "nothing
  // to say here" for a notice; only an `ok` answer with something in it renders.
  if (!data || data.state !== 'ok') return null
  const lines = []
  const cur = data.current
  if (cur?.ambiguous) {
    lines.push(
      <div key="amb" className={styles.line} data-testid="rename-ambiguous">
        <span className={styles.chip}>Ticker check</span>
        Our records show more than one company holding {sym} right now, so we cannot say which one this page is about.
      </div>,
    )
  } else if (cur?.formerly?.length) {
    lines.push(
      <div key="formerly" className={styles.line} data-testid="rename-formerly">
        <span className={styles.chip}>Formerly</span>
        {sym} formerly traded as{' '}
        {cur.formerly.map((a, i) => (
          <span key={`${a.alias}-${a.valid_from}`}>{i > 0 ? ', ' : ''}<strong>{a.alias}</strong> ({heldSpan(a.valid_from, a.valid_to)})</span>
        ))}.
      </div>,
    )
  }
  for (const p of data.previous_holders || []) {
    const now = p.now_trades_as || []
    lines.push(
      <div key={`${p.entity_id}-${p.held_from}`} className={styles.line} data-testid="rename-previous">
        <span className={styles.chip}>{now.length ? 'Now trades as' : 'Ticker reused'}</span>
        From {heldSpan(p.held_from, p.held_to)}, {sym} belonged to a company that{' '}
        {now.length
          ? <>now trades as {now.map((a, i) => (
              <span key={a.alias}>{i > 0 ? ', ' : ''}<Link className={styles.link} to={`/research/${encodeURIComponent(a.alias)}`}>{a.alias}</Link></span>
            ))}</>
          : <>no longer trades under any ticker we hold{p.lifecycle_state === 'delisted' && p.lifecycle_since ? ` (delisted ${p.lifecycle_since})` : ''}</>}
        {cur && !cur.ambiguous ? `. Today ${sym} is a different company` : ''}.
      </div>,
    )
  }
  if (lines.length === 0) return null
  return (
    <div data-testid="rename-notice">
      {lines}
      <div className={styles.muted}>Source: {data.source}.</div>
    </div>
  )
}

// ── D-12: two of our computations of one metric disagree ───────────────────

function fmtVal(key, v) {
  if (v === null || v === undefined) return '—'
  if (key === 'market_cap') {
    return formatCompact(Number(v), {
      prefix: '$',
      tiers: [{ at: 1e12, suffix: 'T', decimals: 2 }, { at: 1e9, suffix: 'B', decimals: 2 }, { at: 1e6, suffix: 'M', decimals: 0 }],
    })
  }
  return formatNumber(Number(v), { decimals: 2 })
}

const VERDICT = { agree: 'agree', disagree: 'DISAGREE', cannot_compare: 'cannot compare' }

function MetricDisagreement({ sym }) {
  const [open, setOpen] = useState(false)
  const { data, error } = useSWR(`/api/research/metric-disagreement/${encodeURIComponent(sym)}`, depthFetcher, SWR_OPTS)
  if (error) {
    // A check that could not run is said, never shown as "no disagreement".
    return <div className={styles.muted} data-testid="disagreement-unavailable">Could not check our two sources for {sym} right now.</div>
  }
  if (!data || data.paywalled) return null
  const n = data.counts?.disagree || 0
  if (n === 0) return null
  const total = (data.pairs || []).length
  return (
    <div data-testid="metric-disagreement">
      <div className={`${styles.line} ${styles.warn}`}>
        <span className={styles.chip}>Two numbers</span>
        Our two sources disagree on {n} of {total} figures for {sym}. Neither is preferred; both are shown.
        <button type="button" className={styles.toggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead><tr><th scope="col">Figure</th><th scope="col">Research</th><th scope="col">Screener</th><th scope="col">Gap</th><th scope="col">Tolerance</th><th scope="col">Verdict</th></tr></thead>
            <tbody>
              {data.pairs.map((p) => (
                <tr key={p.key} data-testid="disagreement-row" title={p.note || undefined}>
                  <th scope="row">{p.label}</th>
                  <td>{fmtVal(p.key, p.research)}</td>
                  <td>{fmtVal(p.key, p.screener)}</td>
                  <td>{p.gap_pct === null || p.gap_pct === undefined ? '—' : `${p.gap_pct}%`}</td>
                  <td>{p.tolerance_pct}%</td>
                  <td className={p.verdict === 'disagree' ? styles.warn : undefined}>
                    {VERDICT[p.verdict] || p.verdict}{p.missing?.length ? ` (no ${p.missing.join(' / ')} value)` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.muted}>
            Research: {data.sides?.research?.source}. Screener: {data.sides?.screener?.source}
            {data.sides?.screener?.bars_asof ? ` (bars as of ${data.sides.screener.bars_asof})` : ''}.
          </div>
        </div>
      )}
    </div>
  )
}

export default function ResearchNotices({ sym, flags }) {
  const f = flags || {}
  const s = (sym || '').toUpperCase().trim()
  if (!s) return null
  const any = f.member_interest_line_enabled === true || f.entity_rename_notice_enabled === true
    || f.metric_disagreement_enabled === true
  if (!any) return null
  return (
    <div className={styles.notices} data-testid="research-notices">
      {f.entity_rename_notice_enabled === true && <RenameNotice sym={s} />}
      {f.member_interest_line_enabled === true && <MemberInterestLine sym={s} />}
      {f.metric_disagreement_enabled === true && <MetricDisagreement sym={s} />}
    </div>
  )
}
