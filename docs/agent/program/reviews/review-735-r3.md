# Review #735 round 3: owner decisions 1/2/3/5 + r2 fixes (N-1..N-8)

- **Head reviewed:** f024d7dc8e (origin/agent/kn/knowledge-poc). The code head is **6d9ee0f727**; f024d7dc8e is a STATUS.md board commit only.
- **Delta:** 10a478526b..f024d7dc8e (3faccb7b07, e25ebc813e, 6d9ee0f727, f024d7dc8e).
- **Reviewer:** independent subagent, 2026-11-03. Review only: nothing pushed or merged, no flags changed. No real market values or user content were printed; only counts and pass/fail are reported.

## Verdict: APPROVE merge-dark. One item BLOCKS ACTIVATION (B-1); it does not block merge-dark.

- **Merge-dark is safe.** With `UCT_AGENT_KNOWLEDGE` unset, behaviour matches master (see "Flag-off").
- **B-1 blocks activation.** It is a real gap in owner decision 5 and must be fixed before knowledge is switched on together with planner v2.
- With planner v1 only, B-1 cannot happen, because the v1 model never sees knowledge text.

## BLOCKING (before activation, not before merge-dark)

### B-1. A v2 knowledge answer is replayed unframed in later turns, so web research is not blocked and the "citation-only" replay claim is only half true

