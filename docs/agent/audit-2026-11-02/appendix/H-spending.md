# Audit H — AI spending controls (read-only, 2026-11-02)

Scope: worktree `C:/w/aaudit`. NOTE: the worktree is NOT detached at `cfc35a3b3f`; it is on branch
`docs/agent-acceleration-audit-2026-11-02` at `d142299246`. `git diff --stat cfc35a3b3f HEAD -- api tools` is
EMPTY, so every `api/` and `tools/` citation below is identical to origin/master `cfc35a3b3f`. Nothing was
edited, no tests were run, no API calls were made; the only network use was three official docs pages.
Secret values were never printed (only env var NAMES appear).

Owner mandate audited against: paid-evaluation budget max **$21 cumulative** across all workers/sessions;
production Agent **$5/day**; shared UCT AI **$15/day**; **no automatic increases**.

---

## (a) Controls that exist

### A1. Production UCT Agent ledger — `api/services/uct_agent/budget.py`
| Control | Where | What it does |
|---|---|---|
| Hard daily cap $5 (ET day) | `budget.py:54,96-97` (`DEFAULT_CAP_USD`, env `UCT_AGENT_BUDGET_USD`; 0/blank/garbage → $5 via `_num` 86-93) | all members together, not per member |
| Reservation in `BEGIN IMMEDIATE` | `budget.py:260-281` | committed = settled actuals + open reservations (270-271); admit only if `committed + worst ≤ cap` (272-274); the request's call counter moves in the same transaction (263-268) |
| Worst case before every call | `budget.py:161-170` | every UTF-8 byte of system+messages+output_config+tools+tool_choice counted as 1 token + `FRAMING_TOKENS=4000` (58), all priced as a **cache write (1.25×)**, plus **`max_tokens` of output** at the output rate. Price comes from `narrative_cost_guard.estimate_cost` (154-158): unknown model → priciest known rate |
| Settlement with actual usage | `budget.py:343-347, 387-393, 294-323` | `input`, `output`, `cache_read_input_tokens`, `cache_creation_input_tokens` all priced. **Thinking tokens**: the Agent sends no `thinking`/`effort` (`turn.py:1680-1684`; `tools/agent_eval_prices.json:10`), and the provider reports thinking inside `usage.output_tokens` (prices.json:7), so they are both bounded by `max_tokens` in the reservation and charged in the settlement |
| Missing usage → worst case | `budget.py:307-308, 387-388` | timeout / dropped connection / non-HTTP exception settles at the reservation (`outcome=worst_case`, 381-386) |
| Provider HTTP error → release | `budget.py:326-341, 350-357, 382-383` | only `anthropic.APIStatusError` releases; the request's call is given back (337) |
| Never-settled reservation keeps counting | `budget.py:22-23, 296-297, 339-340` | a failed `settle`/`release` leaves the row `reserved` (over-counts, never under-counts) |
| Fails closed | `budget.py:251-257, 287-291` | ledger unreadable/unwritable or shared-ledger unreadable → `BudgetRefused("unavailable")`, no call |
| Durable | `store.py:32,84,87` (`/data/uct_agent.db`, `sqlite3.connect(timeout=10)`, WAL) | survives restart/deploy; `_READY_FOR` (138-150) is only a schema-init memo |
| Concurrency-safe | `budget.py:261` + test `tests/test_uct_agent_spend_limits.py:84-101` (40 threads, exactly 25 × $0.20 admitted, 15 refused) | SQLite `BEGIN IMMEDIATE` serialises across threads **and** processes |
| Call ceiling 2 paid model calls / member request | `budget.py:55,100-101,263-268`; reroute continues the same request within 300 s (184-209) | research lookup itself does not count (`counts_as_call=False`, 396-398) |
| Shared $15 stop (read-only) | `budget.py:225-242, 252-257` | reads `catalyst.cost_guard.spend_by_kind(...)["total"]` vs `hard_cap_usd()`; refuses once `spent ≥ cap`; **never writes** there (owner option 1, 3-7) |
| Research worst case | `budget.py:59-65, 173-176, 396-410` | 4000 in × $3 + 600 out × $15 + $0.006 fee, **× 4 attempts** (= Perplexity's 1+3 retries, `perplexity_search.py:231`) ≈ $0.108 reserved per lookup; settled from `cost_usd` returned by `web_search(return_cost=True)` (`turn.py:938-941`, `perplexity_search.py:634-638`), `cached` → $0, missing cost → worst case |

### A2. Rate / in-flight / daily counts
| Control | Where | Durable? |
|---|---|---|
| 20/min & 300/h per member, 120/min global, 1 in flight per member, 150 s lease | `limits.py:33-39, 89-124` | **DB-backed, `BEGIN IMMEDIATE`** in the Agent store (95-97); test `tests/test_uct_agent_spend_limits.py:317-331`. **FAILS OPEN** on a store error (`limits.py:19-20, 130-132`) by design |
| 300 requests/member/day (`UCT_AGENT_DAILY_CAP`) | `api/routers/uct_agent.py:94-98, 123-126` → `daily_counters.take` | durable in auth.db, `BEGIN IMMEDIATE` (`daily_counters.py:1,20,128`); fails open (`ai_population_cap.py:27`) |
| Population cap (`ai_population_cap.admit("uct_agent")`) | `uct_agent.py:325-328` → `ai_population_cap.py:121-133` | durable via `daily_counters` (`ai_population_cap.py:24-25`) |
| Opt-in dollar floor `UCT_AGENT_COST_CAP_DAILY` | `uct_agent.py:101-113` (`narrative_cost_guard.over_budget`) | floor check, not a reservation; unset in production per `docs/agent/conversational-intelligence/GATE-B-RELEASE-READINESS.md:45` |

### A3. Admission order on `POST /api/agent/turn` (`api/routers/uct_agent.py`)
1. `limits.admit` (252) → 2. `_take` daily count (313) → 3. `over_cost_cap()` (317) → 4. `ai_population_cap.admit` (325) → 5. `budget.open_request` (331; fails closed 332-335; a reroute with no request to continue is a 400, 336-338) → 6. `run_turn(..., meter=budget.Meter(uid, request_id))` (366-372) → each paid call: `turn._paid` → `meter.call` (`turn.py:1078-1082`) → `budget.reserve` → provider → `settle`/`release`. Refusals give the daily count back (373-385). Background naming call goes through the same Meter and request id (437-455).

### A4. Agent provider calls (`api/services/uct_agent/turn.py`)
- `max_retries=0` and an explicit timeout on both the plain and the streaming caller (956-960, 966-970; `llm_timeouts.REQUEST_PATH = 60 s`, `llm_timeouts.py:42`). No SDK auto-retry on 429/5xx, no `fallbacks`.
- `MAX_TOKENS = 2048` (63); model `claude-haiku-4-5` by default (`UCT_AGENT_MODEL`, 78-81).
- Paid call sites, all metered: first/after-research/repair/reroute call (1679-1685), `schema_retry` after an API schema refusal (1696-1702; the refused call's reservation was released as an `APIStatusError`), `title` naming (1218-1223, `max_tokens=64`), `research` (1788).
- `_research` is called **unmetered** at 1820 only when `meter is None` (scripts/tests; the route always passes a Meter).
- `_record_cost` (1085-1090) ALSO writes each response to `narrative_cost_guard` surface `uct_agent` — reporting duplicate, not a second gate.

### A5. The shared $15 ledger — `api/services/catalyst/cost_guard.py`
- `CATALYST_COST_HARD_CAP` default 15.00 (138-139); `INTERACTIVE_AI_RESERVE_USD` 4.00 (142-145); background = 15 − 4 (148-150); soft $8 only logs (193, 218-222).
- `may_synthesize` (background gate, 186-224) and `may_member_spend` (interactive gate, 227-247) are **floor checks before a call, no reservation** — documented overshoot "by its own cost" (233-236).
- `record` (249-270) prices with cache fields when given and writes `catalyst_cost_log` under a process lock (`catalyst/store.py:880-893`); unknown model → priciest known rate (header 21-24).

### A6. `/api/user-definitions/converse` and `/propose`
- Router `api/routers/user_definitions.py:523-551`: `require_paid` + `require_create_indicator_access` (520-525), then `_charge_propose(user_id)` (538) — the per-member hourly window shared with `/propose` ("40/hour/member", `ai_doors.py:219,225`; **in-process**, `ai_doors.py:220,229`).
- Service `definition_conversation.py:1787-1812`: before EVERY model call `cost_guard.may_member_spend` (global $4 interactive / $15 total) and `dc.spend_for(user) ≥ cap_usd` (per-member daily: `CONVERSE_USER_CAP_DAILY` → else `CONCIERGE_USER_CAP_DAILY` $0.75; admins `CONVERSE_ADMIN_CAP_DAILY` default $10, 1455-1465). Charged to the **catalyst ledger** as ticker `concierge:<uid>` (1809-1811) **with cache fields**. `MAX_MODEL_CALLS=2` (1786), `max_retries=0` (1340; `definition_concierge.py:128`).
- `/propose` (`definition_concierge.py:3158-3177`): same gates; but `_call_model` returns only input/output tokens (1814-1816) and `cost_guard.record(..., in_tokens, out_tokens)` (3175-3176) passes **no cache fields** → a cached /propose prefix is under-charged (converse fixed this, propose did not).
- Per-member spend is the ledger sum with an in-process floor (`definition_concierge.py:160-186`); one-in-flight slot per member is **in-process** (202-215).

### A7. Other ledgers touched by the Agent's neighbours
- `narrative_cost_guard.py`: durable `llm_route_cost_log` in auth.db (116-124), ET-anchored (97-100), `max(durable, in-process)` (188-203), `record` never raises (252-280), price table 64-72 (`claude-haiku-4-5` 1/5, `claude-sonnet-5` 2/10, opus 5/25), prefix match for dated aliases (158-162), unknown → priciest + warning (163-168). **Missing entries:** `claude-haiku-5-5` (no prefix match → priced at Opus 5/25, i.e. 50× over) and `claude-sonnet-5-5` (prefix-matches `claude-sonnet-5` → 2/10, correct).
- `perplexity_search.py`: `_PPLX_PRICES` (198-203), per-call cost incl. `PPLX_REQUEST_FEE_USD` 0.006 (206-221) written as surface `pplx:<caller>`; 3 retries on 429/5xx and timeouts (223-234, 544-582); global **count** cap `PERPLEXITY_DAILY_LIMIT` 500/ET day (246-253, 323-345); no global dollar cap.
- `ai_search_agent.py` (AI Search page agent lane): its OWN cap `AI_SEARCH_AGENT_COST_CAP_DAILY` default **$15/day** (59-63), floor check in `available()` (66-72), records after every step (182), `_MAX_STEPS` loop (167, 241); client `with_options(timeout=50)` only → **SDK default `max_retries=2`** (174). Plus the router's 40 units/member/day (`ai_doors.py:52-61`). This $15 is separate from the shared $15.

### A8. Evaluation tooling (`tools/`)
| Tool | Ceiling | Key | Retries | Worst case | Cumulative ledger |
|---|---|---|---|---|---|
| `agent_eval_run.py` | `--max-usd` required (134-135); `prices.verified` + model priced (136-139); abort rules 240-256 | `UCT_AGENT_EVAL_API_KEY` (46, 305) and refuses if it equals `ANTHROPIC_API_KEY` (143-144); `client.models.retrieve` first (307-310) | `max_retries=0`, `timeout=--timeout-s` 30 s (305) | chars/3 tokens as **cache write** + `max_tokens`, at the HIGHER of prices.json and `narrative_cost_guard.estimate_cost` (324-331); actual priced from all 4 usage fields (348); thinking tokens read (342-347) but billed inside output; research stubbed (312); `_record_cost` stubbed (313); reroute within a 2-call `CeilingMeter` (194-213, 379-388) | **None** — `spent` is a per-process dict (314) |
| `agent_live_batch.py` | `--max-usd` required (98-100); per-call guard (113-130) | **`ANTHROPIC_API_KEY` = production key** (101, 134) | via `turn._default_caller` → `max_retries=0` (123) | chars/3 as cache write + `max_tokens` via estimator (117-120); actual with cache fields (125-128); research + ledger stubbed (105-106); `models.retrieve` (133-139) | **None** (108) |
| `agent_latency_probe.py` | `--max-usd` ≤ `HARD_CEILING_USD` 1.00 (30, 65-67) | **`ANTHROPIC_API_KEY`** (62) | via `turn._default_caller`/`_default_stream_caller` → `max_retries=0` (70, 87, 92) | `worst_cost` prices input at the **plain** rate, not cache-write (32-37); `guard(est)` is checked before each call but `spent` only advances after the whole turn (85, 91, 112) → the 2nd call of a turn is checked against a stale total; actual = `usage.cost_usd` from `_record_cost` (not stubbed here; writes the sandboxed ledger via `conftest`, 27) | **None** (69) |
| `agent_live_chain.py` | `--max-usd` > $0.10 (137-139); backend env `UCT_AGENT_COST_CAP_DAILY = max_usd − 0.10` (109) — a floor check, overshoot ≤ one turn (52-54); the backend ALSO carries budget.py's default $5 | **`ANTHROPIC_API_KEY`** (103, 108, 140) | the backend's own `max_retries=0` | server-side | scratch ledger in a `tempfile.mkdtemp` dir (104, 110) — discarded per run |
| `agent_eval_proxy.py` | free (Claude Code subagents stand in; no API key, 1-14) | — | — | — | — |

`tools/agent_eval_prices.json` is `verified: true` on 2026-10-16 (3-4) for haiku-4-5 / haiku-5-5 / sonnet-5-5 (9-15).

---

## (b) Genuinely enforced (server-side, concurrency-safe) vs advisory

**Enforced, concurrency-safe, durable, fail-closed**
- Agent $5/day ledger with worst-case reservations (`budget.py:260-281`; threads test 84-101). Holds across uvicorn workers because it is SQLite `BEGIN IMMEDIATE` on the web volume — production runs ONE uvicorn process anyway (`Procfile:1`, `railway.json:8`, no `--workers`).
- Agent call ceiling 2/request (same transaction, `budget.py:263-268`).
- Agent stop at the shared $15 (`budget.py:252-257`) — exact as a *stop*, but it is a read of another DB outside the transaction: the Agent can still spend its remaining $5 headroom on calls admitted before the shared ledger crosses $15 (by design: combined worst case $20/day, `GATE-B-BUDGET.md:16`).
- Eval runner refusals (key separation, verified prices, model lookup, per-call pre-check) in `agent_eval_run.py:132-145, 305-331`.

**Enforced but NOT concurrency-safe (floor checks, no reservation)**
- Shared $15 / $4 interactive gates (`cost_guard.py:186-247`, documented 233-236): N concurrent admitted calls each overshoot by its own cost. Mitigated per member by the in-process in-flight slot (`definition_concierge.py:202-215`); background lanes have no such slot.
- Per-member $0.75 / admin $10 converse caps (`definition_conversation.py:1787-1790`) — floor test ("159% of the cap" overshoot documented, `definition_concierge.py:145-150`).
- `ai_search_agent` $15/day (`ai_search_agent.py:66-72`): checked once in `available()` before the multi-step loop; every step records after the fact (182) — one ask can run `_MAX_STEPS` calls past the floor.
- `UCT_AGENT_COST_CAP_DAILY` (`uct_agent.py:101-113`) and `agent_live_chain`'s use of it (109).
- Perplexity 500 calls/day is durable (`narrative_cost_guard.calls_today`, 212-231) but a count, not dollars.

**Advisory / in-process (reset on deploy, per-process)**
- `/propose`+`/converse` hourly window and in-flight slot (`ai_doors.py:220,229`; `definition_concierge.py:202-215`).
- `limits.py` fails OPEN (130-132) — it shapes traffic; the ledger is the guarantee.
- `narrative_cost_guard` surfaces listed in `ai_doors.py` with `gap=` (e.g. 129-137, 153-173, 191-196, 248-271): caches/IP limits only, or no counter at all.
- Eval tools' `--max-usd`: enforced per run in memory only; nothing stops a second run, a second PC, or a second session.

---

## (c) Bypass paths, ranked (most consequential first)

1. **Three of four paid eval tools use the PRODUCTION key** (`agent_live_batch.py:101`, `agent_latency_probe.py:62`, `agent_live_chain.py:103,140`). Their spend lands on the production org/workspace, outside any $21 accounting, with no cumulative ledger (A8). Only `agent_eval_run.py:140-144` enforces key separation.
2. **No cross-run / cross-session ledger anywhere.** Every tool's `spent` is a per-process variable (`agent_eval_run.py:314`, `agent_live_batch.py:108`, `agent_latency_probe.py:69`); `agent_live_chain` throws its scratch ledger away (104). Two sessions each running `--max-usd 12` honour the mandate individually and break it jointly.
3. **Paid member doors with no dollar cap at all** (not in the $5 nor the $15): `ai_doors.py` rows with `gap=` and "no counter": `modelbook.py` (257-259, "no dollar cap"), `company_about.py` (191-193), `groups.py` (194-196), `engine.py` earnings (251-253), `routers/earnings.py` debug route "no route auth" (254-256), `transcripts.py` "no auth dependency" (269-271), `community_ask.py` (266-268), `journal_two/coach.py`, `pre_trade_verdict.py`, `trade_review.py` (127-137), `voice_chart_vision.py`, `voice_deep_research.py` ("Claude leg uncapped", 157-160), `voice_embeddings_service.py`, `voice_summarizer.py`, `trader_profile_auto.py` (161-173), `earnings_enrichment.py` (248-250). ~60 `messages.create` sites exist repo-wide (grep in this audit); the census test `tests/test_ai_doors_census.py` keeps the table complete, not capped.
4. **Separate $-caps that add to the "$15 shared"**: `ai_search_agent` $15/day (`ai_search_agent.py:59-63`), AI Search synthesis $5 + deep $10 + personal $25 est. (`ai_doors.py:52-69`), notebook $25/day (89-116), ticker/comparison explain $10 each (179-190), flow_explain $5 (175-178), txn_explain $5 (182-187), schwab $5 (197-199), call-recap $10 (207-212), theme $5 ×2 (292-295), pattern vision $10 (296-297). The "$15 shared" is NOT site-wide (`budget.py:226-229`, `GATE-B-BUDGET.md:21`).
5. **Floor-check overshoot on the $15 ledger** (b above), and `/propose` under-charging cached prefixes (`definition_concierge.py:3175-3176`).
6. **SDK default retries where `max_retries` is not set**: the shared client is built with `timeout=60.0` only (`engine.py:86`) → `max_retries=2` for every caller that does not override (`ai_search_agent.py:174`, and most A7/c3 doors). A retried 429/5xx is not billed, but a **timeout** (60 s) may have generated billed tokens that return no `usage`, and the SDK's up-to-3 attempts are then invisible to every after-the-fact `record` (reasoning spelled out in `definition_concierge.py:108-127`). The Agent (`turn.py:959,969`) and the concierge/converse (`definition_concierge.py:128,1805`; `definition_conversation.py:1340`) are correctly `max_retries=0`.
7. **Automatic paid model fallback exists in one place**: `tsdr_lessons.py:972-978, 2220-2224` sends `anthropic-beta: server-side-fallback-2026-07-01` with `fallbacks: "default"` — the API retries a refused request on another model within the call. Operator/scheduler lane (`ai_doors.py:305-308`, flag `TSDR_LESSONS_ENABLED`), not member-facing; nothing in `uct_agent/` or `tools/agent_*` uses fallbacks (grep: no hits).
8. **Perplexity has no dollar cap**, only 500 calls/day across all surfaces (`perplexity_search.py:246-253`); at sonar-pro rates with 3 retries this is a second provider outside the Anthropic workspace limit. The Agent reserves for it correctly (`budget.py:59-65`); every other surface just records.
9. **Env-driven caps can be raised without code change**: `UCT_AGENT_BUDGET_USD`, `CATALYST_COST_HARD_CAP`, `AI_SEARCH_AGENT_COST_CAP_DAILY`, `CONVERSE_ADMIN_CAP_DAILY` … are read at call time. None auto-increase; all are one Railway variable away. "No automatic increases" holds today; "no increases" is an operational rule, not a code guard.
10. **Price-table drift**: `narrative_cost_guard._PRICES` (64-72) lacks `claude-haiku-5-5` → priced at Opus rates (safe direction, but a haiku-5-5 eval or production switch would reserve ~50× and refuse early). The Agent reservation always uses this table (`budget.py:154-158`), the eval runner takes the max of it and prices.json (`agent_eval_run.py:328-329`).
11. **Timeout accounting asymmetry in `agent_latency_probe.py`**: worst case at the plain input rate (32-37) and a stale `spent` inside a turn (85-112) — an underestimate relative to budget.py's method; bounded by the $1 hard ceiling (30).

---

## (d) Can a $21 cumulative evaluation cap be GUARANTEED today?

**No.**

What exists: per-run, per-process ceilings with sound per-call worst cases in one tool (`agent_eval_run.py`), key separation in that one tool only, `max_retries=0` everywhere on the Agent path, and a production ledger that is genuinely atomic — but production is a *daily* $5 cap, not the evaluation budget.

What is missing:
1. **A shared cross-run ledger** with reservations: nothing persists `spent` between runs, sessions, PCs or tools; three tools do not even know the eval key exists.
2. **A provider-side hard limit on the eval key**: the eval key's workspace has no spend limit configured as far as the repo shows (`docs/agent/nl-intent/NL1-ROUTES.md:14`: the key was not set on this PC on 2026-10-16). The Default Workspace **cannot** carry a spend limit (docs below), so if the eval key lives there, the only provider stop is the org tier cap ($500/month Start, $1,000 Build).
3. **Key separation in all tools** (c1).
4. **A single price source** for the worst case (c10) and the cumulative accounting of Perplexity (c8) — eval tools disable research, so this is a "keep it disabled" rule, not a ledger.

---

## (e) Minimal setup to make $21 cumulative guaranteed (design, not implemented — audit is read-only)

**1. Provider-side (Console, owner).**
- Create a workspace `uct-agent-eval` (not the Default Workspace — "You cannot set spend limits on the Default Workspace", https://platform.claude.com/docs/en/manage-claude/workspaces#workspace-limits; same note at https://platform.claude.com/docs/en/api/rate-limits#setting-lower-limits-for-workspaces).
- In that workspace: **Spend limits → cap monthly spending = $21** (Workspaces page → workspace → "Spend limits"; "Cap monthly spending for a workspace", workspaces doc §Workspace limits). When reached, "requests return HTTP 400 with error type `invalid_request_error`. The message starts with … `You have reached your specified workspace API usage limits`" (rate-limits doc §Setting your own spend limit) — a BLOCK, not an alert; alerts are additional thresholds in the same panel. The docs state no minimum or cent-granularity; the limit is per **calendar month** and must be re-checked if evaluation straddles a month boundary (the cumulative $21 must then be tracked by the local ledger, item 3).
- Create exactly ONE API key in that workspace → `UCT_AGENT_EVAL_API_KEY`. There is **no per-key spend limit** in the docs (limits are org-level, workspace-level, and per-user only inside the auto-created "Claude Code" workspace: workspaces doc "It is the only workspace that supports per-user monthly spend limits").
- Optionally move the production key into its own workspace `uct-prod` with a monthly spend limit as a backstop (owner's number; daily mandate $5 + $15 + the other caps in c4 sum to far more than $20/day potential).

**2. Key separation in every paid tool.** Make `agent_live_batch.py`, `agent_latency_probe.py`, `agent_live_chain.py` read `UCT_AGENT_EVAL_API_KEY` and refuse when it is absent or equal to `ANTHROPIC_API_KEY` (copy `agent_eval_run.py:140-144`); `agent_live_chain` passes it as the launched backend's `ANTHROPIC_API_KEY` (109 area). Record a key fingerprint (e.g. first 8 hex of sha256) in the ledger rows so every run proves which key it used, without storing the key.

**3. A shared cumulative ledger (reservation protocol = `budget.py`'s).**
- One SQLite file at a fixed, non-repo path shared by all workers/sessions on the PC (e.g. `%LOCALAPPDATA%/uct-agent-eval/ledger.sqlite`, override `UCT_AGENT_EVAL_LEDGER`), WAL, `BEGIN IMMEDIATE`.
- Table `eval_spend(id, run_id, tool, key_fp, model, status reserved|settled|released, reserved_usd, actual_usd, input, output, cache_read, cache_write, created_at, settled_at)` — content-free like `agent_spend` (`budget.py:108-127`).
- `reserve(worst)` inside the transaction: `SUM(reserved where reserved) + SUM(actual where settled) + worst ≤ CUMULATIVE_CAP`; `settle(actual|None→worst)`; `release()` only on `APIStatusError`; a crashed run's reservations keep counting (the owner can audit and release them by hand, never automatically).
- `CUMULATIVE_CAP = 21.00` as a **module constant**, not an env var (the mandate says no increases; an env override is an increase waiting to happen). `--max-usd` stays as the per-run sub-ceiling and must be ≤ the ledger's remaining.
- Worst case per call = `max(prices.json, narrative_cost_guard.estimate_cost)` with the whole request as cache write + `max_tokens` (already in `agent_eval_run.py:324-331`); add `claude-haiku-5-5`/`claude-sonnet-5-5` to `narrative_cost_guard._PRICES` so the two sources agree.
- Refuse `--run` if the ledger file is unreachable (fail closed), and if `turn._research` is not stubbed (research must stay off; Perplexity is outside the workspace limit).
- One `tools/agent_eval_ledger.py --report` printing cumulative settled/reserved/remaining, per run and per key fingerprint.

**4. Rule of use.** Provider limit ($21/month on the eval workspace) is the backstop; the local ledger ($21 cumulative, all-time) is the control; both must agree before a run starts (the runner can read the Console's "Usage and Cost Analytics API" only with an Admin key — not needed; the local ledger is sufficient when every tool goes through it).

---

## (f) Setup / approvals needed from the owner

1. Console: create workspace `uct-agent-eval`, set its monthly spend limit to $21, create its single key, set alert thresholds (50/75/90%). Owner only — Console access.
2. Place the key in the eval PC's user-scope env as `UCT_AGENT_EVAL_API_KEY` (never in chat, never in the repo; the existing handoff describes the procedure, `docs/agent/nl-intent/NL1-TRIAL.md:78`).
3. Approve the code changes in (e)2–3 (key separation in three tools, the ledger module, the price-table additions). They touch `tools/` and `narrative_cost_guard._PRICES` only.
4. Decide whether the production key should also move to a limited workspace, and the monthly number.
5. Decide whether the stale `ai_doors.py:230-237` Agent row (still describes the pre-ledger design: "narrative_cost_guard surface 'uct_agent' records spend", no $5 cap) should be updated — documentation only.
6. Confirm `UCT_AGENT_COST_CAP_DAILY` is still unset in production (cannot be read from this audit), and that `UCT_AGENT_BUDGET_USD` / `CATALYST_COST_HARD_CAP` are unset or at their defaults.

---

## 5. Reporting that exists (and a daily cost report without new infrastructure)

- `GET /api/agent/budget` (admin-only, `uct_agent.py:459-463`) → `budget.state()` (`budget.py:414-444`): today's settled / reserved / committed / remaining, counts, token totals, per-category, models, plus the shared ledger's spent/cap.
- `agent_spend` has an `et_day` column (`budget.py:112`) — a per-day history exists; `state(day)` already takes a day (414).
- `agent_telemetry` (`store.py:58-75`) carries `cost_usd`, `model`, `research_calls` per turn (written in `uct_agent.py:410-418`); `tools/agent_latency_telemetry.py:44-57` already sums `cost_usd` per path (its `cost_usd` is the estimator's figure from `_record_cost`, not the ledger's).
- `llm_route_cost_log` in auth.db (`narrative_cost_guard.py:116-124`): surfaces `uct_agent`, `pplx:uct_agent`, `ai_search_agent`, every other guarded door.
- `catalyst_cost_log` in catalysts.db (`catalyst/store.py:82-92`, `cost_guard.budget_state` 166-183) for the $15 ledger by lane.
- `api/services/uct_agent/session_stats.py` is NOT a cost module (it is market-session close/volume lookups, "no model call", 14).

A daily cost report is three `GROUP BY day` queries over tables that already exist (`agent_spend` by `et_day`; `llm_route_cost_log` by `surface, date(at)` with the ET-midnight cutoff from `narrative_cost_guard._et_midnight_utc_text`; `catalyst_cost_log` by `market_date, ticker`), run read-only on the web volume the way `agent_latency_telemetry.py:4-5` is run (`railway ssh --service web`). No new tables, routes or jobs are needed; the only gap is that the three DBs are separate files, so the report is three queries, not one join.

---

## 6. Claude Code usage (official docs, https://code.claude.com/docs/en/costs.md, fetched 2026-11-02)

- Subscriptions (Pro/Max/Ultra) include usage; "Usage credits let you keep working past your plan's usage limit" — that is the only way a subscription incurs extra paid charges. Managed via `/usage-credits` → claude.ai **Settings → Usage → Usage credits**, where you can "turn usage credits on or off and check your credit balance, this month's spend, and your monthly spend limit". With a limit set, "Claude Code prompts you to raise or remove the limit" when reached — it does not raise it by itself.
- **Prevention**: keep usage credits OFF (or set the monthly spend limit to the minimum). With credits off, hitting the plan window stops work (`/rate-limit-options`, "wait and continue") rather than charging.
- API-key use of Claude Code bills per token to the Console org; it runs in the auto-created "Claude Code" workspace, where "Workspace spend limits" and per-user monthly spend limits can be set (costs doc §Claude Console; workspaces doc "It is the only workspace that supports per-user monthly spend limits").
- Also noted: subagents, agent teams, `/loop`, idle compaction and prompt suggestions consume usage while idle (costs doc §Background token usage / §Why usage climbs).

## Provider docs cited (section 3 of the brief)
- https://platform.claude.com/docs/en/api/rate-limits — "Spend limits set a maximum monthly cost an organization can incur"; tier caps Start $500 / Build $1,000 / Scale $200,000 per calendar month; at the tier cap "API usage pauses … API requests return HTTP 429 … `enforced_spend_limit_reached`"; a self-set limit ("cannot exceed your current tier's cap") returns "HTTP 400 … `invalid_request_error` … `You have reached your specified API usage limits`, or `You have reached your specified workspace API usage limits` for a workspace limit"; "You can't set spend limits on the default Workspace"; "Organization-wide limits always apply, even if Workspace limits add up to more".
- https://platform.claude.com/docs/en/manage-claude/workspaces — §Workspace limits: "Spend limits: Cap monthly spending for a workspace … click Spend limits" ("to cap monthly spending and configure alerts when spending reaches certain thresholds"); "You cannot set spend limits on the Default Workspace"; per-user monthly limits only in the Claude Code workspace. No minimum value or granularity is stated; no per-API-key spend limit exists in either page.
- https://code.claude.com/docs/en/costs.md — as in section 6.
