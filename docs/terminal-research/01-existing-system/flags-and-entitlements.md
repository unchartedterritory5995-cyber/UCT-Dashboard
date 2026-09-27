---
id: D-10
title: Feature flags and entitlements — current state
role: Feature flags and entitlements specialist
wave: 1
group: D
category: internal-system
scope: uct-dashboard worktree (branch terminal-research) — api/, app/src/, docs/feature_flags.json, tools/
confidence: 🟢 high on code shape; 🟡 on production flag state
evidence_ceiling: No Railway read was performed (contract did not authorise `railway variables`), so every statement about which flags are SET in production is CLAIM-from-ledger, not CONFIRMED. The ledger's own `where` field is a placeholder on all 86 armed entries.
sources: docs/feature_flags.json, api/services/feature_flag_index.py, tests/test_feature_flag_ledger.py, tools/flag_ledger_audit.py, app/src/components/AuthGuard.jsx, app/src/context/AuthContext.jsx, api/middleware/auth_middleware.py, api/routers/auth.py, api/services/{trial,entitlements,stripe_service,auth_db,auth_service}.py, api/auth_surface_check.py, api/routers/render_panels.py, api/services/journal_two/coach_chat.py, api/routers/voice.py, app/src/components/StockChart.jsx, docs/decisions/2026-08-08-toolkit-gating-axes.md
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-10 — Feature flags and entitlements, current state

**One-line finding.** The flag system is a single mechanism — a plain Railway environment variable read at call time by Python — held honest by an AST-derived ledger that covers only the `*_ENABLED`-shaped subset of server flags; there is **no per-user or per-cohort feature-flag mechanism anywhere except one hard-coded email allowlist for Compass**, no runtime admin toggle for any flag, and no server→client flag channel, so a TERMINAL-NEXT dark beta targeted at named internal users has no existing rail to ride.

**Vocabulary note.** Nothing in this report describes TERMINAL-NEXT, which does not exist in the code. TERMINAL-CURRENT (route `/calendar`) is gated exactly like every other paid page and carries no flag of its own.

---

## 1. The flag system

### 1.1 How a flag is defined and read

**OBSERVATION.** There is exactly one server-side flag mechanism: a process environment variable, read through `os.getenv(...)`, `os.environ.get(...)`, or `os.environ[...]`. There is no settings table, no database-backed flag store, no remote-config service, and no per-user flag row. On Railway a flag is a service variable; `railway variables --set` stages a value and a redeploy applies it, so **every flag flip is a deploy-latency operation, not a runtime one** — with two exceptions noted in §6.

Read timing splits into two classes and the difference matters operationally:

| read timing | example | consequence |
|---|---|---|
| **call time** (inside the function) | `waitlist.coming_soon_mode()` reads `COMING_SOON_MODE` per call; `trial._trial_enabled()` reads `J2_TRIAL_ENABLED` per call | a variable change takes effect on the next request after the process restarts |
| **import time** (module top level) | `api/routers/auth.py:104` builds `ADMIN_EMAILS` at import; `api/services/stripe_service.py:20,24` bind `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_ANNUAL` at import | the value is frozen for the life of the process; nothing can re-read it |

**EVIDENCE.** `api/services/feature_flag_index.py:47-77 _env_name()` enumerates the three read forms the scanner recognises, plus a fourth idiom (`(os.getenv("X") or "1")`) handled in `visit_BoolOp`. `api/routers/waitlist.py:34-40 coming_soon_mode()` carries an in-file comment stating it is read at call time "so tests and a Railway variable change both take effect without a code change". CONFIRMED by reading the source.

**INTERPRETATION.** The mechanism is as simple as it can be, which is a genuine strength — there is no flag service to be down. The cost is that a flag is only as granular as a process: one value per service, for everybody on it.

**RELEVANCE TO UCT.** A TERMINAL-NEXT beta gated this way is all-or-nothing per pod. "Internal users only" cannot be expressed by the primitive; it has to be expressed by code that reads the user, and only one such code path exists today (§5).

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** Any new TERMINAL-NEXT gate should be read at call time, not import time, so an emergency flip needs only a restart rather than a code change.

**OPEN QUESTION.** Does the owner want flag flips to remain deploy-coupled, or is a runtime kill switch (persisted, admin-toggled) part of the beta requirement?

### 1.2 The AST index that derives the gate list

**OBSERVATION.** `api/services/feature_flag_index.py` walks the Python AST of `api/`, `scripts/` and `tools/` and returns every env name the code actually reads, with the literal default where one is visible. `is_gate()` narrows that to feature gates using the predicate `"ENABLED" in name or "DISABLE" in name or name.endswith("_ON")`. `needs_declaration()` narrows again to gates that are OFF unless something sets them (including gates whose default the AST cannot see, which land in the ambiguous bucket deliberately).

**EVIDENCE.** Measured on this box, 2026-09-02, by importing the module and running `ffi.gates(ffi.repo_roots(REPO), REPO)`:

- **209** env names matched the gate predicate.
- **104** of those need a ledger declaration (off-unless-set, or default not statically visible).
- **104** entries exist in `docs/feature_flags.json` — the two sets agree, i.e. the ledger is currently complete and non-stale. CONFIRMED (I executed the derivation; the same computation is what the test asserts).

**INTERPRETATION.** The derivation is genuinely derived, not typed, and it carries its own control test for the four read idioms. It is the most trustworthy artifact in this area.

**RELEVANCE TO UCT.** A TERMINAL-NEXT flag named `*_ENABLED` is picked up automatically and cannot merge undeclared. A flag named anything else is invisible (§2.3).

**CONFIDENCE.** 🟢 high — I ran it.

**RECOMMENDATION.** Name the TERMINAL-NEXT gate `TERMINAL_NEXT_ENABLED` (or `..._ENABLED` suffixed) purely so the existing rail catches it. Naming it `TERMINAL_NEXT_MODE` would put it outside the only inventory that exists.

**OPEN QUESTION.** None.

### 1.3 The ledger — status vocabulary and full current content

**OBSERVATION.** `docs/feature_flags.json` has a `_readme` block and a `flags` object. The status vocabulary is **`armed` / `dark` / `pending`** — note that the contract's "undecided" is not a value; `pending` is the word. Definitions, quoted from `_readme`:

- `armed` = set on at least one Railway service (its value is the decision)
- `dark` = deliberately off; note MUST say why
- `pending` = built, no decision yet; note + `since` MUST be present

Current census: **104 entries — 86 armed, 13 pending, 5 dark.**

**EVIDENCE.** `docs/feature_flags.json:1-19` (`_readme`), counted by parsing the file 2026-09-02. CONFIRMED.

#### 1.3.1 The 18 entries that are not armed (full text, notes abridged)

