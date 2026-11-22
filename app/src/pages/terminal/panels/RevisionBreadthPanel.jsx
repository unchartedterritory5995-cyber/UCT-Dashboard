// EEHSC: estimate revisions by sector (2026-11-21). Are analysts raising or cutting numbers, and where?
//
//   EEHSC              every sector, next-quarter EPS estimates, the change over 30 days
//   EEHSC 7D REVENUE   a window: 7D (1W) | 30D (1M); an estimate: EPS | REVENUE (REV, SALES)
//
// ONE paid route, GET /api/research/estimate-history?metric=&window= (revisionBreadthModel.js says what it answers),
// behind the switch EEH answers behind. The server adds up UCT's own daily snapshots of each tracked stock's consensus
// estimate, by sector, and holds the answer. It counts ONLY the stocks UCT tracks, and the header says so first.
// A sector row opens its stocks (each a symbol that loads the board), the three largest raises and cuts, and the stocks
// that could not be counted, by reason.
//
// WHY A NEW CODE, NOT A VIEW OF GRPS OR OF EEH: GRPS's views are column sets over one held table of UCT's whole stock
// universe (about 3,500 stocks, no switch, sectors or industries); this is a different population (at most 600 tracked
// stocks), a different source behind a different switch, its own window and estimate, and rows that open in place.
// EEH is one stock's history inside the Research page; a bare EEH on a panel that follows a group's stock shows that
// stock, so a market variant would need a word to reach it there. EEHSC: EEH for every sector.
//
// WIDTH. Four columns of one- and two-line cells: at least 399px with every column showing (measured), so the table fits
// the bottom of the fold ladder and names no step; on a phone the largest raise and cut fold away (phoneHide) and stay in
// the opened sector. No screen-reader-only text sits in a cell (it would widen the scroll box).
import { Fragment, useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  EEHSC_CODE, EEHSC_METRICS, EEHSC_WINDOWS, REVISION_BREADTH_COMPUTING_POLL_MS, REVISION_BREADTH_POLL_MS, REVISION_BREADTH_SOURCE,
  REVISION_BREADTH_WHAT, collectingWords, countedSymbols, countedText, countsText, countsWords, coverageLine, dayWords, eehscCommandArgs,
  estimateText, netText, netWords, normEehscMetric, normEehscWindow, originWords, pctText, readRevisionBreadth, revisionBreadthUrl,
  sectorGroups, changeWords, toneOf, totalLine, trackedLine, windowLine,
} from './revisionBreadthModel'
import styles from './marketPanels.module.css'
import local from './revisionBreadth.module.css'

const WINDOW_OPTIONS = Object.entries(EEHSC_WINDOWS).map(([value, w]) => ({ value, label: w.label }))
const METRIC_OPTIONS = Object.entries(EEHSC_METRICS).map(([value, m]) => ({ value, label: m.label }))
const pollMs = (latest) => (latest?.body?.status === 'computing' ? REVISION_BREADTH_COMPUTING_POLL_MS : REVISION_BREADTH_POLL_MS)
const toneClass = (v) => (toneOf(v) === 'up' ? styles.up : toneOf(v) === 'down' ? styles.down : '')

function Change({ item }) {
  return (
    <span className={local.change}>
      <PanelSymbol sym={item.symbol} className={styles.sym} />{' '}
      <span className={toneClass(item.pct)}>{pctText(item.pct)}</span>
    </span>
  )
}

function TopList({ label, items, testId }) {
  if (!items.length) return null
  return (
    <p className={styles.muted} data-testid={testId}>
      {label}:{' '}
      {items.map((x, i) => <Fragment key={x.symbol}>{i ? ', ' : ''}<Change item={x} /></Fragment>)}
    </p>
  )
}

