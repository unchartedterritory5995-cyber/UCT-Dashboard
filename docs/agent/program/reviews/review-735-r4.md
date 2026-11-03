# Review #735 round 4: B-1 fix, N-9..N-14 (de59823327) and N-15 (3cc2a232f9)

- **Heads reviewed:**
  - code head **de59823327**, plus its board commit 107a100c1e;
  - the N-15 commit **3cc2a232f9**, which is the current #735 head.
- **Reviewer:** independent subagent, 2026-11-03. Review only: nothing pushed or merged, no flags changed.
- **Data handling:** only counts and pass/fail are reported. The real-snapshot checks opened the builder's local snapshot copy read-only and printed no content.

## Verdict: APPROVE merge-dark. B-1 is fixed. No blocking items.

One small should-fix (R4-1) is the only place where turning the flag off does not reproduce master behaviour. It fails safe and needs a one-line fix, and I recommend fixing it before or with the merge.

## B-1 (v2 knowledge answer replayed unframed): FIXED, verified

- **The fix:**
  - `turn.history_messages` (turn.py:979-982) replaces any agent row whose data names a `playbook.*` action with `[UCT] REPLAY_STUB`. A matching action can sit in the v1 ops or `actions` list, or in the v2 `envelope.steps[].action` (`frame.used_knowledge`).
  - The stub starts with `<uct_knowledge_ref/>`, and `frame.seen()` matches it.
- **r3 probe (`scratchpad/probe735/probe_replay.py`), rerun on de59823327:**

  | Check | r3 | r4 |
  |---|---|---|
  | Sentinel replayed to the model | True | False |
  | `seen` | False | True |
  | Research calls | 1 | **0** |
  | Sentinel in the research query | True | False |

  The result is identical on the rc/w11 scratch merge and on 3cc2a232f9.
- **Stub content:** `REPLAY_STUB` is fixed text plus the marker. It contains neither the passage nor `<uct_knowledge>`, and the sentinel never reaches the model.
- **Outcome rows** (`outcome_for_model`) also carry the stub with the marker, so research stays blocked. Verified.
- **Control (a conversation that never used knowledge):** research runs, 1 call. The suite's v1 control test (`test_v1_research_still_runs…`) passes as well.

### Other replay paths I hunted

| Path | Result |
|---|---|
| Rows older than the window | `history_messages` takes the last `HISTORY_TURNS*3` rows. I found no conversation summary or other reader of older rows. An old knowledge turn simply drops out, with no text and no marker, which matches the "recent turns" wording of `RESEARCH_BLOCKED`. OK. |
| Chat-naming call (`turn.name_conversation`, turn.py:1271) | Still sends the raw text of a knowledge agent row (≤ 400 characters per row) to the **naming model**. That model is Anthropic, not a web provider, and its output is a cleaned title, so this is not a decision-5 leak. It is inconsistent with "citation-only" (R4-2). |
| `/api/agent/search` | Returns the member's own stored rows to the member. No model call. OK. |
| Streamed partial replies | v2 stores the agent row only in `_v2_finish`. Error paths store fixed outcome text. A paused turn keeps its framed state. Nothing partial is stored. OK. |
| Paraphrase in a later turn with no playbook step | The earlier text is no longer replayed, so the model has nothing to paraphrase from. The marker keeps research blocked inside the window. OK. |
| `coach.explain` | No coach group or capability exists (grep: knowledge.js only). Nothing to check. |

## N-9 to N-15

### N-9: calculation date earlier than data
- A block whose `calculation_date` is earlier than `data_through` is now withheld.
- Limit: this catches impossible dates only. An import or copy timestamp is *later* than the data, so it passes this rail. The brain owner still needs to confirm that the `trigger_performance` writer and the pack export preserve `updated_at` (R4-3).

### N-10: stale data under a fresh calculation
- `data_through` older than `pack.stats_data_stale_days` (30) is withheld. An unreadable date is also withheld. This fails closed. OK.

### N-11: figures without an interval
- `expectancy`, `expectancy_r`, `avg_gain_pct` and `avg_loss_pct` are popped from every **conditional** block that is served.
- Scratch end-to-end test, deleted after the run: 5 setups (EP, kicker, HTF, VCP, U&R) × 2 regimes. I checked both the envelope data and the **v2 step result** text (`turn_v2.step_result_text` for `playbook.record`). None of the four keys appears anywhere: **PASS**.
- The other blocks (`insufficient`, `stale`, `not_served`) never carried figures.
- Note: the pop applies only to the conditional path. A source later flipped to `admit: true` would carry these figures again (R4-4).

### N-12: hard sample floor
- `stats_n_min()` returns `max(HARD_N_MIN=30, policy)`.
- Probe: policy `n_min = 5` gives 30, and an unparseable value gives 30. **PASS.**

