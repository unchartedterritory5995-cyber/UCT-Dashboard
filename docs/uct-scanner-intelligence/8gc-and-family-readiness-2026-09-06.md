# 8G-C Readiness + Remaining-Family Canonical Readiness Matrix

**Date:** 2026-09-06. **Authorization:** owner direction, step 15 of the
scan-completeness package review response — "return to parallel roadmap
work... priority: preserve 8G-B; identify next unblocked local package;
prepare 8G-C readiness only (not activation); prepare remaining-family
readiness/test matrices; continue reliability research where it does not
overlap production." **This document is research/preparation only — no
code, config, schema, or scheduler change. Nothing here activates
anything.** Worktree: `C:\Users\Patrick\uct-dashboard-scanner-readiness`,
branch `docs/8gc-and-family-readiness`, off `origin/master@cbe687024`.

---

## Part 1 — 8G-C Readiness (admin-only full rendered PEG proof)

8G-C is defined (continuity-checkpoint.md, repeated across the 8G-A/B
sections) as: real production PEG detection → canonical persistence →
canonical scanner result → canonical geometry → deterministic structured
explanation → real chart render → admin-only proof. **Not authorized for
activation here or ever without separate explicit owner authorization.**
This section is readiness only, per the owner's own 8 required items.

### 1. Verify the exact current path (grounded, not assumed)

Traced directly this session, current master (`cbe687024`):

- **Detection → canonical adaptation:** `_scan_patterns_daily`
  (`api/main.py`) calls `canonical_adapter.adapt_power_earnings_gap(d)`
  when `PATTERN_CANONICAL_ADAPT_ENABLED=1` (confirmed ON in production)
  and `d["pattern_id"] == "power_earnings_gap"`. This produces
  `eligibility` + `event` + a reconstructed `gate_trace` **in memory
  only** — see the next bullet for why it does not yet survive storage.
