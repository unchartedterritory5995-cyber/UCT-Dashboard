// app/src/components/provenance/availabilityContract.js
//
// S8 Step 2 (owner ruling, 2026-09-02): AVAILABILITY is an orthogonal
// dimension from FRESHNESS — never an 8th FreshnessClass value, never folded
// into freshnessContract.js's mapping. A result can be fresh-but-restricted,
// stale-but-otherwise-valid, not-found, provider-unsupported, or
// provider-failed, and S8 must be able to render each combination without
// pretending they are one axis.
//
// This module is the D1 -> S8 boundary for that SECOND axis, mirroring
// freshnessContract.js's shape (an exhaustive, throw-on-unknown mapping)
// deliberately, so the two axes are structurally parallel and neither can
// quietly absorb the other's job.
//
// ⛔ EVIDENCE, NOT INVENTION. D1's typed error taxonomy (`api/services/
// provider_errors.py`) does not currently distinguish "this vendor does not
// support this capability at all" from "this vendor rejected us with a 403
// because our plan/tier lacks entitlement" — both surface as the SAME typed
// fact (`ProviderAuthError.entitlement_denied === true`), confirmed during
// the D1 provenance/freshness hardening review. This module does NOT invent
// a `provider_unsupported` state the backend has no way to actually report
// yet; `entitlement_denied` covers both live-evidenced cases honestly
// (Massive's index-quote 403 is the confirmed example of the second one).

/** The five states D1's real, typed evidence can currently support —
 *  derived from `api/routers/provenance_quote.py`'s `_error_shape()` `kind`
 *  values plus a genuine successful ProviderResult. Each is a REACHED,
 *  evidenced fact, not a guess: */
export const AVAILABLE = 'available'
export const NOT_FOUND = 'not_found'
export const ENTITLEMENT_DENIED = 'entitlement_denied'
export const PROVIDER_ERROR = 'provider_error'
export const UNKNOWN = 'unknown'

const KIND_TO_AVAILABILITY = Object.freeze({
  not_found: NOT_FOUND,
  auth_error: ENTITLEMENT_DENIED,
  rate_limited: PROVIDER_ERROR,
  transient: PROVIDER_ERROR,
  not_configured: PROVIDER_ERROR,
})

/**
 * Map one vendor's raw `/api/provenance/quote` result (either a successful
 * `ProviderResult.to_dict()` or the endpoint's typed `{error: true, kind,
 * ...}` shape) to the availability state `<Provenance>` renders.
 *
 * A successful result whose `degraded === "cached_forbidden"` is ALSO
 * `ENTITLEMENT_DENIED` — it is the cached memory of the identical fact a
 * fresh 403 would report, not a different one, so it must read the same way
 * to a member.
 *
 * ⛔ THROWS on a `kind` this module does not recognize — the same
 * exhaustiveness discipline as `freshnessContract.js::mapD1Freshness`,
 * for the same reason: a silently-added new backend failure kind must be
 * handled here deliberately, never absorbed into a default that could
 * misrepresent why a value is missing.
 */
export function mapAvailability(vendorResult) {
  if (!vendorResult || typeof vendorResult !== 'object') return UNKNOWN
  if (vendorResult.error) {
    const mapped = KIND_TO_AVAILABILITY[vendorResult.kind]
    if (!mapped) {
      throw new Error(
        `mapAvailability: unrecognized error kind ${JSON.stringify(vendorResult.kind)}. `
        + 'KIND_TO_AVAILABILITY in availabilityContract.js must be extended '
        + 'deliberately before this kind can reach a render.',
      )
    }
    return mapped
  }
  if (vendorResult.degraded === 'cached_forbidden') return ENTITLEMENT_DENIED
  if (vendorResult.degraded === 'circuit_open') return PROVIDER_ERROR
  return AVAILABLE
}

export const KNOWN_AVAILABILITY_STATES = Object.freeze([
  AVAILABLE, NOT_FOUND, ENTITLEMENT_DENIED, PROVIDER_ERROR, UNKNOWN,
])

/** Human-facing label per state — deliberately plain (not a design pass;
 *  S10 owns the eventual visual, per SPEC-S8 §5.2's own admission). */
export const AVAILABILITY_LABEL = Object.freeze({
  [AVAILABLE]: null, // renders nothing extra — the value speaks for itself
  [NOT_FOUND]: 'no data',
  [ENTITLEMENT_DENIED]: 'not available on this plan',
  [PROVIDER_ERROR]: 'provider error',
  [UNKNOWN]: 'unavailable',
})
