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

---

## Iteration 2: the owner's decisions after the first report (2026-10-16)

| # | Decision | Done |
|---|---|---|
| 4 | NL-1-only 120-action limit, legacy 60 kept, boundary and authorization tests | Limit behind `UCT_AGENT_NL1`. Tests: 120 accepted / 121 refused (flag on); 60 accepted / 61 refused with the flag off, whether or not the request asks for NL-1; a legacy request keeps 60 even with the flag on; non-admins get 402/403 whatever the NL-1 or repair fields say; a repair that does not continue a request gets 400 |
| 5 | Under NL-1 an indicator save always shows its approval card | `withoutWordingApprovals` removes the wording-based `explicit` mark on the NL-1 path only, so the policy sees the save as irreversible and proposes it. The legacy path is unchanged |
| 6 | One bounded repair | **Server:** a plan it would reject (unknown action, arguments off-schema, a target the browser never offered) goes back to the model once, inside the same request, only if a call is left. **Browser:** a plan UCT's planner refuses goes back once, as a reroute of the same request (`repair: {errors, plan}`), so the server's 2-call ceiling bounds it, and a plan the server already repaired is never repaired again. The repaired plan passes every check again and **never asks for less approval** (`repairedDisposition`: propose stays propose). Errors are sanitized on both sides: at most 5, 200 characters each, no markup; only known actions in the previous plan |
| 3 | Verify models and prices | Published prices verified (platform.claude.com, 2026-10-16). **Correction:** Sonnet 5.5's cache read is $0.10 (0.05×), not $0.20. Reasoning is billed as output inside `max_tokens`. Account availability is checked live at the start of each run (it needs the API, so it is not done yet) |
| 7 | 10-request trial plan | [NL1-TRIAL.md](NL1-TRIAL.md): 10 dev requests (never sealed); T1 Haiku 5.5 / T2 Haiku 4.5 / T3 Sonnet 5.5; caps $0.10 / $0.85 / $1.65 = **$2.60**; expected ≈ $0.27; 30 s timeout; 2,048 output cap (reasoning included); 5 automatic abort conditions; cache and thinking measured per call |
| 8 | Sealed sets | Unchanged and still locked (hash test passes). The trial uses dev cases only, and the runner refuses a key selection that names a sealed case |

Also fixed: the estimator priced a whole run's tokens as one prompt, which wrongly applied Haiku 5.5's over-100K tier. It now prices per request.

---

## Iteration 3: free local development while the eval key is pending (2026-10-16)

The T1 trial **did not run**: no separate eval key is configured, so no API call was made. Real-model evaluation stays a release requirement. Routes audit: [NL1-ROUTES.md](NL1-ROUTES.md).

| Area | Change (NL-1 only; flags off by default) |
|---|---|
| **Payload** | Stable catalogs (the indicator catalog, and the Screener field catalog in production) leave the per-request context and travel as `reference`. The server puts them in a **second cached system block** (known keys only, escaped, ≤ 24 KB). Per-request uncached context: **9.2K → 3.6K chars** (legacy: 4.2K). The prompt is still ~24K tokens, but ~95% of it is cacheable prefix |
| **Lean catalog variant** | `UCT_AGENT_NL1_CATALOG=lean` (eval knob, default full): every one of the 91 actions with its args and summary, no usage hints. ~17K tokens per request (−30%). The real eval decides whether hints are worth their tokens (`--catalog lean`) |
| **Research routing** | Under NL-1 no keyword decides research. Removed for NL-1: news-word forcing (`_needs_current_facts`), the breadth-question regexes, the question-word gate for research beside a change, and the news/explain words for local-lookup notices. The model's `research` field decides; a new `wants_explanation` field drives the explain notice. Kept: research only on answers or mixed requests, never a change based on what was found, never for local lookups, within the call and budget limits. Legacy is unchanged (tested) |
| **Create Indicator door** | New isolated test (3 cases) found and fixed: an exact "cancel" at the door's question went to the model; it now sets the question aside with no call |
| **End-to-end panel tests** | +5 (18 in total): an injection inside a list name stays data, and the destructive plan the model "obeys" is only proposed; "yes" with nothing waiting approves nothing; a multi-step plan is one change with one Undo; a click on the model's choice lands on that chart with the question and refs; a confirm-risk "apply" waits for approval |
| **Server injection test** | Member-controlled text in `pending_question` and the last change's arguments cannot close UCT's data tags |

Not done (by design or pending):
- the real-model trial, which needs the key;
- deleting the legacy phrase layers, which happens only after NL-1 passes its gates;
- an NL-1-specific shorter rules header. Deduplicating the legacy header would save only ~2% and touches shared prompt text, so it was not worth the risk.

---

## Iteration 4: rebased onto the released Gate C (2026-10-19)

