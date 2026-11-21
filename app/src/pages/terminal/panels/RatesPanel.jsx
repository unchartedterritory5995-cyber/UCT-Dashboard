// RATES: Treasury yields and the yield curve, at a glance for a stock trader.
//
//   RATES   where the 2-year, 10-year and 30-year are, which way each maturity moved this week and
//           month, whether the curve is inverted, and whether it is steepening or flattening.
//
// `GET /api/research/treasury-yields` (paid; api/services/treasury_yields.py). The server holds one
// answer and never builds it on the request: with none held it says "computing" and this panel
// asks again. The pure half is ratesModel.js, re-exported below.
//
// What it adds: the terminal had no interest-rate screen. SENT lists a few economic series only
// while the owner-held economic data feature is switched on; this is the whole Treasury curve from
// the US Treasury's own published daily par yield curve (no vendor, no key), with nothing to switch on.
//
// ⛔ A REFUSED SOURCE IS AN ANSWER, NOT AN ERROR: plain words, no Retry loop.
// ⛔ THESE ARE END-OF-DAY FIGURES, and the date of the newest one is always on screen.
// ⛔ A MISSING NUMBER IS NEVER 0: a maturity with no figure says "No figure", a change with nothing
// to measure against says "n/a".
// ⛔ NO GREEN OR RED: a rising yield is not good or bad. A change is a sign (+/-) and a number, and
// the lines in the pictures differ by weight and dash.
//
// REAL YIELDS AND BREAKEVENS are their own block under the pictures, with their own date, source and
// state: the answer's `real` (api/services/treasury_real_yields.py). A real curve that could not be
// read is a sentence there, with the last good date when figures are still shown; it never blanks
// the nominal yields above and is never drawn as zeros. The breakeven is the server's figure.
//
// WIDTH. Six short columns at 640px; at 390px the 1-year change folds away (it stays in the curve
// picture), the real block's nominal column folds away (it is in the table above) and the two
// pictures stack.
//
// The read goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks
// while the app is hidden.
import { useId, useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { todayIso } from '../../calendar/earningsModalRow'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  RATES_CODE, RATES_URL, SOURCE, bpText, breakevenSentence, curveGeometry, curveWords, dayText, daysBetween, etDayOf,
  ratesRead, realAsOfSentence, realCheckWords, realMissingWords,
  spreadGeometry, spreadHistoryWords, spreadSentence, spreadTrendSentence, unavailableWords, yieldText,
} from './ratesModel'
import styles from './marketPanels.module.css'
import own from './ratesPanel.module.css'

export {
  HORIZONS, RATES_CODE, RATES_URL, SOURCE, bpText, curveGeometry, curveWords, dayText, pointsText, ratesRead, runText,
  spreadGeometry, spreadHistoryWords, spreadSentence, spreadTrendSentence, unavailableWords, yieldText,
} from './ratesModel'

const WHAT = 'Treasury yields'
const COMPUTING_POLL_MS = 3 * 1000
/** One figure a day; the server looks for it on weekday evenings. */
const HELD_POLL_MS = 30 * 60 * 1000
/** A newest figure older than this many days is said out loud (a long weekend is four). */
export const OLD_AFTER_DAYS = 5

const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')
const LINE = { now: own.lineNow, m1: own.lineMonth, y1: own.lineYear }

/** Pure: the date, the basis and the source, in one sentence that is always on screen. */
export function asOfSentence(view) {
  return `End-of-day yields for ${dayText(view.asOf)}, with each change in basis points. Source: ${SOURCE}.`
}

/** Pure: what each change is measured against, in a sentence. */
export function methodSentence(view) {
  const refs = [['d1', '1 day'], ['w1', '1 week'], ['m1', '1 month'], ['y1', '1 year']]
    .filter(([h]) => view.refDates[h])
    .map(([h, words]) => `${words} is against ${dayText(view.refDates[h])}`)
  const against = refs.length ? ` ${refs.join(', ')}.` : ''
  return 'A change is the newest yield minus the yield on the nearest trading day on or before the date named, '
    + `in basis points (1 bp is 0.01 of a percentage point).${against}`
}

