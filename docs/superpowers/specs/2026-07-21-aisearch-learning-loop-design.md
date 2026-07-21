# AI Search — Learning-Loop Data Foundation (design)

- **Date:** 2026-07-21
- **Status:** Design — direction approved, pending spec review
- **Related:** `api/routers/ai_search.py`, `api/services/perplexity_search.py`,
  `api/services/brain_kb_service.py` (retrieval pattern), `api/services/wire_feedback_store.py`
  (feedback/critic pattern), `api/services/catalyst/cost_guard.py` (budget pattern)

## 1. Goal & scope

Enhance AI Search so every question + answer is captured in a **structured, anonymized,
forward-compatible database** — the data foundation that lets the feature *later* accumulate
a "house knowledge" trading brain and be trained on / retrieved from in beneficial, sensible
ways.

**This build changes nothing about how answers are produced today.** The existing Perplexity +
live-desk-grounding pipeline stays exactly as-is. We add a capture + analytics layer *beside*
it, we do not rebuild it.

### In scope — build now ("Foundation")
1. A persistent, well-structured `ai_search_log` SQLite database (anonymized).
2. Best-effort logging wired into both answer endpoints — never affects the answer path.
3. A lightweight, **free, rule-based freshness classifier** (evergreen vs time-sensitive) so
   every row is labeled for future use.
4. An admin analytics view: what's asked, top tickers/topics, mode/grounding/cache/error rates,
   evergreen/time-sensitive split.

### Designed-for but NOT built now — future phases
- **Phase 2 — Retrieval memory:** embed high-value *evergreen* answers into a semantic index
  (mirroring `brain_kb_service`) and blend the most relevant house knowledge into new answers
  as extra context, alongside the always-fresh live grounding.
- **Phase 3 — Synthesis:** a background job distils accumulated Q&A per entity/theme into living
  "house-view" knowledge docs (an evolving NVDA dossier, a theme brief) that become the top
  retrieval targets — the compounding "trading brain."

The Foundation schema is deliberately shaped so Phases 2–3 drop in **with no data migration** —
every field a future embedder / critic / synthesizer needs is captured up front.

## 2. Guiding constraints (cross-cutting guarantees)

- **Fresh, always.** Time-sensitive answers (prices, movers, "why it moved today") are logged
  but *labeled* so they can **never** be reused as stale knowledge in a future phase. Live
  grounding always runs.
- **Fast.** Logging is a single best-effort insert taken *after* the answer is produced;
  classification is rule-based (microseconds). Nothing on the request path gets slower.
- **Never breaks an answer.** All capture is wrapped so any DB/IO error is swallowed — a logging
  failure can never affect the user's answer.
- **Anonymized.** Store the question + answer + metadata, but **not who asked**. An optional
  daily-salted hash bucket allows "N distinct users today" counts without identity or cross-day
  linkage.
- **Cheap.** Zero added LLM cost in the Foundation (rule-based classification). Any future LLM
  pass (Phase 2/3) is budget-capped + flag-gated.
- **Reversible.** Flag-gated (`AI_SEARCH_LOG_ENABLED`), its own DB file — disable the flag or
  delete the file and it's gone, with no impact on the live product.

## 3. Architecture (where this sits)

Two layers — the second is what this foundation enables:

1. **Live grounding (today, unchanged):** fresh desk data injected per question. Time-sensitive;
   never remembered.
2. **House knowledge (future, this enables):** durable evergreen knowledge that compounds over
   time.

The Foundation is the **capture pipe** that feeds layer 2:

```
answer endpoints ──(best-effort, off the critical path)──▶ ai_search_log.log()
                                                              │
                                              rule-based freshness classifier
                                                              │
                                                       ai_search_log.db ─────▶ admin analytics
                                          (structured · anonymized · forward-compatible)
                                                              │
                                          (future) embed evergreen → retrieval → synthesis
```

## 4. Components (Foundation)

### 4.1 `api/services/ai_search_log.py` — the store
- SQLite at `AI_SEARCH_LOG_DB_PATH` (default `/data/ai_search_log.db`), WAL, `busy_timeout=2000`,
  `contextlib.closing` on every connection, lazy `_ensure_init()`. Mirrors `tweet_store` /
  `cot_service` conventions.
