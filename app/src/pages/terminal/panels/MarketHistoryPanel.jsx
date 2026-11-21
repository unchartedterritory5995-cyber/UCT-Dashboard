// MKTH: market history. Every correction and bear market of the S&P 500 or the Nasdaq-100 on
// closing prices, newest first; open one to see the rally after its low and the stocks that led it.
// `MKTH`, `MKTH NDX`.
//
//   MKTH        the S&P 500 (the default)          MKTH NDX     the Nasdaq-100 (also NASDAQ, QQQ)
//
// ONE read, `GET /api/research/market-history` (paid; api/services/market_history.py). The server
// works everything out from its own stored closes once each evening and holds the answer; the first
// time it works it out, the leaders say so and this panel asks again every few seconds. Otherwise it
// asks every half hour; SWR skips ticks while the app is hidden. The pure half is marketHistoryModel.js.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a rally window the history has not reached says "not yet"; a leaders
// list too recent or too thin says why.
// ⛔ A RECORD, NOT A FORECAST. Green and red mark the sign of a return only.
// ⛔ EVERY LEADERS LIST CARRIES THE SURVIVORSHIP SENTENCE: the history holds only stocks that trade today.
//
// WIDTH. One five-column table (two-line cells), two columns of which fold away on a phone. An open
// row's detail spans the table: a short rally list, a three-column leaders table (the stock's sector
// on a second line), a three-column sector table, each wrapping between words, nothing folded.
import { Fragment, useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import UIcon from '../../../components/ui/UIcon'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  CHECK_NOTE, COMPUTING_POLL_MS, HELD_POLL_MS, MKTH_CODE, MKTH_INDEXES, MKTH_SOURCE, MKTH_URL, MKTH_WHAT, RALLY_MONTHS,
  changeText, isComputing, kindText, leadersText, levelText, mkthCommandArgs, mkthRead, normMkthIndex, pointsText,
  rallyCell, recoveryCell, sectorsText, sessionsText, signOf, spanText, storeLine, summaryLine,
} from './marketHistoryModel'
import { dayText } from './ratesModel'
import styles from './marketPanels.module.css'
import own from './marketHistoryPanel.module.css'

export { COMPUTING_POLL_MS, HELD_POLL_MS, MKTH_CODE, MKTH_SOURCE, MKTH_URL, MKTH_WHAT } from './marketHistoryModel'

const INDEX_OPTIONS = MKTH_INDEXES.map((i) => ({ value: i.key, label: i.label }))
const COLS = 5

const signClass = (sign) => (sign === 'up' ? styles.up : sign === 'down' ? styles.down : undefined)

