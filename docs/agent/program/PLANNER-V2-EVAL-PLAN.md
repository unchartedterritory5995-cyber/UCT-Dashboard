# Planner v2: paid quality evaluation plan (DRAFT, NOT RUN)

**Status:** this is a draft for the owner's decision. Nothing here has been run. No key exists for it and no money has been spent.
Planner v2 stays off in production (`UCT_AGENT_PLANNER` unset). It was dark-merged with #775, and the owner approved the
"index" layout for development and deterministic testing (2026-11-04). This plan asks for the next step: a **paid, offline**
measurement of how well a real model selects and fills actions under v2, compared with v1, on the same prompts.

## 1. The question it answers

The deterministic work proves two things:
- the v2 loop executes correct plans exactly as v1 does, on 223/233 corpus phrasings for both planners, with 0 failures that only v2 has;
- v2 fits under the cap (gate peak $0.0718 against $0.25).

It cannot show whether a **real model** picks the right actions from the 40-character action index, batches the
changes that only work together, and stays honest. That gap is the only thing this evaluation measures.

## 2. Arms (same prompts, same fixture boards)

| Arm | Planner | Model | Layout | Purpose |
|---|---|---|---|---|
| A | v1 (production path: routed manifest, one call) | claude-haiku-4-5 | — | the baseline v2 must match |
| B | v2 | claude-haiku-4-5 | index (plan groups, V2-G2) | the candidate |
| C (optional, owner) | v2 | claude-haiku-5-5 | index | price/quality option; only if the owner wants a model-change data point. Pricing: $0.10 / $0.50 per MTok for prompts up to 100K tokens ($0.50 / $2.50 above), from the claude-api skill's model table (cached 2026-10-06). Haiku 4.5 is $1.00 / $5.00 from the same source. |

The Wave 1 "search" layout is NOT evaluated: it cannot finish a turn under $0.25 on Haiku 4.5 (0/46 in the
deterministic estimate).

## 3. Prompt set: 332 prompts, frozen before the run

| Source | Prompts | What it covers |
|---|---|---|
| Capability-regression corpus (`qa/capabilityRegression/baseline/corpus.json`) | 233 phrasings / 46 intents | NL equivalence on every covered capability, incl. the owner's own sentences |
| Corpus refusal cases | 4 | honest refusals (no false capability, nothing done) |
| v2 acceptance set (`__fixtures__/program/v2-acceptance.json`) | 38 | multi-step, cards mid-turn, Undo across a pause, partial failure, research |
| The owner's flagship sentence + 4 paraphrases | 5 | the 9-step workflow, the tightest cost case |
| Held-out set (new, written by someone who has not read the corpus; never used for tuning) | 52 | generalisation: 2 new phrasings for 26 of the 46 intents |

**Frozen expectations.** Every prompt's expected plan (actions + key args) and its `must_group` label are committed in `tests/fixtures/agent_v2_eval_expectations.json` BEFORE any run: 237 corpus + refusal rows now, and the 52 held-out rows added by their author, with labels, before the run starts. Changing the fixture after the run starts invalidates the run.

Every prompt runs on its fixture board (`BOARDS` in `testing/harness.jsx`) with the same synthetic data. **No real
market value enters any request or log** (synthetic screener rows and empty data reads, as in the deterministic suite).

## 4. How it runs (harness to build first, free)

- **Runner:** `tools/agent_v2_eval.py`, a v2 sibling of `tools/agent_eval_run.py`.
- **Ledger:** the existing eval ledger (`tools/agent_eval_ledger`) with its own key, separate from production.
- **The loop:** the REAL `turn_v2.run_turn_v2` with a scripted BROWSER. Each step is answered from the corpus fixture's
  deterministic outcome: done with the receipt, query with a value-free result, proposed then approved, or refused when
  the case pins it. The model is real; nothing else is.
- **v1 arm:** the real `turn.run_turn` with the routed manifest the browser would send (exported as in
  `agentPlannerV2CostExport.test.jsx`).
- **Scoring:** deterministic, no LLM judge.
  - (a) The planned actions equal the intent's canonical action multiset.
  - (b) The key args match the canonical args (`partialMatch`, symbol case-insensitive).
  - (c) Changes that only work together arrive in ONE plan group.
  - (d) No claim without a receipt: the existing `_CLAIMS_WITHOUT_ACTION` check and `undo_claim_unbacked`.
  - (e) The turn finishes with no `turn_cap`, `round_limit` or `step_timeout`.
