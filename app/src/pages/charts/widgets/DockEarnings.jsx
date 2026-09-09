/**
 * DockEarnings — the Earnings tab of the Company Intelligence panel.
 *
 * A TRUE financial table, and the sibling of Financials rather than a separate
 * mini-app: one persistent header, one grid geometry shared by the header and
 * every row, one row per period.
 *
 *   PERIOD    EPS    EPS YOY    SALES    SALES YOY
 *
 * WHY A TABLE (what the previous version got wrong)
 * Each quarter used to be a small stacked block that re-emitted its own EPS and
 * REV labels inside a private grid. Those two tokens appeared 24 times down a
 * 12-quarter list, carrying no information after the first pair — and because
 * the grid's column count was chosen per row, from the panel width AND from
 * whether the row was an estimate, forward rows dropped three children into a
 * five-column grid and did not line up with the reported ones at all. Column
 * geometry now lives in ONE CSS custom property (`--et-cols`) that the header
 * and every row consume, so that class of misalignment is structurally
 * impossible rather than merely fixed.
 *
 * ONE TIMELINE, reverse-chronological: the furthest estimate at the top, reading
 * down through the present into history. Estimates are IMPORTANT, not disabled —
 * same geometry, same value brightness, distinguished by a section head and a
 * restrained EST mark, because a forward consensus is real information.
 *
 * RESPONSIVE without React width state: both period forms are rendered and the
 * container query picks one, so nothing re-renders on a drag frame.
 *
 * DATA — one normalized model, ungated (see api/services/earnings_intel.py):
 *   /api/earnings-intel/{sym}     quarters · estimates · annual · summary
 *   /api/filings/{sym}/primary    documents, lazily, only on row expansion
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  buildRows, hiddenCount, qualityFacts, expansionModel, shortLabel,
} from './earningsRows'
import Spark from './Spark'
import EarningsReaction from './EarningsReaction'
import styles from './dockPanels.module.css'

const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

const MODES = [
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'annual', label: 'Annual' },
]
const DEFAULT_LIMIT = 8      // two years of quarters — the trend read
const DEEP_LIMIT = 12        // as far as the model reaches

const TONE = { gold: styles.etGold, up: styles.pos, down: styles.neg, none: styles.muted }

// ── cells ───────────────────────────────────────────────────────────────────
function Growth({ cell, projected }) {
  if (!cell) return <span className={`${styles.etGrowth} ${styles.etEmpty}`}>—</span>
  return (
    <span
      className={`${styles.etGrowth} ${TONE[cell.tone] || ''}${cell.semantic ? ' ' + styles.etSemantic : ''}`}
      title={projected
        ? 'Compares one consensus estimate with another — there is no reported figure underneath this growth rate.'
        : undefined}
    >
      {cell.text}
    </span>
  )
}

function Row({ row, open, onToggle, sym }) {
  const expandable = row.expandable
  return (
    <>
      <div
        className={`${styles.etRow}${row.estimate ? ' ' + styles.etRowEst : ''}`
          + `${open ? ' ' + styles.etRowOpen : ''}${expandable ? '' : ' ' + styles.etRowStatic}`}
        onClick={expandable ? onToggle : undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onKeyDown={expandable ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
        } : undefined}
      >
        <span className={styles.etPeriod}>
          {/* Both forms ship; the container query shows one. Dropping the
              century ("FY26 Q3") is what buys the five columns their room
              below 340px, and it costs no JS width measurement. */}
          <span className={styles.etPeriodFull}>{row.label}</span>
          <span className={styles.etPeriodShort}>{shortLabel(row.label)}</span>
          {row.estimate && <span className={styles.etEst}>EST</span>}
        </span>
        <span className={`${styles.etVal}${row.epsNegative ? ' ' + styles.neg : ''}`}>{row.eps}</span>
        <Growth cell={row.epsGrowth} projected={row.projectedGrowth} />
        <span className={styles.etVal}>{row.sales}</span>
        <Growth cell={row.salesGrowth} projected={row.projectedGrowth} />
      </div>
      {open && <Detail q={row.source} sym={sym} />}
    </>
  )
}

