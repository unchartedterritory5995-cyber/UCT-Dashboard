// ERNSC: earnings season by sector (2026-11-22). Which sectors are beating, by how much, and how is the market reacting?
//
//   ERNSC                   the season that holds today, every sector, EPS
//   ERNSC YEARAGO REVENUE   a season: PRIOR (PREVIOUS) | YEARAGO (LASTYEAR); a measure: EPS | REVENUE (REV, SALES)
//
// ONE paid route, GET /api/research/sector-earnings?season=[&sector=] (sectorEarningsModel.js says what it answers). The
// server rolls up the earnings results it ALREADY HOLDS (each stock's copy of the Research Earnings tab's model), by
// sector, and holds the answer. It counts ONLY the stocks it holds results for, and the header says so first.
// A sector row opens every reporter in it (each a symbol that loads the board), the biggest beats and misses first, then
// the stocks still to report and the ones whose result has not reached UCT's copy yet. One sector is open at a time.
//
// WHY A NEW CODE, NOT A VIEW OF GRPS: GRPS's views are column sets over one table of UCT's whole stock universe, built
// once each evening from stored closes and SEC filings; this is another population (only the stocks UCT holds earnings
// results for, and in a season only the ones that reported), another source re-read at most every 30 minutes, its own
// season and measure, and rows that open to their reporters. ERNS is one day's reporters; ERNSC rolls the season up.
//
// WIDTH. Five columns of two-line cells (four outside the season that holds today). In a snug panel the headers and the
// reaction words wrap (snugWrap) and the sector name gives back its floor (snugTight): 414px with every column showing
// (measured), so the table fits the bottom of the fold ladder and names no step. On a phone the year-earlier column folds
// (phoneHide) and stays in the opened sector's year-earlier line. No screen-reader-only text sits in a cell.
import { Fragment, useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  ERNSC_CODE, ERNSC_METRICS, ERNSC_SEASONS, SECTOR_EARNINGS_COMPUTING_POLL_MS, SECTOR_EARNINGS_POLL_MS, SECTOR_EARNINGS_SOURCE,
  SECTOR_EARNINGS_WHAT, STATE_WORDS, countsLine, coverageLine, ernscCommandArgs, medianWords, methodWords, moveWords,
  normErnscMetric, normErnscSeason, ofText, pctText, readSectorDetail, readSectorEarnings, reportedText, reportedWords,
  reporterLine, reporterSymbols, reporterWords, roseText, seasonLine, seasonOption, sectorDetailUrl, sectorEarningsUrl,
  sortReporters, sortSectors, stateTone, surpriseText, toneOf, triText, triWords, yearAgoLine,
} from './sectorEarningsModel'
import { shortDay } from './fundMetricsModel'
import styles from './marketPanels.module.css'
import local from './sectorEarnings.module.css'

const METRIC_OPTIONS = Object.entries(ERNSC_METRICS).map(([value, m]) => ({ value, label: m.label }))
const pollMs = (latest) => (latest?.body?.status === 'computing' ? SECTOR_EARNINGS_COMPUTING_POLL_MS : SECTOR_EARNINGS_POLL_MS)
const toneClass = (tone) => (tone === 'up' ? styles.up : tone === 'down' ? styles.down : '')
const measureOf = (f, metric) => (metric === 'revenue' ? f.revenue : f.eps)

function FigureCells({ f, metric, min, withAgo, testKey }) {
  const m = measureOf(f, metric)
  const tri = triText(m)
  const ago = f.yearAgo ? measureOf(f.yearAgo, metric) : null
  const agoTri = ago ? triText(ago) : null
  return (
    <>
      <td title={triWords(m, metric, min)} data-testid={`terminal-ernsc-beat-${testKey}`}>
        {tri === null ? <span className={styles.muted}>too few</span> : <span>{tri}</span>}
        <br />
        <span className={styles.muted}>{ofText(m.n)}</span>
      </td>
      <td title={medianWords(m, metric, min)}>
        {m.median === null ? <span className={styles.muted}>too few</span> : <span className={toneClass(toneOf(m.median))}>{pctText(m.median)}</span>}
        <br />
        <span className={styles.muted}>{ofText(m.medianN)}</span>
      </td>
      <td className={`${styles.phoneWrap} ${styles.snugWrap}`} title={moveWords(f.move, min)}>
        {f.move.median === null ? <span className={styles.muted}>too few</span> : <span className={toneClass(toneOf(f.move.median))}>{pctText(f.move.median)}</span>}
        <br />
        <span className={styles.muted}>{roseText(f.move)}</span>
      </td>
      {withAgo ? (
        <td className={styles.phoneHide} title={ago ? triWords(ago, metric, min) : 'No report in this sector is held for the same season a year earlier'}>
          {ago === null ? <span className={styles.muted}>none held</span> : agoTri === null ? <span className={styles.muted}>too few</span> : <span>{agoTri}</span>}
          <br />
          <span className={styles.muted}>{ago ? ofText(ago.n) : ''}</span>
        </td>
      ) : null}
    </>
  )
}

