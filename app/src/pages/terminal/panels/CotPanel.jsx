// COT: futures positioning, from the CFTC's weekly Commitments of Traders report. `COT`, `COT GOLD`.
//
//   COT              the board: every market the server holds, one row each, largest weekly move first
//   COT GOLD | ES | 10Y | GC      one market: each trader class's net position, the week's change,
//                                 its place in its own 3-year range, and the last eight reports
//
// Reads (all paid, all existing; nothing is written and no note is ever asked for):
//   GET /api/cot/symbols              the markets, which is also where a typed word is resolved
//   GET /api/cot/{code}?weeks=160     one market's weekly rows (the board reads each market's, at
//                                     most four at once: useCotBoard.js)
//   GET /api/cot/{code}/narratives    the newest stored note for one market, when there is one
// The pure half is cotModel.js, re-exported below.
//
// ⛔ WHAT THIS PANEL NEVER DOES
//   * It never shows a long or a short side: the stored report carries each class's NET position
//     and open interest only.
//   * It never reads as current-week data: every view names the report's own Tuesday and says the
//     figures were about three days old when published.
//   * It never asks the server to write a note. It reads the newest one already stored and labels
//     it with its own report date.
//   * It never calls a position bullish or bearish. Green and red mark the sign of a number only.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import useCotBoard from './useCotBoard'
import {
  COT_CODE, COT_RANGE_WEEKS, COT_SOURCE, COT_SYMBOLS_URL, COT_WEEKLY_LINE, COT_WHAT, boardDates, boardRow, contractsText, cotCommandArgs,
  cotMarketRead, cotNarrativeUrl, cotNote, cotRoster, cotUrl, marketList, noteParagraphs, parseCotArg, rangeText, rangeWhy, reportDay,
  resolveCotMarket, shareText, signOf, signedContracts, sortBoard,
} from './cotModel'
import styles from './marketPanels.module.css'

const signClass = (v) => (signOf(v) === 'up' ? styles.up : signOf(v) === 'down' ? styles.down : undefined)
const RANGE_TITLE = `Where this net position sits between its lowest (0) and highest (100) of the last ${COT_RANGE_WEEKS} weekly reports`
const ALL = ''

/** A net position over its week's change: "+212.4K" and, under it, "+8.2K on the week". */
function NetCell({ net, wow, testId, className }) {
  return (
    <td className={className} data-testid={testId}>
      <span className={signClass(net)}>{signedContracts(net)}</span>
      <br />
      <span className={styles.muted}>{wow == null ? 'no earlier report' : `${signedContracts(wow)} on the week`}</span>
    </td>
  )
}

function Failure({ err, what, code, retry, testId }) {
  const locked = err ? !canRetry(err) : false
  return (
    <PanelState kind={err ? failureKind(err) : 'error'} testId={testId}
      title={err ? failureText(err, what) : `${what} could not be read just now.`}
      action={locked ? null : <button type="button" className={styles.chip} onClick={retry}>Retry</button>}>
      {locked ? null : `That is not the same as no positions. Retry, or run ${code} again.`}
    </PanelState>
  )
}

// ── the board ────────────────────────────────────────────────────────────────────────────────

