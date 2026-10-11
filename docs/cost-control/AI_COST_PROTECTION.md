# AI cost protection — what bounds paid model spend, and what does not

Owner request 2026-10-11: about $50 of Anthropic API credit in two days, with no way to say
where it went. Scope: pay-as-you-go model spend by UCT's own services (website, UCT Agent,
Indicators AI, background jobs, tests). Not Claude Code / Claude Max usage.

Code: `api/services/ai_spend.py` (the guard), `api/services/daily_counters.py` (the durable
store, auth.db `daily_usage_counters`), `tests/test_ai_spend.py` (33 tests, no network),
`tests/conftest.py` (the test transport block).

## 1. The layers, and which ones are real guarantees

| Layer | What it is | Guarantee? |
|---|---|---|
| **Provider limits** (manual, owner) | Anthropic Console workspace spend limit + alerts; OpenAI and Perplexity account limits | **The only hard guarantee.** Enforced by the provider whatever the code does, for every key. |
| `ai_spend` ENFORCE mode | Every paid call reserves its worst case in auth.db under the day ceiling BEFORE it is sent; refused when it does not fit, or when the budget cannot be checked | Application-level, durable, **fails closed**. |
| `ai_spend` RECORD mode | Calls counted after they finish; nothing refused for money | Accounting only, fails open. Production's mode until the owner sets a ceiling. |
| Per-process valves (both modes) | Kill switch, runaway breaker, in-flight cap, batch cap | Per process. |
| Existing per-lane guards | catalyst `cost_guard` ($15/day), `narrative_cost_guard`, call-recap, theme, pattern-vision, concierge per-member, Agent daily turn cap | Per lane. Unchanged. |
| Test transport block | `tests/conftest.py` refuses real HTTP to model hosts | Tests only. |

## 2. Exactly what is covered

The guard is installed by `api/main.py`, by every `api/*_main.py` worker entry point (the
processes `railway.json` can start: worker, flow-worker, bars-api, breadth-v2 producer,
terminal-next monitor, econ) and by the shared client factory `engine._get_anthropic_client`.
A rail (`test_every_deployed_process_entry_point_installs_the_guard`) keeps it that way.

| Path | Covered how | Counted as |
|---|---|---|
| Anthropic `messages.create` / `.stream` / `.parse`, sync and async, and the `beta` twins — from **any** client, factory or hand-built | SDK method wrapper: reserve worst case → send → settle to the reported usage | CONFIRMED |
| SDK retries inside one call | HTTP hook counts each attempt; an attempt that ended without an HTTP answer (timeout, dropped connection) is held at the reservation and the retry must reserve again | UNCONFIRMED for the maybe-billed attempts |
| Anthropic `messages.batches.create` (sync / async / beta) — `llm_batch`, wisdom extraction | Worst case of every request at the 50% batch price, held at submission | UNCONFIRMED (never released) |
| Raw HTTP POST to `api.anthropic.com` outside those methods (httpx or requests) | **Refused** in enforce mode (`unmetered`); free endpoints (`count_tokens`, batch `cancel`, files) pass | — |
| OpenAI (TTS, Whisper, `desk_creative` images, any other POST) via httpx / requests / the OpenAI SDK | Flat estimate per request reserved and held: TTS $0.07, transcription $0.20, images $0.25, other $0.05; an HTTP error answer is released | UNCONFIRMED |
| Perplexity (`perplexity_search`, ai-search, briefings, NAAIM) | Flat $0.05; `sonar-deep-research` $1.50 | UNCONFIRMED |
| OpenAI Realtime session mint (`voice_openai.mint_realtime_session`) | **Refused** in enforce mode: the session bills the browser's own connection, which no server budget can bound. `AI_SPEND_ALLOW_REALTIME=1` admits it at a $0.50 hold | — |

Searched and found to be **not** provider calls: `desk_session_recap` (urllib → Discord
webhook), `wisdom/extract/local_backend` (urllib → loopback model). No other model provider
host appears in `api/`.

## 3. Exactly what is NOT covered

- **A key used outside this codebase** (a script, another service, a leaked key) — only the
  provider limit binds it.
