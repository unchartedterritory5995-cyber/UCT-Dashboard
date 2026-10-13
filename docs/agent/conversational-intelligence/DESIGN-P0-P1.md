# UCT Agent — Conversational Intelligence, Phase 0 + Phase 1: technical design (Gate A)

Owner authorization: 2026-10-13 ("Phase 0 + Phase 1 — Authorized to Begin"; option B as an evolution).
Base: `master` = `fdba4c997d` (production `e051fa9721`). Branch: `feat/agent-conversational-intelligence` (C:/w/aconv).
Audit: `docs/agent/intelligence-audit-2026-10-13/` (branch `docs/agent-intelligence-audit`, 9af870cf31).

**Principle.** Everything below *extends* the existing pipeline. All of these stay as they are:
- registry → fast path / model envelope → validator → executor / policy / runtime;
- Undo;
- protected layouts;
- local-only;
- the golden manifest.

No new dependency, no new paid service.

---

## Phase 0

### 0A — Agent inference accounting and the $5/day hard cap

**Today (CONFIRMED).**
- Agent spend goes to `narrative_cost_guard` (surface `uct_agent`). It is not in the site-wide catalyst `cost_guard` lanes.
- The optional `UCT_AGENT_COST_CAP_DAILY` is unset and is checked as a *floor* (spend so far < cap), so concurrent calls can overshoot.
- Tokens are only logged.

**Design: an Agent spend ledger with reservations** (`api/services/uct_agent/budget.py`, new).
- **Durable state.** Table `agent_spend` in the Agent store (`UCT_AGENT_DB_PATH`, already durable on the web volume) with columns: `id, et_day, user_id, category, model, status(reserved|settled|released), reserved_usd, actual_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, outcome, created_at, settled_at`.
- **Reserve before any paid call** (`BEGIN IMMEDIATE`, one SQLite write transaction, so it is concurrency-safe across threads and processes on the volume):
  - `committed = Σ settled.actual + Σ reserved.reserved` for today;
  - admit only if `committed + worst_case ≤ cap`, else refuse before the call.
- **Worst case per call:**
  - `est_input_tokens` = request bytes ÷ 3, priced as uncached input (no cache discount assumed);
  - plus `max_tokens` at the output price;
  - plus the research fee when research is possible;
  - prices come from the existing pinned table.
- **Settle after the call** with the provider's usage (input, output, cache read and write).
- **Missing usage** (timeout, exception, no `usage`): the reservation is settled **at the worst case**.
- **Crash between reserve and settle:** an unsettled reservation keeps counting at its worst case for the rest of the day.
- **Result:** the cap is never exceeded, not even by the last admitted call.
- **Order of checks:** the existing per-member *count* cap, then the $ cap, then the population cap.
- **Exhaustion** gives one plain sentence: "UCT Agent has reached today's AI budget, so I can't interpret new requests until tomorrow. Charts, breadth and other instant commands still work." Deterministic paths never touch the ledger, so they keep working.
- **Visibility:** an admin GET `/api/agent/budget` returns today's committed, cap and remaining amounts (aggregates only), plus tokens and model.

**⚠ Decision needed: "under the site-wide budget".** The site-wide `cost_guard` is a $15/day ceiling split into a $4 *interactive* reservation (indicator builder, image) and $11 *background* (catalyst synthesis, which by itself spends about $9.6–11.3 on trading days). Each side is checked against its own spend before a call. Options:

| Option | What happens | Effect on others | Change size |
|---|---|---|---|
| **1. Agent own cap + respects the site total (read-only)** | The Agent ledger enforces $5. The Agent also refuses when the site-wide total ≥ $15. Agent spend is *not* added to the site ledger | None: catalyst and builder behave exactly as today | Small |
| 2. Agent as a third lane inside $15 | `cost_guard` gains an "agent" lane of $5; $15 = $4 interactive + $5 agent + $6 background | Background drops from $11 to $6, so catalyst synthesis would pause most afternoons | Medium (shared-code change) |
| 3. Agent as a third lane, ceiling raised to $20 | $20 = $4 + $5 + $11 | None, but the site-wide maximum rises by $5 | Medium |
| 4. Agent shares the $4 interactive reservation | The Agent and indicator builder share $4 | The Agent can't reach $5; it can starve the builder | Small, but conflicts with the $5 cap |