function Board({ roster, code, pick, picker, unknown, wrap }) {
  const [group, setGroup] = useState(ALL)
  const codes = useMemo(() => roster.markets.map((m) => m.code), [roster])
  const read = useCotBoard(codes)
  const built = useMemo(() => {
    if (read.phase !== 'ready') return { rows: [], empty: [], failed: [] }
    const rows = []
    const empty = []
    for (const m of roster.markets) {
      if (!(m.code in read.bodies)) continue
      const row = boardRow(m, read.bodies[m.code])
      if (row) rows.push(row); else empty.push(m)
    }
    return { rows: sortBoard(rows), empty, failed: roster.markets.filter((m) => read.failed.includes(m.code)) }
  }, [read, roster])
  const dates = useMemo(() => boardDates(built.rows), [built])
  usePanelFreshness(read.phase === 'ready' && dates.latest ? panelAsOf(COT_SOURCE, dates.latest, { dataClass: 'weekly' }) : null)

  if (read.phase !== 'ready') {
    return <PanelSkeleton label={`Loading positioning for ${codes.length} markets`} testId="terminal-cot-loading" />
  }
  if (!built.rows.length) {
    // every market failed: one of the errors speaks for the read (they share one gate)
    const err = built.failed.length ? read.errors[built.failed[0].code] : null
    if (err || built.failed.length) return <Failure err={err} what={COT_WHAT} code={code} retry={read.retry} testId="terminal-cot-error" />
    return wrap('none', (
      <PanelState kind="empty" role="status" testId="terminal-cot-none" title="No report is stored for any market yet.">
        The weekly report is read from the CFTC after it is published on Friday afternoon.
      </PanelState>
    ))
  }

  const inGroup = roster.groups.find((g) => g.name === group)
  const shown = inGroup ? built.rows.filter((r) => inGroup.codes.includes(r.code)) : built.rows
  return wrap('board', (
    <>
      <p className={styles.lede} data-testid="terminal-cot-asof">
        Report of {reportDay(dates.latest)}. {built.rows.length} {built.rows.length === 1 ? 'market' : 'markets'}, largest weekly move first.
      </p>
      <p className={styles.muted} data-testid="terminal-cot-weekly">{COT_WEEKLY_LINE}</p>
      {unknown ? (
        <p className={styles.note} role="status" data-testid="terminal-cot-unknown">
          No market matches &quot;{unknown}&quot;. Pick one below, or type a code or a plain word: {code} GOLD, {code} ES, {code} 10Y.
        </p>
      ) : null}
      <div className={styles.toolbar} role="toolbar" aria-label="Futures positioning controls">
        {picker}
        <div className={styles.group} role="group" aria-label="Which markets">
          <button type="button" className={styles.chip} aria-pressed={group === ALL} onClick={() => setGroup(ALL)}
            data-testid="terminal-cot-group-all">All</button>
          {roster.groups.map((g) => (
            <button key={g.name} type="button" className={styles.chip} aria-pressed={group === g.name} onClick={() => setGroup(g.name)}
              data-testid={`terminal-cot-group-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{g.label}</button>
          ))}
        </div>
      </div>
      {built.failed.length ? (
        <p className={styles.note} role="status" data-testid="terminal-cot-failed">
          Could not read {marketList(built.failed)} just now, so {built.failed.length === 1 ? 'it is' : 'they are'} not in the list.{' '}
          <button type="button" className={styles.linkBtn} onClick={read.retry} data-testid="terminal-cot-retry">Retry</button>
        </p>
      ) : null}
      {dates.behind.length ? (
        <p className={styles.note} role="status" data-testid="terminal-cot-behind">
          The newest stored report is older for {marketList(dates.behind)}: each row names its own report date.
        </p>
      ) : null}
      {built.empty.length ? (
        <p className={styles.muted} role="status" data-testid="terminal-cot-empty-markets">
          No report is stored yet for {marketList(built.empty)}.
        </p>
      ) : null}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-cot-board"
          aria-label={`Futures positioning by market, ${inGroup ? inGroup.label : 'all markets'}, largest weekly move first`}>
          <thead>
            <tr>
              <th scope="col">Market</th>
              <th scope="col" className={styles.snugWrap} title="Net position of the CFTC's non-commercial traders, in contracts, and its change on the week">Large specs, net</th>
              <th scope="col" className={`${styles.phoneHide} ${styles.snugWrap}`} title="Net position of the CFTC's commercial traders, in contracts, and its change on the week">Commercials, net</th>
              <th scope="col" className={`${styles.phoneWrap} ${styles.snugWrap}`} title="The week's change in the large speculators' net position as a share of open interest. The list is sorted by its size.">Week&apos;s move</th>
              <th scope="col" className={`${styles.phoneWrap} ${styles.snugWrap}`} title={`Large speculators. ${RANGE_TITLE}`}>3-year range</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.code} data-testid="terminal-cot-board-row" data-code={r.code}>
                <td className={styles.phoneWrap}>
                  <button type="button" className={styles.linkBtn} onClick={() => pick(r.code)}
                    aria-label={`Open ${r.name} (${r.code})`} data-testid={`terminal-cot-open-${r.code}`}>{r.name}</button>
                  <br />
                  <span className={styles.muted}>{r.code}{r.date < dates.latest ? `, report of ${reportDay(r.date)}` : ''}</span>
                </td>
                <NetCell net={r.largeSpecs.net} wow={r.largeSpecs.wow} testId="terminal-cot-board-large" className={`${styles.phoneWrap} ${styles.snugWrap}`} />
                <NetCell net={r.commercials.net} wow={r.commercials.wow} testId="terminal-cot-board-comm" className={`${styles.phoneHide} ${styles.snugWrap}`} />
                <td data-testid="terminal-cot-board-move">
                  {r.move == null ? <span className={styles.muted} title="No earlier report to measure the week against">n/a</span>
                    : <span className={signClass(r.move)}>{shareText(r.move)}</span>}
                </td>
                <td data-testid="terminal-cot-board-range" title={r.range == null ? rangeWhy(r.weeks) : RANGE_TITLE}>
                  {r.range == null ? <span className={styles.muted}>n/a</span> : rangeText(r.range)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inGroup && !shown.length ? (
        <p className={styles.muted} role="status" data-testid="terminal-cot-group-empty">No market in {inGroup.label} has a stored report.</p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-cot-method">
        Net is long contracts minus short contracts; the stored report carries each class&apos;s net and total open
        interest, not the two sides. Large specs are the CFTC&apos;s non-commercial traders, commercials its hedgers.
        The week&apos;s move is the change in the large speculators&apos; net as a share of open interest, so a large
        market and a small one can be compared. The 3-year range runs from 0 (the lowest net of the last{' '}
        {COT_RANGE_WEEKS} reports) to 100 (the highest). Futures only. Green and red mark the sign of a number only. In
        a narrow panel the commercials column is hidden; open a market to see every class.
      </p>
    </>
  ))
}

// ── one market ───────────────────────────────────────────────────────────────────────────────

function StoredNote({ market, date }) {
  const read = useMarketRead(cotNarrativeUrl(market.code))
  const note = useMemo(() => cotNote(read.body), [read.body])
  if (read.loading) return null
  if (!read.body) {
    return <p className={styles.muted} role="status" data-testid="terminal-cot-note-failed">The stored note for this market could not be read just now.</p>
  }
  if (!note) return <p className={styles.muted} data-testid="terminal-cot-note-none">No written note is stored for this market.</p>
  const older = note.reportDate && date && note.reportDate < date
  return (
    <section aria-label={`Stored note for ${market.name}`} data-testid="terminal-cot-note">
      <p className={styles.caption} data-testid="terminal-cot-note-label">
        Stored note{note.reportDate ? ` for the report of ${reportDay(note.reportDate)}` : ', report date not recorded'}, written by AI from
        that report&apos;s figures.{older ? ' It is older than the figures above.' : ''}
      </p>
      {noteParagraphs(note.text).map((p, i) => <p key={i} className={styles.muted}>{p}</p>)}
    </section>
  )
}

function Market({ market, code, picker, pick, wrap }) {
  const read = useMarketRead(cotUrl(market.code))
  const view = useMemo(() => cotMarketRead(read.body), [read.body])
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(COT_SOURCE, view.date, { dataClass: 'weekly' }) : null)
  const back = (
    <button type="button" className={styles.linkBtn} onClick={() => pick(ALL)} data-testid="terminal-cot-back">All markets</button>
  )

  if (read.loading) return <PanelSkeleton label={`Loading positioning for ${market.name}`} testId="terminal-cot-loading" />
  if (!read.body || view.state === 'failed') {
    return <Failure err={read.body ? null : read.error} what={`Positioning for ${market.name}`} code={code} retry={read.retry} testId="terminal-cot-error" />
  }
  if (view.state === 'none') {
    return wrap('market-none', (
      <>
        <div className={styles.toolbar} role="toolbar" aria-label="Futures positioning controls">{picker}{back}</div>
        <PanelState kind="empty" role="status" testId="terminal-cot-market-none" title={`No report is stored for ${market.name} (${market.code}) yet.`}>
          The weekly report is read from the CFTC after it is published on Friday afternoon.
        </PanelState>
      </>
    ))
  }
  return wrap('market', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-cot-stale-read">{failureText(read.error, COT_WHAT)} Showing the last read.</p> : null}
      <p className={styles.lede} data-testid="terminal-cot-asof">{market.name} ({market.code}). Report of {reportDay(view.date)}.</p>
      <p className={styles.muted} data-testid="terminal-cot-weekly">{COT_WEEKLY_LINE}</p>
      <div className={styles.toolbar} role="toolbar" aria-label="Futures positioning controls">{picker}{back}</div>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-cot-classes" aria-label={`${market.name}: net position of each trader class, report of ${reportDay(view.date)}`}>
          <thead>
            <tr>
              <th scope="col">Trader class</th>
              <th scope="col" title="Long contracts minus short contracts, and the change on the week">Net, contracts</th>
              <th scope="col" className={styles.phoneHide} title="The net position as a share of total open interest">Share of open interest</th>
              <th scope="col" className={styles.phoneWrap} title={RANGE_TITLE}>3-year range</th>
            </tr>
          </thead>
          <tbody>
            {view.classes.map((c) => (
              <tr key={c.key} data-testid="terminal-cot-class" data-class={c.key}>
                <th scope="row" className={styles.phoneWrap} title={`The CFTC's ${c.cftc}`}>{c.label}</th>
                <NetCell net={c.net} wow={c.wow} testId="terminal-cot-class-net" className={styles.phoneWrap} />
                <td className={styles.phoneHide} data-testid="terminal-cot-class-share">{shareText(c.pctOi)}</td>
                <td data-testid="terminal-cot-class-range" title={c.range == null ? rangeWhy(view.weeks) : RANGE_TITLE}>
                  {c.range == null ? <span className={styles.muted}>n/a</span> : `${rangeText(c.range)} of 100`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-cot-oi">
        Open interest: {contractsText(view.oi.value)} contracts
        {view.oi.wow == null ? '.' : `, ${signedContracts(view.oi.wow)} on the week.`}
        {view.rangeOk ? '' : ` ${rangeWhy(view.weeks)}`}
      </p>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-cot-history"
          aria-label={`${market.name}: net positions in the last ${view.history.length} weekly reports, newest first`}>
          <thead>
            <tr>
              <th scope="col">Report</th>
              <th scope="col">Large specs</th>
              <th scope="col">Commercials</th>
              <th scope="col" className={styles.phoneHide}>Small specs</th>
              <th scope="col" className={styles.phoneHide}>Open interest</th>
            </tr>
          </thead>
          <tbody>
            {view.history.map((h) => (
              <tr key={h.date} data-testid="terminal-cot-history-row" data-date={h.date}>
                <td>{reportDay(h.date)}</td>
                <td><span className={signClass(h.largeSpecs)}>{signedContracts(h.largeSpecs)}</span></td>
                <td><span className={signClass(h.commercials)}>{signedContracts(h.commercials)}</span></td>
                <td className={styles.phoneHide}><span className={signClass(h.smallSpecs)}>{signedContracts(h.smallSpecs)}</span></td>
                <td className={styles.phoneHide}>{contractsText(h.oi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <StoredNote market={market} date={view.date} />
      <p className={styles.muted} data-testid="terminal-cot-method">
        Net is long contracts minus short contracts; the stored report carries each class&apos;s net and total open
        interest, not the two sides. A plus is net long, a minus net short. The 3-year range runs from 0 (the lowest
        net of the last {COT_RANGE_WEEKS} reports) to 100 (the highest). Futures only. Green and red mark the sign of a
        number only. In a narrow panel the share, small speculators and open interest columns are hidden.
      </p>
    </>
  ))
}

// ── the panel ────────────────────────────────────────────────────────────────────────────────

function CotBody({ code, token }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const rosterRead = useMarketRead(COT_SYMBOLS_URL)
  const roster = useMemo(() => cotRoster(rosterRead.body), [rosterRead.body])
  // `undefined` until the member picks here; then the pick (a code, or '' for the board) wins over the typed word.
  const [picked, setPicked] = useState(undefined)
  const typed = useMemo(() => resolveCotMarket(token, roster.markets), [token, roster])
  const current = picked === undefined ? typed : roster.markets.find((m) => m.code === picked) || null
  const unknown = picked === undefined && token && !typed ? token : null

  // A market writes itself into the command (`COT GC`) where the registry takes it; outside the
  // shell it stays in this panel's own state.
  const pick = (next) => {
    setPicked(next || ALL)
    writeBack(cotCommandArgs({ market: next }))
  }
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-cot" data-state={state}
      data-market={current ? current.code : ''}>{body}</div>
  )

  if (rosterRead.loading) return <PanelSkeleton label="Loading futures positioning" testId="terminal-cot-loading" />
  if (!rosterRead.body || roster.state === 'failed') {
    return <Failure err={rosterRead.body ? null : rosterRead.error} what={COT_WHAT} code={code} retry={rosterRead.retry} testId="terminal-cot-error" />
  }
  if (roster.state === 'none') {
    return wrap('none', <PanelState kind="empty" role="status" testId="terminal-cot-none" title="The server lists no futures market." />)
  }

  const picker = (
    <label className={`${styles.muted} ${styles.pick}`}>
      Market{' '}
      <Select value={current ? current.code : ALL} onChange={(e) => pick(e.target.value)} className={styles.chip} data-testid="terminal-cot-market"
        options={[{ value: ALL, label: 'All markets (the board)' }, ...roster.markets.map((m) => ({ value: m.code, label: `${m.name} (${m.code})` }))]} />
    </label>
  )
  if (current) return <Market key={current.code} market={current} code={code} picker={picker} pick={pick} wrap={wrap} />
  return <Board roster={roster} code={code} pick={pick} picker={picker} unknown={unknown} wrap={wrap} />
}

export default function CotPanel({ market }) {
  const code = useInTerminalPanel()?.code || COT_CODE
  const token = parseCotArg(market)
  // Keyed by the command's word: `COT GOLD` typed over `COT` is a new view, never the last market under a new word.
  return <CotBody key={token || ALL} code={code} token={token} />
}
