// STAT: one stock's statistics. `NVDA STAT`.
//
// Five sections, in this order, each with its own as-of:
//   1. Volatility and range   ATR, realized volatility, average daily range, the 52-week range,
//                             average and relative volume, up and down days over a year
//   2. Beta and correlation   against SPY and the stock's sector fund, up and down capture
//   3. Returns                1W to 5Y and year to date; the best and worst day and week
//   4. Its own drawdowns      every decline of 20% or more in the prices held
//   5. In every market correction  each S&P 500 correction and bear market MKTH found inside the
//                             stock's history: how far it fell against the index, whether it was
//                             back at its high first, and the 3 months after the index low
//
// ONE read, `GET /api/research/stock-stats/{ticker}` (paid; api/services/stock_stats.py): worked out
// by the server from the daily prices it already stores, never from a vendor, and held for the
// session. Asked again every half hour; every few seconds while the market's corrections are still
// being worked out for the first time (MKTH's build). SWR skips ticks while the app is hidden. The
// pure half is stockStatsModel.js.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a statistic with too little history says what it needs.
// ⛔ A RECORD, NOT A FORECAST. Green and red mark the sign of a return only.
//
// WIDTH. Sections 1 and 2 are label and value pairs that wrap between words. Sections 3 to 5 are
// tables of three or four columns of two-line cells that wrap between words in a snug or narrow
// panel; nothing folds away (measured at 592, 462 and 340px).
import { Fragment, useMemo, useState } from 'react'
import { PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  COMPUTING_POLL_MS, HELD_POLL_MS, STAT_CODE, STAT_SOURCE, STAT_WHAT, adrText, afterCell, atrText, avgVolumeText, betaText,
  captureText, correctionsLine, daysText, deepestLine, drawdownsLine, fellCell, highFirstCell, highLine, isComputing, kindText,
  changeText, moveCell, periodCell, range52Text, realizedText, recoveredCell, relVolumeText, sectorLabel, sessionsText,
  spanText, statRead, statUrl,
} from './stockStatsModel'
import { dayText } from './ratesModel'
import styles from './marketPanels.module.css'
import own from './stockStatsPanel.module.css'

const signClass = (sign) => (sign === 'up' ? styles.up : sign === 'down' ? styles.down : undefined)
const WRAP = `${styles.phoneWrap} ${styles.snugWrap}`

function Section({ title, asOf, testId, children }) {
  return (
    <section className={own.section} aria-label={title} data-testid={testId}>
      <h3 className={own.title}>{title}</h3>
      {children}
      {asOf ? <p className={styles.muted} data-testid={`${testId}-asof`}>{asOf}</p> : null}
    </section>
  )
}

