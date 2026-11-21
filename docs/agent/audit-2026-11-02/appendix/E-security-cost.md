# Audit E — UCT Agent: security boundaries, cost controls, model usage

Read-only audit of worktree `C:/w/aaudit` at origin/master `cfc35a3b3f` (2026-11-02). No code run, no tests, no network, no paid calls. Production env values were NOT read and are stated as unknown throughout. No market values or secrets appear in this report.

---

## 1. Access control

### 1.1 The guards (`api/routers/uct_agent.py`)

| Guard | Definition | Rule |
|---|---|---|
| `require_paid` | `api/routers/uct_agent.py:83-86` | `is_paid_user(user)` else **402**. `is_paid_user` = `trial.is_paid_or_trial` (`api/middleware/auth_middleware.py:92-99`): admin role OR plan in `PAID_PLANS = {pro, premium, lifetime}` (`:84`) OR in-trial. |
| `require_admin_dark` | `api/routers/uct_agent.py:89-91` | `Depends(require_paid)` then `auth_middleware.require_admin(user)` → `user.get("role") != "admin"` → **403** (`auth_middleware.py:75-79`). Admin is purely the session user's `role` column ("admin"); no email allow-list, no env list. |
| Session | `get_current_user` reads cookie `uct_session` → `validate_session` → **401** (`auth_middleware.py:17-22`). |

Docstring (`uct_agent.py:1-28`): "Paid (402) AND admin (403) while UCT Agent is dark -- lifting dark is deleting `require_admin_dark`". Tests pin the guard matrix on every route: `tests/test_uct_agent_latency.py:323` (`test_every_agent_route_refuses_anonymous_free_and_paid_member`, parametrised over method+path), `tests/test_uct_agent_qa_member_refused.py:194,212`, `tests/test_uct_agent.py:410`.

### 1.2 Every `/api/agent/*` route and its guard (all 15 use `Depends(require_admin_dark)`)

| Route | Line | Guard | Notes |
|---|---|---|---|
| POST `/api/agent/turn` | `:174-176` | require_admin_dark | model turn |
| GET `/api/agent/config` | `:189-197` | require_admin_dark | returns `{stream, nl1, news, data, scan, data_kinds}` |
| POST `/api/agent/turn/stream` | `:200-237` | require_admin_dark | SSE; same `_turn` |
| GET `/api/agent/budget` | `:458-462` | require_admin_dark | aggregates only |
| POST `/api/agent/record` | `:465-484` | require_admin_dark | browser-reported receipts/refusals/undo + telemetry |
| GET `/api/agent/conversations` | `:487-490` | require_admin_dark | member-scoped by `user["id"]` |
| GET `/api/agent/conversations/{id}` | `:493-499` | require_admin_dark | `store.get_conversation(uid, id)` → 404 if not owned |
| PATCH `/api/agent/conversations/{id}` | `:507-523` | require_admin_dark | `store.owns(uid, id)` check `:513` |
| DELETE `/api/agent/conversations/{id}` | `:526-531` | require_admin_dark | `store.delete_conversation(uid, id)` |
| GET `/api/agent/search` | `:534-537` | require_admin_dark | `q[:200]`, member-scoped |
| POST `/api/agent/session-stats` | `:544-552` | require_admin_dark | read-only, `MAX_SYMBOLS` |
| POST `/api/agent/data` | `:561-566` | require_admin_dark | MD-1 gateway; second gate `UCT_AGENT_DATA=1` inside `gateway.read` |
| POST `/api/agent/breadth` | `:576-645` | require_admin_dark | local, never a model; body ≤ 2000 bytes `:573` |
| POST `/api/agent/breadth/history` | `:648-681` | require_admin_dark | local, never a model |
| GET `/api/agent/breadth/dates` | `:684-689` | require_admin_dark | dates only |

### 1.3 Non-agent routes the Agent's browser code calls (production code only, tests/fixtures excluded)

Source: `grep` of `fetch(`/URL literals under `app/src/agent/**` (`agentClient.js`, `host.js`, `capabilities/*.js`, `nl/tickers.js`, `agentUi.jsx`).