**Recommendation: Option 1 now** (safe, no change to other lanes). Agent spend is reported beside the site-wide figures. Option 3 later if the owner wants one combined ledger.

### 0B — Rate limits and execution budgets (provisional values, all env-configurable)

| Control | Default | Applies to |
|---|---|---|
| Model-turn rate per member | 20 / minute, 300 / hour | `/api/agent/turn[/stream]` only |
| Model turns in flight per member | 1 (a second turn while one runs → "Still working on your last request") | turn routes |
| Global model-turn rate | 120 / minute | turn routes |
| Model calls per request | ≤ 2 (a reroute or a read round counts) | browser + server |
| Wall clock per model call | 60 s (exists) | server |
| Deterministic Agent data routes (`/api/agent/breadth*`, `/record`, `/conversations`) | 240 / minute per member | never the chart ops (they don't touch the server) |

**Implementation.** An in-process sliding-window limiter plus the existing durable daily counters. Web is a single service; the durable caps are the hard guarantee. A 429 response carries a plain sentence and `Retry-After`.

### 0C — Routing foundation: one normaliser in front of both paths

New `app/src/agent/nl/normalize.js` (pure, deterministic). It produces `{text, canonical, notes}`:
1. **Discourse stripping** (meaning-preserving only): "actually", "please", "can you", "could you", "now", "ok", "hey", leading "so/and", trailing "please / thanks".
2. **Canonical rewrites** from a small, reviewed table, not per-phrase regexes. Each maps to a form the existing matchers already accept:
   - "show me the weekly" / "switch it to weekly" → "weekly";
   - "on it" / "on there" → "on this chart";
   - number words → digits;
   - "the 9 and 20" → "the 9 and the 20";
   - "% / percent / pct" unified.
3. **Typo correction** (existing lexicon) applied *before* routing too, not only to the fast path (N6).
4. **Vocabulary tagging** (§1B): domain concepts found in the text ("semis", "pullback", "breadth") tag the routing groups.

**Routing** then uses group words, plus vocabulary tags, plus a **catalog index**: a one-line title per *unsent* group already in the request (`routing.groups`), which the prompt states the model may request.

**Guarantees:**
- The normaliser may only change *how* a message is matched, never what an ambiguous message means.
- A normalised message that matches nothing still goes to the model unchanged (the original text is what the model sees).
- WRONG stays 0 on the dev, held-out and adversarial sets (enforced by `agentEvalBaseline.test.js` and `agentNlCorpus.test.js`).

### 0D — Baseline evaluation (layer A; free)

`app/src/agent/agentEvalBaseline.test.js` scores:
- the dev corpus (195);
- the held-out set (`__fixtures__/nlIntent/heldout-v1.json`, written without reading the matchers), including adversarial cases.

It reports deterministic coverage, deterministic accuracy, wrong actions, unnecessary clarifications, model calls per case (including routing-forced reroutes, computed with the real `routeManifest` over the real manifest and limits), and fast-path latency. Results are saved per commit under `docs/agent/conversational-intelligence/`.

Layer B (scripted multi-turn conversations through the real panel) is added in Phase 1. Layer C (real model) is **not run** (no paid inference).

---

## Phase 1

### 1A — Session memory and references (`app/src/agent/memory.js`, new)

**Contents** (browser, in memory per conversation; *never* written by the model):
```
results:  [{ set, source, at, sort, items: [{ i, sym }] ≤ 50 }]      last 3 result sets (screen, list, scan)
subjects: { chart: ref, indicator: { chart, id, name, inputs }, screen, list, breadth }
last:     { action, target, undoId, at }                              the last successful change
```
**Writers.**
- The executor and query answers: a screen result registers its ordered symbols; an `indicator.add` registers the instance id it created; a symbol switch registers the chart.
- Failures and proposals register nothing.

**Validation before any mutation.**
- A chart ref must still exist on the same board epoch.
- An indicator id must still be on that chart.
- A result set must belong to this conversation.
- Stale → one short question, never a silent target.
- Expiry: 30 minutes, a layout switch, or a new chat. Reload clears it (session-only by design).

**References.**
- Deterministic ordinals: "the third one", "#3", "number 3", "the last one", "the top one / the first one".
- "it / that / this" by kind (chart → selected or subject chart; indicator → subject indicator; list → subject list).
- "the others" (the set minus the subject).

**To the model.** A compact `memory` context block (refs and ≤ 20 symbols, no values); the model may emit `{ref:"s3[3]"}` style arguments, validated like any target.

**Reference arguments.** `chart.setSymbol`, `chart.compare`, `watchlist.add` and the indicator ops accept `{from, pick}` (generalising `compose.js` refs). "Open the third one" switches the chart Open-chart-v2 style: one chart → switch; several → the existing "which chart?" choice, unless deixis or the subject chart resolves it.

### 1B — Trading vocabulary (`app/src/agent/vocabulary.js`, data, not code)

Each concept has these fields:
- `{ id, words, status: approved|proposed, definition, interpretations[], expansion, assumption }`;
- `expansion` is a screener spec (filters and sort) or an indicator spec.

**Rules:**
- Only `approved` concepts expand deterministically.
- A `proposed` concept is never executed silently. The model may only use it while stating the assumption, behind the review gate (default **off** until the owner approves).
- Thresholds are never invented: only threshold-free or purely definitional concepts are approved here.

**Proposed approval set (v1; no numeric thresholds):**

| Concept | Interpretation | Why low-risk |
|---|---|---|
| relative strength / strong / strongest / leaders | **rank** by RS Rank, descending (no cut-off) | a ranking, not a threshold |
| weak / weakest / laggards | rank by RS Rank, ascending | same |
| above / below the N-day MA | `pct_vs_{ema|sma}N > 0` / `< 0`, MA type per the default below | definitional |
| momentum (as a sort) | rank by 1-month return | a ranking |

**Behind the review gate (definitions proposed for the owner; not executed until approved):**
- outperforming (vs SPY, period?);
- holding up (drawdown vs index, period?);
- pullback (to which MA, how deep?);
- near a moving average (band ±?%);
- breakout (new N-day high on volume ≥ ?×);
- trend / uptrend (price > 50 > 200 SMA?);
- consolidation (N-day range ≤ ?%);
- default MA type for bare numbers ("the 9 and 20": EMA or SMA?).

The full write-up of interpretations and trading implications is in `VOCABULARY-PROPOSALS.md`.

### 1C — Edit in place

- **`indicator.update`** (new capability, indicators group): change an existing instance's inputs (length / period, source) and plot colour.
  - Target: the instance id (from context or memory).
  - It goes through the chart target kind, so Undo is exact and compensation is unchanged.
  - Deterministic for "make it a 9 / change the 20 to a 50" when the subject indicator is unambiguous.
- **Reuse the current chart** for "open the third one" (above).
- **No duplicate indicators:** an edit request with a resolvable subject never becomes an add.

### 1D — Intent improvements
The normaliser (0C) plus references (1A) plus vocabulary (1B) feed both paths. Unsupported requests are said plainly. Multi-part requests use the existing clause splitter and per-clause matching.

### 1E — Conversational experience (no extra model calls)
- An `assumptions` line under results when a concept or default was applied.
- Natural receipts composed from results.
- A "next useful action" offered only where the result invites it (a screen → "Open the top one?"); never after an explicit command.
- Freshness labels unchanged.

---

## Gates and evidence

| Gate | Evidence |
|---|---|
| A | This design; baseline report (`baseline-<sha>.json`); decisions below |
| B | Ledger tests: concurrent reservations (threads), restart persistence, missing usage, exhaustion; deterministic requests with no model / no budget; rate-limit tests; dev + held-out WRONG = 0 |
| C | Layer-B multi-turn conversations, stale-reference tests, no wrong chart or indicator mutations |
| D | Approved vocabulary only; `indicator.update` Undo and rollback; chart-state consistency |
| E | Full suites; held-out comparison with the baseline; no paid calls (no API key in the test environment, and a test that fails if the Anthropic client is constructed) |

## Decisions requested at Gate A
1. **0A site-wide integration:** Option 1 (recommended), 2, 3 or 4.
2. **0B rate-limit defaults** as above (provisional; env-configurable).
3. **1B approval:** approve the threshold-free v1 concepts (ranking-based strong/weak/momentum; definitional above/below MA)? The rest stay behind the review gate.
4. **Default MA type** for bare numbers ("put the 9 and 20 on"): EMA or SMA.
