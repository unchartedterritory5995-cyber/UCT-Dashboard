// FCTX: how one stock trades against the market, size, growth vs value, momentum, quality and low
// volatility. `NVDA FCTX`.
//
// Four sections, in this order, each with its own as-of:
//   1. How it trades                  the plain one-line reading, built only from loadings whose
//                                     t-statistic is above 2 (the rest named as too uncertain to read),
//                                     the same line a year earlier, and the warnings (unstable loadings,
//                                     a move that may be an unadjusted split)
//   2. Loadings, now and a year earlier   one row per factor: the loading as a number and a small bar,
//                                     its t, the change and whether it is beyond the noise, and the
//                                     factor's simple correlation with the stock
//   3. How much the factors explain   R-squared, the idiosyncratic share, the volatility split, the
//                                     market loading against 1, the beta to the market alone, the
//                                     constant and the largest variance inflation factor
//   4. Method and funds               each factor's funds (an alternative or a factor left out said),
//                                     what is held of each, and the regression in words
//
// ONE read, `GET /api/research/factor-exposure/{ticker}` (paid; api/services/factor_exposure.py): worked
// out by the server from the daily closes it already stores, never from a vendor, and held for the
// session. Asked again every half hour, and every few seconds while the server works the stock out for
// the first time this session (`computing`); SWR skips ticks while the app is hidden. The pure half is
// factorExposureModel.js.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a window with too few sessions says what it needs.
// ⛔ THE PLAIN LINE COMES ONLY FROM LOADINGS THAT CLEAR THE BAR; the others say how uncertain they are.
// ⛔ DESCRIPTIVE, NOT A FORECAST. A loading's bar is never green or red.
//
// WIDTH. Sections 1 and 3 are sentences and label and value pairs that wrap between words. The two
// tables are three columns of two- and three-line cells that wrap between words in a snug or narrow
// panel; nothing folds away.
import { Fragment, useMemo } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  FCTX_CODE, FCTX_SOURCE, FCTX_WHAT, barOf, barScale, basisText, changeText, checkText, factorRows,
  fctxPollMs, fctxRead, fctxUrl, fitRows, fitThenRows, fundRows, fundStateText, fundsNote, loadingCell, plural, signMeaning,
  signedNum, unstableText, windowShortText, windowText,
} from './factorExposureModel'
import { dayText } from './ratesModel'
import styles from './marketPanels.module.css'
import own from './factorExposurePanel.module.css'

const WRAP = `${styles.phoneWrap} ${styles.snugWrap}`
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six']
const closeOf = (iso) => (iso ? `As of the close of ${dayText(iso)}.` : null)

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

/** The loading as a number, its bar (decoration: the number and words carry it) and its t. */
function LoadingCell({ row, scale, tBar, extra, testId }) {
  const cell = loadingCell(row, tBar)
  const bar = row ? barOf(row.loading, scale) : { dir: null, width: 0 }
  return (
    <td className={WRAP} data-testid={testId}>
      <span className={own.num}>{cell.main}</span>
      {row ? (
        <span className={own.track} aria-hidden="true">
          <span className={own.mid} />
          {bar.dir ? (
            <span className={`${own.fill} ${bar.dir === 'pos' ? own.pos : own.neg} ${row.clears ? own.solid : own.faint}`}
              style={{ width: `${bar.width}%` }} data-testid={`${testId}-bar`} data-dir={bar.dir} />
          ) : null}
        </span>
      ) : null}
      <span className={own.sub}>{cell.sub}</span>
      {extra ? <span className={own.sub}>{extra}</span> : null}
    </td>
  )
}

function Reading({ view, sym }) {
  const { now, method } = view
  const unstable = unstableText(now, method)
  const check = checkText(view)
  const funds = fundsNote(view)
  return (
    <Section title="How it trades" asOf={now.state === 'ok' ? closeOf(now.to) : closeOf(view.dataThrough)} testId="terminal-fctx-reading">
      {view.reading ? (
        <p className={styles.lede} data-testid="terminal-fctx-line">{view.reading.text}</p>
      ) : (
        <p className={styles.lede} data-testid="terminal-fctx-line">{`No reading for ${sym}: ${windowShortText(now, method)}`}</p>
      )}
      {view.reading ? <p className={styles.muted} data-testid="terminal-fctx-basis">{basisText(view.reading, method)}</p> : null}
      {view.readingThen ? <p className={styles.muted} data-testid="terminal-fctx-then-line">{`A year earlier: ${view.readingThen.text}`}</p> : null}
      {unstable ? <p className={styles.note} role="status" data-testid="terminal-fctx-unstable">{unstable}</p> : null}
      {check ? <p className={styles.note} role="status" data-testid="terminal-fctx-check">{check}</p> : null}
      {funds ? <p className={styles.muted} data-testid="terminal-fctx-funds-note">{funds}</p> : null}
      <p className={styles.muted} data-testid="terminal-fctx-descriptive">
        {`How ${sym} traded over these sessions, read from its daily moves against the factor funds: a description, not a forecast.`}
      </p>
    </Section>
  )
}