### N-13 and N-14
- **N-13:** every playbook call counts as a read up front (`_over_reads`). The size reservation uses `read=False`, so a call is not counted twice. OK.
- **N-14:** trimming now cuts to `room - 2` before appending " …", so a turn no longer exceeds the 3,000-character budget. OK.

### N-15 (3cc2a232f9): fail closed for unresolved SETUP rows
- **Rule:** `index.excluded_by_template` now selects every `setup_knowledge` row with category SETUP. A row is withheld when it links to no template, or when every linked template is not admitted. Non-SETUP rows are unchanged. The logic is correct.
- **Fixture tag form compared with the real sync form** (real snapshot, structure counts only):

  | Real snapshot (98 `setup_knowledge` rows) | Count |
  |---|---|
  | Last tag is `setup_knowledge` | 98 of 98 |
  | 3 or more tags | 94 |
  | Distinct first tags among those 94 (setup ids) | 91 |
  | Distinct second-last tags (family) | 19 |
  | Only one tag (cannot link: withheld if SETUP, served otherwise) | 4 |

  The fixture form `id,aliases…,family,setup_knowledge` matches this shape. **PASS.**
- **Bypass hunt** (real snapshot, `kinds.search` end to end, isolated index in my scratchpad):
  - **Withheld:** 34 ids, matching STATUS (14 excluded-template + 20 no-template).
  - **Servable rows that name an excluded template (name or alias): 380.**
    - 287 trader_archive SETUP, 80 trader_archive RULE, 8 trader_archive PSYCHOLOGY.
    - 3 setup_knowledge SETUP rows: tied to an admitted template, but they also name an excluded one.
    - 2 setup_knowledge FRAMEWORK rows.
  - **Of those 380, 71 have definitional wording near the name:**
    - 56 trader_archive SETUP and 12 trader_archive RULE;
    - 2 setup_knowledge SETUP and 1 setup_knowledge FRAMEWORK.
  - **8 definitional questions about excluded setups** (VCP, HTF, EP, Stage 2, cup and handle…):
    - 16 passages were served, and 11 of them name an excluded setup.
    - Of those 11: 9 come from trader_archive (8 SETUP + 1 RULE) and 2 from setup_knowledge SETUP rows tied to an admitted template.
  - **Conclusion:**
    - The N-15 code path cannot be bypassed *within its own scope* (setup_knowledge SETUP).
    - But a member who asks "what is a VCP" mostly gets **trader_archive** passages, which the owner admitted as team-owned (`team_owned`). In them, the team's traders discuss the excluded setups in their own words.
    - That is a policy-scope question, not a code defect. Owner decision: is the team's own commentary on a third-party setup acceptable while that setup's *template* stays blocked? (R4-5)

## Tests

| Run | Result |
|---|---|
| Knowledge pytest on de59823327 (with the scratch N-11 test) | 155 passed |
| Knowledge pytest on 3cc2a232f9 | 160 passed |
| Full server suite on de59823327, under the lock (`test_uct_agent*.py` + 4 brain test files) | **2,280 passed, 0 failed** |
| Full server suite on 3cc2a232f9, under the lock | **2,281 passed, 0 failed** |
| Vitest on de59823327 (`agentKnowledge*`, `qa/modelIsolation`, `isolationAudit`, `isolationLayers`, `readDataTurnId`, 4× `agentRouting*`) | **250 passed** (10 files) |
| Scratch merge with rc/w11 b3ed064223 (local 2d468fb2f2, **not pushed**): vitest, same set | **250 passed** |
| Same scratch merge: server knowledge, research, isolation and routing set (33 files) | **1,165 passed, 0 failed** |

