# Independent review: Wave 3 coach stack (2026-11-03)

Review only. Nothing was pushed, merged or flag-changed. No real market or member data was used: all probes ran on scripted models and synthetic fixtures.

## Reviewed heads (base `agent/int-w3` e6740b5b08)

| PR | Branch | Head |
|---|---|---|
| #724 | agent/w3/coach | 5f789ac619 |
| #729 | agent/w3/coach-journal | 2d9f0bdae0 |
| #730 | agent/w3/coach-workflow | e43b037b52 |
| #745 | agent/w3/coach-vocab | 3a00b70e2c, plus **a4e79994ec** (the owner's "no approved definition" refinement, on top with no rewrite) |

Spec: PROGRAM.md on origin/agent/int b8d20a1286, Wave 3 acceptance (a)–(f), owner decisions N5 and B4.

## Verdicts

| PR | Verdict |
|---|---|
| #724 coach + guard | **BLOCKING** (B1, B2) |
| #729 journal | **BLOCKING** (B3) |
| #730 workflow | APPROVE (nothing beyond the inherited items) |
| #745 vocab + a4e79994ec | **BLOCKING** (B4); non-blocking N-items |

## Prior blockers

- **C1 is fixed. Coach turns stay on v1.** I added a behavioural test of the streamed router path, not just a source check. Settings: `UCT_AGENT_PLANNER=v2`, `UCT_AGENT_COACH=1`, `UCT_AGENT_STREAM=1`, and a coach context entry. I posted to `/api/agent/turn/stream` with a stream caller that emits a violating partial reply. Result:
  - The only event was `final`, with no `delta` events and no v2 token registered.
  - No `tools` were in the model call.
  - The reply was `guard.FIXED`, and the stored transcript does not contain the violating text.
  - **PASS.**
- **C1 side-door is closed.** Under v2 with the flag on and no coach entry, the model emitted a step on `journal.reviewTrades`. It was refused with "unknown target", because the coach ref only exists when the coach context entry rides. **PASS.**
- **C2 is fixed.** `_FOOTER_RX` strips the footer before the hedge check, including the variant "Educational, not financial advice!". **PASS.**

## BLOCKING

### B1 (#724): flag-off routing is not identical to base
**Where:** `app/src/agent/routing.js:166-170`

The `coach` group's `words` are evaluated in `selectGroups` even when no coach capability is registered. On a dark server they still set `matched = true`, which turns off the "nothing recognised, so send the full or filled catalog" behaviour.

**Failure scenario:** I ran the real 133-capability golden manifest through `routeManifest` with limit 60 and budget 55.
- These messages send **55 capabilities on base but 1 on head**, with the flag off: "show me my journal", "how did my trades go", "quiz me", "coach".
- The model then has nothing to act with and needs a reroute (an extra paid call) or fails.
- 4 of 14 probe messages differ. The words have existed since 5f789ac619, and the earlier heads had an even broader list.

**Fix:** count a group's word hit only when the manifest has at least one capability in that group, or add the coach group to `GROUPS` only while it is registered. Add a test that flag-off routing equals base over a corpus.

### B2 (#724): the guard misses plain advice and future-claim phrasings
**Where:** `api/services/uct_agent/coach/guard.py:213-260`, mirrored in `app/src/agent/coach/guard.js`

The guard passes all 25 fixture cases, so (f) is met. But it returns **clean** for:
- "Based on this, I recommend buying it before earnings."
- "I'd recommend picking up a starter position here; it may work."
- "You might want to accumulate shares on any dip."
- "This may be a good spot to initiate a long position."
- "This could be worth trading tomorrow morning."
- "It could pause first, but it'll rally next week." (`'ll` is not matched as `will`)
- "You will make money on this, historically." (the `will` verb list has no make/profit)
- "There's essentially zero chance this fails."
- "This name is poised to soar … may happen soon."

These are the most likely ways a model phrases advice, not exotic attacks. The "no advice or order language" rule is breached through the server's only deterministic rail.

**Fix:**
- Add advice verbs: recommend, suggest, want to, worth, initiate, accumulate, start, a position.
- Add `'ll` and `will` + make/profit/win/earn.
- Add "zero chance", "poised to".
- Put every one of these into `coachGuardCases.json`.

