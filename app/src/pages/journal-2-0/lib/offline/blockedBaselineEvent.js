/**
 * Wave Q1 — INSTRUMENT THE NULL. STOP HUNTING IT.
 *
 * Nine paths were driven trying to reproduce `baseUpdatedAt: null` and none of
 * them did. A tenth guess is not evidence. What closes this is the production
 * population telling us whether it ever happens again, so the drain's refusal
 * now emits ONE structured event when it fires, carrying the artifact shape the
 * incident carried — and nothing else.
 *
 * ⛔ NO NOTE CONTENT. Not the title, not the subtitle, not the body, not the
 * patch. The fields below are ids, counters, and an enumerated description of a
 * value that is by construction not member text. This is the difference between
 * an instrument and a leak, and it is enforced by a rail that asserts the exact
 * key set rather than "no body key".
 *
 * ⛔ THE RAW BASELINE IS DELIBERATELY NOT SENT. Every value that reaches here
 * has already failed `isUsableBaseline`, so it is null, undefined, a blank
 * string, or not a string at all — `describeBaseline` says which, exactly, and
 * that is strictly more information than the value itself. Sending the raw
 * value would add nothing and would be the one path by which member text could
 * ever ride along if some future bug put text in that field.
 *
 * ⛔ WHERE IT GOES. `POST /api/j2/telemetry` — the Notebook's existing
 * allow-listed client→server event channel, already used by this very tab
 * (`notebook_tab_visit`). It lands in `activity_log` and is read back by
 * `GET /api/admin/activity` (`auth_service.get_recent_activity`). It is a
 * TELEMETRY sink, not an error pipeline; this app has no client error pipeline,
 * and inventing a transport was not the smallest thing that works.
 */
import { OFFLINE_DEFAULT_ON, OFFLINE_FLAG_KEY, offlineEnabled } from './offlineFlag'

/** ⛔ Must also be present in `_J2_TELEMETRY_EVENTS` (api/routers/journal_two.py)
 *  or the POST is rejected with 400. Railed on the backend side. */
export const BLOCKED_BASELINE_EVENT = 'notebook_blocked_no_baseline'

/**
 * The enumerated shapes a value can have to fail `isUsableBaseline`.
 * ⛔ Every branch here is reachable from that predicate; there is no default
 * bucket standing in for "we did not think about it" — `other` exists so an
 * unforeseen shape is reported as unforeseen instead of mislabelled.
 */
export function describeBaseline(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v !== 'string') return `non-string:${typeof v}`
  if (v === '') return 'empty-string'
  if (v.trim() === '') return 'whitespace'
  return 'other'
}

/** What the flag was at the moment of the refusal — the state, and how it got
 *  there, because "off by default" and "explicitly off" are different facts
 *  (`project_feature_flag_ledger`). */
export function flagState(storage = globalThis.localStorage) {
  let key = null
  try { key = storage?.getItem(OFFLINE_FLAG_KEY) ?? null } catch { key = null }
  return { key, enabled: offlineEnabled(storage), byDefault: key === null, def: OFFLINE_DEFAULT_ON }
}

/**
 * @param report  the drain's own description of the refusal (see `outboxDrain`)
 * @returns the exact props object that was posted, so a rail can read it
 */
export function blockedBaselineProps(report, { now = Date.now, storage } = {}) {
  const queuedAt = Number(report?.queuedAt)
  return {
    noteId: report?.noteId ?? null,
    generation: report?.generation ?? null,
    sessionId: report?.sessionId ?? null,
    baseline: describeBaseline(report?.baseUpdatedAt),
    entryAgeMs: Number.isFinite(queuedAt) ? Math.max(0, now() - queuedAt) : null,
    attempts: report?.attempts ?? 0,
    flag: flagState(storage),
  }
}

/** Best-effort, never throws into the drain. An instrument that can break the
 *  thing it measures is worse than no instrument. */
export async function postBlockedBaseline(report, { fetchImpl, now, storage } = {}) {
  const props = blockedBaselineProps(report, { now, storage })
  const f = fetchImpl || globalThis.fetch
  try {
    await f('/api/j2/telemetry', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: BLOCKED_BASELINE_EVENT, props }),
    })
  } catch { /* the refusal already happened; the report is not the guard */ }
  return props
}
