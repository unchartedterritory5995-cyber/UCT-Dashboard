import useOwnership from '../hooks/useOwnership'
import { SeriesChart } from '../../../components/research-kit'
import Provenance from '../../../components/provenance/Provenance'
import FreshnessBadge from '../../../components/provenance/FreshnessBadge'
import { mapAvailability, AVAILABLE } from '../../../components/provenance/availabilityContract'
import { epochSecondsToIso } from '../../../components/provenance/presentationFormat'
import { computeSessionStale } from '../../../components/provenance/sessionStale'
import { sessionModel } from '../../../components/dashboard/sessionModel'
import useMarketOpen from '../../../hooks/useMarketOpen'
import styles from '../ResearchPage.module.css'

/** S8/S11 vertical slice (2026-09-03 A6/A7 pass): Float/shares-outstanding
 *  and Form 13F now flow through D1 (fmp_client.get_shares_float /
 *  get_institutional_ownership_summary / ...holders, via ownership.py) —
 *  this composes the trust strip onto those two fields specifically. The
 *  institutional-holders table and short-interest fields below stay
 *  yfinance-sourced with no D1 envelope (see the plain "Source" notes) —
 *  same discipline as EstimatesTab's forward/revisions sections. */
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

function fmtShares(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return `${v}`
}
function fmtMoney(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toFixed(0)}`
}
function fmtPct(v) { return v == null ? '—' : `${v}%` }
function fmtNum(v) { return v == null ? '—' : Math.round(v).toLocaleString() }
function fmtChgPp(v) {  // ownership-percent change, in percentage points
  if (v == null) return null
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}pp`
}
function fmtChgInt(v) {
  if (v == null) return null
  return `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()}`
}
function chgClass(v) { return v > 0 ? styles.up : v < 0 ? styles.down : '' }