function Leaders({ ld, indexName }) {
  if (ld.state !== 'ok') {
    return (
      <p className={ld.state === 'computing' ? styles.muted : styles.note} role="status" data-testid="terminal-mkth-leaders-missing" data-kind={ld.state}>
        {leadersText(ld, indexName)}
      </p>
    )
  }
  const flagged = ld.top.some((r) => r.check)
  return (
    <>
      <p className={styles.muted} data-testid="terminal-mkth-leaders-line">{leadersText(ld, indexName)}</p>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-mkth-leaders"
          aria-label={`The stocks that rose most in the 63 sessions after the ${indexName} low of ${dayText(ld.trough)}`}>
          <thead>
            <tr>
              <th scope="col">Stock</th>
              <th scope="col">Return</th>
              <th scope="col" title={`The stock's return less the ${indexName}'s over the same days`}>{`vs ${indexName}`}</th>
            </tr>
          </thead>
          <tbody>
            {ld.top.map((r, i) => (
              <tr key={r.sym} data-testid="terminal-mkth-leader" data-sym={r.sym}>
                <td className={`${styles.phoneWrap} ${styles.markRoom}`}>
                  <span className={styles.rowNum}>{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                  <br />
                  <span className={styles.muted}>{r.sector || 'Sector not held'}</span>
                  {r.check ? <span className={own.check} data-testid="terminal-mkth-check">check the chart</span> : null}
                </td>
                <td><span className={signClass(signOf(r.returnPct))}>{changeText(r.returnPct)}</span></td>
                <td><span className={signClass(signOf(r.vsIndexPct))}>{pointsText(r.vsIndexPct)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {flagged ? <p className={styles.muted} data-testid="terminal-mkth-check-note">{CHECK_NOTE}</p> : null}
      <h4 className={own.blockTitle}>Sectors over the same days</h4>
      <p className={styles.muted} data-testid="terminal-mkth-sectors-line">{sectorsText(ld)}</p>
      {ld.sectors.length ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-mkth-sectors" aria-label="Each sector's median return over the same days">
            <thead>
              <tr>
                <th scope="col">Sector</th>
                <th scope="col">Median</th>
                <th scope="col">Stocks</th>
              </tr>
            </thead>
            <tbody>
              {ld.sectors.map((s) => (
                <tr key={s.sector} data-testid="terminal-mkth-sector">
                  <td className={styles.phoneWrap}>{s.sector}</td>
                  <td><span className={signClass(signOf(s.medianPct))}>{changeText(s.medianPct)}</span></td>
                  <td>{s.count ?? 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  )
}

function Detail({ ep, indexName, id }) {
  return (
    <div className={own.detail} id={id} data-testid="terminal-mkth-detail">
      <p className={styles.muted} data-testid="terminal-mkth-levels">
        {`Peak ${levelText(ep.peak.close)} on ${dayText(ep.peak.date)}; low ${levelText(ep.trough.close)} on ${dayText(ep.trough.date)}, `}
        {`${sessionsText(ep.sessionsDown)} later.`}
        {ep.peakAtStart ? ' The peak is the first close in the history UCT holds; the real peak may be earlier.' : ''}
      </p>
      <h4 className={own.blockTitle}>{`The ${indexName} after the low`}</h4>
      <dl className={styles.fields} data-testid="terminal-mkth-rally">
        {RALLY_MONTHS.map((m) => {
          const c = rallyCell(ep, m)
          return (
            <Fragment key={m}>
              <dt>{`${c.label} later`}</dt>
              <dd data-testid={`terminal-mkth-rally-${m}`} data-kind={c.kind}>
                {c.kind === 'value'
                  ? <><span className={signClass(c.sign)}>{c.text}</span>{c.date ? <span className={styles.muted}>{` (to ${dayText(c.date)})`}</span> : null}</>
                  : <span className={styles.muted} title="The history has not reached this day yet">not yet</span>}
              </dd>
            </Fragment>
          )
        })}
      </dl>
      <h4 className={own.blockTitle}>Leaders of the rally</h4>
      <Leaders ld={ep.leaders} indexName={indexName} />
      <p className={styles.muted} data-testid="terminal-mkth-survivorship">{ep.leaders.note}</p>
    </div>
  )
}

function Episodes({ ix, open, setOpen }) {
  // Measured 2026-11-21 on a real screen: 507px with every column (a 462px panel scrolled it 58px
  // sideways), so it folds "Down" and "3 months on" from the 550 step down; both are in the open row.
  return (
    <div className={styles.tableBox} data-fold="550">
      <table className={styles.table} data-testid="terminal-mkth-table"
        aria-label={`Every decline of 10% or more in the ${ix.name}, newest first`}>
        <thead>
          <tr>
            <th scope="col">Peak to low</th>
            <th scope="col">Depth</th>
            <th scope="col" className={styles.phoneHide}>Down</th>
            <th scope="col">Recovered</th>
            <th scope="col" className={styles.phoneHide} title={`The ${ix.name}, 3 months after the low`}>3 months on</th>
          </tr>
        </thead>
        <tbody>
          {ix.episodes.map((ep) => {
            const isOpen = open === ep.id
            const rec = recoveryCell(ep)
            const r3 = rallyCell(ep, 3)
            const detailId = `terminal-mkth-detail-${ep.id}`
            return (
              <Fragment key={ep.id}>
                <tr data-testid="terminal-mkth-row" data-id={ep.id} data-kind={ep.kind} data-open={isOpen ? 'true' : undefined}
                  className={isOpen ? own.openRow : undefined}>
                  <td className={styles.phoneWrap}>
                    <button type="button" className={`${styles.rowBtn} ${own.toggle}`} aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined}
                      onClick={() => setOpen(isOpen ? null : ep.id)} data-testid={`terminal-mkth-open-${ep.id}`}>
                      <UIcon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} gold={false} />
                      <span className={own.span}>{spanText(ep)}</span>
                    </button>
                    <br />
                    <span className={ep.kind === 'bear' ? own.bear : styles.muted} data-testid="terminal-mkth-kind">
                      {kindText(ep.kind)}{ep.ongoing ? ', still below the peak' : ''}
                    </span>
                  </td>
                  <td><span className={styles.down}>{changeText(ep.depthPct)}</span></td>
                  <td className={styles.phoneHide}>{sessionsText(ep.sessionsDown)}</td>
                  <td className={styles.phoneWrap} data-testid="terminal-mkth-recovered">
                    {rec.main}
                    {rec.sub ? <><br /><span className={styles.muted}>{rec.sub}</span></> : null}
                  </td>
                  <td className={styles.phoneHide} data-kind={r3.kind}>
                    {r3.kind === 'value' ? <span className={signClass(r3.sign)}>{r3.text}</span> : <span className={styles.muted}>not yet</span>}
                  </td>
                </tr>
                {isOpen ? (
                  <tr className={own.detailRow}>
                    <td colSpan={COLS} className={own.detailCell}><Detail ep={ep} indexName={ix.name} id={detailId} /></td>
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

function MarketHistoryRead({ code, index, pick }) {
  const inPanel = useInTerminalPanel()
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(MKTH_URL, { refreshInterval: pace })
  const view = useMemo(() => mkthRead(read.body), [read.body])
  const [open, setOpen] = useState(null)
  // The pace follows the server's own word (adjusted during render from the last answer).
  const wantPace = isComputing(view) ? COMPUTING_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(MKTH_SOURCE, view.dataThrough) : null)

  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-mkth" data-state={state} data-index={index}>{body}</div>
  )
  if (read.loading) return frame('loading', <PanelSkeleton label="Loading market history" testId="terminal-mkth-loading" />)
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return frame('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-mkth-error"
        title={err ? failureText(err, MKTH_WHAT) : `${MKTH_WHAT} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `Retry, or run ${code} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return frame('computing', (
      <PanelState kind="empty" role="status" testId="terminal-mkth-computing" title={WARMING_TITLE}>
        The server is working out every correction from its stored closes for the first time. This fills in on its own.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return frame('unavailable', (
      <PanelState kind="empty" role="status" testId="terminal-mkth-unavailable"
        title={view.reason === 'not_held' ? 'The index history is not held on this server yet.' : `${MKTH_WHAT} could not be worked out just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {view.reason === 'not_held'
          ? 'The S&P 500 and Nasdaq-100 daily closes fill in as the server stores them. That is not the same as no corrections.'
          : 'The server tries again on its own a little later.'}
      </PanelState>
    ))
  }

  const ix = view.indexes[index]
  const picker = (
    <div className={styles.toolbar} role="toolbar" aria-label="Market history controls">
      <label className={`${styles.muted} ${styles.pick}`}>
        Index{' '}
        <Select value={index} onChange={(e) => pick(e.target.value)} options={INDEX_OPTIONS} className={styles.chip} data-testid="terminal-mkth-index" />
      </label>
    </div>
  )
  const store = storeLine(view)
  return frame('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-mkth-stale-read">{failureText(read.error, MKTH_WHAT)} Showing the last read.</p> : null}
      {picker}
      {ix.state !== 'ok' ? (
        <PanelState kind="empty" role="status" testId="terminal-mkth-index-not-held" title={ix.detail || `UCT does not hold the ${ix.name}'s daily closes on this server yet.`}>
          {`The other index may be held: switch above. That is not the same as no corrections in the ${ix.name}.`}
        </PanelState>
      ) : (
        <>
          <p className={styles.lede} data-testid="terminal-mkth-summary">{summaryLine(ix)}</p>
          {view.leaders.state === 'computing'
            ? <p className={styles.muted} role="status" data-testid="terminal-mkth-leaders-computing">The leaders of each rally are still being worked out on the server; they fill in on their own.</p>
            : null}
          {view.leaders.state === 'failed'
            ? <p className={styles.note} role="status" data-testid="terminal-mkth-leaders-failed">The leaders of each rally could not be worked out just now. The server tries again on its own a little later; the declines above stand.</p>
            : null}
          {ix.episodes.length ? <Episodes ix={ix} open={open} setOpen={setOpen} /> : null}
        </>
      )}
      {view.definition ? <p className={styles.muted} data-testid="terminal-mkth-definition">{view.definition}</p> : null}
      <p className={styles.muted} data-testid="terminal-mkth-method">
        Closing prices from {MKTH_SOURCE}{view.dataThrough ? ` through ${dayText(view.dataThrough)}` : ''}: split-adjusted, dividends not
        included. The rally is measured from the low&apos;s close to the first close on or after the same day 1, 3, 6 and 12 months
        later; leaders over the 63 sessions after the low. {view.indexNote || ''} A record of what happened, not a forecast.
        {store ? ` ${store}` : ''}
      </p>
    </>
  ))
}

function MarketHistoryBody({ code, index: indexProp }) {
  const writeBack = usePanelWriteBack()
  const [index, setIndex] = useState(() => normMkthIndex(indexProp))
  // The index writes itself into the command (`MKTH NDX`) where the registry takes it; outside the
  // shell it stays in this panel's own state. Both indexes come in the one answer: no new read.
  const pick = (raw) => {
    const next = normMkthIndex(raw)
    if (next === index) return
    setIndex(next)
    writeBack(mkthCommandArgs({ index: next }))
  }
  return <MarketHistoryRead code={code} index={index} pick={pick} />
}

export default function MarketHistoryPanel({ index }) {
  const code = useInTerminalPanel()?.code || MKTH_CODE
  // Keyed by the command's index: `MKTH NDX` typed over `MKTH` opens on the right index.
  return <MarketHistoryBody key={normMkthIndex(index)} code={code} index={index} />
}