function FailedRead({ read, code }) {
  const err = read.body ? null : read.error
  const locked = err ? !canRetry(err) : false
  return (
    <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-rates-error"
      title={err ? failureText(err, WHAT) : `${WHAT} could not be read just now.`}
      action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
      {locked ? null : `That is not the same as no figures. Retry, or run ${code} again.`}
    </PanelState>
  )
}

function Swatch({ kind }) {
  return (
    <svg className={own.swatch} viewBox="0 0 28 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className={LINE[kind]} d="M1 4 L27 4" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function CurvePicture({ view }) {
  const geo = useMemo(() => curveGeometry(view), [view])
  if (!geo) return null
  const drawn = Object.fromEntries(geo.series.map((s) => [s.key, s]))
  return (
    <figure className={own.figure} data-testid="terminal-rates-curve">
      <span className={own.figTitle}>The curve</span>
      <svg className={own.chart} viewBox={`0 0 ${geo.w} ${geo.h}`} preserveAspectRatio="none" role="img" aria-label={curveWords(view)}>
        {/* oldest first, so the newest curve is drawn on top */}
        {['y1', 'm1', 'now'].map((key) => (drawn[key].count >= 2
          ? <path key={key} className={LINE[key]} d={drawn[key].path} vectorEffect="non-scaling-stroke" data-series={key} />
          : null))}
      </svg>
      <div className={own.axis} aria-hidden="true">
        {geo.ticks.map((t) => <span key={t.key}>{t.label}</span>)}
      </div>
      <ul className={own.legend} data-testid="terminal-rates-curve-legend">
        <li><Swatch kind="now" />{dayText(view.asOf, { short: true })}</li>
        {drawn.m1.count >= 2 ? <li><Swatch kind="m1" />A month ago{view.refDates.m1 ? ` (${dayText(view.refDates.m1, { short: true })})` : ''}</li> : null}
        {drawn.y1.count >= 2 ? <li><Swatch kind="y1" />A year ago{view.refDates.y1 ? ` (${dayText(view.refDates.y1)})` : ''}</li> : null}
        <li>From {yieldText(geo.min)} to {yieldText(geo.max)}</li>
      </ul>
    </figure>
  )
}

function SpreadPicture({ view }) {
  const spread = view.spreads.find((s) => s.key === '10y2y')
  const label = spread ? `${spread.long} minus ${spread.short}` : '10-year minus 2-year'
  const geo = useMemo(() => spreadGeometry(view.history, 's10y2y'), [view.history])
  if (!geo) return null
  const words = spreadHistoryWords(geo, label)
  return (
    <figure className={own.figure} data-testid="terminal-rates-spread-history">
      <span className={own.figTitle}>{label}{view.history.years ? `, ${view.history.years} years` : ''}</span>
      <svg className={own.chart} viewBox={`0 0 ${geo.w} ${geo.h}`} preserveAspectRatio="none" role="img" aria-label={words}>
        <path className={own.zero} d={`M0 ${geo.zeroY} L${geo.w} ${geo.zeroY}`} vectorEffect="non-scaling-stroke" data-series="zero" />
        <path className={own.lineSpread} d={geo.path} vectorEffect="non-scaling-stroke" data-series="s10y2y" />
      </svg>
      <div className={own.axis} aria-hidden="true">
        <span>{dayText(geo.first.date)}</span>
        <span>The dotted line is zero</span>
        <span>{dayText(geo.last.date)}</span>
      </div>
      <p className={styles.muted} data-testid="terminal-rates-spread-words">{words}</p>
    </figure>
  )
}

const REAL_TITLE = 'Real yields and breakevens'

/** The real yield curve and the breakevens: their own block, date, source and state. */
function RealBlock({ real, today }) {
  const titleId = useId()
  if (!real) return null                       // a server that does not send the block yet
  const shell = (body) => (
    <section className={own.block} aria-labelledby={titleId} data-testid="terminal-rates-real" data-state={real.state}>
      <h3 id={titleId} className={`${own.figTitle} ${own.blockTitle}`}>{REAL_TITLE}</h3>
      {body}
    </section>
  )
  if (real.state !== 'ok') {
    return shell(<p className={styles.note} role="status" data-testid="terminal-rates-real-missing">{realMissingWords(real)}</p>)
  }
  const age = daysBetween(real.asOf, today)
  const d1 = dayText(real.refDates.d1) || 'the day before'
  const w1 = dayText(real.refDates.w1) || 'a week ago'
  const beDay = dayText(real.breakevenAsOf)
  return shell(
    <>
      {real.check ? <p className={styles.note} role="status" data-testid="terminal-rates-real-check">{realCheckWords(real.check, real.asOf)}</p> : null}
      {age != null && age > OLD_AFTER_DAYS ? (
        <p className={styles.note} role="status" data-testid="terminal-rates-real-old">
          The newest real yield the site has from the Treasury is {age} days old ({dayText(real.asOf)}).
        </p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-rates-real-asof">{realAsOfSentence(real)}</p>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-rates-real-table"
          aria-label={`Real Treasury yields by maturity for ${dayText(real.asOf)}, with the breakeven at each maturity${beDay ? ` for ${beDay}` : ''}`}>
          <thead>
            <tr>
              <th scope="col">Maturity</th>
              <th scope="col" title="The end-of-day real yield, in percent">Real yield</th>
              <th scope="col" title={`Change in basis points against ${d1}`}>1 day</th>
              <th scope="col" title={`Change in basis points against ${w1}`}>1 week</th>
              <th scope="col" className={styles.phoneHide} title={beDay ? `The nominal Treasury yield on ${beDay}, in percent` : 'The nominal Treasury yield, in percent'}>Nominal</th>
              <th scope="col" title={beDay ? `The nominal yield minus the real yield on ${beDay}, in percent` : 'The nominal yield minus the real yield, in percent'}>Breakeven</th>
            </tr>
          </thead>
          <tbody>
            {real.rows.map((r) => (
              <tr key={r.key} data-testid="terminal-rates-real-row" data-key={r.key}>
                <th scope="row">{r.label}</th>
                {r.yield == null ? <td className={styles.muted}>No figure</td> : <td>{yieldText(r.yield)}</td>}
                <td>{bpText(r.changeBp.d1)}</td>
                <td>{bpText(r.changeBp.w1)}</td>
                {r.nominal == null ? <td className={`${styles.muted} ${styles.phoneHide}`}>No figure</td> : <td className={styles.phoneHide}>{yieldText(r.nominal)}</td>}
                {r.breakeven == null ? <td className={styles.muted}>No figure</td> : <td>{yieldText(r.breakeven)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-rates-breakeven-asof">{breakevenSentence(real)}</p>
    </>,
  )
}

function Rates({ code, inPanel }) {
  const [today] = useState(todayIso)
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(RATES_URL, { refreshInterval: pace })
  const view = useMemo(() => ratesRead(read.body), [read.body])
  // The pace follows the server's own word (adjusted during render from the last answer).
  // (the real yield block is read a moment after the nominal answer the first time: it is asked for the same way)
  const wantPace = view.state === 'computing' || view.real?.state === 'computing' ? COMPUTING_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)

  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(SOURCE, view.asOf) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-rates" data-state={state}>
      {body}
    </div>
  )

  if (read.loading) return frame('loading', <PanelSkeleton label="Loading Treasury yields" testId="terminal-rates-loading" />)
  if (!read.body || view.state === 'failed') return frame('error', <FailedRead read={read} code={code} />)
  if (view.state === 'computing') {
    return frame('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-rates-computing">
        The server is reading five years of daily Treasury yields from the Treasury&apos;s website, one year at a time. That
        can take half a minute the first time. This panel asks again every 3 seconds and fills in on its own. That is
        not the same as no figures.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    const refused = view.reason !== 'shape'
    return frame('unavailable', (
      <PanelState kind="locked" role="status" testId="terminal-rates-unavailable" title={unavailableWords(view.reason, view.httpStatus)}>
        {refused
          ? "The site reads these figures from the US Treasury's published daily par yield curve, and the Treasury's website did not let the server in. "
          : "The site reads these figures from the US Treasury's published daily par yield curve. "}
        That is not the same as no figures. The server asks again by itself; nothing here needs a retry.
      </PanelState>
    ))
  }

  const age = daysBetween(view.asOf, today)
  const readDay = etDayOf(view.readAt)
  return frame('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-rates-stale-read">{failureText(read.error, WHAT)} Showing the last read.</p> : null}
      {view.check ? (
        <p className={styles.note} role="status" data-testid="terminal-rates-check">
          {view.check.state === 'unavailable'
            ? `${unavailableWords(view.check.reason, view.check.httpStatus)} `
            : 'The last look for a newer figure did not get an answer. '}
          These are the last figures the site read, for {dayText(view.asOf)}.
        </p>
      ) : null}
      {age != null && age > OLD_AFTER_DAYS ? (
        <p className={styles.note} role="status" data-testid="terminal-rates-old">
          The newest figure the site has from the Treasury is {age} days old ({dayText(view.asOf)}).
        </p>
      ) : null}
      <div className={styles.head}>
        <span className={styles.lede} data-testid="terminal-rates-asof">{asOfSentence(view)}</span>
      </div>
      {view.spreads.length ? (
        <ul className={own.spreads} data-testid="terminal-rates-spreads">
          {view.spreads.map((s) => {
            const trend = spreadTrendSentence(s)
            return (
              <li key={s.key} className={own.spreadLine} data-testid={`terminal-rates-spread-${s.key}`} data-state={s.state || 'none'}>
                {spreadSentence(s, view.asOf)}
                {trend ? <span className={own.spreadTrend}> {trend}</span> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-rates-table"
          aria-label={`Treasury yields by maturity for ${dayText(view.asOf)}: the yield in percent and its change in basis points`}>
          <thead>
            <tr>
              <th scope="col">Maturity</th>
              <th scope="col" title="The end-of-day yield, in percent">Yield</th>
              <th scope="col" title={`Change in basis points against ${dayText(view.refDates.d1) || 'the day before'}`}>1 day</th>
              <th scope="col" title={`Change in basis points against ${dayText(view.refDates.w1) || 'a week ago'}`}>1 week</th>
              <th scope="col" title={`Change in basis points against ${dayText(view.refDates.m1) || 'a month ago'}`}>1 month</th>
              <th scope="col" className={styles.phoneHide} title={`Change in basis points against ${dayText(view.refDates.y1) || 'a year ago'}`}>1 year</th>
            </tr>
          </thead>
          <tbody>
            {view.maturities.map((m) => (
              <tr key={m.key} data-testid="terminal-rates-row" data-key={m.key}>
                <th scope="row">{m.label}</th>
                {m.yield == null ? <td className={styles.muted}>No figure</td> : <td>{yieldText(m.yield)}</td>}
                <td>{bpText(m.changeBp.d1)}</td>
                <td>{bpText(m.changeBp.w1)}</td>
                <td>{bpText(m.changeBp.m1)}</td>
                <td className={styles.phoneHide}>{bpText(m.changeBp.y1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={own.pictures}>
        <CurvePicture view={view} />
        <SpreadPicture view={view} />
      </div>
      <RealBlock real={view.real} today={today} />
      <p className={styles.muted} data-testid="terminal-rates-method">
        {methodSentence(view)} Steeper means the spread rose; flatter means it fell. The Treasury publishes one figure a
        day, after the bond market closes; nothing here moves during the day.
        {readDay ? ` The site read these figures from the ${SOURCE} on ${dayText(readDay)}${clock(view.readAt) ? ` at ${clock(view.readAt)}` : ''}.` : ''}
      </p>
    </>
  ))
}

export default function RatesPanel() {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || RATES_CODE
  return <Rates code={code} inPanel={inPanel} />
}