function DueList({ label, items, today, testId }) {
  if (!items.length) return null
  return (
    <p className={styles.muted} data-testid={testId}>
      {label}:{' '}
      {items.map((x, i) => (
        <Fragment key={x.symbol}>
          {i ? ', ' : ''}
          <span className={local.due}><PanelSymbol sym={x.symbol} className={styles.sym} />{' '}<span>{x.date ? shortDay(x.date, today || x.date) : ''}</span></span>
        </Fragment>
      ))}
    </p>
  )
}

function SectorDetail({ read, name, season, metric, id, agoLabel, min }) {
  const body = read.body
  const mine = !!body && body.asked === name && body.season === season
  const detail = mine ? readSectorDetail(body) : null
  const box = (state, children) => (
    <div className={local.detail} id={id} data-testid={`terminal-ernsc-detail-${name}`} data-state={state}>{children}</div>
  )
  if (!mine && read.error) {
    return box('error', (
      <p className={styles.muted} data-testid="terminal-ernsc-detail-error">
        {failureText(read.error, `The reporters in ${name}`)}{' '}
        {canRetry(read.error) ? <button type="button" className={styles.chip} onClick={read.retry}>Retry</button> : null}
      </p>
    ))
  }
  if (!mine) return box('loading', <p className={styles.muted} role="status" data-testid="terminal-ernsc-detail-loading">Loading the reporters in {name}.</p>)
  if (detail.state === 'computing') return box('computing', <p className={styles.muted} role="status">The server is reading the earnings results. This fills in on its own.</p>)
  if (detail.state === 'not_found') {
    return box('not_found', <p className={styles.muted} data-testid="terminal-ernsc-detail-gone">{name} is not in this season&apos;s answer any more. Run {ERNSC_CODE} again.</p>)
  }
  if (detail.state !== 'ok') {
    return box('error', (
      <p className={styles.muted} data-testid="terminal-ernsc-detail-error">
        The reporters in {name} could not be read just now.{' '}
        <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>
      </p>
    ))
  }
  const s = detail.sector
  const reporters = sortReporters(s.reporters, metric)
  const what = ERNSC_METRICS[metric].what
  return box('ok', (
    <>
      {reporters.length ? (
        <>
          <p className={styles.muted}>Every reporter, the biggest {what} beats and misses first.</p>
          <ul className={local.repList} aria-label={`The reporters in ${name}, the biggest ${what} beats and misses first`}>
            {reporters.map((r) => {
              const state = metric === 'revenue' ? r.revState : r.epsState
              return (
                <li key={r.symbol} className={local.repItem} title={reporterWords(r)} data-testid={`terminal-ernsc-rep-${r.symbol}`}>
                  <PanelSymbol sym={r.symbol} className={styles.sym} />{' '}
                  <span className={toneClass(stateTone(state))}>{surpriseText(r, metric) || ''}</span>{' '}
                  <span className={styles.muted}>{STATE_WORDS[state]}</span>
                  <span className={local.repLine}>{reporterLine(r, metric, detail.today)}</span>
                </li>
              )
            })}
          </ul>
        </>
      ) : <p className={styles.muted} data-testid="terminal-ernsc-detail-none">No report in {name} is held for this season yet.</p>}
      {s.yearAgo ? <p className={styles.muted} data-testid={`terminal-ernsc-ago-${name}`}>{yearAgoLine(s.yearAgo, metric, agoLabel, min)}</p> : null}
      <DueList label="To come" items={s.upcoming} today={detail.today} testId={`terminal-ernsc-upcoming-${name}`} />
      <DueList label="Pending, the result not in UCT's copy yet" items={s.late} today={detail.today} testId={`terminal-ernsc-late-${name}`} />
    </>
  ))
}