function Loadings({ view, sym }) {
  const { now, then, method } = view
  const rows = factorRows(view)
  const scale = barScale(view)
  const asOf = `Now: ${windowText(now, method)}. A year earlier: ${windowText(then, method)}.`
  return (
    <Section title="Loadings, now and a year earlier" asOf={asOf} testId="terminal-fctx-loadings">
      {rows.length ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-fctx-table" aria-label={`${sym}'s loading on each factor, now and a year earlier`}>
            <thead>
              <tr>
                <th scope="col">Factor</th>
                <th scope="col">Now</th>
                <th scope="col" className={WRAP}>A year earlier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid={`terminal-fctx-row-${r.key}`} data-clears={r.now ? String(r.now.clears) : 'none'}>
                  <th scope="row" className={`${own.rowHead} ${WRAP}`}>
                    {r.name}
                    {signMeaning(r) ? <span className={own.sub}>{signMeaning(r)}</span> : null}
                    {r.now?.correlation != null ? <span className={own.sub}>{`correlation ${signedNum(r.now.correlation)}`}</span> : null}
                  </th>
                  <LoadingCell row={r.now} scale={scale} tBar={method.tBar} testId={`terminal-fctx-now-${r.key}`} />
                  <LoadingCell row={r.then} scale={scale} tBar={method.tBar} extra={changeText(r.change)} testId={`terminal-fctx-then-${r.key}`} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.muted} data-testid="terminal-fctx-no-loadings">{windowShortText(now, method)}</p>
      )}
      <p className={styles.muted} data-testid="terminal-fctx-loadings-method">
        {`A loading is how much ${sym}'s daily return moved with one factor while the others are held fixed: +1.00 on the market is one for one. `}
        {`The t-statistic is the loading over its standard error; only above ${formatNumber(method.tBar)} (either sign) is it read, under that it is too uncertain. `}
        {`The bars share one scale (${formatNumber(scale, { decimals: 1 })} at either end); a solid bar clears the bar, a faint one does not. `}
        A change is beyond the noise when it is more than twice its standard error.
      </p>
    </Section>
  )
}

function Fit({ view }) {
  const { now, then, method } = view
  return (
    <Section title="How much the factors explain" asOf={now.state === 'ok' ? closeOf(now.to) : null} testId="terminal-fctx-fit">
      {now.state === 'ok' ? <Facts rows={fitRows(now, method)} testId="terminal-fctx-fit-now" /> : (
        <p className={styles.muted} data-testid="terminal-fctx-fit-short">{windowShortText(now, method)}</p>
      )}
      <h4 className={own.subTitle}>A year earlier</h4>
      {then.state === 'ok' ? <Facts rows={fitThenRows(then)} testId="terminal-fctx-fit-then" /> : (
        <p className={styles.muted} data-testid="terminal-fctx-fit-then-short">{windowShortText(then, method)}</p>
      )}
      <p className={styles.muted} data-testid="terminal-fctx-fit-method">
        R-squared is the share of the stock&apos;s daily variance the factors explain; the rest is its own (idiosyncratic) part,
        news and moves of its own. The volatility split is the standard deviation of the fitted moves and of what is left, a year.
        {` The return the factors leave is the regression's constant, a year: a description of the window, not an edge.`}
      </p>
    </Section>
  )
}

function Legs({ funds }) {
  return (
    <span className={own.legs}>
      {funds.map((s, i) => (
        <Fragment key={s}>
          {i ? <span>{' minus '}</span> : null}
          <PanelSymbol sym={s} />
        </Fragment>
      ))}
    </span>
  )
}