Non-blocking hardening for the same guard:
- Accent folding: `guarántééd` passes. Fix with NFKD and strip combining marks.
- Non-breaking hyphen inside the word: `guaran‑teed` passes.
- Letter-glued figures: `up50%` is not counted as a figure.
- Parity drift: the JS mirror's `\d` misses Arabic-Indic digits, which the server catches. `journal.proposeNote` is checked only by the JS mirror.

### B3 (#729): journal stats reach the model through history, regardless of consent
**Where:** `app/src/agent/capabilities/coach.js:256-263`

`journal.reviewTrades` is not `localOnly`, and it is not in `turn.LOCAL_ONLY_ACTIONS` (`api/services/uct_agent/turn.py:712`). So `useAgent` `record()` stores the full `reviewText` as an outcome row: counts, win rate, average R, largest win/loss, and the member's own mistake and emotion tags. `turn.outcome_for_model` then replays it verbatim as `[UCT] Your last 10 closed trades: …` into every later model request in that conversation.

**Failure scenario:**
1. The member grants consent and runs a review.
2. They say "stop using my journal".
3. Every later turn still sends the stats to the model. That includes non-coach turns and v2 turns, with no coach guard.

This defeats the consent-gated `sanitize_context` / `model_view` channel. It also persists journal-derived data in Agent transcripts, which the owner's retention decision does not approve. Verified with a test on `outcome_for_model`.

**Fix:** mark `journal.reviewTrades` as `localOnly: true` and add it to `LOCAL_ONLY_ACTIONS`. The model then gets journal stats only through the consent-checked context entry. Add a revoke test that covers history.

### B4 (#745 incl. a4e79994ec): a named setup can still get an uncited coach definition
**Where:** `app/src/agent/coach/brain.js:84-98` (`setupNamed`) and `capabilities/coach.js` `explainConcept`

`setupNamed` knows only the 48 short canonical names. A spelled-out setup name therefore misses the setup branch and falls to `conceptFor`. I probed with the real 13 concept rows and no Brain kind served:
- "power earnings gap" / "power earnings gaps" (the PEG template) returns the earnings-gaps concept note as a **plain answer**. There is no "can't retrieve an approved playbook definition" statement and no "General background" heading. This is exactly the uncited path a4e79994ec meant to close.
- "high tight flag" resolves to **Tight Flag**, not **HTF**. That is the wrong template, and it would fetch the wrong playbook entry when the kind is served.
- "volatility contraction pattern", "episodic pivot", "undercut and rally", "follow-through day" and "cup and handle" fall to "I don't have a coach note". That is safe, but it skips the playbook for VCP, EP, U&R, FTD and Cup with Handle.

**Fix:**
- Add spelled-out aliases for the abbreviated templates: PEG, EP, HTF, VCP, U&R, FTD, HVC, BGU, Cup and Handle.
- Use longest-match, so HTF wins over Tight Flag.
- Add a test that no canonical name or its long form reaches a `PLAIN-NOTE` answer.

The model-authored path is not covered deterministically: the coach prompt forbids own definitions, but the guard does not check for them. List it as a known limit.

## The `teach` option (a4e79994ec): a dead gate, not a hole today
`explainConcept(topic, host, { teach = true })` is called only with the default, at `coach.js:239`. Only `agentCoachVocab.test.js:222` passes `false`. So the documented condition "background only for a teach / explain request" (VOCABULARY-MAP.md) is not enforced. Every `coach.explain` call is a teach request, including model-planned ones such as "is this a Stage 2 Breakout?".

The output there is still policy-compliant: the no-definition statement plus a heading-labelled generic note, only when that note names no setup. So the dead gate does not hide a hole now. It will mislead whoever relies on it.

**Recommendation (non-blocking):** either wire `teach` to the request (for example, false when the model plans `coach.explain` without coaching words), or drop the option and the doc clause. Separately, `namesASetup` is only as good as `setupNamed`, so B4 also weakens the background check.

## Other checks

- **Flag off or non-admin:**
  - With the flag off, `/api/agent/coach/concepts` returns 404, config reports `coach: false`, and the `coachConsent` state key returns 404.
  - A non-admin gets 403 on concepts and on consent GET/PUT.
  - A flag-off turn with a forged coach context entry gets no coach block and no guard.
  - The browser registers nothing unless the config says `coach: true`.
  - All **PASS**, apart from routing (B1).