The scratch merge had the same 2 trivial conflicts as before: `routing.js` (union of both sides) and `modelIsolation.test.jsx` (kept this branch's list). The `used_knowledge` gate is intact on the merge (turn.py:1305), and the B-1 probe passes there.

## Non-blocking
- **R4-1 (should-fix, one line). `frame.used_knowledge` also matches any nested `"name"` key starting with `playbook.`.**
  - Failure scenario: a member asks "create a watchlist called playbook.longs". The agent row's envelope ops carry `args.name = "playbook.longs"`.
  - Probe result: `used_knowledge` True, the reply is replaced by the stub, and web research is blocked for the next 12 turns, **even with `UCT_AGENT_KNOWLEDGE` off**. This is the one place where flag-off behaviour no longer equals master. It fails safe.
  - Fix: match only `action` keys (v1 ops and v2 steps both use `action`) and `actions` lists, not `name`.
- **R4-2. Chat naming bypasses the stub.** `name_conversation` still sends the text of knowledge agent rows to the naming model. Skip rows where `used_knowledge(t["data"])`, as is already done for local and isolated rows.
- **R4-3. The N-9 rail does not prove provenance.** It cannot detect an import timestamp, because such a timestamp is later than the data. Brain-owner confirmation is still needed.
- **R4-4. The N-11 pop covers only the conditional path.** Consider popping those figures on the admitted path too, so that a later policy flip cannot bring them back.
- **R4-5. Owner scope question:** trader_archive commentary on excluded setups (counts above). Also, 3 setup_knowledge SETUP rows tied to an admitted template name an excluded one. They are served because the "all linked templates excluded" rule is per link, not per mention.
- **R4-6 (pre-existing). The exclusion query fails open on a database error.** `excluded_by_template` returns `[]` on `sqlite3.Error`, which would exclude nothing. The SCHEMA=2 rebuild makes this unlikely. Consider making `search` refuse when the exclusion query errors.

---

# r5: delta 3cc2a232f9..be4c127a41 (one code commit, then a board commit)

- **Head reviewed:** be4c127a41. Review only: nothing pushed or merged, no flags changed. Only counts and pass/fail are reported.

## Verdict: APPROVE merge-dark. No blocking items.

R4-1, R4-2, R4-4 and R4-6 are all verified fixed. With `UCT_AGENT_KNOWLEDGE` off, behaviour now equals master. The one remaining difference is theoretical and fails safe: a member who literally types `<uct_knowledge>` or `<uct_knowledge_ref/>` blocks web research.

## The fixes

### R4-1: FIXED
- `frame.used_knowledge` is now structural. It reads only:
  - the row's `actions` list;
  - the `action` of each entry in `ops`, `envelope.ops` and `envelope.steps`.
- Probe results:

  | Shape | `used_knowledge` |
  |---|---|
  | `actions` | True |
  | `ops` | True |
  | `envelope.ops` | True |
  | `envelope.steps` | True |
  | A watchlist named `playbook.longs` | False |
  | An `args` that contains `title` / `action: playbook.*` | False |

- The r4 false-positive scenario now makes 1 research call (it made 0 in r4), and the agent reply is replayed normally. This is master behaviour.

### R4-2: FIXED
- `name_conversation` skips agent rows where `used_knowledge` is true.
- Probe: one v2 knowledge row and one v1 knowledge row, each with a sentinel. The naming model is called once, and the sentinel is not sent.

### R4-4: FIXED
- `NO_INTERVAL_FIGURES` is dropped on the admitted path as well. Engine, triggers and team_archive all go through `_with_source`.
- Scratch test, deleted after the run: policy flipped to `admit: true` for both brain record sources, 5 setups × 2 regimes.
  - Win-rate blocks are still served (count > 0).
  - None of the four figures appears in the envelope or in the v2 `step_result_text`.

### R4-6: FIXED
- `excluded_by_template` returns None in three cases: no index file, a connect error, or an SQL error (probed against an index whose `docs` table is missing).
- `_blocked_ids` passes None through and never caches it (cache key unset after the call).
- `search` then excludes every `setup_knowledge` SETUP row in SQL.
- Real snapshot, 8 setup questions:

  | Run | Blocked ids | Passages | setup_knowledge SETUP served |
  |---|---|---|---|
  | Normal | 34 | 17 | 1 (tied to an admitted template) |
  | Forced "cannot tell" | — | 17 | 0 |
  | Recovered afterwards | 34 | — | — |

## Probes and tests

| Run | Result |
|---|---|
| `probe_replay.py` on be4c127a41 | sentinel not replayed, `seen` True, 0 research calls, no sentinel in the query |
| r4 probe on be4c127a41 | B-1 blocked; control 1 research call; false positive gone; hard floor 30 |
| Knowledge pytest + `ai_search_brain_full_knowledge` + scratch R4-4 test | 167 passed |
| Full server suite (under the lock; `test_uct_agent*.py` + 4 brain test files) | **2,287 passed, 0 failed** |

Scratch merge with rc/w11 b3ed064223 (local 60cec14e5f, **not pushed**):
- **Conflicts:** the same 2 trivial ones as before (`routing.js` union of both sides; `modelIsolation.test.jsx` kept this branch's list).
- **Gates:** both `used_knowledge` gates are intact (turn.py:1305 replay, turn.py:1645 naming).

| Run on the merge | Result |
|---|---|
| Replay, r4 and naming probes | all pass |
| Server knowledge, research, isolation and routing set (33 files) | **1,172 passed** |
| Vitest: knowledge, isolation, readDataTurnId, 4× routing | **250 passed** |

## Still open (owner or brain-owner items, not code defects)
- **R4-3:** confirm how `updated_at` is written (the `trigger_performance` writer, and whether the pack export preserves it).
- **R4-5:** the trader_archive scope question about team commentary on excluded setups.
