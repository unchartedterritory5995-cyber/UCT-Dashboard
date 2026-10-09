// CHK: check a planned trade against what has worked before (wave 8, lane F). `NVDA CHK`.
//
// NO NEW ROUTE. Five existing reads from api/routers/intelligence.py (paid, mounted in main.py,
// no feature flag; each answers from the uct_intelligence engine). The pure half is checkModel.js.
//   Setup      the setup names (GET /api/setup-templates); the member picks one.
//   Checklist  GET /api/pre-trade-checklist with the setup, entry and stop (all three required).
//   Win rate   GET /api/setup-performance/{setup}, for all markets and for today's phase.
//   Analogs    GET /api/analogs, the latest past trades of that setup in today's phase.
//   Risk       GET /api/risk-summary, the member's open book against today's phase limits.
//   This ticker GET /api/analogs with `symbol`, the setup's past trades in this ticker only, and
//              GET /api/j2/trades?symbol=, the member's own closed journal trades in it (read only).
//
// Every section loads and fails on its own: one failed read never blanks the panel, a failed read
// is an error with Retry (never an empty section), a 402 says paid plan. The engine's own "not
// loaded" answer is said in words, and nothing is filled in for it.
//
// Entry and stop are validated by sizeMath.checkLevels, the same sentence SIZE gives. The entry is
// prefilled ONCE from the live price; the member's typing wins. Nothing here is stored.
import { useEffect, useId, useMemo, useState } from 'react'
import useSWR from 'swr'
import useLivePrices from '../../../hooks/useLivePrices'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatCurrency, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, stampedRead, failureText } from './marketRead'
import { checkLevels, parseNum } from './sizeMath'
import {
  RISK_URL, TEMPLATES_URL, MAX_HEAT_PCT, analogRows, analogsUrl, bookChecks, checklistChecks, checklistUrl,
  engineMissing, journalRows, journalTradesUrl, num, perfUrl, phaseOf, riskEngineMissing, setupOptions,
  tickerAnalogView, tickerAnalogsUrl,
} from './checkModel'
import shared from './myNamesPanel.module.css'
import form from './sizePanel.module.css'
import styles from './checkPanel.module.css'

/** CHK's own SWR key. Never the bare URL: the Setup library page caches the raw
 *  /api/setup-templates body under that URL, and this stores `{ body, receivedAt }`. */
export const chkKey = (url) => (url ? [url, 'terminal-chk'] : null)
const chkFetcher = ([url]) => stampedRead(url)

/** One section's read. No previous data is kept across a key change, so a new setup never shows
 *  the last setup's numbers while it loads. */
function useChkRead(url) {
  const r = useSWR(chkKey(url), chkFetcher, { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 60_000 })
  return {
    asked: Boolean(url),
    body: r.data?.body,
    receivedAt: r.data?.receivedAt || null,
    error: r.error || null,
    loading: Boolean(url) && !r.data && !r.error,
    retry: () => r.mutate(),
  }
}

/** A value that settles `ms` after the last change, so typing a price is not a read per key. */
function useSettled(value, ms = 400) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const pct = (v, decimals = 1) => formatPercent(v, { decimals, absent: 'n/a' })
const signedPct = (v) => formatPercent(v, { decimals: 1, signed: true, absent: 'n/a' })
const price = (v) => formatCurrency(v, { absent: 'n/a' })

function Verdict({ ok }) {
  if (ok === true) return <span className={`${styles.verdict} ${styles.pass}`}>Pass</span>
  if (ok === false) return <span className={`${styles.verdict} ${styles.fail}`}>Fail</span>
  return <span className={`${styles.verdict} ${styles.unknown}`}>Unknown</span>
}

