// LIQ: liquidity. Net liquidity (the Fed's total assets minus the Treasury General Account minus
// overnight reverse repo, a UCT calculation on each H.4.1 Wednesday) with its 1, 4, 13 and 52-week
// change, one plain sentence on its direction and a line of the last two years; then the parts, each
// with its latest figure, its date and its 1-week (M2: 1-month) change; every source's credit line at
// the foot. `LIQ`.
//
// Reads, all through the terminal's one reader (marketRead.js; SWR skips ticks while the app is
// hidden), asked again every two minutes (the econ service's cache lifetime):
//   GET /api/econ/latest?symbols=...      the parts (api/routers/econ.py: ECON_ENABLED, require_bars_access)
//   GET /api/econ/series/{symbol}?start=  the line's history and the daily parts' last few weeks, asked
//                                         only for a series the first read says is held
// Nothing is computed on the server for this panel and no route was added. The pure half is
// liquidityModel.js.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a Wednesday with an input missing is a gap in the line, a change
// without its earlier figure is words, and a series not held says so.
// ⛔ THE ECONOMIC DATA SWITCHED OFF FOR THIS SERVER (404) IS SAID, never drawn as an empty panel.
// ⛔ NO FORECAST, NO ADVICE: the sentence reads the direction from the numbers.
//
// WIDTH. The headline, the four changes and the sentence wrap; the line is as wide as the panel; the
// parts table has three columns whose cells take a second line in a snug or narrow panel. Nothing folds.
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { useMarketRead } from './marketRead'
import { etToday, noFigureText } from './economyModel'
import {
  LIQ_CODE, LIQ_LATEST_URL, LIQ_POLL_MS, LIQ_SOURCE, LINE_SYMBOLS, NET_LABEL, RRP_LOOKBACK_DAYS,
  dayWords, historyPoints, historyUrls, lineFailureText, lineReadState, liqFailure, liquidityRead, usdText, wantedHistory,
} from './liquidityModel'
import styles from './marketPanels.module.css'
import own from './liquidityPanel.module.css'

export { LIQ_CODE, LIQ_LATEST_URL, LIQ_POLL_MS, LIQ_SOURCE } from './liquidityModel'

const SPAN = { 1: '1 week', 4: '4 weeks', 13: '13 weeks', 52: '52 weeks' }

function NetPicture({ picture }) {
  return (
    <figure className={own.figure} data-testid="terminal-liq-line">
      <span className={own.figTitle}>Net liquidity, 2 years, every Wednesday</span>
      <svg className={own.chart} viewBox={`0 0 ${picture.w} ${picture.h}`} preserveAspectRatio="none" role="img" aria-label={picture.words}>
        <path className={own.line} d={picture.path} vectorEffect="non-scaling-stroke" data-series="net" />
      </svg>
      <div className={own.axis} aria-hidden="true">
        <span>{picture.fromText}</span>
        <span>{`${usdText(picture.min)} to ${usdText(picture.max)}`}</span>
        <span>{picture.toText}</span>
      </div>
      <p className={styles.muted} data-testid="terminal-liq-line-words">{picture.words}</p>
    </figure>
  )
}

