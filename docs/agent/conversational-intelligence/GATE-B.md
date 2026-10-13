# Gate B — Phase 0 implementation report (2026-10-13)

Branch `feat/agent-conversational-intelligence` (C:/w/aconv), based on `fdba4c997d`. **Local only.** Nothing has been pushed or deployed, and no paid model calls were made.

## Commits
| Commit | What |
|---|---|
| `24dc391fb2` | Gate A: baseline harness, held-out v1, design, vocabulary proposals |
| `1c4bbc9111` | 0A/0B server: spend ledger with worst-case reservations, site-wide stop, 2-call ceiling, rate limits, `GET /api/agent/budget` |
| `8bfca051f8` | Safety: name collisions never picked instantly ("open swing", "remove momentum"); unknown tickers get a suggestion, never a substitute ("amzon") |
| `4a8368b094` | 0C: meaning-preserving normaliser, soft trading vocabulary, live-name and typo-aware routing; held-out v2; before/after JSON |
| `02ed717f1d` | Panel test: paid-inference refusals while instant commands keep working |

## 0A — Agent spend (owner decision: option 1)
- **Hard cap:** `UCT_AGENT_BUDGET_USD`, default $5 per ET day. Blank, 0 or garbage means $5, never unlimited.
- **Reserve and settle:** every paid call reserves its worst case in one `BEGIN IMMEDIATE` transaction on the Agent store before the call, and settles from the provider's usage after. Paid calls are: the turn, the schema retry, research, the after-research call, the reroute and the chat-naming call.
  - The worst case counts every request byte as a token, plus 4,000 tokens of framing, all priced at the cache-write rate, plus `max_tokens` of output. Research is priced at the dearest search rate times 4 attempts.
- **Conservative settlement:**
  - Missing usage or a timeout settles at the worst case.
  - A reservation that is never settled (the process died) keeps counting at its worst case.
  - A provider HTTP error response (nothing generated, nothing billed) releases the reservation.
- **Fails closed:** if the ledger can't be read or written, the paid call is refused.
- **Site-wide stop:** the Agent refuses paid calls once the catalyst ledger total reaches `CATALYST_COST_HARD_CAP` ($15). This is a read-only check. Agent spend is never written to that ledger, so the indicator-builder, image and synthesis budgets are untouched.
- **Tracked per call:** model, category, input / output / cache-read / cache-write tokens, estimated and actual cost, and outcome.
- **Admin view:** `GET /api/agent/budget` (aggregates only).

## 0B — Limits (provisional, environment-configurable)
**Accounting rules:**
- A *member request* is one message sent to the model path (`/turn` without `reroute`). Its reroute and its naming call belong to the same request.
- A *model call* is one admitted paid Messages call that the provider did not reject.

**Limits:**
- At most 2 model calls per member request, enforced inside the same transaction as the reservation. A research lookup is not a model call, but the model call that reads its results is.
- 20 member requests a minute and 300 an hour per member; 120 a minute across all members.
- One model request in flight per member (a lease of 150 s survives a crash).
- Rate limits are durable and atomic, and **fail open** (the dollar cap is the guarantee).
- Never counted: fast-path chart commands, `/record`, breadth lookups, conversations.

**Wording:**
- Refusals are one plain sentence, with `Retry-After` on rate limits.
- When a request has no call left, research is skipped with a fixed sentence. The Agent never answers from memory as if the answer were current.

## 0C — Routing foundation
- **Normaliser** (in the existing `fastPath.canon`): strips politeness and fillers, "on it" and "on there", and "show me the" before a timeframe. These rules only rewrite to wording the matchers already accept.
- **Routing:**
  - Trading vocabulary is **soft**: it moves its groups to the front when no group's own words matched, and never narrows the request.
  - The member's live layout, watchlist and screen names route to their group.
  - The lexicon's typo readings also route.
- **Safety:** a bare name that names two kinds of thing in the live workspace leaves the instant path, so the model sees both and asks. Naming the kind stays instant.
- **Tickers:** an unknown ticker is still refused. The refusal may suggest one ticker exactly one edit away, found through UCT's own ticker search.

