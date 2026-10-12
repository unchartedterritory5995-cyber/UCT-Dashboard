# UCT Agent — response-time optimization (2026-10-12)

Branch `perf/agent-latency` (worktree `C:/w/agperf`), based on production master `382606e92c`.
LOCAL ONLY — nothing pushed, merged or deployed; no paid model calls were made.

## What is measured, and what is NOT

| Evidence | Source | Real or simulated |
|---|---|---|
| Serial network waits before the first useful output, model calls per request, request order | `app/src/agent/agentLatency.test.jsx` — the REAL panel, fast path, router, planner, runtime, receipts and Undo against a production-shaped host (board check + save acknowledgement go through `fetch`, as `host.js` does) | **Structural facts** (counts and order are exact; the network is a fixed 25 ms stand-in per hop) |
| Browser-side work (ms) | same benchmark, jsdom | Real code, jsdom timing (indicative only) |
| Server work around the model (auth excluded) | real router + real SQLite stores, model replaced by a 0 ms fake (scratch `serverbench.py`) | Real code, local disk |
| Prompt size, cacheability, schema churn | the captured request bodies run through `turn.run_turn` with a capturing caller | Exact characters; tokens **estimated** (chars/4 – chars/3) |
| Model time, first-token time, output speed, cache hits | — | **NOT MEASURED** (no paid calls; production telemetry read was not authorized — see "Owner actions") |
| Streaming gain | benchmark with a SIMULATED generation timeline shared by both modes | **Simulated** — proves *when* text appears relative to generation, not production seconds |

Nothing here proves a production latency improvement. The projections below state their assumptions.

## The request lifecycle, instrumented

Browser — `trace.js` TURN TRACE, one per member action (message, Apply, Undo, choice), memory only
(`window.__uctAgentTurns()`): `visible` (member line + "typing…" rendered), `output` (first useful output:
answer, receipt, proposal, question, refusal, or the first streamed text), `done` (panel idle), and phase
marks (`route`, `context:refreshed`, `context:built`, `turn:sent`, `turn:received` + the server's stages,
`turn:first-delta`, `board:synced`, `commit:start/end`, `persist`). A local turn's time to first useful
output now rides the existing content-free telemetry row (`agent_telemetry.latency_ms`, browser rows).

Server — `/api/agent/turn` returns and logs (`[uct-agent] turn timing {...}`, numbers only)
`stages = {pre, build, model: [ms per call], research, post, server}` plus `model_calls`,
`cache_read_tokens`, `cache_write_tokens`.

```
Enter ─► fastParse ─hit─► [ticker check] ─► board check GET ─► commit ─► save POST×2 ─► receipt
   │                                   (D2: in parallel)                 (D1: once, not twice)
   └miss─► route ─► refreshContext (≤1.5 s, routed groups) ─► buildContext ─► POST /turn
              server: caps+store (pre) ─► build prompt ─► MODEL ─► [research ─► MODEL] ─► store (post)
              ─► answer | question | proposal | plan ─► execute (as above) / local lookup (breadth, stock)
```

## Baseline (production code `382606e92c` + instrumentation only)

5 runs × cold/warm per category, simulated 25 ms hops (`p50` in simulated ms; hops/model calls exact):

| Category | Path | Serial waits | Model calls | TTFU p50 cold/warm | Critical path |
|---|---|---|---|---|---|
| Switch timeframe | fast | 2 | 0 | 123 / 121 | board GET → save POST |
| Change symbol | fast | **3** | 0 | 137 / 137 | ticker search → board GET → save |
| Add indicator | fast | **3** | 0 | 199 / 199 | board GET → save (commit) → **save again** |
| Undo | local | 2 | 0 | 104 / 90 | board GET → save |
| Current breadth | fast | 1 | 0 | 29 / 28 | POST /breadth |
| Historical breadth | model | 2 | 1 | 123 / 122 | /turn → /breadth |
| Market data (profile) | model | 3 / 2 | 1 | 157 / 121 | [refresh] → /turn → fundamentals+quote (parallel) |
| Research | model | 1 | 1 (server: 2 + web search) | 230 / 230 | /turn (server: call, search, call) |
| Explain (long answer) | model | 1 / 2 | 1 | 138 / 167 | [refresh] → /turn |
| Clarification | model | 1 | 1 | 92 / 90 | /turn |
| Approval (proposal) | model | 1 | 1 | 94 / 92 | /turn |
| Apply an approval | local | 0 | 0 | 91 / 74 | in-memory |