Branch `feat/agent-nl1-rebased`, worktree `C:\UCT\nl1-rebase`, on master `7d0ee0e300`. Master holds Gate C as released (PR #403), the approval-binding fix, and the stabilization (PR #423: S6 clicked chart first, S11 layout-visit memory invalidation). **Local only.** No paid call made.

| Step | Result |
|---|---|
| Rebase | The 8 NL-1 commits (`8ee0dd74b0`..`6d43add0b0`) reapplied on master. The pre-release Gate C commits under the frozen candidate were dropped: master's released Gate C replaces them. One conflict: `useAgent.js` `doUndo`, where NL-1's `return true/false` now sits beside the released `withdrawPending` dependency |
| **Integration fix (S11)** | The released layout-visit check (`memory.seeBoard`) sat inside the legacy instant path, which NL-1 skips. With the flag on, a layout revisit kept the old board's subject chart and last change in the memory sent to the model, and a correction could undo through them. It now runs before either path. Panel test: fails without the fix |
| S6 under NL-1 | The model resolves "it". It is sent the clicked chart as `selected: true` beside `conversation_memory.subject_chart`, and the glossary tells it the click comes first. Panel and server tests added |
| Approval binding under NL-1 | Two panel tests: a card whose list changed on another device is refused at "do it" (exact lane, no model call); an exact-lane Undo withdraws a waiting card |
| Reachability rail | `agent/eval/` → `agent/testing/`: test infrastructure is recognised by path. Same depth, so imports and the sealed hash lock are unchanged |
| **Both switches or none** | The browser took part of NL-1's path with only its own switch on. `GET /api/agent/config` now reports `nl1` (the server's `UCT_AGENT_NL1`), and `nl1Enabled()` needs that AND the browser switch, exactly `'1'`. Until the config answers, and on any error, the browser runs the legacy path end to end |
| **Limit: 60 for NL-1 too** | Owner, 2026-10-19 (dark merge): the proposed 120 is not implemented. `MAX_CAPABILITIES_NL1 = MAX_CAPABILITIES`. NL-1's whole catalog (~91) is over it, so an NL-1 request is refused whole before any model call, and the eval runner refuses it the same way. Behaviour tests lift the limit inside the test only |

Production impact with both switches off (the default): none. The legacy path sees two changes, neither changes its result: `seeBoard` is called earlier in the same `send()` (idempotent), and `/api/agent/config` carries one more field.

Still owed before NL-1 can be turned on: the owner's limit decision (NL-1 cannot run under 60); then the real-model evaluation (T1–T3, then the sealed sets) under a separately authorized, capped eval budget; then both switches.

---

## Iteration 5: hybrid action selection (2026-10-20)

The owner approved this on 2026-10-20: make NL-1 operational under the unchanged 60-action limit.

- Branch `feat/agent-nl1-hybrid-selection`, worktree `C:\UCT\nl1-hybrid`, on master `4456917011`. Local only.
- Design and numbers: [NL1-SELECTION.md](NL1-SELECTION.md).

| Step | Result |
|---|---|
| **Selection** | `nl1/selection.js` builds each request from: <br>• the core (charts, indicators, screener, agent; ≤ 45 actions, only available ones); <br>• pinned groups (proposal, last change, pending question); <br>• the word router as soft expansion. <br>Whole groups are packed under 55 (limit 60); the rest are named |
| **Reroute** | One bounded reroute when the model asks for groups: ≤ 3, all or nothing, inside the 2-call ceiling. It takes priority over the repair, a rerouted plan is never repaired, and there is no third call |
| **No substitution** | A prompt rule for routed requests, plus a deterministic guard: an `apply` is only proposed when the member's words pointed at a group the request could not carry |
| **Server** | NL-1 honours routing, with three cache blocks: core + rules + glossary, reference, the rest. Legacy and unrouted prompts are byte-identical to master (48 combinations checked) |
| **Eval** | Capture records the selection and a reroute table. The runner replays the reroute under production's call ceiling. Scoring reports first-call coverage, reroute rate, substitutions, escalations and tokens. Gates unchanged |
| **Coverage (dev / exposed)** | First call: corpus 97.5%, dev-nl1 100%, heldout-v1 98.8%. 100% with one reroute; 0 unreachable. Optimistic, because these sets shaped the router |
| **Prompt** | System + schema ~13–17k tokens per request, vs ~19–26k for the whole catalog (−33%). The cached block is identical on every request |

Still owed, in order:
1. the owner's approval for T1 and the paid evaluation (the selector is frozen at this iteration's commit);
2. the sealed scoring;
3. activation.

**2026-10-20, owner decision:** T1 and all paid evaluations are skipped for now. The selector was rebased onto master `57f9d08822` and released **dark** through a normal PR. Both switches stay OFF. The coverage figures above are simulated and do not prove real-model interpretation accuracy. Items 1–3 above are still owed before activation.
