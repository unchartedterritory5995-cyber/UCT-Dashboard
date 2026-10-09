// app/src/pages/CatalystsHistory.jsx
//
// Read-only browser for past catalyst snapshots. Lets the user pick a
// trading date and see what catalysts the engine surfaced that day,
// with the same prose/tag/source-citation richness as the live tile.
//
// Uses GET /api/catalysts/by-date/{yyyy-mm-dd} which has been live since
// Phase 1 — historical data is already accumulating.
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import HighlightThesis, { FAILED_SYNTHESIS_NOTE, hasNoWriteup } from '../utils/highlightThesis'
import { formatET } from '../utils/timeAgo'
import PanelTicker from '../components/terminal/PanelTicker'
import UIcon from '../components/ui/UIcon'
import Input from '../components/ui/Input'
import { BoardFromList, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows } from '../components/terminal'
import { formatPercent, formatCurrency, formatNumber } from '../lib/presentation/presentationPrimitives'
import styles from './CatalystsHistory.module.css'
import { CATALYST_TAGS, keyedBy } from '../lib/taxonomy/a8Taxonomy'
import jsonFetcher from '../utils/jsonFetcher'
import { expectedLatestDailySessionET, isTradingSessionTodayET } from '../utils/marketSession'

// Throws on failure (jsonFetcher). The old `r.ok ? r.json() : { rows: [] }` rendered a failed
// read as "No catalysts recorded for this date" (quality pass 2026-10-05).
const fetcher = (url) => jsonFetcher(url)

