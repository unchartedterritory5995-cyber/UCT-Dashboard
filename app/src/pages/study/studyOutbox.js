/**
 * studyOutbox — the ten-row localStorage outbox for drill answers (spec §13.7 D18).
 *
 * An answer is written here THE INSTANT Check is tapped, before the POST is even
 * sent, so a member whose connection drops mid-set loses nothing: the rows replay
 * on `online` (useStudySession) and the reveal arrives then, or on the end card.
 *
 * Ten rows is the cap because a daily set is ten items: anything older than the
 * current set is noise, and a member who answered eleven items offline has an
 * older row that no longer matters. Oldest rows are dropped first.
 *
 * Every read and write is wrapped: a private window, cleared site data or a
 * full quota throws on localStorage, and a drill must never die for that.
 */
export const OUTBOX_KEY = 'study.outbox'
export const OUTBOX_MAX = 10

function storage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function readOutbox() {
  const ls = storage()
  if (!ls) return []
  try {
    const raw = ls.getItem(OUTBOX_KEY)
    const rows = raw ? JSON.parse(raw) : []
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

export function writeOutbox(rows) {
  const ls = storage()
  if (!ls) return
  try {
    ls.setItem(OUTBOX_KEY, JSON.stringify(rows.slice(-OUTBOX_MAX)))
  } catch {
    // quota / private mode: the POST still goes out; only the replay is lost
  }
}

/** Add one row ({id, item_id, answer, session_id, time_ms, at}); returns the rows kept. */
export function enqueueOutbox(row) {
  const rows = readOutbox().filter((r) => r.id !== row.id)
  rows.push(row)
  const kept = rows.slice(-OUTBOX_MAX)
  writeOutbox(kept)
  return kept
}

export function dequeueOutbox(id) {
  const rows = readOutbox().filter((r) => r.id !== id)
  writeOutbox(rows)
  return rows
}

export function clearOutbox() {
  writeOutbox([])
}

/**
 * Replay every row in order through `post(row)` (a function that resolves with
 * the attempt result or rejects). A row that lands is removed; the first row
 * that fails stops the replay (the connection is still bad) and stays queued.
 * Resolves with [{row, result}] for the rows that landed.
 */
export async function replayOutbox(post) {
  const landed = []
  for (const row of readOutbox()) {
    try {
      const result = await post(row)
      dequeueOutbox(row.id)
      landed.push({ row, result })
    } catch {
      break
    }
  }
  return landed
}

export function outboxRowId(sessionId, itemId) {
  return `${sessionId || 'nosession'}:${itemId}`
}