// ── row expansion ───────────────────────────────────────────────────────────
function Detail({ q, sym }) {
  const model = useMemo(() => expansionModel(q), [q])
  // Filings are fetched only when a row is actually opened, so the vast majority
  // of Earnings views cost nothing extra.
  const { data: docs } = useSWR(sym ? `/api/filings/${encodeURIComponent(sym)}/primary` : null,
    jsonFetcher, { revalidateOnFocus: false, dedupingInterval: 6 * 3600000 })
  if (!model) return null
  const filings = (docs?.filings || []).filter(f => f.direct !== false)
  const release = filings.find(f => (f.form || '').startsWith('8-K'))
  const others = filings.filter(f => f !== release)

  return (
    <div className={styles.etDetail}>
      {model.groups.map(g => (
        <div key={g.key} className={styles.etCompare}>
          <span className={styles.etCompareTitle}>{g.title}</span>
          <div className={styles.etCompareBody}>
            {g.actual && (
              <span className={styles.etCompareCell}>
                <span className={styles.etCompareK}>Actual</span>
                <span className={styles.etCompareV}>{g.actual}</span>
              </span>
            )}
            {g.estimate && (
              <span className={styles.etCompareCell}>
                <span className={styles.etCompareK}>Estimate</span>
                <span className={styles.etCompareV}>{g.estimate}</span>
              </span>
            )}
            {g.surprise && (
              <span className={`${styles.etSurprise} ${TONE[g.surprise.tone] || ''}`}>
                {g.surprise.text}
              </span>
            )}
          </div>
        </div>
      ))}

      {model.facts.length > 0 && (
        <div className={styles.etFacts}>
          {model.facts.map(f => (
            <span key={f.k} className={styles.etFact}>
              <span className={styles.etFactK}>{f.k}</span>
              <span className={styles.etFactV}>{f.v}</span>
            </span>
          ))}
        </div>
      )}

      {model.notes.map((n, i) => <p key={i} className={styles.etNote}>{n}</p>)}

      {filings.length > 0 && (
        <>
          {release && (
            <a className={styles.etPrimaryDoc} href={release.url} target="_blank" rel="noreferrer">
              Open earnings report →
            </a>
          )}
          <div className={styles.finDocs}>
            {others.map(f => (
              <a key={f.form} className={styles.finDoc} href={f.url} target="_blank" rel="noreferrer" title={f.blurb}>
                <span className={styles.finDocForm}>{f.form}</span>
                <span className={styles.finDocLabel}>{f.label}</span>
                <span className={styles.finDocDate}>{f.filed || ''}</span>
              </a>
            ))}
          </div>
          {/* Honest about what these links are: we resolve a company's most
              recent filing of each type, not the document for THIS quarter.
              Mapping accession → fiscal period is a real piece of work and
              claiming it before it exists would be the wrong kind of trust. */}
          <p className={styles.etNote}>
            The company&apos;s most recent filing of each type — not yet mapped to this specific quarter.
          </p>
        </>
      )}
    </div>
  )
}

/* A section head, optionally carrying an annotation on the right (the next
   report date beside ESTIMATES) and a caveat beneath (estimate-over-estimate
   growth). The annotation is data, so it is deliberately NOT gold — the gold
   belongs to the heading, and two golds on one line would compete. */
function SectionHead({ row }) {
  return (
    <div className={styles.etSection}>
      <span className={styles.etSectionTitle}>{row.title}</span>
      {row.meta && (
        <span className={styles.etSectionMeta}>
          <span className={styles.etSectionMetaK}>{row.meta.label}</span>
          <span className={styles.etSectionMetaV}>{row.meta.value}</span>
        </span>
      )}
      {row.note && <span className={styles.etSectionNote}>{row.note}</span>}
    </div>
  )
}

/* Earnings Quality — a label/value list, not a card grid. Two columns where
   there is room, one where there is not; the container query does the switch. */