export default function OwnershipTab({ sym }) {
  const { data, isLoading } = useOwnership(sym)
  const session = useMarketOpen()

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Loading ownership…</div></div></div>
  }

  const o = data || {}
  const inst = o.institutional || {}
  const sh = o.short || {}
  const sc = o.share_counts || {}
  const insider = o.insider || []
  const tf = o.thirteen_f || null
  const tfs = tf?.summary || {}
  const sessionContext = sessionModel(session)
  const empty = !(inst.holders?.length) && !insider.length && sh.shares_short == null
    && inst.pct_held == null && !tf && sc.float_shares == null

  return (
    <div className={styles.finWrap}>
      {o.entity && o.entity.status !== 'resolved' && (
        <div className={styles.muted} style={{ fontSize: 11 }} data-testid="entity-unresolved-note">
          Symbol not yet linked to a canonical identity ({o.entity.status}).
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.ct}>Institutional ownership</div>
          <div className={styles.kv}><span>% of shares outstanding</span><b>{fmtPct(inst.pct_held)}</b></div>
          {!!inst.holders?.length && (
            <SeriesChart
              periods={inst.holders.slice(0, 10).map(h => h.holder)}
              mode="rank"
              label="Largest institutional holders (% of shares out)"
              valueFormatter={(v) => (v == null ? '—' : `${Number(v).toFixed(2)}%`)}
              ariaLabel="Institutional holders ranked by percent of shares outstanding"
              series={[{
                name: '% out',
                color: 'var(--ut-gold, #c9a84c)',
                values: inst.holders.slice(0, 10).map(h => h.pct_out),
              }]}
            />
          )}

          {!!inst.holders?.length && (
            <div className={`${styles.gridScroll} ${styles.ownHolders}`}>
              <table className={styles.fgrid}>
                <thead><tr><th>Holder</th><th>Shares</th><th>% Out</th><th>Value</th><th>Reported</th></tr></thead>
                <tbody>
                  {inst.holders.map((h, i) => (
                    <tr key={`${h.holder}-${i}`}>
                      <td className={`${styles.fperiod} ${styles.holderName}`}>{h.holder}</td>
                      <td>{fmtShares(h.shares)}</td>
                      <td>{fmtPct(h.pct_out)}</td>
                      <td>{fmtMoney(h.value)}</td>
                      <td className={styles.muted}>{h.date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Non-D1: no fmp_client adapter carries this today — an honest
              source label, never a fabricated freshness badge. */}
          <div className={styles.muted} style={{ fontSize: 11, marginTop: 6 }}>Source: Yahoo Finance</div>
        </section>

        <section className={styles.card}>
          <div className={styles.ct}>Short interest</div>
          <div className={styles.kv}><span>Short % of float</span><b>{fmtPct(sh.short_pct_float)}</b></div>
          <div className={styles.kv}><span>Days to cover</span><b>{sh.days_to_cover ?? '—'}</b></div>
          <div className={styles.kv}><span>Shares short</span><b>{fmtShares(sh.shares_short)}</b></div>
          <div className={styles.muted} style={{ fontSize: 11, marginTop: 6 }}>Source: Yahoo Finance</div>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div className={styles.kv}><span>Float</span><b>{fmtShares(sc.float_shares)}</b></div>
            <div className={styles.kv}><span>Shares outstanding</span><b>{fmtShares(sc.shares_outstanding)}</b></div>
            <TrustStrip meta={sc._meta} sessionContext={sessionContext} />
          </div>
        </section>
      </div>

      {tf && (
        <section className={styles.card}>
          <div className={styles.ct}>Form 13F · institutional activity <span className={styles.muted}>· {tf.quarter}</span></div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 10 }}>
            {/* NOT the same measure as the "% of shares outstanding" figure in
                the card above, and the two disagree hard: on 2026-08-06 AAPL
                read 65.95% there against 6.38% here, and ATROB 71.85% against
                0.47%. That card is the aggregate institutional stake; this one
                counts only the positions inside THIS quarter's 13F filings.
                Both were previously labeled "Institutional ownership", so the
                page appeared to contradict itself on every ticker. The label
                below states the scope; do not shorten it back. */}
            <div>
              <div className={styles.muted}>Held by 13F filers</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {tfs.ownership_pct != null ? `${tfs.ownership_pct.toFixed(1)}%` : '—'}
                {fmtChgPp(tfs.ownership_change) && <span className={chgClass(tfs.ownership_change)} style={{ fontSize: 12, marginLeft: 6 }}>{fmtChgPp(tfs.ownership_change)}</span>}
              </div>
            </div>
            <div>
              <div className={styles.muted}>Investors holding</div>
              <div>{fmtNum(tfs.investors_holding)} {fmtChgInt(tfs.investors_change) && <span className={chgClass(tfs.investors_change)} style={{ fontSize: 12 }}>{fmtChgInt(tfs.investors_change)}</span>}</div>
            </div>
            <div>
              <div className={styles.muted}>Total invested</div>
              <div>{fmtMoney(tfs.total_invested)} {fmtChgInt(tfs.total_invested_change) && <span className={chgClass(tfs.total_invested_change)} style={{ fontSize: 12 }}>{fmtMoney(tfs.total_invested_change)}</span>}</div>
            </div>
          </div>
          {/* Position flow this quarter */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
            <span className={styles.muted}><b className={styles.up}>{fmtNum(tfs.new_positions)}</b> new</span>
            <span className={styles.muted}><b className={styles.up}>{fmtNum(tfs.increased_positions)}</b> increased</span>
            <span className={styles.muted}><b className={styles.down}>{fmtNum(tfs.reduced_positions)}</b> reduced</span>
            <span className={styles.muted}><b className={styles.down}>{fmtNum(tfs.closed_positions)}</b> closed</span>
          </div>

          {!!tf.holders?.length && (
            <div className={`${styles.gridScroll} ${styles.ownHolders}`}>
              <table className={styles.fgrid}>
                <thead><tr><th>Top holder</th><th>Shares</th><th>Δ Shares</th><th>% Own</th><th>Value</th></tr></thead>
                <tbody>
                  {tf.holders.map((h, i) => (
                    <tr key={`${h.name}-${i}`}>
                      <td className={`${styles.fperiod} ${styles.holderName}`}>
                        {h.name}
                        {h.is_new && <span className={styles.up} style={{ fontSize: 9, marginLeft: 5 }} data-holder-badge="new">NEW</span>}
                        {h.is_sold_out && <span className={styles.down} style={{ fontSize: 9, marginLeft: 5 }} data-holder-badge="sold">SOLD</span>}
                      </td>
                      <td>{fmtShares(h.shares)}</td>
                      <td className={chgClass(h.change_shares)}>{h.change_shares != null ? fmtShares(h.change_shares) : '—'}</td>
                      <td>{h.ownership != null ? `${h.ownership.toFixed(1)}%` : '—'}</td>
                      <td>{fmtMoney(h.market_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <TrustStrip meta={tf._meta} sessionContext={sessionContext} />
          {/* 13F filings lag ~45 days by nature — the freshness badge above
              reflects D1's provenance, this states the structural lag itself. */}
          <div className={styles.muted} style={{ fontSize: 11, marginTop: 4 }}>13F filings lag roughly 45 days after quarter-end.</div>
        </section>
      )}

      {!!insider.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Insider activity (recent)</div>
          <div className={styles.rclist}>
            {insider.map((t, i) => (
              <div key={`${t.date}-${t.name}-${i}`} className={styles.insrow}>
                <span className={styles.rcdate}>{t.date}</span>
                <span className={styles.rcfirm}>{t.name}{t.title ? ` · ${t.title}` : ''}</span>
                <span className={t.type === 'buy' ? styles.up : styles.down}>{t.type}</span>
                <span>{fmtShares(t.shares)}</span>
                <span className={styles.muted}>{fmtMoney(t.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {empty && <div className={styles.fnote}>Ownership data is unavailable for this ticker.</div>}
    </div>
  )
}
