import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import { withDeadline } from '../../../utils/withDeadline'
import { usePendingReask, PENDING_REASK_MS } from '../depth/depthFetch'
import { STRATEGIES } from './optionPayoff'
import {
  ENTRY_DTES, EXIT_PCTS, OFFSETS, WIDTHS, offsetLabel, money, legsLabel, exitLabel,
  summaryFacts, excludedText, notRunText, ivText, plainBacktest,
} from './optionBacktest'
import styles from './OptionsChainTab.module.css'
import { usePanelFreshness, panelAsOf } from '../../../components/terminal/terminalPanel'
import useDarkSection from '../../optionsAnalytics/useDarkSection'
import FailedRead from '../../optionsAnalytics/FailedRead'
import Select from '../../../components/ui/Select'

// BRK-01 increment 4 (roadmap RM-L01): the options strategy backtester, under the chain.
//
// ⛔ A HISTORICAL SIMULATION, NOT A TRADE. The one button is "Simulate": it asks the server to
//    replay a rule over past monthly expirations. Nothing here places, stages or sends an order,
//    and there is no link to a broker.
// ⛔ The run happens OFF the request (POST queues a job, this panel polls it). The poll ticks every
//    2 s ONLY while the server says queued/running, and stops at done/failed (pollingSites rail).
// ⛔ Every gap the server reports is shown, never smoothed: excluded expirations with their
//    reasons, expirations the request budget did not reach, and -- under 6 trades -- the sentence
//    instead of a summary. An IV is labelled COMPUTED.

const POLL_MS = 2000

// THE EARNINGS ANCHOR IS ON (live sweep 2026-10-05). It was offered disabled because FMP carries no
// before-open / after-close time, so every earnings run excluded every quarter. O4 (options lane,
// 2026-10-05) fills `reportTime` in iv_history._default_prints -- the reader
// options_backtest._default_prints uses -- from the earnings calendar's per-symbol `hour`. A quarter
// the calendar does not time is still excluded server-side with its reason, never guessed.
export const EARNINGS_TIMING_ON_FILE = true
export const EARNINGS_ANCHOR_OFF_NOTE = 'Earnings prints are not available yet: our earnings file does not record whether a company reported before the open or after the close, so no print can be placed and every run would return zero trades.'

// A 429 whose Retry-After is at most this is a SHORT wait (the shared pool is full, or the
// member already has runs in flight): the panel asks again by itself. The hourly cap's wait is
// minutes long and keeps its own sentence ("Try again in N min.").
export const BUSY_REASK_MAX_WAIT_S = 60

// Quality pass 2026-10-05: the POST had no timeout (a hung pod left "Simulate" disabled
// forever), and a busy 429 said "Try again in a minute" with nothing asking again.
async function startRun(sym, body) {
  const url = `/api/research/options/${encodeURIComponent(sym)}/backtest`
  const r = await withDeadline(fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), url)
  let j = null
  try { j = await r.json() } catch { /* a non-JSON body is a failure below */ }
  if (r.status === 402) return { error: 'The backtester requires a paid plan.' }
  if (r.status === 429) {
    const wait = Number(r.headers?.get?.('Retry-After'))
    if (Number.isFinite(wait) && wait > 0 && wait <= BUSY_REASK_MAX_WAIT_S) return { busy: true }
  }
  if (!r.ok || !j) return { error: (j && typeof j.detail === 'string') ? j.detail : `The backtest could not start (${r.status}).` }
  return { status: j }
}