- Public API:
  - `log(**fields)` — best-effort insert; swallows all errors; no-op when the flag is off.
  - `insights(days, limit)` — analytics aggregation for the admin view.
  - `classify_freshness(query, intents)` — the rule-based classifier (pure function, testable).
  - `_reset_for_tests()` — resets module init state so tests can point at a temp DB.
- Gated by `AI_SEARCH_LOG_ENABLED` (default `1`).

### 4.2 Schema — table `ai_search_log`

| column | why it's captured (incl. future use) |
|---|---|
| `id`, `ts` (UTC ISO), `day_et` | ordering + ET-day bucketing |
| `query`, `query_norm` (lower/trim) | the ask; `query_norm` powers "top questions" grouping + future dedup/embedding |
| `answer` | the response — raw material for future retrieval/synthesis |
| `mode` | tier used (lite / fast / reasoning) |
| `cached` (0/1) | cache hit → a "repeat question" signal |
| `grounded` (0/1) | did desk grounding fire |
| `tickers` | entities named (comma-joined) — future per-entity knowledge |
| `intents` | which grounding intents fired (movers/flow/breadth/…) |
| `citations` (int) | source count — a cheap quality proxy |
| `elapsed_ms`, `error`, `units` | perf, failures, billing units |
| `freshness` (`evergreen` \| `time_sensitive`) | **the key label** — gates what can ever become durable knowledge |
| `user_bucket` (nullable) | daily-salted hash of user id — anonymized distinct-user counting; no identity, no cross-day linkage |

Indexes: `day_et`, `ts`, `freshness`.

### 4.3 Freshness classifier (rule-based, free)
Reuses signals already computed in the router — **no new LLM cost, deterministic, instant**:
- `time_sensitive` when `_auto_recency(query) == "day"` **or** a time-sensitive intent fired
  (movers, flow, breadth, earnings-today, headlines/news, "why is X moving").
- else `evergreen` (fundamentals, analyst, comparisons, concepts, company profiles, history).

(A future LLM-based refinement is possible but explicitly out of scope for the Foundation.)

### 4.4 Wiring (both endpoints, best-effort)
- Capture `grounded = bool(salt)` right after `system, salt = _grounded_system(query)` (a
  non-empty grounding salt ⟺ desk context was injected).
- Single-shot `ai_search`: after `result` is finalized, `try/except: ai_search_log.log(...)`.
- Streaming `ai_search_stream`: accumulate the final answer/metadata from the `final` event (and
  the reasoning→fast fallback), then log once in the generator's `finally`.

### 4.5 Admin analytics
- `GET /api/ai-search/admin/log?days=&limit=` (`require_admin`) → totals, window count, top
  questions, top tickers, mode/grounding/cache/error rates, evergreen/time-sensitive split, and
  recent rows (with an answer snippet).
- A small **"AI Search Insights"** panel on the existing `/admin` page rendering the above (SWR
  fetch, mirrors the Twitter-accounts admin panel pattern).

## 5. Privacy
Anonymized per decision: **no `user_id` is stored.** The optional `user_bucket` =
`sha256(user_id + daily_salt)` lets us count distinct users per day without knowing identity and
without linking a user across days. Admin-only reads. Any knowledge that survives into future
phases carries zero personal attribution.

## 6. Testing
`tests/test_ai_search_log.py`:
- `log()` insert + `insights()` aggregation (counts, top-queries, top-tickers, rates, freshness split).
- Flag-off ⇒ `log()` is a no-op.
- Best-effort: a broken DB path never raises out of `log()`.
- `classify_freshness()` cases: movers/flow/why-moved-today → time_sensitive; fundamentals /
  compare / concept → evergreen.
- `/admin/log` response shape + admin-gating.
- Temp DB via `AI_SEARCH_LOG_DB_PATH` + `_reset_for_tests()`.

## 7. Rollout
- Ships with `AI_SEARCH_LOG_ENABLED=1` (capture is benign and we want data accumulating during the
  live test week). Its own DB file; no impact on the existing answer pipeline; reversible by flag
  or file deletion.

