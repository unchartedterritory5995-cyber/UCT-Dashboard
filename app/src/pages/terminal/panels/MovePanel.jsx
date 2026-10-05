// MOVE / WIIM — "why is it moving" (TERMINAL-NEXT lane T3, V15).
//
// ⛔ NOT A NEW ANALYSIS. The server route (`/api/terminal/move/:sym`) composes the services
// that already exist — watchlist-intelligence facts and the catalyst engine's recent rows —
// and diffs them against THIS member's last MOVE visit to the security ("since last visit").
// Every leg reports its own status, so an outage reads as "could not check", never as
// "nothing happened" (watchlist_intelligence's own contract).
//
// Row <GO>: the numbered rows are commands (`NVDA CN`, `NVDA CATS` …) published to the shell
// through `onRows`, so typing `2` + Enter opens row 2.
import { useEffect, useMemo, useState } from 'react'
import jsonFetcher from '../../../utils/jsonFetcher'
import HighlightThesis from '../../../utils/highlightThesis'
import { usePanelFreshness } from '../panelFreshness'
import styles from '../TerminalShell.module.css'

/** Pure: the key the server diffs on, so a row can say NEW without a second rule. */
export function factKey(f) { return `${f?.kind}|${f?.label}|${f?.as_of}` }
export function catalystKey(c) { return `cat|${c?.market_date}|${c?.tag}` }

/** Pure: the numbered follow-up commands for a security (row <GO> targets). */
export function moveRows(sym) {
  if (!sym) return []
  return [`${sym} CN`, `${sym} CATS`, `${sym} GP`, `${sym} DES`]
}

const STATUS_TEXT = {
  partial: 'Some sources could not be reached; what is shown is incomplete.',
  unavailable: 'The intelligence sources could not be reached just now. This is not "no news".',
}

export default function MovePanel({ sym, onRun, onRows }) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: null, fetchedAt: null })
  useEffect(() => {
    if (!sym) return undefined
    let live = true
    setState({ phase: 'loading', data: null, error: null, fetchedAt: null })
    jsonFetcher(`/api/terminal/move/${encodeURIComponent(sym)}`)
      .then((data) => { if (live) setState({ phase: 'ready', data, error: null, fetchedAt: Date.now() }) })
      .catch((err) => { if (live) setState({ phase: 'error', data: null, error: err, fetchedAt: null }) })
    return () => { live = false }
  }, [sym])

  const rows = useMemo(() => moveRows(sym), [sym])
  useEffect(() => { onRows?.(rows) }, [onRows, rows])

  // V8: MOVE composes the watchlist-intelligence + catalyst services fresh on every request
  // (`terminal_grammar.why_moving` — no cache, TERM-006's `real_time` tier verbatim), so the
  // panel's own fetch completion is an honest "as of" for what is on screen. Reported only once
  // data has actually landed — nothing fresh to claim while loading or after a failed fetch.
  usePanelFreshness(state.phase === 'ready' && state.fetchedAt
    ? { freshnessClass: 'real_time', asOf: new Date(state.fetchedAt).toISOString() }
    : null)

  if (!sym) return <div className={styles.panelEmpty}>Type a ticker for MOVE — e.g. <kbd>NVDA MOVE</kbd></div>
  if (state.phase === 'loading') return <div className={styles.panelEmpty}>Loading why {sym} is moving…</div>
  if (state.phase === 'error') {
    const status = state.error?.status
    return (
      <div className={styles.panelEmpty} role="status" data-testid="terminal-move-error">
        {/* A 404 here is either the grammar flag off or a cohort gap, and the
            backend sends the same body for both, so the copy claims neither. */}
        {status === 404 ? `MOVE isn't switched on yet.`
          : `Could not load why ${sym} is moving just now. Run ${sym} MOVE again to retry.`}
      </div>
    )
  }

  const d = state.data || {}
  const intel = d.intelligence || {}
  const facts = Array.isArray(intel.facts) ? intel.facts : []
  const cats = Array.isArray(d.catalysts) ? d.catalysts : []
  const since = d.since_last_visit || {}
  const fresh = new Set(since.new || [])
  const lastSeen = since.last_visit_at ? new Date(since.last_visit_at * 1000).toLocaleString() : null
  return (
    <div className={styles.help} data-testid="terminal-move">
      <p className={styles.helpSyntax} data-testid="terminal-move-since">
        {since.first_visit
          ? `First MOVE visit to ${sym}: everything below is new to you.`
          : `${fresh.size} new since your last visit${lastSeen ? ` (${lastSeen})` : ''}.`}
      </p>
      {STATUS_TEXT[intel.status] && <p className={styles.helpRule} role="status">{STATUS_TEXT[intel.status]}</p>}

      <h3 className={styles.helpGroup}>What changed</h3>
      {facts.length === 0 && intel.status === 'ok' && (
        <p className={styles.helpRule}>No notable facts fired for {sym} (every source answered).</p>
      )}
      <ul className={styles.helpRule} data-testid="terminal-move-facts">
        {facts.map((f) => (
          <li key={factKey(f)} data-new={fresh.has(factKey(f)) ? 'true' : 'false'}>
            {fresh.has(factKey(f)) && <strong>NEW </strong>}{f.label}
            {f.as_of ? <span className={styles.helpScope}> · {f.as_of}</span> : null}
          </li>
        ))}
      </ul>

      <h3 className={styles.helpGroup}>Catalysts</h3>
      {d.catalyst_status === 'unavailable' && <p className={styles.helpRule}>The catalyst history could not be reached just now.</p>}
      {d.catalyst_status === 'not_entitled' && <p className={styles.helpRule}>Catalyst history is part of the paid plan.</p>}
      {d.catalyst_status === 'ok' && cats.length === 0 && <p className={styles.helpRule}>{sym} has not appeared in Stock Catalysts recently.</p>}
      <ul className={styles.helpRule} data-testid="terminal-move-catalysts">
        {cats.map((c) => (
          <li key={catalystKey(c)} data-new={fresh.has(catalystKey(c)) ? 'true' : 'false'}>
            {fresh.has(catalystKey(c)) && <strong>NEW </strong>}
            {c.market_date} · {c.tag}{c.thesis_text ? <> — <HighlightThesis text={c.thesis_text} /></> : ''}
          </li>
        ))}
      </ul>

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
