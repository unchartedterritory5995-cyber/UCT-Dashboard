import useAnalystRatings from '../hooks/useAnalystRatings'
import useLivePrices from '../../../hooks/useLivePrices'
import { RatingChangeList } from '../../../components/research-kit'
import Provenance from '../../../components/provenance/Provenance'
import FreshnessBadge from '../../../components/provenance/FreshnessBadge'
import { mapAvailability, AVAILABLE } from '../../../components/provenance/availabilityContract'
import { epochSecondsToIso } from '../../../components/provenance/presentationFormat'
import { computeSessionStale } from '../../../components/provenance/sessionStale'
import { sessionModel } from '../../../components/dashboard/sessionModel'
import useMarketOpen from '../../../hooks/useMarketOpen'
import styles from '../ResearchPage.module.css'

// 2026-09-03 dedicated Analyst Ratings slice (owner authorization). Same
// per-card TrustStrip idiom as EstimatesTab.jsx's own copy (and every other
// research tab's) -- copied locally rather than shared, per this codebase's
// established "until a third caller justifies promoting it" convention.
// Applies to the consensus and price-target cards, which carry D1's real
// provenance/freshness envelope; recent_actions carries its OWN envelope
// (one for the whole list, not per-row -- see analyst_grades.py) rendered
// the same way, right under the list rather than per-row, to avoid
// cluttering a dense list with a badge on every action.
function TrustStrip({ meta, sessionContext }) {
  if (!meta) return null
  const availability = mapAvailability({ value: true, degraded: meta.degraded })
  const asOfIso = epochSecondsToIso(meta.sourceObservedAt)
  const sessionStale = computeSessionStale(asOfIso)
  return (
    <div className={styles.muted} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <Provenance
        value="FMP"
        availability={availability}
        provenance={availability === AVAILABLE ? {
          sourceActivity: meta.sourceActivity,
          timestamp: asOfIso,
          tieBreak: meta.tieBreak,
        } : null}
      />
      {availability === AVAILABLE && (
        <FreshnessBadge
          freshnessClass={meta.freshnessClass}
          asOf={asOfIso}
          sessionState={sessionContext}
          sessionStale={sessionStale}
        />
      )}
    </div>
  )
}

