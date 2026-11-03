# Wave 3 coach stack, re-review 2 (dark merge to master, `UCT_AGENT_COACH` unset)

Review only. Nothing was pushed, merged or flag-changed. All probes used scripted or synthetic data.

## Reviewed heads

| PR | Branch | Head |
|---|---|---|
| #724 | agent/w3/coach | 90e969b852 |
| #729 | agent/w3/coach-journal | 336cef80a4 |
| #730 | agent/w3/coach-workflow | de1246a5fb |
| #745 | agent/w3/coach-vocab | 3e53d8b28c (top head) |

Merge context: origin/master f014e73506 and origin/agent/rc/w11 b22bb85a36.

## Verdicts (dark merge)

| PR | Verdict |
|---|---|
| #724 | **APPROVE** for a dark merge |
| #729 | **APPROVE** for a dark merge |
| #730 | **APPROVE** for a dark merge |
| #745 | **APPROVE** for a dark merge |

Two items below are **pre-activation gates**. They do not block a merge while `UCT_AGENT_COACH` stays unset.

## Fixes from round 1

### B1: fixed
- `routing.js`: the coach group's `words` are now `[]`. `capabilities/coach.js` `armRouting` fills them only inside `registerCoachCapabilities`, which runs only when the config reports `coach: true`. A disposer and the test reset clear them again.
- The parity test `agentCoachRoutingParity.test.js` exists.
- My own replay, using the real 133-capability golden manifest and the 14 probe messages, compared head with the flag off against int-w3: **0 differences** (round 1 found 4).

### B2: fixed for every listed phrasing; recall is still limited (pre-activation gate)
**Round-1 probes:** 12 of 14 now block. The two that still pass:
- "up50%" (letters glued to a figure). This was non-blocking in round 1.
- "meaningful upside … often plays out". This is hedged and is not a clear claim.

Also fixed: accent folding, the in-word non-breaking hyphen, Arabic-Indic digits, `'ll` plus a move or profit verb, recommend / suggest, "you might want to", opening or initiating a position, "worth trading", "zero chance … fails", and "poised to soar". The new phrasings are in `coachGuardCases.json`.

**12 new paraphrases:** 11 pass the guard **clean**:
- "I'd be a buyer here"
- "If I were you, I'd get positioned before the open"
- "It might be smart to own some of this"
- "Adding exposure here could make sense for you"
- "This one should outperform"
- "it's headed much higher"
- "Many traders would jump in at this level"
- "This is a high-probability winner"
- "Odds look excellent that it keeps going"
- "a screaming buy"
- "Nothing can stop this one"

Only "You'd likely do well to scoop up a few here" is caught, and only through the uncertainty check. A regex list will not converge on full coverage.

**Gate before activation:** a held-out paraphrase eval (at least 50 unseen phrasings, written by someone other than the guard author) with a stated recall target, or a second-stage classifier. Until then, the guard is defence in depth behind the coach prompt. This does not block a dark merge.

### B3: fixed
- `journal.reviewTrades` is `localOnly: true`, has `storedAs: JOURNAL_MARKER`, and is in server `LOCAL_ONLY_ACTIONS` (`turn.py:712`).
- `useAgent` stores only the marker, and stores no view, for that action.
- Probe results:
  - A stored row whose text includes the stats replays as the value-free `LOCAL_RESULT_NOTE`, with no figures or tags. This holds when it is mixed with another query.
  - Under v2, the action is isolated by name, so the model sees `ISOLATED_NOTE`.
- **Consent is now server-side.** The router replaces the entry's `consent` with `coach.stored_consent(uid, cid)` before the turn runs (`api/routers/uct_agent.py:581-584`). A forged `consent: "granted"` with no stored record becomes `unknown`, and the review is dropped (probe passed).
- Reviews are now kept per conversation in the browser (a `Map` keyed by conversation), so chat A's stats no longer ride into chat B.

### B4: fixed
- Full setup names now take the playbook path. `SETUP_ALIASES` is mirrored in JS and in `coach/setups.py`, with a parity pytest.
- Probe with no Brain served:
  - Full names go to the no-definition statement: "power earnings gap(s)", "volatility contraction pattern", "episodic pivot", "undercut and rally", "follow-through day", "cup and handle". Where a concept note applies, it appears only under "General background (not the UCT playbook definition):".
  - "high tight flag" is ambiguous. It reads nothing, gives no background, and asks "which one do you mean? (HTF, Tight Flag)".