function SectorDetail({ sector, metric, id }) {
  const { counted, rest } = sectorGroups(sector)
  return (
    <div className={local.detail} id={id} data-testid={`terminal-eehsc-detail-${sector.name}`}>
      <TopList label="Largest raises" items={sector.raises} testId={`terminal-eehsc-raises-${sector.name}`} />
      <TopList label="Largest cuts" items={sector.cuts} testId={`terminal-eehsc-cuts-${sector.name}`} />
      {counted.length ? (
        <ul className={local.symList} aria-label={`The counted stocks in ${sector.name}, largest raise first`}>
          {counted.map((s) => (
            <li key={s.symbol} className={local.symItem} title={changeWords(s, metric)} data-testid={`terminal-eehsc-sym-${s.symbol}`}>
              <PanelSymbol sym={s.symbol} className={styles.sym} />{' '}
              <span className={toneClass(s.state === 'held' ? 0 : s.pct)}>{pctText(s.pct)}</span>{' '}
              <span className={styles.muted}>{`${estimateText(s.from, metric)} to ${estimateText(s.to, metric)}`}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rest.map((g) => (
        <p key={g.state} className={styles.muted} data-testid={`terminal-eehsc-rest-${g.state}`}>
          {g.words}:{' '}
          {g.symbols.map((s, i) => <Fragment key={s.symbol}>{i ? ', ' : ''}<span title={s.reason || undefined}><PanelSymbol sym={s.symbol} className={styles.sym} /></span></Fragment>)}
        </p>
      ))}
    </div>
  )
}

function Top({ sector }) {
  const up = sector.raises[0]
  const down = sector.cuts[0]
  if (!up && !down) return <span className={styles.muted}>none</span>
  return (
    <>
      {up ? <Change item={up} /> : <span className={styles.muted}>no raise</span>}
      <br />
      {down ? <Change item={down} /> : <span className={styles.muted}>no cut</span>}
    </>
  )
}

function SectorTable({ view, metric, win }) {
  const [open, setOpen] = useState(() => new Set())
  const toggle = (name) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })
  const label = `Every sector, ${EEHSC_METRICS[metric].what} revisions over ${EEHSC_WINDOWS[win].label}, net breadth highest first`
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-eehsc-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" title="Open a sector to see its stocks">Sector</th>
            <th scope="col" className={styles.phoneWrap} title="Stocks raised minus stocks cut, as a share of the stocks counted">Net breadth</th>
            <th scope="col" className={styles.phoneWrap} title="Stocks whose estimate rose, fell, or held within the tolerance">Raised / cut / held</th>
            <th scope="col" className={styles.phoneHide} title="The largest raise and the largest cut, by percent">Largest raise / cut</th>
          </tr>
        </thead>
        <tbody>
          {view.sectors.map((s, i) => {
            const shown = open.has(s.name)
            const detailId = `eehsc-sector-${i}`
            return (
              <Fragment key={s.name}>
                <tr data-testid={`terminal-eehsc-row-${s.name}`}>
                  <td className={`${styles.wrapCell} ${styles.phoneTight}`}>
                    <button type="button" className={styles.rowBtn} aria-expanded={shown} aria-controls={shown ? detailId : undefined}
                      onClick={() => toggle(s.name)} title={shown ? `Hide the stocks in ${s.name}` : `Show the stocks in ${s.name}`}
                      data-testid={`terminal-eehsc-open-${s.name}`}>
                      {s.name}
                    </button>
                    <br />
                    <span className={styles.muted}>{countedText(s)}</span>
                  </td>
                  <td title={netWords(s, view.minCounted)}>
                    {s.net === null
                      ? <span className={styles.muted} data-testid={`terminal-eehsc-few-${s.name}`}>too few</span>
                      : <span className={toneClass(s.net)} data-testid={`terminal-eehsc-net-${s.name}`}>{netText(s.net)}</span>}
                  </td>
                  <td title={countsWords(s)}>{countsText(s)}</td>
                  <td className={styles.phoneHide}><Top sector={s} /></td>
                </tr>
                {shown ? (
                  <tr data-testid={`terminal-eehsc-open-row-${s.name}`}>
                    <td colSpan={4} className={styles.wrapCell}>
                      <SectorDetail sector={s} metric={metric} id={detailId} />
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

export default function RevisionBreadthPanel({ window: windowProp = null, metric: metricProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || EEHSC_CODE
  // A new `EEHSC 7D` remounts the panel (the shell keys the body on code + args), so typed words only seed the state.
  const [win, setWin] = useState(() => normEehscWindow(windowProp))
  const [metric, setMetric] = useState(() => normEehscMetric(metricProp))
  const read = useMarketRead(revisionBreadthUrl({ metric, window: win }), { refreshInterval: pollMs })
  const view = useMemo(() => readRevisionBreadth(read.body), [read.body])
  const held = view.state === 'ok' || view.state === 'collecting' || view.state === 'empty'
  // Only an answer for THIS window and estimate is drawn (the previous one is kept while this one loads).
  const mine = held ? view.metric === metric && view.window === win : true
  usePanelFreshness(held && mine && view.asof ? panelAsOf(REVISION_BREADTH_SOURCE, view.asof) : null)
  usePanelSymbolRows(view.state === 'ok' && mine ? countedSymbols(view) : [], 'estimate revisions by sector')

  const pickWindow = (next) => { const w = normEehscWindow(next); setWin(w); writeBack(eehscCommandArgs({ metric, window: w })) }
  const pickMetric = (next) => { const m = normEehscMetric(next); setMetric(m); writeBack(eehscCommandArgs({ metric: m, window: win })) }

  const toolbar = (
    <div className={styles.toolbar} role="toolbar" aria-label="Estimate revisions controls">
      <label className={`${styles.muted} ${styles.pick}`}>
        Window{' '}
        <Select value={String(win)} onChange={(e) => pickWindow(e.target.value)} options={WINDOW_OPTIONS} className={styles.chip}
          data-testid="terminal-eehsc-window" />
      </label>
      <label className={`${styles.muted} ${styles.pick}`}>
        Estimate{' '}
        <Select value={metric} onChange={(e) => pickMetric(e.target.value)} options={METRIC_OPTIONS} className={styles.chip}
          data-testid="terminal-eehsc-metric" />
      </label>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-eehsc" data-state={state}
      data-window={win} data-metric={metric}>
      {toolbar}
      {body}
    </div>
  )

  if (read.loading || (!mine && !read.error)) return wrap('loading', <PanelSkeleton label="Loading the estimate revisions by sector" testId="terminal-eehsc-loading" />)
  if (!read.body || !mine) {
    const locked = !canRetry(read.error)
    return wrap('error', (
      <PanelState kind={failureKind(read.error)} testId="terminal-eehsc-error" title={failureText(read.error, REVISION_BREADTH_WHAT)}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no revisions. Retry, or run ${code} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" testId="terminal-eehsc-computing" title="The server is adding up the estimate snapshots.">
        It reads UCT&apos;s snapshot store once, which takes a few seconds. This panel asks again every 3 seconds and fills in on its own.
      </PanelState>
    ))
  }
  if (view.state === 'failed') {
    return wrap('failed', (
      <PanelState kind="error" testId="terminal-eehsc-failed" title="The estimate snapshots could not be read on the server just now."
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no revisions. The server tries again within a minute.
      </PanelState>
    ))
  }
  if (view.state === 'bad_shape') {
    return wrap('error', (
      <PanelState kind="error" testId="terminal-eehsc-error" title={`${REVISION_BREADTH_WHAT} came back in a form this panel cannot read.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>} />
    ))
  }
  if (view.state === 'empty') {
    return wrap('empty', (
      <PanelState kind="empty" role="status" testId="terminal-eehsc-empty" title="UCT does not track any stock's estimates on this server yet.">
        The daily job adds the S&amp;P 500 list on its first run, and a stock joins when a member opens its estimate history (EEH).
        That is not the same as no revisions.
      </PanelState>
    ))
  }

  const lede = (
    <div className={styles.head}>
      <p className={styles.lede} data-testid="terminal-eehsc-lede">
        <strong className={local.plain}>{trackedLine(view)}</strong>{' '}
        {windowLine(view, metric, win)}
      </p>
    </div>
  )
  const check = view.check ? (
    <p className={styles.note} role="status" data-testid="terminal-eehsc-check">
      A later read of the snapshot store did not finish, so these are the last figures it gave.
    </p>
  ) : null
  const method = (
    <p className={styles.muted} data-testid="terminal-eehsc-method">
      How it is counted: each stock&apos;s consensus estimate for its next fiscal quarter (the first ending after its newest
      snapshot), at its newest snapshot against its snapshot {EEHSC_WINDOWS[win].label} before (or up to {view.slackDays ?? 4} days
      earlier, for weekends and holidays). A change of more than {view.tolerancePct ?? 0.5}% either way is a raise or a cut; within
      it, held. Net breadth is raised minus cut as a share of the stocks counted, shown with at least {view.minCounted} counted.
      Sectors are the company details GRPS and GRP group by. {originWords(view)} Source: {view.source || REVISION_BREADTH_SOURCE}, each
      weekday evening{view.coversFrom ? `, the first snapshot on ${dayWords(view.coversFrom)}` : ''}. One stock&apos;s history: type its
      symbol and EEH, e.g. <kbd>NVDA EEH</kbd>.
    </p>
  )
  if (view.state === 'collecting') {
    return wrap('collecting', (
      <>
        {lede}
        {check}
        <PanelState kind="empty" role="status" testId="terminal-eehsc-collecting"
          title={`None of the ${view.tracked.n} tracked stocks has snapshots spanning ${EEHSC_WINDOWS[win].label} yet.`}
          action={win !== 7 ? <button type="button" className={styles.chip} onClick={() => pickWindow(7)}>Show 7 days</button> : null}>
          {collectingWords(view, win)} That is not the same as no revisions.
        </PanelState>
        {method}
      </>
    ))
  }
  return wrap('ok', (
    <>
      {lede}
      {check}
      <p className={styles.muted} data-testid="terminal-eehsc-coverage">
        {coverageLine(view.total)} {totalLine(view)}
      </p>
      <SectorTable view={view} metric={metric} win={win} />
      {method}
    </>
  ))
}
