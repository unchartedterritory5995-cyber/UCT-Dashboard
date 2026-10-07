// MOST — today's movers in the terminal (feature-gaps-2026-10-06 #7).
//
//   MOST            every mover: the gappers list, the catalyst board, the volume scanner
//   MOST UP         gainers          MOST DOWN   losers
//   MOST RVOL       unusual volume — names the Volume Surge scanner has lit right now
//
// ⭐ NO NEW ROUTE AND NO NEW VENDOR CALL. Three routes the app already serves from caches
// (`/api/movers` — the Movers sidebar's list; `/api/catalysts/today` — the catalyst board;
// `/api/volume-scan/live` — the in-memory Volume Surge accumulator) plus the shared live-price
// store, which polls the union of every panel's names once every 2 s.
//
// Clicking a row LOADS that name into the linked group and keeps every panel's function (the
// shell's Shift+Enter path), so a chart and a news panel following the group switch to it. Typing
// the row number + Enter does the same. The list itself never changes function.
//
// ⛔ THE SESSION IS SAID. Outside the regular session the badge reads Pre-market, After hours or
// Last session — never Live — and the panel says what the % column is measured against.
import { Fragment, useEffect, useMemo, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import useLivePrices from '../../../hooks/useLivePrices'
import useMarketOpen from '../../../hooks/useMarketOpen'
import jsonFetcher from '../../../utils/jsonFetcher'
import Select from '../../../components/ui/Select'
import HighlightThesis, { isFailedSynthesis } from '../../../utils/highlightThesis'
import { sessionModel } from '../../../components/dashboard/sessionModel'
import { BoardFromList, PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import {
  formatCompactTerminal, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor } from '../../../lib/presentation/dataGrid'
import {
  CATALYSTS_URL, LENSES, MAX_ROWS, MOVERS_URL, POLL_MS, PRICE_FLOORS, SESSION_COPY, VOLUME_FLOORS, VOLUME_URL,
  buildRows, defaultSort, filterRows, firstDirFor, liveSymbols, sessionOf, sortRows,
} from './moversModel'
import styles from './moversPanel.module.css'

const SWR_OPTS = { refreshInterval: POLL_MS, marketHoursOnly: true, keepPreviousData: true }
/** The movers read, stamped with when it landed (the panel header's "as of"). */
const stamped = (url) => jsonFetcher(url).then((d) => ({ ...d, receivedAt: new Date().toISOString() }))

/** Pure: what a failed read means to a member — a paywall is not an outage. */
function failureText(err, what) {
  if (err?.status === 402) return `${what} needs a paid plan.`
  if (err?.timedOut) return `${what} did not answer within 30 seconds.`
  return `${what} could not be read just now.`
}

const COLUMNS = [
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to load it into the linked panels' },
  { key: 'last', label: 'Last' },
  { key: 'pct', label: '% Chg' },
  { key: 'ah', label: 'After hours', postOnly: true, title: 'Move since the 4:00 PM close' },
  { key: 'volume', label: 'Volume', title: 'Shares traded today (pre and post market included outside the regular session)' },
  { key: 'volVsAvg', label: 'Vol × avg', title: 'Today\'s volume against normal: the Volume Surge scanner\'s "so far vs usual by now" where it tracks the name, else the catalyst board\'s "today vs 30-day average"' },
]

const VOL_SOURCE_TEXT = {
  scanner: 'Volume so far today ÷ the usual volume by this time of day (Volume Surge scanner)',
  catalyst: 'Today\'s volume ÷ the 30-day average (catalyst board)',
}

export default function MoversPanel({ lens: lensProp = null, onRun, onRows }) {
  const inPanel = useInTerminalPanel()
  const market = useMarketOpen()
  const session = sessionOf(market)
  const copy = SESSION_COPY[session]

  const movers = useMobileSWR(MOVERS_URL, stamped, SWR_OPTS)
  const catalysts = useMobileSWR(CATALYSTS_URL, jsonFetcher, { ...SWR_OPTS, refreshInterval: POLL_MS * 2 })
  const volume = useMobileSWR(VOLUME_URL, jsonFetcher, SWR_OPTS)

  const syms = useMemo(() => liveSymbols({ movers: movers.data, catalysts: catalysts.data, volume: volume.data }),
    [movers.data, catalysts.data, volume.data])
  const { prices } = useLivePrices(syms)

  // A new `MOST <lens>` remounts the panel (the shell keys the body on code + args), so the
  // typed lens only ever seeds the state.
  const [lens, setLens] = useState(lensProp || 'all')
  const [sort, setSort] = useState(() => defaultSort(lensProp || 'all'))
  const [minPrice, setMinPrice] = useState(0)
  const [minVolume, setMinVolume] = useState(0)
  const [open, setOpen] = useState(null)   // the symbol whose "why" is expanded

  const all = useMemo(() => buildRows({
    movers: movers.data, catalysts: catalysts.data, volume: volume.data, prices, session,
  }), [movers.data, catalysts.data, volume.data, prices, session])
  const rows = useMemo(
    () => sortRows(filterRows(all, { lens, minPrice, minVolume }), sort).slice(0, MAX_ROWS),
    [all, lens, minPrice, minVolume, sort],
  )
  const cmds = useMemo(() => rows.map((r) => `$${r.sym}`), [rows])
  const rowSyms = useMemo(() => rows.map((r) => r.sym), [rows])
  useEffect(() => { onRows?.(cmds) }, [onRows, cmds])

  // When did the list last land? Reported up to the panel header with the session it belongs to.
  const asOf = movers.data?.receivedAt || null
  usePanelFreshness(asOf
    ? { freshnessClass: session === 'closed' ? 'end_of_day' : 'real_time', asOf, sessionState: sessionModel(market) }
    : null)

  const pickLens = (next) => { setLens(next); setSort(defaultSort(next)); setOpen(null) }
  const toggleSort = (key) => setSort((s) => nextSort(s, key, firstDirFor))
  const load = (sym) => onRun?.(`$${sym}`, { keepFunction: true })

  if (!movers.data && !movers.error) {
    return <PanelSkeleton label="Loading today's movers" testId="terminal-movers-loading" />
  }
  if (!movers.data && movers.error) {
    return (
      <PanelState kind={movers.error?.status === 402 ? 'locked' : 'error'} testId="terminal-movers-error"
        title={failureText(movers.error, 'The movers list')}
        action={movers.error?.status === 402 ? null
          : <button type="button" className={styles.chip} onClick={() => movers.mutate()}>Retry</button>}>
        {movers.error?.status === 402 ? null : 'That is not the same as a quiet tape. Retry, or run MOST again.'}
      </PanelState>
    )
  }

  const volFailed = !volume.data && volume.error
  const volIdle = volume.data && volume.data.active === false
  const columns = COLUMNS.filter((c) => !c.postOnly || session === 'post')
  const notes = []
  if (!catalysts.data && catalysts.error) notes.push(`${failureText(catalysts.error, 'The catalyst board')} Rows show no "why" until it answers.`)
  if (volFailed) notes.push(`${failureText(volume.error, 'The volume scanner')} Vol × avg falls back to the catalyst board's figure.`)
  if (volIdle) notes.push('The volume scanner is not running right now, so nothing is lit for unusual volume.')

  const aside = (r) => [
    r.lists.includes('movers') ? 'gapper' : null,
    r.lists.includes('volume') ? 'volume' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-movers" data-session={session}>
      <div className={styles.head}>
        <span className={`${styles.badge} ${styles[`badge_${session}`]}`} data-testid="terminal-movers-session">{copy.badge}</span>
        <span className={styles.lede}>{copy.title}: {copy.basis}</span>
      </div>

      <div className={styles.toolbar} role="toolbar" aria-label="Movers filters">
        <div className={styles.group} role="group" aria-label="Lens">
          {Object.entries(LENSES).map(([key, label]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={lens === key}
              onClick={() => pickLens(key)} data-testid={`terminal-movers-lens-${key}`}>{label}</button>
          ))}
        </div>
        <label className={styles.filter}>
          Min price
          <Select value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value))} data-testid="terminal-movers-min-price"
            options={PRICE_FLOORS.map((v) => ({ value: v, label: v ? `$${v}` : 'Any' }))} />
        </label>
        <label className={styles.filter}>
          Min volume
          <Select value={minVolume} onChange={(e) => setMinVolume(Number(e.target.value))} data-testid="terminal-movers-min-volume"
            options={VOLUME_FLOORS.map((v) => ({ value: v, label: v ? formatCompactTerminal(v) : 'Any' }))} />
        </label>
        {/* Scan-to-board: these rows, as filtered and sorted, as a board of panels (the shell pages
            a list longer than a board). Renders nothing outside the terminal. */}
        <BoardFromList syms={rowSyms} label={`MOST ${LENSES[lens].toLowerCase()}`} testId="terminal-movers-board" />
      </div>

      {notes.map((n) => <p key={n} className={styles.note} role="status">{n}</p>)}

      {rows.length === 0 ? (
        <PanelState kind="empty" compact testId="terminal-movers-empty"
          title={all.length ? `No ${LENSES[lens].toLowerCase()} pass these filters.` : 'Nothing is on the movers list right now.'}>
          {all.length
            ? `${all.length} name${all.length === 1 ? '' : 's'} on the tape in all; loosen the filters or pick another lens.`
            : session === 'regular'
              ? 'No name is gapping 3% or more and the scanner has nothing lit.'
              : `${copy.title}: the list fills as names start to move.`}
        </PanelState>
      ) : (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-movers-table" aria-label={`${LENSES[lens]}, sortable`}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}>
                    <button type="button" className={styles.sortBtn} onClick={() => toggleSort(c.key)}
                      data-testid={`terminal-movers-sort-${c.key}`}>
                      {c.label}
                      {/* The caret is decoration: the <th>'s aria-sort already says which way. */}
                      {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                    </button>
                  </th>
                ))}
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const tone = r.pct > 0 ? styles.up : r.pct < 0 ? styles.down : undefined
                const why = r.catalyst && (r.catalyst.label || (r.catalyst.thesis && !isFailedSynthesis(r.catalyst.thesis)))
                return (
                  <Fragment key={r.sym}>
                  <tr data-testid={`terminal-movers-row-${r.sym}`} className={open === r.sym ? styles.rowOpen : undefined}>
                    <td>
                      <button type="button" className={styles.rowBtn} onClick={() => load(r.sym)}
                        title={`Load ${r.sym} into the linked panels`}>
                        <span className={styles.rowNum}>{i + 1}</span>
                        <span className={styles.sym}>{r.sym}</span>
                        {aside(r) ? <span className={styles.muted}> {aside(r)}</span> : null}
                      </button>
                    </td>
                    <td>{formatNumber(r.last, { decimals: 2 })}</td>
                    <td className={tone}>{formatPercent(r.pct, { decimals: 2, signed: true })}</td>
                    {session === 'post' && (
                      <td className={r.ah > 0 ? styles.up : r.ah < 0 ? styles.down : undefined}>
                        {formatPercent(r.ah, { decimals: 2, signed: true })}
                      </td>
                    )}
                    <td>{formatCompactTerminal(r.volume)}</td>
                    <td title={VOL_SOURCE_TEXT[r.volSource]}>
                      {r.volVsAvg != null ? `${formatNumber(r.volVsAvg, { decimals: 1 })}×` : formatNumber(null)}
                    </td>
                    <td>
                      {why ? (
                        <button type="button" className={styles.whyBtn} aria-expanded={open === r.sym}
                          onClick={() => setOpen(open === r.sym ? null : r.sym)} data-testid={`terminal-movers-why-${r.sym}`}>
                          {r.catalyst.label || 'Catalyst'}
                        </button>
                      ) : <span className={styles.muted}>{formatNumber(null)}</span>}
                    </td>
                  </tr>
                  {open === r.sym && why ? (
                    <tr className={styles.whyRow} data-testid={`terminal-movers-thesis-${r.sym}`}>
                      <td colSpan={columns.length + 1}>
                        {r.catalyst.thesis && !isFailedSynthesis(r.catalyst.thesis)
                          ? <p className={styles.thesis}><HighlightThesis text={r.catalyst.thesis} /></p>
                          : <p className={styles.thesis}>The catalyst board tagged {r.sym} as {r.catalyst.label} with no written story yet.</p>}
                        <p className={styles.muted}>
                          {r.catalyst.at ? `Catalyst broke at ${formatTimeEt(r.catalyst.at, { zoneSuffix: 'ET', absent: '—' })}. ` : ''}
                          <button type="button" className={styles.linkBtn} onClick={() => onRun?.(`${r.sym} MOVE`)}>
                            Open {r.sym} MOVE
                          </button> for the full story (it opens in this panel).
                        </p>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.muted} data-testid="terminal-movers-method">
        Sources: the movers list (names gapping 3% or more), today&apos;s catalyst board and the Volume Surge
        scanner; prices from the live feed. {all.length > rows.length ? `Showing ${rows.length} of ${all.length}. ` : ''}
        Click a row, or type its number, to load it into the linked panels.
        {asOf ? ` List as of ${formatTimeEt(asOf, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