- **Persistence:** `memory.store_detection(d)` writes to
  `pattern_detections` via `pattern_db.py`'s 5 existing JSON columns
  (quality/geometry/levels/context/narrative) + the one additive
  `eligibility_json` column (Package 8C). **There is still no column for
  `event_json`/`criteria_json`/`gate_trace_json`** — `canonical_adapter.py`
  says this explicitly in its own header ("NOT YET PERSISTED... that is
  real schema work for a later, explicitly-authorized stage"). Confirmed
  unchanged this session — no new `ALTER` has landed since the spec was
  written.
- **Canonical scanner result:** `pattern_join.py::read_pattern_fields`
  is the ONLY real, live, member-facing scanner data path (confirmed by
  the Phase-7 spec's own Package-8C trace, re-confirmed not touched by
  anything since). It still reads only the original 5 columns — it does
  not read `eligibility_json` either, so nothing about the canonical
  extension reaches the scanner surface today, even read-only.
- **Chart render (admin-only proof target):** `PatternOverlay.jsx` is
  mounted in `StockChart.jsx` and dispatches on `geometry.shape` — real,
  generic, already correct at the shape/style level (Phase-7 §2/§28).
  **Its only toggle is dead code** — confirmed this session at
  `app/src/components/chart/ChartToolbar.jsx:1348`:
  `{false && !hidePatterns && onTogglePatterns && (<PatternToolbarButton .../>)}`.
  No user, admin or otherwise, can turn this on today through the UI.
- **Admin-only surface that already exists:** `api/routers/admin_patterns.py`
  (`/api/admin/patterns/*`, `require_admin`-gated since 2026-08-09 — its
  own header records that ALL THREE routes were open to the internet
  before that date, a real prior incident, now fixed) has `GET /health`
  and an operator review-marking endpoint (`user_id` hardcoded to
  `"admin_operator"` so admin QA never mingles with end-user feedback).
  This is the natural home for an 8G-C "admin proof" surface, not a new
  router.

### 2. Files / components identified

Backend: `api/services/pattern_engine/canonical_adapter.py` (adaptation),
`api/services/pattern_engine/pattern_db.py` + `memory.py` (persistence —
needs the `event_json`/`criteria_json`/`gate_trace_json` columns
per the spec's own revised, narrower migration recommendation — see
Addendum §484-488 of the spec: **only `eligibility_json` was ever
actually required**, the other three are either already reconstructable
from existing columns or deferred), `api/services/screener/pattern_join.py`
(would need to `SELECT` the additive column(s) — a query change, not a
schema change, per the spec's own field-level matrix), `api/routers/admin_patterns.py`.
Frontend: `app/src/components/chart/ChartToolbar.jsx` (dead toggle),
`app/src/components/chart/PatternOverlay.jsx` + `patternShapes/*.jsx`
(render, already correct), no new admin-only page currently exists for a
rendered proof view — would need one (or an admin-gated panel on an
existing page) unless the intent is server-side proof only (no new UI).

### 3. Geometry / explanation contracts — verified, not assumed

Geometry: 6-shape vocabulary already covers PEG (`candle_mark`, real
multi-point anchors). One known, real quirk (Phase-7 §24, re-verified not
fixed): PEG's post-gap-high/low anchors stamp the **current last-bar**
timestamp rather than the bar the extreme actually occurred at
(`post_gap_low_idx` is computed but unused for the anchor's `t`) — a
renderer trusting the anchor's own timestamp would visually mislabel
where the post-gap extreme happened. **This would be visible in an 8G-C
rendered proof and should be fixed before or as part of that package**,
not silently accepted. Explanation: PEG's `Narrative` (5 fields) is
genuinely populated, real prose — no stubbed content. No `narrative_facts`
grounding layer exists yet (Phase-7 §15, deferred) — an 8G-C proof would
render real narrative text but could not yet mechanically verify every
number in it traces to a real computed value.

### 4. Test matrix (defined, not built)

Would need, at minimum: (a) a DB round-trip parity test (detector →
`canonical_adapter.adapt_power_earnings_gap` → `store_detection` → real
SQLite write → read back → re-derive the canonical summary) — the exact
test the Phase-7 spec's own Addendum requires "before this path becomes
authoritative" (§490, item 3) and which does not exist yet (only
in-memory-only parity tests exist per that same addendum); (b) a
geometry-integrity test for the PEG anchor-timestamp quirk above; (c) an
admin-auth test proving the proof surface is unreachable by a non-admin
account (mirroring the pre-2026-08-09 admin_patterns incident this repo
already suffered once); (d) a fixture proving a non-PEG family's
detection is never affected (isolation, mirroring 8G-B's own functional
proof discipline).

### 5. Admin-only render proof procedure (defined, not run)

1. Confirm `PATTERN_CANONICAL_ADAPT_ENABLED=1` (already true in prod).
2. A separate, NEW flag (not `PATTERN_CANONICAL_SCANNER_PILOT_ENABLED` —
   that name and its 8G-B semantics stay reserved for the existing
   scanner-summary pilot) would gate the chart-render proof specifically,
   defaulting OFF.
3. Flip the `ChartToolbar.jsx` dead toggle — but ONLY behind an
   admin-role check at render time (not a global user-facing toggle),
   per Phase-7 §37's own recommended sequencing: canonical types/adapters
   → shadow population → geometry-contract tests → PatternOverlay
   semantic adaptation → feature-flagged internal exposure → public
   toggle (8G-C would stop at "feature-flagged internal exposure").
4. An admin views a real, live PEG-tagged symbol's chart; the overlay
   renders from real, persisted canonical geometry/narrative (once the
   persistence gap in item 1 is closed); the admin visually confirms the
   render matches the underlying detection.
5. Record the proof (screenshot + the exact detection id / symbol / as-of
   date) in a phase report, mirroring this program's own established
   evidence-recording convention.

### 6. Rollback

Every piece is independently reversible: unset the new render-proof flag
(instant, no redeploy required if implemented as an env-checked branch,
same idiom as every other flag in this program); the admin_patterns
router already existed pre-8G-C, nothing new to unmount; a schema
addition (if the `event_json` column is added) is additive/nullable,
rollback = revert the read/write code, never a column drop (this
program's own established idiom, cited in the Phase-7 spec's Addendum
and in the scan-completeness package's own rollback section).

### 7. Missing plumbing identified

- **The persistence gap is the real blocker**, not the render code:
  `eligibility_json` exists but `pattern_join.py` doesn't even `SELECT`
  it yet (a query change, confirmed zero-risk); `event`/`criteria`/
  `gate_trace` have no column at all. Per the spec's own revised
  Addendum, only ONE new column would actually be needed
  (`eligibility_json` already exists; `event` can be reconstructed from
  the already-existing `geometry_json` blob via the same logic
  `canonical_adapter.adapt_power_earnings_gap` already uses — no new
  column required for that specifically).
- **The PEG anchor-timestamp quirk** (item 3 above) should be fixed
  before an admin proof renders it, or the proof itself would visibly
  show incorrect geometry.
- **No round-trip parity test exists yet** (item 4).
- **No admin-only render page/panel exists yet** — would need to be
  built, however small (could be as narrow as an admin-gated route
  reusing the existing `StockChart`/`PatternOverlay` components with a
  hardcoded PEG-detection lookup, not a general-purpose feature).

### 8. Implementation plan (sequencing only, not scheduled/authorized)

1. Owner decision (Phase-7 §37 item 1): fix the dead toggle — behind an
   admin-only gate for 8G-C's purposes specifically, not the general
   public toggle.
2. Fix the PEG anchor-timestamp quirk (Phase-7 §24) — small, isolated,
   PEG-only, testable via the existing fixture battery.
3. `pattern_join.py`: widen the `SELECT` to include `eligibility_json`
   (already exists) — query-only change, no schema risk.
4. Add the round-trip parity test (item 4) BEFORE building any render UI
   — this is the gate the spec's own Addendum requires.
5. Build the narrow admin-only render surface.
6. Produce the proof, record it, present to the owner for the actual
   8G-C activation decision (separate, explicit, later).

**None of steps 1-6 are authorized by this document.** This is
sequencing information for whenever 8G-C is separately authorized.

---

## Part 2 — Remaining-Family Canonical Readiness Matrix

Phase-7's own Section 26 audited **7 rows** (not 7 independent files —
the PEG+Episodic-Pivot row bundles two detector files). Package 8C/8D
adapted **High Tight Flag** (fully) and **PEG** (fully) — **Episodic
Pivot, PEG's row-mate, was explicitly NOT adapted** (Phase-7 §24: "PEG
has it, episodic_pivot doesn't — the clearest, most concrete case for
promoting it"). Measured directly against `canonical_adapter.py`'s own
`ADAPTER_VERSION = "phase8.8b.1"` and its two adapter functions
(`adapt_high_tight_flag`, `adapt_power_earnings_gap`) — no third adapter
function exists in the file. So, counted honestly by ROW: **2 of 7 rows
touched, 5 remain** (Bull Flag, Engulfing, O'Neil Flat Base, VCP,
Pullback-to-50-SMA). Counted by INDIVIDUAL DETECTOR FILE: **6 files
remain untouched** (the above 5 plus Episodic Pivot, still bundled in an
already-"touched" row). **This distinction is reported explicitly because
collapsing it is exactly the kind of count-drift this codebase's own
CLAUDE.md repeatedly flags as a defect class — do not silently pick the
flattering number.**

| Family | Current geometry state | Freshness gate today | Event provenance today | Adapter needed | Adapter complexity (Phase-7's own rating, re-verified) |
|---|---|---|---|---|---|
| **High Tight Flag** | ✅ DONE (Package 8D) — `anchor_roles=["pole_base","pole_top","flag_low","flag_high"]`, `semantic_subtype="pole_and_flag"` | none in-file (shared 7d only) | none (no event concept) | — | done |
| **Power Earnings Gap** | ✅ DONE (Package 8C) — `eligibility`+`event`+reconstructed `gate_trace` | none in-file (shared 7d only) | real (`days_to_earnings`/`earnings_linkage_verified`) | — | done, but the anchor-timestamp quirk (Part 1 §3) should be fixed first |
| **Episodic Pivot** | ⛔ NOT adapted | `_MAX_EP_AGE=5` bars (own gate exists, unlike PEG) | **none** — the exact gap Phase-7 names as the clearest case to close | `eligibility` (has its own freshness gate to surface) + `event` (needs a real event-provenance source — currently zero, unlike PEG) | medium-high — the event-provenance work is genuinely new, not a copy of PEG's |
| **Bull Flag** | ⛔ NOT adapted | none in-file (shared 7d only) | none (no event concept) | `eligibility` only (no event/criteria concept applies — mirrors HTF's minimal case) | **low** — structurally the closest to the already-solved HTF case; the pole-not-anchored geometry gap (Phase-7 §23) is a separate, smaller fix if a renderer ever needs to draw the pole |
| **Engulfing (bull/bear)** | ⛔ NOT adapted | none (shared 7d only) | none (candlesticks have no event concept) | `eligibility` only | low — same shape as Bull Flag; separately, the white-candle-highlight chart requirement (Phase-7 §20) is 0% built and would be its own small frontend task, unrelated to canonical adaptation |
| **O'Neil Flat Base** | ⛔ NOT adapted | **none by deliberate in-file design** (contrast: base_catalog's OTHER structures carry `MAX_AGE_BARS` that disagree with each other) | none | `eligibility` (documenting the deliberate no-gate design as data, not silence) | high — the `rectangle` 4th-anchor overload (Phase-7 §10) needs `anchor_roles` labeling as part of this, same technique as HTF/PEG already proved |
| **VCP** | ⛔ NOT adapted | `_MAX_FINAL_LOW_AGE=15` bars — **still disagrees with base_catalog's own VCP ceiling of 60 bars for nominally the same pattern**, unresolved since Phase-7 first found it | none | `eligibility` (would make the 15-vs-60 mismatch a queryable, visible data point instead of a Phase-7-only paper finding) | high — the zigzag/`trendline_pair` mismatch (Phase-7 §10) needs `anchor_roles` labeling too |
| **Pullback to 50-SMA** | ⛔ NOT adapted | none in-file (shared 7d only) | none | `eligibility` only | high per Phase-7's original rating, but the underlying anchor fix (single-anchor → `ma_touch`/`ma_current` pair, §22) is small and mechanical — the "high" rating is about the eligibility/event scaffolding being net-new, not about this specific fix |

**Recommended next-family order, if/when family-by-family canonical
expansion is separately authorized** (not decided here): **Bull Flag or
Engulfing first** — both are the genuinely lowest-complexity cases
(`eligibility`-only, mirrors the already-proven HTF adapter almost
verbatim), giving a cheap third and fourth adapted family before tackling
Episodic Pivot's real net-new event-provenance work or VCP/Flat Base's
geometry-labeling work. This mirrors Phase-7 §34's own sequencing logic
(cheapest, most representative cases first) rather than inventing a new
priority order.

**Explicitly NOT done here:** no adapter code written, no family
touched, no mass conversion, no criteria/gate_trace design for any of the
6 (Phase-7 §8 already rules criteria/provenance OUT of scope for all 7
rules-engine families — this stays true; only `eligibility`/`event` are
in scope for future family work, per the spec's own Section 8 ruling).
