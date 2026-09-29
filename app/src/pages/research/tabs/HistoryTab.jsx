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
// ⛔ A FAILED READ IS NOT AN EMPTY HISTORY: an unavailable lane or request says so.

export const LANE_LABEL = {
  wire: 'Morning Wire',
  book: 'UCT 20',
  catalysts: 'Catalysts',
  room: 'Community room',
}

const SOURCE_LABEL = {
  wire_archive: 'Morning Wire archive',
  uct20_compositions: 'UCT 20 ledger',
  catalysts: 'Catalyst list',
  buzz_mentions: 'Community mention counts',
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
        Since {body.since}: what the Morning Wire, the UCT 20, the catalyst list and the community room
        recorded about {body.ticker}. Each row names its source and date. Flow is not included yet.
      </p>
      {unavailableLanes.length > 0 && (
        <p className={styles.muted} data-testid="history-lane-unavailable">
          Could not read: {unavailableLanes.map((k) => LANE_LABEL[k] || k).join(', ')}. Rows from those lanes are missing, not absent.
        </p>
      )}
      {partialLanes.length > 0 && (
        <p className={styles.muted} data-testid="history-lane-partial">
          Recorded only from:{' '}
          {partialLanes.map((k) => {
            const from = body.lanes[k].covers_from
            return `${LANE_LABEL[k] || k} ${from ? `since ${from}` : '(nothing recorded yet)'}`
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
              <span className={styles.muted}> — {SOURCE_LABEL[r.source] || r.source}, as of {r.as_of}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
