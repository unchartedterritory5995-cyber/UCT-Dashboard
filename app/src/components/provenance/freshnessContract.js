// app/src/components/provenance/freshnessContract.js
//
// ─── THE D1 → S8 PRESENTATION BOUNDARY FOR FRESHNESS ────────────────────────
//
// D1's provenance/freshness hardening pass (2026-09-02) added a 5th value to
// `api/services/provider_errors.py::FreshnessClass`: `stale`, computed
// backend-side from the vendor's own reported observation timestamp — the
// SOURCE/PROVIDER data itself looks abandoned (a real, evidence-backed fact,
// e.g. Massive's/FMP's live-confirmed stale-quote finding for a delisted or
// illiquid symbol). PRD-S8 §7.2 previously cited only a 4-value enum from
// `data-architecture.md §12.1`, and S8's own §9.6 already used the bare word
// "stale" for a DIFFERENT concept: a rendered value that hasn't been
// refreshed recently enough for the CURRENT viewing session ("never a flat
// wall-clock timeout"). Two different facts, one word — this is the S8
// readiness-review finding recorded in PRD-S8 §7.2a / SPEC-S8 §5.2a.
//
// ⛔ THE RESOLUTION (owner decision, 2026-09-02), enforced structurally here:
//   - D1's backend meaning is PRESERVED EXACTLY, never renamed/reinterpreted.
//     Its D1-side literal stays `"stale"` — see `D1_FRESHNESS_PRESENTATION`
//     below, which reads it verbatim.
//   - S8's own session-derived concept is renamed `SESSION_STALE` everywhere
//     in this component family. The bare word "stale" must never again be
//     used as an S8-internal state name for BOTH meanings — grep this file's
//     exports before adding a third spelling.
//
// This module is the ONE place a raw D1 `freshness` string is interpreted.
// `mapD1Freshness()` is EXHAUSTIVE over D1's real, live enum and THROWS on
// anything else: a 6th backend value reaching a render is a contract break
// between D1 and S8 that must be fixed HERE, deliberately, never silently
// absorbed into a default that could misrepresent a value's true state.

/** The label S8 uses for D1's own, backend-computed source-data staleness.
 *  Never spell this "stale" bare — always through this constant or the
 *  `isSourceStale` field `mapD1Freshness()` returns. */
export const SOURCE_STALE = 'source_stale'

/** The label S8 uses for its own, frontend/session-derived rendering
 *  staleness (PRD-S8 §9.6) — distinct from `SOURCE_STALE` above. Its actual
 *  computation needs S11's fuller session/holiday model (SPEC-S8 §19 Step 3)
 *  and is deliberately NOT built in Step 1 (see `FreshnessBadge.jsx`); this
 *  constant exists now so the vocabulary is fixed before any code computes
 *  it, and the collision this module exists to prevent cannot silently
 *  reappear under a third name later. */
export const SESSION_STALE = 'session_stale'

/** Every value D1's FreshnessClass (`api/services/provider_errors.py`) is
 *  known to emit today — read directly from that file, 2026-09-02, never
 *  guessed. A value added there must be added HERE, deliberately, with its
 *  own presentation decision, before it can reach a render — see the module
 *  header. `disclosureRequired` on `delayed_15` threads PRD-S8 §9.4/§10.3's
 *  UTP/CTA delayed-data disclosure obligation through from day one, even
 *  though wiring it to a real delayed-price surface is Step 2+ work. */
const D1_FRESHNESS_PRESENTATION = Object.freeze({
  real_time: Object.freeze({
    tier: 'real_time', isSourceStale: false, label: 'LIVE', disclosureRequired: false,
  }),
  delayed_15: Object.freeze({
    tier: 'delayed_15', isSourceStale: false, label: 'DELAYED 15 MIN', disclosureRequired: true,
  }),
  end_of_day: Object.freeze({
    tier: 'end_of_day', isSourceStale: false, label: 'END OF DAY', disclosureRequired: false,
  }),
  historical: Object.freeze({
    tier: 'historical', isSourceStale: false, label: 'HISTORICAL', disclosureRequired: false,
  }),
  stale: Object.freeze({
    tier: 'stale', isSourceStale: true, label: 'SOURCE STALE', disclosureRequired: false,
  }),
})

/** The presentation for D1's own documented "unknown, not established" state
 *  (`provider_errors.ProviderResult.freshness: Optional[FreshnessClass]`,
 *  `None` when the adapter never set it). This is a distinct, honest state —
 *  never coerced to `real_time` or any other tier, per PRD-S8 §9.7/§9.8's
 *  "unknown is preferable to a fabricated classification." */
const UNKNOWN_PRESENTATION = Object.freeze({
  tier: 'unknown', isSourceStale: false, label: null, disclosureRequired: false,
})

/**
 * Map D1's raw `freshness` value to the presentation shape `<FreshnessBadge>`
 * consumes: `{tier, isSourceStale, label, disclosureRequired}`.
 *
 * `freshness == null` (D1's own documented "not established" state) resolves
 * to `UNKNOWN_PRESENTATION` — not an error, and not a default real-time
 * guess.
 *
 * ⛔ THROWS on any other, unrecognized string. This is intentional and load-
 * bearing: a silently-added 6th backend value must be handled here
 * deliberately before it can reach a render. Catch this in a boundary
 * component only if you also decide what to show while the decision is
 * pending — never to paper over the throw.
 */
export function mapD1Freshness(freshness) {
  if (freshness === null || freshness === undefined) return UNKNOWN_PRESENTATION
  const presentation = D1_FRESHNESS_PRESENTATION[freshness]
  if (!presentation) {
    throw new Error(
      `mapD1Freshness: unrecognized D1 freshness value ${JSON.stringify(freshness)}. `
      + 'D1_FRESHNESS_PRESENTATION in freshnessContract.js must be extended '
      + 'deliberately -- with its own tier/label/disclosure decision -- before '
      + 'this value can reach a render. Do not add a default branch here.',
    )
  }
  return presentation
}

/** The exhaustive key set, exported so a test can assert it against D1's
 *  actual Python enum without hand-retyping the list a second time and
 *  risking the two silently drifting apart. */
export const KNOWN_D1_FRESHNESS_VALUES = Object.freeze(Object.keys(D1_FRESHNESS_PRESENTATION))