| flag | status | since | note (abridged — full text in the ledger) |
|---|---|---|---|
| `BARS_HISTORY_ORIGIN_ENABLED` | dark | — | Off until a **named cutover** (Phase 5 edge-deep-history). Worker serves edge-cacheable sealed history so Cloudflare can cache deep history without web holding 20 GB (the 2026-08-31 OOM class). Read-only. Arm **with** `BARS_HISTORY_PROXY_ENABLED`, never alone. Declared by a passer-by, not its author. |
| `BARS_HISTORY_PROXY_ENABLED` | dark | — | Same cutover; **half a switch** — `api/routers/bars.py` routes to the worker origin only when this is `1` **and** `BARS_HISTORY_ORIGIN_URL` is set, so arming it alone changes nothing. One decision, two variables. |
| `BUZZ_DIGEST_ENABLED` | dark | — | Ships disarmed by design. `api/services/discord_buzz_digest.py` docstring: "posting into a 750-member room is the owner's call, not a default." Scheduler job always registers and `run_digest()` self-checks the flag, returning `{posted: False, reason: 'disarmed'}`. |
| `HISTORY_PREWARM_ENABLED` | dark | — | Off awaiting a **named prerequisite**: activate only after Cloudflare Tiered Cache + Cache Reserve are confirmed on. With Cache Reserve off the universe sweep reaches the origin instead of the edge. Cloudflare state is not visible from repo or Railway. |
| `PERMANENT_DAILY_FRESHNESS_ENABLED` | dark | — | Author stated intent in two places (commit `b6338dce` title "…(dark)" + block comment in `bars_prewarm.py`). When armed, the worker re-warms the **whole** universe's daily bars once per completed session: full-universe fetch + bars.db rewrite + whole-db R2 snapshot. Cost concentrated in the first armed run. |
| `INSTANT_UNIVERSE_ENABLED` | pending | 2026-09-01 | Pending **and the difference from dark is deliberate**: the code comment explains the *shape* (boot-only D/W/M pass so intraday stays bound to the active set — "no 26k intraday blow-up") but gives no reason it is OFF. Decide: arm on worker, or mark dark with a reason. |
| `INDICATOR_VISION_ENABLED` | pending | 2026-08-30 | Screenshot-to-indicator. Shipped 2026-08-29 but **arrived UNMOUNTED** — arming the flag alone may not surface it; check the mount before flipping. |
| `SCAN_LIVE_SWEEP_ENABLED` | pending | 2026-08-30 | Built and tested during the 2026-08-29 Scanner Hub consolidation, never armed. Decide: arm, or retire with the two tabs it was built beside. |
| `CATALYST_AV_NEWS_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `COMPASS_HEALTH_EMAIL_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `DEEP_CACHE_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `EARNINGS_PREWARM_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `FLOW_PRUNE_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `FLOW_REST_BACKFILL_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `FMP_BULK_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `OI_MORNING_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `SCREEN_BACKTEST_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |
| `STANDING_FLOW_ENABLED` | pending | 2026-08-30 | **No rationale on record.** |

"No rationale on record" is the ledger's own boilerplate for a gate it could only record as undecided: *"Off by default and set on no service, so it is currently indistinguishable from forgotten. Decide: arm, or mark dark with the reason."* **Ten of the thirteen pendings carry that boilerplate and have carried it since 2026-08-30**, i.e. the ledger has surfaced the ambiguity and nobody has resolved it.

#### 1.3.2 The 86 armed entries

`AI_SEARCH_DOSSIER_ENABLED`, `AI_SEARCH_MEMORY_ENABLED`, `AI_SEARCH_PERSONAL_ENABLED`, `ALERT_SHADOW_ENABLED`, `ALPHA_GOLD_EOD_ENABLED`, `AUTHDB_BACKUP_ENABLED`, `AWARENESS_ENGINE_ENABLED`, `BARSPACK_ENABLED`, `BARSPACK_WEB_INGEST_ENABLED`, `BARS_PREWARM_ENABLED`, `BARS_UNIVERSE_CRAWLER_ENABLED`, `BRAIN_PACK_ENABLED`, `BRAIN_TOOLS_ENABLED`, `BREADTH_HISTORY_BACKFILL_ENABLED`, `BREADTH_WICKS_ENABLED`, `BROKER_SYNC_ENABLED`, `CALENDAR_ALERTS_ENABLED`, `CALENDAR_WEEK_POST_ENABLED`, `CALL_RECAP_WARM_ENABLED`, `CATALYST_CURATOR_ENABLED`, `CATALYST_DIGEST_ENABLED`, `CATALYST_ENGINE_ENABLED`, `CATALYST_HUNTER_ENABLED`, `CATALYST_MUSTKNOW_ALERTS_ENABLED`, `CATALYST_RATINGS_SIGNAL_ENABLED`, `COMMUNITY_ASK_ENABLED`, `COMMUNITY_CHAT_ENABLED`, `COMMUNITY_ENABLED`, `COMMUNITY_SIGNALS_ENABLED`, `COMPASS_AUTOMATION_ENABLED`, `COMPASS_EOD_RECAP_ENABLED`, `COMPASS_WEEKLY_DIGEST_ENABLED`, `DARKPOOL_BIGBLOCK_ENABLED`, `DARKPOOL_EOD_ENABLED`, `DARKPOOL_FLATFILE_ENABLED`, `DARKPOOL_INTRADAY_ENABLED`, `DARKPOOL_INTRADAY_TIERED_ENABLED`, `DARKPOOL_MASSIVE_INGEST_ENABLED`, `DARKPOOL_RECORDS_ENABLED`, `DEEP_HISTORY_WARM_ENABLED`, `DESK_BACKGROUND_AUDIO_ENABLED`, `DESK_DAILY_SESSION_ENABLED`, `DESK_SESSION_CHAPTERS_ENABLED`, `DESK_SESSION_DISCORD_RECAP_ENABLED`, `DESK_TSDR_ANNOUNCE_ENABLED`, `DISCORD_INDEX_CLOSE_ENABLED`, `EXCURSION_ENGINE_ENABLED`, `EXPOSURE_GATE_WATCH_ENABLED`, `FLOW_BACKUP_ENABLED`, `FLOW_GAP_AUTOFILL_ENABLED`, `FLOW_OPT_AGG_ENABLED`, `FLOW_READS_PROXY_ENABLED`, `FUNDAMENTALS_MONITOR_ENABLED`, `FUNDAMENTALS_WARM_ENABLED`, `GROUPS_SWING_GATES_ENABLED`, `IMPLIED_STORE_ENABLED`, `INTRADAYPACK_ENABLED`, `J2_ATTACHMENT_BACKUP_ENABLED`, `J2_ATTACHMENT_GC_ENABLED`, `J2_SHARE_LINKS_ENABLED`, `LIVEFLOW_MONITOR_ENABLED`, `MASSIVE_CURATED_STREAM_ENABLED`, `MASSIVE_RESTHEAL_ENABLED`, `MASSIVE_STREAM_ENABLED`, `MASSIVE_WS_ENABLED`, `NHNL_SCANNER_ENABLED`, `NOTE_SYNC_ENABLED`, `OI_MASSIVE_ENABLED`, `PROVIDER_COVERAGE_MONITOR_ENABLED`, `R2_RECOVERY_ENABLED`, `RATINGS_PERCENTILE_ENABLED`, `SCAN_SWEEP_ENABLED`, `SCREENER_ANALYST_PASS_ENABLED`, `SCREENER_LIVE_TIER_ENABLED`, `SNAPSHOT_DELTA_ENABLED`, `STREAM_BARS_ENABLED`, `THEME_ENGINE_ENABLED`, `TRADE_CONDITION_FILTER_ENABLED`, `TRANSCRIPT_INDEX_ENABLED`, `TRANSCRIPT_KEYWORD_ALERTS_ENABLED`, `TWITTERAPI_IO_ENABLED`, `VOLUME_PUSH_ENABLED`, `VOLUME_SCANNER_ENABLED`, `WEEKLY_FLOW_ENABLED`, `WIRE_ENABLED`, `WORKER_ENABLED`.

**EVIDENCE.** Parsed from `docs/feature_flags.json` 2026-09-02. Every armed entry has `note: ""` and `where: ["(set — service not captured)"]`. CONFIRMED.

**INTERPRETATION.** 🔴 **The `where` field is a placeholder on all 86 armed entries** — the ledger records *that* a flag is set somewhere but not *on which of the three services* (`web`, `worker`, `flow-worker`). During an incident, "which service do I unset this on" is the question, and the ledger cannot answer it; `tools/flag_ledger_audit.py` can, but only with the Railway CLI on PATH.

Also note the `armed` semantic: it means "a variable with that name exists", **not** "the feature is on". `PATTERN_VISION_ENABLED=0` — the ledger's own worked example of a deliberate retirement — would be recorded as `armed` if it were in scope at all (it is not; see §2.2).

**RELEVANCE TO UCT.** A TERMINAL-NEXT kill switch declared `armed` in this ledger would tell a responder nothing about where to pull it. That is a beta-readiness gap, not a hypothetical.

**CONFIDENCE.** 🟢 high on the file contents; 🔴 low on whether any given `armed` entry is still true in production — **EVIDENCE CEILING: no Railway read was performed.** `railway variables --service <s> --kv` (read-only) piped to print key names would raise this to CONFIRMED.

**RECOMMENDATION.** Backfill `where` for at least the flags that gate member-visible behaviour, and for any TERMINAL-NEXT flag from day one.

**OPEN QUESTION.** When was `tools/flag_ledger_audit.py` last run against live Railway, and did it exit 0?

### 1.4 The test that fails by name

**OBSERVATION.** `tests/test_feature_flag_ledger.py` holds the ledger to the derivation with five tests:

| test | what it fails on |
|---|---|
| `test_every_off_by_default_gate_is_declared` | a new off-by-default gate merged with no ledger entry — **fails BY NAME**, printing the flag, its default and its first site |
| `test_the_ledger_does_not_describe_gates_that_no_longer_exist` | a ledger entry for a gate the code no longer reads off-by-default |
| `test_each_entry_states_a_real_decision` (parametrised per flag) | invalid status; `dark`/`pending` note shorter than 20 chars; `pending` with no `since` |
| `test_the_derivation_reads_every_form_the_codebase_actually_uses` | control — the four env read idioms are all caught, so the rail above cannot pass vacuously |
| `test_an_undeclared_gate_is_actually_caught` | control — the rail actually fires on a synthetic undeclared gate |

**EVIDENCE.** `tests/test_feature_flag_ledger.py:49-143`. CONFIRMED by reading; not executed (contract forbids running the suite).

**INTERPRETATION.** This is a well-built rail with its own non-vacuity controls — unusual and worth copying. Its stated limitation is explicit in the docstring: *"it has no network, so it cannot know what Railway actually has set. It enforces that a decision is WRITTEN, not that the written decision is true."*

**CONFIDENCE.** 🟢 high.

### 1.5 The audit tool — the half that looks

**OBSERVATION.** `tools/flag_ledger_audit.py` shells out to the Railway CLI (`railway variables --service <s> --kv`, read-only, does not redeploy), across the three services `("web", "worker", "flow-worker")`, and reports four buckets: `claims_armed_but_unset` (the entry is fiction), `claims_off_but_set` (someone decided and did not write it down), `undeclared` (the suite should already be red), and `still_pending`. **Exit 0 = agreement, 1 = drift, 2 = "did not look"** — a deliberately distinct code, because an unreachable CLI once made an early run report all 86 armed entries as fiction. `_vars_for()` raises `RailwayUnavailable` rather than returning an empty set for exactly that reason.

**EVIDENCE.** `tools/flag_ledger_audit.py:37-60 _vars_for()`, `:96-129 main()`. CONFIRMED by reading.

**INTERPRETATION.** The failure-mode reasoning here (a failed fetch is `None`, never an empty list) is the strongest single idea in this subsystem and should be inherited by any TERMINAL-NEXT health check.

**CONFIDENCE.** 🟢 high (code). 🔴 on its current output — not run.

### 1.6 Client-side flags — and the ledger's blind spot

**OBSERVATION.** The SPA has fourteen `VITE_*` names. Vite inlines `import.meta.env` **at build time**, so each is a compile-time constant baked into the bundle; changing one requires a frontend rebuild and redeploy, not just a variable change.

| VITE flag | what it gates | default when unset |
|---|---|---|
| `VITE_COMING_SOON` | pre-launch holding page; wraps `/landing`, `/pricing`, `/compare`, `/brokers`, `/signup`, `/subscribe` in `<PreLaunchGate>` | off (`=== '1'`) |
| `VITE_TWITTER_UI_ENABLED` | 🐦 tweet surfaces on MoversSidebar / TapeFeed / MorningWire | **on** (`?? '1') !== '0'`) |
| `VITE_CATALYST_UI_ENABLED` | the Stock Catalysts tile | **on** |
| `VITE_REALTIME_BARS` | the Massive bars-push subscription inside `useRealtimeBars` | off (`=== '1'`) |
| `VITE_GRID_WARM_ENABLED` | multi-chart grid warm parity | **on** (`!== '0'`) |
| `VITE_DESK_BG_AUDIO_ENABLED` | Desk background audio layer | off (`=== '1'`) |
| `VITE_MASSIVE_STREAM` | Live Flow SSE instant tape | off (`=== '1'`) |
| `VITE_MASSIVE_CURATED_STREAM` | curated stream variant | off |
| `VITE_CHART_RENDER_TOKEN` | the token the headless `/r/*` render pages send | — (credential, see §4.4) |
| `VITE_DISCORD_CHART_APP_ID`, `VITE_PICOVOICE_ACCESS_KEY`, `VITE_WS_HOST`, `VITE_LAUNCH_DATE`, `VITE_CONFIG` | configuration, not gates | — |

**EVIDENCE.** `app/src/utils/comingSoon.js:21`; `app/src/components/MoversSidebar.jsx:20`; `app/src/components/tiles/CatalystTable.jsx:16`; `app/src/hooks/useRealtimeBars.js:21`; `app/src/pages/charts/grid/MultiChartGrid.jsx:295`; `app/src/components/video/GlobalVideoLayer.jsx:51`; `app/src/pages/LiveFlowMassive.jsx:55`; `app/src/pages/BookRender.jsx:16`. CONFIRMED.

**INTERPRETATION.** 🔴 **Every one of these is outside the ledger.** `feature_flag_index.repo_roots()` returns `[repo/api, repo/scripts, repo/tools]` and parses only `*.py`; no `VITE_*` name appears in `docs/feature_flags.json`. So the entire client half of the flag surface — including the two flags that decide whether the public front door is a holding page and whether the bars-push feed engages — has no ledger, no rail, and no audit. The ledger's premise ("a gate that ships off and is set nowhere is indistinguishable from one that is off on purpose") applies verbatim to fourteen flags it cannot see.

**How the SPA learns any flag state.** There is **no server→client feature-flag endpoint**. A grep for a `config`/`features`/`flags` GET route finds only `alert_tester.py:695 /configs`, `live_massive_router.py:5252 /auto-push-config` and `broker_sync.py:612 /dup-flags`, none of which is a flag payload. The four channels the SPA actually has are:

1. build-time `import.meta.env.VITE_*` (frozen at build);
2. `GET /api/auth/me` → `{user: {id, email, role, email_verified, …}, plan, subscription, trial, paid_equiv, billing}` (`api/routers/auth.py:268-280` + `_access_payload` at `:109-130`);
3. ad-hoc per-feature endpoints — `GET /api/maintenance` is the only true example (`api/main.py:6743`);
4. HTTP status from the API itself (402 from `require_paid`, 403 from `require_admin`).

**RELEVANCE TO UCT.** A TERMINAL-NEXT beta that needs the SPA to know "you are in the beta" has nothing to read today except role and plan. Channel 2 is the natural place to add one field; see §5 and §8.

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** If TERMINAL-NEXT needs a client-visible gate, put it in `_access_payload` (one dict, already on every auth response, already the single source the frontend's `isPaid` derives from) rather than adding a fifteenth `VITE_` constant — a `VITE_` flag cannot be flipped per user and cannot be flipped without a rebuild.

**OPEN QUESTION.** Should `feature_flag_index` be widened to parse `app/src` for `import.meta.env.VITE_*`, so the ledger covers both halves? (That is a one-visitor change to `repo_roots` plus a JS parse path, not a redesign.)

---

## 2. Kill switches and rollback flags in force

### 2.1 The named ones

| flag | what it gates | default in code | ledger status | file:line |
|---|---|---|---|---|
| `LLM_BATCH_ENABLED` | LLM batch submission; `"0"` makes every `submit()` synchronous | **`"1"` — on** | **absent** (on-by-default gates need no entry) | `api/services/llm_batch.py:52` |
| `SCAN_LIVE_SWEEP_ENABLED` | the live scan sweep in the screener evaluator | `"0"` — off | `pending` since 2026-08-30 | `api/services/screener/scan_evaluator.py` |
| `PATTERN_VISION_ENABLED` | the pattern-vision job in `main.py` | **`"1"` — on** | **absent** | `api/main.py:2315` |
| `DESK_PUBLIC_SHOWS` | which Desk shows upload to YouTube **public** (default `sunday scans`); blank ⇒ nothing public | allowlist string | **absent — not gate-shaped** | `api/services/desk_daily_session.py:113` |
| `DESK_TSDR_ANNOUNCE_SHOWS` | which shows announce to the public Discord (default `evening update`); blank ⇒ nothing announced | allowlist string | **absent — not gate-shaped** | `api/services/desk_session_announce.py:88` |
| `COMPASS_MENTOR_MODE` | the two-lane mentor persona; `0`/`admin`/`beta`/`1` | `"0"` | **absent — not gate-shaped** | `api/routers/voice.py:1132`, `api/services/journal_two/coach_chat.py:52` |
| `COMING_SOON_MODE` | server half of the pre-launch gate; blocks signup | unset ⇒ off | **absent — not gate-shaped** | `api/routers/waitlist.py:34-40` |
| `J2_TRIAL_ENABLED` | the 7-day trial honouring path | **`"1"` — on** | **absent** | `api/services/trial.py:57-60` |
| `WIRE_SUBSTACK_GATE_MODE` | — | — | **not present in this repo at all** (0 hits across `api/`, `scripts/`, `tools/`) | lives in `C:\Users\Patrick\morning-wire` |

**EVIDENCE.** All rows verified by grep + the AST scan output on 2026-09-02. CONFIRMED for the code; the ledger column is CONFIRMED against the file.

### 2.2 🔴 The `PATTERN_VISION_ENABLED` contradiction

**OBSERVATION.** Both `api/services/feature_flag_index.py:7` and `docs/feature_flags.json:12` cite `PATTERN_VISION_ENABLED=0` as *the* worked example of a deliberate retirement — the reason the whole ledger exists. But the code reads `os.environ.get("PATTERN_VISION_ENABLED", "1") != "1"`, i.e. it **defaults ON**. The retirement therefore exists only as an explicit `=0` on Railway, which the repo cannot see; and because `needs_declaration()` excludes on-by-default gates, the flag has **no ledger entry**, so the one decision the ledger was built to preserve is the one decision it does not record.

**EVIDENCE.** `api/main.py:2312-2315`; `api/services/feature_flag_index.py:7`; `docs/feature_flags.json:12`. CONFIRMED (source read).

**INTERPRETATION.** This is the ledger's own defect class turned inward. `needs_declaration()`'s reasoning — "a gate on by default is self-evidently a live decision" — is sound for a gate nobody has turned off, and wrong for a gate somebody has deliberately turned off. **An on-by-default gate that is explicitly set to `0` in production is exactly as ambiguous as an off-by-default gate that is set nowhere**, and the ledger covers only the second case.

**RELEVANCE TO UCT.** If TERMINAL-NEXT ships behind an on-by-default flag and is later disabled by setting it to `0`, that decision will be invisible to the ledger and to the test, and the next engineer will read the code default and conclude the feature is live.

**CONFIDENCE.** 🟢 high on the contradiction; 🔴 on whether `PATTERN_VISION_ENABLED=0` is actually set on Railway today — **EVIDENCE CEILING: no Railway read.** One read-only `railway variables --service web --kv` would settle it.

**RECOMMENDATION.** Widen the ledger's obligation from "off-unless-set" to "off-unless-set **or** explicitly set to an off-value in production". The audit tool already reads the values it would need; only the classification changes.

**OPEN QUESTION.** Is the patterns engine actually retired in production, or has the default silently kept it running since the 15.7%-precision decision?

### 2.3 The gate predicate's blind spot

**OBSERVATION.** `is_gate()` matches only names containing `ENABLED` or `DISABLE`, or ending `_ON`. Six real production kill switches are therefore invisible to the entire ledger/test/audit apparatus because they are **allowlists or modes rather than booleans**: `DESK_PUBLIC_SHOWS`, `DESK_TSDR_ANNOUNCE_SHOWS`, `COMPASS_MENTOR_MODE`, `COMPASS_MENTOR_BETA_EMAILS`, `COMING_SOON_MODE`, `ADMIN_EMAILS`.

Two of those are the highest-consequence switches in the product: `DESK_PUBLIC_SHOWS` decides whether a **paywalled** trading session becomes a public YouTube video, and `DESK_TSDR_ANNOUNCE_SHOWS` decides whether it is announced into a public Discord. Both are designed to fail safe (blank ⇒ nothing public / nothing announced), and both are rail-tested in their own suites — but neither appears in the flag inventory.

**EVIDENCE.** `api/services/feature_flag_index.py:32-40`; `api/services/desk_daily_session.py:104-113`; `api/services/desk_session_announce.py:88`. CONFIRMED.

**INTERPRETATION.** The comment above `_GATE_MARKERS` says "This predicate IS the definition — widen it and the ledger must grow to match, which is the point." That is honest, but it means the inventory's completeness is a naming convention, and the flags most likely to be named unconventionally are the ones that express a *cohort* rather than a *boolean* — precisely the shape a dark beta needs.

**RELEVANCE TO UCT.** If the TERMINAL-NEXT beta is expressed as an allowlist (`TERMINAL_NEXT_BETA_EMAILS`) — which §5 argues is the only shape that gives per-user targeting — it will be invisible to the ledger unless the predicate is widened or the flag is paired with a boolean `..._ENABLED` master switch.

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** Ship the beta as a **pair**: `TERMINAL_NEXT_ENABLED` (boolean master, ledger-visible, the kill switch) plus `TERMINAL_NEXT_BETA_EMAILS` (the cohort). This is exactly the `COMPASS_MENTOR_MODE` + `COMPASS_MENTOR_BETA_EMAILS` shape that already ships, and it keeps the kill switch inside the one inventory that has a rail.

### 2.4 Is "off-and-unset" distinguishable from "off-on-purpose" today?

**Partially, and only for one of four classes.**

| class | distinguishable? | by what |
|---|---|---|
| server gate, `*_ENABLED`-shaped, off by default | ✅ yes | the ledger entry is mandatory; `dark` requires a ≥20-char reason, `pending` requires a `since` |
| server gate, `*_ENABLED`-shaped, **on** by default but set to `0` in prod | ❌ no | no ledger entry is required (§2.2) |
| server gate, allowlist/mode-shaped | ❌ no | outside `is_gate()` (§2.3) |
| client `VITE_*` flag | ❌ no | outside the scanned roots entirely (§1.6) |

And even within the covered class, thirteen entries currently say in so many words that the decision has not been made.

---

## 3. User classes

### 3.1 How each class is represented

**OBSERVATION.** There is **no `tier` column and no `toolkit` column anywhere in the auth schema.** The `users` table has six columns at creation — `id, email, password_hash, display_name, role, created_at` — plus exactly four migrations: `email_verified`, `last_login_at`, `referral_code`, `full_name`. Plan lives on a separate `subscriptions` row.

| class | representation | file:line |
|---|---|---|
| **visitor** (logged out) | no session cookie; `validate_session` returns None → 401 | `api/middleware/auth_middleware.py:17-22` |
| **free member** | a `users` row with `role='member'` and either no `subscriptions` row or one whose `status` is not in `('active','trialing','comped')` → `get_user_plan` returns `"free"` | `api/services/auth_service.py:241-251` |
| **paid member** | `subscriptions.plan` ∈ `PAID_PLANS = {"pro","premium","lifetime"}` with an honoured status | `api/middleware/auth_middleware.py:68` |
| **annual** | **not a class.** `STRIPE_PRICE_ID_ANNUAL` and `STRIPE_PRICE_ID_PRO` both grant `plan="pro"`; annual is a billing cadence. `annual_available()` returns whether the annual price id is configured, and an "annual" checkout falls back to the monthly price when it is not | `api/services/stripe_service.py:20-30, 54-69, 200, 227, 247` |
| **trial** | derived, not stored: `trial.py` computes a 7-day window from `users.created_at`, but **only for accounts created before the 2026-07-13 no-card cutoff** (all such windows lapsed by 2026-07-20). Post-cutoff trials come from Stripe `subscription_data.trial_period_days=7`, surfacing as `status='trialing'` ⇒ `plan='pro'` | `api/services/trial.py:1-60`, `TRIAL_DAYS = 7` at `:29` |
| **comped** | `subscriptions.status='comped'`, granted by admin. Honoured in `get_user_plan`, in `require_plan`'s checker, and in admin stats | `api/services/auth_service.py:245-250`; `api/middleware/auth_middleware.py:44` |
| **admin** | `users.role == 'admin'`. Set from the `ADMIN_EMAILS` env var (comma-separated, read **at import**) **plus two email addresses hard-coded in the source**; auto-promoted at signup and again at login | `api/routers/auth.py:104-106, 151, 199` |
| **partner** | **does not exist as a user class.** "Partner-owned" in this repo means source-file ownership (Ravi's five files), not an entitlement | — |

**EVIDENCE.** `api/services/auth_db.py:17-35` (schema), `:527-545` (the four `ALTER TABLE users` migrations). CONFIRMED.

**INTERPRETATION.** Two of the eight rows are worth flagging. First, `PAID_PLANS` includes `"premium"` and `"lifetime"`, but the Stripe path never mints either — it writes `plan="pro"` in all three places. Those two strings are either legacy or manual-only; nothing in the checkout or webhook flow produces them. Second, `entitlements.toolkit_for()` reads `user["toolkit"]` — a key the users table does not have and no code writes — so it **always** falls through to `DEFAULT_TOOLKIT = "all"`. The module's own docstring anticipates this ("one toolkit ships, and the lookup is still real"), which is a defensible design, but it means the entitlement layer has a shape and no data.

**RELEVANCE TO UCT.** There is no existing column a TERMINAL-NEXT cohort could be written to. Adding one is a schema migration in `auth_db.py`; not adding one means the cohort lives in an env var.

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** If TERMINAL-NEXT introduces a real tier, put it on `subscriptions.plan` (the existing authority) or on the unused `toolkit` lookup — not on a new parallel field, which would create a second authority over "what is this user entitled to".

**OPEN QUESTION.** Are `premium` and `lifetime` live plans granted by hand, or dead strings that should be retired from `PAID_PLANS`?

### 3.2 🔴 Verdict on the two KNOWN FACTS the contract asked me to verify

**"`tier` is a badge" — MOSTLY WRONG as stated, and the correction matters.**

There is no field called `tier`. The client-facing analogue is `plan` + `paid_equiv` + `trial` in `_access_payload`, and those *are* presentational — they drive nav locking and the trial chip, and a member could trivially forge them in their own browser. But **the API enforces independently and heavily**:

| gate | handler-signature occurrences (grep count, `api/**`) |
|---|---|
| `Depends(get_current_user)` | 307 |
| `Depends(require_paid)` | 217 |
| `Depends(require_admin)` | 153 |
| `Depends(requires_voice_access)` | 54 |
| `Depends(get_current_user_with_plan)` | 46 |
| `Depends(limits_dependency)` | 8 |

So forging `paid_equiv` in the browser would unlock the nav and then produce a page of 402s — which is exactly the bug `app/src/pages/Traders.paywall.test.jsx` was written for: *"`/api/traders` is paid-gated and 55 routes were paywalled in the same pass, so a 402 on this surface is not hypothetical — it is what a free member gets."* **Server-side enforcement is real. The badge claim is only true of the presentation layer.**

**"The paywall covers the Morning Wire only" — INVERTED.**

`const FREE_PAGES = ['/morning-wire']` — Morning Wire is the **only free page**; every other route is paid. The in-file comment states it: *"Free tier: ONLY Morning Wire is accessible without a paid plan (owner decision 2026-07-19 — everything else is behind the paywall)."*

**EVIDENCE.** `app/src/components/AuthGuard.jsx:109-112`. CONFIRMED.

⚠️ **`CLAUDE.md`'s "Auth & User System" section is STALE on this point.** It claims *"Free tier: Dashboard, Breadth, Charts, Options Flow, Journal, Model Book accessible without payment"* — six pages that are all paid today. It also still says *"Signup flow does NOT redirect to Stripe"* and *"Stripe integration still intact … for future monetization"*, which reads as pre-monetisation while `/api/auth/checkout` and the 7-day card-required trial are live. Treat that CLAUDE.md section as a CLAIM that is now false in at least three particulars.

---

## 4. Route and API gating

### 4.1 `AuthGuard` — the client-side decision order

**OBSERVATION.** `app/src/components/AuthGuard.jsx` is a single `<Route element={<AuthGuard />}>` wrapper (`app/src/App.jsx:410`) around the protected route table. Its decisions, in order:

1. `loading || !maintenanceChecked` → `<BrandSplash>`; it fetches `GET /api/maintenance` on mount.
2. `maintenance && role !== 'admin'` → `<MaintenancePage/>` — **admins bypass maintenance mode.**
3. `!user && authTransient` → splash, plus a one-shot auto-retry pair at 4 s and 10 s. **A 5xx on `/api/auth/me` must never log anyone out** (the R2 stress repro, 2026-08-22).
4. `!user` → `/login`.
5. `!email_verified && role !== 'admin'` → `/verify-pending`. **Admins skip email verification.**
6. `pathname.startsWith('/admin') || pathname === '/alert-tester'` and not admin → bounce to `FREE_HOME`.
7. `/settings` and not `isPaid` → bounce (free users upgrade via the public `/subscribe`).
8. `/calendar` and not `isPaid` → `/research/:sym` if `?earnings=` validates as a ticker, else bounce. **TERMINAL-CURRENT stays paid; this only changes where a blocked visit lands.**
9. `/research/*` → allowed through; the page renders its own `PaywallTeaser` rather than hard-redirecting.
10. `/live-flow` / `/live-massive` → `isPaid` or bounce.
11. otherwise: `!isPaid && !isFreePage` → bounce to `/morning-wire`.

**EVIDENCE.** `app/src/components/AuthGuard.jsx:53-173`. CONFIRMED.

**INTERPRETATION.** Two distinct "blocked" idioms coexist deliberately: a **hard redirect** (most pages) and an **in-page teaser** (`/research/*`, `ScanResults`, `AnalogueDeckView`, `CatalystsSection`, `ProfileSection`, `ArticlesSection`, `ConciergeBox`, `ImageBox`). The teaser idiom is the one that converts; the redirect idiom is the one that is cheap.

**RELEVANCE TO UCT.** A TERMINAL-NEXT door added to this file needs one line, and the pattern for "let the page decide" already exists at step 9 — which is the right shape for a beta that wants to show non-cohort users a "coming soon" panel rather than bouncing them.

**CONFIDENCE.** 🟢 high.

### 4.2 `FREE_PAGES` has three copies

**OBSERVATION.** The same literal `['/morning-wire']` is declared in three files, each carrying a "Keep in sync with …" comment: `AuthGuard.jsx:112`, `NavBar.jsx:39`, `MoreSheet.jsx:70`. The only mechanical check is indirect — `app/src/pages/formulas/formulaLibrary.route.test.jsx:83` regexes the `const FREE_PAGES = [...]` line **out of AuthGuard only**, to assert a specific route is not in it.

**EVIDENCE.** grep over `app/src`. CONFIRMED.

**INTERPRETATION.** Three hand-synced copies of one value, with a comment as the enforcement — the second-authority-over-one-value shape this repo has paid for repeatedly. AuthGuard is the security-relevant copy; the other two are visibility only, so a drift shows up as a nav entry that bounces (or a hidden page that is actually reachable by URL), not as a privilege escalation.

**RECOMMENDATION.** If TERMINAL-NEXT adds a door, export `FREE_PAGES` from one module and import it in the other two rather than adding a fourth copy.

### 4.3 Admin-only routes and "admins see every route"

**OBSERVATION.** CONFIRMED at the nav layer, and by a mechanism worth naming precisely: `NavBar.jsx:64` and `MoreSheet.jsx:78` both compute `const showAll = isPaid`, and `AuthContext.jsx:171` defines `isPaid = user?.role === 'admin' || ['pro','premium','lifetime'].includes(plan) || trial`. **Admins see every route because admin implies paid-equivalent, not because of a separate admin branch.** Admin-*only* surfaces are a small set: the `/admin` prefix, `/alert-tester`, the Breadth "Analogues" tab (`Breadth.jsx:836-837`, `BreadthTabs({isAdmin})`, with a `useEffect` at `:943` that kicks a non-admin off the tab if it is somehow selected), the `?gridspike=N` perf harness, and 27 `role === 'admin'` checks across the JSX.

Server side, `require_admin` (`api/middleware/auth_middleware.py:54-58`) is the shared dependency; `api/routers/auth.py` additionally uses a local `_require_admin(user)` helper at 37 call sites.

**EVIDENCE.** CONFIRMED (source read).

**RELEVANCE TO UCT.** "Admin sees it" is already the de-facto first rung of every rollout ladder in this codebase, and it needs **no new mechanism** — `role === 'admin'` on the client, `require_admin` on the server. That rung of a TERMINAL-NEXT beta is free.

### 4.4 Endpoints reachable unauthenticated by design

| surface | gate | note |
|---|---|---|
| `GET /api/health` | none | deploy verification (uptime reset) |
| `GET /api/maintenance` | none | read by AuthGuard before auth |
| `GET /api/quote-of-the-day` | none (public) | per CLAUDE.md; feeds FuturesStrip + Substack |
| `/api/r/*` render data (`api/routers/render_panels.py`) | `CHART_RENDER_TOKEN`, constant-time compare, **fails closed when unset**, plus a per-bucket sliding-window rate limit (60/min default, separate bucket for `/r/buzz`) | 🔴 the module's own header says the token "is inlined into the frontend JS bundle, so treat these as **EFFECTIVELY PUBLIC**" — it returns a curated whitelist of fields (`_CATALYST_PUBLIC`) and deliberately withholds `raw_signals`, `score`, `signals_hash`, `thesis_model`, `thesis_sources` |
| `/r/*` SPA routes (`BookRender`, `BreadthRender`, `BuzzRender`, `CalendarRender`, …) | outside `AuthGuard`; `?token=` compared against `VITE_CHART_RENDER_TOKEN` | screenshotted logged-out by the chart renderer |
| `GET /api/admin/bars-stream-status` | documented "no-auth" | CLAIM (CLAUDE.md), not re-verified here |
| the `ALLOWED_OPEN` set in `api/auth_surface_check.py:118+` | gated **inline** rather than by `Depends()` — e.g. `POST /api/live/massive/stream-test` and `POST /api/flow-backup/run` compare a bearer against `PUSH_SECRET` in the handler body; five `api/routers/bars.py` admin handlers call `_check_admin_auth(request)` as their first statement | each entry carries a written reason and a named asserting test |

**OBSERVATION on the auditor.** `api/auth_surface_check.py` runs at boot on both pods and inspects the **live route objects** — not the source, not a probe — asking whether every mutating route carries one of `GUARD_NAMES = {require_flow_admin, require_flow_user, require_admin, get_current_user, verify_push_secret, require_paid}`. Its docstring explains why a probe was rejected: *"during this audit a probe of a mutating endpoint executed a real production job (8,108 contracts captured) before anyone intended it."* Proxied flow routes get a third bucket, `DELEGATED`, where web asks flow-worker over private networking whether it gates them — *"A delegation nobody can fail would be a suppression with better manners."*

⚠️ **`MUTATING = {"POST","PUT","PATCH","DELETE"}` — GET routes are not audited.** A read-only endpoint that leaks paid data to an unauthenticated caller would not be caught by this check.

**EVIDENCE.** `api/auth_surface_check.py:1-130`; `api/routers/render_panels.py:1-66`. CONFIRMED.

**RELEVANCE TO UCT.** TERMINAL-NEXT's read endpoints would be GETs, and GETs are the class this boot auditor does not cover.

**CONFIDENCE.** 🟢 high on the mechanism; 🟡 on completeness of the unauthenticated list — I enumerated by grep and by reading `ALLOWED_OPEN`, not by walking `api.main:app.routes`. **EVIDENCE CEILING:** importing the app and walking its routes (the technique the 2026-08-09 reachability audit used) would make this exhaustive; the contract's budget favoured breadth.

### 4.5 The coming-soon public gate

**OBSERVATION.** A **two-sided** flag: `COMING_SOON_MODE` on the server (read at call time; blocks `POST /api/auth/signup` with a 4xx) and `VITE_COMING_SOON` in the bundle (build-time; wraps `/landing`, `/pricing`, `/compare`, `/brokers`, `/signup`, `/subscribe` in `<PreLaunchGate>`). Deliberately **not** gated: `/login`, `/terms`, `/privacy`, password-reset and email-verify flows, and the token-gated `/r/*` renderers.

**EVIDENCE.** `api/routers/waitlist.py:34-40`; `app/src/utils/comingSoon.js`; `api/routers/auth.py:136-139`. CONFIRMED.

**INTERPRETATION.** This is the closest existing analogue to a TERMINAL-NEXT dark launch, and it demonstrates the asymmetry cleanly: the server half flips with a variable, the client half needs a rebuild. Its own comment claims "Launch day is one env change" — that is true only if the frontend is rebuilt in the same deploy, which on Railway it is.

**RECOMMENDATION.** Prefer the server half as the authority for TERMINAL-NEXT; let the client learn it from `_access_payload` rather than from a build constant, so a rollback does not need a rebuild.

---

## 5. Per-user targeting

### 5.1 What exists

**OBSERVATION.** Four mechanisms can narrow a feature to fewer than everybody. Only one of them targets **named users**.

| mechanism | granularity | where | can it name a user? |
|---|---|---|---|
| **`COMPASS_MENTOR_MODE` ladder** — `off → admin → beta → 1`, where `beta` = admins **plus** the `COMPASS_MENTOR_BETA_EMAILS` comma-separated allowlist, matched case-insensitively against `users.email` | named cohort | `api/routers/voice.py:1132-1138`; `api/services/journal_two/coach_chat.py:41-82` | ✅ **yes — the only one** |
| **`role === 'admin'`** | one class | client 27 sites; server `require_admin` ×153 | only "all admins" |
| **`BARS_PUSH_ROLLOUT_PCT`** — a source constant (currently `100`) compared against a stable per-browser bucket persisted in `localStorage['uct.barsPush.bucket']`; plus explicit per-browser opt-in/out via `localStorage['uct.barsPush.enabled']` and `window.__uctBarsPush(bool)` | percentage of **browsers**, not users | `app/src/components/StockChart.jsx:895-927` | ❌ no — anonymous buckets |
| **`POST /api/auth/admin/comp-access`** | one user | `api/routers/auth.py:714-729` | ✅ but it grants **paid**, not **beta** — the only per-user lever an admin has is the plan itself |

**EVIDENCE.** All four read from source. CONFIRMED.

The Compass ladder is worth quoting because it is the precedent:

> `"1"` → on for everyone · `"beta"` → on for admins + the `COMPASS_MENTOR_BETA_EMAILS` cohort · `"admin"` → on only for `users.role == "admin"` · anything else (including unset) → off. The rollout ladder (vision §7): off → admin → beta cohort → all-paid.
> — `api/services/journal_two/coach_chat.py:41-51`

⚠️ **It is implemented twice.** `voice.py` reads the env allowlist directly; `coach_chat.py` reads the same env through `_mentor_beta_emails()` and joins it against a `SELECT role, email FROM users`. Each file's comment says it "mirrors" the other. That is two authorities over one decision — the shape this repo repeatedly identifies as its most expensive defect class — and it is the reference implementation a TERMINAL-NEXT beta would otherwise copy.

**RELEVANCE TO UCT.** A dark beta of the form "flag → internal users → selected members" maps exactly onto this ladder's four rungs. The mechanism is proven in production on two surfaces. What is missing is a *shared* implementation and a *client-visible* answer.

**CONFIDENCE.** 🟢 high.

### 5.2 What is absent

- **No per-user feature-flag store.** No table, no column, no key convention. `entitlements.toolkit_for()` is the nearest thing and reads a `user["toolkit"]` key that the schema does not define (§3.1), so it always returns `"all"`.
- **No admin UI to toggle any flag.** `app/src/pages/Admin.jsx` (2,254 lines) issues 30+ admin fetches; **none of them touches a feature flag.** Its runtime levers are: maintenance mode, comp-access grant/revoke, force-verify, per-user CRM tags, per-user notes, password reset, delete, announcements, todos, support tickets, CSV export, Stripe check, subscription sync, Twitter accounts panel.
- **No server→client flag channel** (§1.6).
- **No cohort concept in the auth schema** — `role` is binary (`member`/`admin`).

**EVIDENCE.** grep over `app/src/pages/Admin.jsx` for `/api/` fetches; `api/services/auth_db.py:17-35,527-545`. CONFIRMED.

### 5.3 RECOMMENDATION — the smallest reliable enhancement (Part XXXIX)

*Observations, not requirements. This is a recommendation with code references; the decision is the owner's.*

**A per-user cohort store already exists and is read by no gate: `user_tags`.**

```
CREATE TABLE IF NOT EXISTS user_tags (…)          -- api/services/auth_db.py:182-190
                                                   -- indexed on both user_id and tag
add_user_tag / remove_user_tag / get_user_tags     -- api/services/auth_service.py:649, 663, 672
POST|DELETE /api/auth/admin/users/{id}/tags        -- admin-gated, already wired into Admin.jsx:659-673
```

Today `user_tags` is used only for admin list filtering (`auth_service.py:296` joins it in `list_users_filtered`) and appears in the admin user detail payload. Every piece a targeted beta needs is therefore already built: a durable per-user cohort store, an admin write path, an existing admin UI, an index on `tag`, and `log_activity` attribution on the admin action.

The smallest change that turns it into per-user targeting is roughly:

1. one helper in `api/services/auth_service.py` — `def has_tag(user_id, tag) -> bool` (the `get_user_tags` query already exists at `:672`);
2. one dependency beside `require_paid` — e.g. `require_beta("terminal-next")` in a new module or in `api/middleware/auth_middleware.py`, following the **existing** convention that `limits_dependency` established: *"a SECOND dependency beside `require_paid`, NEVER a replacement for it"* (`entitlements.py:293-305`), so a 402 keeps meaning one thing;
3. one field in `_access_payload` (`api/routers/auth.py:109-130`) — e.g. `"beta": ["terminal-next"]` — which reaches the SPA on every auth response with no new endpoint;
4. one master kill switch, `TERMINAL_NEXT_ENABLED`, so the ledger and its test cover the feature and the rollback is an env change (§2.3).

⛔ **Do not use `user_preferences` for this.** `POST /api/auth/preferences` is guarded by `get_current_user` only (`api/routers/auth.py:1645-1648`), i.e. **the member writes their own preferences**. An entitlement stored there would be self-grantable. `user_tags` is admin-written and has no member write path — that asymmetry is the whole reason it is the right store.

⚠️ **And do not add a fifth authority.** If this lands, `COMPASS_MENTOR_MODE`'s two copies should read the same helper, or the codebase acquires a third cohort mechanism beside two copies of a second one.

**OPEN QUESTION.** Does the owner want cohort membership to be durable per-user (a tag, editable in the admin UI, surviving redeploys and auditable) or ephemeral per-deploy (an env allowlist, editable only by an operator with Railway access)? The two answers produce entirely different beta operations.

---

## 6. Admin control surface and audit logging

**OBSERVATION.** What staff can change at runtime today, and what it costs:

| lever | endpoint | effect | persisted? |
|---|---|---|---|
| Maintenance mode | `POST /api/auth/admin/maintenance` | sets `api.main._MAINTENANCE_MODE`, a module global; a middleware then 503s everything except `/api/auth*`, `/api/maintenance`, `/api/health`, and AuthGuard shows `<MaintenancePage/>` to non-admins | 🔴 **no** — in-process only |
| Comp access | `POST /api/auth/admin/comp-access` | grants/revokes `status='comped'` ⇒ paid-equivalent | ✅ DB |
| Force-verify | `POST /api/auth/admin/users/{id}/verify`, `POST /api/auth/admin/force-verify` | sets `email_verified` | ✅ DB |
| User tags / notes | `POST|DELETE …/users/{id}/tags`, `POST …/users/{id}/notes` | CRM metadata; **gates nothing today** | ✅ DB |
| Announcement | `POST /api/auth/admin/send-announcement` | broadcast email | — |
| Password reset, delete user, CSV export, Stripe check, subscription sync, tickets, todos, Twitter accounts | various `…/admin/*` | operational | ✅ DB |
| **Any feature flag** | — | **none exists** | — |

**Audit logging (appendix CDXVIII).** `log_activity(user_id, action, details, ip_address)` writes to the `activity_log` table and is read back by `GET /api/auth/admin/activity`. Comp grant/revoke is attributed (`details=f"by admin {user['email']}"`), and maintenance toggles log `maintenance_toggled` with the new state. 🟡 **It is best-effort**: the whole insert is wrapped in `try/except Exception` that prints and continues (`api/services/auth_service.py:567-580`), so a failed audit write does not fail the action it was auditing.

**EVIDENCE.** `api/routers/auth.py:704-1160, 1525-1590` (route list), `:714-729` (comp-access), `:1009-1017` (maintenance); `api/main.py:151-157, 6743-6745`; `api/services/auth_service.py:567-580`. CONFIRMED.

**INTERPRETATION.** Two things follow. First, **maintenance mode is the only runtime kill switch in the product, and it resets to `False` on every redeploy** — which happens several times a day — and would not propagate if the web pod ever went multi-instance (the same single-process assumption the broker-sync section documents). Second, an audit trail that silently swallows its own failures cannot be used as evidence that a change was or was not made; it is a convenience log, not a compliance record.

**RELEVANCE TO UCT.** If a TERMINAL-NEXT beta needs "turn it off right now without a deploy", nothing today provides that except maintenance mode, which turns off *everything*. If it needs a durable record of who was added to the beta and when, `activity_log` is the existing home but would need its swallow-and-print behaviour reconsidered.

**CONFIDENCE.** 🟢 high.

**RECOMMENDATION.** Any TERMINAL-NEXT cohort mutation should call `log_activity` with the admin's identity in `details`, matching the comp-access precedent — and the beta's kill switch should be a variable (deploy-coupled but durable) rather than a second in-process global.

**OPEN QUESTION.** Is a persisted, admin-toggleable runtime switch (a `settings` row read at request time) in scope for TERMINAL-NEXT, or is deploy-coupled rollback acceptable?

---

## 7. Rate limits and abuse protection tied to entitlement

**OBSERVATION.** Limits exist at four distinct layers, and only one of them is tier-aware.

| layer | mechanism | tier-aware? |
|---|---|---|
| **Auth endpoints** | `slowapi` — `@limiter.limit("3/minute")` on signup, `"5/minute"` on login | ❌ per-IP |
| **Per-user spend reserve** | AI Search: an atomic per-user daily reserve (`_reserve`) plus a global daily USD budget `AI_SEARCH_SYNTH_DAILY_CAP` (default `5.0` USD/ET-day, ≈135 asks at the measured cost); counters in-memory on the hot path, write-through to a durable ledger keyed by a day-rotating HMAC bucket and re-seeded once per process/day **because several deploys ship per day and in-memory-only counters were silently multiplying the daily budget on each one** | ❌ same cap for every paid user |
| **Global cost caps** | `COT_NARRATIVE_DAILY_CAP` (300/UTC day); `CATALYST_COST_CAP_DAILY` (8.00 soft) / `CATALYST_COST_HARD_CAP` (15.00 hard); theme-engine `$5/day` ET cap; voice `MODE_D_DEFAULT_CAP_SECONDS` (1 hr/month dictation) | ❌ firm-wide |
| **Public surface** | `render_panels._rate_limit` — sliding 60 s window, 60/min, **separate bucket for `/r/buzz`** so member `/buzz` traffic can only starve itself and never 429 the Morning Wire's `/r/catalysts`, `/r/calendar`, `/r/movers` | n/a — unauthenticated |
| **Entitlement limits** | `entitlements.Limits` — four axes | ✅ **the only tier-aware layer** |

**The entitlement layer in detail.** `api/services/entitlements.py` is described in its own header as *"the first entitlement model this codebase has"*. It gates **breadth** (symbols, history depth, definition count, refresh cadence) and explicitly never gates **mechanics** — *"Nobody is sold a worse RSI"*, machine-checked by `test_the_SAME_definition_on_the_SAME_symbol_is_BIT_IDENTICAL_under_every_toolkit`, `repr()` for `repr()`, with a positive control.

| axis | constant | enforcement point | wired? |
|---|---|---|---|
| symbols | `max_symbols` | `scan_evaluator._apply_limits` ← `entitlements.apply_symbol_cap` | ✅ live |
| history depth | `max_history_bars` | `apply_history_cap` — **a refusal (`ToolkitWithheld`, reason `toolkit:history`), never a trim** — plus `scan_evaluator._history_withheld` | ✅ live (2026-08-09) |
| definition count | `max_definitions` | `user_definitions.save` → `check_definition_count`, reached via `Depends(limits_dependency)` | ✅ live |
| refresh cadence | `min_refresh_seconds` | `refresh_floor_seconds(cadence, limits)` | ⛔ **not wired** — no per-toolkit scheduler surface exists |

**Exactly one toolkit ships** (`"all"`), with `None` — meaning ungated — on three axes and `max_definitions` *referencing* `user_definitions.MAX_DEFINITIONS_PER_USER` rather than restating a number, because *"turning a capacity bound into an entitlement bound is a CATEGORY CHANGE"*. `Depends(limits_dependency)` appears at four call sites (`definition_record.py:138`, `scan_results.py:114`, `scan_run.py:190`, and `user_definitions.py`).

Two design points are directly reusable:

- **`withheld` is neither `dropped` nor `not_computable`.** *"Dropped means we tried and failed; not-computable means the maths had nothing to say; withheld means your plan stops here. Folding any two makes a capped screen read as a broken one and a broken one read as a capped one, and a trader acts on the difference."*
- **Entitlement is applied where breadth is PRODUCED, never where it is displayed.** *"A UI that hides rows is not entitlement — the rows were computed, they held the GIL while a universe sweep ran, and a client can ask for them."*

**EVIDENCE.** `api/services/entitlements.py:1-135, 175-305`; `docs/decisions/2026-08-08-toolkit-gating-axes.md` (status **🟡 OPEN** — "the MECHANISM ships; the NUMBERS are the owner's"); `api/routers/ai_search.py:1-60, 1802-1850`; `api/routers/auth.py:134, 192`; `api/routers/render_panels.py:36-58`. CONFIRMED.

**INTERPRETATION.** There is a real, well-reasoned entitlement framework with **no numbers in it**. Nothing is currently gated by tier beyond the binary free/paid door. Every cost control is per-user-flat or firm-wide, which means **a per-user cap does not bound the population** — a point the owner's own memory already records.

**RELEVANCE TO UCT.** If TERMINAL-NEXT introduces tiers, `entitlements.TOOLKITS` is the one place a number should live, and the four axes plus the `withheld` vocabulary are already built and rail-tested. If TERMINAL-NEXT introduces AI cost per user, the AI Search reserve pattern (per-user atomic reserve + global USD budget + durable write-through re-seeded per process/day) is the pattern to copy — including the redeploy lesson.

**CONFIDENCE.** 🟢 high.

**OPEN QUESTION.** §8.4 and §8.5 of the indicator-platform design (the toolkit numbers, and whether cadence is nightly or intraday) are open decisions blocking the entitlement layer from doing anything. Does TERMINAL-NEXT need them answered, or does it ship on the binary free/paid door?

---

## 8. Requirements table for a TERMINAL-NEXT dark beta

Each row marked **exists** / **partial** / **absent**, with the file that would change. *These are observations of what the codebase provides, not a specification.*

| requirement | today | why | file that would change |
|---|---|---|---|
| **Flag exists and is inventoried** | **exists** | any `TERMINAL_NEXT_ENABLED` env var is auto-derived by the AST index; `tests/test_feature_flag_ledger.py::test_every_off_by_default_gate_is_declared` fails BY NAME if it merges without a ledger entry | `docs/feature_flags.json` (one entry, status `dark` or `pending` + reason) |
| **Flag naming convention** | **exists** | `<SUBSYSTEM>_<FEATURE>_ENABLED`; must contain `ENABLED`/`DISABLE` or end `_ON` or it is invisible (§2.3) | — |
| **Kill switch (rollback with no code change)** | **partial** | an env var on Railway is the rollback, but `railway variables --set` **stages only** — a redeploy is required, and the flag is read per process. There is no runtime toggle except maintenance mode, which kills everything | `api/main.py` (read at call time), Railway `web` service variable |
| **Instant per-browser revert for a canary** | **exists** | the `localStorage` + `window.__uct*` idiom is proven: `uct.barsPush.enabled` / `window.__uctBarsPush(false)`, `uct.ssePool.disabled` | pattern in `app/src/components/StockChart.jsx:908-927` |
| **Route gating (client)** | **exists** | one block in `AuthGuard`; step 9 (`/research/*` → let the page decide) is the pattern for a teaser instead of a bounce | `app/src/components/AuthGuard.jsx` |
| **Route gating (server)** | **exists** | per-router `require_paid` (deliberately **defined**, never imported — each router owns its own 402 sentence; rail: `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`) and shared `require_admin` | new `api/routers/terminal_next.py` |
| **Nav door visibility** | **exists** | `NAV` array in `NavBar.jsx`; `NAV_GROUPS` in `app/src/components/navGroups.js` is the one route taxonomy, consumed by NavBar + MoreSheet; `navGroups.route.test.jsx` asserts every navigable `to` resolves against `App.jsx`'s real route table | `app/src/components/navGroups.js`, `NavBar.jsx`, `mobile/MoreSheet.jsx` |
| **Door hidden from non-cohort users** | **partial** | hiding by *paid* or *admin* works today (`showAll = isPaid`, `isAdmin`); hiding by *cohort* has no client input because no cohort reaches the client | `app/src/context/AuthContext.jsx` + `api/routers/auth.py::_access_payload` |
| **Per-user / cohort targeting** | **absent** *(one narrow precedent)* | only `COMPASS_MENTOR_MODE=beta` + `COMPASS_MENTOR_BETA_EMAILS`, implemented twice and server-side only. No store, no shared helper, no client field | §5.3: `api/services/auth_service.py` (`has_tag`), `api/middleware/auth_middleware.py` (`require_beta`), `api/routers/auth.py` (`_access_payload`) |
| **Admin can add/remove a member from the beta** | **partial** | `user_tags` gives an admin-writable per-user store with a UI and an index, but **no gate reads it** | `app/src/pages/Admin.jsx` (already has the tag UI at `:659-673`), plus the helper above |
| **API gating for beta endpoints** | **exists** | `Depends(require_paid)` + a second dependency beside it is the established two-dependency pattern (`entitlements.limits_dependency`) so one 402 keeps meaning one thing | new router + `api/middleware/auth_middleware.py` |
| **Boot-time proof the new routes are gated** | **partial** | `api/auth_surface_check.py` audits **mutating** routes on the live route objects at boot; **GETs are not audited**, and TERMINAL-NEXT reads would be GETs | `api/auth_surface_check.py` (`MUTATING` set) |
| **Telemetry / opt-in** | **partial** | `POST /api/auth/track` + `page_views` + `activity_log` exist and are admin-readable (`/api/auth/admin/analytics`); there is **no consent or opt-in mechanism** and no beta-scoped event stream | `api/routers/auth.py` (`/track`), `api/services/auth_service.py` (`log_activity`) |
| **Audit trail for cohort changes** | **partial** | `log_activity` exists and comp-access already attributes the acting admin; the write is best-effort and swallows its own failures | `api/services/auth_service.py:567-580` |
| **Client learns beta state without a rebuild** | **absent** | no flag endpoint; `VITE_*` is build-time | `api/routers/auth.py::_access_payload` (one field) |
| **Ledger records WHERE the switch lives** | **absent** | all 86 armed entries carry the placeholder `where: ["(set — service not captured)"]` | `docs/feature_flags.json` |
| **Drift detection (ledger vs Railway)** | **exists, unscheduled** | `tools/flag_ledger_audit.py`, exit 0/1/2 — deliberately outside the test suite, and **not wired to any scheduler or CI job** that I found | `tools/flag_ledger_audit.py` + a scheduler entry |

**Summary of the four genuine gaps.** (1) No per-user/cohort store consulted by any gate. (2) No server→client flag channel. (3) No runtime kill switch short of full maintenance mode. (4) The ledger covers neither client flags nor allowlist-shaped flags nor explicitly-disabled on-by-default flags.

---

## GAPS

- **No Railway read.** The contract did not authorise `railway variables`, so every "armed" claim is CLAIM-from-ledger. In particular I could not settle whether `PATTERN_VISION_ENABLED=0`, `SCAN_SWEEP_ENABLED=1`, `RATINGS_PERCENTILE_ENABLED=1`, `COMPASS_MENTOR_MODE`, `DESK_PUBLIC_SHOWS` or `COMING_SOON_MODE` are actually set today. One read-only `railway variables --service {web,worker,flow-worker} --kv`, piped to print key names only, closes this.
- **No test run.** `tests/test_feature_flag_ledger.py` and the auth-surface tests were read, not executed. I verified the ledger/derivation agreement by importing `feature_flag_index` directly (which touches no shared data), but not the parametrised per-entry assertions.
- **Route inventory is grep-derived, not app-derived.** The `Depends(...)` counts in §3.2 count occurrences in source, which approximates but does not equal the number of mounted routes. Importing `api.main:app` and walking `app.routes` (the 986-route technique used by the 2026-08-09 audit) would make §4.4's unauthenticated list exhaustive.
- **Stripe webhook handling** was read only far enough to establish which plan strings it writes (`"pro"`). Per contract, payments beyond entitlement are out of scope.
- **`api/services/entitlements.py`** is 22 KB; I read the header, the `Limits`/`TOOLKITS`/`toolkit_for`/`limits_for`/`limits_dependency` block and the axis signatures, not every axis implementation.
- **`app/src/pages/Admin.jsx`** (2,254 lines) was surveyed by its `/api/` fetch list, not read in full. A toggle that does not fetch (pure client state) would have been missed.
- **TOTP** was confirmed to exist as a login challenge (`api/routers/auth.py:210-240`, `totp_service.is_enabled/mint_challenge/read_challenge/verify_login_code`, plus `/totp/status|setup|verify-setup`) but its enrolment policy — whether admins are required to have it — was not established.
- **Referral system** (`referrals` table, `/my-referral`, `/apply-referral`, `/admin/referrals`) touches entitlement indirectly and was not investigated.

## NOT INSPECTED

- **Railway dashboard / live environment** — out of reach by contract; the only authority on which flags are actually set, and on each service's `watchPatterns`.
- **Cloudflare dashboard** — named by `HISTORY_PREWARM_ENABLED`'s ledger entry as the prerequisite (Tiered Cache + Cache Reserve) that could not be checked from repo or Railway. Also the authority on WAF/bot rules that sit in front of every gate discussed here.
- **Stripe dashboard** — the only authority on which price ids exist, whether an annual price is configured, and whether `premium`/`lifetime` were ever sold.
- **Production `auth.db`** — the only authority on how many users hold `role='admin'`, `status='comped'`, or any given `user_tags` row. Never read (production volume; and `C:\data\auth.db` on this box is the owner's live file).
- **`C:\Users\Patrick\morning-wire`** — home of `WIRE_SUBSTACK_GATE_MODE` and the wire's own gate stack. Out of this contract's scope (D-10 is dashboard-scoped) and read-only besides.
- **`C:\Users\Patrick\uct_intelligence` (Discord bot)** — has its own flag surface (`/buzz` activation, `BUZZ_*`) that the dashboard ledger does not cover, since the ledger scans only this repo.
- **`services/chart_renderer`** — consumes `CHART_RENDER_TOKEN` and is deployed separately (`railway up` from its subdirectory, claimed not git-connected). Its own env surface was not enumerated.
- **Partner-owned files** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`) — noted as present and mounted; `live_massive_router.py` carries at least one config endpoint (`/auto-push-config`) and `MASSIVE_WS_ENABLED` is ledger-armed. Not described further, per the preamble.