| Endpoint (browser file:line) | Server guard | Member-accessible? |
|---|---|---|
| `/api/ticker-search` (`agentClient.js:237`, `nl/tickers.js:51`) | cookie-optional; bars entitlement check `ticker_search.py:259-264`, `_bars_entitled(uct_session)` at `:295` | yes (open read with entitlement nuance) |
| `/api/watchlist-alerts` GET/POST/DELETE (`capabilities/alert.js:25`) | `get_current_user` (`watchlist_alerts.py:30-39,88`) | yes, any signed-in member |
| `/api/live-prices` (`capabilities/stock.js:58`, `capabilities/alert.js:78`) | `get_current_user` (`live_prices.py:619-622`) | yes — **see §6.1: this route runs the alert evaluator on a cache miss** |
| `/api/watchlists`, `/api/watchlists/{id}` (`host.js:269-346`, `capabilities/watchlist.js:6`) | `get_current_user` (`watchlists.py:323,421,446,498`) | yes |
| `/api/watchlists/digest-settings` (`capabilities/digest.js:16`) | `get_current_user` (`watchlists.py:297,312`) | yes |
| `/api/user-definitions` (`capabilities/indicators.js:14`) | router-local `require_paid` (`user_definitions.py:52`, routes `:361-376`) | paid |
| `/api/company-news/{symbol}` (`capabilities/news.js:53`) | `require_member` (`company_news.py:29,88-97`) | signed-in |
| `/api/catalysts/history/{sym}` (`capabilities/news.js:83`) | `require_paid` (`catalysts.py:28,169-170`) | paid |
| `/api/screener/fields`, `/saved-screens`, `/scan` (`capabilities/screener.js:80,105,124,272,276`, `savedScreens.js:22`) | `require_paid` (`screener.py:187,345,1064-1087`) | paid |
| `/api/fundamentals-full/{ticker}`, `/api/earnings-intel/{ticker}` (`stock.js:68,112`) | **no `Depends` on the route** (`fundamentals.py:501,528`, only `ticker_path` symbol validation). Gated ONLY by `open_reads_gate` at mount (`open_reads_gate.py:497-498`, `main.py:9756`), whose flag `OPEN_READS_GATE` **defaults to `off`** (`open_reads_gate.py:36-50,87-88`). | paid-by-table; anonymous-readable when the gate is off. Production mode unknown. |
| `/api/research/compare/{sym}/{comparator}` (`stock.js:154`) | same: no route `Depends` (`research.py:413-414`); in `GATED_READS` (`open_reads_gate.py:504`) | as above |
| `/api/auth/preferences` GET/POST (`host.js:417,487`) | `get_current_user` (`auth.py:3409-3410,3439-3440`) | yes |
| `/api/auth/avatar/{id}` (`agentUi.jsx:35`) | not audited (image) | — |

Conclusion: every workspace mutation the Agent performs goes through ordinary member routes with the member's own cookie, so the Agent inherits exactly the member's server-side permissions — it cannot escalate. The server itself "never mutates a workspace" (`uct_agent.py:23-25`); the browser executes. The only cross-member read vector checked — saved screens by id — is member-scoped (`scan/sources.py:5-7,31-41`, `saved_screens.get(id, user_id)`).

Pre-existing (not Agent-introduced) observation: three research reads the Agent uses have no route-level auth and rely on the staged `OPEN_READS_GATE`; whether it is `enforce` in production could not be verified.

---

## 2. Feature flags

Browser learns server flags from **GET `/api/agent/config`** (`uct_agent.py:189-197`), read once per 5 min by `loadAgentConfig` (`app/src/agent/agentClient.js:90-107`); all browser predicates are false until the config answers yes (`:108-121`). Production values: **not readable from this audit; unknown.**