// `earningsAnchor` defaults to EARNINGS_TIMING_ON_FILE; tests pass it to keep the earnings path covered.
export default function BacktestPanel({ sym, earningsAnchor = EARNINGS_TIMING_ON_FILE }) {
  const [kind, setKind] = useState('long_call')
  const [dte, setDte] = useState(30)
  const [offset, setOffset] = useState(0)
  const [width, setWidth] = useState(1)
  const [tp, setTp] = useState('')
  const [sl, setSl] = useState('')
  const [started, setStarted] = useState(null)   // the POST's own status answer
  const [startError, setStartError] = useState(null)
  const [busy, setBusy] = useState(false)
  // The request body of a start the server refused as busy; while set, usePendingReask posts it
  // again every PENDING_REASK_MS (at most PENDING_REASK_MAX times).
  const [waiting, setWaiting] = useState(null)

  // FT-011: the further structures and the earnings anchor. The catalog route answers 404 until
  // OPTIONS_BACKTEST_MORE_ENABLED, and then this panel is exactly the first slice.
  const cat = useDarkSection(sym ? `/api/research/options/${encodeURIComponent(sym)}/backtest-catalog` : null)
  const more = Array.isArray(cat.data?.strategies) ? cat.data : null
  const [anchor, setAnchor] = useState('monthly')
  const earnings = Boolean(more) && earningsAnchor && anchor === 'earnings'
  const choices = more
    ? more.strategies.map((x) => [x.id, x.label, x.uses_width])
    : Object.entries(STRATEGIES).map(([k, v]) => [k, v.label, v.strikes === 2])

  const job = started?.job
  const poll = useSWR(job ? `/api/research/options/${encodeURIComponent(sym)}/backtest/${job}` : null, sectionFetcher, {
    fallbackData: started || undefined,
    refreshInterval: (d) => (d && (d.state === 'queued' || d.state === 'running') ? POLL_MS : 0),
    revalidateOnFocus: false,
  })
  const st = poll.data
  const spread = Boolean(choices.find(([k]) => k === kind)?.[2])
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  // Nothing to source until a run has finished; the inputs are the member's own.
  // `as_of` is when the run finished (a cached identical run keeps its own finish time).
  usePanelFreshness(st?.state === 'done' ? panelAsOf('Massive options history, simulated by UCT', st.as_of) : null)

  async function onSimulate() {
    setBusy(true)
    setStartError(null)
    const body = earnings
      ? { strategy: kind, anchor: 'earnings', offset, width: spread ? width : 0 }
      : { strategy: kind, dte, offset, width: spread ? width : 0 }
    if (earnings) { /* one session in, one out: no exit rule */ } else {
      if (tp) body.take_profit_pct = Number(tp)
      if (sl) body.stop_loss_pct = Number(sl)
    }
    setWaiting(null)
    try {
      settle(await startRun(sym, body), body)
    } catch (e) {
      settleFailure(e)
    } finally {
      setBusy(false)
    }
  }

  function settle(out, body) {
    if (out.busy) { setWaiting(body); setStarted(null); return }
    setWaiting(null)
    if (out.error) { setStartError(out.error); setStarted(null) } else setStarted(out.status)
  }
  function settleFailure(e) {
    setWaiting(null)
    setStartError(e?.timedOut
      ? 'The backtest could not start: the server did not answer within 30 seconds.'
      : 'The backtest could not start: the request failed.')
  }

  const reask = useCallback(async () => {
    if (!waiting) return
    try { settle(await startRun(sym, waiting), waiting) } catch (e) { settleFailure(e) }
  }, [waiting, sym]) // eslint-disable-line react-hooks/exhaustive-deps
  const { exhausted, retry } = usePendingReask(Boolean(waiting), reask, sym)

  const r = st?.state === 'done' ? st.result : null
  return (
    <section className={styles.payoff} data-testid="backtest">
      <div className={styles.volHead}>
        Backtest — a historical simulation over {earnings ? 'past earnings prints' : 'past monthly expirations'}
      </div>
      <div className={styles.head}>
        <label>Strategy{' '}
          <Select aria-label="Backtest strategy" value={kind} onChange={(e) => setKind(e.target.value)}>
            {choices.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </label>
        {more && (
          // Audit 2026-10-08 (OBT, point 20): "Anchor" and "AMC / BMO" were unexplained shorthand.
          <label>Time entries to{' '}
            <Select aria-label="Entry anchor" value={anchor} onChange={(e) => setAnchor(e.target.value)}>
              <option value="monthly">Monthly expirations</option>
              <option value="earnings" disabled={!earningsAnchor}>
                {earningsAnchor ? 'Earnings reports (after the close or before the open)'
                  : 'Earnings reports (after the close or before the open) — not available yet'}
              </option>
            </Select>
          </label>
        )}
        {more && !earningsAnchor && <span className={styles.muted} data-testid="backtest-earnings-off">{EARNINGS_ANCHOR_OFF_NOTE}</span>}
        {!earnings && <label>Enter{' '}
          <Select aria-label="Entry days before expiry" value={dte} onChange={(e) => setDte(Number(e.target.value))}>
            {ENTRY_DTES.map((d) => <option key={d} value={d}>{d} trading days before expiry</option>)}
          </Select>
        </label>}
        <label>Strike{' '}
          <Select aria-label="Strike offset" value={offset} onChange={(e) => setOffset(Number(e.target.value))}>
            {OFFSETS.map((k) => <option key={k} value={k}>{offsetLabel(k)}</option>)}
          </Select>
        </label>
        {spread && (
          <label>Width{' '}
            <Select aria-label="Spread width" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
              {WIDTHS.map((w) => <option key={w} value={w}>{w} strike{w === 1 ? '' : 's'}</option>)}
            </Select>
          </label>
        )}
        {!earnings && <label>Exit at profit{' '}
          <Select aria-label="Take profit" value={tp} onChange={(e) => setTp(e.target.value)}>
            <option value="">hold to expiry</option>
            {EXIT_PCTS.map((p) => <option key={p} value={p}>+{p}%</option>)}
          </Select>
        </label>}
        {!earnings && <label>Exit at loss{' '}
          <Select aria-label="Stop loss" value={sl} onChange={(e) => setSl(e.target.value)}>
            <option value="">hold to expiry</option>
            {EXIT_PCTS.map((p) => <option key={p} value={p}>-{p}%</option>)}
          </Select>
        </label>}
        <button type="button" onClick={onSimulate} disabled={busy || Boolean(waiting && !exhausted) || st?.state === 'queued' || st?.state === 'running'}
                data-testid="backtest-simulate">
          Simulate
        </button>
      </div>

      {startError && <p className={styles.note} data-testid="backtest-error">{startError}</p>}
      {/* the catalog read failing used to drop silently to the first slice of strategies */}
      {cat.failed && (
        <FailedRead testId="backtest-catalog-failed" retry={cat.retry}
          title="The full strategy list could not be read right now, so only the first set of strategies is offered." />
      )}
      {waiting && !exhausted && (
        <p className={styles.note} data-testid="backtest-busy" role="status">
          The backtester is busy right now. This asks again by itself every {PENDING_REASK_MS / 1000} seconds.
        </p>
      )}
      {waiting && exhausted && (
        <p className={styles.note} data-testid="backtest-busy" role="status">
          The backtester is still busy.{' '}
          <button type="button" onClick={retry}>Try again</button>
        </p>
      )}
      {poll.error && <FailedRead testId="backtest-error" retry={() => poll.mutate()} title="The backtest result is unavailable right now." />}
      {st && (st.state === 'queued' || st.state === 'running') && (
        <p className={styles.note} data-testid="backtest-running" role="status">
          Simulating {sym} over {earnings ? 'past earnings prints' : 'the past year of monthly expirations'}…
        </p>
      )}
      {st?.state === 'failed' && <p className={styles.note} data-testid="backtest-error">{st.error}</p>}

      {r && (
        <div data-testid="backtest-result">
          <p className={styles.muted} data-testid="backtest-basis">{r.basis}</p>
          <p className={styles.muted} data-testid="backtest-window">{r.window?.text}</p>
          {r.anchor_text && <p className={styles.muted} data-testid="backtest-anchor">{r.anchor_text}</p>}
          {r.summary
            ? <p className={styles.payoffFacts} data-testid="backtest-summary">{summaryFacts(r.summary)}</p>
            : <p className={styles.payoffFacts} data-testid="backtest-small-sample">{r.summary_reason}</p>}
          <p className={styles.muted} data-testid="backtest-excluded">{excludedText(r)}</p>
          {notRunText(r) && <p className={styles.muted} data-testid="backtest-not-run">{notRunText(r)}</p>}
          {r.trades?.length > 0 && (
            <div className={styles.scroll}>
              <table className={styles.grid} data-testid="backtest-trades" aria-label={`Backtest trades for ${sym}`}>
                <thead>
                  <tr>
                    {r.anchor === 'earnings' && <th scope="col">Report</th>}
                    <th scope="col">Entry</th><th scope="col">Expiry</th><th scope="col">Contracts</th><th scope="col">Debit</th>
                    <th scope="col" title={plainBacktest(r.iv_source_text)}>IV (computed)</th><th scope="col">Exit</th><th scope="col">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {r.trades.map((t) => (
                    <tr key={`${t.expiry}-${t.entry_date}`}>
                      {r.anchor === 'earnings' && <td>{t.report_date} {String(t.timing || '').toUpperCase()}</td>}
                      <td>{t.entry_date}</td>
                      <td>{t.expiry}</td>
                      <td>{legsLabel(t.legs)}</td>
                      <td>{money(t.debit)}</td>
                      <td>{Array.isArray(t.legs) && t.legs.length ? t.legs.map((l) => ivText(l?.iv_computed)).join(' / ') : '—'}</td>
                      <td>{exitLabel(t.exit)}</td>
                      <td>{money(t.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.muted} data-testid="backtest-iv-source">{plainBacktest(r.iv_source_text)}</p>
        </div>
      )}
    </section>
  )
}
