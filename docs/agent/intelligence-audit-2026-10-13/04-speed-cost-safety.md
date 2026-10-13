# 04 — Speed, cost and safety (Parts 8, 11, 12)

## 1. Speed (Part 8)

### Measured in production (CONFIRMED)

Source: the `[uct-agent] turn timing` log lines of every web deployment since 2026-10-10. There are 50 model turns, 48 of them on 2026-10-13. The data is timing and token counts only.

| Stage | p50 | p90 | max |
|---|---|---|---|
| Server total (model path) | 3,166 ms | 7,728 ms | 10,002 ms |
| Model call | 2,874 ms | 7,565 ms | 9,748 ms |
| Pre-model server work (caps, store, build) | 93 ms | 492 ms | — |
| Uncached input tokens | 5,151 | 6,379 | 8,249 (mean 5,388) |
| Output tokens | 110 | 299 | 311 (mean 133) |

- Every turn made exactly 1 model call. No turn used web research.
- Prompt-cache reads happened on **25 of 50** turns, about 12k tokens when they hit.
- This corrects `docs/agent/LATENCY.md:94-96`, which expected caching to be ineffective.

**Deterministic path, measured locally** (`agentBreadthTiming.test.jsx`, `agentBreadthSelection.test.jsx`):
- Agent-own time is **15–61 ms per request**.
- Production server time for warm breadth reads is **29–162 ms**. Cold reads after a deploy took 9–10 s before the 2026-10-13 Breadth fixes; restore now brings live readings back in ≤ 63 s after a restart.

**Not measured:**
- streaming first-token latency (streaming is off);
- browser-side time to first render in production;
- multi-step (reroute) latency.

**Observations:**
- Model time dominates (> 90% of a model turn).
- The prompt is large (5–12k tokens) because routing sends up to 55 action schemas, 23 context blocks and 12 turns of history.
- Reroutes (`need_groups`) double the model time and cost; routing misses make them common for paraphrases (03 §2).
- Fifty turns is a small sample. The p90 should be re-measured on a larger window.

### Proposed latency targets (PROPOSAL)

| Class | Target | Basis |
|---|---|---|
| Deterministic (fast path + local data) | Agent-own ≤ 150 ms p95; end to end ≤ 500 ms p95 with warm data | measured 15–61 ms + 29–162 ms |
| Model-assisted (single call) | p50 ≤ 3.0 s, p90 ≤ 6.0 s; visible feedback ≤ 100 ms | measured p50 2.9 s, p90 7.6 s; needs a smaller prompt to get p90 down |
| Multi-step with one read round | p50 ≤ 6 s, p90 ≤ 10 s, with step progress | not measured; design target |

**Levers, ranked by expected effect (HYPOTHESIS until measured):**
1. More requests deterministic (fast-path near-misses; concepts; references).
2. Fewer reroutes (catalog index plus lexicon-normalised routing).
3. A smaller stable prompt prefix, ordered for cache hits (schemas first, volatile context last).
4. Streaming answers, after real-model verification.
5. Trim history to structured memory plus the last 4 turns.

## 2. Cost (Part 11)

### Current dependencies (CONFIRMED)

| Use | Model | Settings | Caps |
|---|---|---|---|
| Agent turn | `claude-haiku-4-5` (default; `UCT_AGENT_MODEL` unset in production) | 2048 max tokens; structured output; cache_control on the system prompt | 3000 turns / member / day in production (`UCT_AGENT_DAILY_CAP`); **$ cap not set** (`UCT_AGENT_COST_CAP_DAILY`); population cap mode off |
| Chat naming | Haiku 4.5 | 64 max tokens, background | — |
| Research | Perplexity `sonar-pro` + $0.006 per request | ≤1 per turn | `PERPLEXITY_DAILY_LIMIT` 500 |
| Indicator builder (concierge / converse) | `claude-opus-5` | 8192 max tokens, ≤2 calls | $0.75 / member / day; admin $10 |
| Screener NL compile (not used by the Agent) | `claude-opus-5` | 4096 max tokens | 30 / member / day; **not ledgered** |

**Price table in code** (`api/services/catalyst/cost_guard.py:31-72`, mirrored in `narrative_cost_guard.py`, pinned by `tests/test_narrative_cost_guard_prices.py`):
- Haiku 4.5: $1 per million input tokens, $5 per million output.
- Opus 5: $5 input / $25 output.
- Cache read: 0.1× input. Cache write: 1.25× input.
- These are the repository's prices. Verify them against current Anthropic pricing before budgeting.

### Measured cost per Agent model turn (CONFIRMED arithmetic over the 50 turns)

`cost = in×$1e-6 + out×$5e-6 + cache_read×$0.1e-6` gives **mean $0.0066, p90 $0.0081, max $0.0098**.

