// SETH: how setups acted (breakouts, pullbacks, gaps in every correction and rally). `SETH`, `NVDA SETH`.
//
//   SETH          the universe study: a fixed library of setups, one table each (rows = the S&P 500's phase on the
//                 signal day: in a correction, the first 3 months after a low, later in an uptrend, all days)
//   NVDA SETH     every time each setup fired on that stock, newest first, and how the same setup did across the
//                 universe in the same phase
//   SETH MARKET   the study even on a panel that follows a group's stock (marketViewModel.js); a chip switches
//
// TWO reads (paid; api/services/setup_history.py), worked out by the server from the daily prices it already stores:
// the study once a week (outside trading hours), one stock on its first ask of the session. Neither is built on the
// request: until then the answer says so and this panel asks again (SWR skips ticks while the app is hidden). The
// pure half is setupHistoryModel.js. The horizon (5, 20 or 60 days after the next open) is a pick in the panel: both
// answers carry all three.
//
// ⛔ EVERY NUMBER SAYS HOW MANY SIGNALS IT RESTS ON, and under the backtester's floor the rates say "too few".
// ⛔ THE PHASE IS ASSIGNED WITH HINDSIGHT and the survivorship sentence is on every answer, said beside the numbers.
// ⛔ A RECORD, NOT A FORECAST. Green and red mark the sign of a return only.
//
// WIDTH. Each setup's table: the phase and four columns of short two-line cells that wrap between words; the worst
// and best fold on a phone (phoneHide). One stock's list: the day, the setup with its phase under it, and the three
// returns. Nothing scrolls sideways at 340px.
import { useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import { dayText } from './ratesModel'
import { isMarketView, marketViewArgs } from './marketViewModel'
import {
  SETH_CODE, SETH_DEFAULT_HORIZON, SETH_HORIZONS, SETH_SOURCE, SETH_URL, SETH_WHAT, changeText, countText, cutLine, excessCell,
  hitText, horizonLabel, phaseShort, rangeText, sethRead, sethStockRead, sethStockUrl, signOf, signalPhaseText, signalsText,
  stockLine, stockPollMs, studyLine, studyPollMs, tooFewText, universeLine,
} from './setupHistoryModel'
import styles from './marketPanels.module.css'
import own from './setupHistoryPanel.module.css'

export { SETH_CODE, SETH_SOURCE, SETH_URL, SETH_WHAT } from './setupHistoryModel'

const signClass = (sign) => (sign === 'up' ? styles.up : sign === 'down' ? styles.down : undefined)
const WRAP = `${styles.phoneWrap} ${styles.snugWrap}`
const HORIZON_OPTIONS = SETH_HORIZONS.map((h) => ({ value: String(h), label: horizonLabel(h) }))

function GroupRow({ g, h, min }) {
  const hz = g.horizons[h]
  const ex = excessCell(hz)
  return (
    <tr data-testid="terminal-seth-group" data-phase={g.phase} data-below={hz.below ? 'true' : undefined}>
      <th scope="row" className={`${own.rowHead} ${WRAP}`} title={g.words}>{phaseShort(g.phase)}</th>
      <td className={WRAP} data-testid="terminal-seth-n">
        {countText(hz.n)}
        {g.signals !== hz.n ? <span className={own.sub}>{`of ${countText(g.signals)}`}</span> : null}
      </td>
      {hz.below ? (
        <td colSpan={4} className={`${own.textCell} ${WRAP}`} data-testid="terminal-seth-too-few">
          <span className={own.sub}>{tooFewText(hz.n, min)}</span>
        </td>
      ) : (
        <>
          <td className={WRAP} data-testid="terminal-seth-hit">{hitText(hz.winRate)}</td>
          <td className={WRAP} data-testid="terminal-seth-avg">
            <span className={signClass(signOf(hz.avgPct))}>{changeText(hz.avgPct)}</span>
            <span className={own.sub}>{`median ${changeText(hz.medianPct)}`}</span>
          </td>
          <td className={`${WRAP} ${styles.phoneHide}`} data-testid="terminal-seth-range">{rangeText(hz)}</td>
          <td className={WRAP} data-testid="terminal-seth-excess" data-kind={hz.excessPct != null ? 'value' : hz.excessWhy || 'none'}>
            <span className={signClass(ex.sign)}>{ex.text}</span>
            {ex.sub ? <span className={own.sub}>{ex.sub}</span> : null}
          </td>
        </>
      )}
    </tr>
  )
}

function SetupTable({ s, h, min }) {
  return (
    <section className={own.setup} aria-label={s.name} data-testid="terminal-seth-setup" data-id={s.id}>
      <h3 className={own.title}>{s.name}</h3>
      {s.words ? <p className={own.words} data-testid="terminal-seth-words">{s.words}</p> : null}
      {s.state === 'capped' ? (
        <p className={styles.note} role="status" data-testid="terminal-seth-capped">{s.detail || 'This setup fired more often than the build holds, so its numbers are withheld.'}</p>
      ) : (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-seth-table"
            aria-label={`${s.name}: ${horizonLabel(h)} after the next open, by the S&P 500's phase on the signal day`}>
            <thead>
              <tr>
                <th scope="col" className={WRAP}>Phase</th>
                <th scope="col" title={`Signals with a return ${horizonLabel(h)} on (of all the signals in the phase)`}>Signals</th>
                <th scope="col" className={WRAP} title={`The share of signals up ${horizonLabel(h)} on`}>Hit rate</th>
                <th scope="col" className={WRAP} title="The average return, and the median under it">Average</th>
                <th scope="col" className={`${WRAP} ${styles.phoneHide}`} title="The worst and the best single return">Worst / best</th>
                <th scope="col" className={WRAP} title="The average excess over every stock on the same day that moved alike that day (percentage points)">vs same day</th>
              </tr>
            </thead>
            <tbody>
              {s.groups.map((g) => <GroupRow key={g.phase} g={g} h={h} min={min} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function HorizonPick({ h, onPick }) {
  return (
    <label className={`${styles.muted} ${styles.pick}`}>
      Return{' '}
      <Select value={String(h)} onChange={(e) => onPick(Number(e.target.value))} options={HORIZON_OPTIONS} className={styles.chip}
        data-testid="terminal-seth-horizon" aria-label="Return measured this many days after the next open" />
    </label>
  )
}

function Study({ run, h, onH, scope, inPanel }) {
  const read = useMarketRead(SETH_URL, { refreshInterval: (latest) => studyPollMs(sethRead(latest?.body)) })
  const view = useMemo(() => sethRead(read.body), [read.body])
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(SETH_SOURCE, view.dataThrough) : null)
  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-seth" data-state={state} data-view="study">
      <div className={styles.toolbar} role="toolbar" aria-label="How setups acted choices">
        {scope}
        <HorizonPick h={h} onPick={onH} />
      </div>
      {body}
    </div>
  )
  if (read.loading) return <PanelSkeleton label="Loading how setups acted" testId="terminal-seth-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return frame('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-seth-error"
        title={err ? failureText(err, SETH_WHAT) : `${SETH_WHAT} came back in a shape this panel cannot read.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `Retry, or run ${run} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return frame('computing', (
      <PanelState kind="empty" role="status" testId="terminal-seth-computing" title={WARMING_TITLE}>
        The server is working out how every setup acted across the stock universe, one stock at a time. That takes some
        minutes once a week; this panel fills in on its own.
      </PanelState>
    ))
  }
  if (view.state === 'waiting') {
    return frame('waiting', (
      <PanelState kind="empty" role="status" testId="terminal-seth-waiting" title="The setup study has not been worked out on this server yet.">
        {view.detail || 'It is worked out once a week, outside trading hours.'} That is not the same as no signals.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return frame('unavailable', (
      <PanelState kind="empty" role="status" testId="terminal-seth-unavailable"
        title={view.reason === 'index_not_held' ? "The S&P 500's history is not held on this server yet." : `${SETH_WHAT} could not be worked out just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        The study needs the index&apos;s corrections to group the signals. The server tries again on its own a little later.
      </PanelState>
    ))
  }
  const u = universeLine(view)
  return frame('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-seth-stale-read">{failureText(read.error, SETH_WHAT)} Showing the last read.</p> : null}
      <p className={styles.lede} data-testid="terminal-seth-summary">{studyLine(view)}</p>
      <p className={own.caveat} data-testid="terminal-seth-hindsight">{view.phases.hindsight}</p>
      {view.setups.map((s) => <SetupTable key={s.id} s={s} h={h} min={view.minSignals} />)}
      {view.universe.caveat ? <p className={own.caveat} data-testid="terminal-seth-survivorship">{view.universe.caveat}</p> : null}
      <p className={styles.muted} data-testid="terminal-seth-method">
        {`Each return runs from the open of the session after the signal to the open ${horizonLabel(h)} after that, so the signal is known before the fill. `}
        {view.method.perRun ? `${view.method.perRun} ` : ''}
        {`Below ${view.minSignals} signals a group shows its count and no rates. "vs same day" compares each signal with every stock in the universe that moved alike on the same day (the screen backtester's control), averaged over the signals that had such a match; returns are clipped at ${view.method.winsorPct ?? 50}% there. `}
        {view.method.observations ? `${view.method.observations} ` : ''}
        {view.phases.definition ? `${view.phases.definition} ` : ''}
        {view.method.window ? `${view.method.window} ` : ''}
        {u ? `${u} ` : ''}
        {`From ${SETH_SOURCE}: split-adjusted, dividends not included. Worked out once a week${view.builtAt ? ` (last ${dayText(view.builtAt.slice(0, 10))})` : ''}. A record, not a forecast.`}
      </p>
      {view.dropped.length ? (
        <>
          <p className={styles.muted} data-testid="terminal-seth-dropped-title">Setups left out, and why:</p>
          <ul className={own.dropped} data-testid="terminal-seth-dropped">
            {view.dropped.map((d) => <li key={d.name}>{`${d.name}: ${d.why}`}</li>)}
          </ul>
        </>
      ) : null}
      {view.refreshing ? <p className={styles.muted} role="status" data-testid="terminal-seth-refreshing">This week&apos;s study is being worked out on the server; this is last week&apos;s.</p> : null}
    </>
  ))
}

function UniverseTable({ view, h }) {
  const u = view.universe
  if (u.state !== 'ok') {
    const words = u.state === 'computing' ? 'The study across the universe is being worked out on the server; its lines fill in on their own.'
      : u.state === 'waiting' ? 'The study across the universe has not been worked out on this server yet (once a week, outside trading hours).'
        : 'The study across the universe could not be read just now.'
    return <p className={styles.muted} role="status" data-testid="terminal-seth-universe-missing" data-kind={u.state}>{words}</p>
  }
  if (!u.pairs.length) return null
  const span = u.from && u.to ? ` (${dayText(u.from)} to ${dayText(u.to)})` : ''
  return (
    <>
      <h3 className={own.title}>The same setups across the universe</h3>
      <p className={own.words} data-testid="terminal-seth-universe-line">
        {`How each setup did across every stock in the study, in the same phase${span}, ${horizonLabel(h)} after the next open.`}
      </p>
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-seth-universe" aria-label={`How the same setups did across the universe in the same phase, ${horizonLabel(h)} on`}>
          <thead>
            <tr>
              <th scope="col" className={WRAP}>Setup</th>
              <th scope="col">Signals</th>
              <th scope="col" className={WRAP}>Hit rate</th>
              <th scope="col" className={WRAP}>Average</th>
            </tr>
          </thead>
          <tbody>
            {u.pairs.map((p) => {
              const hz = p.horizons[h]
              return (
                <tr key={p.key} data-testid="terminal-seth-universe-row" data-key={p.key}>
                  <th scope="row" className={`${own.rowHead} ${WRAP}`}>{p.name}<span className={own.sub}>{phaseShort(p.phase)}</span></th>
                  <td className={WRAP}>{countText(hz.n)}</td>
                  {hz.below ? (
                    <td colSpan={2} className={`${own.textCell} ${WRAP}`}><span className={own.sub}>{tooFewText(hz.n, u.minSignals)}</span></td>
                  ) : (
                    <>
                      <td className={WRAP}>{hitText(hz.winRate)}</td>
                      <td className={WRAP}>
                        <span className={signClass(signOf(hz.avgPct))}>{changeText(hz.avgPct)}</span>
                        <span className={own.sub}>{`median ${changeText(hz.medianPct)}`}</span>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {u.note ? <p className={own.caveat} data-testid="terminal-seth-universe-survivorship">{u.note}</p> : null}
    </>
  )
}

function StockView({ sym, code, h, onH, scope, inPanel }) {
  const read = useMarketRead(sethStockUrl(sym), { refreshInterval: (latest) => stockPollMs(sethStockRead(latest?.body)) })
  const view = useMemo(() => sethStockRead(read.body), [read.body])
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(SETH_SOURCE, view.dataThrough) : null)
  const frame = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-seth" data-state={state} data-view="stock" data-sym={sym}>
      <div className={styles.toolbar} role="toolbar" aria-label="How setups acted choices">
        {scope}
        <HorizonPick h={h} onPick={onH} />
      </div>
      {body}
    </div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading ${sym}'s setups`} testId="terminal-seth-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    if (err?.status === 400) {
      return frame('bad-symbol', (
        <PanelState kind="input" testId="terminal-seth-bad-symbol" title={`${sym} is not a stock or fund symbol this screen can read.`}>
          Type one first, e.g. <kbd>NVDA {code}</kbd>
        </PanelState>
      ))
    }
    const locked = err ? !canRetry(err) : false
    return frame('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-seth-error"
        title={err ? failureText(err, SETH_WHAT) : `${SETH_WHAT} for ${sym} came back in a shape this panel cannot read.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `Retry, or run ${sym} ${code} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return frame('computing', (
      <PanelState kind="empty" role="status" testId="terminal-seth-computing" title={WARMING_TITLE}>
        {`The server is reading ${sym}'s stored prices and finding every setup. That takes a few seconds; this panel fills in on its own.`}
      </PanelState>
    ))
  }
  if (view.state === 'not_held') {
    return frame('not_held', (
      <PanelState kind="empty" role="status" testId="terminal-seth-not-held" title={view.detail || `UCT holds no daily prices for ${sym}.`}>
        {`The setups are found only in the prices UCT already stores, never asked of a data vendor. That is not the same as ${sym} having no history.`}
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return frame('unavailable', (
      <PanelState kind="error" testId="terminal-seth-unavailable" title={view.detail || `${SETH_WHAT} for ${sym} could not be worked out just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {`That is not the same as no signals. Retry, or run ${sym} ${code} again.`}
      </PanelState>
    ))
  }
  const cut = cutLine(view)
  return frame('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-seth-stale-read">{failureText(read.error, SETH_WHAT)} Showing the last read.</p> : null}
      <p className={styles.lede} data-testid="terminal-seth-stock-summary">
        <PanelSymbol sym={sym} className={styles.sym} /><span>{` ${stockLine(view)}`}</span>
      </p>
      {view.phases.hindsight ? <p className={own.caveat} data-testid="terminal-seth-hindsight">{view.phases.hindsight}</p> : null}
      {view.signals.length ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-seth-signals" aria-label={`Every setup signal on ${sym}, newest first, ${signalsText(view.shown)}`}>
            <thead>
              <tr>
                <th scope="col" className={WRAP}>Day</th>
                <th scope="col" className={`${own.textCell} ${WRAP}`} title="The setup, and the S&P 500's phase that day">Setup</th>
                {SETH_HORIZONS.map((x) => (
                  <th key={x} scope="col" className={WRAP} title={`From the next open to the open ${horizonLabel(x)} after it`}>{horizonLabel(x)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.signals.map((r) => (
                <tr key={`${r.date} ${r.setup}`} data-testid="terminal-seth-signal" data-setup={r.setup} data-phase={r.phase || 'none'}>
                  <td className={WRAP}>{dayText(r.date)}</td>
                  <td className={`${own.textCell} ${WRAP}`}>{r.name}<span className={own.sub}>{signalPhaseText(r.phase)}</span></td>
                  {SETH_HORIZONS.map((x) => (
                    <td key={x} className={WRAP} data-kind={r.returns[x] == null ? 'notyet' : 'value'}>
                      {r.returns[x] == null
                        ? <span className={styles.muted} title="Not that many sessions have passed since the signal">not yet</span>
                        : <span className={signClass(signOf(r.returns[x]))}>{changeText(r.returns[x])}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {cut ? <p className={styles.note} role="status" data-testid="terminal-seth-cut">{cut}</p> : null}
      <UniverseTable view={view} h={h} />
      <p className={styles.muted} data-testid="terminal-seth-stock-method">
        {view.fill ? `${view.fill} ` : ''}
        {view.perRun ? `${view.perRun} ` : ''}
        {view.phases.state !== 'ok' ? "The S&P 500's corrections are not held yet, so no signal has a phase. " : ''}
        {`From ${SETH_SOURCE}: split-adjusted, dividends not included. A record, not a forecast.`}
      </p>
    </>
  ))
}

export default function SetupHistoryPanel({ sym, view: viewProp }) {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || SETH_CODE
  const writeBack = usePanelWriteBack()
  const s = String(sym || '').trim().toUpperCase() || null
  const [market, setMarket] = useState(() => isMarketView(viewProp))
  const [h, setH] = useState(SETH_DEFAULT_HORIZON)
  const asked = s && !market ? s : null
  const onScope = (toMarket) => {
    if (!writeBack(marketViewArgs(toMarket), s)) setMarket(toMarket)
  }
  const onH = (next) => setH(SETH_HORIZONS.includes(next) ? next : SETH_DEFAULT_HORIZON)
  const scope = s ? (
    <div className={styles.group} role="group" aria-label="Whose setups">
      <button type="button" className={styles.chip} aria-pressed={!!asked} data-testid="terminal-seth-view-stock"
        title={`Every setup on ${s} (${s} ${code})`} onClick={() => (asked ? null : onScope(false))}>{s}</button>
      <button type="button" className={styles.chip} aria-pressed={!asked} data-testid="terminal-seth-view-market"
        title={`How each setup acted across the universe (${code} MARKET)`} onClick={() => (asked ? onScope(true) : null)}>All stocks</button>
    </div>
  ) : null
  const run = s ? `${s} ${code} MARKET` : code
  // Keyed by what is asked: a new stock is a new read, never drawn under another's name.
  return asked
    ? <StockView key={asked} sym={asked} code={code} h={h} onH={onH} scope={scope} inPanel={inPanel} />
    : <Study key="market" run={run} h={h} onH={onH} scope={scope} inPanel={inPanel} />
}