function Method({ view, sym }) {
  const { method } = view
  const rows = fundRows(view)
  const inModel = view.factors.filter((f) => f.state !== 'dropped').length
  const spreads = `the ${COUNT_WORDS[inModel] || formatNumber(inModel)} ${inModel === 1 ? 'spread' : 'spreads'}`
  return (
    <Section title="Method and funds" asOf={view.dataThrough ? `Funds and stock through the close of ${dayText(view.dataThrough)}.` : null} testId="terminal-fctx-method">
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-fctx-funds" aria-label="The fund spread behind each factor and what is held of each fund">
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">Spread</th>
              <th scope="col">Held</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-testid={`terminal-fctx-fund-${r.key}`} data-state={r.state}>
                <th scope="row" className={`${own.rowHead} ${WRAP}`}>{r.name}</th>
                <td className={WRAP}>
                  {r.funds ? <Legs funds={r.funds} /> : <span>Left out</span>}
                  {fundStateText(r) ? <span className={own.sub}>{fundStateText(r)}</span> : null}
                </td>
                <td className={WRAP}>
                  {r.held.map((h) => (
                    <span key={h.symbol} className={own.sub} data-ok={String(h.ok)}>{`${h.symbol}: ${h.words}`}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-fctx-method-text">
        {`An ordinary least-squares regression of ${sym}'s daily return on ${spreads} (a constant included), over the newest ${formatNumber(method.window)} sessions that ${sym} and every fund traded (at least ${formatNumber(method.min)}), and again over the ${formatNumber(method.window)} before them. `}
        {'A spread is the first fund\'s daily return less the second\'s; growth vs value is positive when growth did better. '}
        {`A return runs from one common session to the next, so a day missing anywhere never counts as a zero. Daily closes, split-adjusted, not dividend-adjusted. `}
        {`A fund is used with at least ${formatNumber(method.fundMinCloses)} closes, the newest within ${formatNumber(method.maxLagDays)} days; otherwise its one stated alternative, or the factor is left out. `}
        {`The spreads overlap, so a variance inflation factor above ${formatNumber(method.vifUnstable)} marks the loadings unstable.`}
      </p>
    </Section>
  )
}

function FactorExposureBody({ sym: s, code }) {
  const inPanel = useInTerminalPanel()
  // Asked again soon while the server works the stock out for the first time this session (SETH's way), else
  // once a half hour.
  const read = useMarketRead(fctxUrl(s), { refreshInterval: (latest) => fctxPollMs(fctxRead(latest?.body)) })
  const view = useMemo(() => fctxRead(read.body), [read.body])
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(FCTX_SOURCE, view.dataThrough) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-fctx" data-state={state} data-sym={s}>{body}</div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading the factor exposure for ${s}`} testId="terminal-fctx-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    if (err?.status === 400) {
      return frame('bad-symbol', (
        <PanelState kind="input" testId="terminal-fctx-bad-symbol" title={`${s} is not a stock or fund symbol this screen can read.`}>
          Type one first, e.g. <kbd>NVDA {code}</kbd>
        </PanelState>
      ))
    }
    const locked = err ? !canRetry(err) : false
    return frame('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-fctx-error"
        title={err ? failureText(err, FCTX_WHAT) : `${FCTX_WHAT} for ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `Retry, or run ${s} ${code} again.`}
      </PanelState>
    ))
  }
  const stale = read.error ? (
    <p className={styles.note} role="status" data-testid="terminal-fctx-stale-read">{failureText(read.error, FCTX_WHAT)} Showing the last read.</p>
  ) : null
  if (view.state === 'computing') {
    return frame('computing', <PanelState kind="empty" role="status" testId="terminal-fctx-computing" title={WARMING_TITLE} />)
  }
  if (view.state === 'not_held') {
    return frame('not_held', (
      <>
        {stale}
        <PanelState kind="empty" role="status" testId="terminal-fctx-not-held" title={view.detail || `UCT holds no daily prices for ${s}.`}>
          The factor exposure is worked out only from the prices UCT already stores, never asked of a data vendor.
          That is not the same as {s} having no history.
        </PanelState>
      </>
    ))
  }
  if (view.state === 'busy') {
    return frame('busy', (
      <PanelState kind="empty" role="status" testId="terminal-fctx-busy" title={WARMING_TITLE}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {view.detail || 'The server is busy working out factor exposures. Try again in a moment.'}
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return frame('unavailable', (
      <PanelState kind="error" testId="terminal-fctx-unavailable" title={view.detail || `${FCTX_WHAT} for ${s} could not be worked out just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no history. Retry, or run {s} {code} again.
      </PanelState>
    ))
  }
  return frame('ok', (
    <>
      {stale}
      <Reading view={view} sym={s} />
      <Loadings view={view} sym={s} />
      <Fit view={view} />
      <Method view={view} sym={s} />
      <p className={styles.muted} data-testid="terminal-fctx-source">
        {`From ${FCTX_SOURCE}: settled sessions only, split-adjusted closes, price returns`}
        {view.sessionsRead != null ? `; the newest ${plural(view.sessionsRead, 'session', 'sessions')} of ${s}` : ''}
        {view.readFrom ? ` from ${dayText(view.readFrom)}` : ''}
        {view.dataThrough ? ` through ${dayText(view.dataThrough)}` : ''}
        . Worked out by the server from what it already holds, once a session.
      </p>
    </>
  ))
}

export default function FactorExposurePanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || FCTX_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new read, so one stock's exposure is never drawn under another's name.
  return <FactorExposureBody key={s} sym={s} code={code} />
}
