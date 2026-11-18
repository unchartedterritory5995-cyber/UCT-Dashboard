// PERF: "My trading stats", the member's own numbers from the Journal (data wave 3).
//
// ⭐ NO NEW ROUTE. Four reads the Journal already makes, each for the signed-in member only
// (api/routers/journal_two.py, `Depends(get_current_user)`): the accounts list, the metric
// registry, the metric cards (`/api/j2/metrics`) and the analytics payload (`/api/j2/analytics`).
// The pure half (the URLs, which account, the row shaping, the sentences) is performanceModel.js,
// re-exported below.
//
//   PERF        the account the Journal is on     PERF 2      your second account
//   PERF ALL    all your accounts together
//
// A row of headline numbers, a by-setup table (best expectancy first, the sample beside every
// ratio) and a small closed-trade equity curve.
//
// ⛔ PERSONAL DATA. Every read is one of the member's own `/api/j2/` routes; nothing here takes a
// member id, and an account is named in the command by its place in the list, never by its id.
// ⛔ HONEST STATES. A failed read is an error with Retry, never "no trades". A number the server
// withholds below its minimum sample says "not enough trades yet (n of m)", a number with nothing
// to work it out from says what is missing, and neither is ever drawn as 0 or as a dash. A number
// the server does send from a small sample is shown with that sample and marked. A trade with no
// stop (a broker import) has no stop-based R: the panel says how many use True R and how many
// have no R at all, the way the Journal does.
// ⛔ THE TWO DATA READS FAIL APART. The headline numbers and the table and curve come from two
// routes; one failing never blanks the other.
//
// Closed trades change when the member closes one, so nothing here polls.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { formatCurrency, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  ACCOUNTS_URL, CONFIDENCE_MIN, JOURNAL_ACCOUNT_KEY, METRICS_REGISTRY_URL, PERFORMANCE_CODE, accountsRead, analyticsRead, analyticsUrl,
  curveGeometry, headlineStats, metricsRead, metricsUrl, parsePerformanceAccount, performanceCommandArgs, pickAccount, rSourcesSentence,
  registryRead, sampleText,
} from './performanceModel'
import styles from './marketPanels.module.css'
import own from './performancePanel.module.css'

export {
  ACCOUNTS_URL, ALL_ACCOUNTS, ANALYTICS_URL, CONFIDENCE_MIN, HEADLINE_CARD, HEADLINE_NUMBERS, JOURNAL_ACCOUNT_KEY, METRICS_REGISTRY_URL,
  METRICS_URL, PERFORMANCE_CODE, accountsRead, analyticsRead, analyticsUrl, curveGeometry, equityCurve, headlineStats, metricsRead,
  metricsRequest, metricsUrl, parsePerformanceAccount, performanceCommandArgs, pickAccount, rSourcesSentence, registryRead, sampleText,
  setupRows,
} from './performanceModel'

const SOURCE = 'Your journal'
const WHAT = 'Your journal'
const NA = 'n/a'

const count = (n) => formatNumber(n, { decimals: 0 })
const usd = (v) => formatCurrency(v, { grouping: true, absent: NA })
const signedUsd = (v) => (v > 0 ? `+${usd(v)}` : usd(v))
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
/** A result in R, signed; a value that rounds to zero is zero. */
const rText = (v) => {
  const x = Math.round(v * 100) / 100 || 0
  return `${x > 0 ? '+' : ''}${formatNumber(x, { decimals: 2 })}R`
}

/** Pure: a headline stat's value as text, or null when it has none (the panel then says why). */
export function statValueText(s) {
  if (!s || s.value === null || s.value === undefined) return null
  switch (s.kind) {
    case 'count': return count(s.value)
    case 'pct': return formatPercent(s.value, { decimals: 1 })
    case 'usd': return usd(s.value)
    case 'signedUsd': return signedUsd(s.value)
    case 'r': return rText(s.value)
    default: return formatNumber(s.value, { decimals: 2 })
  }
}
const isSigned = (s) => s.kind === 'signedUsd' || s.kind === 'r' || (s.kind === 'usd' && s.value < 0)