First visible feedback was already immediate in every category (p50 ≤ 10 ms: the member's line and
"UCT Agent is typing…" render on Enter).

Server work around the model (60 turns, real stores, 0 ms model): `pre` p50 26 ms / p95 79 ms (caps +
4–6 SQLite opens + 2 commits), `build` < 1 ms, `post` p50 15 ms / p95 65 ms. Auth is not included.

Prompt per model call (exact chars; tokens estimated):

| Routed groups | Actions | System prompt | Est. input tokens | ≥ 4,096-token cache minimum? |
|---|---|---|---|---|
| breadth + agent | 2 | 13.4 k chars | 5.0 k – 6.6 k | borderline (3.3 k – 4.5 k system) |
| data + agent | 6 | 14.4 k | 5.5 k – 7.3 k | borderline |
| lists + agent | 10 | 15.9 k | 6.0 k – 8.1 k | borderline |
| charts + lists + agent | 31 | 25.5 k | 7.7 k – 10.3 k | yes |
| **nothing recognised → full catalog** | **54–55** | **39 k** | **11 k – 15 k** | yes |

Each routed group set is a different system prompt AND a different output schema: the prompt cache and the
structured-output grammar cache (24 h) are per combination.

## Bottlenecks, ranked

1. **Model generation time on the model path (dominant; inferred, not measured).** Every model-path request
   waits for the whole JSON envelope, reply included, before anything is shown. A detailed answer is
   hundreds of output tokens. Research turns pay call → web search → call, all before any text.
   *Most likely cause of the observed 8–10 s: research turns and long answers.*
2. **Input size on routing misses.** A question the router does not recognise ("how do bull flags work?",
   "what's AMD's P/E?") carries the full catalog: ~2.5× the input tokens of a routed one (cost and
   first-token time).
3. **Serial network waits on deterministic commands.** The board check (GET of the WHOLE preferences
   blob) and the save acknowledgement (2 POSTs) are both on the critical path; a symbol change added a
   ticker search in series (~2 s once measured in production, `agentClient.js`), an indicator change saved twice.
4. **Context refresh before the model** (alerts / saved screens / digest) — one more round trip when routed
   (or unrouted) to those groups.
5. **Server bookkeeping** (~40 ms p50 around the model, < 5 % of a model turn).
6. Prompt caching likely ineffective: Haiku 4.5's minimum cacheable prefix is 4,096 tokens and most routed
   system prompts sit at 3.3 k – 5.3 k; low admin traffic rarely re-hits a 5-minute entry. Now measurable
   (`cache_read_tokens`).

Not bottlenecks: first visible feedback, browser planning (≤ ~100 ms in jsdom), duplicate requests (none
found), retries (zero by design: `max_retries=0`).

## What changed

