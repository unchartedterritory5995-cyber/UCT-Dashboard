# Planner v2 — cost under the kept $0.25 per-turn cap (W2-A2, 2026-11-03)

**Owner decision (2026-11-03):** keep `UCT_AGENT_TURN_USD = 0.25`; weaken no limit; make the planner cheaper. No paid
call was made for anything below; v2 stays OFF (`UCT_AGENT_PLANNER` unset); the production model is unchanged
(`claude-haiku-4-5`). A paid evaluation remains separately gated.

**Correction (2026-11-05): the figures below understate v2.** They were measured with `SAMPLE_CONTEXT`, whose Screener section
is a 113-byte stub; the real section is about 12 KB since #834 widened it, and it rides every round. With it the flagship's summed worst case on Haiku 4.5
is **$0.3454, over the $0.25 cap**, and F01's is $0.3363, and the Wave 1 search layout is refused before its first call. The
turn still finishes under the runtime rule (spent + next worst), but the "under the cap" target is not met. The test now
measures the real section and pins that figure as a baseline it may not exceed. **Planner v2 cannot be enabled until an owner
decision.** The tables are kept as measured then.

`tools/agent_v2_cost_dryrun.py` and the corpus fixture now price the same real section. The fixture was also refreshed from
46 to 158 intents. Over it the runtime gate peaks at $0.1409 (margin $0.1091; was $0.0693), the summed worst case reaches
$0.3387, and a single Wave 1 search-layout request reserves $0.2687, over the cap on its own.

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

---

# v2-readiness-2 (Mission 3, 2026-11-04): planner v2 on current master, measured over the capability-regression corpus

Branch `agent/w2/v2-readiness-2` (base master `88cca06313`). `UCT_AGENT_PLANNER` stays unset; no production routing
change; no model call. The #733 work above was ported onto master (index layout, 1,024-token v2 rounds, rails, alias
binding, acceptance set); #732's `args.py` was NOT (master's W1.1 `turn.normalize_args` is the one normalizer).

## Parity: v1 vs v2 over the corpus (46 intents, 233 phrasings; `agentPlannerV2Parity.test.jsx`, `V2_PARITY=full`)

Both replays use the REAL panel and the same `checkExpect`. v1 = capreg level (c) with the faithful routed model; v2 =
deterministic layers first (identical code), then the scripted STEP-1 server, one step per canonical op, mode as
turn_v2 decides it, faithful to the v2 manifest.

| | v1 | v2 |
|---|---|---|
| phrasings reaching the same final state | 223 / 233 | 223 / 233 |
| failing (all recorded capreg gaps: CG-3 ×6, CG-8, CG-9, CG-10, CG-15) | 10 | the same 10 |
| v2-only failures | — | 0 (rail: V2-G1 recorded for when CG-3 is fixed in v1 by #771) |
| phrasings whose model request carries every needed action (level a) | 218 / 233 (routing) | 233 / 233 (whole manifest, 138 actions ≤ 200) |
| phrasings that reached the planner at all | — | 116 / 233 (the rest are deterministic, identical in both) |

**What CI runs.** The parity RAIL in the default `vitest run src/agent` is **v2-only, on the FIRST phrasing of each intent**
(46 cases, about 1 minute). It catches a v2 regression; it does not compare against v1. The v1-vs-v2 comparison above
needs `V2_PARITY=full V2_PARITY_OUT=<file> npx vitest run src/agent/agentPlannerV2Parity.test.jsx` (every phrasing, both
planners, about 10 minutes). It is NOT run in CI. **Last full run:** 2026-11-04 on `agent/w2/v2-readiness-2` after the review
#775 fixes (host.js back to master). Results: 233/233 recorded; 223 both pass; 10 both fail (CG-3 ×6, CG-8, CG-9,
CG-10, CG-15); 0 v2-only failures; 116 reached the planner.

Acceptance set: F01 ("undo all" after an EMA on a NEW chart) is recorded as KNOWN GAP OPTSSIG-NULL while #775 leaves
host.js as master. The v1 fix (a null opts key reads as absent in optsSig) and its v1 regression test are on
`agent/w2/optssig-null`, reviewed separately.

V2-G1: "Put four charts on my screen" (3 × widget.add + widget.arrange). #771 fixes v1 (adds + one re-tile in one plan);
v2 runs steps one at a time, so the third add has no room before the re-tile. It needs a "make room first" prompt rule
or a multi-op re-tile step. The CI rail runs the first phrasing per intent through v2 (46 cases, ~1 min).

## Cost per corpus intent, v1 vs v2 (`tools/agent_v2_corpus_cost.py`; claude-haiku-4-5)

Run it with `AUTH_DB_PATH=$TEMP/v2cost.db python tools/agent_v2_corpus_cost.py`. It refuses to run without a temp DB and never records a cost.
Inputs are the actual prompts. v1 is `run_turn` with the phrasing's routed manifest and routing block. v2 is the real
`run_turn_v2` loop, with every round captured: load, then one step per round (the worst case), then the reply. Tokens
use a BPE-like approximation. The gate replays turn_v2's own rule: spent + `worst_case_usd(next request)` ≤ $0.25,
checked before each call.

| | v1 | v2 (index, default) | v2 (Wave 1 search) |
|---|---|---|---|
| mean input tokens / turn | 15,287 | 20,058 | 68,851 |
| mean expected $ / turn | $0.0160 | $0.0209 (cached prefix $0.0137) | $0.0691 |
| worst intent, runtime gate | $0.0878 (one call) | **$0.0718** (grid.four.unnamed, 6 rounds) | $0.2218, then turn_cap |
| margin under $0.25 | $0.162 | **$0.178** | none: 0 / 46 finish |
| turns that finish | 46 / 46 | 46 / 46 | 0 / 46 |

The owner flagship (9 steps, 2 cards; acceptance tool above) is still the tightest case. Its summed worst-case
reservation is $0.2460 on master. The runtime rule (spent + next worst) stays below that.


## V2-G2 plan groups (agent/w2/v2-nl-equivalence, stacked on #775)

"Put four charts on my screen" (V2-G1) is fixed with no phrase workaround. Consecutive ordinary changes in ONE model
response now form a plan group, and the browser runs the group as ONE plan, the same way v1 runs one envelope. The index
prompt tells the model to send changes that only work together (adding widgets AND re-arranging the board) in one
response. The parity rail now passes all 46 intents on v2 with no known gap. The paid quality evaluation plan is in
PLANNER-V2-EVAL-PLAN.md (not run).