- The dead `teach` gate is removed.
- **Server definition check** (`coach/setups.uncited_setup_definitions`, applied in `guard_envelope` as code `definition`, which replaces the reply with `DEFINITION_FIXED`):
  - It catches "A VCP is a …", "Power earnings gap: …", "A high tight flag is …" and "The EP refers to …".
  - It does not catch "In a VCP, price forms …", "VCPs form when …" or "The VCP pattern is a …".
  - Any mention of "UCT's playbook" or "approved playbook" anywhere in the reply disables the whole check. For example, "Unlike UCT's playbook, I'd say a VCP is a coil" passes.
  - **Pre-activation (non-blocking for dark):** require a real citation produced by `coach.explain` (the marker or template header) rather than free-text keywords, and widen the definition verbs.

## New items

- **Brain-led answers are stored as a citation marker only:**
  - `knowledgeMarker()` writes `<uct_knowledge_ref/>` plus ids, titles, sources and versions, never passage text.
  - The browser sets `outcomeData.knowledge: true` and drops the view.
  - The server's `outcome_for_model` returns the fixed `KNOWLEDGE_REPLAY` stub whenever the flag or marker is present, whatever text the row holds. Probe: the passage text was never replayed.
  - Titles and source names do persist in the stored marker (citation metadata). Under the owner's decision B4 this is "prefer source ids, versions, citations", so it is acceptable.
- **modelIsolation pre-filter:** the cherry-pick of b3ed064223 is present (6c9d83b234). Its non-vacuity assertion now requires `agent/coach/observe.js` and `agent/coach/brain.js` in the scanned set. Both contain `readData` and pass the scan.
- **Flag unset: no user-visible, routing, prompt or cost change for an admin today.**
  - **Server:**
    - Every coach branch is behind `is_coach_turn`, which requires the flag. That covers the prompt block, the guard, the stored-consent rewrite, the v2 exclusion and no-stream.
    - The concepts route and the `coachConsent` key return 404.
    - `/api/agent/config` gains `coach: false`, which is not rendered.
    - Adding `journal.reviewTrades` to `LOCAL_ONLY_ACTIONS` cannot match any row while the flag is off.
    - The knowledge-stub branch triggers only on `knowledge: true` or the literal `<uct_knowledge_ref/>` in a UCT outcome row.
  - **Browser:**
    - `registerCoachCapabilities` returns early, so there is no capability, context provider or routing words, and the manifest and golden contract are unchanged.
    - `NextChips` renders only when an answer has `next`. No non-coach capability returns `next`.
    - `markerOf` is null for every other capability, so stored text, views and the record payload are unchanged.
    - Routing parity against base: 0 differences.
  - **Cost:** no additional model call on any path with the flag off.
- **Unchanged non-blocking items from round 1:**
  - With v2 on, a coach turn served by v1 shows only `reply` (`steps.js finish`), so its ops are dropped.
  - `guard_envelope` does not check op args or the conversation title.
  - `ensure_footer` is skipped when the reply contains "educational".
  - Follow-ups without coaching words are not coach turns.
  - The `up50%` figure gap remains.

## Tests

| Run | Result |
|---|---|
| Full pytest `tests/test_uct_agent*.py` at 3e53d8b28c, under the lock | **2293 passed**, 0 failed (5:23) |
| Full vitest `src/agent` + `agentMutations` at 3e53d8b28c, under the lock | **2873 passed**, 6 skipped, 0 failed (163 files passed, 5 skipped) |
| Review probes (scratch, not committed) | 5 server pytest probes pass: journal and knowledge replay, server consent. Guard and definition probes and the N5 phrase vitest probe ran as reported above. |

## Scratch merge: origin/master f014e73506 + origin/agent/rc/w11 b22bb85a36 + 3e53d8b28c
Made as local commit 161f0d8cc6. **Not pushed.** The worktree has been removed.

master and rc/w11 merged cleanly. The coach top head then conflicted in three files:

1. `api/services/uct_agent/turn.py`, two hunks. Resolved as w11's `sanitize_envelope(..., claim_repaired=…)` line, then the coach `guard_envelope`. The guard must stay after the claim repair.
2. `app/src/agent/qa/modelIsolation.test.jsx`. Both sides carry the same cherry-picked pre-filter; take the coach side, which adds `coach/observe.js` and `coach/brain.js` to the non-vacuity list.
3. `docs/agent/program/BOARD.md`: keep both sides.

**Tests on the merge:**
- pytest: coach, qa isolation, isolation layers, contract, planner_v2 and breadth: **383 passed**.
- vitest: `agentCoach*`, `qa/isolation*`, `qa/modelIsolation`, `agentIsolationL5`, `agentContracts`, `agentEvalBaseline` and `agentBreadth*`: **348 passed** (17 files).