## Before / after — same harness code, same cases
| Set | Ideal-fast reached | WRONG | Safe refusals | Routing MISS | Model calls / case |
|---|---|---|---|---|---|
| Familiar (dev, 195) | 66/95 → **71/95** | 0 → 0 | 0 → 0 | 20/160 → **6/160** | 0.708 → 0.631 |
| Unseen v1 (146) ⚠ | 16/39 → 18/39 | 0 → 0 | 1 → 1 | 28/130 → 10/130 | 1.007 → 0.856 |
| Adversarial v1 (50) ⚠ | 1/8 → 1/8 | **1 → 0** | 1 → 0 | 11/35 → 7/35 | 1.10 → 1.06 |
| **Unseen v2 (128)** | 16/58 → **24/58** | 0 → 0 | 0 → 0 | 28/127 → **17/127** | 1.039 → 0.922 |
| **Adversarial v2 (48)** | 0/3 → 0/3 | **1 → 0** | 2 → 2 | 18/43 → **11/43** | 1.229 → 1.146 |

**Notes on the table:**
- ⚠ The v1 routing vocabulary was chosen while looking at v1's misses, so v1 is no longer a clean routing measure. **v2 was written afterwards by a separate agent and never used for tuning: it is the honest generalisation number.**
- The WRONG case on base, in both sets, was "open swing". Under the stricter harness, "pull up amzon", "rename UCT Default" and "save as Day Trading" are refused by the real planner before anything runs, so they count as safe refusals and not as wrong actions.
- Instant-path latency is unchanged: p50 about 0.4–0.6 ms on both base and head, run back to back.
- Model-path intent accuracy is **not measured**. That needs real-model calls, which are not authorised.

## Tests
- **Backend:** 611 tests across Agent, Perplexity and the narrative cost guard pass, plus 991 web_search consumer tests and 24 catalyst/compass cost-guard tests. The new `tests/test_uct_agent_spend_limits.py` (23 tests) covers:
  - 40 threads racing for a $5 cap get exactly 25 × $0.20 admitted;
  - a restart in a separate process;
  - missing usage and timeouts charged at the worst case;
  - provider errors released;
  - a crash leaving a reservation that keeps counting;
  - fail-closed behaviour;
  - the site cap;
  - the call ceiling and a forged reroute;
  - honest research skipping;
  - the route's sentences;
  - rate windows, in-flight leases and concurrent admissions;
  - deterministic routes still working.
- **Frontend:** `src/agent` + `components/chart/builder` give 3,719 passed and 1 failed. The failure is `EvidenceTab.doors`, a timeout under parallel load that INDICATORS already reported; it passes 10/10 on its own.
  - `agentGateBSafety.test.js` (8) and `agentBudgetExhausted.test.jsx` (4) are new.

## Known limitations
1. **"Site-wide" means the catalyst ledger's $15.** Other surfaces that log to the narrative ledger (Perplexity callers, AI Search, the market narrative and others) were already outside the $15 before this work. Worst-case AI exposure per day is therefore $15 plus the existing one-call overshoots, plus at most $5 for the Agent.
2. **Other features' in-flight calls are invisible to the site check.** The Agent sees their spend only once they record it. Because Agent spend never enters that ledger, the Agent cannot push the site total over $15; it can only finish an already-admitted call after the total crosses.
3. **Reservations are deliberately large.** A typical turn reserves about $0.04–0.06 against an actual $0.007–0.014. The only visible effect is that the Agent stops a few cents before $5 exactly.
4. **Fail-closed means an outage of the model path** if the Agent store or catalysts.db can't be read. Instant commands keep working.
5. **Research that fails is charged its worst case** ($0.108). This is rare (0 research calls in the last 50 production turns).
6. **Chat naming can be delayed.** The naming call counts toward the 2-call ceiling, so a request that used both calls is named on a later turn.
7. **Ambiguous names now cost a model call.** "open swing" goes to the model, which asks, instead of guessing instantly. This was chosen because of the owner's rule: zero unintended mutations.
8. **Some routing misses are harness artifacts.** The harness has no conversation history, so follow-up phrases ("same thing for amd") miss here; in the panel, the last plan's groups ride along.
9. **Deploying changes behaviour immediately.** The $5 cap and the rate limits apply as soon as Gate B is deployed. No environment change is needed.

## Recommendation for Gate C
- **Gate B can ship on its own.** It is spend and safety protection that doesn't depend on Phase 1. If the owner wants it live before Phase 1, it follows the normal guard → gate → promote path once approved.
- **Then Phase 1:**
  - **1A** session memory and references ("open the third one", "make it a 9") is the largest remaining gap. The baseline's model-path cases are dominated by references and follow-ups.
  - **1C** `indicator.update` will need a seam in INDICATORS' `agentMutations.js`. INDICATORS has agreed to review it and has landed the A1.0 refactor, which I approved.
  - **1B** section-A vocabulary only after verifying the fields: RS Rank coverage on the snapshot, `pct_vs_{ema20,sma50,sma200}` semantics, and UCT's `new_52w_high` definition. Section B stays inactive.