function ymdNDaysAgo(n) {
  // ET-aware date string. Returns YYYY-MM-DD.
  const now = new Date()
  // Approximate ET offset by formatting in America/New_York
  const etStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  // etStr is "YYYY-MM-DD"; subtract n days using a Date
  const [y, m, d] = etStr.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() - n)
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`
}

// The date CATH opens on: today on a trading day, else the last session (audit 2026-10-08: on a
// weekend or a market holiday it opened on an empty day and told the member weekends may be empty).
export function defaultCatalystDate() {
  return isTradingSessionTodayET() ? ymdNDaysAgo(0) : expectedLatestDailySessionET()
}

// Shared formatter; "+" only above zero (a flat 0.00% reads unsigned), em dash when absent.
function fmtPct(v) {
  return formatPercent(v, { decimals: 2, signed: v > 0 })
}

function fmtPrice(v) {
  return formatCurrency(v)
}

// Keyed by A8's tag vocabulary (TERM-075) and checked against it at load.
const TAG_CLASS = keyedBy(CATALYST_TAGS, {
  Catalyst: styles.tagCatalyst,
  Earnings: styles.tagEarnings,
  Gapper: styles.tagGapper,
  News: styles.tagNews,
})

function TagChip({ tag }) {
  const cls = TAG_CLASS[tag] || styles.tagDefault
  return <span className={`${styles.tag} ${cls}`}>{tag || '—'}</span>
}

function parseSources(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

export default function CatalystsHistory() {
  const inPanel = useInTerminalPanel()
  const [date, setDate] = useState(defaultCatalystDate)
  const { data, error, isLoading, mutate } = useSWR(
    date ? `/api/catalysts/by-date/${date}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )
  const rows = data?.rows || []
  // TERM-019: name this page's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  usePanelFreshness(data && !error ? { source: 'UCT catalyst engine', age: { asOfDate: date } } : null)
  // Row <GO>: each catalyst row, in order, loads its name (`$SYM`); the day's names are the list
  // a "Board of" opens. A failed read publishes nothing (no list is on screen).
  const daySyms = usePanelSymbolRows(error && !data ? [] : rows.map((r) => r.ticker), `CATH ${date}`)

  // Quick-jump links
  const quickJumps = [
    { label: 'Today', d: ymdNDaysAgo(0) },
    { label: 'Yesterday', d: ymdNDaysAgo(1) },
    { label: '1 week ago', d: ymdNDaysAgo(7) },
    { label: '30 days ago', d: ymdNDaysAgo(30) },
  ]

  return (
    <div className={inPanel?.inset ? `${styles.page} ${styles.pageInPanel}` : styles.page}>
      {/* The terminal panel header already names CATH; its title + blurb step aside there. */}
      {!inPanel && <div className={styles.header}>
        <h1 className={styles.title}><UIcon name="book" size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />Catalyst History</h1>
        <p className={styles.subtitle}>
          Browse the engine's top-ranked single-stock catalysts from any past trading day.
          What was moving — and why — on a date you remember.
        </p>
      </div>}

      <div className={styles.controlsRow}>
        <label className={styles.dateLabel}>
          <span>Pick a date:</span>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={styles.dateInput}
            max={ymdNDaysAgo(0)}
          />
        </label>
        <div className={styles.quickJumps}>
          {quickJumps.map((q) => (
            <button
              key={q.label}
              type="button"
              className={`${styles.quickBtn} ${q.d === date ? styles.quickBtnActive : ''}`}
              onClick={() => setDate(q.d)}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tile}>
        <div className={styles.tileHeader}>
          <span className={styles.tileTitle}><UIcon name="patterns" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Top Catalysts · {date || 'pick a date'}</span>
          <span className={styles.tileMeta}>{rows.length} {rows.length === 1 ? 'row' : 'rows'}</span>
          <BoardFromList syms={daySyms} label={`CATH ${date}`} testId="cath-board" />
        </div>

        {!date ? (
          <div className={styles.empty}>Pick a date to see that day&rsquo;s catalysts.</div>
        ) : error && !data ? (
          <div className={styles.empty} data-testid="cath-error">
            Catalysts for {date} could not be read right now. That is a gap in what we could read,
            not a finding that the day was quiet.{' '}
            <button type="button" onClick={() => mutate()}>Retry</button>
          </div>
        ) : isLoading ? (
          <div className={styles.empty}>Loading catalysts for {date}…</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            No catalysts recorded for this date. The engine started persisting on 2026-05-25;
            earlier dates won't have data. Weekends + holidays may also be empty.
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label={`Catalysts for ${date}`}>
              <thead>
                <tr>
                  <th scope="col" className={styles.colSym}>Sym</th>
                  <th scope="col" className={styles.colPrice}>Price</th>
                  <th scope="col" className={styles.colGap}>% Change</th>
                  <th scope="col" className={styles.colVol}>Vol×</th>
                  <th scope="col" className={styles.colTag}>Tag</th>
                  <th scope="col" className={styles.colThesis}>Catalyst</th>
                  <th scope="col" className={styles.colWhen}>Catalyst Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sources = parseSources(r.thesis_sources)
                  return (
                    <tr key={r.ticker}>
                      <td className={styles.colSym}>
                        <PanelTicker sym={r.ticker}>
                          <span className={styles.ticker}>{r.ticker}</span>
                        </PanelTicker>
                      </td>
                      <td className={styles.colPrice}>{fmtPrice(r.price)}</td>
                      {/* No move (or none on file) is not painted as a gain. */}
                      <td className={`${styles.colGap} ${r.gap_pct > 0 ? styles.gain : r.gap_pct < 0 ? styles.loss : ''}`}>
                        {fmtPct(r.gap_pct)}
                      </td>
                      <td className={styles.colVol}>
                        {r.vol_x ? `${formatNumber(r.vol_x, { decimals: 2, grouping: false })}×` : '—'}
                      </td>
                      <td className={styles.colTag}><TagChip tag={r.tag} /></td>
                      <td className={styles.colThesis}>
                        {hasNoWriteup(r)
                          ? <span className={styles.noWriteup} data-testid="cath-no-writeup">{FAILED_SYNTHESIS_NOTE}</span>
                          : <HighlightThesis text={r.thesis_text} />}
                        {sources.length > 0 && (
                          <span className={styles.sourceCount} title={`${sources.length} cited sources`}>
                            · {sources.length} src
                          </span>
                        )}
                      </td>
                      <td className={styles.colWhen}>
                        {r.catalyst_at
                          ? formatET(r.catalyst_at)
                          : (r.thesis_at ? formatET(r.thesis_at) : '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.footer}>
          Historical snapshots are read-only. Informational only — not investment advice.
        </div>
      </div>
    </div>
  )
}
