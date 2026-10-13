# UCT Agent — Intelligence, Conversation & Autonomy Architecture Audit (2026-10-13)

**Scope.** This is an audit and design study only. No Agent behaviour, production configuration or data
was changed, and no paid model calls were made.
- Repository state audited: `master` = `production` = `e051fa9721`.
- Production telemetry: the `[uct-agent] turn timing` lines of every web deployment since 2026-10-10. These are timing and token counts only; no prompt or answer text was read.
- No-cost local runs: the NL intent corpus (`app/src/agent/agentNlCorpus.test.js`) and the scripted evaluation (`app/src/agent/agentEval.test.jsx`).

**Documents**

| # | Document | Covers (owner's parts) |
|---|---|---|
| 1 | [01-current-architecture.md](01-current-architecture.md) | Request flow, components, what exists today (Part 1) |
| 2 | [02-capability-inventory.md](02-capability-inventory.md) | 90 Agent actions; the platform A/B/C/D inventory (Part 2) |
| 3 | [03-understanding-context-planning.md](03-understanding-context-planning.md) | Natural-language understanding, the 21 example requests, clarification policy, context and follow-ups, multi-step (Parts 3–6) |
| 4 | [04-speed-cost-safety.md](04-speed-cost-safety.md) | Measured latency, cost model, spending controls, safety and reliability (Parts 8, 11, 12) |
| 5 | [05-evaluation.md](05-evaluation.md) | Benchmark design, metrics, regression maintenance (Part 10) |
| 6 | [06-options-target-roadmap.md](06-options-target-roadmap.md) | Model vs deterministic, response quality, options A/B/C, target architecture, roadmap, acceptance criteria, decisions (Parts 7, 9, 13, 14) |

Evidence labels used throughout:
- **CONFIRMED**: read in code or tests, or measured.
- **HYPOTHESIS**: an inference that needs measurement.
- **PROPOSAL**: a design recommendation.

## Executive summary

**The Agent is not primitive. Its foundation is unusually strong.** CONFIRMED:
- **Capability registry.** 90 actions in 12 groups, each with a closed argument schema, risk and Undo metadata, and an optional deterministic `fast` matcher (`app/src/agent/capabilities/*`, `contract/manifest.golden.json`).
- **One execution engine** shared by the deterministic and model paths: plan, then policy, then runtime with read-back verification, compensation and exact Undo (`executor.js`, `policy.js`, `runtime.js`).
- **A validated, single-shot structured model output.** The envelope's disposition plus ops act as a de-facto intent representation (`api/services/uct_agent/turn.py` `envelope_schema`, `sanitize_envelope`).
- **Strong safety boundaries:**
  - admin-only routes;
  - closed schemas;
  - the model never executes anything;
  - local-only data that never returns to the model;
  - protected layouts;
  - claim filtering;
  - refusal of plans over 12 ops.
- **A fast deterministic path with typo correction.** On the repository's 195-phrase corpus it reaches 67 of the 95 cases that should need no model, with **0 wrong deterministic actions**.

**What limits "genuinely intelligent" behaviour is not missing infrastructure.** It is five specific gaps (CONFIRMED):
1. **No working memory of results.** The model never sees the tickers of a screen it just ran. No ordinal or reference map exists, so "open the third one", "compare it to the others" and "open the strongest one" fail or degrade into opening new charts.
2. **No shared trading semantics.** "Strong", "near the 20-day", "pullback", "outperforming", "holding up" and "breakout" have no definitions. Each model call invents its own thresholds, so identical requests can give different screens.
3. **Routing by brittle keyword lists, with a 55-action budget.** Unrecognised phrasings ("stocks doing better than the market") silently lose the screener and data groups and need an extra model call.
4. **Edit-in-place gaps.** There is no way to change an existing indicator's period or colour ("make it a 9"), and no way to switch an existing chart to a result from a list.
5. **Most of UCT's data is invisible to the Agent.** It reaches about 10 data endpoints. RS rankings, sector and theme strength, movers, market indicators, NH/NL series, calendar, insider and filings are paid GETs it cannot read. These are low-difficulty additions.

**Measured production behaviour.** CONFIRMED, from 50 model turns on 2026-10-12/13:
- **Model call time:** median 2.9 s, 90th percentile 7.6 s.
- **Prompt size:** mean input 5,388 uncached tokens, output 133 tokens.
- **Prompt caching:** cache reads on 25 of 50 turns, about 12k tokens each when they hit.
- **Shape:** one model call per turn, no web research.
- **Cost:** about $0.0066 per model turn on Claude Haiku 4.5, or roughly $0.007–0.014 once the unlogged cache writes are included.
- **Deterministic requests:** about 15–60 ms of Agent time plus the data call.

## Recommendation (details in [06](06-options-target-roadmap.md))

**Evolve the existing architecture into a unified one (option "B, built as an evolution"), not a rewrite or a model-driven loop.**
- The validated op envelope is already the shared intent representation both paths produce. Building a second one would duplicate it.
- Keep the deterministic path and the single structured model call as the default. Add four foundations:
  1. **Session working memory.** Result sets, the last subject per domain and the last action, compact and checked for staleness against the workspace. It gives both paths **references** they can resolve: `the 3rd result`, `that indicator`, `the others`.
  2. **A trading concept library.** Versioned, owner-approved definitions ("strong" = RS rank ≥ 80, …) that expand deterministically into screener filters. The Agent states the assumptions it used.
  3. **Read-only data tools** wrapping existing paid GETs, and a **bounded look-then-answer step** (at most one extra model call) for questions that need data to interpret.
  4. **Edit-in-place actions**: indicator settings, symbol from a reference, compare with a reference.
- Measured by a three-layer evaluation (deterministic, scripted, budgeted real-model), with held-out and adversarial sets.

**Expected cost impact.** Model-turn count per request should *fall* (more deterministic coverage, fewer reroutes). Per-turn cost stays at roughly $0.007–0.015 on Haiku 4.5. Model routing to a larger model is reserved for an explicit, owner-approved case.

## Decisions requiring the owner's approval
See [06 §Decisions](06-options-target-roadmap.md#decisions-requiring-the-owners-approval). In brief:
1. The recommended direction and Phase 0–1 scope.
2. A real-model evaluation budget (proposed ≤ $10 per release).
3. Whether the model may *see* breadth and market values in order to interpret them. They are local-only today by design.
4. Owner-approved definitions for trading concepts.
5. Model choice and any escalation rule.
6. An Agent dollar cap and its cost-guard lane.
7. Member rollout timing.
8. How the Agent relates to AI Search and the voice tools.
9. Research (Perplexity) disclosure.