/** One section: its title, then loading / error with Retry / its own content. */
function Section({ id, title, read, what, children }) {
  // Two CHK panels can be open at once, so the heading id is per instance.
  const titleId = `${useId()}-${id}-title`
  let body
  if (read.loading) {
    body = <PanelSkeleton label={`Loading ${what.toLowerCase()}`} rows={2} testId={`terminal-chk-${id}-loading`} />
  } else if (read.error) {
    const paid = !canRetry(read.error)
    body = (
      <PanelState compact kind={paid ? 'locked' : 'error'} role={paid ? 'status' : undefined}
        testId={`terminal-chk-${id}-error`} title={failureText(read.error, what)}
        action={paid ? null : <button type="button" className={shared.chip} onClick={read.retry}>Retry</button>} />
    )
  } else {
    body = children
  }
  return (
    <section className={styles.section} aria-labelledby={titleId} data-testid={`terminal-chk-${id}`}>
      <h3 className={styles.sectionTitle} id={titleId}>{title}</h3>
      {body}
    </section>
  )
}

function EngineOff({ id, reason }) {
  return (
    <PanelState compact kind="locked" role="status" testId={`terminal-chk-${id}-off`} title="Not switched on for this server yet.">
      {reason ? `${reason}. ` : ''}Nothing is shown until it is.
    </PanelState>
  )
}

function Waiting({ id, children }) {
  return <p className={shared.muted} data-testid={`terminal-chk-${id}-waiting`}>{children}</p>
}