## 8. Why this is the right first step
Small, cheap, and zero-risk to the live product, yet it turns on the tap that every future
"smart brain" capability needs — and it immediately shows what people actually ask during the
test week. Phases 2–3 build directly on this schema with no rework.

---

## 9. Finalized design (post 11-specialist panel review, 2026-07-21)

The panel verified the spec against the code and caught real bugs + one-way doors. This section is
the authoritative build blueprint; it supersedes the drafts in §4 where they differ. Guiding rule
kept from the synthesis: **capture only what is unrecoverable at write time now; do NOT add
speculative Phase-2 processing columns (SQLite `ALTER ADD` is migration-free later); keep the
freshness gate conservative (a false-evergreen poisons the future brain; a false-time_sensitive
merely fails to compound).**

### 9.1 Corrections the panel caught (must-fix)
- `bool(salt)` is a wrong `grounded` signal — `salt` is overwritten before use and regime injects on
  ~every query. Replace with an explicit **grounding meta dict**.
- Freshness leaked: `_auto_recency` returns `"week"` for analyst/price-target asks; a live-grounded
  "is X a buy here" fires no time-sensitive intent. Both must be `time_sensitive`.
- The streaming log runs in an `async finally` on the **single shared event loop** (the 524 surface):
  it MUST be offloaded (`run_in_executor` / `anyio.to_thread`), never a bare sync write.
- Existing `/admin/stats` returns `top_users` keyed by raw `user_id` — drop that list.

### 9.2 Grounding meta (router change, additive)
`_uct_context` / `_grounded_system` return `(…, meta)` where
`meta = {grounding_sources:list, grounding_intents:list, regime_label, recency, had_live_price,
ctx_block, query_tickers, answer_tickers?}`. Each desk line tags its source as it is appended to
`parts`. The log wrapper reads **strictly from meta** — it never re-runs the regexes.

### 9.3 Schema — `ai_search_log` (final columns)
Identity/time: `id` PK · `answer_id` TEXT UUID (unique, returned to client) · `ts` UTC ISO ·
`day_et` · `session_bucket` (premarket/regular/power/afterhours/overnight/weekend) · `endpoint`
(single|stream).
Question: `query` · `query_norm` · `question_type` (rule-based taxonomy) · `first_person` (0/1).
Answer: `answer` · `answer_kind` (ok/refused/data_limited/empty/error/incomplete) · `answer_hash`
(sha256) · `answer_chars` · `mode` (effective) · `model` (concrete sonar-*) · `fallback_used` (0/1).
Freshness gate: `recency` (day/week/none, raw `_auto_recency`) · `freshness` (evergreen|time_sensitive)
· `classifier_version` INT.
Grounding provenance: `grounded_sources` JSON · `grounding_intents` JSON · `regime_label` ·
`had_live_price` (0/1) · `grounding_context` (≤2600 char injected block) · `cached` (0/1).
Entities: `query_tickers` JSON · `answer_tickers` JSON (from the answer's forced `[Display]($SYM)`
links) · `primary_ticker` · `primary_sector` · `primary_themes` JSON (point-in-time).
Sources: `citations_json` JSON (URL list) · `citation_count` (derived) · `related_questions` JSON ·
`domain_pack`.
Perf/cost: `elapsed_ms` · `error` · `units`.
Threading (anon): `conversation_id` (random, client-minted per widget session — NOT user id) ·
`turn_index` · `has_history` (0/1).
Privacy/curation: `user_bucket` (HMAC, see 9.6) · `pinned` (0/1) · `excluded` (0/1) · `capture_version` INT.
Indexes: `day_et`, `ts`, `freshness`, `answer_id`, `primary_ticker`.

Sibling table `ai_search_feedback(id, answer_id, kind, ts)` — kind ∈ save|share|copy|pin|exclude|helpful.

### 9.4 Classifier (rule-based, free, `classifier_version`)
- `freshness`: **time_sensitive** if `recency ∈ {day, week}` OR grounded on a live quote/patterns/
  flow/movers; **evergreen** only on a positive evergreen signal (concept/definition/history/
  company-profile) AND no live grounding; **default ambiguous → time_sensitive**.