| Flag | Default | Gates what | Where |
|---|---|---|---|
| `UCT_AGENT_STREAM` | OFF (only `1/true/on/yes`) | SSE deltas on `/turn/stream`; off → only the final event | `uct_agent.py:179-186`; browser `agentClient.js:85-87,108` + per-browser kill `localStorage uct.agent.stream='0'` |
| `UCT_AGENT_NL1` | OFF (`== "1"`) | NL-1 model-first interpretation; whole catalog, but capped at 60 actions so "cannot be turned on until the owner decides its limit" | `turn.py:89-95,163-165`; browser also needs `localStorage uct.agent.nl1='1'` (`nl1/interpreter.js:11-13,27-30`) |
| `UCT_AGENT_NL1_CATALOG` | `full` (`lean` = eval knob) | NL-1 catalog variant | `turn.py:610-614` |
| `UCT_AGENT_NEWS` | OFF (`1/true/on/yes`) | News → Agent headline chats (answer-only turns) | `news.py:10,17,41-42`; `_news_turn` `uct_agent.py:260-281`; browser `newsAsk.js`, `TradeExchangeNewsAsk.jsx:13` |
| `UCT_AGENT_DATA` | OFF (`== "1"`) | the MD-1 gateway (`/api/agent/data`); off → every read refused | `gateway.py:41,67-68,180-181`; browser `marketdata/client.js:22` (no request made while dark) |
| `UCT_AGENT_DATA_KINDS` | empty = NO kind (fails closed, no wildcard) | per-kind allowlist, read only while DATA on | `gateway.py:47-50,71-80,188-189`; browser `serverDataKinds` `agentClient.js:116-118` |
| `UCT_AGENT_SCAN` | OFF (`== "1"`, requires DATA) | `screen.*` scan kinds | `gateway.py:42,86-87,194-195` |
| `UCT_AGENT_ISOLATED` | OFF (`== "1"`, requires DATA) | model-isolated kinds (`breadth.current`, `ratings`) — dormant | `gateway.py:43-46,82-83,190-191` |
| `AGENT_BREADTH_CURRENT` | OFF (`1/true/on/yes`) | present-tense breadth overlay on `/api/agent/breadth` | `breadth_now.py:50-55`; used `uct_agent.py:626-631` |
| `UCT_AGENT_MODEL` | `claude-haiku-4-5` | the model id | `turn.py:78-81` |
| `UCT_AGENT_DAILY_CAP` | 300 requests/member/ET day | `daily_counters` scope `uct_agent_turn` | `uct_agent.py:94-98,124-130` |
| `UCT_AGENT_COST_CAP_DAILY` | unset = no ceiling | opt-in dollar ceiling via `narrative_cost_guard.over_budget` | `uct_agent.py:101-113` |
| `UCT_AGENT_BUDGET_USD` | $5.00/ET day (all members) | hard ledger cap | `budget.py:52,96-97` |
| `UCT_AGENT_MAX_CALLS_PER_REQUEST` | 2 | paid calls per member request | `budget.py:53,100-101` |
| `UCT_AGENT_RATE_MEMBER_MINUTE` / `_HOUR` / `UCT_AGENT_RATE_GLOBAL_MINUTE` / `UCT_AGENT_INFLIGHT_PER_MEMBER` / `UCT_AGENT_INFLIGHT_LEASE_S` | 20 / 300 / 120 / 1 / 150 s | request-rate windows and in-flight slot | `limits.py:33-39` |
| `UCT_AGENT_TIMEOUT_S` | 60 s (`llm_timeouts.REQUEST_PATH`) | SDK timeout, `max_retries=0` | `turn.py:958-959,968-969`; `llm_timeouts.py:42` |
| `UCT_AGENT_DB_PATH` | `/data/uct_agent.db` | Agent SQLite store | `store.py:32` |
| `AI_POPULATION_CAP_MODE` / `AI_POPULATION_DAILY_CAP` | off / 5000 | site-wide per-door population cap; Agent door `uct_agent` | `ai_population_cap.py:46-56`; `uct_agent.py:318` |
| `CATALYST_COST_HARD_CAP` | $15.00 | the SHARED AI ledger the Agent reads (never writes) | `catalyst/cost_guard.py:138-139`; `budget.py:224-257` |
| `OPEN_READS_GATE` (not Agent-owned) | off | anonymous-read gate over `/api/fundamentals-full` etc. | `open_reads_gate.py:36-50,87-88` |

Browser-only switches: `localStorage uct.agent.stream`, `uct.agent.nl1`; `AGENT_OPEN_KEY`/`AGENT_CONVERSATION_KEY` are storage keys, not flags.

