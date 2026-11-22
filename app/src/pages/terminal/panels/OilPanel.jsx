// OIL: the EIA's weekly oil report. The week's crude build or draw in plain words, the week it covers,
// the day it came out and the next weekly report from the release calendar; one row per series
// (crude, gasoline and distillate stocks, the SPR, production, refinery utilization, pump prices) with
// its latest week, the week before, the change and the same week a year ago; two years of crude stocks
// as a line; the EIA's required credit line at the foot. `OIL`.
//
// Reads, all through the terminal's one reader (marketRead.js; SWR skips ticks while the app is hidden):
//   GET /api/econ/latest?symbols=...      every series at once, every two minutes (the econ service's cache)
//   GET /api/econ/series/{symbol}?start=  one series' history (the week a year ago; crude's 2-year line),
//                                         asked only for a series the first read says is held, every 15 minutes
// Both are api/routers/econ.py: ECON_ENABLED (404 when it is off), require_bars_access (401, 403). Nothing
// is computed on the server for this panel and no route was added. The pure half is oilModel.js.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a week with no figure, a week before or a year ago not held, and a
// week missing from the line are words or a gap.
// ⛔ THE ECONOMIC DATA SWITCHED OFF FOR THIS SERVER (404) IS SAID, never drawn as an empty panel.
// ⛔ NO FORECAST AND NO FUTURES PRICES: the EIA's own weekly figures, and the arithmetic says it is ours.
//
// WIDTH. The top lines wrap; the line is as wide as the panel; one four-column table of merged two- and
// three-line cells that wrap between words in a snug or narrow panel. Nothing folds.
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { useMarketRead } from './marketRead'
import { etToday } from './economyModel'
import {
  OIL_CODE, OIL_HISTORY_POLL_MS, OIL_LATEST_URL, OIL_POLL_MS, OIL_SOURCE, OIL_SYMBOLS,
  historyPoints, historyStateOf, historyUrls, lineWords, nextSentence, noFigureText, oilFailure, oilRead, wantedHistory,
} from './oilModel'
import styles from './marketPanels.module.css'
import own from './oilPanel.module.css'

export { OIL_CODE, OIL_LATEST_URL, OIL_POLL_MS, OIL_SOURCE } from './oilModel'

function Head({ head }) {
  const titleId = useId()
  return (
    <section className={own.section} aria-labelledby={titleId} data-testid="terminal-oil-head" data-state={head.state}>
      <h3 id={titleId} className={own.title}>This week&apos;s report</h3>
      {head.state === 'ok' ? (
        <>
          <p className={own.headline} data-testid="terminal-oil-headline"><span className={own.big}>{head.headline}</span></p>
          <p className={own.label} data-testid="terminal-oil-week">
            {`U.S. crude oil stocks, excluding the Strategic Petroleum Reserve, in ${head.week}.${head.released ? ` Released ${head.released}.` : ''}`}
          </p>
          {head.derived ? (
            <p className={own.label} data-testid="terminal-oil-derived">The weekly change is a UCT calculation from the EIA&apos;s own stock figures.</p>
          ) : null}
        </>
      ) : (
        <p className={own.label} data-testid="terminal-oil-head-none">
          {`${head.words}${head.state === 'no_figure' && head.released ? ` Released ${head.released}.` : ''}`}
        </p>
      )}
      <p className={own.label} data-testid="terminal-oil-next">
        {nextSentence('EIA weekly petroleum report', head.next)}
        {head.note ? ` ${head.note}.` : ''}
      </p>
      <p className={own.label} data-testid="terminal-oil-pump-next">{nextSentence('EIA pump price survey', head.pumpNext)}</p>
    </section>
  )
}

