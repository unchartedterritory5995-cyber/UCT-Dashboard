/**
 * DockOwnership — the Ownership tab of the Company Intelligence panel.
 *
 * Replaces Valuation. Built to the same rules as Financials and Earnings: one
 * grid geometry shared by a header and its rows, gold reserved for section
 * structure, green/red for direction only, exact values in tables and nothing
 * invented to fill a section.
 *
 * ZERO NEW BACKEND. Both endpoints are ungated and already company-cached:
 *   /api/research/ownership/{sym}   institutional · 13F flow · short · insider
 *   /api/fundamentals-full/{sym}    insider ownership %, already fetched by Overview
 *
 * WHY NO ETF SECTION. The brief asked for one and the data does not exist:
 * `etf_holdings.get_holdings(sym)` answers "what does this ETF hold", the exact
 * reverse of "which ETFs hold this stock", and `fmp_client` carries no
 * exposure adapter. Building the reverse by scanning every ETF's constituents
 * would be thousands of calls per ticker. Omitted rather than faked.
 *
 * TIME IS THE HARD PART. 13F is filed up to 45 days after a quarter closes,
 * Form 4 within two business days, FINRA short interest twice a month. Every
 * delayed section states its own as-of, and the language is always about what a
 * FILING reports rather than what somebody did.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import {
  snapshotFacts, institutionalFlow, topHolders, insiderActivity, positioningFacts,
  HOLDER_STATE, fmtShares, fmtMoney, fmtPct, fmtDate, fmtDateShort, quarterEnd,
} from './ownershipModel'
import styles from './dockPanels.module.css'

const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)
const TONE = { up: styles.pos, down: styles.neg, none: styles.muted }
const HOLDERS_DEFAULT = 6

function SectionHead({ title, meta, note }) {
  return (
    <div className={styles.etSection}>
      <span className={styles.etSectionTitle}>{title}</span>
      {meta && (
        <span className={styles.etSectionMeta}>
          <span className={styles.etSectionMetaK}>{meta.label}</span>
          <span className={styles.etSectionMetaV}>{meta.value}</span>
        </span>
      )}
      {note && <span className={styles.etSectionNote}>{note}</span>}
    </div>
  )
}

/** A label/value list — the same grammar as Earnings Quality. */
function Facts({ rows }) {
  if (!rows.length) return null
  return (
    <div className={styles.etQuality}>
      {rows.map(f => (
        <div key={f.key} className={styles.etQRow} title={f.hint || undefined}>
          <span className={styles.etQKey}>{f.label}</span>
          <span className={`${styles.etQVal} ${TONE[f.tone] || ''}`}>{f.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── holders ─────────────────────────────────────────────────────────────────
function HolderRow({ row, hasChange, open, onToggle }) {
  const state = row.state ? HOLDER_STATE[row.state] : null
  return (
    <>
      <div className={`${styles.owRow}${open ? ' ' + styles.etRowOpen : ''}`}
        onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
        <span className={styles.owName} title={row.name}>{row.name}</span>
        <span className={styles.owShares}>{fmtShares(row.shares)}</span>
        {hasChange && (
          <span className={`${styles.owChange} ${TONE[state?.tone] || styles.muted}`}>
            {state ? state.text : '—'}
          </span>
        )}
      </div>
      {open && (
        <div className={styles.owDetail}>
          <div className={styles.etFacts}>
            {row.value != null && (
              <span className={styles.etFact}>
                <span className={styles.etFactK}>Value</span>
                <span className={styles.etFactV}>{fmtMoney(row.value)}</span>
              </span>
            )}
            {row.ownership != null && (
              <span className={styles.etFact}>
                <span className={styles.etFactK}>% of company</span>
                <span className={styles.etFactV}>{fmtPct(row.ownership, 2)}</span>
              </span>
            )}
            {row.changeShares != null && (
              <span className={styles.etFact}>
                <span className={styles.etFactK}>Share change</span>
                <span className={`${styles.etFactV} ${row.changeShares > 0 ? styles.pos : row.changeShares < 0 ? styles.neg : ''}`}>
                  {row.changeShares > 0 ? '+' : ''}{fmtShares(row.changeShares)}
                </span>
              </span>
            )}
            {row.date && (
              <span className={styles.etFact}>
                <span className={styles.etFactK}>Reported</span>
                <span className={styles.etFactV}>{fmtDate(row.date)}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── insiders ────────────────────────────────────────────────────────────────
function InsiderTable({ rows }) {
  return (
    <>
      <div className={styles.owInsHead}>
        <span>Date</span>
        <span>Insider</span>
        <span className={styles.owR}>Shares</span>
        <span className={styles.owR}>Value</span>
      </div>
      {rows.map(t => (
        <div key={t.key} className={styles.owInsRow} title={t.title || undefined}>
          <span className={styles.owInsDate}>{fmtDateShort(t.date) || '—'}</span>
          <span className={styles.owInsName}>
            {/* Wrapped, not bare: as a text node it never matched the name rule
                and inherited the panel's 12px body size while the ROLE picked
                up the 11px meant for the name. Caught on screen. */}
            <span className={styles.owInsWho}>{t.name}</span>
            {t.title && <span className={styles.owInsRole}>{t.title}</span>}
          </span>
          <span className={`${styles.owInsShares} ${t.type === 'buy' ? styles.pos : styles.neg}`}>
            {t.type === 'buy' ? '+' : '−'}{fmtShares(t.shares)}
          </span>
          <span className={styles.owInsVal}>{fmtMoney(t.amount)}</span>
        </div>
      ))}
    </>
  )
}

// ── panel ───────────────────────────────────────────────────────────────────
export default function DockOwnership({ sym }) {
  const [openHolder, setOpenHolder] = useState(null)
  const [allHolders, setAllHolders] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)

  const { data: own, isLoading } = useMobileSWR(
    sym ? `/api/research/ownership/${encodeURIComponent(sym)}` : null, jsonFetcher,
    { refreshInterval: 0, dedupingInterval: 600000, revalidateOnFocus: false })
  const { data: full } = useMobileSWR(
    sym ? `/api/fundamentals-full/${encodeURIComponent(sym)}` : null, jsonFetcher,
    { refreshInterval: 0, dedupingInterval: 300000, revalidateOnFocus: false })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenHolder(null); setAllHolders(false); setMethodOpen(false)
  }, [sym])

  const snapshot = useMemo(() => snapshotFacts(own, full), [own, full])
  const flow = useMemo(() => institutionalFlow(own), [own])
  const holders = useMemo(() => topHolders(own), [own])
  const insider = useMemo(() => insiderActivity(own?.insider), [own])
  const positioning = useMemo(() => positioningFacts(own), [own])

  const toggleHolder = useCallback((k) => setOpenHolder(p => (p === k ? null : k)), [])

  if (!sym) return <div className={styles.emptyState}>No symbol.</div>

  const nothing = !isLoading && !snapshot.length && !flow && !holders && !insider && !positioning.length
  const visibleHolders = holders
    ? (allHolders ? holders.rows : holders.rows.slice(0, HOLDERS_DEFAULT))
    : []
  const hiddenHolders = holders ? holders.rows.length - visibleHolders.length : 0

  return (
    <div className={styles.own}>
      <div className={styles.etBody}>
        {isLoading && !own ? (
          <div className={styles.finSkeleton} aria-label="Loading ownership">
            {Array.from({ length: 10 }).map((_, i) => <div key={i} className={styles.finSkelRow} />)}
          </div>
        ) : nothing ? (
          <div className={styles.emptyState}>
            Ownership data is not available for {sym}. Funds and non-US listings
            do not file the US ownership reports this tab is built on.
          </div>
        ) : (
          <>
            {/* How much of the company is spoken for — one line, no cards. */}
            {snapshot.length > 0 && (
              <div className={styles.owStrip}>
                {snapshot.map(f => (
                  <span key={f.key} className={styles.owStripItem}>
                    <span className={styles.owStripK}>{f.label}</span>
                    <span className={`${styles.owStripV}${f.accent ? ' ' + styles.etGold : ''}`}>{f.value}</span>
                  </span>
                ))}
              </div>
            )}

            {/* HOW ownership is changing. Counts of FILINGS, never of trades. */}
            {flow && (
              <>
                <SectionHead
                  title="Institutional activity"
                  meta={flow.quarterLabel ? { label: 'Reported', value: flow.quarterLabel } : null}
                  note={`Positions as reported in Form 13F for the quarter ended ${fmtDate(quarterEnd(flow.quarter)) || flow.quarterLabel}. Filers have up to 45 days after the quarter closes, so this is a snapshot of that date, not of today.`}
                />
                <div className={styles.etQuality}>
                  {flow.rows.map(r => (
                    <div key={r.key} className={styles.etQRow}>
                      <span className={styles.etQKey}>{r.label}</span>
                      <span className={styles.etQVal}>
                        {r.value}
                        {r.delta != null && r.delta !== 0 && (
                          <span className={`${styles.owDelta} ${r.delta > 0 ? styles.pos : styles.neg}`}>
                            {r.deltaFmt(r.delta)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {flow.flow.length > 0 && (
                  <div className={styles.owFlow}>
                    {flow.flow.map(f => (
                      <span key={f.key} className={styles.owFlowItem}>
                        <span className={`${styles.owFlowN} ${TONE[f.tone]}`}>{f.value}</span>
                        <span className={styles.owFlowK}>{f.label}</span>
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* WHO holds it. */}
            {holders && (
              <>
                <SectionHead
                  title="Top holders"
                  meta={holders.quarterLabel ? { label: 'As of', value: holders.quarterLabel } : null}
                  note={holders.hasChange ? null
                    : 'Latest reported holdings. This source does not carry the change against the prior filing, so no change is shown rather than an assumed one.'}
                />
                <div className={`${styles.owHead}${holders.hasChange ? '' : ' ' + styles.owHead2}`}>
                  <span>Holder</span>
                  <span className={styles.owR}>Shares</span>
                  {holders.hasChange && <span className={styles.owR}>Position</span>}
                </div>
                <div className={holders.hasChange ? styles.owTable : `${styles.owTable} ${styles.owTable2}`}>
                  {visibleHolders.map(h => (
                    <HolderRow key={h.key} row={h} hasChange={holders.hasChange}
                      open={openHolder === h.key} onToggle={() => toggleHolder(h.key)} />
                  ))}
                </div>
                {(hiddenHolders > 0 || allHolders) && (
                  <button type="button" className={styles.etMore}
                    onClick={() => { setAllHolders(v => !v); setOpenHolder(null) }}>
                    {allHolders ? 'Show less' : `Show ${hiddenHolders} more`}
                  </button>
                )}
              </>
            )}

            {/* What management did with their OWN money. */}
            {insider && (
              <>
                <SectionHead
                  title="Insider activity"
                  meta={insider.hasRecent
                    ? { label: `Last ${insider.days}d`, value: `${insider.buyCount} buy · ${insider.sellCount} sell` }
                    : null}
                  note="Open-market purchases and sales only. Grants, awards, option exercises and gifts are excluded — they are compensation events, not decisions to buy or sell at the market price."
                />
                {insider.hasRecent ? (
                  <div className={styles.etQuality}>
                    <div className={styles.etQRow}>
                      <span className={styles.etQKey}>Net value, last {insider.days} days</span>
                      <span className={`${styles.etQVal} ${insider.net > 0 ? styles.pos : insider.net < 0 ? styles.neg : ''}`}>
                        {insider.net > 0 ? '+' : ''}{fmtMoney(insider.net)}
                      </span>
                    </div>
                    {insider.buyers > 1 && (
                      <div className={styles.etQRow}
                        title="Distinct insiders, not transactions — several people buying is a different fact from one person buying several times.">
                        <span className={styles.etQKey}>Insiders buying</span>
                        <span className={`${styles.etQVal} ${styles.pos}`}>{insider.buyers}</span>
                      </div>
                    )}
                    {insider.sellers > 1 && (
                      <div className={styles.etQRow}>
                        <span className={styles.etQKey}>Insiders selling</span>
                        <span className={`${styles.etQVal} ${styles.neg}`}>{insider.sellers}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className={styles.etNote}>
                    No open-market insider transactions in the last {insider.days} days.
                    The most recent filings are below.
                  </p>
                )}
                {insider.transactions.length > 0 && <InsiderTable rows={insider.transactions} />}
              </>
            )}

            {/* Supply. */}
            {positioning.length > 0 && (
              <>
                <SectionHead title="Positioning" />
                <Facts rows={positioning} />
              </>
            )}

            <button type="button" className={styles.finMethodBtn} onClick={() => setMethodOpen(o => !o)}>
              {methodOpen ? 'Hide data & methodology' : 'Data & methodology'}
            </button>
            {methodOpen && (
              <div className={styles.finMethod}>
                <div className={styles.finProvGrid}>
                  <span className={styles.finProvK}>Institutional</span>
                  <span className={styles.finProvV}>
                    Form 13F via FMP{flow?.quarterLabel ? ` — ${flow.quarterLabel}` : ''}. Managers with
                    over $100M in US equities file quarterly, up to 45 days after the quarter ends.
                  </span>
                  <span className={styles.finProvK}>Holders</span>
                  <span className={styles.finProvV}>
                    {holders?.source === '13f'
                      ? '13F holder detail, including the change against the same filer’s prior filing.'
                      : 'Yahoo Finance institutional holders — latest reported holdings, no prior-period comparison.'}
                  </span>
                  <span className={styles.finProvK}>Insider</span>
                  <span className={styles.finProvV}>
                    SEC Form 4 via FMP, Finnhub as fallback. Filed within two business days of the
                    transaction. Only open-market purchases and sales are included.
                  </span>
                  <span className={styles.finProvK}>Short interest</span>
                  <span className={styles.finProvV}>
                    FINRA via Yahoo Finance, reported twice a month on a settlement-date basis.
                  </span>
                  <span className={styles.finProvK}>Float</span>
                  <span className={styles.finProvV}>
                    FMP shares-float, reconciled against Yahoo Finance.
                  </span>
                </div>
                <p className={styles.finMethodP}>
                  <b>Nothing here is live.</b> Institutional holdings describe one date up to
                  four and a half months in the past, insider filings lag by days, and short
                  interest by up to two weeks. A position may have changed since.
                </p>
                <p className={styles.finMethodP}>
                  <b>New · Increased · Reduced · Exited</b> compare a filer&apos;s latest 13F with its
                  previous one. They describe what two filings say, not when or at what price
                  anything traded.
                </p>
                <p className={styles.finMethodP}>
                  ETF ownership is not shown: the data we hold answers what an ETF contains, not
                  which ETFs contain a given stock, and the reverse is not derivable without a
                  source we do not have.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