function fmtUsd(v) { return v == null ? '—' : `$${v.toFixed(0)}` }
function fmtPct(v) { return v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%` }

// Sell-side consensus buckets, strong-buy → strong-sell — identical palette
// to EstimatesTab.jsx's (same concept, same card, just relocated here).
const SEG = [
  { key: 'strongBuy', label: 'Strong Buy', color: 'var(--ut-green-bright)' },
  { key: 'buy', label: 'Buy', color: 'var(--ut-green)' },
  { key: 'hold', label: 'Hold', color: 'var(--text-muted)' },
  { key: 'sell', label: 'Sell', color: 'var(--ut-red)' },
  { key: 'strongSell', label: 'Strong Sell', color: 'var(--ut-red-bright)' },
]
function consensusClass(label) {
  const l = (label || '').toLowerCase()
  if (/buy|outperform|overweight/.test(l)) return styles.up
  if (/sell|underperform|underweight/.test(l)) return styles.down
  return ''
}
function ptRecency(pt) {
  for (const w of [['Last month', pt.last_month], ['Last quarter', pt.last_quarter], ['Last year', pt.last_year]]) {
    if (w[1] && w[1].count > 0 && w[1].avg != null) return { label: w[0], avg: w[1].avg, count: w[1].count }
  }
  return null
}

// analyst_grades.py's field names (date/company/action/from_grade/to_grade)
// -> RatingChangeList's shared prop contract (date/firm/action/from/to/pt).
// `pt` (a per-action price target) is deliberately never populated: the
// bounded live field check for this slice confirmed FMP's action feed
// carries no per-action price-target field at all (owner decision 3,
// 2026-09-03) -- leaving it undefined renders as blank, never a fabricated
// value.
function toRatingChangeRows(actions) {
  return (actions || []).map(a => ({
    date: a.date, firm: a.company, action: a.action,
    from: a.from_grade, to: a.to_grade,
  }))
}

export default function AnalystRatingsTab({ sym }) {
  const { data, isLoading } = useAnalystRatings(sym)
  const session = useMarketOpen()
  const { prices: livePrices } = useLivePrices(sym ? [sym] : [])

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Loading analyst ratings…</div></div></div>
  }

  const e = data || {}
  const con = e.consensus || null
  const pt = e.price_target || null
  const ptr = pt ? ptRecency(pt) : null
  const actions = e.recent_actions?.items || []
  const actionsMeta = e.recent_actions?._meta || null
  const empty = !con && !pt && !actions.length
  const sessionContext = sessionModel(session)

  const livePrice = livePrices[sym]?.price ?? null
  // Upside/downside vs current price -- a transparent, LOCAL computation
  // from provider inputs (never attributed to FMP itself; FMP supplies the
  // target, not the % distance from today's price).
  const ptMid = pt?.consensus ?? pt?.median ?? null
  const upside = livePrice != null && ptMid != null
    ? ((ptMid - livePrice) / livePrice) * 100
    : null

  return (
    <div className={styles.finWrap}>
      {e.entity && e.entity.status !== 'resolved' && (
        <div className={styles.muted} style={{ fontSize: 11 }} data-testid="entity-unresolved-note">
          Symbol not yet linked to a canonical identity ({e.entity.status}).
        </div>
      )}

      {con && (
        <section className={styles.card}>
          <div className={styles.ct}>Analyst consensus</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span className={consensusClass(con.label)} style={{ fontSize: 18, fontWeight: 700 }}>{con.label || '—'}</span>
            <span className={styles.muted}>{con.total} analysts</span>
          </div>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', margin: '10px 0' }}>
            {SEG.map(s => {
              const v = con[s.key] || 0
              const w = con.total ? (v / con.total) * 100 : 0
              return w > 0 ? <div key={s.key} title={`${s.label}: ${v}`} style={{ width: `${w}%`, background: s.color }} /> : null
            })}
          </div>
          <div>
            {SEG.map(s => (
              <span key={s.key} className={styles.muted} style={{ marginRight: 16 }}>
                <b style={{ color: s.color }}>{con[s.key] || 0}</b> {s.label}
              </span>
            ))}
          </div>
          <TrustStrip meta={con._meta} sessionContext={sessionContext} />
        </section>
      )}

      {pt && (
        <section className={styles.card}>
          <div className={styles.ct}>Price target</div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <div className={styles.muted}>Consensus</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtUsd(ptMid)}</div>
            </div>
            <div>
              <div className={styles.muted}>Range</div>
              <div>{fmtUsd(pt.low)} – {fmtUsd(pt.high)}</div>
            </div>
            {upside != null && (
              <div>
                <div className={styles.muted}>vs current price</div>
                <div className={upside >= 0 ? styles.up : styles.down}>{fmtPct(upside)}</div>
              </div>
            )}
            {ptr && (
              <div>
                <div className={styles.muted}>{ptr.label} avg</div>
                <div>{fmtUsd(ptr.avg)} <span className={styles.muted}>({ptr.count})</span></div>
              </div>
            )}
          </div>
          <TrustStrip meta={pt._meta} sessionContext={sessionContext} />
        </section>
      )}

      {!!actions.length && (
        <section className={styles.card}>
          <RatingChangeList
            rows={toRatingChangeRows(actions)}
            cap={12}
            label="Recent analyst actions"
          />
          <TrustStrip meta={actionsMeta} sessionContext={sessionContext} />
        </section>
      )}

      {empty && <div className={styles.fnote}>Analyst rating data is unavailable for this ticker.</div>}
    </div>
  )
}