function Net({ net, today, onRetry }) {
  const titleId = useId()
  const shell = (state, body) => (
    <section className={own.section} aria-labelledby={titleId} data-testid="terminal-liq-net" data-state={state}>
      <h3 id={titleId} className={own.title}>Net liquidity</h3>
      {body}
    </section>
  )
  if (net.state === 'loading') return shell('loading', <PanelSkeleton label="Loading two years of the Fed's figures" testId="terminal-liq-net-loading" />)
  if (net.state === 'failed') {
    return shell('failed', (
      <PanelState kind="error" compact testId="terminal-liq-net-error" title={lineFailureText('failed')}
        action={<button type="button" className={styles.chip} onClick={onRetry}>Retry</button>}>
        That is not the same as no figures. The parts below are still read.
      </PanelState>
    ))
  }
  if (net.state === 'not_held') {
    const words = net.missing.length
      ? `Net liquidity cannot be worked out: ${net.missing.join(', ')} ${net.missing.length > 1 ? 'are' : 'is'} not held here.`
      : lineFailureText('not_held')
    return shell('not_held', <p className={styles.muted} data-testid="terminal-liq-net-none">{words}</p>)
  }
  if (net.state === 'no_value') {
    return shell('no_value', (
      <p className={styles.muted} data-testid="terminal-liq-net-none">
        No Wednesday in the last two years has all three figures held, so net liquidity has no value to show.
      </p>
    ))
  }
  const { head, changes, sentence, picture, newestGap, next, note } = net
  const missingWhy = changes.filter((c) => c.value == null)
  return shell('ok', (
    <>
      <p className={own.headline} data-testid="terminal-liq-headline">
        <span className={own.big}>{usdText(head.net)}</span>
        <span className={own.when}>{dayWords(head.date, today)}</span>
      </p>
      <p className={own.label} data-testid="terminal-liq-label">
        {`${NET_LABEL}: the Fed's total assets minus the Treasury General Account minus overnight reverse repo, on the Wednesday of each H.4.1 week.`}
      </p>
      {head.rrpShifted ? (
        <p className={styles.note} data-testid="terminal-liq-shifted">
          {`Reverse repo for this week is from ${dayWords(head.rrpDay, today)}: there was no print on ${dayWords(head.date, today)}.`}
        </p>
      ) : null}
      {newestGap ? (
        <p className={styles.note} data-testid="terminal-liq-newest-gap">
          {`No value yet for ${dayWords(newestGap.date, today)}: ${newestGap.missing.join(', ')} not held.`}
        </p>
      ) : null}
      <ul className={own.changes} aria-label="Change in net liquidity" data-testid="terminal-liq-changes">
        {changes.map((c) => (
          <li key={c.weeks} className={own.change} data-testid={`terminal-liq-change-${c.weeks}`}
            title={c.value != null ? `Since ${dayWords(c.from, today)}` : c.why}>
            <span className={own.changeSpan}>{SPAN[c.weeks] || `${c.weeks} weeks`}</span>
            <span className="sr-only">: </span>
            <span className={own.changeValue}>{c.text}</span>
          </li>
        ))}
      </ul>
      {missingWhy.length ? (
        <p className={styles.muted} data-testid="terminal-liq-change-why">
          {missingWhy.map((c) => `${SPAN[c.weeks] || `${c.weeks} weeks`}: ${c.why}`).join(' ')}
        </p>
      ) : null}
      {sentence ? <p className={own.sentence} data-testid="terminal-liq-sentence">{sentence}</p> : null}
      {picture ? <NetPicture picture={picture} /> : null}
      <p className={styles.muted} data-testid="terminal-liq-next">
        {next.state === 'ok' ? `Next Fed balance sheet (H.4.1): ${next.text}.` : `Fed balance sheet (H.4.1): ${next.text}.`}
        {note ? ` ${note}.` : ''}
      </p>
    </>
  ))
}

function PartRow({ r }) {
  const name = (
    <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>
      {r.state === 'not_found'
        ? <span className={own.value}>{r.label}</span>
        : <Link className={own.name} to={r.chartHref} title={`Open ${r.label} on the chart`} data-testid={`terminal-liq-open-${r.key}`}>{r.label}</Link>}
    </td>
  )
  if (r.state !== 'ok') {
    return (
      <tr data-testid={`terminal-liq-part-${r.key}`} data-state={r.state}>
        {name}
        <td colSpan={2} className={`${own.textCol} ${styles.phoneWrap} ${styles.snugWrap}`}>
          <span className={own.sub} data-testid={`terminal-liq-none-${r.key}`}>{r.words}</span>
        </td>
      </tr>
    )
  }
  const { latest, change, alt, note } = r
  return (
    <tr data-testid={`terminal-liq-part-${r.key}`} data-state="ok">
      {name}
      <td className={`${styles.phoneWrap} ${styles.snugWrap}`} data-testid={`terminal-liq-latest-${r.key}`}>
        <span className={own.value}>{latest.text ?? noFigureText(latest.when)}</span>
        <span className={own.sub}>{latest.when}</span>
        {alt ? <span className={own.sub} data-testid={`terminal-liq-alt-${r.key}`}>{`${alt.label} ${alt.text} (${alt.period})`}</span> : null}
        {note ? <span className={own.sub} data-testid={`terminal-liq-note-${r.key}`}>{note}</span> : null}
      </td>
      <td className={`${styles.phoneWrap} ${styles.snugWrap}`} data-testid={`terminal-liq-change-${r.key}`}>
        <span className={own.value}><span className="sr-only">change </span>{change.text ?? 'n/a'}</span>
        <span className={own.sub}>{change.text ? `${change.over}, since ${change.since}` : change.why}</span>
      </td>
    </tr>
  )
}

