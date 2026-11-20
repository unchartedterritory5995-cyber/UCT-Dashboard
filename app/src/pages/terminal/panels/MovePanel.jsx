// MOVE — "why is it moving" (TERMINAL-NEXT lane T3, V15). WIIM is its alias (functions.js CODE_ALIASES).
//
// ⛔ NOT A NEW ANALYSIS. The server route (`/api/terminal/move/:sym`) composes the services
// that already exist — watchlist-intelligence facts and the catalyst engine's recent rows —
// and diffs them against THIS member's last MOVE visit to the security ("since last visit").
// Every leg reports its own status, so an outage reads as "could not check", never as
// "nothing happened" (watchlist_intelligence's own contract).
//
// Row <GO>: the numbered rows are commands (`NVDA CN`, `NVDA CATS` …) published to the shell
// through `onRows`, so typing `2` + Enter opens row 2.
//
// "On the news wire" (2026-11-19): the newest UCT News headlines naming this stock, read by the
// client through the one-stock read `NVDA UCN` already uses (useStockWire.js). The server route
// above is unchanged. The section has its own states and its own read, started beside MOVE's and
// never awaited by it: a wire that is off, slow or unreadable changes that section alone, and
// "could not check" is never drawn as "no headlines". The last numbered row opens the full
// history (`NVDA UCN`).
import { useEffect, useMemo, useState } from 'react'
import jsonFetcher from '../../../utils/jsonFetcher'
import HighlightThesis, { isFailedSynthesis } from '../../../utils/highlightThesis'
import { PanelSkeleton, PanelState, usePanelFreshness } from '../../../components/terminal'
import { formatCurrency, formatDateTimeEt, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import StockWire from './StockWire'
import useStockWire from './useStockWire'
import { WIRE_ROWS, wireStockCommand } from './wireInPanelsModel'
import styles from '../TerminalShell.module.css'

/** Audit 2026-10-08 (MOVE P2, point 9): a fact's `as_of` was printed in the server's raw format with
 *  no zone. A bare date stays a date; a timestamp is shown on the market clock, labelled ET. */
export function asOfText(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const ms = /^\d+(\.\d+)?$/.test(s) ? Number(s) * (Number(s) > 1e12 ? 1 : 1000) : Date.parse(s)
  return Number.isFinite(ms) ? formatDateTimeEt(ms / 1000) : s
}

/** Pure: the key the server diffs on, so a row can say NEW without a second rule. */
export function factKey(f) { return `${f?.kind}|${f?.label}|${f?.as_of}` }
export function catalystKey(c) { return `cat|${c?.market_date}|${c?.tag}` }

/** Pure (Wave 2, audit 2026-10-08): the one line that says HOW MUCH it moved — last price and
 *  the day's change, from the server's live row. A closed-session row says it is the last
 *  close's move, so a weekend read never passes for today's. Null when there is no price. */
export function moveQuoteText(q) {
  const price = Number(q?.price)
  if (!q || !Number.isFinite(price) || price <= 0) return null
  const pct = Number(q.change_pct)
  const chg = Number(q.change)
  const has = q.change_pct != null && Number.isFinite(pct)
  const dir = !has ? '' : pct > 0 ? 'up ' : pct < 0 ? 'down ' : 'flat '
  const move = has
    ? `${dir}${formatPercent(Math.abs(pct))}${q.change != null && Number.isFinite(chg) ? ` (${formatCurrency(Math.abs(chg))})` : ''}`
    : 'change not available'
  const when = q.session === 'closed' ? ' at the last close' : ' today'
  return `${formatCurrency(price)} · ${move}${has ? when : ''}`
}

/** Pure: the numbered follow-up commands for a security (row <GO> targets). The LAST one opens
 *  the stock's full news wire history (`NVDA UCN`). Being last, it never moves the rows above
 *  it; it is left out when the wire is known to be off on this server (`wire: false`). */
export function moveRows(sym, { wire = true } = {}) {
  if (!sym) return []
  const rows = [`${sym} CN`, `${sym} CATS`, `${sym} GP`, `${sym} DES`]
  return wire ? [...rows, wireStockCommand(sym)] : rows
}

const STATUS_TEXT = {
  partial: 'Some sources could not be reached; what is shown is incomplete.',
  unavailable: 'The intelligence sources could not be reached just now. This is not "no news".',
}

export default function MovePanel({ sym, onRun, onRows }) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: null, fetchedAt: null })
  const [attempt, setAttempt] = useState(0)   // Retry re-reads (completeness audit 2026-10-07)
  useEffect(() => {
    if (!sym) return undefined
    let live = true
    setState({ phase: 'loading', data: null, error: null, fetchedAt: null })
    jsonFetcher(`/api/terminal/move/${encodeURIComponent(sym)}`)
      .then((data) => { if (live) setState({ phase: 'ready', data, error: null, fetchedAt: Date.now() }) })
      .catch((err) => { if (live) setState({ phase: 'error', data: null, error: err, fetchedAt: null }) })
    return () => { live = false }
  }, [sym, attempt])

  // The news wire for this stock: its own read, started beside MOVE's and never awaited by it.
  const wire = useStockWire(sym, WIRE_ROWS.MOVE)
  const wireOn = wire.phase !== 'off'
  const rows = useMemo(() => moveRows(sym, { wire: wireOn }), [sym, wireOn])
  useEffect(() => { onRows?.(rows) }, [onRows, rows])

  // V8: MOVE composes the watchlist-intelligence + catalyst services fresh on every request
  // (`terminal_grammar.why_moving` — no cache, TERM-006's `real_time` tier verbatim), so the
  // panel's own fetch completion is an honest "as of" for what is on screen. Reported only once
  // data has actually landed — nothing fresh to claim while loading or after a failed fetch.
  usePanelFreshness(state.phase === 'ready' && state.fetchedAt
    ? { freshnessClass: 'real_time', asOf: new Date(state.fetchedAt).toISOString() }
    : null)

  if (!sym) {
    return (
      <PanelState kind="input" title="MOVE needs a ticker.">
        Type one first, e.g. <kbd>NVDA MOVE</kbd>
      </PanelState>
    )
  }
  if (state.phase === 'loading') return <PanelSkeleton label={`Loading why ${sym} is moving`} testId="terminal-move-loading" />
  if (state.phase === 'error') {
    const status = state.error?.status
    return (
      // A 404 here is either the grammar flag off or a cohort gap, and the backend sends the
      // same body for both, so the copy claims neither. Any other failure is an error with a Retry.
      status === 404
        ? <PanelState kind="locked" role="status" title="MOVE isn't switched on yet." testId="terminal-move-error" />
        : status === 402
        ? <PanelState kind="locked" role="status" title="MOVE is part of the paid plan." testId="terminal-move-error" />
        : <PanelState kind="error" title={state.error?.timedOut ? `Why ${sym} is moving did not answer within 30 seconds.` : `Could not load why ${sym} is moving just now.`} testId="terminal-move-error"
            action={<button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>}>
            Run {sym} MOVE again, or retry here.
          </PanelState>
    )
  }

  const d = state.data || {}
  const intel = d.intelligence || {}
  const facts = Array.isArray(intel.facts) ? intel.facts : []
  const cats = Array.isArray(d.catalysts) ? d.catalysts : []
  const since = d.since_last_visit || {}
  const fresh = new Set(since.new || [])
  // The market clock, labelled (audit 2026-10-08): a bare toLocaleString() printed the VIEWER's zone, unlabelled.
  const lastSeen = formatDateTimeEt(Number(since.last_visit_at))
  return (
    <div className={styles.help} data-testid="terminal-move">
      {moveQuoteText(d.quote) && (
        <p className={styles.helpSyntax} data-testid="terminal-move-quote"
          style={{ color: d.quote.change_pct > 0 ? 'var(--success-ink)' : d.quote.change_pct < 0 ? 'var(--danger-ink)' : undefined }}>
          <strong>{sym}</strong> {moveQuoteText(d.quote)}
        </p>
      )}
      <p className={styles.helpSyntax} data-testid="terminal-move-since">
        {since.first_visit
          ? `First MOVE visit to ${sym}: everything below is new to you.`
          : `${fresh.size} new since your last visit${lastSeen ? ` (${lastSeen})` : ''}.`}
      </p>
      {STATUS_TEXT[intel.status] && <p className={styles.helpRule} role="status">{STATUS_TEXT[intel.status]}</p>}

      <h3 className={styles.helpGroup}>What changed</h3>
      {facts.length === 0 && intel.status === 'ok' && (
        <p className={styles.helpRule} data-testid="terminal-move-nothing">Nothing notable has changed for {sym} in what we track (every source answered).</p>
      )}
      <ul className={styles.helpRule} data-testid="terminal-move-facts">
        {facts.map((f) => (
          <li key={factKey(f)} data-new={fresh.has(factKey(f)) ? 'true' : 'false'}>
            {fresh.has(factKey(f)) && <strong>NEW </strong>}{f.label}
            {asOfText(f.as_of) ? <span className={styles.helpScope}> · {asOfText(f.as_of)}</span> : null}
          </li>
        ))}
      </ul>

      <h3 className={styles.helpGroup}>Catalysts</h3>
      {d.catalyst_status === 'unavailable' && <p className={styles.helpRule}>The catalyst history could not be read right now. That is not a finding about {sym}.</p>}
      {d.catalyst_status === 'not_entitled' && <p className={styles.helpRule}>Catalyst history is part of the paid plan.</p>}
      {d.catalyst_status === 'ok' && cats.length === 0 && <p className={styles.helpRule} data-testid="terminal-move-no-catalysts">{sym} has never been flagged by the Stock Catalysts engine (it has recorded since May 25, 2026).</p>}
      <ul className={styles.helpRule} data-testid="terminal-move-catalysts">
        {cats.map((c) => (
          <li key={catalystKey(c)} data-new={fresh.has(catalystKey(c)) ? 'true' : 'false'}>
            {fresh.has(catalystKey(c)) && <strong>NEW </strong>}
            {c.market_date} · {c.tag}{c.thesis_text && !isFailedSynthesis(c.thesis_text) ? <>: <HighlightThesis text={c.thesis_text} /></> : ''}
          </li>
        ))}
      </ul>

      <h3 className={styles.helpGroup}>On the news wire</h3>
      <StockWire sym={sym} wire={wire} testId="terminal-move-wire">
        <p className={styles.helpRule} data-testid="terminal-move-wire-more">
          Row {rows.indexOf(wireStockCommand(sym)) + 1} below ({wireStockCommand(sym)}) opens the full news wire history, live.
        </p>
      </StockWire>

      <h3 className={styles.helpGroup}>Next (type the row number)</h3>
      {rows.map((cmd, i) => (
        <button key={cmd} type="button" className={styles.helpRow} onClick={() => onRun?.(cmd)}
          data-testid={`terminal-move-row-${i + 1}`}>
          <span className={styles.code}>{i + 1}</span>
          <span>{cmd}</span>
        </button>
      ))}
    </div>
  )
}
