# Review #735 round 2: owner decisions (N3 / N5 / B3 / caps / archive as-of)

- Head reviewed: **10a478526b** (origin/agent/kn/knowledge-poc). Code range 668f9903ed..4b144368ce, plus test-only 4b144368ce..10a478526b.
- Reviewer: independent subagent, 2026-11-03. Review only: nothing pushed or merged, no flags changed.

## Verdict: APPROVE merge-dark. No blocking items.

## What I checked

### N3 default-deny (templates and records)
- `setup.playbook` (kinds.py:414-416) refuses unless `classify_template(origin_trader)` admits it. Only `templates.team_origins` is admitted. "various" and "" are unresolved, and any other origin is excluded as third-party (policy.py:75-91). An admitted result carries `licence`, `source` and `approved_by_policy` (policy version). Owner-reviewed criteria are attached only after the admission check. PASS.
- `setup.record`: `setup_performance` and `trigger_performance` are `admit:false` in policy.json, so `_with_source` (kinds.py:512-518) replaces the whole block, including any facade figures, with a figure-free `source_not_approved` block that keeps only `method` and `licence`. If no record source is admitted, the read is refused. `team_archive` is admitted and carries source and licence. PASS.
- Bypass hunt:
  - The only paths to these kinds are the gateway route and the browser capabilities (`readData` with the current turn id, enforced by `qa/readDataTurnId`). There is no server-side v2 tool path. `turn_v2.py` and `turn.py` only frame replayed knowledge text.
  - Search reads `knowledge_base` only, through the admitted sources `trader_archive` and `setup_knowledge`. It never reads `setup_templates` content. Template names and aliases feed only `expansion_phrases` (OR terms) and refusal or ambiguity text (names only).
  - I found no template content reachable through another kind.

### Archive freshness
- kinds.py:497 reads only `through` and `as_of`, never `updated_at` or `imported_at`.
- With no date, `stats.archive_block` returns `undated_record` with n only (no rate, CI or verdict).
- A dated record older than 14 days becomes `stale_record`. An unparseable date counts as stale, so it fails closed.
- The browser renders all three figure-free labels (knowledge.js:81). PASS.

### Caps (server-side)
- k <= 3: `validate_search`, enforced by the gateway before the read.
- 500 chars per excerpt: `excerpt_chars`.
- 1,900 per result: the `DATA_CHARS` loop, with a test at line 384.
- 4 reads per turn across all three kinds: `_over_reads`.
- 3,000 excerpt chars per turn: budget check plus trimming plus `_turn_take`.
- All of these run in Python, inside the gateway call. PASS, with the caveats in N-1 and N-2.

### N5 coaching split
- `COACHING` negative lookahead is applied to all three `PLAYBOOK_WORDS` regexes.
- The tests cover 5 coaching phrasings (not playbook) and 3 definition phrasings (playbook).
- No coach group exists, so coaching asks reach no knowledge group. There is no competing source of definitions. PASS, with the precision notes in N-3.

### B3 injection patterns
All 4 added patterns are present (guard.py:22-25) and are applied to the whole passage, the title, the trader and template fields. PASS. False positives are noted in N-4; they fail safe.

### Flag-off
- This range touches only `knowledge/*` (every kind validates `UCT_AGENT_KNOWLEDGE`) and `knowledge.js` (routing words are armed only while a knowledge capability registers).
- Nothing in this range touches the gateway, turn or turn_v2 code.
- With `UCT_AGENT_KNOWLEDGE` unset, behaviour is unchanged from master (as approved at 668f9903ed). PASS.

### 4b144368ce..10a478526b (test-only)
- adca17b6a9 and 10a478526b each touch only `app/src/agent/qa/modelIsolation.test.jsx`.
- adca17b6a9's file is byte-identical to b3ed064223's. cd596b95ad, the commit in between, is the docs-only STATUS.md board update.
- `knowledge.js` is actually scanned. Mutation check: I changed one `readData('setup.record'` in knowledge.js to an isolated kind, and the scan FAILED with two violations at knowledge.js:174. I then reverted the change.

## Tests (on 10a478526b)
- pytest `test_uct_agent_knowledge.py` + `test_ai_search_brain_full_knowledge.py`: 123 passed.
- vitest `agentKnowledge`, `agentKnowledgeCompare` and `qa/modelIsolation`: 113 passed.

## Compatibility merge: origin/agent/rc/w11 (b3ed064223) into 10a478526b
Scratch merge c69ffcae6c, not pushed. 2 conflicts, both trivial:
1. `app/src/agent/routing.js`: rc/w11's new W1.1 R-04 `indicatorAlerts` words against KN-1's new `playbook` group in the same hunk. Resolution: take rc's `indicatorAlerts` words, then the playbook group (union).
2. `app/src/agent/qa/modelIsolation.test.jsx`: the known-reader list. Resolution: keep HEAD (the list including knowledge.js).

Results on the merge:
- pytest knowledge + agent-qa isolation (`isolation_layers`, `isolation_lead_fixes`, `qa_isolation`, `qa_isolation_audit`): 185 passed.
- vitest knowledge + `qa/modelIsolation`, `isolationAudit`, `isolationLayers` and `readDataTurnId`: 147 passed.
- vitest routing suites (4 files): 97 passed.

## Non-blocking
- **N-1. Check-then-charge race.** In kinds.py:58-64, `_over_reads` reads the state and charges it under two separate lock acquisitions. In `search`, the excerpt budget is read at :162 but charged only at :236. Two concurrent reads with the same (user, turn_id) can therefore exceed 4 reads or 3,000 chars. The browser executes capabilities sequentially, so I see no current path. Fix: check and charge atomically in one locked `_turn_take`, and reserve the budget before the query.
- **N-2. Cap scope.** The cap is keyed on the client-supplied `turn_id` of `/api/agent/data` (admin-dark), the same model as the MD-1 gateway caps. A client minting fresh turn ids is not limited. The browser uses the real turn id, which a QA test enforces. Also: playbook and record results are counted as reads but are not charged to the excerpt-char budget, and the playbook result has no 1,900-char bound (10 fields x <=600 chars). Planner v2 truncates at 2,000.
- **N-3. N5 regex precision.** In knowledge.js:147, `^(?!.*X).*re` without the `s` flag only examines the first line. `"hi\nwhat is a VCP setup"` no longer routes to playbook; before this change it did. The bare word `practice` excludes "what is the practice of a VCP setup" and "i practice a lot; what is a VCP setup". Suggestion: use `[\s\S]*` and drop the bare `practice` or require `practice (applying|with) me`.
- **N-4. B3 false positives (fail-safe).** `as the model` also matches "as the Model Book...", a UCT feature name. `override ... rules` matches traders writing "I override my rules". Those passages are withheld, not leaked.
- **N-5. Archive `through` in the future.** The age is negative, so the record is never stale. Consider treating a future date as invalid, which would fail closed.
- **N-6. Policy `search.k_max` is not read.** The code hard-codes 1..3. Lowering it in policy.json would have no effect.
- **N-7. Excluded-origin setup names still resolve for `setup.record`.** That serves the admitted `team_archive` figures under that setup's name, which is consistent with the policy because the record source is the team's own calls. Separately, `setup_knowledge` (98 rows, owner-admitted) may contain distilled descriptions of setups whose templates are now excluded (EP, VCP, HTF). Owner to confirm that this is acceptable. I could not count it locally because the installed pack here has empty `setup_templates` and `knowledge_base`.
- **N-8. Replayed history.** Knowledge text replayed from earlier turns is framed (B2) but not re-checked against the current policy or counted against the per-turn caps.