| # | Change | Where | Safety argument |
|---|---|---|---|
| I | Turn trace + server stage timings + timing log + fast-path latency in telemetry | `trace.js`, `useAgent.js`, `turn.py`, `routers/uct_agent.py` | Numbers and phase names only (test: the log line has no words) |
| D1 | An indicator change is saved ONCE: a target kind whose commit already saved and read back its change (`persistsInCommit`) skips the second identical board write (Apply and Undo) | `useAgent.js`, `indicatorEdits.js` | Only when EVERY changed target is such a kind; indicator commits already require an authoritative read-back |
| D2 | The board's cross-session check starts beside planning's lookups (ticker search), not after them | `useAgent.js` | Same check, same refusal, still before any write; a proposal/refusal just wastes one read |
| D4 | The board check asks for only its 2 keys (`GET /api/auth/preferences?keys=…`) | `host.js`, `routers/auth.py` | Server reads them exactly as before (same store, same document head, same headers); no `keys` → byte-identical response |
| M3 | Chat title and telemetry row written after the reply is sent (background tasks) | `routers/uct_agent.py` | The transcript row stays before the reply (history order); titles/telemetry never fed a reply |
| S | **Streaming (flag `UCT_AGENT_STREAM`, default OFF):** `POST /api/agent/turn/stream` (SSE). An ANSWER's reply streams as written into one provisional line that the final envelope replaces; a web search is announced ("is looking that up on the web…") and retracts placeholder text | `turn.py` (`ReplyStream`), `routers/uct_agent.py`, `agentClient.js`, `useAgent.js`, `AgentPanel.jsx`, `main.py` (GZip exempt) | See "Streaming safety" |

### Streaming safety (all pinned by `tests/test_uct_agent_latency.py`, `agentStreaming.test.jsx`)

- Only a call whose disposition is already `answer` streams (it precedes `reply` in the schema); a reply
  written before its disposition never streams. Plans, proposals, questions and refusals never stream —
  so a local-only breadth lookup (always a plan) can never put a word, let alone a value, on the wire early;
  its reply is still blanked (sentinel test).
- The first 160 characters are held and checked with the SAME claim rule `sanitize_envelope` applies to
  answers; a reply that claims work never streams and still ends as `NOTHING_DONE`.
- A question UCT will force-research never streams its from-memory first answer; a model-requested
  research placeholder that did stream is retracted before the search; mixed requests (a change planned
  before research) never stream.
- The final envelope is the authority: the browser replaces the streamed text with it, or removes the
  line if the turn ends as anything but an answer, on error, or on a dropped connection.
- Flag OFF: the browser never calls the stream route (it asks `GET /api/agent/config` once); the
  transport is unchanged. Kill switches: server env, and `localStorage['uct.agent.stream']='0'` per browser.

## Results (same benchmark, 5 runs each — simulated hops and generation)

| Category | Serial waits before → after | TTFU p50 (sim ms) baseline → optimized → +streaming |
|---|---|---|
| Change symbol | **3 → 2** | 137 → 105 → 107 (cold); 137 → 106 → 92 (warm) |
| Add indicator | **3 → 2** | 199 → 151 → 152 (cold); 199 → 153 → 138 (warm) |
| Switch timeframe / Undo | 2 → 2 | unchanged within noise |
| Explain (long answer) | 1 → 1 | 138 → 138 → **107** (first text; the full answer is not earlier) |
| Research | 1 → 1 | 230 → 231 → **199** first text; the search is announced before it |
| Breadth, market data, clarify, approval | unchanged | unchanged within noise (not answers → nothing streams) |

Model calls per request: unchanged in every category (0 / 1; research 2 server-side). Tokens: unchanged —
streaming sends the same request. No request became slower in any structural measure; the benchmark's
"done" is later in streaming mode only because its simulated server shares the browser's thread (the
browser's lag after the final event is ~0 ms in both modes).

### Projection to production (assumptions, NOT measurements)

Assume: RTT 80–150 ms per hop; Haiku 4.5 first token 0.5–1.0 s at 5–15 k input tokens; 100–150 output
tokens/s; a detailed answer 300–500 tokens; a Perplexity "fast" search 1.5–3 s.

| Request | Before | After |
|---|---|---|
| Change symbol | ticker search + board read + save, in series | one hop less (the ticker search, ~0.1–2 s, hides behind the board read) |
| Add / remove indicator | board read + save + save | one save round trip less (~0.1–0.4 s) |
| Long answer | first text ≈ whole generation (≈ 3–5 s) | first text ≈ first token + 160 chars (≈ 0.8–1.5 s) |
| Research | first text ≈ call + search + whole second call (≈ 6–10 s) | "looking that up" at the end of call 1 (≈ 1–2 s); first answer text ≈ 3.5–6 s |