function Facts({ rows, testId }) {
  return (
    <dl className={own.facts} data-testid={testId}>
      {rows.map(([label, value, key]) => (
        <Fragment key={key}>
          <dt>{label}</dt>
          <dd data-testid={`${testId}-${key}`}>{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

const closeOf = (iso) => (iso ? `As of the close of ${dayText(iso)}.` : null)

function Volatility({ v }) {
  return (
    <Section title="Volatility and range" asOf={closeOf(v.asOf)} testId="terminal-stat-volatility">
      <Facts testId="terminal-stat-vol" rows={[
        [`ATR (${v.atr.period ?? 14} sessions)`, atrText(v.atr), 'atr'],
        ['Realized volatility', realizedText(v.realized), 'realized'],
        ['Average daily range', adrText(v.adr), 'adr'],
        ['52-week range', range52Text(v.range52), 'range'],
        ['Average volume', avgVolumeText(v.volume), 'avgvol'],
        ['Relative volume', relVolumeText(v.volume), 'relvol'],
        ['Up and down days, 1 year', daysText(v.days), 'days'],
      ]} />
    </Section>
  )
}

function Beta({ b, sym }) {
  const spy = b.spy
  const span = spy.state === 'ok' && spy.from && spy.to ? ` (${dayText(spy.from)} to ${dayText(spy.to)})` : ''
  return (
    <Section title="Beta and correlation" asOf={closeOf(b.asOf)} testId="terminal-stat-beta">
      <Facts testId="terminal-stat-betas" rows={[
        ['Beta vs SPY', betaText(spy), 'spy'],
        [sectorLabel(b.sector), betaText(b.sector), 'sector'],
        ['Up capture vs SPY', captureText(spy, 'up'), 'up'],
        ['Down capture vs SPY', captureText(spy, 'down'), 'down'],
      ]} />
      <p className={styles.muted} data-testid="terminal-stat-beta-method">
        {`Daily returns over the last ${b.window} sessions ${sym} and the fund both traded${span}; at least ${b.min} needed. `}
        Beta 1.5 means it moved one and a half times as much as the fund; correlation runs from -1 to 1. Up capture is its
        average return on the days SPY rose against SPY&apos;s (down capture the same on the days it fell), from daily returns.
      </p>
    </Section>
  )
}

function Move({ m, week }) {
  const c = moveCell(m, week)
  return (
    <td className={WRAP}>
      <span className={signClass(c.sign)}>{c.text}</span>
      {c.sub ? <span className={own.sub}>{c.sub}</span> : null}
      {c.check ? <span className={own.check} data-testid="terminal-stat-check">check the chart</span> : null}
    </td>
  )
}

function Returns({ r, jumpPct }) {
  const yearShort = r.year.state !== 'ok'
  const flagged = [r.year, r.all].some((b) => b.state === 'ok' && [b.bestDay, b.worstDay, b.bestWeek, b.worstWeek].some((m) => m?.check))
  const rows = [['Best day', 'bestDay', false], ['Worst day', 'worstDay', false], ['Best week', 'bestWeek', true], ['Worst week', 'worstWeek', true]]
  return (
    <Section title="Returns" asOf={closeOf(r.asOf)} testId="terminal-stat-returns">
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-stat-periods" aria-label="Returns over each period, from the last close on or before its start">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Return</th>
              <th scope="col" title="The close each return is measured from">From</th>
            </tr>
          </thead>
          <tbody>
            {r.periods.map((p) => {
              const c = periodCell(p)
              return (
                <tr key={p.key} data-testid={`terminal-stat-period-${p.key}`} data-kind={c.kind}>
                  <td>{p.label}</td>
                  {c.kind === 'value' ? (
                    <>
                      <td className={WRAP}>
                        <span className={signClass(c.sign)}>{c.text}</span>
                        {c.sub ? <span className={own.sub}>{c.sub}</span> : null}
                      </td>
                      <td className={WRAP}>{p.from ? dayText(p.from) : 'n/a'}</td>
                    </>
                  ) : (
                    <td colSpan={2} className={`${own.textCell} ${WRAP}`}><span className={own.sub}>{c.sub}</span></td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-stat-extremes" aria-label="The best and worst day and week, over the last year and over all the prices held">
          <thead>
            <tr>
              <th scope="col"><span className={own.sub}>Close to close</span></th>
              <th scope="col">Last year</th>
              <th scope="col">All history</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key, week]) => (
              <tr key={key} data-testid={`terminal-stat-extreme-${key}`}>
                <th scope="row" className={own.rowHead}>{label}</th>
                {yearShort ? <td><span className={own.sub}>n/a</span></td> : <Move m={r.year[key]} week={week} />}
                {r.all.state === 'ok' ? <Move m={r.all[key]} week={week} /> : <td><span className={own.sub}>n/a</span></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {yearShort ? <p className={styles.muted} data-testid="terminal-stat-year-short">{`Last year: ${r.year.neededFrom ? `needs prices back to ${dayText(r.year.neededFrom)}.` : 'too little price history.'}`}</p> : null}
      <p className={styles.muted} data-testid="terminal-stat-returns-method">
        {`A week is a calendar week, from the last close of the week before${r.weekComplete ? '' : '; this week is counted once it ends'}. `}
        {r.all.state === 'ok' && r.all.from ? `All history is from ${dayText(r.all.from)}. ` : ''}
        3-year and 5-year returns carry their yearly rate.
      </p>
      {flagged ? (
        <p className={styles.muted} data-testid="terminal-stat-check-note">
          {`A move marked "check the chart" holds a change of more than ${jumpPct}% in one session, which can be a split the history did not adjust.`}
        </p>
      ) : null}
    </Section>
  )
}

function Drawdowns({ d, sym, jumpPct }) {
  const deepest = deepestLine(d)
  const high = highLine(d)
  const flagged = d.episodes.some((e) => e.check)
  return (
    <Section title="Its own drawdowns" asOf={closeOf(d.asOf)} testId="terminal-stat-drawdowns">
      <p className={styles.lede} data-testid="terminal-stat-drawdowns-line">{drawdownsLine(d, sym)}</p>
      {deepest || high ? (
        <p className={styles.muted} data-testid="terminal-stat-deepest">{[deepest, high].filter(Boolean).join(' ')}</p>
      ) : null}
      {d.episodes.length ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-stat-drawdown-table" aria-label={`Every decline of ${d.minDepthPct}% or more in ${sym}, newest first`}>
            <thead>
              <tr>
                <th scope="col">Peak to low</th>
                <th scope="col">Depth</th>
                <th scope="col">Recovered</th>
              </tr>
            </thead>
            <tbody>
              {d.episodes.map((e) => {
                const rec = recoveredCell(e)
                return (
                  <tr key={e.id} data-testid="terminal-stat-drawdown" data-ongoing={e.ongoing ? 'true' : undefined}>
                    <td className={WRAP}>
                      {spanText(e)}
                      <span className={own.sub}>{`${sessionsText(e.sessionsDown)} down${e.peakAtStart ? ', from the first close held' : ''}`}</span>
                      {e.check ? <span className={own.check} data-testid="terminal-stat-check">check the chart</span> : null}
                    </td>
                    <td><span className={styles.down}>{changeText(e.depthPct)}</span></td>
                    <td className={WRAP}>
                      {rec.main}
                      {rec.sub ? <span className={own.sub}>{rec.sub}</span> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {flagged ? (
        <p className={styles.muted} data-testid="terminal-stat-drawdowns-check-note">
          {`A decline marked "check the chart" holds a change of more than ${jumpPct}% in one session, which can be a split the history did not adjust.`}
        </p>
      ) : null}
      {d.total > d.episodes.length ? (
        <p className={styles.muted} data-testid="terminal-stat-drawdowns-cut">{`Showing the newest ${d.episodes.length} of ${d.total}.`}</p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-stat-drawdowns-method">
        MKTH&apos;s definition, on closing prices: a decline runs from a closing high to the lowest close before that high is
        regained, so a double bottom is one decline. Sessions are the stock&apos;s own trading days.
      </p>
    </Section>
  )
}

function Corrections({ c, sym }) {
  const asOf = c.state === 'ok'
    ? `S&P 500 declines from market history (MKTH)${c.indexThrough ? ` through ${dayText(c.indexThrough)}` : ''}; ${sym}'s prices${c.asOf ? ` through ${dayText(c.asOf)}` : ''}.`
    : null
  let body
  if (c.state === 'computing') {
    body = <p className={styles.muted} role="status" data-testid="terminal-stat-corrections-computing">The server is working out every S&amp;P 500 correction for the first time. This fills in on its own.</p>
  } else if (c.state === 'not_held') {
    body = <p className={styles.note} role="status" data-testid="terminal-stat-corrections-not-held">The S&amp;P 500&apos;s daily closes are not held on this server yet, so its corrections cannot be compared. The sections above stand.</p>
  } else if (c.state !== 'ok') {
    body = <p className={styles.note} role="status" data-testid="terminal-stat-corrections-unavailable">The market&apos;s corrections could not be read just now. The server tries again on its own; the sections above stand.</p>
  } else {
    body = (
      <>
        <p className={styles.lede} data-testid="terminal-stat-corrections-line">{correctionsLine(c, sym)}</p>
        {c.episodes.length ? (
          <div className={styles.tableBox}>
            <table className={styles.table} data-testid="terminal-stat-corrections-table" aria-label={`${sym} in every S&P 500 correction and bear market inside its history, newest first`}>
              <thead>
                <tr>
                  <th scope="col">S&amp;P 500 decline</th>
                  <th scope="col" className={WRAP} title={`${sym}'s deepest fall inside the index's peak-to-low window`}>It fell</th>
                  <th scope="col" className={WRAP} title={`Was ${sym} back at its 52-week closing high before the index regained its peak?`}>High first?</th>
                  <th scope="col" className={WRAP} title={`${sym}'s return in the 3 months after the index low`}>3 months on</th>
                </tr>
              </thead>
              <tbody>
                {c.episodes.map((e) => {
                  const fell = fellCell(e)
                  const hi = highFirstCell(e)
                  const af = afterCell(e)
                  return (
                    <tr key={e.id} data-testid="terminal-stat-correction" data-kind={e.kind}>
                      <td className={WRAP}>
                        {spanText(e)}
                        <span className={e.kind === 'bear' ? own.bear : own.sub}>{`${kindText(e.kind)} ${changeText(e.depthPct)}${e.ongoing ? ', not over' : ''}`}</span>
                      </td>
                      <td className={WRAP}>
                        <span className={styles.down}>{fell.main}</span>
                        {fell.sub ? <span className={own.sub}>{fell.sub}</span> : null}
                      </td>
                      <td className={WRAP} data-kind={hi.kind} data-testid="terminal-stat-highfirst">
                        {hi.main}
                        {hi.sub ? <span className={own.sub}>{hi.sub}</span> : null}
                      </td>
                      <td className={WRAP} data-kind={af.kind}>
                        <span className={signClass(af.sign)}>{af.main}</span>
                        {af.sub ? <span className={own.sub}>{af.sub}</span> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {c.beforeHistory ? (
          <p className={styles.muted} data-testid="terminal-stat-before-history">
            {`${c.beforeHistory === 1 ? 'One earlier decline is' : `${c.beforeHistory} earlier declines are`} before ${sym}'s first close held${c.first ? ` (${dayText(c.first)})` : ''}.`}
          </p>
        ) : null}
        <p className={styles.muted} data-testid="terminal-stat-corrections-method">
          {`"It fell" is ${sym}'s deepest fall inside the index's own peak-to-low window, and how many times the index's depth that is. `}
          {`"High first?" asks whether ${sym} closed back at its 52-week closing high (as of the index peak) before the index regained its peak. `}
          {`"3 months on" is ${sym}'s return from the index low to the day market history measures the index's 3-month rally, beside the index's. `}
          {c.definition || ''}
        </p>
      </>
    )
  }
  return (
    <Section title="In every market correction" asOf={asOf} testId="terminal-stat-corrections">
      {body}
      <p className={styles.muted} data-testid="terminal-stat-mkth-link">
        The index&apos;s own record:{' '}
        <PanelCommand cmd="MKTH" label="Market history">Market history (MKTH)</PanelCommand>
      </p>
    </Section>
  )
}

function StockStatsBody({ sym: s, code }) {
  const inPanel = useInTerminalPanel()
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(statUrl(s), { refreshInterval: pace })
  const view = useMemo(() => statRead(read.body), [read.body])
  // The pace follows the server's own word (adjusted during render from the last answer).
  const wantPace = isComputing(view) ? COMPUTING_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(STAT_SOURCE, view.dataThrough) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-stat" data-state={state} data-sym={s}>{body}</div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading stock statistics for ${s}`} testId="terminal-stat-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    if (err?.status === 400) {
      return frame('bad-symbol', (
        <PanelState kind="input" testId="terminal-stat-bad-symbol" title={`${s} is not a stock or fund symbol this screen can read.`}>
          Type one first, e.g. <kbd>NVDA {code}</kbd>
        </PanelState>
      ))
    }
    const locked = err ? !canRetry(err) : false
    return frame('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-stat-error"
        title={err ? failureText(err, STAT_WHAT) : `${STAT_WHAT} for ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `Retry, or run ${s} ${code} again.`}
      </PanelState>
    ))
  }
  const stale = read.error ? (
    <p className={styles.note} role="status" data-testid="terminal-stat-stale-read">{failureText(read.error, STAT_WHAT)} Showing the last read.</p>
  ) : null
  if (view.state === 'not_held') {
    return frame('not_held', (
      <>
        {stale}
        <PanelState kind="empty" role="status" testId="terminal-stat-not-held" title={view.detail || `UCT holds no daily prices for ${s}.`}>
          The statistics are worked out only from the prices UCT already stores, never asked of a data vendor. That is not the
          same as {s} having no history.
        </PanelState>
      </>
    ))
  }
  if (view.state === 'busy') {
    return frame('busy', (
      <PanelState kind="empty" role="status" testId="terminal-stat-busy" title={WARMING_TITLE}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {view.detail || 'The server is busy working out stock statistics. Try again in a moment.'}
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return frame('unavailable', (
      <PanelState kind="error" testId="terminal-stat-unavailable" title={view.detail || `${STAT_WHAT} for ${s} could not be worked out just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no history. Retry, or run {s} {code} again.
      </PanelState>
    ))
  }
  return frame('ok', (
    <>
      {stale}
      <Volatility v={view.volatility} />
      <Beta b={view.beta} sym={s} />
      <Returns r={view.returns} jumpPct={view.jumpPct} />
      <Drawdowns d={view.drawdowns} sym={s} jumpPct={view.jumpPct} />
      <Corrections c={view.corrections} sym={s} />
      <p className={styles.muted} data-testid="terminal-stat-source">
        {`From ${STAT_SOURCE}: split-adjusted, dividends not included (price returns)`}
        {view.sessions != null ? `, ${sessionsText(view.sessions)}` : ''}
        {view.first ? ` from ${dayText(view.first)}` : ''}
        {view.dataThrough ? ` through ${dayText(view.dataThrough)}` : ''}
        . Worked out by the server from what it already holds, once a session. A record, not a forecast.
      </p>
    </>
  ))
}

export default function StockStatsPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || STAT_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new read, so one stock's statistics are never drawn under another's name.
  return <StockStatsBody key={s} sym={s} code={code} />
}