function StocksLine({ line, onRetry }) {
  if (line.state === 'loading') return <PanelSkeleton label="Loading two years of crude oil stocks" testId="terminal-oil-line-loading" />
  if (line.state === 'failed') {
    return (
      <PanelState kind="error" compact testId="terminal-oil-line-error" title={lineWords('failed')}
        action={<button type="button" className={styles.chip} onClick={onRetry}>Retry</button>}>
        That is not the same as no figures. The table below is still read.
      </PanelState>
    )
  }
  if (line.state !== 'ok') return <p className={styles.muted} data-testid="terminal-oil-line-none">{lineWords(line.state)}</p>
  const pic = line.picture
  return (
    <figure className={own.figure} data-testid="terminal-oil-line">
      <span className={own.figTitle}>Crude oil stocks, 2 years, weekly</span>
      <svg className={own.chart} viewBox={`0 0 ${pic.w} ${pic.h}`} preserveAspectRatio="none" role="img" aria-label={pic.words}>
        <path className={own.line} d={pic.path} vectorEffect="non-scaling-stroke" data-series="crude" />
      </svg>
      <div className={own.axis} aria-hidden="true">
        <span>{pic.fromText}</span>
        <span>{pic.rangeText}</span>
        <span>{pic.toText}</span>
      </div>
      <p className={styles.muted} data-testid="terminal-oil-line-words">{pic.words}</p>
    </figure>
  )
}

function NameCell({ r }) {
  return (
    <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>
      {r.state === 'not_found'
        ? <span className={own.value}>{r.label}</span>
        : <Link className={own.name} to={r.chartHref} title={`Open ${r.label} on the chart`} data-testid={`terminal-oil-open-${r.key}`}>{r.label}</Link>}
      {r.derived ? <span className={own.sub} data-testid={`terminal-oil-derived-${r.key}`}>UCT calculation</span> : null}
    </td>
  )
}

const CELL = `${styles.phoneWrap} ${styles.snugWrap}`

function Row({ r }) {
  if (r.state !== 'ok') {
    return (
      <tr data-testid={`terminal-oil-row-${r.key}`} data-state={r.state}>
        <NameCell r={r} />
        <td colSpan={3} className={`${own.textCol} ${CELL}`}>
          <span className={own.sub} data-testid={`terminal-oil-none-${r.key}`}>{r.words}</span>
        </td>
      </tr>
    )
  }
  const { latest, prior, change, yearAgo, note } = r
  return (
    <tr data-testid={`terminal-oil-row-${r.key}`} data-state="ok">
      <NameCell r={r} />
      <td className={CELL} data-testid={`terminal-oil-latest-${r.key}`}>
        <span className={own.value}>{latest.text ?? noFigureText(latest.period)}</span>
        {latest.word ? <span className={own.sub}>{latest.word}</span> : null}
        <span className={own.sub}>{latest.released ? `${latest.period}, released ${latest.released}` : latest.period}</span>
        {note ? <span className={own.sub} data-testid={`terminal-oil-note-${r.key}`}>{note}</span> : null}
      </td>
      <td className={CELL} data-testid={`terminal-oil-prior-${r.key}`} title={prior ? `The week before: ${prior.period}` : undefined}>
        {prior ? (
          <>
            <span className={own.value}>{prior.text ?? noFigureText(prior.period)}</span>
            {prior.word ? <span className={own.sub}>{prior.word}</span> : null}
            {change ? <span className={own.sub} data-testid={`terminal-oil-change-${r.key}`}><span className="sr-only">change </span>{change}</span> : null}
          </>
        ) : <span className={own.sub}>The week before is not held here</span>}
      </td>
      <td className={CELL} data-testid={`terminal-oil-yearago-${r.key}`}>
        {yearAgo.state === 'ok' ? (
          <>
            <span className={own.value}>{yearAgo.text ?? noFigureText(yearAgo.period)}</span>
            {yearAgo.word ? <span className={own.sub}>{yearAgo.word}</span> : null}
            <span className={own.sub}>{yearAgo.period}</span>
            {yearAgo.change ? <span className={own.sub}><span className="sr-only">change since then </span>{yearAgo.change}</span> : null}
          </>
        ) : <span className={own.sub}>{yearAgo.words}</span>}
      </td>
    </tr>
  )
}