### Cost

Per model call ≈ input 5 k – 15 k tokens ($0.005 – $0.015 at $1/MTok) + output 100 – 600 tokens
($0.0005 – $0.003 at $5/MTok); a research turn ≈ 2 calls + one shared-pool web search; a routing miss ≈ 2
full turns. **Nothing in this branch adds a model call, a token or a provider.** The full-catalog prompt on
routing misses is the largest avoidable cost (≈ $0.006–0.010 per such call) — see recommendations.

## Remaining bottlenecks and recommendations (not implemented)

1. **Measure the model (owner authorization needed).** `tools/agent_latency_probe.py BODIES.json --run
   --max-usd 0.70` — 7 representative requests × plain/streamed, worst case $0.69, prints timings/tokens/cost
   only. Then turn `UCT_AGENT_STREAM=1` on in production (admin-only) and read the timing log + telemetry.
2. **Routing misses send the full catalog.** A narrower default for messages that are plainly questions
   (agent group + named groups, so the model can still ask for more) would cut input ~60 % on those turns —
   at the price of an extra call when a command was not recognised. Needs the reroute rate from telemetry first.
3. **Model choice.** A newer small model may be faster/cheaper per token, but changes thinking defaults and
   behaviour: only after a paid A/B on the Agent's eval set.
4. **Refresh before the model**: start `refreshContext` while the member types, or reuse a refresh younger
   than a few seconds — one round trip on alerts/screener/settings turns; a freshness trade-off to decide.
5. **Known-symbol seeding**: symbols already on the member's charts / lists could skip the ticker search entirely.
6. Prompt caching cannot help much on Haiku 4.5 at these sizes (4,096-token minimum); revisit with telemetry.

## Owner actions

- **Production telemetry (aggregate-only, read-only):** `railway ssh --service web "python tools/agent_latency_telemetry.py"`
  — counts, p50/p90/p95, research share, reroute rate, cost by path; no text. (This session's attempt to
  read it was blocked as a production read.)
- **Real-model probe:** authorize a paid run of `tools/agent_latency_probe.py` (≤ $0.70).
- **Release:** D1/D2/D4/M3/I are behaviour-preserving and active on deploy; streaming deploys dark
  (`UCT_AGENT_STREAM` unset). Activate per the probe's results; roll back by unsetting the variable.

## Coordination (Indicators ⇄ Agent integration, `C:/w/agind`)

Shared files touched here: `useAgent.js` (push/record/exclusive/send start-finally, `executeInner`
board check + save, model-path `ask` + streamed line, `activity` in the hook's return), `AgentPanel.jsx`
(typing line text only), `host.js` (board read URL), `capabilities/indicatorEdits.js` (one inert kind
flag, `persistsInCommit: true`). No indicator UI or contract changed. Interfaces added: `useAgent().activity`,
`agentClient.agentTurnStream / loadAgentConfig / serverStreams`, target-kind flag `persistsInCommit`.
Trial merge (2026-10-12): the Indicators session's working tree (`C:/w/agind`, 17 files, uncommitted
on `feat/agent-indicator-builder` = 382606e92c) applied onto `e392b229b4` with no conflicts; on the
combined tree the Agent suite + `agentRoute.test.jsx` pass (65 files, 1078 tests, 4 skipped), including
the latency budgets. Whoever lands second re-runs `agentLatency.test.jsx` (its budgets are the contract).

Reproducing the baseline: commit `d4c47ae1e3` is production `382606e92c` + instrumentation only; run
`AGENT_LATENCY_OUT=… npx vitest run src/agent/agentLatency.test.jsx` there and at this branch's head
(`AGENT_LATENCY_STREAM=1` for the streamed mode).
