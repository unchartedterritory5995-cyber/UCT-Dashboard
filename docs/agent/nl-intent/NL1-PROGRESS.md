# NL-1 progress (2026-10-16)

Branch `feat/agent-nl1`, worktree `C:\UCT\nl1`, on the Gate C rehearsal `5f32761809`. **Local only.** Nothing pushed, merged or deployed, and no paid call made.

## Done

### A. Audit saved
[NL1-AUDIT.md](NL1-AUDIT.md) and [NL1-DECISIONS.md](NL1-DECISIONS.md) (commit `8ee0dd74b0`).

### B. Evaluation suite
See [NL1-EVAL.md](NL1-EVAL.md).
- **842 turns across 5 sets.** The headline is the 405 sealed turns.
  - `sealed-v3.json` was written blind by a separate agent from the catalog alone; the implementer never read it.
  - `heldout-v2.json` is sealed for NL-1.
  - `heldout-v1.json` is reclassified as **exposed**, because it informed Gate B's routing vocabulary.
- **Sealed sets are hash-locked** and reported in aggregate only.
- **The scorer keeps interpretation, execution and safety apart.** Execution and safety are judged by the real planner and policy.
- **The capture uses the panel's own request builder** (`buildNl1Request`), so the eval measures exactly what would be sent.
- **A capped runner** for the paid replay is built but refuses to run until the prices are verified and a separate eval key is set.
- **The acceptance gates were fixed before any paid run.**

### C. Model-first interpreter, behind flags that are OFF by default
| Piece | Where | Off by default |
|---|---|---|
| Browser flag | `uct.agent.nl1 = '1'` (`nl1/interpreter.js`) | yes |
| Server flag | `UCT_AGENT_NL1=1` (`turn.nl1_enabled`) | yes; an NL-1 request with it off is served as legacy, byte-identical (tested) |
| Exact lane | exact Undo / Confirm / Cancel only, and only when there is something to act on | — |
| Request | the whole catalog (91 actions); **no routing**; no context section gated on the member's words (indicator catalog, alerts, full screener catalog); session memory with the last change's target and arguments; the question being answered (`pending_question`) | — |
| Server | the whole catalog compact (`args_json` ops), never routed; NL-1 rules and UCT's glossary (**data**: `nl1_glossary.json`) in **one** stable, cached system prompt; per-request limit 120 for this request shape only (**proposal**, flag-gated); `nl1_finish` gates the new fields after every legacy guard | — |
| Clarifying | choices are `{label, ref}`. A ref the browser never offered is nulled. A click or a typed answer goes back to the model with the question | — |
| Corrections | `correction: {replaces: "last_change"}`. The browser reverses the Agent's previous change **through the existing Undo**, which refuses when the change is protected, on another board, or modified since (fingerprints), and then applies the new change. If the change can't be reversed, nothing is undone and the new change is **only proposed** | — |
| Create Indicator door | the answer to "What indicator would you like to build?" goes to the model with that question (`indicator.draft` is in the catalog) | — |

Unchanged: the registry, the planner, the policy (`decideMode`), the product writers, readback receipts, stale-state checks, Undo, `require_admin_dark`, the budget ($5/day, $15 site stop, 2 calls per request) and the limits. No new registry, no Indicators engine, no A1-frozen file touched.

## Tests (all free, local)
| Suite | Result |
|---|---|
| Backend Agent tests (`tests/test_uct_agent*.py` + runner) | **590 passed** (576 before + 10 NL-1 server + 4 runner) |
| Frontend Agent gate (`npx vitest run src/agent`) | **76 files passed**, 5 skipped. Before: 74 passed, 3 skipped. Added: 2 always-on files, plus capture and score, which run only with their env vars |
| NL-1 panel (scripted model) | 8 / 8: flag off unchanged; flag on → model with the full catalog; exact Undo; correction reverses then applies; externally modified → nothing undone, proposed; no prior change → proposed; typed answer carries the question and refs; destructive "apply" still proposed, and "cancel" dismisses it |
| `check_repo_hygiene.py`, `flow_worker_watch_coverage.py`, secret scan | clean |

## Not done yet / known gaps (next free steps)
1. **Repair call.** When a plan fails validation, one model call with the validator's error. It needs the request/reroute plumbing in `useAgent` and the budget's second call. Not built.
2. **Regex screens still run after the model under NL-1:** `screenModelOps`, `screenDeicticOps`, `screenNewChart` and `markExplicitSaves`. Most only restrict, by asking or refusing. `markExplicitSaves` can skip one approval card (an indicator save the member's own words named). **Recommendation:** under NL-1, every save goes through its card. Owner decision.
3. **Server keyword gates for research** (`_BREADTH_Q`, `_NEWS_WORDS`, `_EXPLAIN_WORDS`) still apply. They gate web research, not meaning. Review after the eval.
4. **The legacy phrase layers are kept, not deleted:** the fast path, routing, Gate B vocabulary, Gate C references. They are bypassed when NL-1 is on and removed only after NL-1 passes its gates and runs at parity (owner rule).
5. The Create Indicator door path under NL-1 has no panel test yet.
6. **Request size.** About 44 KB per NL-1 request on a test board; the system prompt is about 16–21k tokens. The server's context limit (24 KB) is unchanged, and the full screener catalog now always rides along. Watch the context budget with the paid smoke.

## Dependencies
- **Release order** A0 → Gate C → A1 → NL-1. NL-1 is rebased onto master after Gate C lands.
- **NL-1 changes `api/routers/uct_agent.py`** (one optional field) and `turn.py`. Gate C's checklist records the router as unchanged *for Gate C*. That stays true: NL-1 is a later release.
- **Contract proposal:** the 60-action limit stays for every legacy request. NL-1 requests may carry up to 120 actions, only with the server flag on. Each op's arguments are still parsed and checked against its own schema (`expand_compact_ops`) and again in the browser. Needs owner approval before the flag is ever turned on in production.

## Blockers for paid evaluation (owner)
- Verify prices and model availability, then mark `tools/agent_eval_prices.json` verified.
- Provide a separate eval key (`UCT_AGENT_EVAL_API_KEY`).
- Approve the caps in NL1-EVAL.md §5: total ceiling $45, expected ≈ $12–18.