**All Agent feature flags default OFF**; only caps/limits have non-zero defaults.

---

## 3. Proprietary data isolation

### Policy (ADR-005, `docs/agent/program/decisions/ADR-005-model-isolation.md:1-44`)
Raw values of `model_isolated` kinds — today `breadth.current` (incl. NH/NL) and `ratings` — "must never enter anything the model sees": prompts, tool results, history/replay, titles, planner context, memory, traces/telemetry. Member-direct display only. Research/scan compositions over them are refused. Any relaxation needs a new ADR + owner approval.

### Enforcement layers (cited)
- **L1 gateway, dormant + purpose:** `gateway.py:190-193` refuses isolated kinds unless `UCT_AGENT_ISOLATED=1` and `purpose == "answer"`; kinds registered `model_isolated=True` at `marketdata/kinds.py:85-94`. `ratings.py:8-9` docstring restates it.
- **L2 envelope marker:** gateway stamps `isolated: true` on the envelope, its `data`, and every row recursively (QA F-21) — `gateway.py:233-247`; `envelope.validate_envelope` rejects `isolated != true` (`envelope.py:92-93`).
- **L3 caller allowlist (browser rail):** `app/src/agent/qa/modelIsolation.test.jsx:1-16` — only `localOnly` capabilities named in server `LOCAL_ONLY_ACTIONS` may `readData` an isolated kind; only `agentClient.js` may name `/api/agent/data` (`agentClient.js:123-124`, `marketdata/client.js:2-3`).
- **L4 local-result boundary (server):** `turn.py:679` `LOCAL_ONLY_ACTIONS = {breadth.show, breadth.history}`; `is_local_row` `turn.py:818-830` (fail closed: unreadable row ⇒ local); `outcome_for_model` `turn.py:886-897` replays only `LOCAL_RESULT_NOTE` (`:680-682`); `history_messages` `turn.py:900-935` blanks the agent-side reply of a local turn. Store keeps `local` flag in `data_json` (`store.py:149-150`); `/api/agent/breadth*` route docstrings "never a model call… values are not logged" (`uct_agent.py:570-573,651-654`).
- **L5 browser strip:** `agentClient.js:43-71` drops any object with `isolated: true` from a model-bound request and counts the drop.
- **L6 server strip (fail closed):** `turn.strip_isolated_request` `turn.py:1536-1560`, called first thing in `run_turn` (`:1591`); marked history rows replayed as unreadable.
- **L7 memory/traces:** telemetry schema holds counts/ids/ms only (`store.py:59-77`); `recent_outcome` from the browser is deleted before the model (`turn.py:1649-1652`, QA F-17); naming call never reads outcome rows (`agent-qa.md:650`).
- **Research blocked for breadth questions:** `turn.py:1730-1732` (`breadth_research_blocked`); mixed requests get a fixed notice, not a model explanation (`:736-751`).
- **Stock.compare rating (F-12):** removed from the capability (`agent-qa.md:633,656-658`) because `/api/research/compare` sits outside the gateway (no server enforcement).

### Scan exposure (SC-1)
`scan/sources.py:1-16`: exactly one source (spec | member's own `saved_id` | criteria `text` via the screener's deterministic grammar); never `/api/screener/compile` (a paid model path). `screen.py:1-19`: wraps `screener.query.run_scan`, no SQL/provider/write/alert; strips plumbing keys `_PLUMBING` (`:36`). ADR-002 (`ADR-002-canonical-screener.md:11-15`): Agent uses only the canonical screener; rail `tests/test_uct_agent_scan_screen.py:249`.