- **Dry run first, free:** the same runner with the scripted model must reproduce the deterministic numbers before any
  key is used.

## 5. Budget and ceilings

| Item | Turns | Expected $/turn (measured deterministically) | Expected $ |
|---|---|---|---|
| Arm A (v1), 332 prompts × 1 run | 332 | $0.016 | $5.31 |
| Arm B (v2), 332 prompts × 2 runs (stability) | 664 | $0.021 (cache off; ~$0.014 with the prefix cache) | $13.94 |
| Flagship ×5 per arm (v2 worst-case-heavy turns) | 10 | ≤ $0.10 | ≤ $1.00 |
| **Total, arms A + B** | **1,006** | | **≈ $20.25** |
| Arm C (optional, Haiku 5.5, 332 × 1) | 332 | ≈ $0.003 (1/10 of the Haiku 4.5 rates; every v2 turn is under 100K tokens) | ≈ $1.00 |

**Hard ceilings (enforced by the runner and the ledger, not by intent):**
- **Total ceiling $25.00** for arms A + B. That is **$4.75 (≈ 23%) of headroom** over the $20.25 expected, which covers the gap between the deterministic token estimate and real usage. Arm C, if approved, adds a separate $2.00 (100% headroom over its ≈ $1.00).
- The runner reserves `budget.worst_case_usd` before every call and stops cleanly when the next reservation would
  cross the ceiling. The report then marks the run as partial.
- **The per-turn cap stays $0.25** (`UCT_AGENT_TURN_USD` unchanged). A turn that hits it is scored as a failure, not retried.
- **Rounds cap stays 6.**
- The production daily cap ($5/day) is untouched: the eval ledger is separate, and no production key, DB or meter is used.
- **Kill switch:** abort if any of these happens:
  - 3 consecutive API errors;
  - the error rate passes 5%;
  - spend passes 120% of the running expected cost after 100 turns.

## 6. Success criteria (all required for a v2 GO recommendation)

| # | Criterion | Bar |
|---|---|---|
| S1 | Action selection over ALL 233 corpus phrasings (the same denominator for both arms) | v2 ≥ 92% **and** v2 ≥ v1 − 2 pts |
| S2 | Action selection, held-out set, scored against the expected plans frozen in the fixture | v2 ≥ 85% and not below v1 by more than 3 pts |
| S3 | Args correctness on correct-action turns | ≥ 95% |
| S4 | Plan grouping on the rows labelled `must_group` in the frozen fixture (6 corpus phrasings today, plus held-out rows labelled before the run) | ≥ 90% |
| S5 | False claims (claims a change or an Undo with no receipt) | **0** (any one is a NO-GO) |
| S6 | Refusal cases (4) and honest "can't do that" | 4/4 and 0 invented actions |
| S7 | Turns finishing (no turn_cap / round_limit) | ≥ 98% overall; the flagship ≥ 4/5 |
| S8 | Cost | **zero `turn_cap` stops** on arm B, and mean ≤ $0.03 per turn |
| S9 | Stability (arm B run 1 vs run 2) | the same pass/fail on ≥ 90% of prompts |

A miss on S1–S4 or S7–S9 gives a list of failure modes for deterministic fixes and a re-run, which is a new budget
request. A miss on S5 or S6 stops the v2 activation track until it is fixed.

## 7. Owner decisions requested

1. Approve the budget: **$25.00 ceiling** for arms A + B (expected ≈ $20.25); arm C: yes/no (+$2.00).
2. Approve the eval key and ledger. These are separate from production; no production flag or model routing changes.
3. Approve the 52-prompt held-out set author: someone outside the corpus authors.
4. Agree the success bars above, or adjust them, BEFORE the run. They are frozen once it starts.

## 8. What happens after

- The report goes in `docs/agent/program/PLANNER-V2-EVAL-RESULTS.md`, with per-criterion numbers, every failure, the exact spend, and value-free logs.
- A GO recommendation still leads only to a **dark admin flag** trial. Member activation is a separate owner decision.
