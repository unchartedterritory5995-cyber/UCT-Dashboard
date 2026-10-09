import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import styles from '../ResearchPage.module.css'
import HighlightThesis, { isFailedSynthesis, FAILED_SYNTHESIS_NOTE } from '../../../utils/highlightThesis'
import { withDeadline } from '../../../utils/withDeadline'
import { usePanelFreshness, panelAsOf } from '../../../components/terminal/terminalPanel'

// TERM-049 (FB-A13-01) -- one ticker, one timeline. Reads
// GET /api/research/history/{sym} (api/services/ticker_history.py), DARK behind
// TICKER_HISTORY_ENABLED; the tab only renders while that flag rides the auth payload.
//
// ⛔ EVERY ROW NAMES ITS SOURCE AND ITS OWN DATE, and nothing is blended: the lanes are
// lists of dated facts, never a composite score (FB-A13-01's PROD-C5/C6 warning).
// ⛔ THE ROOM LANE IS COUNTS ONLY (owner ruling 2026-09-29): never message text or authors.
// ⛔ THE FLOW LANE IS COUNTS ONLY: prints per session plus a link to the Options Flow page;
// the API never receives premium, side or strike, so this tab cannot render them.
// ⛔ A FAILED READ IS NOT AN EMPTY HISTORY: an unavailable lane or request says so.
// ⛔ THE JOURNAL LANE IS THE VIEWER'S OWN TRADES ONLY (keyed server-side on the caller).

export const LANE_LABEL = {
  wire: 'Morning Wire',
  book: 'UCT 20',
  catalysts: 'Catalysts',
  room: 'Community room',
  flow: 'Options flow',
  setups: 'Setups',
  journal: 'Your journal',
}

const SOURCE_LABEL = {
  wire_archive: 'Morning Wire archive',
  uct20_compositions: 'UCT 20 ledger',
  catalysts: 'Catalyst list',
  buzz_mentions: 'Community mention counts',
  flow_tape: 'Options flow tape (print counts)',
  setup_triggers: 'UCT setup ledger',
  // The member's OWN journal (owner-scoped server-side); never anyone else's.
  j2_trades: 'Your Journal 2.0 trades (only you see these)',
  j2_positions: 'Your Journal 2.0 open positions (only you see these)',
}

// tq-panels: a row's text could render as NOTHING -- an empty/whitespace string, or one
// that is only bold markers ("** **"): HighlightThesis strips the markers and draws a
// blank. Every lane's server text is non-empty today (catalysts_lane falls back to "On
// the catalyst list"), but an older catalyst row or a future lane must not draw a blank
// row: say what the row is. A stored failure sentence is named as one, not shown as text.
export function rowText(r) {
  const raw = typeof r?.text === 'string' ? r.text : ''
  if (isFailedSynthesis(raw)) return FAILED_SYNTHESIS_NOTE
  if (raw.replace(/\*\*/g, '').trim()) return raw
  if (r?.lane === 'catalysts') return `On the catalyst list (${r.tag || 'untagged'})`
  return `${LANE_LABEL[r?.lane] || r?.lane || 'Entry'} entry; no description was recorded`
}