### Gaps noted in status docs
- **F-16 (OPEN, owner decision):** the screener serves the same UCT Ratings as ordinary fields, so a screen sorted/thresholded by `uct_composite` leaks composite ORDER and COUNTS into `conversation_memory.recent_results`, `screener.lastScreen` and replayed outcome text (`agent-qa.md:311-320,446-449,635-636,654,664-666`). The pre-existing screener route still sends the model a field catalog naming all 33 prohibited fields (`:446-449`). Enforcement (agent-sc PR-A #654 / PR-B) "is NOT in this candidate" (`:446`). QA's independent ruling lists 26 hidden fields and the visible inputs that reproduce them exactly (`:488-556`); **F-16-R** (reconstruction from public inputs) is an owner-ACCEPTED residual (`:556`).
- **F-23 (OPEN):** half-day 13:00–16:00 "last completed session" edge in `stock.dailyBars`; untested, kind stays dark (`agent-qa.md:440`).
- **F-11 (latent):** `_row_actions` treats an answered row with no `actions` as `[]` → replayable (`ADR-005.md:36`).
- `UCT_AGENT_ISOLATED` activation gate (QA recommendation, `agent-qa.md:660-666`): stays off until F-16 is decided.
- Outside the Agent: `api/routers/ai_search.py:1158` writes "UCT composite N" into AI Search's own prompt (`agent-qa.md:668`).

---

## 4. Cost controls

### Admission order per model request (`uct_agent.py:240-252,297-333`)
1. `limits.admit` — in-flight slot (1/member), 20/min & 300/h per member, 120/min global; durable SQLite, `BEGIN IMMEDIATE`, lease 150 s; **fails OPEN** on store error (`limits.py:1-22,33-39,100-122`).
2. `_take(uid)` — `UCT_AGENT_DAILY_CAP` 300 requests/member/ET day via `daily_counters` (`uct_agent.py:124-130`); given back on refusal/failure.
3. `over_cost_cap()` — opt-in `UCT_AGENT_COST_CAP_DAILY` via `narrative_cost_guard` surface `uct_agent` (`:101-113`).
4. `ai_population_cap.admit("uct_agent")` — site-wide population cap, mode default off (`ai_population_cap.py:46-56`).
5. `budget.open_request` — the member-request row that the ≤2-call ceiling counts against; **fails CLOSED** (503) if the ledger is unavailable (`uct_agent.py:320-333`).

### The dollar ledger (`budget.py:1-41`)
- Own hard cap **$5.00/ET day across all members** (`UCT_AGENT_BUDGET_USD`, `budget.py:52,96-97`) AND stop when the **shared $15 ledger** (`catalyst.cost_guard`, `CATALYST_COST_HARD_CAP` default 15.00, `cost_guard.py:138-139`) is spent — read-only; Agent spend is never written into it (`budget.py:224-257`).
- Worst-case **reservation before every paid call** in one `BEGIN IMMEDIATE` transaction: every UTF-8 byte of the request counted as a token, +4000 framing tokens, priced as cache-write (1.25×), + `max_tokens` output; research priced at the dearest Perplexity rate × 4 attempts (`budget.py:9-18,54-64`). Settled from provider usage; missing usage settles at worst case; HTTP error releases (`:19-27`).
- **≤ 2 paid calls per member request** (turn + reroute/repair/research/title share it) (`budget.py:34-39,53`). Ceiling enforced by `_paid` → `meter.call` (`turn.py:1078-1082`).
- Per-member: only the 300/day request count and rate windows; **no per-member dollar cap**.
- Cost accounting per call: `_record_cost` → `narrative_cost_guard.record_from_response` (`turn.py:1085-1090`); usage returned to the browser (`uct_agent.py:445-449`).
- `/api/agent/budget` exposes `state()` aggregates incl. `site.agent_paused` (`budget.py:414-441`).
- Gateway per-turn budgets: 8 reads, 1 scan, 20 provider calls, 50 symbols/read, 600 s turn TTL (`gateway.py:52-56,206-215`). Research: 1 web search/turn, `max_tokens=600`, mode fast, `cost_surface="uct_agent"` (`turn.py:938-942`, `MAX_RESEARCH_CALLS=1` `:62`).
- AI-door registry entry: `api/services/ai_doors.py:230-237` (kind `operator`, pop_cap wired to the router). Rate-limit family `ai` (TIER_COSTLY) includes `/api/agent` (`api/rate_limit_policy.py:301-306`).
- `session_stats.py`: read-only, no model, `MAX_SYMBOLS=10000` (`:1-24`); route enforces it (`uct_agent.py:548-551`).

### Model usage (`turn.py`)
- **Model id:** `UCT_AGENT_MODEL` default **`claude-haiku-4-5`** (`turn.py:78-81`); one model for everything — turn, schema retry, post-research call, repair, and the chat-naming call (`name_conversation`, `max_tokens=64`, `turn.py:1206-1221`). **No model routing** by request class; the only "routing" is which capability groups the prompt carries (`validate_routing` `:109-130`) and the browser's zero-cost fast path.
- **`max_tokens=2048`** (`:63`, used `:1681,1697`).
- **Structured output, no tools:** `output_config={"format": {"type": "json_schema", "schema": schema}}` (`:1683,1699`); docstring "The model's call carries NO tools" (`:31-45`); one retry in compact form if the embedded-args schema is refused (`:1685-1701`).
- **Prompt caching:** every system block carries `cache_control: {"type": "ephemeral"}` (`:1641,1694`); NL-1 orders blocks most-stable-first (`:1631-1636`). LATENCY.md says caching is "likely ineffective" on routed prompts under Haiku's 4,096-token minimum (`docs/agent/LATENCY.md:93-95`); cache hit counts are now in usage (`cache_read_tokens`) but **not measured in production**.
- **Streaming:** implemented (`client.messages.stream`, `_default_stream_caller` `:963-973`; SSE route `uct_agent.py:200-237`) but **off by default** (`UCT_AGENT_STREAM`); only `answer` dispositions may stream, behind `ReplyStream`'s gate (`:976-990`).
- **Retries:** `max_retries=0`, timeout 60 s (`:958-959`).
- **Answer caching:** none — no cache of model answers in `turn.py` (grep `lru_cache|_cache|CACHE`: no hits). Only config (5 min) and breadth-dates caches in the browser.
- **Input bounds:** message ≤ 2000 chars, context ≤ 24 000 bytes, reference ≤ 24 000 bytes, ≤ 60 capabilities, 6000 bytes/capability, 12 history turns (`:59-64,85-97,1433`).

### Prompt size (static measurement, chars/4 ≈ tokens)
- `_SYSTEM_HEAD` 7,224 chars (`turn.py:453-482`) + `_SYSTEM_TAIL` 7,013 chars (`:483-541`) = **~14.2 k chars ≈ 3.6 k tokens fixed**, plus one catalog line per action (`_catalog_lines` `:630-651`: name, args, risk, undo truth, summary, hints ≤ 1000 chars) and long enum id lists. NL-1 adds `NL1_RULES` 5,127 chars + glossary 2,448 chars (≈ 1.9 k tokens).
- Manifest serialisation: capabilities validated/trimmed by `validate_manifest` (`:193-204`), then rendered as text lines inside the system prompt and as the JSON output schema (`envelope_schema` `:385`); the workspace context, pending proposal, title and member request are XML-ish `_block`s in the user message (`:658-661,1637-1655`).
- LATENCY.md measured totals (`docs/agent/LATENCY.md:65-73`): routed prompts 13.4 k–25.5 k chars (≈ 5–10 k input tokens); **routing miss = full catalog 54–55 actions ≈ 39 k chars ≈ 11–15 k tokens**. Per-call cost estimate $0.005–$0.015 input + $0.0005–$0.003 output (`:156-160`).

---

## 5. Latency (docs only, nothing run)

`docs/agent/LATENCY.md`:
- **Model time, first-token time, cache hits: NOT MEASURED** — "no paid calls; production telemetry read was not authorized" (`:14`). Streaming gain is simulated (`:15`).
- Baseline (simulated 25 ms hops, 5 runs, `:42-57`): fast path 0 model calls, TTFU p50 ≈ 104–199 ms (sim); model path 1 call (research: 2 calls + web search), TTFU p50 92–230 ms (sim). First visible feedback p50 ≤ 10 ms (`:59`).
- Server work around the model (60 turns, real stores, 0 ms model): `pre` p50 26 ms / p95 79 ms; `build` < 1 ms; `post` p50 15 ms / p95 65 ms (`:62-63`).
- Bottlenecks ranked (`:79-98`): model generation (inferred cause of observed 8–10 s — research turns and long answers); full-catalog input on routing misses (~2.5× tokens); serial board GET → save POSTs on deterministic commands; context refresh round trip; server bookkeeping ~40 ms (<5 %); prompt cache likely ineffective.
- Optimized (`:100-141`): trace + stage timings in telemetry (I); one fewer hop on symbol change and indicator saves (D1/D2); streaming (S, dark). Projection (assumptions only, `:143-154`): long answer first text 3–5 s → 0.8–1.5 s; research 6–10 s → first text 3.5–6 s.
- **Fast-path share: no measured figure in the docs.** PHASE1-INTELLIGENCE.md:58 says the fast path "covers only exact phrasings"; a QA harness recorded 16 fast phrasings at 0 model calls for quotes (`agent-qa.md:436`). Memory note (`uct-agent-breadth-perf-open-chart`): a 9–10 s outlier was Breadth cold history reads, fixed.

---

## 6. Side-effect safety

| Concern | Enforcement | Cite |
|---|---|---|
| Price reads must not trigger alerts | MD-1 `quote/quotes` read Massive's snapshot directly, "NOT the `/api/live-prices` route: on a cache miss that route runs `watchlist_alert_service.run_alert_check()`"; rail `test_the_adapter_imports_neither_the_live_prices_route_nor_the_alert_service` | `marketdata/quotes.py:3-8,27`; `live_prices.py:732-740`; `tests/test_uct_agent_data_quotes.py:333-343`; MD-1 `:63` |
| **Gap (6.1):** the LEGACY browser capabilities still call `/api/live-prices` directly — `capabilities/stock.js:56-61` (`liveQuote` for `answerProfile`) and `capabilities/alert.js:74-78` (`quotesFor`). Because the gateway is dark (`UCT_AGENT_DATA` off), these are the live paths today, and a cache-miss fetch runs the member's alert evaluator (`live_prices.py:732-740`). Same behaviour as any app poll (not a new alert, and admin-only today), but the MD-1 invariant is not yet true end-to-end until `quote` is activated and `stock.js` is cut over. | | |
| flow-worker never touched | "Never restart or deploy flow-worker"; flow data only via `api/flow_proxy.py`; no `flow.*` kind registered | `program/OWNERSHIP.md:22`, `README.md:24`, `INTEGRATION.md:28`, MD-1 `:164`, `kinds.py` (no flow kind) |
| Scans never write/alert | `screen.py:4-6`; rail `test_the_adapters_never_touch_the_legacy_screener_or_alerts` | `tests/test_uct_agent_scan_screen.py:249` |
| Approval for `risk: confirm` / `reversible:false` | Server: `enforce_approval` turns such an `apply` into `propose` (never less guarded) except `EXPLICIT_OK_ACTIONS={indicator.saveDraft}`; browser applies the same rule in `policy.decideMode` | `turn.py:52-57,1321-1333`; `app/src/agent/policy.js:34-39`; `CAPABILITY-CONTRACT.md:81` |
| Talk never mutates | `answer/clarify/unsupported` → ops forced empty server-side; `answer_only` news turns drop ops | `turn.py:14-18`; `run_turn` docstring `:1585-1587` |
| Undo exactness | Registry `undo ∈ {exact,none}`, defaults from `reversible`/`query`; a kind marked `undoable:false` cannot claim `exact`. Undo is all-or-nothing: refused on board epoch change or if any target's fingerprint differs from `afterFp`; partial failures are reported | `capabilities.js:40,62-68`; `runtime.js:191-240`; `CAPABILITY-CONTRACT.md:83-88` |
| Receipts / audit trail | Browser reports every real outcome (receipt, refusal, undo) to `POST /api/agent/record` → `agent_turns` rows role `outcome` with `data_json` (`kind, actions, local, requests`) + `agent_telemetry` (path/disposition/actions/undo/latency/cost, no text) in SQLite at `UCT_AGENT_DB_PATH` | `useAgent.js:10-15,478-482`; `uct_agent.py:465-484`; `store.py:48-77,149-150,187,321`. Spend audit: `agent_spend` / `agent_requests` tables `budget.py:106-130`. |
| Content never logged | timing log carries ms/counts only; breadth routes log status only | `uct_agent.py:438-442,599,641,672` |

---

## 7. Licensing / quote display constraint

- There is **no Agent-specific licence text**; the constraint lives in the licensing register: Massive quotes are class **R — "Individual tier, display-only, no Edge Users grant"** (`api/services/provider_licensing_class.py:45-47`, register row T-01), with bars/movers/news/reference/derived analytics likewise R (`:48-62`). The register notes an owner-confirmed Business tier correction (`docs/terminal-research/09-security-licensing-cost/licensing-register.md:39-56`) that the code table has not adopted (conservative default, `provider_licensing_class.py:9-15`). `massive.py` stamps `licensing_class` on every quote result and maps DELAYED to `delayed_15` rather than claiming real-time (`massive.py:276-291`).
- How the Agent handles it: MD-1 forbids wording periodic/historical/delayed data as "live"/"now" (`MD-1-market-data.md:54`), requires `delay_s` for `delayed` (`:38`), and prescribes exact phrasings — "Not a real-time price", "stale", "no trade in the last 15 minutes" (`:185-196`). Ratings carry "no vendor badge", source `uct-ratings` (`ratings.py:5-6`). The live breadth row is not available to the Agent for licensing reasons T-75/L2 (`BREADTH-CAPABILITY-CONTRACT.md:49`). ADR-005: member-direct display only for UCT-derived values. No "fund note"/attribution footer was found in Agent code; display-only is handled by the gateway being dark plus phrasing rules.

---

## 8. Reusability: generic vs per-feature

**Generic (automatic for any new capability/kind via registry or gateway):**
- Route guard (`require_admin_dark`) and the whole admission chain (rate windows, daily count, population cap, dollar ledger, call ceiling) — per request, independent of capability (`uct_agent.py:240-252,297-333`).
- Manifest validation, schema building, approval enforcement, ops-empty-on-talk, size caps — derived from the browser registry contract (`turn.py:6-10`, "no action list in this file"); `registerCapability` enforces `risk/reversible/undo/args` shape (`capabilities.js:42-69`).
- Undo/receipt machinery per target kind (`runtime.js`), approval policy (`policy.js`).
- MD-1 gateway: flags, per-kind allowlist, per-turn read/scan/provider budgets, envelope validation, freshness ordering, `isolated` stamping — any `Kind` registered gets them (`gateway.py:88-101,180-247`).
- Isolation L5/L6 stripping by marker — generic (`agentClient.js:43-71`, `turn.py:1536-1560`).
- AI-door census and rate-limit family — generic across the app (`ai_doors.py`, `rate_limit_policy.py`).

**Per-feature (re-implemented or hand-listed):**
- `LOCAL_ONLY_ACTIONS` is a hard-coded set (`turn.py:679`) — a new isolated-kind capability must be added by hand (L4), plus the browser `localOnly` flag and the QA handshake fixture.
- `EXPLICIT_OK_ACTIONS` hand-listed (`turn.py:57`).
- Breadth routes have their own body-size cap, overlays and selection policy (`uct_agent.py:573-689`); news turns their own `MAX_MESSAGE`, flag and conversation rules (`news.py`, `uct_agent.py:260-295`).
- Legacy capabilities fetch member routes directly (`stock.js`, `alert.js`, `screener.js`, `news.js`) outside the gateway — their freshness/alert/isolation guarantees are per-file, not inherited (the §6.1 gap is a consequence).
- Research gating keywords (`_needs_current_facts`, `_NEWS_WORDS`) and breadth question detection are bespoke (`turn.py:1724-1740`).

---

## Unverified / out of scope
- Production values of every flag (incl. `OPEN_READS_GATE`, `UCT_AGENT_STREAM`, `UCT_AGENT_DATA*`, `AGENT_BREADTH_CURRENT`, caps) — not readable here.
- Real model latency, cache hit rate, fast-path share — docs state these were never measured in production.
- Whether `/api/fundamentals-full`, `/api/earnings-intel`, `/api/research/compare` are anonymous-readable in production depends on `OPEN_READS_GATE` mode.
- No tests were run; rails are cited by name and line only.