- **A process that never imports `api.main`, an `*_main` entry point or the client factory**
  (an ad-hoc `python some_script.py` that builds its own client). It is unguarded unless it
  calls `ai_spend.install()`.
- **HTTP clients other than httpx and requests** (aiohttp, urllib, websockets) to a model host.
  None exist in `api/` today; a new one would bypass the guard.
- **Realtime voice usage** after a session is minted (see above) — billed browser-side.
- **Batch true-up**: a batch is held at its worst case and never reduced to what its results
  cost, so a batch over-counts (a cancelled batch most of all). Safe direction, but it uses
  budget room.
- **OpenAI / Perplexity actual cost** — flat estimates, not usage. Perplexity's own telemetry
  (`narrative_cost_guard`) still prices it from usage.
- **Prices** come from `catalyst.cost_guard._PRICING`; a model missing there is priced at the
  dearest known rate (over-count, never $0).

## 4. Modes, and fail-closed

| Situation | ENFORCE | RECORD |
|---|---|---|
| Budget store (auth.db) error while reserving | **refused** `store-unavailable` | call proceeds, count lost |
| No valid day ceiling (unset on Railway with `AI_SPEND_MODE=enforce`, non-numeric, negative) | **refused** `misconfigured` | n/a |
| Call's worst case does not fit under the ceiling | **refused** `daily-cap`, nothing sent | proceeds |
| Retry after a maybe-billed attempt, no room left | **refused** by name, the retry never leaves | proceeds |
| Billable request no reservation covers | **refused** `unmetered` | proceeds |
| Store error while SETTLING a finished call | the reservation stays held (over-count) | count lost |
| Process dies mid-call | the reservation stays held — durable, never released | — |

Mode selection (`ai_spend.mode()`): `AI_SPEND_MODE=enforce|record` decides when set (an
unknown value enforces). Unset: off Railway → **enforce at $10/day** unless
`AI_SPEND_DAILY_CAP_USD=off`; on Railway → **record**, and **enforce as soon as the owner sets
`AI_SPEND_DAILY_CAP_USD`**.

Concurrency: a reservation is ONE `BEGIN IMMEDIATE` transaction that checks the ceiling and
adds the amount, so racing threads and separate processes cannot overspend
(`test_simultaneous_requests_cannot_overspend_the_shared_ceiling`: 12 threads, exactly 5
admitted; `test_separate_processes_share_one_ceiling…`: 4 processes × 4 tries at $1 under $5,
exactly 5 admitted, and their reservations survive the processes exiting).

## 5. Three numbers

`ai_spend.report(day)` → `{day, mode, enforcing, daily_cap_usd, committed_usd, reserved_usd,
confirmed_usd, unconfirmed_usd, remaining_usd, calls, store_ok, features: [{feature, usd,
calls, unconfirmed_usd}]}`, largest feature first.

- **reserved** — held for calls in flight (plus any orphaned by a crashed process).
- **confirmed** — priced from the usage Anthropic reported.
- **unconfirmed** — held at the estimate: timeouts, unfinished streams, batches, OpenAI,
  Perplexity, missing usage.
- **committed** = their sum — what the ceiling bounds.

A feature is the module that made the call (e.g. `api.services.definition_conversation`).
Rows are kept for two ET days. Figures are estimates from the pricing table; the provider's
console is the bill.

## 6. Application settings (all env)

| Variable | Default | Meaning |
|---|---|---|
| `AI_SPEND_MODE` | unset (see §4) | `enforce` or `record`. |
| `AI_SPEND_DAILY_CAP_USD` | unset on Railway; **$10 off Railway** | Day ceiling across every feature. `off`/`none` → record mode; `0` refuses everything. |
| `AI_SPEND_BATCH_CAP_USD` | unset; **$2 when tests run with `ALLOW_LIVE_AI=1`** | Per-process ceiling on reserved + charged dollars (one test batch, one CLI run). |
| `AI_SPEND_FEATURE_MAX_PER_MIN` | 120 | Runaway breaker: calls per feature per 60 s before that feature pauses. |
| `AI_SPEND_BREAKER_COOLDOWN_S` | 300 | How long a tripped feature stays paused. |
| `AI_SPEND_MAX_IN_FLIGHT` | 32 | Concurrent paid calls per process; refused, never queued. |
| `AI_SPEND_DISABLED` | unset | `1` refuses every paid call on that process (emergency stop). |
| `AI_SPEND_ALLOW_REALTIME` | unset | `1` lets enforce mode mint OpenAI Realtime sessions. |
| `AI_SDK_MAX_RETRIES` | 2 (SDK default) | Retries on the shared Anthropic client. |
| `ALLOW_LIVE_AI` | unset | Tests only: lifts the transport block for one run, in enforce mode, held to the batch cap. |