export async function fetchHistory(url) {
  try {
    const r = await withDeadline(fetch(url, { credentials: 'include' }), url)
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

// ANY lane (the options tape, the Wire archive, the member's journal...) answers `pending` when it has not
// finished inside the server's short wait; its read keeps going server-side. Ask again
// until every lane has answered -- then stop asking.
export function pendingLanesOf(body) {
  const lanes = (body && body.lanes) || {}
  return Object.keys(lanes).filter((k) => lanes[k] && lanes[k].status === 'pending')
}

export function historyRefreshMs(latest) {
  if (!latest || !latest.ok) return 0
  if (pendingLanesOf(latest.body).length === 0) return 0
  const lanes = latest.body.lanes || {}
  const hinted = Math.max(0, ...Object.values(lanes).map((l) => (l && l.status === 'pending' && l.retry_after_s) || 0))
  return Math.max(1000, (hinted || 2) * 1000)
}

export default function HistoryTab({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, isLoading, mutate } = useMobileSWR(s ? `/api/research/history/${encodeURIComponent(s)}` : null, fetchHistory,
    { refreshInterval: historyRefreshMs })
  // TERM-019: the history is read from several UCT records and every row names its own source and
  // date, so the terminal panel header says exactly that (a no-op outside the terminal).
  // `as_of` is the oldest lane read this answer was assembled from (never "now").
  usePanelFreshness(data && data.ok ? panelAsOf('several UCT records; each row names its own', data.body?.as_of) : null)
  const body = data && data.ok ? data.body : null
  const pendingLanes = useMemo(() => pendingLanesOf(body), [body])
  const unavailableLanes = useMemo(() => {
    const lanes = (body && body.lanes) || {}
    return Object.keys(lanes).filter((k) => lanes[k] && lanes[k].status !== 'ok' && lanes[k].status !== 'pending')
  }, [body])
  // A lane whose store began after the window opened: rows before `covers_from` were
  // never recorded. Without this, "0 wire mentions" read as "never named" (2026-09-29).
  const partialLanes = useMemo(() => {
    const lanes = (body && body.lanes) || {}
    return Object.keys(lanes).filter((k) => lanes[k] && lanes[k].status === 'ok' && lanes[k].partial)
  }, [body])

  // Names this ticker was recorded under before (Entity Master, when armed).
  const renamedFrom = useMemo(() => {
    const e = body && body.entity
    if (!e || e.status !== 'resolved') return []
    return (e.aliases || []).filter((a) => a.alias !== body.ticker)
  }, [body])

  if (isLoading && !data) return <div className={styles.card} role="status" data-testid="history-loading">Loading history…</div>
  // 402 is the paid gate, not an outage.
  if (data && !data.ok && data.httpStatus === 402) {
    return <div className={styles.card} data-testid="history-paywalled">Ticker history requires a paid plan.</div>
  }
  if (data && !data.ok) {
    return <div className={styles.card} data-testid="history-unavailable">
      History is unavailable right now. That does not mean nothing happened.{' '}
      <button type="button" className={styles.basisBtn} onClick={() => mutate?.()}>Retry</button>
    </div>
  }
  if (!body) return null

  const rows = body.timeline || []
  return (
    <section data-testid="history-tab">
      <p className={styles.muted}>
        Since {body.since}: what {Object.keys(body.lanes || {}).map((k) => LANE_LABEL[k] || k).join(', ')} recorded
        about {body.ticker}. Each row names its source and date.
        {body.not_rendered && body.not_rendered.flow ? ' Options flow is not included yet.' : ''}
      </p>
      {renamedFrom.length > 0 && (
        <p className={styles.muted} data-testid="history-entity">
          Joined across renames: {renamedFrom.map((a) => `${a.alias}${a.valid_to ? ` (until ${a.valid_to})` : ''}`).join(', ')}.
        </p>
      )}
      {pendingLanes.length > 0 && (
        <p className={styles.muted} data-testid="history-lane-pending" role="status">
          Still reading: {pendingLanes.map((k) => LANE_LABEL[k] || k).join(', ')}. Those rows will appear here in a
          moment; until then they are not shown, which does not mean there are none.
        </p>
      )}
      {unavailableLanes.length > 0 && (
        <p className={styles.muted} data-testid="history-lane-unavailable">
          Could not read: {unavailableLanes.map((k) => LANE_LABEL[k] || k).join(', ')}. Rows from those lanes are missing, not absent.
        </p>
      )}
      {partialLanes.length > 0 && (
        <p className={styles.muted} data-testid="history-lane-partial">
          Recorded only from:{' '}
          {partialLanes.map((k) => {
            const { covers_from: from, covers_to: to } = body.lanes[k]
            return `${LANE_LABEL[k] || k} ${from ? `since ${from}${to ? ` (through ${to})` : ''}` : '(nothing recorded yet)'}`
          }).join(' · ')}. Earlier dates in this window were not recorded, so a missing row there is not a no.
        </p>
      )}
      {rows.length === 0 ? (
        <div className={styles.card} data-testid="history-empty">
          No recorded mentions of {body.ticker} in these lanes since {body.since}
          {pendingLanes.length > 0 ? ` so far (${pendingLanes.map((k) => LANE_LABEL[k] || k).join(', ')} still reading)` : ''}.
        </div>
      ) : (
        // Wave 3 (HIS P2 #25): the rows were an unstyled bullet list of run-on text. Each row is a
        // ruled entry now: date · lane · what happened on one line, its source on its own line.
        // Wave 3 (HIS P2 #21): the flow link leaves the terminal, and says so like FlowGate does.
        <ul data-testid="history-rows" className={styles.historyList}>
          {rows.map((r, i) => (
            <li key={`${r.lane}-${r.date}-${i}`} data-testid="history-row" className={styles.historyRow}>
              <strong className={styles.historyDate}>{r.date}</strong> · {LANE_LABEL[r.lane] || r.lane} · <HighlightThesis text={rowText(r)} />
              {r.symbol && r.symbol !== body.ticker && <span className={styles.muted}> (as {r.symbol})</span>}
              <span className={`${styles.muted} ${styles.historySource}`} data-testid="history-row-source"> — {SOURCE_LABEL[r.source] || r.source}, as of {r.as_of}
                {r.lane === 'flow' && r.ref && <> · <a href={r.ref}>Open Options Flow</a> (opens a page)</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