function Parts({ parts }) {
  return (
    <div className={styles.tableBox}>
      <table className={`${styles.table} ${own.parts}`} data-testid="terminal-liq-parts">
        <caption className={styles.caption}>The parts</caption>
        <thead>
          <tr>
            <th scope="col">Series</th>
            <th scope="col" className={styles.phoneWrap}>Latest</th>
            <th scope="col" className={`${styles.phoneWrap} ${styles.snugWrap}`}
              title="Basis points for a rate, dollars for a dollar figure; 1 week for a daily or weekly figure, 1 month for M2">Change</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((r) => <PartRow key={r.key} r={r} />)}
        </tbody>
      </table>
    </div>
  )
}

function Footer({ credits }) {
  return (
    <div className={own.footer} data-testid="terminal-liq-footer">
      <p>
        {`Each part is the agency's own figure, as published. Net liquidity is a UCT calculation from them: on each H.4.1 Wednesday, reverse repo is that day's print or, when there is none, the nearest earlier print within ${RRP_LOOKBACK_DAYS} days. It describes the figures; it is not a forecast. A series name opens it on the chart.`}
      </p>
      {credits.map((c) => <p key={c.key} data-testid="terminal-liq-credit" data-source={c.key}>{c.text}</p>)}
    </div>
  )
}

function Liquidity({ code, inPanel }) {
  const [today] = useState(() => etToday(Date.now()))
  const latest = useMarketRead(LIQ_LATEST_URL, { refreshInterval: LIQ_POLL_MS })
  const urls = useMemo(() => historyUrls(today), [today])
  const want = useMemo(() => wantedHistory(latest.body), [latest.body])
  const opts = { refreshInterval: LIQ_POLL_MS }
  const fed = useMarketRead(want.USFEDBAL ? urls.USFEDBAL : null, opts)
  const tgaWeekly = useMarketRead(want.USTGAFED ? urls.USTGAFED : null, opts)
  const rrp = useMarketRead(want.USRRP ? urls.USRRP : null, opts)
  const tgaDaily = useMarketRead(want.USTGA ? urls.USTGA : null, opts)
  const sofr = useMarketRead(want.USSOFR ? urls.USSOFR : null, opts)
  const hist = { USFEDBAL: fed, USTGAFED: tgaWeekly, USRRP: rrp, USTGA: tgaDaily, USSOFR: sofr }

  const histories = {}
  const historyFailed = {}
  const reads = {}
  for (const [s, r] of Object.entries(hist)) {
    const pts = r.body ? historyPoints(r.body, s) : null
    histories[s] = pts
    // an answer that is not the series' shape is a failed read, never an empty history
    const error = r.error || (r.body && !pts ? { status: 0 } : null)
    reads[s] = { wanted: want[s], body: pts ? r.body : null, error, loading: r.loading }
    historyFailed[s] = !!(want[s] && error && !pts)
  }
  const lineState = lineReadState(LINE_SYMBOLS.map((s) => reads[s]))
  // a few hundred points and 105 Wednesdays: cheap, and it runs only when a read answers
  const view = liquidityRead({ latest: latest.body, histories, historyFailed, lineState, today })
  const ok = !latest.loading && !!latest.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(LIQ_SOURCE, view.newestT) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-liq" data-state={state}>{body}</div>
  )
  if (latest.loading) return frame('loading', <PanelSkeleton label="Loading the liquidity figures" testId="terminal-liq-loading" />)
  if (!ok) {
    const f = liqFailure(latest.body ? null : latest.error)
    return frame(f.state, (
      <PanelState kind={f.kind} testId="terminal-liq-error" title={f.title}
        action={f.retry ? <button type="button" className={styles.chip} onClick={latest.retry}>Retry</button> : null}>
        {f.hint || (f.retry ? `Retry, or run ${code} again.` : null)}
      </PanelState>
    ))
  }
  const retryLine = () => { fed.retry(); tgaWeekly.retry(); rrp.retry() }
  return frame('ok', (
    <>
      {latest.error ? <p className={styles.note} role="status" data-testid="terminal-liq-stale-read">{liqFailure(latest.error).title} Showing the last read.</p> : null}
      <Net net={view.net} today={today} onRetry={retryLine} />
      <Parts parts={view.parts} />
      <Footer credits={view.credits} />
    </>
  ))
}

export default function LiquidityPanel() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || LIQ_CODE
  return <Liquidity code={code} inPanel={inPanel} />
}