function PerfTable({ rows }) {
  return (
    <div className={shared.tableBox}>
      <table className={shared.table} aria-label="Setup win rate" data-testid="terminal-chk-perf-table">
        <thead>
          <tr>
            <th scope="col">Market</th><th scope="col">Win rate</th><th scope="col">Trades</th>
            <th scope="col" className={shared.phoneHide}>Avg gain</th><th scope="col" className={shared.phoneHide}>Avg loss</th>
            <th scope="col">Expectancy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} data-testid={`terminal-chk-perf-${r.key}`}>
              <th scope="row">{r.label}</th>
              {r.data ? (
                <>
                  <td>{pct(num(r.data.win_rate_pct), 0)}</td>
                  <td>{formatNumber(num(r.data.total_trades), { decimals: 0, absent: 'n/a' })}</td>
                  <td className={shared.phoneHide}>{signedPct(num(r.data.avg_gain_pct))}</td>
                  <td className={shared.phoneHide}>{signedPct(num(r.data.avg_loss_pct))}</td>
                  <td>{signedPct(num(r.data.expectancy))}</td>
                </>
              ) : (
                <td colSpan={5}>{r.note}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Past trades of a setup: symbol, when, entry, outcome, days, status. */
function AnalogTable({ rows, label, testId }) {
  return (
    <div className={shared.tableBox}>
      <table className={shared.table} aria-label={label} data-testid={testId}>
        <thead>
          <tr><th scope="col">Symbol</th><th scope="col">Flagged</th><th scope="col" className={shared.phoneHide}>Entry</th>
            <th scope="col">Outcome</th><th scope="col" className={shared.phoneHide}>Days</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.key}>
              <td>{a.sym ? <PanelSymbol sym={a.sym} className={shared.sym} /> : 'n/a'}</td>
              <td>{a.date || 'n/a'}</td>
              <td className={shared.phoneHide}>{price(a.entry)}</td>
              <td className={a.outcome > 0 ? shared.up : a.outcome < 0 ? shared.down : undefined}>
                {a.outcome === null ? 'Not resolved' : signedPct(a.outcome)}
              </td>
              <td className={shared.phoneHide}>{a.days === null ? 'n/a' : formatNumber(a.days, { decimals: 0 })}</td>
              <td>{a.status || 'n/a'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The member's own closed trades in this ticker. */
function JournalTable({ rows, setup }) {
  return (
    <div className={shared.tableBox}>
      <table className={shared.table} aria-label="Your closed trades in this ticker" data-testid="terminal-chk-journal-table">
        <thead>
          <tr><th scope="col">Entered</th><th scope="col" className={shared.phoneHide}>Exited</th><th scope="col">Side</th>
            <th scope="col">Setup</th><th scope="col">P&amp;L</th><th scope="col" className={shared.phoneHide}>R</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.key}>
              <td>{t.entryDate || 'n/a'}</td>
              <td className={shared.phoneHide}>{t.exitDate || 'n/a'}</td>
              <td>{t.side || 'n/a'}</td>
              <td>{t.setup ? (t.setup === setup ? `${t.setup} (this setup)` : t.setup) : 'Not tagged'}</td>
              <td className={t.pnlPct > 0 ? shared.up : t.pnlPct < 0 ? shared.down : undefined}>{signedPct(t.pnlPct)}</td>
              <td className={shared.phoneHide}>{t.r === null ? 'n/a' : `${t.r > 0 ? '+' : ''}${formatNumber(t.r, { decimals: 1 })}R`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One win-rate row from a setup-performance read (or the words for why there is none). */
function perfRow(key, label, read) {
  if (!read.asked) return { key, label, data: null, note: 'Needs today\'s market phase.' }
  if (read.loading) return { key, label, data: null, note: 'Loading.' }
  if (read.error) return { key, label, data: null, note: failureText(read.error, 'This win rate') }
  const off = engineMissing(read.body)
  if (off) return { key, label, data: null, note: 'Not switched on for this server yet.' }
  const data = read.body?.data && typeof read.body.data === 'object' ? read.body.data : null
  return { key, label, data, note: data ? null : 'Too few past trades to judge (needs 5 or more).' }
}

export default function CheckPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase() || null
  const inPanel = useInTerminalPanel()
  const ids = useId()
  const [setup, setSetup] = useState('')
  const [side, setSide] = useState('long')
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [entryTouched, setEntryTouched] = useState(false)
  const [prefilled, setPrefilled] = useState(false)

  const { prices } = useLivePrices(s ? [s] : [])
  const live = s ? parseNum(prices?.[s]?.price) : null
  useEffect(() => {
    if (!s || entryTouched || entry !== '' || live === null || live <= 0) return
    setEntry(formatNumber(live, { decimals: 2, grouping: false }))
    setPrefilled(true)
  }, [s, live, entryTouched, entry])

  const blankLevels = entry.trim() === '' || stop.trim() === ''
  const levels = useMemo(() => checkLevels({ entry, stop, side }), [entry, stop, side])
  // The levels sentence names the entry and the stop together, so both fields point at it.
  const levelsErrorId = `${ids}-levels-error`
  const describedBy = (hintId = null) => [hintId, !blankLevels && !levels.ok ? levelsErrorId : null].filter(Boolean).join(' ') || undefined
  const settled = useSettled(levels.ok ? `${levels.entry}|${levels.stop}` : null)
  const [settledEntry, settledStop] = settled ? settled.split('|').map(Number) : [null, null]

  const templates = useChkRead(s ? TEMPLATES_URL : null)
  const risk = useChkRead(s ? RISK_URL : null)
  const checklist = useChkRead(s && setup && settled ? checklistUrl({ sym: s, setup, entry: settledEntry, stop: settledStop }) : null)

  const riskOff = risk.body && riskEngineMissing(risk.body)
  const checklistBody = checklist.body && !engineMissing(checklist.body) ? checklist.body : null
  const phase = phaseOf(riskOff ? null : risk.body, checklistBody)

  const perfAll = useChkRead(s && setup ? perfUrl(setup, 'ALL') : null)
  const perfPhase = useChkRead(s && setup && phase ? perfUrl(setup, phase) : null)
  const analogs = useChkRead(s && setup && phase ? analogsUrl(setup, phase) : null)
  const mine = useChkRead(s && setup && phase ? tickerAnalogsUrl(setup, phase, s) : null)
  const journal = useChkRead(s ? journalTradesUrl(s) : null)

  const options = useMemo(() => setupOptions(templates.body), [templates.body])

  // As of: the oldest read that has landed, so the panel never claims to be fresher than its parts.
  const stamps = [templates, risk, checklist, perfAll, perfPhase, analogs, mine, journal].map((r) => r.receivedAt).filter(Boolean).sort()
  usePanelFreshness(stamps.length ? { source: 'UCT intelligence engine (setups, analogs, risk) and your journal', observedAt: stamps[0] } : null)

  if (!s) {
    return (
      <PanelState kind="input" title="CHK needs a ticker.">
        Type one first, e.g. <kbd>NVDA CHK</kbd>
      </PanelState>
    )
  }

  const sizePct = num(checklistBody?.risk?.position_size_pct)
  const riskPct = num(checklistBody?.risk?.account_risk_pct)
  const book = !riskOff && risk.body ? bookChecks(risk.body, { sizePct, riskPct }) : []
  const chkRows = checklistChecks(checklistBody)
  const rules = checklistBody?.template_rules || {}
  const ruleRows = [['Entry trigger', rules.entry_trigger], ['Stop method', rules.stop_method], ['Invalidation', rules.invalidation]]
    .filter(([, v]) => typeof v === 'string' && v.trim())
  const analogList = analogRows(analogs.body)
  const mineView = engineMissing(mine.body) ? null : tickerAnalogView(mine.body, s)
  const journalList = journalRows(journal.body, s)
  const heat = risk.body?.heat || {}
  const unheated = num(risk.body?.open_position_count) !== null && num(heat.position_count) !== null
    ? num(risk.body.open_position_count) - num(heat.position_count) : 0

  return (
    <div className={`${shared.wrap} ${inPanel ? shared.inPanel : ''}`} data-testid="terminal-chk">
      <p className={shared.lede}>
        Check a planned trade in {s} against the setup rules, past trades and your open book.
      </p>
      <div className={styles.links} data-testid="terminal-chk-links">
        <span className={shared.muted}>Also for {s}:</span>
        <PanelCommand cmd={`${s} GRADE`} label={`Compass grade (GRADE) for ${s}`}>Compass grade (GRADE)</PanelCommand>
        <PanelCommand cmd={`${s} SIZE`} label={`Position size (SIZE) for ${s}`}>Position size (SIZE)</PanelCommand>
      </div>

      <Section id="setup" title="Your plan" read={templates} what="The setup list">
        {engineMissing(templates.body) || (templates.body && options.length === 0) ? (
          <EngineOff id="setup" reason={engineMissing(templates.body) || 'The setup library is empty on this server'} />
        ) : (
          <>
            <div className={shared.group} role="group" aria-label="Trade side">
              <button type="button" className={shared.chip} aria-pressed={side === 'long'} onClick={() => setSide('long')}
                data-testid="terminal-chk-side-long">Long (stop below entry)</button>
              <button type="button" className={shared.chip} aria-pressed={side === 'short'} onClick={() => setSide('short')}
                data-testid="terminal-chk-side-short">Short (stop above entry)</button>
            </div>
            <form className={form.form} onSubmit={(e) => e.preventDefault()} aria-label="Planned trade">
              <div className={form.field}>
                <label className={form.label} htmlFor={`${ids}-setup`}>Setup</label>
                <Select id={`${ids}-setup`} className={form.input} value={setup} onChange={(e) => setSetup(e.target.value)}
                  options={[{ value: '', label: 'Pick a setup' }, ...options]} data-testid="terminal-chk-setup-pick" />
              </div>
              <div className={form.field}>
                <label className={form.label} htmlFor={`${ids}-entry`}>Entry price ($)</label>
                <Input id={`${ids}-entry`} className={form.input} inputMode="decimal" autoComplete="off" value={entry}
                  aria-describedby={describedBy(prefilled && !entryTouched ? `${ids}-entry-hint` : null)}
                  onChange={(e) => { setEntry(e.target.value); setEntryTouched(true) }} data-testid="terminal-chk-entry" />
                {prefilled && !entryTouched ? <span className={form.hint} id={`${ids}-entry-hint`}>Live price for {s}</span> : null}
              </div>
              <div className={form.field}>
                <label className={form.label} htmlFor={`${ids}-stop`}>Stop price ($)</label>
                <Input id={`${ids}-stop`} className={form.input} inputMode="decimal" autoComplete="off" value={stop}
                  aria-describedby={describedBy()}
                  onChange={(e) => setStop(e.target.value)} data-testid="terminal-chk-stop" />
              </div>
            </form>
            {!blankLevels && !levels.ok ? (
              <p className={shared.note} role="alert" id={levelsErrorId} data-testid="terminal-chk-levels-error">{levels.error}</p>
            ) : null}
          </>
        )}
      </Section>

      <Section id="checklist" title="Checklist" read={checklist} what="The checklist">
        {!setup ? <Waiting id="checklist">Pick a setup to run the checklist.</Waiting>
          : blankLevels ? <Waiting id="checklist">Enter the entry and stop to run the checklist.</Waiting>
          : !levels.ok ? <Waiting id="checklist">Fix the entry and stop above to run the checklist.</Waiting>
          : !checklist.asked ? <Waiting id="checklist">Waiting for you to finish typing.</Waiting>
          : engineMissing(checklist.body) ? <EngineOff id="checklist" reason={engineMissing(checklist.body)} />
          : checklistBody ? (
            <>
              <ul className={styles.checks} data-testid="terminal-chk-checks">
                {chkRows.map((c) => (
                  <li key={c.id} className={styles.check} data-testid={`terminal-chk-check-${c.id}`}>
                    <Verdict ok={c.ok} /><span>{c.label}</span>
                    {c.detail ? <span className={shared.muted}>{c.detail}</span> : null}
                  </li>
                ))}
              </ul>
              <p className={shared.muted} data-testid="terminal-chk-sizing">
                Stop is {pct(num(checklistBody.risk?.stop_distance_pct), 2)} from entry. Risking{' '}
                {pct(riskPct, 1)} of the account means a position of about {pct(sizePct, 1)} (capped at 25%).
              </p>
              {ruleRows.length ? (
                <dl className={styles.rules} data-testid="terminal-chk-rules">
                  {ruleRows.map(([k, v]) => (<div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>))}
                </dl>
              ) : null}
            </>
          ) : <Waiting id="checklist">The checklist came back empty.</Waiting>}
      </Section>

      <Section id="perf" title="Setup win rate" read={perfAll} what="The setup win rate">
        {!setup ? <Waiting id="perf">Pick a setup to see how it has done.</Waiting> : (
          <PerfTable rows={[
            perfRow('all', 'All markets', perfAll),
            perfRow('phase', phase ? `${phase} market` : 'Today\'s market', perfPhase),
          ]} />
        )}
      </Section>

      <Section id="mine" title="This ticker's past trades of this setup" read={mine} what="This ticker's past trades">
        {!setup ? <Waiting id="mine">Pick a setup to see past trades of it in {s}.</Waiting>
          : !phase ? <Waiting id="mine">Past trades are matched by today&apos;s market phase, which has not loaded.</Waiting>
          : engineMissing(mine.body) ? <EngineOff id="mine" reason={engineMissing(mine.body)} />
          : !mineView ? null
          : mineView.state === 'unread' ? <EngineOff id="mine" reason="The setup history is not loaded on this server" />
          : mineView.state === 'unsupported' ? (
            <p className={shared.muted} data-testid="terminal-chk-mine-unsupported">This server cannot pick out one ticker&apos;s past trades yet.</p>
          ) : mineView.state === 'none' ? (
            <p className={shared.muted} data-testid="terminal-chk-mine-empty">None on record for {s} in a {phase} market.</p>
          ) : mineView.state === 'partial' ? (
            <p className={shared.muted} data-testid="terminal-chk-mine-empty">
              None for {s} in the latest {formatNumber(mineView.scanned, { decimals: 0 })} {setup} trades on record. Older ones were not read.
            </p>
          ) : (
            <>
              <p className={shared.muted}>{s}&apos;s {setup} trades in a {phase} market, and how they went.</p>
              <AnalogTable rows={mineView.rows} label={`Past trades of this setup in ${s}`} testId="terminal-chk-mine-table" />
            </>
          )}
      </Section>

      <Section id="journal" title="Your journal in this ticker" read={journal} what="Your journal">
        {journalList.length === 0 ? (
          <p className={shared.muted} data-testid="terminal-chk-journal-empty">No closed trades in {s} in your journal.</p>
        ) : (
          <>
            <p className={shared.muted}>Your latest {journalList.length} closed {journalList.length === 1 ? 'trade' : 'trades'} in {s}.</p>
            <JournalTable rows={journalList} setup={setup} />
          </>
        )}
      </Section>

      <Section id="analogs" title="Past trades like this" read={analogs} what="The past trades">
        {!setup ? <Waiting id="analogs">Pick a setup to see past trades of it.</Waiting>
          : !phase ? <Waiting id="analogs">Past trades are matched by today&apos;s market phase, which has not loaded.</Waiting>
          : analogList.length === 0 ? (
            <p className={shared.muted} data-testid="terminal-chk-analogs-empty">No past {setup} trades in a {phase} market yet.</p>
          ) : (
            <>
              <p className={shared.muted}>The latest {analogList.length} {setup} trades in a {phase} market, and how they went.</p>
              <AnalogTable rows={analogList} label="Past trades of this setup" testId="terminal-chk-analogs-table" />
            </>
          )}
      </Section>

      <Section id="risk" title="Your open book" read={risk} what="Your risk summary">
        {riskOff ? <EngineOff id="risk" reason="The risk engine is not loaded on this server" /> : risk.body ? (
          <>
            <p className={shared.muted} data-testid="terminal-chk-phase">
              Market phase: {risk.body.regime_phase || 'n/a'}.{' '}
              {num(risk.body.open_position_count) !== null ? `${formatNumber(num(risk.body.open_position_count), { decimals: 0 })} open positions.` : ''}
              {sizePct === null ? ' Run the checklist to see this trade added.' : ''}
            </p>
            {book.length ? (
              <ul className={styles.checks} data-testid="terminal-chk-book">
                {book.map((b) => (
                  <li key={b.id} className={styles.check} data-testid={`terminal-chk-book-${b.id}`}>
                    <Verdict ok={b.ok} />
                    <span>{b.label}: {b.unit === '%' ? pct(b.value, 1) : formatNumber(b.value, { decimals: 0 })}</span>
                    <span className={shared.muted}>limit {b.unit === '%' ? pct(b.limit, 0) : formatNumber(b.limit, { decimals: 0 })}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {unheated > 0 ? (
              <p className={shared.muted} data-testid="terminal-chk-unheated">
                {unheated} open {unheated === 1 ? 'position has' : 'positions have'} no size or stop, so {unheated === 1 ? 'it is' : 'they are'} not in the heat figure.
              </p>
            ) : null}
            {(Array.isArray(heat.warnings) ? heat.warnings : []).map((w) => (
              <p key={w} className={shared.note} role="status">{w}</p>
            ))}
            <p className={shared.muted}>Heat is the share of the account at risk across open stops; the engine warns above {MAX_HEAT_PCT}%.</p>
          </>
        ) : null}
      </Section>

      <p className={shared.muted} data-testid="terminal-chk-method">
        A rules-based check from the setup library and past trades, not advice. Nothing you type here is stored.
      </p>
    </div>
  )
}
