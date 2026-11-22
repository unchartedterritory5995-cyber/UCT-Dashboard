import { useContext } from 'react'
import useOwnership from '../hooks/useOwnership'
import { AuthContext } from '../../../context/AuthContext'
import CongressTradesPanel from '../depth/CongressTradesPanel'
import { DepthStackContext } from '../depth/depthChrome'
import PanelCommand from '../../../components/terminal/PanelCommand'
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
import { formatCompactTerminal, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { pctUpTo } from '../researchFormat'
import { holdersByOwnership, institutionalNote, quarterLabel, shortMissingWords } from '../../charts/widgets/ownershipModel'
import { SOURCE as SHORT_SOURCE, dayText, floatWords } from '../../terminal/panels/shortInterestModel'
import { FUNDS_TITLE, LEG_13F_WORDS } from '../../terminal/panels/fundHoldersModel'
import FundHoldersBlock from './FundHoldersBlock'
import FundsNportBlock from './FundsNportBlock'
import { NPORT_TITLE, quarterWords } from '../../terminal/panels/fundNportModel'
import { themeInk } from '../themeInk'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'

/** S8/S11 vertical slice (2026-09-03 A6/A7 pass): Float/shares-outstanding
 *  and Form 13F flow through D1 (fmp_client.get_shares_float /
 *  get_institutional_ownership_summary / ...holders, via ownership.py) —
 *  this composes the trust strip onto those two fields specifically.
 *
 *  WHERE EACH CARD READS (one answer, /api/research/ownership/{sym}):
 *    Institutional ownership  the Form 13F block: the percent is the server's
 *                             `institutional.pct_held` (the 13F summary's), the
 *                             ranked holders are `topHolders` from the Charts
 *                             dock's ownershipModel, so both screens list the same
 *                             filers. No 13F on file: "not available", in words.
 *    Short interest           the newest FINRA report the short interest service
 *                             already holds (`short.state === 'ok'`), with its
 *                             settlement date. The tab never asks a vendor for it:
 *                             with nothing held the card says "not available" and
 *                             points at SHINT, whose open reads the reports. */
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

// A vendor ZERO for a float is not a measured zero: a listed security with shares outstanding
// cannot have a float of 0, and FMP writes 0 where it holds nothing (every ETF read "Float 0").
// Rendered as not reported, never as "0". (The short card is a dated FINRA report: its figures
// are shown as the report gives them, the way SHINT shows them.)
const reported = (v) => (v == null || Number(v) === 0 || !Number.isFinite(Number(v)) ? null : Number(v))
const NOT_AVAILABLE = 'not available'
const finite = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

const fmtShares = (v) => formatCompactTerminal(v)
// Holder values are US dollars by construction (13F market values, Form 4 prices on the US
// listing), so the "$" stays -- and the column says USD, so a foreign filer's holder table never
// reads as its reporting currency.
const fmtMoney = (v) => formatCompactTerminal(v, { money: true })
const fmtPct = (v) => pctUpTo(v, 2)
const fmtNum = (v) => formatNumber(v == null ? null : Math.round(v))
function fmtChgPp(v) {  // ownership-percent change, in percentage points
  if (v == null) return null
  return `${v > 0 ? '+' : ''}${formatNumber(v, { decimals: 2 })}pp`
}
function fmtChgInt(v) {
  if (v == null) return null
  return `${v > 0 ? '+' : ''}${formatNumber(Math.round(v))}`
}
function chgClass(v) { return v > 0 ? styles.up : v < 0 ? styles.down : '' }
// A change carries its own sign, so green/red is never the only signal (audit 2026-10-08: a
// rise read "1.2M" in green and a fall "-1.2M" in red; a colour-blind member saw no direction
// on the rise, and the dollar change dropped the + the other change chips carry).
export function signed(v, fmt) {
  if (v == null || !Number.isFinite(Number(v))) return null
  const t = fmt(Number(v))
  return Number(v) > 0 ? `+${t}` : t
}
// tq-panels: the transaction side printed as the raw lowercase enum ("buy" / "sell").
/** Audit 2026-10-08 (OWN P2, point 22): every non-buy type (an option exercise, a gift) was styled
 *  red as if it were a sale. Only a buy is green and only a sale is red; anything else is plain. */
export function sideClass(type) {
  const t = String(type || '').trim().toLowerCase()
  return t === 'buy' ? styles.up : t === 'sell' ? styles.down : ''
}

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
              <span className={sideClass(t.type)}>{sideLabel(t.type)}</span>
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

// TERM-045: the SEC Official List of Section 13(f) Securities joined to this ticker's
// own CUSIP (api/services/sec_13f_list.py, dark server flag). The block is absent while
// the flag is off, so nothing renders. Every state says what it is: "not on the list"
// and "we could not check" are different facts.
export function ThirteenFListLine({ block, sym }) {
  if (!block || !block.state) return null
  const q = block.quarter ? ` (${block.quarter})` : ''
  let text
  if (block.state === 'ok') {
    const own = block.security?.description ? `${block.security.description}, CUSIP ${block.cusip}` : `CUSIP ${block.cusip}`
    const others = (block.issuer_securities || []).filter((s) => s.cusip !== block.cusip).length
    text = `${sym}'s ${own} is on the SEC's 13(f) list${q}, so 13F filers must report it.`
      + (block.security?.has_listed_options ? ' Listed options exist on it.' : '')
      + (others > 0 ? ` ${others} other ${others === 1 ? 'security' : 'securities'} of this issuer ${others === 1 ? 'is' : 'are'} on the list too.` : '')
  } else if (block.state === 'not_on_list') {
    text = `CUSIP ${block.cusip} is not on the SEC's 13(f) list${q}, so 13F filers do not report positions in it.`
  } else {
    text = `13(f) list check unavailable: ${block.reason || 'the list could not be read'}.`
  }
  return (
    <div className={styles.srcNoteTight} data-testid="thirteenf-list" data-state={block.state}>
      {text}{' '}Source: {block.source}.
    </div>
  )
}

export default function OwnershipTab({ sym }) {
  const { data, isLoading, error, paywalled, mutate } = useOwnership(sym)
  const session = useMarketOpen()
  // COV-12: congressional trades sit beside insiders and 13F. Its own read and its own gate
  // (`researchDepth.congress_trades_enabled`, absent unless CONGRESS_TRADES_ENABLED is set), read
  // off the context directly so the tab still renders where no AuthProvider is mounted.
  const congressOn = useContext(AuthContext)?.researchDepth?.congress_trades_enabled === true
  const edgarPending = !error && data?.insider_source?.state === 'pending'
  const { exhausted: reaskExhausted, retry: reaskRetry } = usePendingReask(edgarPending, mutate, sym)

  if (isLoading) {
    return <ResearchLoading label="Loading ownership" />
  }

  // TERM-088 -- a failed read is not a genuinely empty ownership record.
  // Render the error distinctly so a backend hiccup never reads as "no
  // ownership data exists".
  if (paywalled) {
    return <div className={styles.fnote} data-testid="ownership-paywalled">Ownership requires a paid plan.</div>
  }
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
  // Funds (N-PORT): the SEC's Form N-PORT holders, from the index the server builds out of the quarterly data sets.
  const nport = o.funds_nport && typeof o.funds_nport === 'object' ? o.funds_nport : null
  const nportQuarter = quarterWords(nport?.data_set?.quarter)
  const sessionContext = sessionModel(session)
  const s = o.sym || sym
  // The short card draws figures only from a HELD report (`state: 'ok'`, with its settlement date).
  const shortOk = sh.state === 'ok' && !!sh.settlement_date && finite(sh.shares_short) != null
  const shortState = shortOk ? 'ok' : (sh.state && sh.state !== 'ok' ? sh.state : 'not_held')
  const rankedHolders = holdersByOwnership(o)
  const instPct = finite(inst.pct_held)
  const instNote = institutionalNote(inst, tf, s)
  const instQuarter = quarterLabel(tf?.quarter) || tf?.quarter || null
  const shortFloatWords = shortOk ? floatWords({ pct: finite(sh.short_pct_float), withheld: sh.pct_float_withheld === true }) : null
  const empty = !insider.length && !shortOk
    && instPct == null && !tf && sc.float_shares == null && !edgarSrc && nport?.state !== 'ok'

  // tq-panels: one leg failing (the 13F read, the share counts, or the insider read) used to
  // leave its cards reading as dashes -- indistinguishable from "nothing reported". Say which.
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
        <section className={styles.card} data-testid="ownership-institutional" data-state={tf ? 'ok' : (inst.state === 'failed' ? 'failed' : 'none')}>
          <div className={styles.ct}>Institutional ownership</div>
          <div className={styles.kv}><span>% of shares outstanding</span><b>{instPct == null ? NOT_AVAILABLE : fmtPct(instPct)}</b></div>
          {rankedHolders.length > 0 && (
            <SeriesChart
              periods={rankedHolders.map(h => h.name)}
              mode="rank"
              label="Largest institutional holders (% of shares out)"
              valueFormatter={(v) => formatPercent(v == null ? NaN : Number(v), { decimals: 2 })}
              ariaLabel="Institutional holders ranked by percent of shares outstanding"
              series={[{
                name: '% out',
                color: themeInk('--ut-gold', CHART_INK.gold),
                values: rankedHolders.map(h => h.ownership),
              }]}
            />
          )}
          {instNote && <div className={styles.fnote} data-testid="ownership-institutional-note">{instNote}</div>}
          {/* One holders table, not two: the filers and the change in each position are in the
              Form 13F card below, read from the same block. */}
          <div className={styles.srcNote} data-testid="ownership-institutional-source">
            Source: Form 13F filings, through FMP{instQuarter ? ` · ${instQuarter}` : ''}.
            {tf?.holders?.length ? ` Each holder, with the change in its position, is in the ${FUNDS_TITLE} table below.` : ''}
          </div>
        </section>

        <section className={styles.card} data-testid="ownership-short" data-state={shortState}>
          <div className={styles.ct}>Short interest</div>
          <div className={styles.kv}><span>Short % of float</span><b>{shortOk && finite(sh.short_pct_float) != null ? fmtPct(sh.short_pct_float) : NOT_AVAILABLE}</b></div>
          <div className={styles.kv}><span>Days to cover</span><b>{shortOk && finite(sh.days_to_cover) != null ? formatNumber(Number(sh.days_to_cover), { decimals: 1 }) : NOT_AVAILABLE}</b></div>
          <div className={styles.kv}><span>Shares short</span><b>{shortOk ? fmtShares(sh.shares_short) : NOT_AVAILABLE}</b></div>
          {shortOk ? (
            <>
              <div className={styles.srcNote} data-testid="ownership-short-asof">
                FINRA report for settlement date {dayText(sh.settlement_date)}. FINRA publishes each report about two
                weeks after its settlement date, so this is not today&apos;s position.{' '}
                {shortFloatWords
                  ? `Percent of float is not available. ${shortFloatWords}.`
                  : `Percent of float uses today's float from the nightly screener export${finite(sh.float_shares) != null ? ` (${fmtShares(sh.float_shares)} shares)` : ''}, so the two figures are from different days.`}
              </div>
              <div className={styles.srcNote} data-testid="ownership-short-source">
                Source: {sh.source || SHORT_SOURCE}. Every report for {s}:{' '}
                <PanelCommand cmd={`${s} SHINT`} label={`Short interest history (SHINT) for ${s}`}>Short interest history (SHINT)</PanelCommand>
              </div>
            </>
          ) : (
            <div className={styles.fnote} data-testid="ownership-short-unavailable">
              {shortMissingWords(sh, s)} The dated record, report by report, is on{' '}
              <PanelCommand cmd={`${s} SHINT`} label={`Short interest history (SHINT) for ${s}`}>Short interest history (SHINT)</PanelCommand>:
              run <kbd>{s} SHINT</kbd> in the UCT Terminal.
            </div>
          )}

          <div className={styles.cardDivider}>
            <div className={styles.kv}><span>Float</span><b>{fmtShares(reported(sc.float_shares))}</b></div>
            <div className={styles.kv}><span>Shares outstanding</span><b>{fmtShares(sc.shares_outstanding)}</b></div>
            <TrustStrip meta={sc._meta} sessionContext={sessionContext} />
          </div>
        </section>
      </div>

      {tf && (
        <section className={styles.card} data-testid="ownership-funds">
          {/* Wave 3 (OWN P2 #12): a missing quarter printed a dangling "· " and "…holders, undefined". */}
          <div className={styles.ct}>{FUNDS_TITLE}{instQuarter ? <span className={styles.muted}> · {instQuarter}</span> : null}</div>
          <div className={`${styles.statRow} ${styles.statRowGap}`}>
            {/* The same Form 13F summary figure as "% of shares outstanding" in the
                card above (that card reads it through `institutional.pct_held`,
                which withholds a figure over 100). Here it carries its change over
                the quarter and its own label, which states the scope: what the
                filers of THIS quarter's 13Fs hold. Do not shorten it back to a bare
                "Institutional ownership": the two labels must not be the same words. */}
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
              <div className={styles.muted}>Total invested (USD)</div>
              <div>{fmtMoney(tfs.total_invested)} {signed(tfs.total_invested_change, fmtMoney) && <span className={`${chgClass(tfs.total_invested_change)} ${styles.statChg}`}>{signed(tfs.total_invested_change, fmtMoney)}</span>}</div>
            </div>
          </div>
          {/* The quarter's position counts in one line, the quarter end and the 45-day filing rule,
              and every holder figure the answer carries, sortable, 20 rows and the rest on request
              (FundHoldersBlock + fundHoldersModel). Keyed on the symbol so a new stock starts on the
              default sort with the list folded. */}
          <FundHoldersBlock key={s} tf={tf} failed={failed.includes(LEG_13F_WORDS)} />
          <ThirteenFListLine block={o.thirteen_f_list} sym={o.sym || sym} />
          <TrustStrip meta={tf._meta} sessionContext={sessionContext} />
        </section>
      )}

      {!tf && o.thirteen_f_list && (
        <section className={styles.card}>
          <div className={styles.ct}>Form 13F</div>
          <ThirteenFListLine block={o.thirteen_f_list} sym={o.sym || sym} />
        </section>
      )}

      {/* Below the 13F block: the registered funds (mutual funds and ETFs) from their own N-PORT reports. Keyed on
          the symbol so a new stock starts on the default sort with the list folded. */}
      {nport && (
        <section className={styles.card} data-testid="ownership-funds-nport" data-state={nport.state || 'none'}>
          <div className={styles.ct}>{NPORT_TITLE}{nportQuarter ? <span className={styles.muted}> · {nportQuarter} data set</span> : null}</div>
          <FundsNportBlock key={s} block={nport} sym={s} />
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
                <span className={sideClass(t.type)}>{sideLabel(t.type)}</span>
                <span>{fmtShares(t.shares)}</span>
                <span className={styles.muted}>{fmtMoney(t.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stacked, like a DPTH panel: its own card and title, and it never claims the OWN
          panel header's source line (that belongs to ownership). */}
      {congressOn && (
        <DepthStackContext.Provider value={true}>
          <CongressTradesPanel sym={o.sym || sym} />
        </DepthStackContext.Provider>
      )}

      {empty && <div className={styles.fnote}>Ownership data is unavailable for this ticker.</div>}
    </div>
  )
}
