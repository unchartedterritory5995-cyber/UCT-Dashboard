# Planner v2 — cost under the kept $0.25 per-turn cap (W2-A2, 2026-11-03)

**Owner decision (2026-11-03):** keep `UCT_AGENT_TURN_USD = 0.25`; weaken no limit; make the planner cheaper. No paid
call was made for anything below; v2 stays OFF (`UCT_AGENT_PLANNER` unset); the production model is unchanged
(`claude-haiku-4-5`). A paid evaluation remains separately gated.

## How it was measured
`python tools/agent_v2_cost_measure.py` (pinned by `tests/test_uct_agent_v2_cost_measure.py`) drives the REAL server loop
(`turn_v2.run_turn_v2`) for every case of the scripted acceptance set (`app/src/agent/__fixtures__/program/v2-acceptance.json`,
38 v2 cases) plus the owner's flagship sentence, per tool layout and per model, with a scripted model (the case's own
steps) and a scripted browser (the statuses the acceptance run pins). Every request the loop builds is priced with the
eval ledger's worst case (`tools/agent_eval_ledger.worst_case_usd`): every request byte as a token + 4,000 framing, all
billed as a 5-minute cache write, + `max_tokens` of output. "Worst $/turn" = the SUM of every round's reservation (stricter
than the runtime rule, which is `spent so far + worst(next round) ≤ $0.25` before each call). Token estimate = bytes/3.

The scripted model loads / lists what it needs, then calls steps; steps that do not need an earlier result go in one
response (run in order — STEP-1 already allows parallel tool_use). Structural only: it measures request sizes, rounds and
caps, not how well a real model picks actions (`routing accuracy` below = every step's action is reachable from the
index / the search catalog; tool-selection quality needs the paid eval).

## Before → after

| layout (model) | round-1 request | flagship (owner): rounds / finished / worst $/turn | F01 worst $/turn | set: finished | set worst $ |
|---|---|---|---|---|---|
| **before** — Wave 1 "search" (Haiku 4.5) | 165,632 B (~55k tok) | 1 / **no — turn_cap after round 1** / $0.2174 | $0.2173 (stopped) | 3/38 | $8.25 |
| Wave 1 "search" (Haiku 5.5) | 165,632 B | 6 / no — round_limit / $0.6665 (>100k-token tier) | $0.6658 | 34/38 | $15.89 |
| step 1 — "index" (64-char summaries, 2,048 output) (Haiku 4.5) | 17,403 B | 6 / yes / $0.3014 | $0.2919 | 37/38 | $5.54 |
| **after** — "index" (40-char summaries, lean descriptions, 1,024 output) (Haiku 4.5) | **14,320 B (~4.8k tok)** | **6 / yes / $0.2449** | **$0.2356** | **37/38** | **$4.31** |
| after — "index" (Haiku 5.5, price rows only) | 14,320 B | 6 / yes / $0.0245 | $0.0236 | 37/38 | $0.43 |

Per-round worst on Haiku 4.5, after: round 1 ≈ $0.028, later rounds $0.030–$0.046 (the loaded actions ride along).
Tool search / load: search layout 80 calls on Haiku 5.5 (one per step), index layout 35 load calls (one per turn that
acts), 0 misses in both (scripted). Reachable steps 92/92 in both layouts. Browser-side multi-step acceptance:
39/39 (`agentPlannerV2Acceptance.test.jsx`). The one case that does not finish in either layout is F02 (9 steps,
4 approval cards): it needs more than 6 rounds.

## What changed (`api/services/uct_agent/turn_v2.py`; `UCT_AGENT_V2_TOOLS=search` restores the Wave 1 layout)
1. **Index layout (default).** The system prompt carries `<action_index>`: every action by its exact tool name with a
   ≤40-character summary (~8 KB for 133 actions). The request's only fixed tool is `load_actions` (+ `research__web`
   when a meter can pay for it). The model loads what the request needs in ONE call; only those strict tool definitions
   ride later rounds (appended after the fixed tools, so the fixed prefix stays cacheable). Unknown names come back as
   an error result and count as `tool_search_misses`. The Wave 1 layout sent all 133 capability tools (deferred, ~160 KB)
   on every call — deferred tools are not billed by the provider, but the ledger's reservation counts every byte, which is
   why round 1 alone reserved ~$0.22.
2. **Lean descriptions** for loaded tools: the leading `name(arg: type, …)` signature is dropped (the strict input
   schema beside it says the same); summary, hints, target kind and Undo truth stay.
3. **Output reservation 1,024 per v2 round** on models without thinking (a round writes tool calls or one short
   reply). Models with effort set keep v1's 4,096 (thinking is billed inside max_tokens).
4. The prompt allows independent steps in one response (they run in order) — STEP-1 already executed parallel tool_use.

## Tradeoffs and open risks (owner)
- **Rounds, not dollars, are now the binding limit.** The flagship finishes in exactly 6 rounds (the cap) only if the
  model batches the save with the four EMA adds; done one per response it needs 7, and the round cap stops the turn
  before the final reply (every step stays done with its receipt; the reply is the fixed ROUND_LIMIT sentence). F02
  (4 cards) cannot finish in 6. Options (each needs the owner): a higher round cap (each extra round reserves
  ~$0.03–0.05 on Haiku 4.5, so the summed worst would pass $0.25 while the runtime rule would still admit it), or pre-load
  likely actions from the browser's v1 routing to save the load round.
- **The flagship's summed worst ($0.2449) leaves 2% headroom.** A larger workspace context (more charts/lists) or a
  longer message can push it over; the runtime rule (spent + next worst) still lets it run because actual spend is far
  below the reservation.
- **Selection quality is unmeasured.** 40-character summaries and the extra load step are cheaper but untested against
  a real model; the paid eval should compare index vs search on the same set before v2 is activated.
- **Haiku 5.5** prices the same turn at ~1/10 (worst $0.0245 flagship) but is a production-model change: not done.
  Note its >100k-token tier makes the Wave 1 layout dearer on it ($0.67/turn), not cheaper.

Reproduce: `python tools/agent_v2_cost_measure.py` (tables) or `--json`; the Wave 1 table: `python tools/agent_v2_cost_dryrun.py`.