function Table({ groups }) {
  return (
    <div className={styles.tableBox}>
      <table className={`${styles.table} ${own.board}`} data-testid="terminal-oil-table">
        <caption className={styles.caption}>The EIA&apos;s weekly figures</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            <th scope="col" className={styles.phoneWrap}>Latest week</th>
            <th scope="col" className={CELL} title="The week before, and the change from it to the latest week">Week before, change</th>
            <th scope="col" className={CELL} title="The same week a year ago, and the change from it to the latest week">A year ago</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key} data-testid={`terminal-oil-group-${g.key}`}>
            <tr>
              <th scope="rowgroup" colSpan={4} className={own.groupHead}>{g.title}</th>
            </tr>
            {g.rows.map((r) => <Row key={r.key} r={r} />)}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function Footer({ credits }) {
  return (
    <div className={own.footer} data-testid="terminal-oil-footer">
      <p>
        Each figure is the EIA&apos;s own, as published, except the weekly build or draw, a UCT calculation from the
        EIA&apos;s stock figures. The changes from the week before and from a year ago are worked out here from the
        EIA&apos;s figures. Pump prices are the EIA&apos;s Monday survey. No futures prices and no forecasts. A series
        name opens it on the chart.
      </p>
      {credits.map((c) => <p key={c.key} data-testid="terminal-oil-credit" data-source={c.key}>{c.text}</p>)}
    </div>
  )
}

function Oil({ code, inPanel }) {
  const [today] = useState(() => etToday(Date.now()))
  const latest = useMarketRead(OIL_LATEST_URL, { refreshInterval: OIL_POLL_MS })
  const [urls] = useState(() => historyUrls(today))
  const want = wantedHistory(latest.body)
  const at = (s) => (want[s] ? urls[s] || null : null)
  const opts = { refreshInterval: OIL_HISTORY_POLL_MS }
  // one read per series, in a fixed order (a hook is never called in a loop); a series not held asks nothing
  const reads = {
    USCRUDEINV: useMarketRead(at('USCRUDEINV'), opts),
    USCRUDEINVCHG: useMarketRead(at('USCRUDEINVCHG'), opts),
    USGASINV: useMarketRead(at('USGASINV'), opts),
    USDISTINV: useMarketRead(at('USDISTINV'), opts),
    USSPR: useMarketRead(at('USSPR'), opts),
    USCRUDEPROD: useMarketRead(at('USCRUDEPROD'), opts),
    USREFUTIL: useMarketRead(at('USREFUTIL'), opts),
    USGASPRICE: useMarketRead(at('USGASPRICE'), opts),
    USDIESELPRICE: useMarketRead(at('USDIESELPRICE'), opts),
  }
  const histories = {}
  const historyState = {}
  for (const s of OIL_SYMBOLS) {
    const r = reads[s]
    histories[s] = r && r.body ? historyPoints(r.body, s) : null
    historyState[s] = historyStateOf(r ? { wanted: want[s], body: r.body, error: r.error, loading: r.loading } : null, s)
  }
  // nine short histories and one 105-week line: cheap, and it runs only when a read answers
  const view = oilRead({ latest: latest.body, histories, historyState, today })
  const ok = !latest.loading && !!latest.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(OIL_SOURCE, view.newestT) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-oil" data-state={state}>{body}</div>
  )
  if (latest.loading) return frame('loading', <PanelSkeleton label="Loading the weekly oil figures" testId="terminal-oil-loading" />)
  if (!ok) {
    const f = oilFailure(latest.body ? null : latest.error)
    return frame(f.state, (
      <PanelState kind={f.kind} testId="terminal-oil-error" title={f.title}
        action={f.retry ? <button type="button" className={styles.chip} onClick={latest.retry}>Retry</button> : null}>
        {f.hint || (f.retry ? `Retry, or run ${code} again.` : null)}
      </PanelState>
    ))
  }
  const retryHistory = () => { for (const s of OIL_SYMBOLS) if (historyState[s] === 'failed') reads[s].retry() }
  return frame('ok', (
    <>
      {latest.error ? <p className={styles.note} role="status" data-testid="terminal-oil-stale-read">{oilFailure(latest.error).title} Showing the last read.</p> : null}
      <Head head={view.head} />
      <StocksLine line={view.line} onRetry={() => reads.USCRUDEINV.retry()} />
      {view.historyFailed ? (
        <div className={own.retryRow} data-testid="terminal-oil-history-failed">
          <p className={styles.muted}>Some of the history behind the year-ago figures could not be read just now.</p>
          <button type="button" className={styles.chip} onClick={retryHistory}>Retry the history</button>
        </div>
      ) : null}
      <Table groups={view.groups} />
      <Footer credits={view.credits} />
    </>
  ))
}

export default function OilPanel() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || OIL_CODE
  return <Oil code={code} inPanel={inPanel} />
}