- `question_type`: why-move / valuation / compare / setup-technical / macro / catalyst-news /
  concept-education / idea-screen / options-flow / portfolio-risk — reuse `_REASONING_RE`,
  `_FAST_RE`, `_FUNDAMENTALS_RE`, `_WHY_MOVE_RE`, `_INTENT_SPECS`.
- `first_person`: regex — "my position/shares/cost basis", "I bought/own/holding/sold", "should I",
  + email/phone/account-number patterns.

### 9.5 Wiring (both endpoints)
- Mint `answer_id = uuid4` per answer; return it (single-shot dict + streaming `meta`/`final` events).
- Single-shot `ai_search` (sync def, in the anyio threadpool): direct `ai_search_log.log(...)`.
- Streaming `ai_search_stream`: hold one `captured_final` updated at BOTH the normal `final` event
  AND the inline reasoning→fast fallback final; log **exactly once** in `finally` via
  `run_in_executor(None, log, …)`. If cancelled before any final → `answer_kind='incomplete'`.
- `AiSearchIn` gains `answer_id?`-none, `conversation_id?`, `turn_index?`, `history` (existing).

### 9.6 Privacy (de-identified, not "anonymized")
- No `user_id` stored. `user_bucket = HMAC(PUSH_SECRET, user_id + day_et)` — keyed (unbrute-forceable
  vs the member table), day-rotating, redeploy-stable. The salt/secret is NEVER written to the log DB
  (tested).
- `first_person` flag surfaces personal content. **Phase-2 retrieval MUST gate on
  `non-first_person AND non-time_sensitive AND cited AND non-excluded`** (documented; cross-member
  reuse is an explicit future owner go/no-go).
- **Retention:** nightly/self-heal prune of `time_sensitive` rows older than `AI_SEARCH_LOG_RETENTION_DAYS`
  (default 60); evergreen + curated (`pinned`) rows kept. Request-driven self-heal (throttled) so no
  scheduler/main.py change.
- **Disclosure:** one plain line near the AI Search box / disclaimer — "questions are retained
  de-identified to improve the research desk."

### 9.7 Admin + signals
- One panel `AiSearchInsightsPanel.jsx` on `/admin`, built as a `.healthSection` (Admin.module.css,
  mirroring `TwitterAccountsPanel` — SWR, statsGrid, analyticsBar, activityList; NO TileCard, NO
  ECharts, NO new stylesheet). Aggregate-first: KPI strip + freshness split as the hero (gold vs
  info-blue, red reserved for error), Top Questions + Top Tickers side-by-side, collapsible recent
  rows (freshness/mode badges, answer snippet with `[Display]($SYM)` stripped, NO identity), Today/7d/
  30d selector, explicit loading/empty/flag-off/error states.
- `GET /api/ai-search/admin/log?days=&limit=` (admin) → `insights()`. Fix `/admin/stats`: drop
  `top_users`. Fold both into the one panel with labeled "Today · live" vs "All-time · window" lanes.
- `POST /api/ai-search/signal {answer_id, kind}` (best-effort, swallow-all) → `ai_search_feedback`.
  Wire the widget's existing **Save** and **ShareToFloor** to also emit a signal, and add admin
  **pin/exclude** row buttons.

### 9.8 Hardening + tests (no-migration promise)
- Additive columns ONLY; `_ensure_init` checks `PRAGMA table_info` and auto-`ALTER ADD`s a
  fewer-column DB; column-explicit named INSERTs (never positional); length caps.
- Tests add: streaming logs **exactly once**; the fallback-final is the logged answer; **response
  bytes identical with logging on vs off** (invariance); fewer-column DB auto-migrates on init; the
  salt is stable across a simulated same-day redeploy and never persisted; classifier freshness/
  question_type/first_person cases; `/admin/log` shape + admin-gating; `/signal` records.

### 9.9 Explicitly dropped (per synthesis)
Net-new member thumbs UI · LLM freshness classifier · Phase-2 processing-state columns
(`embedded_at`, eligibility gate) · `asker_role` · per-answer consent banner/opt-out · ECharts/
Recharts/new-CSS/TileCard for the panel · any retrieval/embedding/synthesis (Phases 2–3).
