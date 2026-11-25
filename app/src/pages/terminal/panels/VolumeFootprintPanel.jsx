// VFP: one stock's volume footprint and gaps. `NVDA VFP`.
//
// Four sections, in this order, each with its own as-of and its definition in words:
//   1. Accumulation and distribution   accumulation and distribution days over the last 25 and 50
//                                      sessions, the net, and the up/down volume ratio over 50
//   2. The biggest volume days         the 10 heaviest sessions of the last year: volume against the
//                                      50 sessions before, the day's change, where it closed in its
//                                      range, and an earnings mark where one is known
//   3. Pocket pivots                   every one in the last year, newest first
//   4. Gaps                            every gap of 3% or more in the history held: how many filled
//                                      within 5 and 20 sessions, up against down; the newest listed
//                                      with the day's close against its open and when it filled
//
// ONE read, `GET /api/research/volume-footprint/{ticker}` (paid; api/services/volume_footprint.py):
// worked out by the server from the daily bars and the earnings dates it already stores, never from a
// vendor, and held for the session. Asked again every half hour, and every few seconds while the server
// works the stock out for the first time this session (`computing`); SWR skips ticks while the app is
// hidden. The pure half is volumeFootprintModel.js.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a section with too little history says what it needs.
// ⛔ AN EARNINGS MARK ONLY WHERE IT IS KNOWN; the panel names the span the held report dates cover.
// ⛔ A RECORD, NOT A FORECAST. Green and red mark the sign of a move only.
//
// WIDTH. Section 1 is label and value pairs that wrap between words. Sections 2 to 4 are tables of
// three or four columns of two-line cells that wrap between words in a snug or narrow panel; nothing
// folds away.
import { Fragment, useMemo } from 'react'
import { PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  VFP_CODE, VFP_SOURCE, VFP_WHAT, adDates, bigDaysLine, bigVolumeCell, changeText, earningsNote, fillCell,
  filledCell, gapCell, gapDayCell, gapsLine, partialYearText, pivotCells, pivotsLine, plural, rangeText, sessionsText, sharesText,
  signOf, updownText, vfpPollMs, vfpRead, vfpUrl, windowText, windowsAsOf,
} from './volumeFootprintModel'
import { dayText } from './ratesModel'
import styles from './marketPanels.module.css'
import own from './volumeFootprintPanel.module.css'

const signClass = (sign) => (sign === 'up' ? styles.up : sign === 'down' ? styles.down : undefined)
const WRAP = `${styles.phoneWrap} ${styles.snugWrap}`
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

/** The earnings mark beside a session: shown only when a report is known to be beside it. */
function EarningsTag({ value }) {
  return value === true ? <span className={own.tag} data-testid="terminal-vfp-earnings">earnings</span> : null
}

function Accumulation({ a }) {
  const w25 = a.windows.find((w) => w.sessions === 25) || { state: 'missing' }
  const w50 = a.windows.find((w) => w.sessions === 50) || { state: 'missing' }
  const min = formatPercent(a.minMovePct, { decimals: 1 })
  return (
    <Section title="Accumulation and distribution" asOf={windowsAsOf(a)} testId="terminal-vfp-accumulation">
      <Facts testId="terminal-vfp-ad" rows={[
        ['Last 25 sessions', windowText(w25), 'w25'],
        ['Last 50 sessions', windowText(w50), 'w50'],
        ['Up/down volume, 50 sessions', updownText(a.updown), 'updown'],
        ['Distribution days, last 25', w25.state === 'ok' ? adDates(a.days, 'distribution', 25) : 'n/a', 'dist'],
        ['Accumulation days, last 25', w25.state === 'ok' ? adDates(a.days, 'accumulation', 25) : 'n/a', 'acc'],
      ]} />
      <p className={styles.muted} data-testid="terminal-vfp-ad-method">
        {`An accumulation day closed at least ${min} above the session before on more volume than it; a distribution day closed at least ${min} below it on more volume. `}
        Up/down volume is the volume of the sessions that closed up over the volume of those that closed down; an
        unchanged close counts in neither. The {min} line is this screen&apos;s default.
      </p>
    </Section>
  )
}

