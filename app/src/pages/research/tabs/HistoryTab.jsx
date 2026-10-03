import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import styles from '../ResearchPage.module.css'

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

export async function fetchHistory(url) {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function HistoryTab({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, isLoading } = useMobileSWR(s ? `/api/research/history/${encodeURIComponent(s)}` : null, fetchHistory)
  const body = data && data.ok ? data.body : null
  const unavailableLanes = useMemo(() => {
    const lanes = (body && body.lanes) || {}
    return Object.keys(lanes).filter((k) => lanes[k] && lanes[k].status !== 'ok')
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

  if (isLoading && !data) return <div className={styles.card}>Loading history…</div>
  if (data && !data.ok) {
    return <div className={styles.card} data-testid="history-unavailable">
      History is unavailable right now. That does not mean nothing happened.
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
          No recorded mentions of {body.ticker} in these lanes since {body.since}.
        </div>
      ) : (
        <ul data-testid="history-rows">
          {rows.map((r, i) => (
            <li key={`${r.lane}-${r.date}-${i}`} data-testid="history-row">
              <strong>{r.date}</strong> · {LANE_LABEL[r.lane] || r.lane} · {r.text}
              {r.symbol && r.symbol !== body.ticker && <span className={styles.muted}> (as {r.symbol})</span>}
              <span className={styles.muted}> — {SOURCE_LABEL[r.source] || r.source}, as of {r.as_of}</span>
              {r.lane === 'flow' && r.ref && <> · <a href={r.ref}>Open Options Flow</a></>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