function Quality({ facts }) {
  if (!facts.length) return null
  return (
    <>
      {/* Same head component as the table's sections — a bare text child would
          miss .etSectionTitle and render at body size, which is exactly what it
          did until this was caught on screen. */}
      <SectionHead row={{ title: 'Earnings quality' }} />
      <div className={styles.etQuality}>
        {facts.map(f => (
          <div key={f.key} className={styles.etQRow} title={f.hint || undefined}>
            <span className={styles.etQKey}>{f.label}</span>
            {f.series && (
              <span className={styles.etQSpark}>
                <Spark series={f.series} width={38} height={13} />
              </span>
            )}
            <span className={`${styles.etQVal} ${TONE[f.tone] || ''}`}>
              {f.value}
              {f.arrow && <span className={styles.etQArrow}>{f.arrow}</span>}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

// ── panel ───────────────────────────────────────────────────────────────────
export default function DockEarnings({ sym }) {
  const [mode, setMode] = useState('quarterly')
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [openKey, setOpenKey] = useState(null)
  const [methodOpen, setMethodOpen] = useState(false)
  const bodyRef = useRef(null)
  const moreRef = useRef(null)

  const { data: intel, isLoading } = useSWR(
    sym ? `/api/earnings-intel/${encodeURIComponent(sym)}` : null,
    jsonFetcher, { revalidateOnFocus: false, dedupingInterval: 300000 })

  // A symbol change arrives from OUTSIDE this component (the chart), so it has
  // no handler to hang the reset on — the legitimate effect case.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenKey(null); setLimit(DEFAULT_LIMIT); setMethodOpen(false)
  }, [sym])

  const selectMode = useCallback((key) => {
    setMode(key)
    setOpenKey(null)
    setLimit(DEFAULT_LIMIT)
  }, [])

  const rows = useMemo(() => buildRows(intel, mode, limit), [intel, mode, limit])
  // Every fact in Earnings Quality is derived from QUARTERS — an acceleration
  // run, a beat rate, a margin against the year-ago quarter. Rendering
  // "2 quarters" under a table of fiscal years asks the reader to change unit
  // mid-page, so the block belongs to the quarterly view only.
  const quality = useMemo(
    () => (mode === 'quarterly' ? qualityFacts(intel) : []), [intel, mode])
  const hidden = hiddenCount(intel, mode, limit)
  const expanded = limit > DEFAULT_LIMIT

  /* Deeper history is a TOGGLE, not a one-way door. Collapsing also has to tidy
     up after itself: a quarter opened among the extra four would otherwise stay
     open invisibly, and four rows vanishing under the reader's scroll position
     is a jump we can simply cancel out. */
  const toggleHistory = useCallback(() => {
    const body = bodyRef.current
    const before = moreRef.current && body
      ? moreRef.current.getBoundingClientRect().top - body.getBoundingClientRect().top
      : null
    setLimit(prev => {
      const next = prev > DEFAULT_LIMIT ? DEFAULT_LIMIT : DEEP_LIMIT
      if (next < prev) {
        const kept = new Set(buildRows(intel, mode, next)
          .filter(r => r.kind === 'row').map(r => r.key))
        setOpenKey(k => (k && kept.has(k) ? k : null))
      }
      return next
    })
    if (before != null) {
      requestAnimationFrame(() => {
        const after = moreRef.current && bodyRef.current
          ? moreRef.current.getBoundingClientRect().top - bodyRef.current.getBoundingClientRect().top
          : null
        if (after != null) bodyRef.current.scrollTop += after - before
      })
    }
  }, [intel, mode])
  const meta = intel?.meta || {}
  const cal = meta.fiscal_calendar || {}

  if (!sym) return <div className={styles.emptyState}>No symbol.</div>

  const empty = !isLoading && rows.length === 0

  return (
    <div className={styles.earn}>
      {/* MODE is the only control — Quarterly and Annual are two resolutions of
          one document, so they get the understated text tabs Financials uses
          for its statements. */}
      <div className={styles.finBar}>
        <div className={styles.finSeg}>
          {MODES.map(m => (
            <button key={m.key} type="button"
              className={`${styles.finSegBtn}${mode === m.key ? ' ' + styles.finSegOn : ''}`}
              onClick={() => selectMode(m.key)}>{m.label}</button>
          ))}
        </div>
      </div>

      <div className={styles.etTable}>
        <div className={styles.etHead}>
          <span>{mode === 'annual' ? 'Year' : 'Period'}</span>
          <span className={styles.etHeadR}>EPS</span>
          {/* At the narrowest width the metric prefix would wrap the header onto
              a second line and stop it lining up with its own column. The
              adjacent EPS / Sales column makes the prefix redundant there, so
              the container query drops it — same two-form trick as the period. */}
          <span className={styles.etHeadR} title="Change against the same fiscal period one year earlier.">
            <span className={styles.etHeadFull}>EPS YoY</span>
            <span className={styles.etHeadShort}>YoY</span>
          </span>
          <span className={styles.etHeadR}>Sales</span>
          <span className={styles.etHeadR} title="Change against the same fiscal period one year earlier.">
            <span className={styles.etHeadFull}>Sales YoY</span>
            <span className={styles.etHeadShort}>YoY</span>
          </span>
        </div>

        <div className={styles.etBody} ref={bodyRef}>
          {isLoading && !intel ? (
            <div className={styles.finSkeleton} aria-label="Loading earnings">
              {Array.from({ length: 10 }).map((_, i) => <div key={i} className={styles.finSkelRow} />)}
            </div>
          ) : empty ? (
            <div className={styles.emptyState}>
              {cal.known === false
                ? <>No earnings history is available for {sym}. If this is a fund or a
                    non-US listing, it does not publish company earnings.</>
                : <>No earnings history is available for {sym}.</>}
            </div>
          ) : (
            <>
              {rows.map(r => (
                r.kind === 'section'
                  ? <SectionHead key={r.key} row={r} />
                  : <Row key={r.key} row={r} sym={sym}
                      open={openKey === r.key}
                      onToggle={() => setOpenKey(openKey === r.key ? null : r.key)} />
              ))}

              {(hidden > 0 || expanded) && (
                <button type="button" className={styles.etMore} ref={moreRef}
                  onClick={toggleHistory}>
                  {expanded ? 'Show less' : `Show ${Math.min(hidden, DEEP_LIMIT - DEFAULT_LIMIT)} more`}
                </button>
              )}

              {/* PROTOTYPE: results, then how the market answered, then the
                  quality of the run. Reaction sits BEFORE Quality because it
                  belongs to the events in the table above it. */}
              {mode === 'quarterly' && <EarningsReaction reaction={intel?.reaction} />}

              <Quality facts={quality} />

              <button type="button" className={styles.finMethodBtn} onClick={() => setMethodOpen(o => !o)}>
                {methodOpen ? 'Hide data & methodology' : 'Data & methodology'}
              </button>
              {methodOpen && (
                <div className={styles.finMethod}>
                  <div className={styles.finProvGrid}>
                    <span className={styles.finProvK}>Actuals</span>
                    <span className={styles.finProvV}>{meta.actuals_source || '—'}</span>
                    <span className={styles.finProvK}>EPS basis</span>
                    <span className={styles.finProvV}>{meta.eps_basis || '—'}</span>
                    <span className={styles.finProvK}>Consensus</span>
                    <span className={styles.finProvV}>
                      {meta.estimates_available
                        ? 'Available — surprise calculated where the accounting basis matches'
                        : 'Not available for this security, so no surprise is shown'}
                    </span>
                    <span className={styles.finProvK}>Fiscal calendar</span>
                    <span className={styles.finProvV}>
                      {cal.known
                        ? `Year ends ${cal.fiscal_year_end} — periods are the company's own fiscal quarters, placed on ${cal.anchors_observed} filed year-end ${cal.anchors_observed === 1 ? 'date' : 'dates'}`
                        : 'Not established for this security'}
                    </span>
                  </div>
                  {meta.fiscal_method && <p className={styles.finMethodP}>{meta.fiscal_method}</p>}
                  {meta.yoy_method && <p className={styles.finMethodP}>{meta.yoy_method}</p>}
                  {meta.surprise_method && <p className={styles.finMethodP}>{meta.surprise_method}</p>}
                  <p className={styles.finMethodP}>
                    Growth of 100% or more is shown in gold. That describes reported growth
                    only — a small year-ago base can produce it — so it is not a quality rating.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
