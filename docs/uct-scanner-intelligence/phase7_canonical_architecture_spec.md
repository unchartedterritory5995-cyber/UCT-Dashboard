# PHASE-7 CANONICAL PATTERN / GEOMETRY / EXPLAINABILITY SPECIFICATION

**Date:** 2026-09-03
**Master commit at start of Phase 7:** `bbf0befa9` (Package A `1bb99bf9d` + Package B `fabe68fad`, plus one unrelated Floor2 merge, confirmed disjoint from pattern-engine files)
**Scope:** architecture / contract / design only. No production code changed in this phase.
**Method:** an 11-agent parallel recon (4 subsystem reads + 7 per-family detector deep-dives) against the CURRENT checked-out master, grounded in `api/services/pattern_engine/types.py` (the real, live schema — not the 2026-05-11 charter's speculative one). Every claim below is file:line-sourced by that recon; nothing here is inferred from memory of the charter.

---

## 1. Executive Architecture Decision

**This is not a green-field design problem.** The 2026-05-11 charter's speculative `Detection` schema was already built, almost verbatim, in `api/services/pattern_engine/types.py`, and is genuinely live end-to-end: 30+ detectors emit it, `memory.py`/`pattern_db.py` store it (own SQLite `patterns.db`), a real scheduled learning loop runs against it (`track_outcomes` every 4h, `recompute_stats` nightly, `prune_old` nightly), `/api/patterns/{sym}` serves it, and `PatternOverlay.jsx` genuinely renders it shape-generically via a `geometry.shape → renderer` dispatch table. The engine already implements most of what the charter and this authorization ask for.

**What Phase 7 found instead of a missing schema:** three real, well-evidenced architectural gaps, all *additive* to fix, none requiring a schema rewrite —

1. **Scanner eligibility is not one concept — it's four independently-coded, non-communicating implementations** of "is this detection still current" (engine-level 7-day window, per-detector ad hoc age gates that disagree with each other in units and even with base_catalog's parallel numbers for the *same* pattern, and a screener-side re-implementation of the 7-day window that doesn't import the engine's own constant). This is the generalized form of the Phase-6 RXRX/NVAX finding.
2. **Event provenance, criteria/provenance, and quality/confidence are decomposed enough at the code level (4 real sub-scores, real per-family gates) but not decomposed in the *output* at all** — every gate is a bare `if not X: continue`/`return None`; a rejected candidate leaves zero trace, and an accepted one carries no record of *which* gates it cleared or by how much margin. `historical_score` is a universal, 100%-consistent hardcoded `50.0` across all 7 audited families despite `pattern_stats` already being populated by a real, running job — the highest-value, lowest-risk wiring gap in the whole system.
3. **The chart surface is fully built and completely unreachable.** `PatternOverlay` is mounted live in `StockChart.jsx`; its only UI toggle is dead code — `{false && !hidePatterns && ...}` in `ChartToolbar.jsx` — so no user, member or admin, has any way to turn pattern overlays on today. Separately, three end-user feedback surfaces (`PatternSidePanel`, `PatternFeedbackChip`, `PatternReview`) all write into the *pattern_vision* feedback table (a genuinely separate LLM-judge subsystem sharing the same `/api/patterns/*` namespace), not the rules-engine's own `pattern_feedback` — contradicting `PatternSidePanel.jsx`'s own header comment.

**Decision: extend `types.py` additively** (new `NotRequired` sections: `eligibility`, `event`, `criteria`), **do not replace it.** The storage layer already JSON-blobs geometry/levels/context/narrative/quality — adding new keys costs zero migration. Sections 4-15 below specify the additions; Sections 16-25 specify contracts; Section 26 is the family-by-family evidence matrix; Sections 29-34 are migration/validation/work-packages.

---

## 2. Governing Principles

Confirmed, not aspirational — the live system already gets most of these right:

- **Geometry is structured, not pre-rendered** — true today. `PatternOverlay.jsx` dispatches purely on `geometry.shape`; style (color/opacity/dash/glow) is derived from `direction`/`confidence`/`status`/recency via one shared `patternShapes/style.js`, never hardcoded per-shape. This is the *one* piece of the charter's plan that shipped exactly as designed.
- **Identity vs. lifecycle vs. eligibility vs. quality vs. confidence must stay separated** — true in code (detectors don't fake lifecycle transitions; `status` is honestly always `"ready"` at emission, nothing hardcodes `"triggered"`), **false in data** — there is no `eligibility` section at all, so "is this detection still worth showing" is answered by re-deriving it from `detected_at` + family-specific source code, not by reading a field.
- **Event provenance is first-class only where someone already needed it once** — PEG's `days_to_earnings`/`earnings_linkage_verified` (the Phase 6 Group 3 fix) is the *only* real event-provenance data in the entire engine, and it lives in the untyped `extras` grab-bag, not a typed section. Its own sibling family (episodic_pivot, same "gap/event" category) has none, despite citing sources in narrative prose.
- **A criteria/provenance model already exists and is deliberately NOT what Phase 7 should extend into the rules-engine detectors.** `api/services/screener/base_catalog.py`'s `Criterion` dataclass (condition/value/quote/source_id/confidence/missing/origin/missing_kind, enforced into exactly one of 3 provenance states by a repo-wide test) is real, working, and cited BY NAME in three of the seven detector files' own header comments as the answer to a different question ("is this structure present, with sourced criteria") than what the rules-engine detectors answer ("where do I enter one, given it's present"). This is a *deliberate, documented, 2026-08-31-ruled* architectural split, not an oversight — Phase 7 respects it rather than force-merging the two engines.

---

## 3. Existing UCT Architecture Reuse Map

| Concept | Lives in | Status |
|---|---|---|
| Canonical `Detection`/`Geometry`/`Levels`/`Context`/`Narrative`/`Outcome` types | `api/services/pattern_engine/types.py` | **Live, real, in use by 30+ detectors** — this IS the canonical model; extend, don't replace. |
| Storage | `api/services/pattern_engine/{memory.py,pattern_db.py}`, own `patterns.db` (moved off `auth.db` 2026-07-16 to stop write-lock contention) | **Live**, JSON-blob columns → additive schema changes are free (no migration). |
| Learning loop | `memory.track_outcomes` (4h), `memory.recompute_stats` (nightly, populates `pattern_stats`), `memory.prune_old` (nightly, 120d retention) — all scheduled unconditionally in `api/main.py` | **Live and running**, but `pattern_stats` is never actually *read* by any detector (`historical_score` stub) or by `admin_patterns.py`'s health endpoint. |
| Engine-level freshness authority | `memory.ACTIVE_WINDOW_SECS = 7 days`, applied in `get_active_detections` (added 2026-08-26 — before that, no window existed at all) | **Live**, the closest thing to a real "eligibility" concept today — but not surfaced as data, and re-implemented independently (same 7-day number, separate literal) in `pattern_join.py`. |
| Criteria/provenance | `base_catalog.py`'s `Criterion` dataclass + repo-wide provenance-state test | **Live, real, working** — but scoped to base_catalog's own parallel "Structure" engine (flat_base, and presumably others), not the rules-engine detectors this program audited. |
| Chart rendering | `app/src/components/chart/PatternOverlay.jsx` → `patternShapes/*.jsx` (6 shape renderers) + shared `style.js` | **Mounted, wired, but unreachable** — toggle is dead code (`{false && ...}`). |
| Scanner surface | `api/services/screener/pattern_join.py` → `snapshot_builder.py` (nightly 3am ET cron + boot warm) → `screener_rows` → `columnDefs.js` (8 registered columns) → `VirtualResults.jsx`/`ResultCards.jsx` | **Live and rendered** for members who add the columns — the charter's dedicated `/api/patterns/scan` bulk endpoint was *deliberately removed* 2026-08-26 in favor of this direct-store-query pattern. Extend this, don't resurrect the removed endpoint. |
| A second, parallel detection system | `api/services/pattern_vision/store.py` + the `pattern_vision`-tagged routes in `patterns.py` (`/confirmed`, `/judge`, `/exemplar`, vision `/feedback`) | **Live, separate**, `PATTERN_VISION_ENABLED`-style flag per project memory. All 3 real end-user feedback surfaces write here, not into the rules-engine's `pattern_feedback`. |
| "Geometry Readiness Matrix" / "Explanation Truth Table" (named in this phase's own authorization) | *searched, not found* | **Do not exist as separate artifacts.** The closest analogs are `types.py` (schema) and this document's Section 26 (matrix). Noted here rather than silently fabricated. |

---

## 4. Canonical Pattern Detection Model (proposed additive extension)

`Detection` keeps every existing field unchanged. Three new `NotRequired` (optional-by-family) sections:

```python
class Eligibility(TypedDict, total=False):
    eligible: bool
    evaluated_at: int                     # unix sec this verdict was computed — eligibility is a
                                           # point-in-time evaluation, NOT a timeless stored fact;
                                           # a consumer must treat a stale evaluated_at as unknown, not true
    eligibility_scope: Literal["system_default"]   # this is the detector/scanner DEFAULT eligibility;
                                           # a member's own filters are a separate, later layer — never
                                           # conflated with this field
    eligibility_version: str              # bumped when the eligibility RULE changes, independent of
                                           # detector_version (Section 30) — lets a consumer ask "was this
                                           # evaluated under the rule I think it was"
    eligibility_reasons: list[str]        # e.g. ["within active window", "not already-broken"]
    freshness_bars: int | None            # bars since the structurally-defining event, if this family has one
    freshness_window_bars: int | None     # this family's OWN ceiling, if any — surfaced as DATA so a
                                           # mismatch (e.g. engine VCP=15 vs base_catalog VCP=60) is visible,
                                           # not silently normalized away by the schema
    active_window_secs: int               # the shared engine-level constant actually applied

class EventProvenance(TypedDict, total=False):
    event_id: str | None                  # stable provider reference where one exists (e.g. an earnings
                                           # calendar row id) — a plain source STRING is not enough to answer
                                           # "which actual earnings event caused this detector to fire"
    event_type: str                       # "earnings" | ... (family-defined)
    event_timestamp: int | None
    ingested_at: int | None               # when the event data was actually fetched/observed, distinct
                                           # from the event's own timestamp
    days_from_event: int | None
    verification_status: Literal["verified", "contradicted", "unavailable"]
    source: str | None

class Criterion(TypedDict):               # = base_catalog.py's existing Criterion, promoted verbatim.
                                           # Answers "is this THRESHOLD sourced?" — a citation record.
    condition: str
    value: object
    quote: str | None
    source_id: str | None
    confidence: Literal["high", "med"]
    missing: str | None
    origin: Literal["source", "uct"]
    missing_kind: Literal["source_silent", "not_computable", "our_scope"] | None

class GateEvaluation(TypedDict, total=False):
    # ChatGPT relay review (2026-09-03): distinct from Criterion above, which is a citation about a
    # THRESHOLD's own provenance. This is an EVALUATION TRACE — did THIS candidate clear THIS gate, and
    # by how much — the concept the 7 rules-engine detectors actually need (their own bare `if not X:
    # continue` gates today, zero trace kept). The two compose: a GateEvaluation MAY cite a Criterion for
    # its threshold's provenance (criterion_ref), but does not require one.
    criterion_id: str
    criterion_name: str
    observed_value: object
    expected_value: object | None
    operator: str | None                  # e.g. ">=", "<", "within_pct"
    unit: str | None
    role: Literal["identity", "quality", "lifecycle", "eligibility", "context"]
    required: bool
    result: Literal["pass", "fail", "weak", "missing"]
    criterion_ref: NotRequired[str]        # optional link to a base_catalog Criterion.source_id, if one exists
    definition_version: str | None

# Detection gains:
    eligibility: NotRequired[Eligibility]
    event: NotRequired[EventProvenance]
    criteria: NotRequired[list[Criterion]]        # threshold provenance, reused from base_catalog where it exists
    gate_trace: NotRequired[list[GateEvaluation]]  # per-candidate evaluation trace, new to the rules engine
```

No family is required to populate any of these. A single-candle geometric family with no event concept (bull_flag) simply omits `event`. A family with no historical criteria trace (all 7 today) omits `criteria`/`gate_trace` until a future phase wires it. This is the "required-for-all vs. optional-by-family" split Section 17 asks for, applied concretely.

---

## 5. Identity Model

Already correct and consistent across all 7 families — no change needed. `id` (fresh uuid4), `pattern_id`/`pattern_name` (module constants), `category`, `direction` are always real. **The one universal gap: every one of the 7 families ships `sym`/`tf` as hardcoded empty strings** — detectors are symbol-blind by design; a caller/registry layer stamps identity post-hoc. This is a load-bearing contract (not a defect) but belongs written down: any canonical-adapter work must account for a post-detection identity-stamping step, and no detector file should ever be changed to "fix" this.

---

## 6. Lifecycle / Freshness Model

**Lifecycle:** `status` is hardcoded to the literal `"ready"` at emission in all 7 families, 0% exception. No detector file contains any code path producing `"forming"`, `"triggered"`, `"completed"`, `"failed"`, or `"expired"` — every hard gate (already-broken, hostile-context, confidence floor) *rejects* a candidate outright rather than emitting it under a different status. If real, that whole state machine lives entirely in `memory.py` (`_update_status`, `_resolve_outcome`) — confirmed present there, not verified this session whether it ever actually reaches `"forming"` either. **This means half the typed lifecycle enum may be structurally dead** — worth a targeted follow-up read of `_update_status` before Phase 8 assumes "forming" is reachable.

**Freshness is the finding.** See Section 4's `Eligibility` model and Section 26's matrix — it is not one mechanism, it's at least four:
1. `memory.ACTIVE_WINDOW_SECS = 7 days` on `detected_at` — the one shared, engine-level gate, applied uniformly regardless of family.
2. Per-detector, ad hoc, inconsistent: `episodic_pivot._MAX_EP_AGE=5` bars; `vcp._MAX_FINAL_LOW_AGE=15` bars; `flat_base` has **none by deliberate design** ("structural anchoring is the point," in-file comment) while base_catalog.py's *other* structures in the same file carry `MAX_AGE_BARS` constants that don't agree with each other either (double-bottom=40, undercut-rally=20, **VCP=60**, breakout-gap-up=10) — note base_catalog's own VCP ceiling (60 bars) directly disagrees with the engine detector's VCP ceiling (15 bars) for nominally the same pattern name, undiscovered until this recon.
3. `pattern_join.py`'s screener read re-implements the 7-day window as its own literal (`detected_at >= now - 7d`) rather than importing `memory.ACTIVE_WINDOW_SECS` — currently the same number, silently divergeable.
4. bull_flag, high_tight_flag, pullback_to_50sma, the engulfing pair: **no freshness/recency concept of their own at all** — eligibility for these families is entirely the shared 7-day engine window.

**Recommendation:** `Eligibility.freshness_window_bars` (Section 4) exists precisely so a family's own ceiling — including the fact that some families have none — becomes readable data instead of requiring a source read. `pattern_join.py` should import `memory.ACTIVE_WINDOW_SECS` rather than re-declaring it (a Phase-8 one-line fix, flagged not fixed here).

---

## 7. Scanner Eligibility Model

`Eligibility.eligible` (Section 4) is the single boolean a scanner should read; `eligibility_reasons` explains it in the same evaluated/answered/dropped/not-computable spirit as this codebase's own `CoverageLine` idiom (screener) — a reason string per contributing gate, not a bare yes/no. Composition, per family, from what's real today:
- the shared 7-day `ACTIVE_WINDOW_SECS` (always)
- the family's own age gate if one exists (`freshness_bars <= freshness_window_bars`, families 2-3 in the Section 6 list)
- `status NOT IN (completed, failed, expired)` (already enforced server-side in `GET /{sym}`)
- `confidence >= min_conf` (already enforced server-side, default 50.0)

A historically-valid, structurally-real detection can be `eligible=false` purely on freshness — this is precisely the RXRX/NVAX distinction from Phase 6, now a queryable field instead of something you discover by re-deriving it from `detected_at`.

**Amendment (ChatGPT relay review, 2026-09-03):** `eligible` must never be read as a timeless stored fact — it is a point-in-time evaluation. `Eligibility.evaluated_at` makes staleness checkable (a setup eligible at 10:00 AM can be stale by the next read without the underlying detection changing), and `eligibility_scope="system_default"` makes explicit that this is the detector/scanner's own default eligibility, not any individual member's personalized filter decision — those compose on top of this field, never inside it. `pattern_join.py`'s duplicated 7-day literal (Section 6) should be replaced by reading this field directly at Stage C of the migration (Section 33), not before — an earlier swap risks masking the exact kind of silent-divergence class this phase's VCP-60-vs-15 finding surfaced. The VCP ceiling mismatch itself should stay visible as a real semantic/configuration discrepancy (`freshness_window_bars` reports each engine's own number honestly) rather than being silently normalized to one value by the schema.

---

## 8. Criterion / Provenance Model

**Adopt `base_catalog.py`'s `Criterion` dataclass verbatim** (Section 4) as the one canonical provenance shape repo-wide — it is already real, already tested (repo-wide "exactly one of 3 provenance states" enforcement), and already proven on FLAT_BASE's criteria tuple (mixing genuinely-sourced IBD numbers, a recorded conflict between two published depth ceilings, and honestly-labeled `origin="uct"` house thresholds).

**Do not mandate it for the 7 rules-engine detectors.** Their own authors explicitly, repeatedly (3 of 7 files' own header comments: high_tight_flag, flat_base, vcp) scoped criteria/provenance OUT of this engine on purpose, assigning it to base_catalog.py's parallel "Structure" engine instead — a 2026-08-31-ruled, measured (13% symbol-overlap) decision that the two engines answer different questions (presence-with-provenance vs. where-to-enter) and should keep disagreeing. Respecting this is a Phase-7 decision, not an oversight to correct.

**Where `criteria: list[Criterion]` becomes worth wiring (Phase 8, not now):** families where "why did this fire" is the live support question and no sourced-Structure sibling already answers it — gap/event (EP, PEG) and MA-pullback are the strongest candidates, since neither has a base_catalog analog today.

**Amendment (ChatGPT relay review, 2026-09-03):** promoting `Criterion` verbatim conflates two different questions. `Criterion` (base_catalog's shape) answers *"is this threshold sourced?"* — a citation record about where a number came from. What the rules-engine detectors actually need to become explainable is a different thing: *"did this specific candidate clear this specific gate, and by how much?"* — an evaluation trace, not a citation. Section 4 now defines both: `Criterion` stays exactly base_catalog's shape (reused where a family's threshold genuinely has a sourced citation), and a new, additive `GateEvaluation` (observed/expected/operator/role/result, optionally `criterion_ref`-linked to a `Criterion`) is the vocabulary a rules-engine detector would populate for its own `if not X: continue` gates (Section 32 item 1's adapter tests should cover both shapes). This still does not force base_catalog and the rules-engine detectors into one engine — `GateEvaluation` is evaluation-trace vocabulary shared by both, not a merge of their semantics.

---

## 9. Measurement Model

Every family already computes a rich, real `geometry.extras` grab-bag (12-17 keys typical) — pole_pct, retrace_pct, engulfment_ratio, gap_pct, sma_50_slope_pct_over_20, n_contractions, etc. — all genuinely derived from bars, none placeholder. The gap is not measurement *coverage*, it's measurement *typing*: `extras: dict` is intentionally untyped (matches the charter's own design decision), which means no consumer (chart, side panel, explanation layer) can validate or discover what's in it without reading detector source. **Recommendation:** do not type `extras` globally (it is genuinely family-specific and would force a mandatory-field explosion the user's Section 17 explicitly warns against) — instead, each family that wants extras consumed downstream (chart, narrative-facts) should publish a small, versioned "extras contract" comment/constant next to its detector, and Section 15's facts array is the place a *subset* of extras becomes formally citable.

---

## 10. Geometry Vocabulary

The existing 6-shape vocabulary (`trendline_pair`, `neckline`, `cup_curve`, `rectangle`, `candle_mark`, `horizontal_line`) covers all 7 audited families, but **two shapes are semantically overloaded relative to what they're used for:**

- **`vcp` emits a variable-length N-point zigzag (high, low×n, high — 4 anchors for 2 contractions, 6 for 4) under the shape string `"trendline_pair"`**, which every other user of that shape treats as exactly 2 lines / 4 fixed anchors. Any renderer assuming a fixed 4-anchor `trendline_pair` will mis-render 3+-contraction VCPs today.
- **`flat_base` emits 4 anchors under `"rectangle"`, where anchor[0] is a "prior-advance origin" point structurally different from the box's own 2 corners** — a plain 2-corner-box renderer would either ignore or mis-draw it.

**Recommendation (contract-only, no shape renderer rewritten in this phase):** add an optional parallel array `anchor_roles: NotRequired[list[str]]` (same length as `anchors`) to `Geometry`, so a renderer can special-case by role instead of shape-string + hardcoded index math, without breaking the 5 families whose anchor cardinality already matches their shape's implicit contract. VCP's zigzag and flat_base's 4th anchor become `anchor_roles=["contraction_low","contraction_low",...,"pivot"]` / `["prior_advance_origin","box_top_left","box_top_right","box_bottom_right"]` respectively — additive, zero migration, and the exact mechanism Section 19/20 ask for (semantic role over hardcoded per-shape assumptions).

**Amendment (ChatGPT relay review, 2026-09-03):** a parallel `anchor_roles` array is a real synchronization invariant (length must always match `anchors`) and, on its own, doesn't tell a renderer *what kind of thing* it's looking at before it even reads individual anchors — VCP's zigzag and bull_flag's plain 2-line channel are both nominally `trendline_pair` today, and a renderer needing to know "is this a fixed boundary pair or a variable-length contraction sequence" shouldn't have to infer it from `len(anchors)`. Add one more field to `Geometry`: `semantic_subtype: NotRequired[str]` (e.g. `"flag_boundaries"` vs. `"contraction_sequence"` vs. `"base_box"`) — the shape stays one of the existing 6 primitives (no renderer file needs a new shape branch), but the subtype disambiguates intent explicitly instead of leaving it to point-count inference. Section 32 item 2's geometry-integrity test should additionally assert `anchor_roles` length matches `anchors` length wherever `anchor_roles` is populated, and that every `(pattern_id, shape, semantic_subtype)` triple has a stable, documented anchor contract.

---

## 11. Event Provenance Model

Defined in Section 4 (`EventProvenance`). Today: real in exactly one field, one family (PEG's `days_to_earnings`/`earnings_linkage_verified`, Phase 6 Group 3). Its own gap/event sibling (episodic_pivot) has zero equivalent despite prose citations. **This is the strongest concrete argument for promoting it to a typed, optional section** — it already proved out in production as a narrative-truthfulness fix; formalizing it costs nothing (still optional-by-family) and would have made the PEG/EP asymmetry visible by inspection instead of requiring a fresh code read.

**Amendment (ChatGPT relay review, 2026-09-03):** a descriptive-only `EventProvenance` (type/timestamp/verification/source string) isn't enough to answer "which actual earnings event caused this detector to call this an earnings pattern" during a future debugging session. Section 4 now includes `event_id` (a stable provider reference where one exists — e.g. an earnings-calendar row id, not just a source label) and `ingested_at` (when the event data was actually fetched, distinct from the event's own timestamp) — both optional, so a family with no addressable event record can still omit them.

---

## 12. Quality Interface

`QualityComponents` (geometry/volume/context/historical, each 0-100) is already the canonical quality decomposition and needs no schema change. What's real vs. stubbed, universally, across all 7 families:

| Component | Reality |
|---|---|
| `geometry_score` | Real, family-specific weighted formula every time. |
| `volume_score` | Real, family-specific tiered/interpolated formula every time. |
| `context_score` | Real — base + trend_stage/ma_alignment/rs_trend bonuses + DCR + CAN SLIM adjustments, every time. |
| `historical_score` | **Hardcoded `50.0` in all 7 families, 0 exceptions**, despite `pattern_stats` already being populated by a real, running `recompute_stats()` job. |

`historical_score` is the single cleanest, most bounded wiring gap this entire recon surfaced — a real per-`(pattern_id, tf, regime_bucket)` lookup already exists in `pattern_stats`; no detector reads it. Flagged here as the top Phase-8 candidate (Section 34), not touched in this phase.

**Amendment (ChatGPT relay review, 2026-09-03):** a bare hardcoded `50.0` risks being misread as real evidence — a user or downstream consumer has no way to distinguish "the engine measured historical performance and it's neutral" from "the engine hasn't measured this yet." The canonical `historical_score`/`HistoricalOutcome` interface (Section 14) must carry an explicit availability state alongside the number: `Literal["unavailable", "insufficient_sample", "accumulating", "available"]`. Only `"available"` licenses a consumer to treat the score as real signal; the other three states are all, today, what every one of the 7 families' `50.0` actually means. This is a contract addition, not a wiring change — Section 25/34's "do not implement scoring in Phase 7" instruction is unaffected.

---

## 13. Classification Confidence Interface

Confidence is **already one shared formula, byte-identical across all 7 families**: `0.40*geometry + 0.25*volume + 0.20*context + 0.15*historical`, hard floor `50.0` (sub-floor candidates are discarded entirely — `continue`/`return None`, zero trace). It is not yet a *shared, importable* formula — it is 7 independently copy-pasted literal expressions, which is exactly how base_catalog's VCP-age-ceiling divergence (Section 6) went unnoticed: nothing forces the 7 copies to stay in sync, and nothing would surface it if one silently drifted.

**Recommendation:** promote the weight vector + floor into one shared, versioned constant (e.g. `pattern_engine/confidence.py::DEFAULT_WEIGHTS`), imported by all 7 (and future) detectors instead of restated. This is a real code change (Phase 8 work package, Section 34), but the *contract* — that confidence is a versioned, inspectable weight vector rather than opaque literals — is a Phase-7 decision.

**Separately:** because `historical_score` is currently a constant, confidence today is genuinely only a 3-input signal (85% real weight) wearing a 4-input formula's clothes.

---

## 14. Historical Outcome Interface

**Further along than the charter or this authorization assumed.** `pattern_stats` (PK `(pattern_id, tf, regime_bucket)`, columns `n_total/n_resolved/n_entry_hit/n_target_hit/n_stop_hit/avg_mfe_pct/avg_mae_pct/median_bars/hit_rate/expectancy_R`) is real, typed at the storage layer, and populated nightly by a genuinely-scheduled `recompute_stats()`. The interface doesn't need designing — it needs a *consumer*. Per the authorization's own instruction ("historical outcome evidence... not currently ready for production wiring until sufficient observations accumulate"), Phase 7 does not wire it now, but flags it as materially closer to ready than the rest of this spec, contingent only on: (a) confirming real sample sizes have accumulated (not verified this session — would require a live DB query, out of scope for a read-only architecture phase), and (b) the shared-confidence-formula refactor in Section 13, so the wiring happens once, not 7 times.

---

## 15. Explanation Architecture

Every family's `Narrative` (5 fields) is genuinely populated with real, computed-value-substituted prose — not stubbed. The gap is **traceability, not content**: narratives are built by direct f-string interpolation of raw dicts, with **no separate "facts" array a grounding/citation checker could validate against** — this codebase already has exactly that pattern working elsewhere (`cotFacts.js`/`CoverageLine`, cited directly in the recon), just not applied here. The risk this creates is concrete, not hypothetical: the engulfing family's narrative hardcodes Bulkowski "63%/79%" reversal-rate citations as prose with **zero backing computation anywhere in the codebase** — structurally the same defect class Phase 5/6 already fixed elsewhere in this program (unbacked fact-claims presented as engine truth).

**Recommendation (contract, Phase 8 build):** add `narrative_facts: NotRequired[list[dict]]` — the subset of `geometry.extras`/`levels`/`criteria` values a narrative is actually built from, alongside the existing prose fields, not replacing them. A future grounding check (mirroring `cotFacts.js`'s "the ONLY numbers the LLM may cite") becomes possible; a hardcoded, uncomputed citation like Bulkowski's percentages becomes visible as a gap (no matching fact) rather than invisible narrative prose.

---

## 16. Scanner Summary Contract

`pattern_join.py` already IS the scanner summary contract in practice — a deliberately thin per-symbol projection (pattern ids capped/ranked, max confidence, 2 curated boolean flags for VCP/flat-base, best-detection direction+entry+stop, regime-blind expectancy), computed nightly and served through the general Screener's column system (`columnDefs.js` → `VirtualResults.jsx`). The charter's dedicated `/api/patterns/scan` bulk endpoint was deliberately removed 2026-08-26 in favor of this direct-store-query pattern — **do not resurrect it.**

**Recommendation:** extend `pattern_join.py`'s existing field set rather than build a parallel surface. Natural additions once Sections 4/6/7 land: `scanner_eligible` (from the new `Eligibility` section, replacing the module's own re-implemented 7-day window), and a `primary_reason` string sourced from `eligibility_reasons`/the best detection's top-weighted quality component — both additive to the existing 8-column contract, no new endpoint required.

---

## 17. Detail / API Contract

`GET /api/patterns/{sym}` already returns the (near-)full `Detection[]` server-side-filtered by status/confidence/freshness — this is functionally the "detail payload" the authorization asks for; no new endpoint is needed for it. **Two real defects, not gaps, need an owner decision before any Phase-8 work touches this router:**
1. `GET /{sym}` defaults `confirmed_only=true`, silently routing a naive caller to the *unrelated* pattern_vision system instead of the rules-engine `Detection[]` this whole spec concerns — the one caller that exists (`usePatternDetections.js`) knows to pass `confirmed_only=false`, but the router's own default is the wrong one for the rules-engine.
2. `POST /{detection_id}/feedback` (rules-engine, keyed by `detection_id`) is **orphaned** — no frontend caller anywhere. All three real end-user feedback surfaces post to the *pattern_vision* `/feedback` route instead, despite `PatternSidePanel.jsx`'s own comment claiming otherwise. Feedback intended for the rules-engine's own detections is not reaching it.

Both are flagged as **owner decisions in Section 37**, not fixed here (production route/behavior change, out of Phase 7's authorization).

---

## 18. Chart Annotation Contract

Already real and already correct at the shape/style level (Section 2). The contract that's missing is **role-aware anchor styling and `geometry.extras` consumption** — Section 10's `anchor_roles` addition is the mechanism; Section 20/21 below are the concrete family mappings it unblocks.

---

## 19. Semantic Rendering Roles

`style.js` already fully implements "semantic role over hardcoded style" **at the detection level** — `direction`→color, `confidence`→opacity, `status`→dash, recency→glow, all shared, none hardcoded per-shape-file. What's missing is the same principle **at the anchor level**: today every renderer addresses `anchors[0]`, `anchors[1]`... positionally with no role concept, which is exactly what breaks for VCP's variable-length zigzag and flat_base's 4th anchor (Section 10). `anchor_roles` closes this gap without touching the existing, working detection-level styling.

---

## 20. Single-Candle Mapping

**The white-candle-highlight requirement has zero implementation today.** `CandleMark.jsx` draws a solid colored badge circle (radius 9, direction-palette fill, offset above/below/right of the trigger candle) with a letter inside — it never touches the candle glyph itself, has no white outline/border concept, and reads a completely different color axis (pattern-direction, not the candle's own up/down color) than the requirement describes. This is real, scoped Phase-8 frontend work (new rendering behavior in `CandleMark.jsx`), not something Phase 7 implements — but the DATA is already sufficient: `anchors[anchors.length-1]` already identifies the trigger candle by timestamp for every single-candle family (engulfing pair). No schema change needed to build this in Phase 8.

---

## 21. Multi-Candle Mapping

The engulfing pair is the only true multi-candle (2-bar) family among the 7. `anchors` currently marks both bars by **close price only** (not the pattern's full high/low extent, which lives in `extras.pattern_high`/`pattern_low` instead). A window/bracket-style renderer wanting to draw the full 2-candle region would need those extras values today — recommend `anchor_roles` tag them `"component_candle_1"`/`"component_candle_2"` and a future renderer read `extras.pattern_high`/`pattern_low` for the bracket bounds, rather than widening `anchors` itself.

---

## 22. MA-Pullback Mapping

`pullback_to_50sma` emits `geometry.shape="horizontal_line"` with a **single anchor** at the *current* (last) bar — not at the pullback bar or the reclaim bar, whose timestamps are computed (`pullback_bar_idx`, `reclaim_bar_idx`) but only survive into `extras`, never `anchors`. A renderer wanting to show "where price interacted with the MA and why" (the authorization's own framing, Section 12) cannot do so from `anchors` alone today — it needs a second anchor. Recommend (Phase 8, additive): emit `anchors=[{t: pullback_bar.t, price: sma50}, {t: last_bar.t, price: sma50}]` with `anchor_roles=["ma_touch","ma_current"]`, which both fixes the single-anchor limitation and gives the renderer an explicit drawn range instead of an implicit convention.

---

## 23. Flag / Base / Compression Mapping

Four families here (high_tight_flag, bull_flag, flat_base, vcp), each with a real but distinct geometry:
- **bull_flag / high_tight_flag**: `trendline_pair`, 4 anchors = the flag channel's two lines. **The pole itself (the move that defines the pattern's name) is never anchored** — only its timestamps (`pivot_ts`) and scalar `extras.pole_pct` survive. A renderer wanting to draw the pole needs `pivot_ts[0]`/`[1]` plus a price it doesn't have today (Phase 8: add pole endpoints as anchors, roled `"pole_base"`/`"pole_top"`).
- **flat_base**: `rectangle` overloaded with a 4th "prior advance origin" anchor (Section 10) — fixed via `anchor_roles`, not a new shape.
- **vcp**: `trendline_pair` semantically mismatched to its actual variable-length zigzag (Section 10) — fixed via `anchor_roles` (`"contraction_low"` × n + `"pivot"`), not a new shape, preserving backward compatibility with any renderer that already handles `trendline_pair`'s 4-anchor case correctly.

---

## 24. Gap / Event Mapping

PEG and episodic_pivot both use `candle_mark` with real, multi-point anchor lists (5 and 3 respectively) — already close to schema-conformant. One real quirk worth fixing in Phase 8: **PEG's post-gap-high/low anchors stamp the current last-bar timestamp rather than the bar where that extreme actually occurred** (the correct index, `post_gap_low_idx`, is computed but unused for the anchor's `t`) — a renderer trusting the anchor's own timestamp would visually mislabel where the post-gap extreme happened. This is the family where `EventProvenance` (Section 11) matters most and is currently half-implemented (PEG has it, episodic_pivot doesn't) — the clearest, most concrete case for promoting it out of `extras`.

---

## 25. Momentum / Trender Mapping

None of the 7 audited families are pure momentum/metric-only detectors (all 7 have real chart geometry) — this mapping is not populated by evidence from this phase's recon. The canonical model already supports a metric-only family trivially: emit `geometry.shape` from the existing 6-value enum that best fits (most naturally `horizontal_line` or `candle_mark` depending on what's being marked) with a minimal 1-2-anchor list, and let `quality_components`/`context`/`narrative` carry the real signal — no schema extension needed for this case; flagged as unverified-by-evidence rather than invented.

---

## 26. Seven-Family Capability Matrix

| Family | Geometry shape (anchor quirk) | Lifecycle | Freshness gate | Event provenance | Criteria/provenance | Quality (3/4 real + historical stub) | Chart-ready today | Adapter complexity |
|---|---|---|---|---|---|---|---|---|
| High Tight Flag | `trendline_pair`, pole not anchored | `status` const "ready" | none in-file (shared 7d only) | none | none (base_catalog sibling has it) | ✓ | shape supported; toggle dead, extras unread | **high** |
| Bull Flag | `trendline_pair`, pole not anchored | `status` const "ready" | none in-file (shared 7d only) | none | none | ✓ | same | **high** |
| Engulfing (bull/bear) | `candle_mark`, anchors=close only | `status` const "ready" | none (shared 7d only) | none | none | ✓ | same; white-outline requirement = 0% built | **medium** |
| O'Neil Flat Base | `rectangle` (4th anchor overload) | `status` const "ready" | **none by deliberate design** (contrast base_catalog's *other* structures, which disagree with each other on ceilings) | none | none in-file (base_catalog sibling has full `Criterion` model) | ✓ | same | **high** |
| PEG + Episodic Pivot | `candle_mark`, PEG anchor-time quirk | `status` const "ready" | **EP has `_MAX_EP_AGE=5` bars; PEG has none**; EP also lacks the `liquidity_floor` gate PEG has (Phase 6 Group 2 asymmetry) | **PEG only** (Phase 6 fix); EP none | none | ✓ | same | **high** |
| VCP | `trendline_pair` (zigzag mismatch) | `status` const "ready" | `_MAX_FINAL_LOW_AGE=15` bars — **disagrees with base_catalog's own VCP ceiling of 60 bars for the same pattern** | none | none in-file (base_catalog sibling has full `Criterion` model, explicitly named as such in this file's own header) | ✓ | same | **high** |
| Pullback to 50-SMA | `horizontal_line`, single anchor (no drawn range) | `status` const "ready" | none in-file (shared 7d only) | none | none | ✓ | same | **high** |

"Adapter complexity: high" is universal not because reshaping geometry/levels is hard (it's already schema-conformant) — it's high because **`eligibility`, `event`, and `criteria` don't exist as data anywhere** for 6 of 7 families; populating them is new logic, not a rename. Engulfing rates "medium" only because it has no event-provenance ambiguity to resolve (candlestick patterns have no natural event concept).

---

## 27. Existing-Type Reuse / Adapter Map

- **Reuse verbatim:** `types.py`'s existing 8 TypedDicts (Section 1); `base_catalog.py`'s `Criterion` for Section 8; `style.js`'s direction/confidence/status/recency derivation for Section 19 (extend, don't replace).
- **New, additive:** `Eligibility`, `EventProvenance`, `Criterion` (promoted), `anchor_roles`, `narrative_facts` — all `NotRequired`, all free at the storage layer (JSON-blob columns).
- **Real duplication debt surfaced, not fixed here:** `_score_context`/`_hostile_context`/`_dcr_score_adjustment`/`_can_slim_score_adjustment`/3 phrase helpers are copy-pasted verbatim between `power_earnings_gap.py` and `episodic_pivot.py` (unlike the properly-shared `narrative_helpers_structure.py` helpers used by high_tight_flag/bull_flag/flat_base/vcp/pullback_to_50sma). `flat_base.py` has several helpers explicitly commented "Custom variant — does not match shared narrative_helpers." A canonical-adapter pass in Phase 8 is a natural forcing function to de-duplicate these, but it is not this phase's job to do so.

---

## 28. PatternOverlay Fit Analysis

**Already fits well.** All 6 shapes the 7 audited families use are already supported by name; the dispatch mechanism is already generic and role-ready in spirit (Section 2). Three concrete gaps, all additive:
1. `anchor_roles` support needs adding to the 6 renderer files (Section 10/19) — small, mechanical, per-renderer.
2. `geometry.extras` is read by **zero** renderers today — the richest per-family evidence (gap_pct, earnings_linkage_verified, pivot_price, last_contraction_low) never reaches the chart even once the toggle is fixed.
3. `CandleMark.jsx`'s white-outline requirement is unbuilt (Section 20).

None of these require new shapes or a redesign of `PatternOverlay.jsx`'s dispatch — only per-renderer additions.

---

## 29. Backward Compatibility

Zero risk to existing consumers: every addition in Sections 4/10/15 is `NotRequired`/optional-by-family. Existing readers of `Detection`/`Geometry` (memory.py, patterns.py, PatternOverlay.jsx's positional anchor access) continue to work unmodified against detections that don't populate the new fields. `pattern_db.py`'s JSON-blob columns absorb new keys with no migration. The two real *defects* found (Section 17's `confirmed_only` default and orphaned feedback route) are compatibility risks already present today, not introduced by this spec — flagged as owner decisions, not silently left as "backward compatible."

---

## 30. Versioning

No detector or narrative version field exists anywhere in the current schema. Recommend (Phase 8 scope): a `detector_version: NotRequired[str]` on `Detection`, bumped only when a detector's *semantic* behavior changes (mirroring this program's own Phase 6 pattern of explicit "owner decision: threshold X→Y" commits) — cheap to add now that `eligibility`/`event`/`criteria` are landing as new optional sections anyway, since a consumer will want to know whether an old stored detection predates a given section's existence.

---

## 31. Payload / Performance Strategy

`GET /admin/patterns/recent` is a real cautionary precedent: unpaginated, capped at 500 rows, carries Gate-5 review metadata unsuitable for a member payload. `pattern_join.py`'s existing pattern (nightly batch → thin 8-field projection → served from a pre-computed `screener_rows` table) is the right model for member-facing bulk access and should be extended (Section 16), not replaced with a new live-query bulk endpoint. The per-symbol detail contract (Section 17) is already appropriately sized (one symbol's `Detection[]`, server-filtered by status/confidence/freshness). No new heavy payload path is proposed by this spec.

---

## 32. Validation / Test Strategy

Before any Phase-8 implementation touches production code:
1. **Adapter tests**: for each family, assert the new optional sections (`eligibility`, `event`, `criteria`), once populated, round-trip through `pattern_db.py`'s JSON-blob storage unchanged.
2. **Geometry integrity**: a test asserting every `(pattern_id, geometry.shape)` pair's anchor count matches its `anchor_roles` length once that field is populated — this is the direct rail against a repeat of the VCP/flat_base mismatches this phase found by hand.
3. **Eligibility correctness**: a test asserting `pattern_join.py`'s freshness filter and `memory.ACTIVE_WINDOW_SECS` never diverge (currently unguarded — they agree today only by coincidence of two independently-typed literals).
4. **Confidence formula drift**: once Section 13's shared constant lands, a test asserting all detectors import it rather than restating it (would have caught the base_catalog-VCP-vs-engine-VCP-style silent divergence class earlier).
5. **Chart contract fixtures**: one fixture per family exercising `anchor_roles` through the renderer dispatch, to prove role-based styling doesn't regress the 5 families with no anchor ambiguity today.
6. **Explanation truthfulness**: extend Phase 5/6's existing narrative-truthfulness test pattern to check every `narrative_facts` entry (once populated) is traceable to a real computed value — this would have caught the engulfing family's unbacked Bulkowski percentage citations.

---

## 33. Migration Sequence

Derived from this phase's own evidence (JSON-blob storage = free additive changes; the biggest real risk is chart/frontend regressions, not backend schema risk):

- **Stage A — types only.** Add `Eligibility`/`EventProvenance`/`Criterion`/`anchor_roles`/`narrative_facts` to `types.py`. Zero consumers changed. Zero risk.
- **Stage B — shadow population, one family at a time.** Start with the gap/event family (PEG already has half the data; EP is the clearest before/after story) and MA-pullback (clearest anchor-range fix). Populate `eligibility`/`event`/`anchor_roles` without changing `confidence`/`status`/existing fields.
- **Stage C — `pattern_join.py` reads `Eligibility.scanner_eligible`** instead of its own re-implemented window; import `memory.ACTIVE_WINDOW_SECS` directly (closes the Section 6/32-item-3 divergence risk).
- **Stage D — chart renderers read `anchor_roles`** where present, falling back to today's positional logic where absent (zero regression for un-migrated families).
- **Stage E — narrative facts + explanation grounding**, informed by this codebase's own `cotFacts.js` precedent.
- **Stage F — retire nothing yet.** No legacy pathway is disabled by this plan; Sections 6/13 name real technical debt (duplicated helpers, copy-pasted confidence literals) worth cleaning up as a *byproduct* of touching each family in Stage B, not a separate initiative.

The chart-toggle dead-code fix (Section 17-adjacent) and the `confirmed_only`-default fix are **owner decisions (Section 37)**, independent of this sequence — either could ship on its own with zero architecture dependency, since both are one-line production fixes outside Phase 7's authorization.

---

## 34. Production Implementation Work Packages (for a future Phase 8 authorization)

1. **P0-adjacent, zero-architecture-risk, one-line each (owner-decision-gated, Section 37):** fix the dead `showPatterns` toggle; fix `GET /{sym}`'s `confirmed_only` default; route rules-engine feedback surfaces to the rules-engine `pattern_feedback` table (or explicitly decide pattern_vision is the intended destination and update `PatternSidePanel.jsx`'s stale comment instead).
2. **Historical score wiring** (Section 12/14) — read `pattern_stats` for real `historical_score`, one shared implementation, all 7 families.
3. **Shared confidence-formula module** (Section 13) — de-duplicate the 7 copy-pasted weight/floor literals.
4. **Eligibility section** (Sections 4/6/7) — start with the gap/event family (clearest before/after) and MA-pullback (clearest anchor gap).
5. **Anchor roles + chart consumption of `geometry.extras`** (Sections 10/18/19) — per-renderer, additive.
6. **White-candle-highlight rendering** (Section 20) — new `CandleMark.jsx` behavior.
7. **Event provenance for episodic_pivot** (Section 24) — extend PEG's existing pattern to its sibling.
8. **Narrative facts + grounding check** (Section 15) — after `cotFacts.js`'s own precedent.
9. **De-duplicate the PEG/EP helper-function copy-paste and flat_base's forked helpers** (Section 27) — byproduct of touching those files for #4/#7.

None of these are authorized by Phase 7. Listed as a sequencing aid for whenever Phase 8 is explicitly authorized.

---

## 35. Visualization Implementation Sequence (recommendation for Phase 8)

1. Fix the toggle (owner decision) — nothing else in this list is visible to a user until this ships.
2. Anchor-role support in the 6 renderers (mechanical, low-risk, unblocks everything below).
3. `geometry.extras` consumption for the 2-3 highest-value fields per family (gap_pct, pivot_price, last_contraction_low) — the single highest leverage-to-effort item, since the data already exists.
4. Pole/MA-touch/component-window anchors (Sections 21-23) — small, additive, per-family.
5. White-candle highlight (Section 20).
6. Quality/confidence breakdown surfaced in `PatternSidePanel` from real `historical_score` once wired (Section 34 #2) — the side panel's own historical-stats section is currently a static placeholder string, ready to be replaced with real data the moment `pattern_stats` is read.

---

## 36. Risks / Open Questions

- **`pivot_ts`/`outcome` are never actually stored** (`_row_to_detection` hardcodes both to empty/`None`) despite being typed fields on every `Detection` — every consumer of these two fields today is silently reading placeholders, not real data. Worth confirming before Phase 8 assumes either is populated anywhere.
- **`_update_status` was not read this session** — whether the lifecycle enum's `"forming"`/`"triggered"` states are ever actually reachable in production is unconfirmed; Section 6 flags this as a targeted follow-up read, not resolved here.
- **`admin_patterns.py /health` reports `"schema_version": "phase_0"` hardcoded** — a stale self-description matching the module's other stale "Phase 5 will rehydrate `pivot_ts`" comment; both are evidence the engine's own internal phase-labeling has drifted from reality and shouldn't be trusted as a readiness signal.
- **This program's phase numbering and the original 2026-05-11 charter's phase numbering are different tracks that happen to share the label "Phase 7."** The charter's own Phase 7 ("Launch + learning loop activation," toggling UI ON) is a materially different scope than this session's Phase 7 (architecture-only). Worth naming explicitly so a future reader doesn't conflate the two.

---

## 37. Owner Decisions Required

*Each item below reflects both this phase's own read and the independent ChatGPT relay review (2026-09-03, full exchange in the repo commit history and this session) — where they differ, both views are given rather than silently picking one.*

1. **Fix the dead pattern-overlay toggle** (`ChartToolbar.jsx`'s `{false && ...}`) — trivial one-line change, but it is a production UI behavior change (a currently-invisible-to-everyone feature becomes visible to whoever has it toggled on in their persisted settings, plus a new toolbar button), so it needs explicit authorization rather than being bundled into an architecture phase.
   - *This phase's original view: ship it now — the feature has been fully built and dark for no evident reason; the alternatives ("leave a shipped feature permanently invisible" or "delete the feature") are both worse.*
   - *ChatGPT's caution: do not enable it before the geometry-contract amendments above land — today's rendering is genuinely correct but visually incomplete (positional anchors only, `geometry.extras` unread, PEG's anchor-timestamp quirk from Section 24 would be visible immediately), and flipping the toggle now risks the incomplete rendering reading as authoritative. Recommended sequencing: canonical types/adapters → shadow population → geometry-contract tests → PatternOverlay semantic adaptation → feature-flagged internal exposure → public toggle.*
   - *Both are reasonable; this is a genuine product-timing call for the user, not something this spec resolves unilaterally.*
2. **`GET /{sym}}`'s `confirmed_only` default** — currently defaults to the pattern_vision system, not the rules-engine `Detection[]` this whole spec concerns. Both this phase and the relay review agree: log it as a real P1 API-contract issue, but do not couple fixing it to the first Phase-8 work package — the one known caller already overrides it, so nothing is broken today, only surprising to a future undiscovered caller.
3. **Rules-engine feedback routing** — three real feedback surfaces write to pattern_vision instead of the rules-engine `pattern_feedback` table their own code comments claim.
   - *This phase's original framing: pick one of two systems as the intended destination.*
   - *ChatGPT's refinement, which this spec adopts: don't assume a redirect is even correct — the two engines may legitimately warrant separate feedback corpora, the same way they warrant separate provenance vocabularies (Section 8). What's actually missing is a canonical feedback envelope (detection/result id, engine/system tag, detector version, the feedback itself, source surface) that makes routing a deliberate, visible choice instead of an accidental one. Not a Phase-8 blocker either way.*
4. **How far to take Section 34's work-package list** — this spec deliberately does not sequence Phase 8 itself; the user should pick which packages (if any) get authorized first once ready. The relay review's own suggested 7-package breakdown (canonical types → shadow adapters for 4 representative families → scanner contract → chart semantic adapter → feature-flagged exposure → narrative facts → full 7-family rollout) is a reasonable starting point if the user wants one, not a commitment made by this phase.

---

## 38. Readiness Decision

**ARCHITECTURE COMPLETE — READY FOR SCANNER/CHART VISUAL EXPLAINABILITY BUILD**

The canonical model does not need building — it exists, is live, and is sound at its core (Section 2's governing principles are already true in code). What Phase 7 adds is a small, additive, low-risk set of sections (`eligibility`, `event`, `criteria`, `gate_trace`) plus two additive geometry fields (`anchor_roles`, `semantic_subtype`), all zero-migration given the existing JSON-blob storage, all optional-by-family, none requiring a rewrite of any of the 7 audited detectors. The owner decisions in Section 37 are small and independent of the architecture — none blocks it.

**Independent review, Claude ↔ ChatGPT relay, 2026-09-03:** ChatGPT's own verdict was *"ARCHITECTURE COMPLETE WITH REQUIRED SPEC AMENDMENTS — READY FOR CONTROLLED SCANNER/CHART VISUAL EXPLAINABILITY IMPLEMENTATION AFTER THOSE DOCUMENT-LEVEL AMENDMENTS"* — explicitly: *"I do not see a missing fundamental model that warrants reopening architectural discovery."* Five amendments were proposed (Criterion vs. GateEvaluation distinction; eligibility time/scope semantics; geometry semantic_subtype + validation; explicit historical-availability state; stable event identity) — all five are incorporated into Sections 4/7/8/10/11/12 above, closing the review loop within this same document rather than requiring a second architecture pass. No genuine new owner decision was raised by the review; the three items in Section 37 stand as the only open decisions, none blocking.

---

## Addendum (Phase 8, Package 8C, 2026-09-04) — Persistence Design for Canonical Sections

Phase 8's Gate-1 foundation (types + a shadow adapter for `high_tight_flag`/`power_earnings_gap`, commit `8b4998e95`) proved the additive extension is correct in memory. Package 8C then traced the REAL scanner data path directly rather than inferring it, per its own authorization's explicit instruction — this addendum records what that trace found and the resulting design decision, since it materially sharpens this spec's own "JSON-blob storage = free additive migration" claim (Section 1/29), which was true only for keys *within* an existing blob, not for these new top-level sections.

**The finding.** `api/services/screener/pattern_join.py::read_pattern_fields` — the only real, live, member-facing scanner data path this program has found (Section 16) — reads `pattern_detections` with a raw SQL projection of exactly 5 existing columns: `sym, pattern_id, direction, confidence, levels_json, detected_at`. It does not read `geometry_json`, `context_json`, `quality_json`, or `narrative_json` — the 4 *other* columns that already exist. There is no column at all for `eligibility`/`event`/`criteria`/`gate_trace`. The authoritative scanner path therefore crosses persistence (`patterns.db`, a real SQLite file on the Railway volume), and nothing about today's schema can carry the Phase-7 canonical extension across that boundary.

**Recommended schema change (NOT implemented — requires separate owner authorization):**
```sql
ALTER TABLE pattern_detections ADD COLUMN eligibility_json TEXT;
ALTER TABLE pattern_detections ADD COLUMN event_json       TEXT;
ALTER TABLE pattern_detections ADD COLUMN criteria_json    TEXT;
ALTER TABLE pattern_detections ADD COLUMN gate_trace_json  TEXT;
```
All four nullable — existing rows read `NULL` (never a broken read; `NULL` is exactly "this section was never computed for this row," the honest state for every row written before this change). `memory.store_detection`/`_row_to_detection` would be extended to write/read them when present on the `Detection` being stored; `pattern_join.py`'s SQL would gain the 4 new column names to its `SELECT` list and parse them in the same way it already parses `levels_json` — a small, mechanical follow-up once the schema exists, not a redesign of the query's own logic.

**Rejected alternative:** nesting the new sections inside an existing column (e.g. inside `context_json`, or inside `geometry.extras` the way PEG's own event data lives today) — explicitly rejected per this program's own instruction not to "hide the new canonical sections inside semantically unrelated existing JSON columns merely to avoid a proper storage decision." `geometry.extras` already holds PEG's `days_to_earnings`/`earnings_linkage_verified` for exactly this reason (a Phase-6-era shortcut, not a Phase-7/8 design choice) — perpetuating that pattern for the *new* sections would compound rather than fix the "concepts collapsed together" problem this whole program exists to correct.

**Why this is a real, separate authorization, not a Package-8C implementation detail:** an `ALTER TABLE` against `patterns.db` is a production schema change against a live, Railway-volume-mounted database with real accumulated data (the same file whose 13.6 GB / 1.54M-row growth already forced one retention-policy correction, Section 3/`memory.py` `PRUNE_RETENTION_DAYS`). It is low-risk (additive, nullable, no existing row rewritten) but it is still the kind of change this program's own repeated STOP conditions ("no production schema changes," "a persistence/schema change requires separate owner review") exist to gate.

**Revision after ChatGPT relay review (2026-09-04): the migration is narrower than first proposed.** The review correctly pushed back on authorizing all 4 columns without first proving each `ScannerSummary` field's actual durable source — several turned out to already exist. Field-level matrix, verified directly against `pattern_db.py`/`memory.py`/`pattern_join.py`:

| `ScannerSummary` field | Canonical source | Already a DB column? | Read by `pattern_join.py` today? | New persistence needed? |
|---|---|---|---|---|
| `pattern_id`, `direction`, `confidence` | `Detection` top-level | Yes (own columns) | Yes | No |
| `status` (lifecycle) | `Detection.status` | Yes (`status TEXT NOT NULL`) | No — used only in the `WHERE` clause, never `SELECT`ed | **No — add to the existing `SELECT` list** |
| `quality_components` | `Detection.quality_components` | Yes (`quality_json`) | No | **No — add to the existing `SELECT` list, parse the existing column** |
| `primary_reason` (`narrative.headline`) | `Detection.narrative` | Yes (`narrative_json`) | No | **No — add to the existing `SELECT` list, parse the existing column** |
| `event_note` (PEG) | `geometry.extras.days_to_earnings`/`earnings_linkage_verified` | **Yes, already** (`geometry_json` — the Phase 6 Group 3 fields already live inside the existing `extras` blob) | No | **No — add `geometry_json` to the `SELECT` list; `event` can be reconstructed by the same logic `canonical_adapter.adapt_power_earnings_gap` already uses, no new column required** |
| `scanner_eligible` / `eligibility_reasons` / `freshness_*` | `Eligibility` | **No — no column exists, and none of the 5 existing columns carry this data in any form** | N/A | **Yes — this is the one genuinely new concept** |
| `criteria` | `Criterion` | No | N/A | Not needed for Package 8C's own scope — defer to whichever family/consumer first actually populates it |
| `gate_trace` | `GateEvaluation` | No | N/A | **Defer** — its own semantics (pass-only, post-hoc-reconstructed, no visibility into rejected candidates) aren't mature enough to persist as if they were a complete audit trail; persist only once it carries explicit `scope`/`completeness` metadata, alongside a real explanation/provenance consumer |

**Revised recommendation: one new nullable column, not four.**
```sql
ALTER TABLE pattern_detections ADD COLUMN eligibility_json TEXT;
```
`event`/`criteria` do not need new columns at all for Package 8C's scope — `pattern_join.py` widening its own `SELECT` to include the already-existing `geometry_json`/`quality_json`/`narrative_json` columns (a query change, not a schema change) covers `quality`, `primary_reason`, and PEG's `event_note` completely. `gate_trace` is deferred until it has a real consumer and an explicit completeness marker. This is a smaller, lower-risk migration than originally proposed — still requiring the same separate owner authorization before an `ALTER TABLE` touches the live `patterns.db`, but now scoped to exactly the one field that has no existing home anywhere in the schema.

**Additional requirements the review surfaced, to fold into whichever future package implements this:** (1) old, pre-migration rows must read `eligibility_json` as `NULL` → "canonical evidence not persisted for this row," never backfilled or guessed into a fake `True`/`False`; (2) a transition rule — canonical coverage present → canonical summary, else → today's legacy `pattern_join.py` behavior — rather than a global cutover the day the column lands; (3) a DB-round-trip parity test (detector → adapter → `store_detection` → real SQLite write → `_row_to_detection` read → `build_scanner_summary`) compared against today's in-memory-only parity tests, for both HTF and PEG, before this path becomes authoritative; (4) rollback is code-only (revert the read/write code), never a column drop, once the column exists.