function SectorTable({ view, season, metric, open, onToggle, detailRead }) {
  const withAgo = season === 'current'
  const cols = withAgo ? 5 : 4
  const rows = sortSectors(view.sectors, metric)
  const what = ERNSC_METRICS[metric].what
  const label = `Every sector in the ${view.seasons[season]?.label || ''} season, the ${what} beat share highest first`
  const min = view.minReporters
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-ernsc-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" title="Open a sector to see every reporter">Sector</th>
            <th scope="col" className={`${styles.phoneWrap} ${styles.snugWrap}`} title={`The share that beat, met and missed the ${what} consensus, of the reporters with one`}>Beat / in line / miss</th>
            <th scope="col" className={`${styles.phoneWrap} ${styles.snugWrap}`} title={`The median ${what} surprise, of the reporters with a percent surprise`}>Median surprise</th>
            <th scope="col" className={`${styles.phoneWrap} ${styles.snugWrap}`} title="The median move from the close before the report to the close after, and the share that rose">Reaction</th>
            {withAgo ? (
              <th scope="col" className={`${styles.phoneHide} ${styles.phoneWrap} ${styles.snugWrap}`} title={`The same season a year earlier (${view.seasons.year_ago?.label || ''})`}>A year earlier</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          <tr className={local.totalRow} data-testid="terminal-ernsc-total">
            <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`} title={reportedWords(view.total)}>
              All tracked stocks
              <br />
              <span className={styles.muted}>{reportedText(view.total)}</span>
            </td>
            <FigureCells f={view.total} metric={metric} min={min} withAgo={withAgo} testKey="total" />
          </tr>
          {rows.map((s, i) => {
            const shown = open === s.name
            const detailId = `ernsc-sector-${i}`
            return (
              <Fragment key={s.name}>
                <tr data-testid={`terminal-ernsc-row-${s.name}`}>
                  <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`} title={reportedWords(s)}>
                    <button type="button" className={styles.rowBtn} aria-expanded={shown} aria-controls={shown ? detailId : undefined}
                      onClick={() => onToggle(s.name)} title={shown ? `Hide the reporters in ${s.name}` : `Show the reporters in ${s.name}`}
                      data-testid={`terminal-ernsc-open-${s.name}`}>
                      {s.name}
                    </button>
                    <br />
                    <span className={styles.muted}>{reportedText(s)}</span>
                  </td>
                  <FigureCells f={s} metric={metric} min={min} withAgo={withAgo} testKey={s.name} />
                </tr>
                {shown ? (
                  <tr data-testid={`terminal-ernsc-open-row-${s.name}`}>
                    <td colSpan={cols} className={styles.wrapCell}>
                      <SectorDetail read={detailRead} name={s.name} season={season} metric={metric} id={detailId} agoLabel={view.seasons.year_ago?.label} min={min} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function SectorEarningsPanel({ season: seasonProp = null, metric: metricProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || ERNSC_CODE
  // A new `ERNSC YEARAGO` remounts the panel (the shell keys the body on code + args), so typed words only seed the state.
  const [season, setSeason] = useState(() => normErnscSeason(seasonProp))
  const [metric, setMetric] = useState(() => normErnscMetric(metricProp))
  const [open, setOpen] = useState(null)
  const read = useMarketRead(sectorEarningsUrl({ season }), { refreshInterval: pollMs })
  const view = useMemo(() => readSectorEarnings(read.body), [read.body])
  const held = view.state === 'ok' || view.state === 'none_yet' || view.state === 'empty'
  // Only an answer for THIS season is drawn (the previous one is kept while this one loads).
  const mine = held ? view.season === season : true
  const detailRead = useMarketRead(open && view.state === 'ok' && mine ? sectorDetailUrl({ season, sector: open }) : null, { refreshInterval: pollMs })
  const detailMine = !!open && detailRead.body?.asked === open && detailRead.body?.season === season
  usePanelFreshness(held && mine && view.builtAt ? panelAsOf(SECTOR_EARNINGS_SOURCE, view.builtAt) : null)
  usePanelSymbolRows(detailMine ? reporterSymbols(readSectorDetail(detailRead.body), metric) : [], 'earnings season by sector')

  const pickSeason = (next) => { const s = normErnscSeason(next); setSeason(s); setOpen(null); writeBack(ernscCommandArgs({ season: s, metric })) }
  const pickMetric = (next) => { const m = normErnscMetric(next); setMetric(m); writeBack(ernscCommandArgs({ season, metric: m })) }
  const toggle = (name) => setOpen((prev) => (prev === name ? null : name))
  const seasonOptions = Object.keys(ERNSC_SEASONS).map((id) => ({ value: id, label: seasonOption(held && mine ? view : null, id) }))

  const toolbar = (
    <div className={styles.toolbar} role="toolbar" aria-label="Earnings season controls">
      <label className={`${styles.muted} ${styles.pick}`}>
        Season{' '}
        <Select value={season} onChange={(e) => pickSeason(e.target.value)} options={seasonOptions} className={styles.chip}
          data-testid="terminal-ernsc-season" />
      </label>
      <label className={`${styles.muted} ${styles.pick}`}>
        Measure{' '}
        <Select value={metric} onChange={(e) => pickMetric(e.target.value)} options={METRIC_OPTIONS} className={styles.chip}
          data-testid="terminal-ernsc-metric" />
      </label>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-ernsc" data-state={state}
      data-season={season} data-metric={metric}>
      {toolbar}
      {body}
    </div>
  )

  if (read.loading || (!mine && !read.error)) return wrap('loading', <PanelSkeleton label="Loading the earnings season by sector" testId="terminal-ernsc-loading" />)
  if (!read.body || !mine) {
    const locked = !canRetry(read.error)
    return wrap('error', (
      <PanelState kind={failureKind(read.error)} testId="terminal-ernsc-error" title={failureText(read.error, SECTOR_EARNINGS_WHAT)}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no reports. Retry, or run ${code} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" testId="terminal-ernsc-computing" title="The server is adding up the earnings results it holds.">
        It reads each stock&apos;s held results once, which takes a few seconds. This panel asks again every 3 seconds and fills in on its own.
      </PanelState>
    ))
  }
  if (view.state === 'failed') {
    return wrap('failed', (
      <PanelState kind="error" testId="terminal-ernsc-failed" title="The earnings results could not be read on the server just now."
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no reports. The server tries again within a minute.
      </PanelState>
    ))
  }
  if (view.state === 'bad_shape') {
    return wrap('error', (
      <PanelState kind="error" testId="terminal-ernsc-error" title={`${SECTOR_EARNINGS_WHAT} came back in a form this panel cannot read.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>} />
    ))
  }
  if (view.state === 'empty') {
    return wrap('empty', (
      <PanelState kind="empty" role="status" testId="terminal-ernsc-empty" title="UCT does not hold any stock's earnings results on this server yet.">
        A stock&apos;s results are kept once its Research Earnings tab has been read, by a member or by the scheduled warm-up. That is not
        the same as no reports.
      </PanelState>
    ))
  }

  const lede = (
    <div className={styles.head}>
      <p className={styles.lede} data-testid="terminal-ernsc-lede">
        <strong className={local.plain}>{coverageLine(view)}</strong>{' '}
        {seasonLine(view, season)}
      </p>
    </div>
  )
  const check = view.check ? (
    <p className={styles.note} role="status" data-testid="terminal-ernsc-check">
      A later read of the earnings results did not finish, so these are the last figures it gave.
    </p>
  ) : null
  const method = (
    <p className={styles.muted} data-testid="terminal-ernsc-method">
      {methodWords(view)} One day&apos;s reporters: <kbd>ERNS</kbd>; one stock&apos;s reactions: <kbd>NVDA ERX</kbd>.
    </p>
  )
  if (view.state === 'none_yet') {
    const other = season === 'previous' ? 'current' : 'previous'
    return wrap('none_yet', (
      <>
        {lede}
        {check}
        <PanelState kind="empty" role="status" testId="terminal-ernsc-none-yet"
          title={`No report in the ${view.seasons[season]?.label || ''} season is held yet.`}
          action={<button type="button" className={styles.chip} onClick={() => pickSeason(other)}>Show {ERNSC_SEASONS[other].label.toLowerCase()}</button>}>
          Nothing reported and nothing due in it is in UCT&apos;s copies. That is not the same as no reports.
        </PanelState>
        {method}
      </>
    ))
  }
  return wrap('ok', (
    <>
      {lede}
      {check}
      <p className={styles.muted} data-testid="terminal-ernsc-counts">{countsLine(view.total)}</p>
      <SectorTable view={view} season={season} metric={metric} open={open} onToggle={toggle} detailRead={detailRead} />
      {method}
    </>
  ))
}