/** The Journal's own account pick (an id, `_all_` or null). Read once, never written. */
function readJournalPick() {
  try { return window.localStorage.getItem(JOURNAL_ACCOUNT_KEY) || null } catch { return null }
}

/** One read's outcome: 'loading' | 'http' (the request itself failed) | the model's own state. */
const outcomeOf = (q, parsed) => (!q.body && !q.error ? 'loading' : q.error && !q.body ? 'http' : parsed.state)

/** A failed part of the panel: what could not be read, that it is not "no trades", and a way back. */
function PartFailed({ id, what, q, state }) {
  const lower = what.replace(/^The /, 'the ')
  return (
    <p className={styles.note} role="status" data-testid={`terminal-perf-${id}-error`}>
      {state === 'http' && (q.error?.status === 401 || !canRetry(q.error)) ? failureText(q.error, WHAT)
        : state === 'http' && q.error?.timedOut ? `${what} did not answer within 30 seconds.` : `${what} could not be read just now.`}
      {' '}That is not the same as no trades.{' '}
      {state === 'http' && !canRetry(q.error) ? null : (
        <button type="button" className={styles.linkBtn} onClick={() => q.retry()}>Retry {lower}</button>
      )}
    </p>
  )
}

function PerformanceBody({ pick, registry, code, several }) {
  const accountId = pick.mode === 'one' ? pick.account.id : null
  const name = pick.mode === 'one' ? pick.account.name : 'all your accounts'
  const mQ = useMarketRead(metricsUrl({ accountId, registry }))
  const aQ = useMarketRead(analyticsUrl({ accountId }))
  const m = useMemo(() => metricsRead(mQ.body), [mQ.body])
  const a = useMemo(() => analyticsRead(aQ.body), [aQ.body])
  const mState = outcomeOf(mQ, m)
  const aState = outcomeOf(aQ, a)
  const reads = [{ q: mQ, state: mState }, { q: aQ, state: aState }]
  const answered = reads.filter((r) => r.state === 'ok')
  const stats = useMemo(
    () => headlineStats({ metrics: mState === 'ok' ? m : null, analytics: aState === 'ok' ? a : null }),
    [m, a, mState, aState],
  )
  const curve = useMemo(() => curveGeometry(a.curve), [a.curve])
  // As of: when the OLDEST of the answers on screen was read (a journal has no market time).
  const readAt = answered.map((r) => r.q.receivedAt).filter(Boolean).sort()[0] || null
  usePanelFreshness(answered.length ? panelAsOf(SOURCE, readAt) : null)

  if (reads.every((r) => r.state === 'loading')) {
    return <PanelSkeleton label="Loading your trading stats" testId="terminal-perf-loading" />
  }
  const settled = reads.every((r) => r.state !== 'loading')
  if (settled && !answered.length) {
    const http = reads.filter((r) => r.state === 'http')
    const locked = http.length === reads.length && http.every((r) => !canRetry(r.q.error))
    const first = http[0]?.q.error || null
    return (
      <PanelState kind={locked ? failureKind(first) : 'error'} testId="terminal-perf-error"
        title={first ? failureText(first, WHAT) : 'Your trading stats could not be read just now.'}
        action={locked ? null : <button type="button" className={styles.chip} onClick={() => reads.forEach((r) => r.q.retry())}>Retry</button>}>
        {locked ? null : `That is not the same as no trades. Retry, or run ${code} again.`}
      </PanelState>
    )
  }

  const trades = aState === 'ok' ? a.trades : mState === 'ok' ? m.trades : null
  const strategies = aState === 'ok' ? a.strategies : 0
  if (trades === 0) {
    return (
      <PanelState kind="empty" role="status" testId="terminal-perf-empty"
        title={pick.mode === 'one' ? `No closed trades in ${name} yet.` : 'No closed trades in any of your accounts yet.'}>
        Your stats start with your first closed trade. Open positions are not counted
        {strategies > 0 ? `, and neither are option strategies (${count(strategies)} here; they are in the Journal)` : ''}.
        {several ? ' Pick another account above, or ' : ' '}
        {several ? 'log' : 'Log'} a closed trade in the{' '}
        <PanelCommand cmd="JRNL" label="Open the Journal">Journal (JRNL)</PanelCommand>.
      </PanelState>
    )
  }

  const sources = rSourcesSentence(aState === 'ok' ? a.rSources : m.rSources, count)
  const waiting = (s) => (s.from === 'metrics' ? mState : s.from === 'analytics' ? aState : 'done') === 'loading'

  return (
    <>
      {mState === 'ok' || mState === 'loading' ? null : <PartFailed id="numbers" what="The headline numbers" q={mQ} state={mState} />}
      {aState === 'ok' || aState === 'loading' ? null : <PartFailed id="tables" what="The setup table and the equity curve" q={aQ} state={aState} />}
      {reads.map((r, i) => (r.state === 'ok' && r.q.error ? (
        <p key={i === 0 ? 'numbers' : 'tables'} className={styles.note} role="status">{failureText(r.q.error, WHAT)} Showing the last read.</p>
      ) : null))}

      <dl className={own.stats} data-testid="terminal-perf-stats">
        {stats.map((s) => {
          const value = statValueText(s)
          const under = waiting(s) ? 'Reading.' : sampleText(s, count)
          return (
            <div key={s.key} className={own.stat} data-testid={`terminal-perf-stat-${s.key}`} data-state={waiting(s) ? 'loading' : s.state}>
              <dt>{s.label}</dt>
              <dd>
                {value !== null ? <span className={`${own.value} ${isSigned(s) ? tone(s.value) || '' : ''}`.trim()}>{value}</span> : null}
                {under ? <span className={value !== null ? own.sample : own.reason}>{under}</span> : null}
              </dd>
            </div>
          )
        })}
      </dl>
      {sources ? <p className={styles.muted} data-testid="terminal-perf-r-sources">{sources}</p> : null}

      {aState === 'ok' ? (
        <>
          <section aria-label="Your results by setup" data-testid="terminal-perf-setups">
            <h3 className={styles.muted}>By setup ({count(a.setups.length)})</h3>
            {a.setups.length ? (
              <div className={styles.tableBox} data-fold="590">
                <table className={styles.table} data-testid="terminal-perf-setup-table"
                  aria-label={`Your results by setup, best expectancy first, ${a.setups.length} ${a.setups.length === 1 ? 'setup' : 'setups'}`}>
                  <thead>
                    <tr>
                      <th scope="col" className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>Setup</th>
                      <th scope="col" className={styles.phoneWrap} title="Closed trades tagged with this setup: the sample behind every number in the row">Trades</th>
                      <th scope="col" title="Wins divided by wins and losses; breakeven trades are left out">Win rate</th>
                      <th scope="col" title="The setup's total profit or loss before fees, divided by its trades">Expectancy</th>
                      <th scope="col" className={styles.phoneHide} title="The average result in R, over this setup's trades with a known R">Average R</th>
                      <th scope="col" className={styles.phoneHide} title="Before fees">Total profit or loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.setups.map((r) => (
                      <tr key={r.key} data-testid="terminal-perf-setup-row" data-low={r.lowConfidence ? 'true' : 'false'}>
                        <td className={`${styles.wrapCell} ${styles.phoneTight} ${styles.snugTight}`}>{r.setup}</td>
                        <td className={styles.phoneWrap}>{count(r.trades)}{r.lowConfidence ? ` (small sample, ${count(CONFIDENCE_MIN)} needed)` : ''}</td>
                        <td>{r.winRatePct === null ? 'No win or loss yet' : formatPercent(r.winRatePct, { decimals: 1 })}</td>
                        <td className={tone(r.expectancy)}>{r.expectancy === null ? NA : signedUsd(r.expectancy)}</td>
                        <td className={`${styles.phoneHide} ${tone(r.avgR) || ''}`.trim()}>{r.avgR === null ? 'R not known' : rText(r.avgR)}</td>
                        <td className={`${styles.phoneHide} ${tone(r.totalPnl) || ''}`.trim()}>{r.totalPnl === null ? NA : signedUsd(r.totalPnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.muted} data-testid="terminal-perf-setups-none">
                None of these closed trades carries a setup tag yet. Tag a trade&apos;s setup in the Journal and it is counted here.
              </p>
            )}
            {a.untagged > 0 && a.setups.length ? (
              <p className={styles.muted} data-testid="terminal-perf-untagged">
                {count(a.untagged)} closed {a.untagged === 1 ? 'trade has' : 'trades have'} no setup tag and {a.untagged === 1 ? 'is' : 'are'} not in this table.
              </p>
            ) : null}
          </section>

          <section aria-label="Your closed-trade equity curve" data-testid="terminal-perf-equity">
            <h3 className={styles.muted}>Closed-trade equity</h3>
            {curve ? (
              <>
                <svg className={own.curve} viewBox={`0 0 ${curve.width} ${curve.height}`} preserveAspectRatio="none" role="img"
                  aria-label={`Closed-trade equity from ${curve.first.date} to ${curve.last.date}: ${usd(curve.first.equity)} to ${usd(curve.last.equity)}`}
                  data-testid="terminal-perf-curve">
                  <polyline points={curve.points} vectorEffect="non-scaling-stroke" />
                </svg>
                <p className={styles.lede} data-testid="terminal-perf-curve-words">
                  From {usd(curve.first.equity)} at the end of {curve.first.date} to {usd(curve.last.equity)} at the end of{' '}
                  {curve.last.date}: <span className={tone(curve.change)}>{signedUsd(curve.change)}</span>. Lowest {usd(curve.low)},
                  highest {usd(curve.high)}, over {count(a.curve.length)} days that closed a trade.
                </p>
              </>
            ) : a.curve.length === 1 ? (
              <p className={styles.lede} data-testid="terminal-perf-curve-words">
                One day has closed a trade so far: {usd(a.curve[0].equity)} at the end of {a.curve[0].date}. The line draws once
                there are two.
              </p>
            ) : (
              <p className={styles.muted} data-testid="terminal-perf-curve-words">The Journal sent no equity points to draw.</p>
            )}
            <p className={styles.muted} data-testid="terminal-perf-curve-method">
              One point per day that closed a trade, after fees; open positions are not in it.
              {pick.mode === 'all' ? ' All your accounts together start from the sum of their starting balances.'
                : pick.account.anchored ? ' This account is linked to a broker, so the line is set to end at the broker\'s account value.'
                  : ' It runs from the account\'s starting balance.'}
            </p>
          </section>
        </>
      ) : null}

      <p className={styles.muted} data-testid="terminal-perf-method">
        These are your own numbers, read from your Journal: closed stock trades only, and only the trades the Journal
        counts in its stats. Open positions and option strategies are not in them. Win rate is wins divided by wins and
        losses, so breakeven trades are left out. Average win, Average loss and Expectancy per trade are dollars after
        fees; the Journal does not work out an average win or loss in R. Profit factor is the dollars won divided by the
        dollars lost, after fees. Expectancy in R is the average result per trade, in units of the risk taken. Edge score
        is the Journal&apos;s own: win rate times profit factor (before fees, counted up to 5) times how steady your R
        results are. A number from fewer than {count(CONFIDENCE_MIN)} trades is marked a small sample. A sign (+/-) marks
        every gain and loss, so color is never the only signal. For your record on one stock, type its ticker and
        MYH (<kbd>NVDA MYH</kbd>). For every chart and filter, open the{' '}
        <PanelCommand cmd="JRNL" label="Open the Journal">Journal (JRNL)</PanelCommand>.
        {readAt ? ` Read at ${formatTimeEt(readAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </>
  )
}

export default function PerformancePanel({ account: accountProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || PERFORMANCE_CODE
  const accountsQ = useMarketRead(ACCOUNTS_URL)
  const registryQ = useMarketRead(METRICS_REGISTRY_URL)
  const served = useMemo(() => accountsRead(accountsQ.body), [accountsQ.body])
  const registry = useMemo(() => registryRead(registryQ.body), [registryQ.body])
  // A new `PERF 2` remounts the panel (the shell keys the body on code + args), so the typed
  // account only ever seeds the state.
  const [choice, setChoice] = useState(() => parsePerformanceAccount(accountProp))
  const [stored] = useState(readJournalPick)
  const pick = useMemo(() => pickAccount(served.accounts, { choice, stored }), [served.accounts, choice, stored])
  // The picker writes itself into the command (`PERF 2`, `PERF ALL`) where the registry takes
  // the word, so a reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const choose = (raw) => {
    const next = parsePerformanceAccount(raw)
    if (!next) return
    setChoice(next)
    writeBack(performanceCommandArgs({ account: next }))
  }
  const wrap = (children, attrs = {}) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-perf" {...attrs}>{children}</div>
  )

  if (!accountsQ.body && !accountsQ.error) return wrap(<PanelSkeleton label="Loading your trading stats" testId="terminal-perf-loading" />)
  if (!accountsQ.body && accountsQ.error) {
    const locked = !canRetry(accountsQ.error)
    return wrap(
      <PanelState kind={failureKind(accountsQ.error)} title={failureText(accountsQ.error, WHAT)} testId="terminal-perf-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={accountsQ.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no trades. Retry, or run ${code} again.`}
      </PanelState>,
    )
  }
  if (served.state !== 'ok') {
    return wrap(
      <PanelState kind="error" title={`${WHAT} could not be read just now.`} testId="terminal-perf-error"
        action={<button type="button" className={styles.chip} onClick={accountsQ.retry}>Retry</button>}>
        That is not the same as no trades. Retry, or run {code} again.
      </PanelState>,
    )
  }
  if (!pick.mode) {
    return wrap(
      <PanelState kind="empty" role="status" title="You have no journal account yet." testId="terminal-perf-no-account"
        action={<button type="button" className={styles.chip} onClick={accountsQ.retry}>Check again</button>}>
        Your trading stats show here once the Journal has an account with closed trades. Open the{' '}
        <PanelCommand cmd="JRNL" label="Open the Journal">Journal (JRNL)</PanelCommand> to set one up.
      </PanelState>,
    )
  }
  // The registry says which numbers the server offers; the stats wait for it to answer or fail.
  if (!registryQ.body && !registryQ.error) return wrap(<PanelSkeleton label="Loading your trading stats" testId="terminal-perf-loading" />)

  const several = served.accounts.length > 1
  const shown = pick.mode === 'all' ? 'All accounts together' : pick.account.name
  return wrap(
    <>
      <div className={styles.toolbar} role="toolbar" aria-label="Trading stats controls">
        {several ? (
          <label className={own.filter}>
            Account
            <Select value={pick.mode === 'all' ? 'ALL' : String(pick.ordinal)} onChange={(e) => choose(e.target.value)}
              data-testid="terminal-perf-account-pick"
              options={[...served.accounts.map((acc, i) => ({ value: String(i + 1), label: acc.name })), { value: 'ALL', label: 'All accounts together' }]} />
          </label>
        ) : null}
        <span className={styles.lede} data-testid="terminal-perf-account">
          {several ? `Showing ${shown}.` : `Account: ${shown}.`}
          {pick.mode === 'one' && pick.account.brokerLinked ? ' It is linked to your broker.' : ''}
        </span>
      </div>
      {pick.missing ? (
        <p className={styles.note} role="status" data-testid="terminal-perf-missing">
          You have no account number {count(pick.missing)} ({count(served.accounts.length)} in your Journal), so this shows {shown}.
        </p>
      ) : null}
      {/* Keyed by account: a new account is two new reads, so one account's numbers are never drawn under another's name. */}
      <PerformanceBody key={pick.mode === 'all' ? 'all' : pick.account.id} pick={pick} registry={registry} code={code} several={several} />
    </>,
    { 'data-account': pick.mode === 'all' ? 'all' : String(pick.ordinal) },
  )
}