function BigDays({ b, sym }) {
  const partial = partialYearText(b, sym)
  return (
    <Section title="The biggest volume days" asOf={closeOf(b.asOf)} testId="terminal-vfp-bigdays">
      <p className={styles.lede} data-testid="terminal-vfp-bigdays-line">{bigDaysLine(b, sym)}</p>
      {b.rows.length ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-vfp-bigdays-table" aria-label={`${sym}'s heaviest sessions of the last year, largest first`}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Volume</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => {
                const vol = bigVolumeCell(r, b.avgSessions)
                return (
                  <tr key={r.date} data-testid="terminal-vfp-bigday" data-earnings={r.earnings === null ? 'unknown' : String(r.earnings)}>
                    <td className={WRAP}>
                      {dayText(r.date)}
                      <EarningsTag value={r.earnings} />
                    </td>
                    <td className={WRAP}>
                      {vol.main}
                      <span className={own.sub}>{vol.sub}</span>
                    </td>
                    <td className={WRAP}>
                      <span className={signClass(signOf(r.changePct))}>{changeText(r.changePct)}</span>
                      <span className={own.sub}>{rangeText(r)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {partial ? <p className={styles.muted} data-testid="terminal-vfp-bigdays-partial">{partial}</p> : null}
      {b.noVolume ? (
        <p className={styles.muted} data-testid="terminal-vfp-bigdays-novolume">{`${plural(b.noVolume, 'session', 'sessions')} of the year ${b.noVolume === 1 ? 'has' : 'have'} no volume held and cannot be ranked.`}</p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-vfp-bigdays-method">
        {`The multiple is the day's volume over the average of the ${formatNumber(b.avgSessions)} sessions before it (the day itself left out). `}
        Change is close to close; where it closed in its range runs from 0% at the day&apos;s low to 100% at its high.
      </p>
    </Section>
  )
}

function Pivots({ p, sym }) {
  const partial = p.state === 'ok' ? partialYearText(p, sym) : null
  return (
    <Section title="Pocket pivots" asOf={closeOf(p.asOf)} testId="terminal-vfp-pivots">
      <p className={styles.lede} data-testid="terminal-vfp-pivots-line">{pivotsLine(p, sym)}</p>
      {p.rows.length ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-vfp-pivots-table" aria-label={`Every pocket pivot in ${sym} in the last year, newest first`}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Volume</th>
                <th scope="col">Close</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => {
                const pc = pivotCells(r)
                return (
                  <tr key={r.date} data-testid="terminal-vfp-pivot">
                    <td className={WRAP}>
                      {dayText(r.date)}
                      <EarningsTag value={r.earnings} />
                    </td>
                    <td className={WRAP}>
                      {sharesText(r.volume)}
                      <span className={own.sub}>{pc.volume}</span>
                    </td>
                    <td className={WRAP}>
                      <span className={signClass(signOf(r.changePct))}>{changeText(r.changePct)}</span>
                      <span className={own.sub}>{`${pc.aboveMa} vs the `}<span className={own.keep}>{`${formatNumber(p.ma)}-day line`}</span></span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {partial ? <p className={styles.muted} data-testid="terminal-vfp-pivots-partial">{partial}</p> : null}
      {p.state === 'ok' && p.notJudged ? (
        <p className={styles.muted} data-testid="terminal-vfp-pivots-notjudged">{`${plural(p.notJudged, 'up day', 'up days')} could not be judged: a volume it needs is not held.`}</p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-vfp-pivots-method">
        {`A pocket pivot is an up day whose volume is above the largest volume of any down day among the ${formatNumber(p.lookback)} sessions before it, closing above its ${formatNumber(p.ma)}-day moving average (the average of the ${formatNumber(p.ma)} closes through that day). `}
        {`With no down day among those ${formatNumber(p.lookback)} there is nothing to beat, so it does not count.`}
        {p.state === 'ok' && !p.fullYear && p.judgedFrom ? ` Judged from ${dayText(p.judgedFrom)}.` : ''}
      </p>
    </Section>
  )
}

function FillRow({ label, side, testId }) {
  const f5 = fillCell(side.within5)
  const f20 = fillCell(side.within20)
  return (
    <tr data-testid={testId}>
      <th scope="row" className={own.rowHead}>{label}</th>
      <td className={WRAP}>
        {side.count ? <>{plural(side.count, 'gap', 'gaps')}<span className={own.sub}>{side.open ? `${formatNumber(side.open)} still open` : 'all filled'}</span></> : 'none'}
      </td>
      <td className={WRAP}>{f5.main}<span className={own.sub}>{f5.sub}</span></td>
      <td className={WRAP}>{f20.main}<span className={own.sub}>{f20.sub}</span></td>
    </tr>
  )
}

function Gaps({ g, sym, earn, jumpPct }) {
  const flagged = g.rows.some((r) => r.check)
  const a = g.state === 'ok' ? g.summary.all : null
  return (
    <Section title="Gaps" asOf={g.state === 'ok' && g.asOf ? `Every session from ${dayText(g.first)} to the close of ${dayText(g.asOf)}.` : closeOf(g.asOf)} testId="terminal-vfp-gaps">
      <p className={styles.lede} data-testid="terminal-vfp-gaps-line">{gapsLine(g, sym)}</p>
      {g.state === 'ok' && g.total ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-vfp-fills" aria-label="How many gaps filled within 5 and within 20 sessions, all gaps, up gaps and down gaps">
            <thead>
              <tr>
                <th scope="col"><span className={own.sub}>Gaps</span></th>
                <th scope="col">How many</th>
                <th scope="col" className={WRAP}>Filled in 5</th>
                <th scope="col" className={WRAP}>Filled in 20</th>
              </tr>
            </thead>
            <tbody>
              <FillRow label="All" side={g.summary.all} testId="terminal-vfp-fills-all" />
              <FillRow label="Up" side={g.summary.up} testId="terminal-vfp-fills-up" />
              <FillRow label="Down" side={g.summary.down} testId="terminal-vfp-fills-down" />
            </tbody>
          </table>
        </div>
      ) : null}
      {g.rows.length ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-vfp-gaps-table" aria-label={`The newest gaps of ${formatNumber(g.minGapPct)}% or more in ${sym}, newest first`}>
            <thead>
              <tr>
                <th scope="col">Gap</th>
                <th scope="col" className={WRAP} title="The gap session's close against its own open">The day</th>
                <th scope="col">Filled</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => {
                const gc = gapCell(r)
                const dc = gapDayCell(r)
                const fc = filledCell(r)
                return (
                  <tr key={r.date} data-testid="terminal-vfp-gap" data-dir={r.up ? 'up' : 'down'} data-fill={fc.kind}>
                    <td className={WRAP}>
                      {gc.main}
                      <span className={own.sub}>{gc.sub}</span>
                      <EarningsTag value={r.earnings} />
                      {r.check ? <span className={own.check} data-testid="terminal-vfp-check">check the chart</span> : null}
                    </td>
                    <td className={WRAP}>
                      <span className={signClass(dc.sign)}>{dc.main}</span>
                      <span className={own.sub}>{dc.sub}</span>
                    </td>
                    <td className={WRAP}>
                      {fc.main}
                      {fc.sub ? <span className={own.sub}>{fc.sub}</span> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {g.state === 'ok' && g.total > g.rows.length ? (
        <p className={styles.muted} data-testid="terminal-vfp-gaps-cut">{`Listing the newest ${formatNumber(g.rows.length)} of ${formatNumber(g.total)}; the counts above take in every one.`}</p>
      ) : null}
      {a && earn.state === 'ok' && earn.cover && a.earningsKnown ? (
        <p className={styles.muted} data-testid="terminal-vfp-gaps-earnings">{`${plural(a.earningsKnown, 'gap falls', 'gaps fall')} inside the span the earnings dates cover; ${plural(a.earnings, 'was', 'were')} on an earnings report.`}</p>
      ) : null}
      {flagged ? (
        <p className={styles.muted} data-testid="terminal-vfp-check-note">{`A gap marked "check the chart" is over ${formatNumber(jumpPct)}%, or its session's close moved more than that: it can be a split the history did not adjust.`}</p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-vfp-gaps-method">
        {`A gap is a session that opened at least ${formatNumber(g.minGapPct)}% above or below the close before it. It filled when a later price traded back to that close (a low at or below it after a gap up, a high at or above it after a gap down), the gap session itself included; "in 5" counts the 5 sessions after the gap session. `}
        A share counts only the gaps old enough to say: filled in time, or that many sessions behind.
      </p>
    </Section>
  )
}

function VolumeFootprintBody({ sym: s, code }) {
  const inPanel = useInTerminalPanel()
  // Asked again soon while the server works the stock out for the first time this session (SETH's way), else
  // once a half hour.
  const read = useMarketRead(vfpUrl(s), { refreshInterval: (latest) => vfpPollMs(vfpRead(latest?.body)) })
  const view = useMemo(() => vfpRead(read.body), [read.body])
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(VFP_SOURCE, view.dataThrough) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-vfp" data-state={state} data-sym={s}>{body}</div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading the volume footprint for ${s}`} testId="terminal-vfp-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    if (err?.status === 400) {
      return frame('bad-symbol', (
        <PanelState kind="input" testId="terminal-vfp-bad-symbol" title={`${s} is not a stock or fund symbol this screen can read.`}>
          Type one first, e.g. <kbd>NVDA {code}</kbd>
        </PanelState>
      ))
    }
    const locked = err ? !canRetry(err) : false
    return frame('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-vfp-error"
        title={err ? failureText(err, VFP_WHAT) : `${VFP_WHAT} for ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `Retry, or run ${s} ${code} again.`}
      </PanelState>
    ))
  }
  const stale = read.error ? (
    <p className={styles.note} role="status" data-testid="terminal-vfp-stale-read">{failureText(read.error, VFP_WHAT)} Showing the last read.</p>
  ) : null
  if (view.state === 'computing') {
    return frame('computing', <PanelState kind="empty" role="status" testId="terminal-vfp-computing" title={WARMING_TITLE} />)
  }
  if (view.state === 'not_held') {
    return frame('not_held', (
      <>
        {stale}
        <PanelState kind="empty" role="status" testId="terminal-vfp-not-held" title={view.detail || `UCT holds no daily prices for ${s}.`}>
          The footprint is worked out only from the prices and volumes UCT already stores, never asked of a data vendor.
          That is not the same as {s} having no history.
        </PanelState>
      </>
    ))
  }
  if (view.state === 'busy') {
    return frame('busy', (
      <PanelState kind="empty" role="status" testId="terminal-vfp-busy" title={WARMING_TITLE}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {view.detail || 'The server is busy working out volume footprints. Try again in a moment.'}
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return frame('unavailable', (
      <PanelState kind="error" testId="terminal-vfp-unavailable" title={view.detail || `${VFP_WHAT} for ${s} could not be worked out just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no history. Retry, or run {s} {code} again.
      </PanelState>
    ))
  }
  return frame('ok', (
    <>
      {stale}
      <Accumulation a={view.accumulation} />
      <BigDays b={view.bigDays} sym={s} />
      <Pivots p={view.pivots} sym={s} />
      <Gaps g={view.gaps} sym={s} earn={view.earnings} jumpPct={view.jumpPct} />
      <p className={styles.muted} data-testid="terminal-vfp-earnings-note">{earningsNote(view.earnings, s)}</p>
      <p className={styles.muted} data-testid="terminal-vfp-source">
        {`From ${VFP_SOURCE}: settled sessions only, prices and volumes split-adjusted as the store serves them`}
        {view.sessions != null ? `, ${sessionsText(view.sessions)}` : ''}
        {view.first ? ` from ${dayText(view.first)}` : ''}
        {view.dataThrough ? ` through ${dayText(view.dataThrough)}` : ''}
        . Worked out by the server from what it already holds, once a session. A record, not a forecast.
      </p>
    </>
  ))
}

export default function VolumeFootprintPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || VFP_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new read, so one stock's footprint is never drawn under another's name.
  return <VolumeFootprintBody key={s} sym={s} code={code} />
}