- **Where:**
  - `api/services/uct_agent/turn.py:957-984` (`history_messages`, the `else: text = t["text"]` branch for agent rows).
  - `api/routers/uct_agent.py:284` (`_v2_finish` stores `env["reply"]`, the model's final answer, as the agent row).
  - `api/services/uct_agent/knowledge/frame.py:22` (`seen` keys only on the `<uct_knowledge>` marker).
- **What N-8 covers, and what it misses:**
  - N-8 stubs **outcome** rows that name a `playbook.*` action (turn.py:951-952).
  - In planner v2, the model reads framed passages in a step result. It then writes a final reply that cites or quotes them, which is what the frame RULE tells it to do.
  - That reply is stored as an **agent** row. Its envelope `steps` name `playbook.*`, but `history_messages` replays agent text verbatim and checks nothing.
- **Result in the next 12 turns (`HISTORY_TURNS`):**
  - Knowledge-derived text, possibly verbatim, reaches the model with no frame and without being re-checked against the current policy.
  - `frame.seen(messages)` is False, so both research doors are open: v1 turn.py:1840-1849 and v2 `_research_step` (turn_v2.py:468-471).
- **Failure scenario (probe):**
  - Turn N is a v2 knowledge answer that quotes a passage. Turn N+1 is "search the web for more on that".
  - The model writes a research query that carries the quoted text, and `_research` sends it to Perplexity.
  - Probe script: `scratchpad/probe735/probe_replay.py`. It uses a stubbed `_research` and a sentinel string, not real data.
  - Results: `sentinel_replayed_to_model: True`, `frame_seen: False`, `research_calls: 1`, `sentinel_in_query: True`. The same result holds on the rc/w11 scratch merge.
- **Why the tests miss it:** the v1 separation test (`test_v1_a_knowledge_answer_in_history_…`) uses a v1-shaped agent row ("Here is UCT's playbook."). The v2 test covers only the same turn.
- **The user-facing text implies more than the code does:** `RESEARCH_BLOCKED` says "a conversation that used UCT's knowledge base … ask in a new chat", which implies a conversation-level block. The implementation is turn-level and depends on a marker.
- **Suggested fix (small):** in `history_messages`, an agent row whose `data.envelope.steps[*].action` (or ops) names a `playbook.*` action should be replayed through `kn_frame.frame(...)`, or replaced with `REPLAY_STUB`.
  - Framing keeps the model's memory of its answer.
  - Framing also makes `seen()` fire for the rest of the history window, which gives the conversation-level block that `RESEARCH_BLOCKED` promises.
  - Add a v2-shaped history test: an agent row with a `playbook.explain` step and a sentinel, then research in turn N+1, asserting no research call and no unframed sentinel.

## What I checked (PASS unless noted)

### Owner decision 2: conditional brain-statistics gate
- **`_with_source`** (kinds.py:572-595) serves a conditional block only when all of these hold:
  - the label is `descriptive_uncontrolled`;
  - n ≥ n_min (an `insufficient_sample` block goes figure-free);
  - `_valid_date(calc_date)` is readable and no more than 1 day in the future;
  - the block is not stale (≤ 14 days);
  - `win_rate_ci95` is present;
  - the policy has a `methodology_id`.
- Every failure gives a figure-free `source_not_approved` block that keeps only `method` and `licence`. It carries no n, rate or CI.
- `updated_at` is popped. `calculation_date` is the recompute date and `data_through` is `sample_end`.
- **Paths checked:**
  - Facade figure with no pack row: no calculation date, so not served. Tested.
  - Stale pack row: `stale_record`, then not served.
  - Unparseable or NULL date: not served.
  - Future date: not served. Tested (test_n5_a_future_calculation_date…).
  - Methodology removed from policy: not served. Tested.
  - No interval: not served. Tested.
  - The trigger block takes its own date from its own row (trig_rows[0]).
- **Is `updated_at` a computation date?** Checked against the brain source I have locally (`uct-intelligence` @ a668b39, 2026-05-01).
  - `update_setup_performance` UPSERTs with `updated_at = datetime('now')` at recompute time. A new row gets the same value from the column default. No other writer touches it.
  - A skipped recompute (no rows) leaves the old date, which then goes stale. This fails closed.
  - **Not verifiable here (N-9):** the writer for `trigger_performance`, which is not in my local clone, and whether the pack build copies rows byte-for-byte rather than re-inserting them with a fresh default.
- **Wilson CI** (stats.py:25-33) uses the standard score interval, z = 1.96 (centre (p+z²/2n)/(1+z²/n), half-width z·√(p(1−p)/n+z²/4n²)/(1+z²/n)). Rate and CI come from the same counts. Hand check: 24/40 gives about 44.6–73.6 %. The known-values test exists. PASS.
- **Wording:**
  - The served label says "not compared with a base rate (not evidence of an edge)", and CAUTION is attached.
  - A test asserts the absence of "proven edge", "it works", "guarantee" and of raw scores (`rs_rank`, `quality_total`), and checks the block keys against an allow-list.
  - The archive "measured edge" label stays withheld while the archive is undated.

### Owner decision 1: ARCHIVE-ASOF-1
- The doc is additive. The code reads only `through` / `as_of`, now passed through `_valid_date`, so a future date is invalid (r2 N-5 fixed).
- Undated archive records give `undated_record`: n only, no figure or verdict. PASS.

### Owner decision 3: rights-cleared concepts
- `rights_cleared_concepts: []`.
- `rights_cleared()` requires all 5 fields to be non-empty. An incomplete entry is refused (tested).
- Third-party templates stay refused (tested: "cup and handle"). PASS.

### Owner decision 5: web separation
- Only three call sites reach the web from the Agent: turn.py:1867 and turn.py:1899 (v1), and turn_v2.py:481 (v2). All three sit behind the `seen()` check. This holds on the rc/w11 merge too: turn.py:2373/2403 and turn_v2.py:485, no new door.
- **v1:** the check runs after every way `wants` can be set, including `research_forced` from the member's own words. It retracts any streamed placeholder and replaces the reply with fixed text. The second `_research` call (:1899) is reachable only while `wants` is still true.
- **v2:** `_research_step` checks `state["messages"]` and `state["results"]`, so framed knowledge from earlier steps in the same turn blocks it.
  - Research **before** the knowledge read in the same turn sends only a query written before any knowledge existed. That is acceptable.
  - Approval-paused state keeps the frames.
  - There is no separate streaming research path.
- **Kinds:** all three refuse a `purpose` other than `answer` (tested).
- **Same turn:** PASS. **Across turns:** B-1.
- **Paraphrase within a turn:** blocking is keyed on the frame being present in the request, not on the query text, so paraphrase cannot defeat it within the turn. Across turns, paraphrase does defeat it (B-1).

### N-1: atomic reserve and refund
- `_reserve` checks and charges in one locked step.
- `_refund` only gives back characters, never reads, and is clamped at ≥ 0. Search reserves `DATA_CHARS` before the query and refunds `budget − used` afterwards.
- Early returns (index not ready, no admitted source) and exceptions do not refund. This fails closed: a refund can never let the cap be reused.
- Concurrency probe: 200 trials × 12 threads, each with a partial refund. Every trial stayed at ≤ 4 reads and ≤ 3,000 characters, and the ledger balanced exactly. PASS.

### N-2 to N-7
- **N-2:** playbook output is bounded to `DATA_CHARS` and charged to the per-turn character budget.
- **N-3:** the coaching regex now uses `[\s\S]` (whole message), and `practice` is narrowed.
- **N-4:** the guard has fewer false positives. "Model Book" and "I override my rules" are no longer withheld, and the reviewed attack shapes are still caught.
- **N-5:** future dates are treated as invalid.
- **N-6:** `k_max` is read from policy, with a hard ceiling of 3.
- **N-7a:** a record for an excluded setup carries `setup_template.status = not_approved`.
- **N-7b:** `setup_knowledge` rows linked only to excluded templates are filtered in SQL (`exclude_ids`). STATUS reports 14 of 98 on the real snapshot.
- PASS, with the notes in N-10 and N-11.

### 6d9ee0f727: test leak
- The separation tests now stub `turn._research`, the one function both planners call.
- The proof still holds, because the gate sits in front of `_research`. The control tests use a unique query, so the research cache cannot serve them.
- The underlying leak, `tools/agent_eval_ledger.stub_research` staying bound across tests, belongs to another package and was reported to the integrator. Agreed.

### Flag-off equals master
- With `UCT_AGENT_KNOWLEDGE` unset:
  - no `playbook.*` capability registers, so no `playbook.*` rows are created and the N-8 stub path is inert;
  - no `<uct_knowledge>` frame is produced, so `seen()` is False and research is unchanged;
  - the index and kinds code is unreachable.
- The research tests in the full suite pass, including the control test "research still runs without knowledge".
- One theoretical difference is in N-12.

## Tests

### On 6d9ee0f727 (worktree at f024d7dc8e)
- Knowledge pytest (`test_uct_agent_knowledge.py` + `test_ai_search_brain_full_knowledge.py`): **150 passed**.
- Full server suite (`tests/test_uct_agent*.py` + 4 brain test files), run under the suite lock: **2,271 passed, 0 failed**.
- Full browser suite (`src/agent`), run under the suite lock: **2,673 passed, 6 skipped, 0 failed** (155 files passed, 5 skipped). The qa/modelIsolation timeout did not recur.

### Scratch merge with origin/agent/rc/w11 (b3ed064223)
- Local merge commit ab2ce4c894, **not pushed**.
- Two conflicts, the same as r2. Both are trivial:
  - `routing.js`: union of rc's W1.1 R-04 `indicatorAlerts` words and KN-1's `playbook` group.
  - `qa/modelIsolation.test.jsx`: kept HEAD's known-reader list, which includes knowledge.js.
- `turn.py` and `turn_v2.py` auto-merged. The knowledge gates are intact, and there is no new web door.
- **Server:** 1,156 passed, 0 failed. This covers every `test_uct_agent*.py` that touches research (30 files, including knowledge, routing, planner_v2, screen_research and all qa_isolation*), plus `isolation_layers`, `isolation_lead_fixes` and `ai_search_brain_full_knowledge`.
- **Browser:** 250 passed in 10 files. These are `agentKnowledge*`, `qa/modelIsolation`, `isolationAudit`, `isolationLayers`, `readDataTurnId` and the 4 `agentRouting*` suites.

## Non-blocking
- **N-9. Provenance of the date is only partly verified.** `setup_performance.updated_at` is a recompute timestamp in the brain source I could read, but that clone is from May.
  - Not verified: the `trigger_performance` writer, and whether the Brain Pack export preserves `updated_at` rather than re-inserting rows with `DEFAULT datetime('now')`. A re-insert would turn the date into an import timestamp.
  - Ask the brain owner to confirm both. A cheap rail: require `updated_at >= sample_end`.
- **N-10. Fresh calculation over stale data.** A daily recompute over stalled inputs gets a fresh `calculation_date`. The gate does not check how old `data_through` (`sample_end` = the newest `date_flagged`) is. Consider bounding it, or showing it prominently.
- **N-11. Expectancy and averages are served with no interval.** `expectancy`, `expectancy_r`, `avg_gain_pct` and `avg_loss_pct` reach the v2 model with no uncertainty. The browser card does not render them. The owner asked for "appropriate uncertainty", so consider dropping them from conditional blocks or labelling them descriptive with n.
- **N-12. The n ≥ 30 floor and a member-typed marker.**
  - `policy.stats_n_min()` is `max(1, policy)`. The owner's n ≥ 30 rule depends on policy.json, which is 30 today. Consider a hard floor of 30 for conditional sources.
  - A member who types or pastes the literal `<uct_knowledge>` disables web research for the next 12 turns, even with the flag off. This is harmless and fails safe.
- **N-13. Playbook refusals no longer count as reads.** `setup.playbook` refusals (unresolved name, excluded template) no longer use up one of the 4 reads per turn: the reservation now happens after the checks. Refusals carry names only, so the cost is pack connections. Admin-dark.
- **N-14. Search over-run of 2 characters (pre-existing).** Trimming appends " …" after cutting to `room`, so a turn can exceed the 3,000-character budget by 2 characters. The refund is clamped, so nothing is reused.
- **N-15. N-7b links rows to templates by tags.** It relies on the tag layout "setup id + aliases + family + 'setup_knowledge'". A row whose tags do not resolve to a template stays served (fails open). The real snapshot excluded 14 of 98 rows. Worth a check by the owner of the sync format.
