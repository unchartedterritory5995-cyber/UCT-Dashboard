# NL-1 hybrid action selection

Approved for development by the owner on 2026-10-20. NL-1 stays **dark**: both switches stay off (browser `uct.agent.nl1`, server `UCT_AGENT_NL1`).

The **60-action per-request limit is unchanged**, and so are the 2-call ceiling and the spend caps.

## Why

NL-1's whole catalog is 91 actions on an admin's charts board. That is over the 60-action per-request limit, so as merged in PR #427 an NL-1 request was refused before any model call.

Selection makes NL-1 operational without raising the limit.

## What one request carries (`app/src/agent/nl1/selection.js`)

| Part | What | Bound |
|---|---|---|
| **Core** | The charts, indicators, screener and agent groups, sent whole and first, built only from the actions this member may use on this surface (`manifestFor(ctx)`). Nothing unavailable is added to fill it | ≤ 45 actions. 41 on an admin's board; a core group that would overflow becomes an ordinary named group |
| **Pinned** | The groups of: <br>• a waiting proposal; <br>• the Agent's last change on this board (follow-ups, corrections); <br>• the request a pending question came from | Only groups this member may use |
| **Needed** | Groups the model asks for (`need_groups`). This is the **one bounded reroute** | ≤ 3 groups, all or nothing |
| **Soft** | The existing word router (`routing.js`) **adds** groups from the request's words, the member's own names and typo readings, smallest first, in the room left | Never removes the core. It does not interpret the request or act |

