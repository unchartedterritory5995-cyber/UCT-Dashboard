import useOwnership from '../hooks/useOwnership'
import { SeriesChart } from '../../../components/research-kit'
import Provenance from '../../../components/provenance/Provenance'
import FreshnessBadge from '../../../components/provenance/FreshnessBadge'
import { mapAvailability, AVAILABLE } from '../../../components/provenance/availabilityContract'
import { epochSecondsToIso } from '../../../components/provenance/presentationFormat'
import { computeSessionStale } from '../../../components/provenance/sessionStale'
import { sessionModel } from '../../../components/dashboard/sessionModel'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { usePendingReask } from '../depth/depthFetch'
import { CHART_INK } from '../../../components/research-kit/charts/echartsCore'
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { pctUpTo } from '../researchFormat'
import { themeInk } from '../themeInk'
import ResearchLoading from '../ResearchLoading'
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
    <div className={styles.trustStrip}>
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

// A vendor ZERO for a float, a short count or days to cover is not a measured zero: a listed
// security with shares outstanding cannot have a float of 0, and Yahoo/FMP write 0 where they
// hold nothing (every ETF reads "Float 0"). Rendered as not reported, never as "0".
const reported = (v) => (v == null || Number(v) === 0 || !Number.isFinite(Number(v)) ? null : Number(v))

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
const fmtPct = (v) => pctUpTo(v, 2)
const fmtNum = (v) => formatNumber(v == null ? null : Math.round(v))
function fmtChgPp(v) {  // ownership-percent change, in percentage points
  if (v == null) return null
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}pp`
}
function fmtChgInt(v) {
  if (v == null) return null
  return `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()}`
}
function chgClass(v) { return v > 0 ? styles.up : v < 0 ? styles.down : '' }
// tq-panels: the transaction side printed as the raw lowercase enum ("buy" / "sell").
export function sideLabel(type) {
  const s = String(type || '').trim()
  if (!s) return '—'
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/** TERM-045 (dark, EDGAR_OWNERSHIP_ENABLED): present only when the server
 *  sourced the insider section from SEC EDGAR Form 4. Every state says what it
 *  is in words. Only a complete read with no rows may say "none were filed";
 *  pending / not_found / unavailable are unknowns and never render as an
 *  empty list. */
function edgarStateLine(src, sym) {
  switch (src.state) {
    case 'pending': return `Reading SEC EDGAR Form 4 filings for ${sym}… this fills in by itself.`
    case 'not_found': return `No SEC filer could be matched to ${sym}, so insider activity is unknown.`
    case 'unavailable': return 'SEC EDGAR could not be read just now, so insider activity is unknown.'
    default: return null
  }
}

function EdgarInsiderSection({ src, rows, sym, onRetry, reaskExhausted }) {
  const readable = src.state === 'ok' || src.state === 'partial'
  // tq-panels: pending re-asks by itself (usePendingReask) -- no button while it does;
  // once the re-asks are spent it says so and offers a manual check.
  const autoReading = src.state === 'pending' && !reaskExhausted
  const unread = src.filings_unread || []
  const windowDays = src.window_days || 180
  return (
    <section className={styles.card} data-testid="edgar-insider">
      <div className={styles.ct}>Insider activity (recent)</div>
      {!readable && (
        <div className={styles.fnote}>
          {src.state === 'pending' && reaskExhausted
            ? `SEC EDGAR Form 4 filings for ${sym} are still being read.`
            : edgarStateLine(src, sym)}
          {onRetry && !autoReading && (
            <button type="button" className={`${styles.basisBtn} ${styles.inlineRetry}`} onClick={() => onRetry()}>
              Check again
            </button>
          )}
        </div>
      )}
      {readable && rows.length === 0 && (
        <div className={styles.fnote}>
          {`No open-market insider buys or sells were filed on Form 4 in the last ${windowDays} days.`}
        </div>
      )}
      {readable && rows.length > 0 && (
        <div className={styles.rclist}>
          {rows.map((t, i) => (
            <div key={`${t.accession}-${t.date}-${i}`} className={styles.insrow}>
              <span className={styles.rcdate}>{t.date}</span>
              <span className={styles.rcfirm}>{t.name}{t.title ? ` · ${t.title}` : ''}</span>
              <span className={t.type === 'buy' ? styles.up : styles.down}>{sideLabel(t.type)}</span>
              <span>{fmtShares(t.shares)}</span>
              <span className={styles.muted}>{fmtMoney(t.amount)}</span>
              {t.url
                ? <a href={t.url} target="_blank" rel="noopener noreferrer" className={styles.muted}>{`Form ${t.form || '4'}`}</a>
                : <span className={styles.muted}>{`Form ${t.form || '4'}`}</span>}
            </div>
          ))}
        </div>
      )}
      {readable && unread.length > 0 && (
        <div className={styles.srcNote} data-testid="edgar-unread">
          {`${unread.length} of ${src.filings_listed} filings could not be read: ${unread.map(u => u.accession).join(', ')}`}
        </div>
      )}
      {readable && src.truncated_at_cap && (
        <div className={styles.srcNoteTight}>
          {`Only the newest ${src.filings_read + unread.length} of ${src.filings_listed} filings were read.`}
        </div>
      )}
      {readable && src.index_short && (
        <div className={styles.srcNoteTight}>
          Older filings in this window are outside the SEC index read here.
        </div>
      )}
      <div className={styles.srcNote}>
        {`Source: SEC EDGAR Form 4 · open-market buys and sells filed in the last ${windowDays} days`}
      </div>
    </section>
  )
}

export default function OwnershipTab({ sym }) {
  const { data, isLoading, error, mutate } = useOwnership(sym)
  const session = useMarketOpen()
  const edgarPending = !error && data?.insider_source?.state === 'pending'
  const { exhausted: reaskExhausted, retry: reaskRetry } = usePendingReask(edgarPending, mutate, sym)

  if (isLoading) {
    return <ResearchLoading label="Loading ownership" />
  }

  // TERM-088 -- a failed read is not a genuinely empty ownership record.
  // Render the error distinctly so a backend hiccup never reads as "no
  // ownership data exists".
  if (error) {
    return (
      <div className={styles.fnote} data-testid="ownership-error">
        Couldn't load ownership data for this ticker.
        {' '}
        <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
      </div>
    )
  }

  const o = data || {}
  const inst = o.institutional || {}
  const sh = o.short || {}
  const sc = o.share_counts || {}
  const insider = o.insider || []
  const edgarSrc = o.insider_source || null
  const tf = o.thirteen_f || null
  const tfs = tf?.summary || {}
  const sessionContext = sessionModel(session)
  const empty = !(inst.holders?.length) && !insider.length && sh.shares_short == null
    && inst.pct_held == null && !tf && sc.float_shares == null && !edgarSrc

  // tq-panels: one leg failing (Yahoo, or the insider read) used to leave its cards
  // reading as dashes -- indistinguishable from "nothing reported". Say which.
  const failed = Array.isArray(o.legs_failed) ? o.legs_failed : []

  return (
    <div className={styles.finWrap}>
      {failed.length > 0 && (
        <div className={styles.fnote} data-testid="ownership-partial">
          Part of {o.sym || sym}'s ownership could not be read right now: {failed.join('; ')}. The rest is what answered.
          {' '}
          <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
        </div>
      )}
      {o.entity && o.entity.status !== 'resolved' && (
        <div className={styles.entityNote} data-testid="entity-unresolved-note">
          This symbol is not yet linked to a company record, so some sources below may not match it.
        </div>
      )}

      <div className={styles.cardGrid}>
        <section className={styles.card}>
          <div className={styles.ct}>Institutional ownership</div>
          <div className={styles.kv}><span>% of shares outstanding</span><b>{fmtPct(inst.pct_held)}</b></div>
          {!!inst.holders?.length && (
            <SeriesChart
              periods={inst.holders.slice(0, 10).map(h => h.holder)}
              mode="rank"
              label="Largest institutional holders (% of shares out)"
              valueFormatter={(v) => formatPercent(v == null ? NaN : Number(v), { decimals: 2 })}
              ariaLabel="Institutional holders ranked by percent of shares outstanding"
              series={[{
                name: '% out',
                color: themeInk('--ut-gold', CHART_INK.gold),
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
          <div className={styles.srcNote}>Source: Yahoo Finance</div>
        </section>

        <section className={styles.card}>
          <div className={styles.ct}>Short interest</div>
          <div className={styles.kv}><span>Short % of float</span><b>{fmtPct(reported(sh.short_pct_float))}</b></div>
          <div className={styles.kv}><span>Days to cover</span><b>{formatNumber(reported(sh.days_to_cover) ?? NaN, { decimals: 1 })}</b></div>
          <div className={styles.kv}><span>Shares short</span><b>{fmtShares(reported(sh.shares_short))}</b></div>
          <div className={styles.srcNote}>Source: Yahoo Finance</div>

          <div className={styles.cardDivider}>
            <div className={styles.kv}><span>Float</span><b>{fmtShares(reported(sc.float_shares))}</b></div>
            <div className={styles.kv}><span>Shares outstanding</span><b>{fmtShares(sc.shares_outstanding)}</b></div>
            <TrustStrip meta={sc._meta} sessionContext={sessionContext} />
          </div>
        </section>
      </div>

      {tf && (
        <section className={styles.card}>
          <div className={styles.ct}>Form 13F · institutional activity <span className={styles.muted}>· {tf.quarter}</span></div>
          <div className={`${styles.statRow} ${styles.statRowGap}`}>
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
              <div className={styles.statBig}>
                {formatPercent(tfs.ownership_pct, { decimals: 1 })}
                {fmtChgPp(tfs.ownership_change) && <span className={`${chgClass(tfs.ownership_change)} ${styles.statChg}`}>{fmtChgPp(tfs.ownership_change)}</span>}
              </div>
            </div>
            <div>
              <div className={styles.muted}>Investors holding</div>
              <div>{fmtNum(tfs.investors_holding)} {fmtChgInt(tfs.investors_change) && <span className={`${chgClass(tfs.investors_change)} ${styles.statChg}`}>{fmtChgInt(tfs.investors_change)}</span>}</div>
            </div>
            <div>
              <div className={styles.muted}>Total invested</div>
              <div>{fmtMoney(tfs.total_invested)} {fmtChgInt(tfs.total_invested_change) && <span className={`${chgClass(tfs.total_invested_change)} ${styles.statChg}`}>{fmtMoney(tfs.total_invested_change)}</span>}</div>
            </div>
          </div>
          {/* Position flow this quarter */}
          <div className={styles.flowCounts}>
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
                        {h.is_new && <span className={`${styles.up} ${styles.holderBadge}`} data-holder-badge="new">NEW</span>}
                        {h.is_sold_out && <span className={`${styles.down} ${styles.holderBadge}`} data-holder-badge="sold">SOLD</span>}
                      </td>
                      <td>{fmtShares(h.shares)}</td>
                      <td className={chgClass(h.change_shares)}>{h.change_shares != null ? fmtShares(h.change_shares) : '—'}</td>
                      <td>{formatPercent(h.ownership, { decimals: 1 })}</td>
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
          <div className={styles.srcNoteTight}>13F filings lag roughly 45 days after quarter-end.</div>
        </section>
      )}

      {edgarSrc && (
        <EdgarInsiderSection src={edgarSrc} rows={insider} sym={o.sym || sym}
          onRetry={edgarSrc.state === 'pending' ? reaskRetry : mutate} reaskExhausted={reaskExhausted} />
      )}

      {!edgarSrc && !!insider.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Insider activity (recent)</div>
          <div className={styles.rclist}>
            {insider.map((t, i) => (
              <div key={`${t.date}-${t.name}-${i}`} className={styles.insrow}>
                <span className={styles.rcdate}>{t.date}</span>
                <span className={styles.rcfirm}>{t.name}{t.title ? ` · ${t.title}` : ''}</span>
                <span className={t.type === 'buy' ? styles.up : styles.down}>{sideLabel(t.type)}</span>
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
