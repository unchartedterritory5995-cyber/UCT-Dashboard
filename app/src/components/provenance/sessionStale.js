// app/src/components/provenance/sessionStale.js
//
// S8's OWN computation of `session_stale` (PRD-S8 §9.6), fed by S11
// (`app/src/lib/marketClock/marketClock.js`) — completing the
// FreshnessBadge/§19 Step 3 dependency the S8 completion report deferred.
//
// S11 does not know what "staleness" means; it only exposes session
// boundaries (`sessionState().boundaryAt`). This module is where "does this
// rendered value need refreshing for the CURRENT session" is decided —
// never a flat wall-clock timeout, always relative to the most recent
// session-transition boundary S11 knows about (PRD-S8 §9.6: "based on the
// actual approved S11/S8 architecture... not merely 'some amount of
// wall-clock time has passed'").
//
// ⛔ Independent of D1's SOURCE_STALE (`freshnessContract.js`). A value can
// be source-fresh + session-current, source-stale + session-current,
// source-fresh + session-stale, or source-stale + session-stale — this
// module computes ONLY the second axis and never reads a `FreshnessClass`.

import { sessionState } from '../../lib/marketClock/marketClock'

function _coerceDate(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    // D1's `source_observed_at` is epoch seconds; accept epoch ms too.
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * True when `asOf` (the rendered value's own observed-at timestamp) predates
 * the most recent session-transition boundary S11 knows about for `now` —
 * i.e. the market's session has moved on since this value was captured, so
 * the VIEW should be refreshed even if the underlying source data is not
 * (D1-side) stale.
 *
 * `asOf` accepts a Date, an ISO string, or epoch seconds/ms. Missing or
 * unparseable input returns `false` — session staleness is only ever a
 * claim backed by evidence, never a fabricated default (PRD-S8 §9.7/§9.8's
 * "unknown is preferable to a fabricated classification," applied here to
 * the session axis).
 */
export function computeSessionStale(asOf, now = new Date()) {
  const asOfDate = _coerceDate(asOf)
  if (!asOfDate) return false
  const { boundaryAt } = sessionState(now)
  if (!boundaryAt) return false
  return asOfDate.getTime() < boundaryAt.getTime()
}