## 7. Enabling production enforcement (owner, when ready — not done)

1. Read a few days of record-mode `ai_spend.report()` after deploy to learn normal daily spend
   (committed and per feature), so the ceiling sits above it.
2. Set `AI_SPEND_DAILY_CAP_USD=<N>` on **every** Railway service that runs AI (web, worker,
   flow-worker, …). Setting it switches that service to enforce; the ceiling is shared through
   auth.db where the services share it, otherwise it applies per database.
3. Decide on `AI_SPEND_ALLOW_REALTIME` (voice realtime stops without it under enforcement).
4. Verify on a fresh boot: the log line `[ai-spend] guard installed (mode enforce, daily cap N…)`.

**When the ceiling is reached**: every further paid call that day raises `AiSpendRefused`
(a `RuntimeError`) before anything is sent; callers that already turn a failed model call
into a fallback show that fallback. Background jobs fail their AI step the same way. The day
resets at ET midnight.

**Emergency stop**: `AI_SPEND_DISABLED=1` on the service (takes effect on its next boot), or
`AI_SPEND_DAILY_CAP_USD=0`. The fastest stop that needs no deploy is revoking or limiting the
key in the provider console.

## 8. Provider settings the owner must configure (manual)

Not set by any code and not touched. Check the exact labels in each console:

1. **Anthropic Console → spend limit** on the workspace holding the production key, sized to
   the intended daily budget × 30 plus headroom.
2. **Usage / spend notifications** at e.g. 50% / 80% / 100%, to an address that is read.
3. **Separate keys (ideally separate workspaces)**: production web, background workers, and
   development/testing — a development key with its own small limit makes the $10/day dev
   ceiling provider-enforced, and makes the Console's usage report attributable by key.
4. **OpenAI and Perplexity** account limits likewise (their spend here is only estimated).
5. Review the Console usage report by key and model for 2026-10-09 → 2026-10-11 to attribute
   the $50; the app-level report starts counting only once this branch is deployed.

## 9. Known cost drivers (from `api/services/ai_doors.py`, 2026-10-11)

- **Indicator builder** (`definition_concierge` / `definition_conversation`, the Agent's
  `indicator.draft`): `claude-opus-5`, `max_tokens` 8,192 — ~$0.23 per call, ~$0.45 worst
  case. W0.4 moved it from `claude-sonnet-5` @ 1,200 ($0.031/call) for truncation and
  sampling-parameter reasons; **no quality comparison between the two exists in the repo**.
- **UCT Agent turns**: `claude-haiku-4-5`; daily cap currently 3,000 turns/member (raised for
  development 2026-10-08; the default is 300).
- **Member doors with no dollar bound of their own**: `journal_two/pre_trade_verdict`,
  `api/routers/earnings.py`, `journal_two/coach` and `trade_review` (regenerate unbounded),
  voice chart vision / embeddings / summarizer and `trader_profile_auto` (per-IP limits only),
  `voice_deep_research` (Claude leg uncapped), `company_about` (cache only). All are inside the
  `ai_spend` ceiling once it is set.
- **Background jobs** spend every day regardless of traffic (catalyst lanes, call recaps,
  theme engine, pattern vision, wisdom extraction, briefings).

## 10. Tests cannot spend by accident

`tests/conftest.py` refuses every real HTTP request to `api.anthropic.com`, `api.openai.com`
and `api.perplexity.ai` (httpx and requests). Mocked clients and `httpx.MockTransport` are
unaffected. A live run needs `ALLOW_LIVE_AI=1`, runs in enforce mode and is held to the $2
batch cap.