Cache *writes* are not logged. A turn that writes the ~12k-token prefix adds about $0.015. A realistic range is therefore **$0.007–0.014 per model turn** (HYPOTHESIS: depends on the write frequency).

### Scenario model (formula + assumptions, not invented totals)

Let:
- `N` = Agent requests per day;
- `f` = share that needs a model call;
- `r` = reroute rate on model requests;
- `c_t` = cost per model turn;
- `b` = share of requests that are indicator drafts;
- `c_b` = cost per draft (the builder's own worst case is $0.454 for 2 Opus calls, `definition_concierge.py:138`; the typical value is not measured).

`daily ≈ N·f·(1+r)·c_t + N·b·c_b + research`

With `r` = 0.1 and `c_t` = $0.007–0.014:

| N / day | f = 30% | f = 50% | f = 80% |
|---|---|---|---|
| 100 | $0.23–0.46 | $0.39–0.77 | $0.62–1.23 |
| 1,000 | $2.3–4.6 | $3.9–7.7 | $6.2–12.3 |
| 10,000 | $23–46 | $39–77 | $62–123 |

The indicator builder is the dominant risk. At `b` = 2% and worst case $0.454, N = 1,000 adds **up to $9.1 per day**; N = 10,000 adds **up to $91 per day**. Per-member caps ($0.75 per day) bound it per person, but not the population.

**Infrastructure.** No new infrastructure is needed for the recommendation. Read-tool data comes from existing paid GETs; market-data provider costs are already sunk.

### Spending controls (PROPOSAL)

1. **Set `UCT_AGENT_COST_CAP_DAILY`** and put Agent spend into the `cost_guard` interactive lane. Today the Agent spends outside the $15 / $4 budget (`turn.py:889-894`, `cost_guard.py:106`).
2. **Store tokens per turn** (in, out, cache read, cache write) in `agent_telemetry`. Today they are only in logs.
3. **A model-call budget per request:** ≤2 calls (one reroute or one read round).
4. **Prompt diet:** a stable cached prefix, a structured memory instead of prose history, and a catalog index instead of full schemas for unrouted groups.
5. **Prefer deterministic paths.** Track `f` as a first-class metric.
6. **Ledger screener NL** if it is ever used by the Agent. Keep Opus out of the Agent turn.
7. **Graceful degradation:** model unavailable → deterministic answers still work, plus one plain sentence (shipped 2026-10-13).
8. **Cost visibility:** a small admin view of daily Agent spend, turns, `f`, `r` and cache hit rate.

## 3. Safety, permissions, reliability (Part 12)

CONFIRMED strengths:
- **Access:**
  - every `/api/agent/*` route is `require_admin_dark` (paid + admin);
  - the browser flag is admin-only;
  - closed schemas; manifest size limits;
  - message ≤ 2000 characters; context ≤ 24 KB.
- **The model never executes.** TALK dispositions carry no ops. Unknown actions and targets are refused or clarified, and plans of more than 12 ops are refused.
- **Local-only data:**
  - breadth values never return to the model;
  - unreadable rows are treated as local;
  - research is blocked for breadth questions;
  - the model's reply on local plans is replaced.
- **Prompt injection:**
  - input blocks are HTML-escaped and declared as data;
  - research can only answer, never mutate;
  - mixed changes are planned before research.
- **Execution safety:**
  - protected layouts (Main Trading);
  - fingerprinted Undo;
  - compensation on failure;
  - read-back verification;
  - claim filtering ("Done." stripped).
- **Hallucination guards:**
  - symbols checked against ticker search;
  - breadth answers from data only;
  - provisional / finalized labels.

Findings:

| # | Finding | Severity | Proposal |
|---|---|---|---|
| S1 | Agent spend is outside the global cost guard; no $ cap is set | Med (cost) | Lane + cap (above) |
| S2 | No per-minute rate limit on Agent routes (daily cap only; 3000 per day in production) | Med before member rollout | Per-member token bucket |
| S3 | Outcome kinds are written by the client (`/api/agent/record`), so the audit trail trusts the browser | Low (admin-only today) | Server-derived outcome kinds before member rollout (`ROADMAP.md:142`) |
| S4 | Streaming uses a thread per turn (unbounded) | Low (off) | Bound before enabling for members (`LATENCY.md:229`) |
| S5 | Research disclosure and the https-only citation filter are still open | Low | Rollout prerequisites (`ROADMAP.md:140-146`) |
| S6 | Working memory (proposed) adds a stale-reference risk | Design | Validate every ref against live workspace state; ask when stale |
| S7 | Read tools (proposed) widen what reaches the model | Design | Decide per tool: local-only or model-visible (owner decision) |
| S8 | AI Search and the voice tools are parallel assistants with their own tool layers | Design | Choose a direction before adding read tools twice |
| S9 | Cross-user data: Agent stores are keyed per user (`store.py`); no cross-user reads found | OK | Keep; add tests when members get access |