- **Consent:**
  - Consent is per conversation: granting in A leaves B as `None`. Another user gets 404 on GET/PUT of A's consent. **PASS.**
  - Non-blocking: the server trusts the browser's `consent: "granted"` claim in `sanitize_context` without checking `store.get_state`.
  - Non-blocking: `lastReview` is module-global, so after consent in B, conversation A's stats can ride into B's context and the note-guard inputs.
- **Telemetry:** value-free. It records actions and disposition only, and `usage.coach_guard` holds codes only. **PASS** (the leak is history, B3).
- **Writes:** the only writes are `POST /api/j2/notes`, a confirm-risk proposal, and the conversation-state PUT for consent. **PASS.**
- **Brain reads:** only `readData('knowledge.search' | 'setup.playbook')`, through the MD-1 gateway with the turn id, and no import of the knowledge package. **PASS.**
  - On this base the kinds do not exist yet, so the Brain is unreachable and behaviour is byte-identical when knowledge kinds are not served (covered by `agentCoachVocab` tests).
  - **Pre-integration with #735:** `coach.explain` answers are not `localOnly`. Passage and template text, up to 900 and 3,000 characters, would be stored in transcripts and replayed, which conflicts with B4 (no raw passages persisted). Make the Brain-led answers local or citation-only before combining with #735.
- **Concept docs:** none of the 13 names a canonical template. Their aliases collide only with generic words: "tight base", and "accumulation" / "distribution" in the volume note. The latter is fine under the heading rule. **PASS.**
- **v2 functional gap (non-blocking, v2 is off):** a coach turn under a v2 browser is served by v1, but `steps.js finish()` renders only `env.reply`. Any v1 ops (`coach.explain`, `journal.reviewTrades`, `coach.consent`, note proposal) are silently dropped. Coaching is degraded when v2 is on.
- **Non-blocking:**
  - `guard_envelope` does not check op args (for example, chart annotation text) or the model-written conversation title.
  - `ensure_footer` skips the footer whenever the reply contains the word "educational".
  - Follow-up turns without coaching words are not coach turns, so they get no guard. This affects (e) continuity and relies on the `next` chips carrying coaching words.
  - Figures from the member's own message count as "traceable".

## Tests

| Run | Result |
|---|---|
| Coach pytest at 3a00b70e2c | 129 passed |
| Coach vitest at 3a00b70e2c | 124 passed (5 files) |
| Coach vitest at a4e79994ec | 126 passed (5 files) |
| Full pytest `tests/test_uct_agent*.py`, under the lock, at 3a00b70e2c | **2225 passed**, 0 failed (5:23). a4e79994ec changes only JS and docs, so this carries over. |
| Full vitest `src/agent` + `agentMutations`, under the lock, at a4e79994ec | **2814 passed**, 6 skipped, 0 failed (162 files passed, 5 skipped) |
| Review probes (scratch, not committed) | 7 pytest router/consent/history probes: all pass, and they confirm the findings above. Node guard and routing comparison scripts, and a vitest N5 probe. |

## Scratch merge with origin/agent/rc/w11 (b3ed064223)
Made as a local commit df7bfe6253 in a temporary worktree. **Not pushed.** The worktree has been removed.

**Conflicts:**
- `api/services/uct_agent/turn.py`, two hunks. Wave 1.1 added `claim_repaired=` to both `sanitize_envelope` calls, and the coach adds `guard_envelope` after them. Resolved as: Wave 1.1's line, then the coach guard. Order matters: the guard must run after the claim repair.
- `docs/agent/program/BOARD.md`: kept both sides.

On the merged tree, Wave 1.1 adds a `nonsense_clarify()` early return. It is a deterministic server text, so it does not bypass the guard. All coach hooks are present.

**Tests on the merge:**
- pytest, coach + qa/isolation + isolation layers + contract + planner_v2: **253 passed**.
- vitest, `agentCoach*` + `qa/isolation*` + `qa/modelIsolation` + `agentIsolationL5` + `agentContracts` + `agentEvalBaseline`: **173 passed** (11 files).
