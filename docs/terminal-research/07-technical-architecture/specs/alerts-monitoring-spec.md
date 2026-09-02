---
id: SPEC-S7-ALERTS
title: S7 — Alerts & Monitoring — Technical Specification
role: Phase 3 deliverable — technical specification for a LOCKED system, built on PRD-S7-ALERTS
phase: 3
group: technical-architecture
category: spec
scope: >
  Reconciles S7's target architecture (product-architecture.md §5-B.6, Part C §5, D7 LOCKED)
  and PRD-S7-ALERTS's 8-type trigger taxonomy against the ACTUAL uct-dashboard codebase read
  directly for this document. Specifies modules, data contracts, API surfaces, persistence,
  background jobs, and a migration sequence precise enough to implement — specification, not
  implementation. Five corrections to the PRD's own factual assumptions, each grounded in a
  cited file, are surfaced in §1 because they change what "new" vs "reuse" means for at least
  two of the PRD's requirements.
status: draft — Phase 3 spec, awaiting review
date: 2026-09-02
depends_on: PRD-S7-ALERTS (this document does not restate its user stories, acceptance criteria,
  or licensing findings — read that document first); D3, D6, D4 (LOCKED, per ARCHITECTURAL_DECISION_REGISTER.md);
  D13 (closed for S7's purposes, per PRD §6.3)
---

# S7 — Alerts & Monitoring: Technical Specification

## 0. How to read this document

This is the **technical** specification for S7, following directly from
`docs/terminal-research/05-product-strategy/prds/alerts-monitoring-prd.md` (PRD-S7-ALERTS),
which restates the LOCKED architecture (D7) and adds the trigger taxonomy, user stories,
interaction behavior, and acceptance criteria. This document does not re-argue any of that. Its
job is the one thing a PRD does not do: **ground every reuse/modify/new determination in a real
file in the actual codebase**, and specify the module boundaries, data contracts, persistence
design, background-job wiring, and migration sequence precisely enough that an implementer does
not have to re-discover the existing five-plus subsystems from scratch.

**Every file path below was read directly for this document** (not inferred from the PRD, the
architecture, or the capability ledger's prose) unless marked otherwise. Where this document's
reading of the code corrects or sharpens something the PRD or `product-architecture.md`/
`information-architecture.md` assumed, §1 says so explicitly and cites the line.

**Scope discipline (ANTI-DRIFT).** This spec designs the consolidation D7 already locked — one
taxonomy, one queue, one channel registry, one receipt, one monitor — over the five-plus existing
subsystems. It does not redesign S3/S5/S8/S9/S11 (all either LOCKED-elsewhere or not yet built);
where S7 depends on one of those before it exists, this document names the interim (§9, §17)
exactly as the PRD's §17 sequencing table requires, and does not invent a parallel platform to
avoid waiting.

---

## 1. Five corrections this spec makes to the PRD's assumptions, each grounded in the actual code

The task instruction is explicit that reading the real codebase is "the single most important
discipline for this document." Five findings changed a reuse-vs-new determination materially
enough to state up front, before the rest of the spec relies on them.

### 1.1 The act-at-price gesture ALREADY EXISTS — it is not new UX work

PRD §4.1 and §9/§11.1 (following `information-architecture.md` §9.1) describe the chart's
act-at-price alert gesture as **"a hard requirement, not a stretch goal"** — implying it needs to
be built. Reading `app/src/components/StockChart.jsx` directly: it is already built and shipping.

- `createAlertAtCursor` (`app/src/components/StockChart.jsx:12136-12151`) reads the tracked
  cursor price (`cursorPriceRef.current`, kept live by a `pointermove` listener at
  `StockChart.jsx:12157-12170` that calls `series.coordinateToPrice(y)` on every move), infers
  direction from the last close, and `POST`s directly to `/api/watchlist-alerts` with **no
  intervening dialog** — a toast confirms ("Alert above 190.42") or reports failure.
  - Falls back to a discoverability nudge ("Hover the chart, then press Alt+N") when no cursor
    price is tracked yet.
- It is wired to the keyboard as `Alt+N` via `altActionsRef.current.createAlertAtCursor` (bound
  at `StockChart.jsx:5966`, registered in `altActionsRef.current` at `StockChart.jsx:12152-12155`).
- On success it invalidates every `/api/watchlist-alerts*` SWR cache key
  (`globalMutate((k) => ... k.startsWith('/api/watchlist-alerts'))`, `StockChart.jsx:12148`) so
  the alerts widget updates instantly.

**What this means for the spec:** the "act-at-price" requirement (PRD §4.1 item 1, §11 item 1,
acceptance criterion #9) is a **REUSE**, not new frontend work. The only change S7 needs here is
re-pointing `createAlertAtCursor`'s `fetch` target from `/api/watchlist-alerts` to S7's new
`POST /api/alerts/predicates` registration endpoint once `price-level` migrates onto the shared
taxonomy (§18 step 5) — a one-line change to an existing, already-shipped, already-keyboard-bound
gesture. No new price→pixel mapping, no new dialog-free interaction pattern, no new keyboard
binding is required. **This is a materially different acceptance shape than PRD acceptance
criterion #9 implies** ("the act-at-price chart gesture produces a pre-filled draft ... verified
against `ChartCalloutOverlay`'s price→pixel mapping") — see §1.2.

### 1.2 `ChartCalloutOverlay.jsx` is NOT the price→pixel mechanism behind the alert gesture

`information-architecture.md` §9.1 and §12.1, and PRD acceptance criterion #9, cite
`ChartCalloutOverlay` as the component that "owns the price→pixel mapping" the act-at-price
gesture uses. Reading `app/src/components/chart/ChartCalloutOverlay.jsx:1-5` directly: it is a
**read-only, pointer-transparent canvas overlay that places AmiBroker-style text callouts for
Model Book catalysts and setups** ("Renders text callouts (Model Book catalysts) ... Read-only,
pointer-transparent"). It has no click handling, no cursor tracking, and no relationship to
alert authoring.

The actual mechanism is `StockChart.jsx`'s own direct use of the Lightweight Charts v5 series API
— `series.coordinateToPrice(y)` / `series.priceToCoordinate(price)` — called inline in the
cursor-tracking effect and `createAlertAtCursor` itself (§1.1). This is a citation error carried
from the IA document into the PRD; this spec corrects it so no implementer goes looking for a
price→pixel mapping inside `ChartCalloutOverlay`. **Flagged as an owner-facing correction** in
this document's structured output, since it originates upstream of this task and may recur
wherever else `information-architecture.md` cites `ChartCalloutOverlay` for this purpose.

### 1.3 The in-app "bell" (`AlertBell`) is NOT durable storage today

PRD §8 treats "an alert is a saved object" and "the receipt log *is* the record" (§8, §14) as
already-true properties to generalize. Reading `api/services/alerts.py:39-48` directly:

> "`cache` is an in-process TTLCache on a single uvicorn pod. It resets on every redeploy and
> expires at 24h, and its LRU is capped at 1000 keys total (shared with bars/news/snapshot).
> Per-member alerts therefore do NOT survive a deploy... This is acceptable for a 24h
> notification bell and is NOT durable storage."

`add_alert` (`api/services/alerts.py:152-221`) writes every in-app bell entry — including every
fire delivered through `deliver_alert_payload` (§1.4) — into this TTLCache, keyed
`_BROADCAST_KEY` or `_user_key(user_id)`, capped at 100 entries per list. **The member-facing bell
that PRD §8/§11 item 2/item 3 requires as "the one inbox" persists nothing past 24 hours or a
redeploy.** The *durable* receipt already exists, but only for one of the six subsystems and in a
different store: `indicator_alert_fires` (`api/services/alert_fired_log.py:138-160`, in `auth.db`,
90-day retention). The other five subsystems' fires are either not durably recorded at all
(price/line alerts — `watchlist_alerts.triggered_at` is overwritten on re-arm, no history table),
recorded as a bare dedup key with no receipt fields (`calendar_alerts_fired`,
`catalyst_alerts_fired` — user_id/ticker/date/fired_at only, no rule/value/source), or recorded as
a keyword-fired row with no delivery status (`keyword_fired` in `transcript_alerts.db`).

**What this means for the spec:** S7's fire-receipt store (§5.3, §9) is genuinely **NEW**
persistence, not a consolidation of six already-durable stores into one — five of the six
subsystems have no durable receipt today, and the sixth (`AlertBell`'s in-app view) is explicitly
non-durable by its own module docstring. §9 designs this as new work with `alert_fired_log.py`'s
schema as the shape to generalize (it is the one subsystem that already got this right), not as
a migration of existing durable rows.

### 1.4 Six persistence homes exist today, not "five-plus" — and none share a schema

The PRD's count (§3, §17: "five-plus independently-built subsystems") is right at the *trigger
logic* level but undercounts the *persistence fragmentation* S7 must resolve. Reading each store
directly:

| Subsystem | Definition store | Fired/dedup store | File |
|---|---|---|---|
| Price/line/trendline (`I3`) | `auth.db: watchlist_alerts` | none (row overwritten on re-arm) | `api/services/auth_db.py:599-616` |
| Indicator (`B6`) | `auth.db: indicator_alerts` | `auth.db: indicator_alert_fires` (full receipt shape) | `api/services/indicator_alert_service.py:86-104`; `api/services/alert_fired_log.py:138-160` |
| Pre-report calendar (`E7`) | none (computed fresh each run from My Stocks × reporters) | `calendar_alerts.db: calendar_alerts_fired` (bare 4-col dedup) | `api/services/calendar_alerts.py:29-38` |
| Catalyst watchlist-match (`K8`) | none (computed fresh from the day's top-20) | `catalysts.db: catalyst_alerts_fired` (bare 4-col dedup, same shape) | `api/services/catalyst/store.py:92-99` |
| Awareness (`K7`) | none (rules are pure functions over live state) | `auth.db: voice_proactive_insights` (queue-and-cooldown, not a fire receipt) + `auth.db: awareness_regime_snapshots` (regime-flip detection only) | `api/services/voice_proactive_service.py:35-99`; `api/services/awareness/regime_snapshots.py` |
| Transcript keyword (`D6`) | `transcript_alerts.db: keyword_subs` | `transcript_alerts.db: keyword_fired` (5-col dedup incl. excerpt) | `api/services/transcript_keyword_alerts.py:29-50` |

**Six distinct SQLite homes** (`auth.db` shared by three unrelated tables, plus four separate
`.db` files), zero shared schema, and the two dedup shapes that do exist
(`calendar_alerts_fired`, `catalyst_alerts_fired`) are explicitly, deliberately identical by
design (`calendar_alerts.py:6`: "mirrors catalyst alert pattern exactly") but still two physical
tables in two physical files. This is the concrete number behind D7's "no shared trigger model"
finding, and it is what §9 (persistence) and §18 (migration) design around.

### 1.5 Two independent EDGAR clients exist, serving different shapes — `document-arrival` must pick one

PRD §6.1/§10 cites "the already-wired EDGAR client" as a single thing. Reading the code: there are
**two**, serving different needs, with exactly one production consumer between them:

- `api/services/edgar.py` — an 8-K RSS feed fetcher (`fetch_edgar_news`), **market-wide**, polled
  for the news aggregator. Its only caller in the whole codebase is
  `api/services/engine.py:2333`. It has no per-ticker filter and no "have I seen this filing
  before" state — it is shaped for "what's new right now," not "did a new filing land for entity
  X."
- `api/services/sec_filings.py` — a **per-ticker** submissions lookup (`_SUBMISSIONS_URL =
  "https://data.sec.gov/submissions/CIK{cik}.json"`) plus EDGAR full-text search, TTL-cached
  (30 min filings / 10 min full-text), consumed by `pages/research/tabs/FilingsTab` via
  `api/routers/filings.py` (capability-ledger row D7). This shape — poll one entity's submissions
  list, diff against the last-seen accession number — is what a per-entity `document-arrival`
  predicate needs, and it is the one already scoped to a registered entity rather than the whole
  market.

**Recommendation for §5/§10:** the `document-arrival` trigger type's filing leg polls
`sec_filings.py`'s per-ticker submissions fetch (already TTL-cached at the adapter level) and
diffs the newest `accessionNumber` per registered `(entity, form_type)` predicate against the last
value seen for that predicate — not `edgar.py`'s market-wide RSS feed, which has no per-entity
scoping and would require building that scoping from scratch. The transcript-keyword leg
(consolidating `D6`) continues to read the existing FMP transcript pipeline
(`api/services/av_transcripts.py`, `transcript_index.py`) exactly as `transcript_keyword_alerts.py`
already does.

---

## 2. System boundary (restated from the PRD/architecture, not redesigned)

Unchanged from PRD §5 / `product-architecture.md` S7 block: one trigger taxonomy over the
existing shared delivery seam; evaluation/queueing/delivery only, never condition computation;
inputs from S3/S5/D2/D3/D4 (interim: direct reads, §9); outputs are fires-with-receipts, queue
state, channel deliveries, monitor verdicts. The eight registered trigger types and their D13
resolution (`voice_regime_classifier.get_current_regime()` as the sole `regime-change` authority)
are PRD §6, unchanged here — this document specifies *how*, not *what*.

---

## 3. Existing components — the reuse ledger

Every row cites the exact file read for this document. "Action" states what S7's build does with
it.

| Component | File | What it does today | Action |
|---|---|---|---|
| **Shared delivery seam** | `api/services/watchlist_alert_service.py:314-476` (`deliver_alert_payload`) | Multi-channel fan-out (in-app/email/Discord) with per-channel status reporting (`{claimed, channels, channels_ok, channels_failed, errors}`); already the single delivery function 4 of 6 subsystems call | **Reuse as-is.** S7's `deliver(channel, payload)` primitive (product-architecture.md §5.1) is a thin typed wrapper over this function, not a replacement. No signature change (PRD §18: "no step requires `deliver_alert_payload`'s signature to change"). |
| **In-app/broadcast alert store** | `api/services/alerts.py:129-221` (`add_alert`, `get_alerts`) | Owns the in-app bell channel + the Discord admin-channel fire (severity-gated); non-durable TTLCache (§1.3) | **Reuse the call, do not reuse the store.** `deliver_alert_payload` keeps calling `add_alert` for the in-app/Discord legs; S7's own durable receipt store (§9) becomes the source of truth for `/api/alerts` history, with `add_alert`'s TTLCache staying as the live "unread count" cache it already is. |
| **Fire receipt + dedup shape** | `api/services/alert_fired_log.py:1-160` | `UNIQUE(alert_id, fire_key)` insert-once fire log, `claim_delivery` compare-and-set lease, `MAX_DELIVERY_ATTEMPTS` bounded retry, 90-day retention with a "never sweep an undelivered or failed row" rule | **Generalize the shape, do not extend the table.** This is the one subsystem that already solved "receipt as an artifact, not a memory." S7's `receipt(fireId)` primitive (§5.3) is `indicator_alert_fires`'s column set widened to a `trigger_type` column and applied to all eight types in one shared table — the *pattern* is reused, the *table* is new (it cannot stay indicator-only once seven more types share it). |
| **Per-user daily cap + per-symbol cooldown** | `api/services/voice_proactive_service.py:35-99` (`add_insight`) | Global per-user cap (`MAX_INSIGHTS_PER_USER_PER_DAY`), per-`(symbol, kind)` cooldown window, both computed against `created_at` TEXT-format cutoffs | **Reuse the cooldown mechanism, replace the cap.** The per-`(symbol, kind)` cooldown key shape is exactly right for S7's dedup namespace. The *global* per-user cap is precisely K7's named limitation (PRD §4.3, §13, §18 step 4) — S7's queue (§5.4) keeps the cooldown idiom but replaces the single global counter with a per-trigger-type counter plus a reserve. |
| **Migration/shadow-verification idiom** | `api/services/alert_shadow_log.py:1-30` | Runs a candidate evaluation lane in parallel with the live lane, on its own connection, writing nothing the live lane reads, then diffs by **set difference keyed on the value** (not a repaint/mismatch count) — proven at 2,012,025 evaluation cycles with zero drift before cutover | **Reuse the idiom for every migration step.** PRD §18 step 6 gestures at "the shadow/fired/revision logs B6 already maintains are the model" — this file is the concrete mechanism: each of §18's five migration steps (E7, K8, K7's three rules, I3, B6 onto the shared taxonomy) runs its own shadow pass of this shape before cutover, own connection, own diff, no live-lane write. |
| **Regime authority** | `api/services/voice_regime_classifier.py:208-248` (`get_current_regime`) | 5-way classifier (`bull_trend/bull_correction/distribution/chop/bear_trend`), 15-min cache, already the function `awareness/engine.py:143` imports for R4 | **Reuse exclusively**, per PRD §6.3 and the supplied D13 validation finding — confirmed by direct read: `awareness/engine.py:143,158,174` imports and diffs it against `regime_snapshots.get_last_label()` exactly as the finding states. |
| **Regime-flip detection ledger** | `api/services/awareness/regime_snapshots.py` | Append-only per-cycle `(label, confidence, ts)` ledger in `auth.db`, no prune (`awareness_regime_snapshots`, ~51 rows/weekday) | **Reuse as the `regime-change` predicate's "since last evaluation cycle" state.** S7's registered `regime-change` predicate reads this ledger's `get_last_label()` the same way `awareness/engine.py` does today; it does not reimplement flip-detection. |
| **`position-risk` computation** | `api/services/portfolio_heat.py:1-188` | Pure read function: risk-heat vs. Desjardins 10% aggregate cap, notional vs. regime ceiling, broker-placeholder-stop detection (`_is_placeholder_stop`), never raises | **Reuse as-is; S7 registers a predicate that calls it.** No caching or persistence of its own — every call recomputes from `j2_positions` + live prices, matching S7's "applications compute, S7 evaluates" boundary exactly. |
| **`scan-membership-change` source data** | `api/services/screener/scan_evaluator.py:2405` (`sweep_job`) writing to `definition_evaluations` | Nightly 05:00 ET sweep already computes each saved definition's matching-symbol set per cycle | **Reuse the computed set; add the delta.** No code today diffs cycle N against cycle N-1's membership set — this is PRD §6.1 row 3's "new capability," and the new piece is narrowly the set-difference computation plus predicate registration, not a new scan engine. |
| **`document-arrival` (filings leg)** | `api/services/sec_filings.py:1-40` (per-ticker submissions + full-text search, TTL-cached) | Already fetches and caches a ticker's filing list | **Reuse the fetch/cache; add per-predicate accession-number diffing.** See §1.5 — use this client, not `edgar.py`. |
| **`document-arrival` (transcript-keyword leg)** | `api/services/transcript_keyword_alerts.py:1-50` | Full working subsystem: `keyword_subs`/`keyword_fired`, dedup on `(user, keyword, symbol, quarter)`, already calls `deliver_alert_payload` | **Migrate onto the shared taxonomy per PRD §6.1 row 4; the working logic does not change**, only its registration and receipt shape. |
| **Monitoring-half precedent** | `api/services/provider_coverage_monitor.py` (per-field fill-rate + self-heal + alert-on-change-only, capability-ledger row D12) and `app/src/components/screener/CoverageLine.jsx:1-13` (the four-count receipt: evaluated/answered/dropped/not-computable, `withheld` beside) | Both already generalized once (D12 → G2's `CoverageLine`) | **Generalize a second time, onto S7's monitor.** S7's per-trigger-type monitor view (PRD §4.3, §14, acceptance criterion #7) reuses `CoverageLine`'s four-count vocabulary directly (renamed for S7: evaluated · fired · could-not-evaluate · [suppressed-by-cap, beside]) and `provider_coverage_monitor.py`'s self-heal + alert-on-newly-flagged-only pattern for the "second channel when the first goes quiet" requirement. |
| **A partial existing delivery-health view** | `app/src/components/AlertBell.jsx:26-49` (`deliveryFetcher` against `GET /api/indicator-alerts/delivery-health`, `failedChannelsOf`) | Already renders per-fire channel-failure state **for the indicator-alert lane only**, sourced from `alert_fired_log`'s durable columns | **The seed for the member-facing half of PRD §9's "degraded" state** ("N alerts could not be checked" surfaced in the inbox itself). S7 generalizes this one-lane widget to read the shared receipt table (§9) across all eight trigger types rather than building a second, parallel failure-surfacing UI. |
| **`/api/alerts` — the actual L0 inbox endpoint today** | `api/routers/alerts.py:1-40` | Authenticated, AST-railed (`tests/test_alerts_privacy.py`) — every route must depend on `get_current_user` and pass `user["id"]` down | **Reuse the endpoint shape and its privacy rail; extend the backing query.** `GET /api/alerts` stays the inbox route; its handler reads S7's durable receipt store (§9) instead of (or in addition to, during migration) the TTLCache, and the existing AST privacy rail extends to cover it. |
| **Entitlement mechanism** | `api/services/entitlements.py:138-302` (`TOOLKITS`, `toolkit_for`, `limits_for`, `limits_dependency`) | Four-axis mechanism, one toolkit (`"all"`) today, reads a `user["toolkit"]` key the schema lacks (per capability-ledger P5/G12) | **Consult, do not modify.** S7's registration and evaluation endpoints add `Depends(limits_dependency)` beside `Depends(require_paid)` exactly as G12 already does elsewhere — S7 adds no new entitlement axis logic of its own; §15 specifies the consult points. |
| **Discord webhook fleet** | 13+ distinct `*_DISCORD*WEBHOOK*` env-var names found across `api/` (`discord_notify.py`, `substack/alerts.py`, `buyout_sweep.py`, `bracco.py`/`publish.py`, plus the per-subsystem alert webhooks) | Confirms PRD/architecture's "seventeen-plus separate webhook variable names" (M4) claim in substance — one name per alert *kind*, not per channel *type* | **Consolidate onto S7's channel registry** (§5.5) — one Discord channel-registry entry per delivery *purpose* (member alerts, admin ops, community), replacing the per-subsystem variable proliferation, per PRD acceptance criterion #2. |

---

## 4. Target module layout

S7's new code is a package, not a rewrite of any existing file:

```
api/services/alert_taxonomy/          # NEW package — the S7 core
    __init__.py
    registry.py        # registerTriggerType, registerPredicate — validation + storage
    predicates.py       # per-trigger-type evaluation dispatch (calls into applications)
    queue.py             # per-type caps + reserve, replacing add_insight's global cap for
                         # migrated types (awareness's own insight queue for anything NOT
                         # migrated yet keeps using add_insight unchanged — see §18)
    receipts.py          # the shared fire-receipt store (generalizes alert_fired_log.py's
                         # shape — §5.3), claim_delivery-style lease + bounded retry
    delivery.py           # deliver(channel, payload) — thin typed wrapper calling the
                         # EXISTING watchlist_alert_service.deliver_alert_payload; owns
                         # nothing watchlist_alert_service doesn't already own
    channels.py          # the channel registry (§5.5) — replaces per-subsystem webhook vars
    monitor.py            # the "checked and clean vs could not check" evaluator + admin view
                         # backend, generalizing provider_coverage_monitor.py's pattern
api/routers/alert_taxonomy.py         # NEW router — registration + monitor endpoints (§6)
```

**Why a new package rather than extending `api/services/alerts.py` or
`api/services/watchlist_alert_service.py`:** `alerts.py` is the in-app/broadcast display layer
(kept, called into, not owned by S7); `watchlist_alert_service.py` is the delivery seam (kept,
called into, not owned by S7) plus the `I3` price/line/trendline evaluator (migrates onto the
taxonomy as a *registered predicate*, per §18 step 5, but the file itself is not deleted until
that migration's shadow pass clears — its evaluator function becomes a thin caller of
`alert_taxonomy.predicates`). Neither existing file is the right home for a cross-cutting
taxonomy that seven *other* files' evaluators also need to register against; putting the registry
inside one subsystem's file would recreate exactly the "which file is the real one" ambiguity D7
exists to remove.

Each of the five already-working evaluators (`indicator_alert_service.py`, `calendar_alerts.py`,
`catalyst/engine.py`'s alert-firing section, `awareness/engine.py`, `transcript_keyword_alerts.py`)
keeps its own file and its own condition-computation logic (S7's "must NOT own the computation of
breadth, patterns, catalysts or stop proximity" boundary, product-architecture.md §5.1) and is
migrated, one at a time, to call `alert_taxonomy.registry` / `alert_taxonomy.receipts` instead of
its bespoke dedup table, per §18.

---

## 5. Data contracts

### 5.1 Trigger type registration

```python
# api/services/alert_taxonomy/registry.py
def register_trigger_type(
    type_id: str,             # one of the 8 in PRD §6.1, e.g. "price-level"
    owning_system: str,       # e.g. "A1", "A9" — the application per PRD §6.1 col 4
    params_schema: dict,      # JSON-schema-shaped; validated at registration time (§14)
    replay_fn: Callable | None = None,  # optional: "would have fired N times" (§5.6)
) -> None: ...
```

Called once per type at process startup by each owning application's module (mirroring
`WIDGET_REGISTRY`'s registration-at-import pattern in `app/src/widgets/registry.js`, the frontend
precedent for a declarative-manifest registry). The eight calls live beside the evaluator each
type already has (§3), not centralized in one file — a `registerTriggerType` call in
`indicator_alert_service.py` for `indicator-condition`, one in `awareness/engine.py` for
`regime-change` and `position-risk`, etc. — so ownership stays visible at the call site.

### 5.2 Predicate registration

```python
def register_predicate(
    type_id: str,
    entity_scope: dict,      # {"kind": "entity"|"entity-set"|"list-ref", "id": ..., "asOf": ...}
                              # — per information-architecture.md §10.1's Context Channel shape.
                              # INTERIM (§8): "id" is a raw ticker string until S3 exists; the
                              # shape is typed identically either way so no caller changes when
                              # S3 lands.
    params: dict,             # typed per type_id, validated against params_schema
    user_id: str,
    channels: list[str] | None = None,  # per-alert channel override (§5.5); None = inherit
                                          # the member's per-type routing default
) -> str:  # predicate_id
    ...
```

Concrete `params` shapes, one per type (mirrors PRD §6.2's examples, made concrete against real
call sites):

| Type | `params` shape | Source of the shape |
|---|---|---|
| `price-level` | `{direction: "above"|"below", target_price: float, basis: "last"|"close"}` | `watchlist_alerts` columns (`api/services/auth_db.py:599-613`) |
| `indicator-condition` | `{indicator: str, condition: "above"|"below"|"cross_above"|"cross_below"|"cross_zero"|"touch_upper"|"touch_lower", threshold: float, tf: str}` | `indicator_alerts` columns (`indicator_alert_service.py:87-100`) |
| `scan-membership-change` | `{definition_id: str, direction: "entered"|"left"|"either"}` | new — thin wrapper over `scan_evaluator`'s `definition_evaluations` (§3) |
| `document-arrival` | `{form_type: str | None, keyword: str | None}` | union of `sec_filings.py`'s form-type filter and `transcript_keyword_alerts.py`'s keyword param |
| `event-proximity` | `{window_days: int, event_kind: "earnings"|"econ"}` | `calendar_alerts.py`'s My-Stocks × reporters intersection, generalized with a window |
| `regime-change` | `{}` (no params — the predicate is "the label changed since last cycle," global) | `awareness/rules.py:108-143` (`rule_regime_flip`) |
| `position-risk` | `{severity: "stop_hit"|"stop_proximity"|"aggregate_heat", threshold_pct: float | None}` | `awareness/rules.py:59-105` + `portfolio_heat.py` |
| `catalyst-match` | `{list_ref: dict}` (which list to intersect against the day's top-20) | `catalyst/engine.py`'s `_fire_catalyst_alerts` |

**Validation at registration time (PRD §9's "Error — predicate registration failure"
requirement):** `entity_scope` resolution failure or a `params` value that fails its type's schema
is rejected synchronously with a named reason — never silently accepted. Interim (§8): resolution
is a symbol-string lookup against `cap_universe.json` (the same universe gate `ticker_search.py`
already uses), not S3, until S3 exists.

### 5.3 The fire receipt (generalizes `alert_fired_log.py`, §3)

```sql
CREATE TABLE IF NOT EXISTS alert_fires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  predicate_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,           -- NEW column vs. indicator_alert_fires — the one
                                         -- addition that makes ONE table serve 8 types
  user_id TEXT,                         -- NULL for a broadcast-shaped fire (regime-change);
                                         -- matches alerts.py's existing user_id=None=broadcast
                                         -- convention (§3), never invented fresh
  entity_ref TEXT,                      -- the resolved scope (symbol string, interim §8)
  fire_key TEXT NOT NULL,               -- re-arm key, PER TYPE (§5.3.1) — reuses
                                         -- alert_fired_log's level-vs-edge distinction
  triggering_value REAL,
  source_data_class TEXT,               -- e.g. "quote", "indicator", "regime_label" — feeds
                                         -- the freshness/licensing lookup (PRD §14, §15)
  freshness_class TEXT,                 -- real-time | delayed-15 | end-of-day | historical
                                         -- (data-architecture.md §12.1's 4-class model)
  as_of REAL NOT NULL,                  -- the VALUE's timestamp
  fired_at REAL NOT NULL,               -- the EVALUATION's timestamp (distinct — PRD §14)
  delivered_at REAL,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_failed_at REAL,
  delivery_channels TEXT,               -- JSON: {"in_app":"ok","email":"failed",...} —
                                         -- SAME vocabulary as watchlist_alert_service's
                                         -- CHANNEL_OK/FAILED/SKIPPED (§3), not reinvented
  channels_failed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(predicate_id, fire_key)
);
CREATE INDEX idx_alert_fires_user ON alert_fires(user_id, fired_at DESC);
CREATE INDEX idx_alert_fires_predicate ON alert_fires(predicate_id, id DESC);
CREATE INDEX idx_alert_fires_type_cycle ON alert_fires(trigger_type, fired_at DESC);
                                         -- NEW — the monitor's per-type per-cycle query (§13)
```

This is `indicator_alert_fires`'s exact column set (`alert_fired_log.py:138-160`) plus
`trigger_type` (to make one table serve eight), `entity_ref`/`source_data_class`/`freshness_class`
(PRD §14's receipt requirement — freshness class did not exist on the indicator table because
indicator alerts only ever read real-time data), and a monitor-serving index. **Every locking,
retention, and lease invariant from `alert_fired_log.py` (§121-136, `claim_delivery`
compare-and-set, `MAX_DELIVERY_ATTEMPTS`, the "never sweep an undelivered/failed row" rule)
carries over unchanged** — this table is that module's schema, generalized, not a fresh design.

**5.3.1 The re-arm key, per type.** `alert_fired_log.py`'s level-vs-edge distinction
(`CONDITION_KIND`, §64-108) generalizes directly:

| Type | Kind | `fire_key` shape |
|---|---|---|
| `price-level`, `position-risk` (stop_hit/stop_proximity) | level | `ep:<arm_epoch>` — re-arms when observed false, matching `awareness/rules.py`'s existing cooldown-namespace discipline (`stop_hit`/`stop_near` never share a key) |
| `indicator-condition` (cross_*) | edge | `bar:<bar_time>` |
| `regime-change` | edge (one flip = one fire) | `flip:<from_label>:<to_label>:<cycle_ts>` |
| `event-proximity`, `document-arrival` | edge (one occurrence) | `occ:<report_date>` / `occ:<accession_number>` |
| `scan-membership-change` | edge | `delta:<cycle_date>:<direction>` |
| `catalyst-match` | edge, matches `catalyst_alerts_fired`'s existing `(user_id, ticker, market_date)` shape | `match:<market_date>` |

### 5.4 The queue / cap model

Generalizes `add_insight`'s cooldown mechanism (§3) with a per-type cap replacing the global one:

```python
def enqueue(fire: FireCandidate, *, trigger_type: str, user_id: str) -> bool:
    """Returns False (suppressed) on: cooldown (fire_key already recorded, §5.3.1),
    per-type daily cap exhausted, or reserve-protected type's budget exhausted by a
    DIFFERENT type crowding it out — the direct fix to K7's named limitation."""
```

- **Per-type cap, not global** (PRD §4.3, §13, acceptance criterion #4): each `trigger_type` gets
  its own daily counter (mirrors `add_insight`'s existing `MAX_INSIGHTS_PER_USER_PER_DAY` query
  shape — same TEXT-format cutoff discipline `voice_proactive_service.py:67-70` already gets
  right — just partitioned by `trigger_type` instead of summed across all kinds).
- **A reserve for `position-risk` and `regime-change`**: these two are desk-priority per PRD §2;
  their cap is carved out of the shared ceiling rather than competing for it, closing K7's
  documented limitation ("the shared 8/day insight cap can silently starve `daily_focus`" —
  `CLAUDE.md` Awareness Engine section) concretely: a member who arms twenty `price-level` alerts
  cannot crowd out their `stop_hit` fire.
- **`daily_focus` and any insight kind S7 does not yet own** keeps using `add_insight` and its
  existing global cap unchanged, until/unless a future phase migrates it too — S7's queue is
  additive, not a replacement for the whole proactive-insight system (out of this spec's scope;
  PRD §19 non-goals: "no changes to ... any partner-owned file," and `add_insight`'s
  non-alert insight kinds like `daily_focus` are not one of the eight trigger types).

### 5.5 The delivery channel registry

```python
CHANNEL_REGISTRY: dict[str, ChannelHandler] = {
    "in_app": handler_in_app,     # -> add_alert (§3, unchanged)
    "email":  handler_email,      # -> send_email (unchanged)
    "discord": handler_discord,   # -> add_alert's Discord leg for severity-gated fires;
                                    # ONE registry entry per delivery PURPOSE (member alert
                                    # vs. admin ops vs. community), replacing the
                                    # per-subsystem *_DISCORD_WEBHOOK_URL sprawl (§3) —
                                    # not one entry per existing env var name
    "browser": handler_browser,   # -> showBrowserNotification (existing, app/src/utils/alertSound.js)
    "sound":   handler_sound,     # -> playAlertSound (existing)
}
```

Per-trigger-type default routing, overridable per predicate (PRD §8's "one routing rule per
trigger type, overridable per alert," citing Bloomberg `MRUL`) is a row in S7's own small
preferences table (interim persistence, §9), consulted by `delivery.py` at fire time — not a
change to `deliver_alert_payload`'s signature (it already accepts a `severity` that gates the
Discord leg; the per-type channel list is a new, additive parameter S7's wrapper passes down,
computed before the call).

### 5.6 The tuning receipt ("would have fired N times")

`replay_fn` (§5.1) is optional per trigger type because PRD §11 item 6 itself excludes it for
newly-armed `document-arrival` and `scan-membership-change` predicates with no prior history.
Where it exists, it queries `alert_fires` (§5.3) for the same `entity_scope`/`params` shape over
the trailing 7 days, or — for a predicate with genuinely no fire history yet (a brand-new
`price-level` threshold nobody has armed before) — replays the predicate against the
already-cached historical bars (`api/routers/bars.py`, `A3`) the way the entity's own chart
already does, never a second history fetch.

---

## 6. API boundary

New router: `api/routers/alert_taxonomy.py`. Every route follows the existing AST-railed pattern
(`tests/test_alerts_privacy.py`'s shape — `Depends(get_current_user)`, `user["id"]` passed down)
and, for paid-gated types, `Depends(limits_dependency)` beside `Depends(require_paid)` exactly as
`entitlements.py`'s existing consumers do (§3, §15).

| Route | Method | Purpose |
|---|---|---|
| `/api/alerts/trigger-types` | GET | List registered types + their `params_schema` (drives the authoring UI's form) |
| `/api/alerts/predicates` | POST | Register a predicate (§5.2); validates synchronously, rejects with a named reason |
| `/api/alerts/predicates` | GET | List the caller's predicates (replaces per-subsystem list endpoints during migration) |
| `/api/alerts/predicates/{id}` | PATCH | Suspend / edit threshold / re-arm (PRD §8's suspend-not-delete, US-9) |
| `/api/alerts/predicates/{id}` | DELETE | Hard delete (rare; suspend is the default UX per PRD §8) |
| `/api/alerts/predicates/{id}/replay` | GET | The tuning receipt (§5.6) |
| `/api/alerts/predicates/{id}/fires` | GET | Fire history for one predicate — the receipt log (PRD §8: "the receipt log *is* the record") |
| `/api/alerts/routing` | GET/PUT | Per-trigger-type channel routing default (§5.5) |
| `/api/admin/alerts/monitor` | GET | The monitoring half (§13) — staff/admin only, `require_admin` |

**`/api/alerts` itself (existing, `api/routers/alerts.py`) is not replaced.** It stays the L0
inbox route; per §3, its handler is extended to read `alert_fires` (durable) rather than only
`alerts.py`'s TTLCache, once S7's receipt store exists — additive, not a breaking route change.

**The five existing per-subsystem endpoints** (`/api/watchlist-alerts`, `/api/indicator-alerts`,
the calendar/catalyst/transcript alert config surfaces where they expose one) are **not deleted**
during migration — PRD §18's non-breaking sequencing requires each old endpoint to keep answering
until its shadow pass clears and the subsystem is proven equivalent on the shared taxonomy, per
`alert_shadow_log.py`'s idiom (§3).

---

## 7. Provider adapters

**None new.** Every trigger type reads a value an application already computes or a provider
already serves (PRD §10's own headline, confirmed by this document's direct reads in §3): Massive
(price-level, indicator-condition), FMP/SEC EDGAR (document-arrival), EarningsWhispers/Finviz/
Finnhub/FMP via `/api/calendar` (event-proximity), UCT's own internal breadth/VIX computation
(regime-change, via `voice_regime_classifier.py` — no external call at evaluation time), the
member's own position data (position-risk), and the catalyst engine's already-licensed 8-source
composite (catalyst-match). S7 adds zero rows to the provider ledger.

---

## 8. Entity / security identifiers

S3 (Entity Master) does not exist yet (product-architecture.md: "the clearest infrastructure gap
the research found"; **absent** per capability-ledger, confirmed — no `resolve(alias, asOf)`
function exists anywhere in `api/services/`, verified by grep). **Interim, per PRD §17's
sequencing note:** `entity_scope.id` in every predicate (§5.2) is a raw ticker string, resolved
against `cap_universe.json` (the same 3,742-symbol universe gate `api/routers/ticker_search.py`
already uses) at registration time — exactly how the five existing subsystems already scope
themselves (`watchlist_alerts.sym`, `indicator_alerts.sym`, etc., all bare `TEXT` columns). The
`entity_scope` *shape* (`{kind, id, asOf}`, §5.2) is typed identically to what S3 will eventually
resolve to, so migrating from "ticker string" to "permanent entity id" changes the value inside
the shape, not the shape itself or any predicate's `params` — no second migration when S3 lands.

---

## 9. State management & persistence

**New database: `alert_taxonomy.db`** (its own SQLite file, `DATA_DIR`-rooted, WAL mode — matching
the pattern every other alert-adjacent store already uses: `calendar_alerts.db`,
`transcript_alerts.db`, `catalysts.db`, none of which live in `auth.db`). Holding:

- `alert_predicates` — the registered predicates (definition store; §5.2's shape, one row per
  predicate, `suspended_at` nullable column for PRD §8's suspend-not-delete requirement).
- `alert_fires` — §5.3.
- `alert_routing_prefs` — §5.5's per-type channel defaults.
- `alert_trigger_registry` — §5.1's in-process registrations, persisted so the monitor (§13) can
  answer "what types exist" without every application module having re-run its
  `register_trigger_type` call this boot (a cold-start read, refreshed on each app's own
  `register_trigger_type` call — mirrors `theme_db.py`'s hybrid JSON-seed-then-SQLite pattern,
  capability-ledger reference, for the same "definition survives a redeploy, registration
  re-confirms it" reason).

**Why not `auth.db`:** three of `auth.db`'s existing alert-adjacent tables
(`indicator_alerts`/`indicator_alert_fires`, `awareness_regime_snapshots`, `voice_proactive_insights`)
already co-tenant a ~110-table, single-write-lock database explicitly flagged as a place *not* to
add new tables (`product-architecture.md` §5-B.8: "Never `auth.db` (~110 tables, one write lock,
no migration framework — TD-13)"). S7's own file avoids adding write contention to the universal
auth path — the same reasoning `bars.db` and `catalysts.db` already follow.

**Why not one-table-per-type (the status quo, §1.4):** the whole point of D7 is one shared
receipt/definition shape; six separate schemas is the defect, not a design to extend.

**Migration of existing rows:** none required. Per §1.3/§1.4, five of six subsystems have no
durable receipt to migrate (their fired-log tables are bare dedup keys, not receipts); the one
exception, `indicator_alert_fires`, is migrated by **dual-write during its shadow phase** (§18
step 5) — new fires write to both the legacy table and `alert_fires`, diffed, then the legacy
table's writes stop once equivalence is shown, exactly as `alert_shadow_log.py` already
demonstrates working at scale for the *evaluation* side of this same subsystem.

**S5 (Persistence & User State) is not built yet** (product-architecture.md: "needs-extension...
every ingredient exists and none is applied to the layout"). Per PRD §17: S7's predicate store can
start against `alert_taxonomy.db`'s own tables (as designed above) and migrate onto S5's
versioned-document store once it exists, without changing the taxonomy's shape — the same
sequencing note the PRD already applies to S3/S8/S9/S11.

---

## 10. Caching

No new caching layer. `sec_filings.py`'s existing TTL cache (30 min filings / 10 min full-text,
§1.5/§3) already bounds `document-arrival`'s provider load; `voice_regime_classifier.py`'s 15-min
cache already bounds `regime-change`'s; `provider_coverage_monitor.py`'s existing pattern (§3)
bounds the monitor's own read cost. S7's own tables are read directly (SQLite, WAL, small row
counts relative to `bars.db`) — no TTLCache wrapper needed at launch scale (per PRD §2's ~750
community-member ceiling and 2-5 dogfooders).

---

## 11. Realtime / polling behavior, per trigger type

Unchanged from PRD §16's "no new per-request evaluation path" requirement — every type
piggybacks its already-scheduled cycle, confirmed against the actual scheduler entries read for
this document:

| Type | Cadence | Confirmed cycle |
|---|---|---|
| `price-level` | 15s | The `/api/live-prices` poll (`I3`'s existing checker, `watchlist_alert_service.run_alert_check`, unchanged) |
| `indicator-condition` | 25-30s | `indicator_alert_service`'s existing poll cycle (unchanged) |
| `scan-membership-change` | nightly, 05:00 ET | `scan_evaluator.sweep_job` (`SWEEP_HOUR_ET`, `max_instances=1`, confirmed at `scan_evaluator.py:2405` — reused, not re-scheduled) |
| `document-arrival` | new cadence needed — no existing schedule polls per-entity filings today | See §12 |
| `event-proximity` | twice daily, 07:00/18:00 ET | `calendar_alerts_morning`/`calendar_alerts_evening` (`calendar_alerts.py`, unchanged) |
| `regime-change`, `position-risk` | every 20 min, Mon-Fri 04-20 ET | `run_awareness_scan`'s existing cycle (`awareness/engine.py`, `max_instances=1`, unchanged — the single-instance assumption is load-bearing per `CLAUDE.md`'s Awareness Engine section and is not relaxed by this spec) |
| `catalyst-match` | the catalyst engine's own refresh cadence (5-min pre-market bursts, 30-min midday, hourly safety net) | `catalyst/engine.py`'s existing scheduler family (unchanged) |

---

## 12. Background jobs

One genuinely new scheduler entry, mirroring the existing APScheduler `CronTrigger` pattern
(`api/main.py`'s `_add_compass_job`/COT/Twitter registration shape):

```python
# api/main.py — new, alongside the existing alert-adjacent jobs
_scheduler.add_job(
    document_arrival_sweep, CronTrigger(minute="*/20", timezone=_ET),
    id="alert_taxonomy_document_arrival", max_instances=1,
)
```

`document_arrival_sweep` polls each registered `document-arrival` predicate's entity against
`sec_filings.py`'s cached submissions fetch (§1.5, §10) and diffs the newest accession number
against the predicate's last-seen value (stored on the `alert_predicates` row, §9) — a bulk
operation over the registered-predicate set, not a per-alert re-fetch (PRD §16's batch-evaluation
requirement), mirroring `awareness/engine.py`'s existing "one shared scan, bulk-load state" shape
(`run_awareness_scan`'s "one shared market scan per cycle... two bulk queries," §3). Gated by a
new flag, `ALERT_TAXONOMY_DOCUMENT_ARRIVAL_ENABLED` (default off), following the double-gate
convention every other dark-shipped scheduler entry in this codebase already uses
(`COMPASS_AUTOMATION_ENABLED` + `AWARENESS_ENGINE_ENABLED`, `SCAN_SWEEP_ENABLED`, etc.).

No other new scheduler entry is required — every other trigger type rides an existing cycle
(§11). The monitor's own read (§13) is on-demand (an admin page load), not scheduled, matching
`provider_coverage_monitor`'s `GET /api/admin/provider-coverage`'s existing no-schedule,
read-on-request shape.

---

## 13. Observability / the monitoring half

Generalizes `provider_coverage_monitor.py` + `CoverageLine.jsx`'s four-count receipt (§3) to a
per-trigger-type read:

```python
# api/services/alert_taxonomy/monitor.py
def monitor_snapshot(trigger_type: str) -> dict:
    """{trigger_type, last_successful_cycle_at, evaluated, fired,
        could_not_evaluate, could_not_evaluate_reason, channel_health: {...}}
    Computed from alert_fires (§5.3) + each evaluator's own cycle-completion
    marker — never a counter that resets on redeploy (the Desk session-audit
    lesson, cited by product-architecture.md's S12 evidence, applies here with
    equal force: an audit artifact, not a proxy)."""
```

- **"Evaluated" and "could-not-evaluate" are read from the evaluation cycle's own artifact**, per
  PRD §14's requirement — for the five cycles that already exist (§11), this means reading each
  evaluator's own completion marker (e.g. `indicator_alert_service`'s `last_evaluated_at` column,
  already present at `indicator_alert_service.py:96`), not inferring evaluation from a fire
  count (a cycle that evaluated 500 predicates and fired zero is healthy; a cycle that never ran
  is not, and the two must not look alike — the exact distinction `CoverageLine` already proves
  out for the screener).
- **Channel health** reuses `AlertBell.jsx`'s existing per-fire `delivery_channels` read (§3),
  generalized across all eight types instead of the indicator-only lane it serves today.
- **The "second channel when Discord is down" requirement (PRD §9, acceptance criterion #8):** the
  in-app bell (`add_alert`, §3) has no external dependency and is therefore always the fallback
  channel — this is already true of every existing subsystem's delivery (`deliver_alert_payload`
  always attempts in-app regardless of Discord's state, confirmed at
  `watchlist_alert_service.py:430-432`); S7 adds the *monitor's* visibility into "Discord is
  currently degraded," which does not exist today (no code reads Discord webhook health
  anywhere in the repo, confirmed by grep for a Discord health-check pattern — none found), as
  new, narrow work: a periodic no-op webhook health probe or, cheaper, deriving degraded state
  from `channels_failed` on recent `alert_fires` rows crossing a threshold — the latter needs no
  new external call and is the recommended default.

**Admin surface:** a new page (or a section of the existing `/admin` page,
`components/admin/TwitterAccountsPanel.jsx`'s slotting precedent for "one more admin panel") reads
`GET /api/admin/alerts/monitor` (§6) and renders per-type rows exactly in `CoverageLine`'s
four-count shape, plus the channel-health strip.

---

## 14. Error handling

- **Registration-time validation (§5.2):** malformed `params` against the type's schema, or an
  `entity_scope` the interim resolver (§8) cannot resolve, is rejected synchronously with a named
  reason (`ValueError` subclass per type, mirroring `alert_fired_log.py`'s "every refusal is a
  `ValueError`" discipline) — never silently accepted and silently never evaluated (PRD §9).
- **Evaluation-cycle failure:** each evaluator's existing try/except-per-user/per-item pattern
  (`awareness/engine.py`'s "a bad user or a bad `deliver` can't abort the rest of the cycle,"
  confirmed at the file) is the model every migrated evaluator keeps — S7 does not introduce a
  new failure-isolation strategy, it reuses the one already proven at the awareness engine's
  20-minute cadence.
- **Delivery failure:** unchanged from `deliver_alert_payload`'s existing three-state vocabulary
  (`ok`/`failed`/`skipped`, §3) — S7 adds no new delivery-failure semantics, only a durable place
  (`alert_fires`, §5.3) for the per-channel outcome to live past 24 hours (§1.3's fix).
- **Never crash a shared cycle on one predicate's bad state:** every batch evaluation (§12, §11)
  wraps per-predicate work in its own try/except, mirroring `awareness/engine.py`'s existing
  exception-layering — a single malformed `document-arrival` predicate's diff failure does not
  abort the other 500 predicates in that cycle.

---

## 15. Permission / entitlement handling

S9's mechanism (`entitlements.py`, §3) is consulted, never re-implemented, at three points:

1. **Registration** (`POST /api/alerts/predicates`): `Depends(require_paid)` +
   `Depends(limits_dependency)` for any type whose owning application is already paid-gated
   (all eight are, per PRD §2 — `I3`/`B6`/`E7`/`K8`/`D6` are `paid`-gated today; `position-risk`/
   `regime-change` inherit A13/A11's gate).
2. **Evaluation:** the CTA/OPRA server-side non-display axis PRD §15.1 requires S9 to be
   *capable of expressing* — this spec's `price-level`/`indicator-condition` evaluators consult
   an entitlement check before evaluating (not before registering, since the fee risk is about
   server-side *evaluation* of real-time data, per PRD §15.1's own framing) — implemented as an
   additional `Depends`-shaped consult in the evaluation cycle's per-predicate loop, gated on a
   data-class flag this spec does not itself resolve (PRD §15.3, §21: not this document's to
   decide either).
3. **Delivery:** unchanged — `deliver_alert_payload` already resolves the member's own address
   (email, Discord DM if ever added) per-call; no broadcast-vs-private ambiguity is introduced
   (§5.3's `user_id` NULL-for-broadcast convention matches `alerts.py`'s existing one exactly,
   §3).

No new entitlement axis logic is written by S7 — per product-architecture.md's S7 "must NOT own"
line ("the choice of which data class an audience may be alerted on (S9)"), S7's evaluator code
calls into `entitlements.py`'s existing functions and nothing more.

---

## 16. Testing strategy

1. **Registration validation tests** — one per trigger type's `params_schema`, mirroring the
   existing `tests/test_alert_fired_log.py`'s derive-the-covered-set-from-source discipline (that
   file asserts its condition-kind table covers every condition `alert_conditions.check_condition`
   actually handles, by reading the source, not by a hand-typed list — the same AST-derived
   coverage pattern applies to S7's `params_schema` set).
2. **Shadow-parity tests, per migration step (§18)** — one per subsystem being migrated, built
   directly on `alert_shadow_log.py`'s proven shape (§3): the legacy evaluator and the new
   `alert_taxonomy` evaluator run against the same input, on separate connections, diffed by set
   difference keyed on the fired value — not a repaint/mismatch counter (that file's own
   documented reason: a naive counter can read zero while being wrong, per its M1/M4 mutation
   findings).
3. **Queue/cap regression test** — PRD acceptance criterion #4 verbatim: arm enough
   `catalyst-match` predicates to exhaust a naive global cap, confirm `position-risk` still fires
   in the same cycle — directly testable against §5.4's reserve mechanism.
4. **Monitor honesty test** — simulate one trigger type's evaluator raising mid-cycle (mirroring
   `awareness/engine.py`'s own test pattern for per-user exception isolation) and confirm the
   monitor (§13) names that type as degraded rather than silently omitting its predicates from
   the evaluated count — PRD acceptance criterion #7.
5. **Delivery-channel-down test** — disable the Discord webhook env var, confirm in-app delivery
   still lands and the monitor flags Discord degraded — PRD acceptance criterion #8, directly
   exercising `deliver_alert_payload`'s existing per-channel isolation (§3) plus §13's new
   channel-health read.
6. **Partner-boundary rail** — extend the existing AST/grep convention
   (`tests/test_yf_guard_census.py`'s shape, cited by PRD acceptance criterion #12) to assert no
   file under `api/services/alert_taxonomy/` imports from any of the five partner-owned files
   (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`,
   `massive_processor.py`) — trivially true today since none of the eight trigger types touch
   options-flow data, but pinned so a future ninth predicate type cannot introduce the violation
   silently.
7. **Privacy rail extension** — `tests/test_alerts_privacy.py`'s existing AST walk (§3, §6)
   extends to cover `api/routers/alert_taxonomy.py` the same way it already covers
   `api/routers/alerts.py`.

---

## 17. Migration implications

Per PRD §18's six-step sequence, made concrete at the file level (no step changes
`deliver_alert_payload`'s signature or touches a partner-owned file, per PRD §18's closing note,
confirmed against this spec's own file-by-file design in §3-§9):

1. **Stand up `alert_taxonomy` package + `alert_taxonomy.db`** (§4, §9) with zero subsystems
   migrated yet — pure scaffolding, testable in isolation (§16.1).
2. **Register `document-arrival` first** (PRD's own stated sequencing) — genuinely new code
   (§1.5, §12), the lowest-risk place to prove the taxonomy end-to-end because no legacy
   subsystem's behavior is at stake.
3. **Migrate `E7` and `K8` onto the shared queue**, cadences unchanged (§11) — their dedup tables
   (`calendar_alerts_fired`, `catalyst_alerts_fired`, §1.4) are dual-written during a shadow pass
   (§16.2) before their evaluators switch to calling `alert_taxonomy.receipts` instead of their
   own `try_record_alert` functions.
4. **Migrate `K7`'s three rules** onto `position-risk`/`regime-change`/`event-proximity` — the
   cooldown-namespacing invariant (`stop_hit`/`stop_near` distinct keys, §3, §5.3.1) is preserved
   by construction since S7's fire-key scheme is a direct generalization of the same idiom, not a
   replacement.
5. **Migrate `I3` and `B6`** onto `price-level`/`indicator-condition`, offloading delivery off the
   request path in the same pass (PRD §16) — `I3`'s `run_alert_check` already runs off-thread
   (§3, confirmed at `watchlist_alert_service.py:479-518`: "used to run INLINE... now the worker
   returns immediately and a daemon thread does the delivery"), so this step is mostly `B6`'s;
   `indicator_alert_fires` dual-writes into `alert_fires` during its shadow pass (§9).
6. **Retire each subsystem's independent trigger logic** once shadow-proven equivalent — the
   `alert_shadow_log.py` idiom (§3, §16.2) is the concrete verification mechanism for every one
   of steps 3-5, not a metaphor.

**What does NOT move:** the five evaluators' condition-computation code (§4's module-layout
rationale) — only their registration, dedup, and receipt calls migrate. **Frontend impact:** the
act-at-price gesture (§1.1) needs a one-line target-URL change when step 5 completes; every other
existing UI surface (`AlertBell.jsx`, the per-subsystem alert-setting popovers on watchlists/
charts/calendar) keeps working against the old endpoints until its step completes, per PRD §18's
non-breaking guarantee.

---

## 18. Performance considerations

Restated from PRD §16 and grounded against the actual constraint this spec read directly:
**the web pod is a single uvicorn process, one event loop, one anyio threadpool** — confirmed via
`CLAUDE.md`'s "Performance & Scale" section and the 2026-07-01 524-outage postmortem it documents.
Concretely for S7:

- **No new per-request evaluation loop** — every trigger type's evaluation stays on its existing
  scheduled cycle (§11); S7 adds a batch cost to five already-running cycles and one new
  20-minute cycle (§12), never a request-time predicate check.
- **`alert_taxonomy.db` is a new file, not a new table in `auth.db`** (§9) — specifically to avoid
  adding write contention to the universal auth path, the exact mechanism behind the 2026-07-01
  outage this codebase's own history documents.
- **The monitor (§13) is read-on-request, not polled server-side** — matching
  `provider_coverage_monitor`'s existing no-schedule shape; an admin page load, not a background
  cost.
- **`document-arrival`'s new 20-minute cycle batches its SEC EDGAR reads** — `sec_filings.py`'s
  existing 30-min TTL cache means most cycles serve from cache; the worst case (every registered
  predicate's ticker cold) is bounded by however many *distinct entities* have a registered
  `document-arrival` predicate, not by predicate count (many members can register against the
  same entity for one fetch).

---

## 19. Non-goals

Restated verbatim from PRD §19 — this spec designs to the same boundary and adds no scope: no
order-triggered alerts, no new asset classes, no new AI door (I1's single `○ insight` edge is the
entire AI surface, §3/§4 add nothing here), no resolution of D5/D9, no portfolio/risk
analytics build-out beyond consuming `portfolio_heat.py` as-is, no general-purpose event bus, no
predictive threshold suggestion, no new Discord app or webhook variables (§5.5 consolidates,
never adds), no changes to `/api/calendar`, EDGAR client internals, or any partner-owned file.

---

## 20. Open questions / owner-bound items carried forward, not resolved here

Unchanged from PRD §22 — this spec does not decide OI-03(a)/(b), D9, the four telemetry queries,
or D1's fixed/modular/hybrid question. One item is added by this document specifically:

- **Whether the "second channel when Discord is down" monitor signal (§13) is worth a real
  webhook health probe or should stay derived from recent `channels_failed` counts** — this spec
  recommends the derived approach (no new external call, §13) as the default, but flags it as a
  design choice a future implementer could revisit if Discord outages prove to correlate poorly
  with recent delivery failures in practice — unmeasured, since no telemetry on Discord webhook
  uptime exists anywhere in the repo (confirmed by grep).

---

## GAPS

- **No production telemetry exists to validate any cadence or cap number in this spec** — the
  20-minute `document-arrival` cycle, the per-type cap split (§5.4), and the reserve size are all
  engineering-reasonable defaults grounded in existing cadences (§11), not measured against real
  alert volume (the same gap PRD §22/GAPS already names).
- **The Discord webhook variable count (§3, "13+") is this document's own grep, not an exhaustive
  audit** — PRD/`product-architecture.md` cite "seventeen-plus"; this spec's narrower pattern
  match confirms the phenomenon (many per-subsystem names) without independently re-deriving the
  exact count, and does not treat the discrepancy as material to the design (§5.5's consolidation
  approach is the same regardless of whether the true count is 13 or 17+).
- **Whether `entitlements.py`'s existing `limits_dependency` mechanism needs a new axis for
  per-trigger-type caps, or can express S7's reserve model within its existing four axes, was not
  determined** — this spec assumes S7's queue (§5.4) owns its own cap logic independent of
  `entitlements.py`'s saved-object-count-shaped limits, since a per-type alert cap is a different
  kind of limit than the ones `Limits` (`entitlements.py:179-206`) currently models; a future
  implementer should confirm this before building §5.4 rather than assuming it.

## NOT INSPECTED

Per this task's DO NOT clause: no application file was written, edited, or executed — every claim
above is grounded in a file *read* (cited inline). Not inspected: the `uct-intelligence`,
`uct_intelligence`, `morning-wire`, and `uct-sunday-scan` repositories (read-only for this program
per GOVERNING_PRINCIPLES §4, and none of S7's eight trigger types depends on them per PRD §10);
production Railway variables or the production pod (per GOVERNING_PRINCIPLES §4's prohibition);
`C:\data`; any vendor console or contract; the full text of `api/services/catalyst/engine.py`'s
alert-firing section (`_fire_catalyst_alerts`) and `api/services/awareness/engine.py`'s full body
beyond the sections cited (read in relevant part, not exhaustively); the frontend alert-setting
popovers on Watchlists/Charts/Calendar beyond the one gesture (§1.1) this document traced in full;
any test file's full contents beyond the names and shapes cited from their module docstrings.

## SOURCES

**Application code read directly for this document** (exact paths, cited inline throughout):
`api/services/watchlist_alert_service.py` · `api/services/alerts.py` · `api/routers/alerts.py` ·
`api/services/indicator_alert_service.py` · `api/services/alert_fired_log.py` ·
`api/services/alert_shadow_log.py` · `api/services/calendar_alerts.py` ·
`api/services/catalyst/store.py` · `api/services/awareness/engine.py` ·
`api/services/awareness/rules.py` · `api/services/awareness/regime_snapshots.py` ·
`api/services/voice_proactive_service.py` · `api/services/transcript_keyword_alerts.py` ·
`api/services/voice_regime_classifier.py` · `api/services/journal_two/regime.py` ·
`api/services/entitlements.py` · `api/services/portfolio_heat.py` ·
`api/services/edgar.py` · `api/services/sec_filings.py` ·
`api/services/screener/scan_evaluator.py` · `api/services/auth_db.py` (`watchlist_alerts` schema) ·
`app/src/components/AlertBell.jsx` · `app/src/components/StockChart.jsx`
(`createAlertAtCursor`, cursor-price tracking) · `app/src/components/chart/ChartCalloutOverlay.jsx` ·
`app/src/components/screener/CoverageLine.jsx` · `api/services/provider_coverage_monitor.py` ·
grep sweeps for `*DISCORD*WEBHOOK*` variable names, EDGAR client consumers, and a Discord
health-check pattern (none found).

**Program artifacts:** `docs/terminal-research/05-product-strategy/prds/alerts-monitoring-prd.md`
(PRD-S7-ALERTS, and the D13 validation finding supplied in this task's own instructions, already
incorporated there) · `docs/terminal-research/05-product-strategy/product-architecture.md` (§5-B.6,
S7 system block Part C §5, boundary matrix §8, reversibility ledger §10) ·
`docs/terminal-research/06-ux-and-information-architecture/information-architecture.md` (§9.1,
§10.1, §11.2, §12.1/12.3/12.4, §13.2, §3.1) ·
`docs/terminal-research/07-technical-architecture/data-architecture.md` (§3 Provider Abstraction
Layer, §11 Provenance, §12 Freshness Metadata, §14 Licensing/Entitlement Metadata) ·
`docs/terminal-research/05-product-strategy/capability-infrastructure-matrix.md` (S7 row) ·
`docs/terminal-research/01-existing-system/capability-ledger.md` (rows I1-I6, B6, D6, D7, E7, K7,
K8, M4, H6, D12, G2, P5, G12, A6, A13, K4, N6) ·
`docs/terminal-research/12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` (D3, D4, D6, D7, D13) ·
`docs/terminal-research/00-program-control/GOVERNING_PRINCIPLES.md` (§4, §5, §13) ·
`docs/terminal-research/00-program-control/READINESS_REVIEW_DAY1.md`,
`docs/terminal-research/13-executive-synthesis/DAY_1_EXECUTIVE_SYNTHESIS.md`,
`docs/terminal-research/13-executive-synthesis/PHASE_2_INTEGRATION_SYNTHESIS.md` (program-control
grounding for scope discipline, §8, §17 sequencing).