**Limits:**
- Budget 55 (the contract's `routingThreshold`), under the server's hard limit of 60.
- Whole groups only. A group that does not fit is **named** (unselected) so the model can ask for it. Nothing is silently cut.
- If the available catalog fits one request (for example off the Charts surface), it is sent whole and unrouted.

## Safety

**Selection only changes what the model sees.** It cannot widen what runs:
- The server refuses any action it was not sent: the schema enum, `sanitize_envelope`, `expand_compact_ops`.
- The browser re-validates every op against the full registry and availability (`executor.planOps`, `shapeError`).
- Unchanged: the planner, approval policy, approval binding, receipts, Undo, stale-state checks, the 60 limit, the 2-call ceiling and the spend caps.

**Order under the 2-call ceiling (owner decision 4):**
1. If the model asks for groups, the reroute is the second call (`useAgent`). A rerouted plan is never repaired.
2. On the server, a request for groups is never repaired first (`turn.run_turn` `asks_groups`).
3. Otherwise the existing bounded repair applies.

Nothing ever makes a third call.

**When the groups cannot be supplied** (more than 3, no call left, or they would not fit beside the core), nothing runs and the member is told: "That touches too many parts of UCT…". A reroute that asks again ends the same way.

**No substitution (owner decision 5).** Two layers:
1. *Prompt.* Routed NL-1 requests carry `NO SUBSTITUTION` (`turn._NL1_ROUTED_CATALOG`). It says never use a listed action as a stand-in, for example by changing an existing chart when asked to add one. It also rules out deleting, renaming, clearing, overwriting, editing an indicator, or changing a watchlist, layout or alert in place of the action asked for. Ask for the group instead.
2. *Deterministic.* If the member's words pointed at a group the request could not carry (`wordsNotSent`), an `apply` is only **proposed** (`useAgent`). Words only ever add this caution.

The words cannot detect every substitution. The remaining risk is measured by the evaluation's `substitutions` metric.

## Prompt and caching (`turn.nl1_system_texts`)

A routed NL-1 request sends three system blocks, all cache-controlled:

1. the core actions + the rules + the glossary (identical on every request);
2. the reference data;
3. this request's other actions + the groups it was not given.

Unrouted NL-1 requests and every legacy request produce byte-identical prompts to before. This was checked against master's `turn.py` on 48 combinations.

`routing.stable` (how many leading actions are the core) only decides which block an action is written in. Malformed values are ignored.

## Measured (local, free; dev and exposed sets only, sealed sets never opened)

`app/src/agent/agentNl1SelectionCoverage.test.js` runs the real selection through the eval capture.

| Set | Requests with a plan | First call carries the plan's actions | + one reroute | Not reachable | Actions sent (median / max) |
|---|---|---|---|---|---|
| corpus (dev) | 157 | 153 (97.5%) | +4 → 100% | 0 | 46 / 55 |
| dev-nl1 (dev) | 35 | 35 (100%) | — | 0 | 50 / 55 |
| heldout-v1 (exposed) | 165 | 163 (98.8%) | +2 → 100% | 0 | 44 / 55 |

At a budget of 60 instead of 55, only one more corpus case is covered on the first call, so 55 stays.

**Caveat.** These sets are not blind:
- The corpus was written beside the matchers.
- heldout-v1 shaped the router's vocabulary.

The first-call numbers are therefore optimistic. Coverage measures what the model *could* see, not what it understands.

**Prompt size**, chars ÷ 4 to chars ÷ 3, from `tools/agent_eval_run.py` and the same capture (435 NL-1 requests):

| | Hybrid | Whole catalog |
|---|---|---|
| System prompt + schema per request (median) | ~13.0k–17.3k tokens | ~19.4k–25.8k tokens |
| of which the identical cached block (core + rules + glossary + reference) | ~11.0k–14.7k tokens, 1 distinct | n/a |
| of which the variable part (other actions + groups note + schema) | ~2.0k–2.6k tokens (max ~5.1k) | n/a |
| Actions per first call | median 47, max 55 | 91 (refused under 60) |

**Unmeasured until T1:**
- real tokens, cache hits and latency;
- whether the per-request output schema (its action enum varies with the selection) affects prompt caching;
- the reroute rate on the real model.

## Evaluation

**Capture** (`testing/capture.js`). Each NL-1 item now carries:
- `selection`;
- `catalog` (its full manifest is stored once per distinct catalog);
- `reroutes`: for every set of up to 3 unselected groups, the groups the panel's reroute would send, or `null` when they do not fit.

**Replay** (`tools/agent_eval_run.py`). The runner replays the panel's one reroute (`reroute_request`, `assemble_nl1`). `CeilingMeter` enforces production's 2-call ceiling, so a rerouted request is never repaired.

`assemble_nl1` mirrors the browser's `assembleNl1` and is held to it by `tests/fixtures/nl1_assemble_parity.json`.

**Score** (`testing/score.js` `selectionOutcome`). Reported per set:
- first-call coverage;
- reroute rate;
- substitutions;
- escalations;
- tokens per request;
- latency (p50/p95, including the reroute).

An escalated apply is scored as the proposal the panel makes.

The acceptance gates are unchanged: zero unsafe plans and ≥ 90% interpretation.

**Freeze before sealed scoring.** The selector (core, budget, router) is frozen at the commit that holds this document. Sealed sets are scored once, in aggregate, and never tuned against.

## Tests

| File | Holds |
|---|---|
| `agentNl1Selection.test.js` | Core composition and availability, ≤ 60, whole groups, pins, soft expansion, reroute fit, determinism, Python parity fixture |
| `agentNl1SelectionPanel.test.jsx` | Through the real panel: reroute (nothing runs in between), its bounds, no repair after a reroute, no third call, the substitution guard, pins. Each mechanism was disabled once to confirm its test fails |
| `agentNl1SelectionCoverage.test.js` | Invariants on every dev/exposed request, coverage with regression floors |
| `tests/test_uct_agent_nl1_selection.py` | Server: limit 60, block layout and cache stability, hidden actions never run, need_groups never repaired, malformed `stable`, flag OFF = legacy |
| `tests/test_agent_eval_run.py` | Assembly parity, reroute replay, call ceiling, routed estimates under the shipped 60 |
