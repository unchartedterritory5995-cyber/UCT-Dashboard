# #988: the anchor of a relation is never the target (agent/pl/fix-relative-refs)

LOCAL / SIMULATED evidence (jsdom, scripted model plans, through the real panel). Production is checked only after merge.

## Newly fixed on this head (since the AUDIT hold at 91cf48dc79)

1. **A price clause is no longer read as "leave the clicked chart alone"** (AUDIT probe 2, the release blocker).
   "make it weekly, it's sitting on support" with a chart clicked used to reply "You said not the chart you clicked…" and change
   nothing. The clicked chart now goes weekly. The "stays as it is" reading now needs a subject that names the chart, a verdict word
   (fine / right / ok) that ends the clause, and no price place after "stays" / "remains".
2. **"You said not …" only when the words contain a negation word.** A click left out by "leave this one alone" or "the one I
   selected stays daily" now reads "You asked me to leave out the chart you clicked…".
3. **"keep this one daily, make the others weekly"** keeps the clicked chart as it is and changes the others (also broken on master).
4. **"every chart except <a relation to the click>"** (AUDIT ruling, option 2). Example: "set every chart to weekly except the one
   diagonally across from this one". Before, a correct plan was asked about with one-chart choices that left the clicked chart out,
   so the right set could not be picked. Now the Agent asks once and offers the whole set as one choice that names every chart
   ("Chart (c0), Chart (c1) and Chart (c2)"), plus Cancel. Picking it changes exactly those charts, and nothing changes before the
   pick. The clicked chart is in the set only when an unscoped "every" / "all" / "everything" covers it. A scoped quantifier
   ("every chart below this one …") never includes its anchor. This question only replaces one a check was already going to ask,
   so no new questions are added. A correct plan that went through before ("everything weekly except TSLA") still applies at once.

## Try it (2×2 board, click the top-left chart)

- "make it weekly, it's sitting on support": the clicked chart goes weekly, nothing is asked.
- "keep this one daily, make the others weekly": the other three go weekly, the clicked one stays daily.
- "set every chart to weekly except the one diagonally across from this one": one choice naming the top-left, top-right and
  bottom-left charts; pick it and exactly those three go weekly.
- "make the chart below this one weekly": only the bottom-left changes (or the Agent asks); the clicked chart is never offered.
- "leave this one alone, make the others weekly": no "You said not" (there is no negation word in it).

## AUDIT's over-ask cases (probe and case number only; the replies are kept privately for AUDIT)

Replies on 9e9234cc5f: C:/Users/blake/uct-backups/988-whole-tree/overasks/*.json, with SHA256SUMS beside them (the 41546eab65
replies are in the 41546eab65/ subfolder). In all four, nothing is applied before an answer.

| case | family (not the held-out text) | master 1c4c20bb12 | this head 9e9234cc5f | condition (b) |
|---|---|---|---|---|
| probe 11, case 10 | every chart except a relation to the click; correct plan | applied the plan | one question, one choice = the right set of 3, the click in it, the relation's target not | PASS |
| probe 18, case 8 | everything in the click's row except a named chart; plan includes the excluded chart | changed nothing, no question | one question, one choice = the 2 right charts, the excluded one not | PASS |
| probe 19, case 4 | a plural count of the charts around the click (no "except"); plan includes the click | changed nothing, no question | "Which chart do you mean?" offering the 2 right charts, not the click | PASS |
| probe 19, case 5 | every chart except a side line; correct plan | applied the plan | one question, one choice = the right set of 4, the click in it | PASS |

**Named fail-closed limitations.** Each of these asks where master applied (or left the board alone) without asking:
- Probe 11 case 10 and probe 19 case 5 ask before applying a correct plan. Planned fix: apply directly when the plan equals the
  resolved set (option 1). That is the follow-up sentence-family PR, which opens right after #988 merges.
- Probe 18 case 8 and probe 19 case 4 ask where master quietly changed nothing.
- Probe 19 case 4 (a plural count around the click, with no "except") is not in the option-2 family. Its question still offers one chart per
  button, so picking one changes only that chart. Set choices for plural relations without "except" go in the same follow-up PR.

## Questions asked, per probe set (282 tests; an ask = a question text appeared)

Head 9e9234cc5f asks 122 times, 91cf48dc79 asked 123, master 1c4c20bb12 asks 109. Most of master's non-asks are failed tests (wrong
chart, or nothing applied): master fails 50 of the 282, and the head fails only the 4 guide tests that fail the same way on master.
"Head only" counts asks where master did not ask. "Master passed" is how many of those master answered correctly without asking.

| set | tests | asks head | asks master | head only | of which master passed |
|---|---|---|---|---|---|
| probe 1 | 14 | 8 | 8 | 0 | 0 |
| probe 2 | 24 | 9 | 9 | 0 | 0 |
| probe 3 | 16 | 10 | 11 | 0 | 0 |
| probe 4 | 24 | 11 | 11 | 0 | 0 |
| probe 5 | 4 | 0 | 0 | 0 | 0 |
| probe 6 | 8 | 4 | 5 | 0 | 0 |
| probe 7 | 8 | 6 | 6 | 0 | 0 |
| probe 8 | 16 | 10 | 10 | 0 | 0 |
| probe 9 | 3 | 2 | 2 | 0 | 0 |
| probe 10 | 8 | 4 | 2 | 4 | 0 |
| probe 11 | 12 | 8 | 1 | 7 | 1 |
| probe 12 | 5 | 3 | 2 | 2 | 0 |
| probe 13 | 9 | 6 | 4 | 4 | 0 |
| probe 14 | 10 | 3 | 1 | 3 | 0 |
| probe 15 | 15 | 8 | 7 | 4 | 0 |
| probe 16 | 13 | 6 | 4 | 6 | 0 |
| probe 17 | 13 | 2 | 4 | 0 | 0 |
| probe 18 | 12 | 4 | 6 | 1 | 1 |
| probe 19 | 11 | 6 | 5 | 4 | 2 |
| probe 20 | 16 | 8 | 6 | 3 | 0 |
| probe 21 | 11 | 4 | 5 | 0 | 0 |
| guides (4 files) | 30 | 0 | 0 | 0 | 0 |

## Merge with master b786232486 (#1029) — how approval behaves now

#1029 and #988 both added an option named `words` to `useAgent.execute`, with different meanings:

- #1029: `words` is the turn's own message (a string). `resolveArgs` reads it, so the which-widget check can tell which widget the
  member named. It also passes `{ approved: true }` on an approval, so an approved proposal is not asked "which widget?" again.
- #988: the approval call passed the words the proposal was made from (a list), and the excluded-chart check read them.

Git merged the signature line cleanly, because both sides added the same `words = null` text, but the two meanings collided. The
resolution renames #988's option to `proposedWords`. #1029's `words` is left exactly as it is on master:

```diff
-  const execute = useCallback(async (opsIn, { ..., more = false, words = null }) => {
+  const execute = useCallback(async (opsIn, { ..., more = false, words = null, proposedWords = null }) => {
     // ⛔ #988 (AUDIT GO): the words the excluded-chart gate reads — an approved card carries the words it was PROPOSED
-    // from (its proposal stored them): "do it" / "yes" / the Apply click name no chart, so they could never re-check it
-    const gateWords = Array.isArray(words) ? words : [member, saidRef.current]
+    // from (its proposal stored them): "do it" / "yes" / the Apply click name no chart, so they could never re-check it.
+    // (merge with #1029) `proposedWords` is its own option: #1029's `words` is the turn's message string for resolveArgs
+    // (the which-widget guard); the two never share one name, so neither reads the other's shape.
+    const gateWords = Array.isArray(proposedWords) ? proposedWords : [member, saidRef.current]
 ...
-      await execute(ops, { path: 'approved', ..., subset: !!count && count < p.ops.length, words: p.words || null })
+      await execute(ops, { path: 'approved', ..., subset: !!count && count < p.ops.length, proposedWords: p.words || null })
```

What happens when the member approves a card, in plain words:

1. The excluded-chart check runs first. It reads the words the card was proposed from, not "yes" or the Apply click. If any change
   on the card would land on a chart those words exclude, the whole approval is refused ("…it includes a chart your request
   excludes"), and nothing runs.
2. Only then does each change resolve its widget. On an approval, #1029's rule applies: the member is not asked "which widget?"
   again, because the request that made the card already passed that check.

So #1029's "not asked again" can't skip the excluded-chart refusal. The refusal comes earlier in `execute`, and it reads its own
words. Without the rename, the approval would have passed the list of proposed words into `resolveArgs`, where #1029 expects the
message string.

## AUDIT item 3: the instant path never claims "every chart except <a relation to the click>"

New rail `agentFastPathEveryExcept`. It uses 12 phrasings of our own, each with a different change verb, a different exclusion
word and a different relation to the click. The model is given nothing to answer. The rail checks that nothing on the board
changes, that no card appears, and that the model is reached or a question is asked. It also checks that `fastParse` never
returns ops for these phrasings. Controls: the instant path does claim the same changes for one chart, and for "every chart" with
no exception (target all). So the exception clause is what sends these sentences to the model.
**Result: the instant path can't claim one on this head. There is no wrong-chart risk to report.** Mutant (fastPath.js drops the
exclusion clause after "every chart"): 22 of 28 tests fail.

## Known limits

- The four cases above.
- The option-2 question is on the model path (the gates after a model plan). The instant path never claims a sentence of this family
  (rail agentFastPathEveryExcept), so it always reaches those gates.
- The set question needs one uniform change across the plan (the same change on each chart). A mixed plan is asked about as before.
- An exclusion the board can't place (a relation with no chart there, a ticker on several charts outside the scope) is not read
  as this family. The checks ask as before.

## Verification on this head

- Rails: agentEveryExceptSet 20/20 (red first at 6088c0cc89: 8 failed | 12 passed on 41546eab65); agentStativePriceClause +
  agentNegatedClickAct 439/439; the deixis digest rail (agentNoLookbehindEquivalence) 6/6 after the master merge (no re-record).
- Mutants: M1-M6 (stative guards, see evidence/988/stative/README.md) each turn their rail red. M7 (quantifier test always true)
  turns 3 anchor-only controls red.
- AUDIT probes 1-21 + guides: 4 failed | 278 passed (282). The 4 are in two guide files (a how-to question), and they fail the
  same way on master. No wrong-chart result, and no "You said not" without a negation word.
- Scoped suite on 9e9234cc5f (src/agent minus the zzAudit files, plus 7 agent-importing tests; under the suite lock, BelowNormal,
  node_modules Junction): Test Files 343 passed | 5 skipped (348), Tests 13451 passed | 6 skipped | 24 todo, EXIT 0, 837.22s.
- Raw logs: C:/Users/blake/uct-backups/988-whole-tree/every-except-9e9234cc5f/ (SHA256SUMS beside them).

## Verification after the master merge (merge 034113c9b5, rail 666900bd65)

- #1029's rails are byte-identical to master: `git diff origin/master -- agentWhichWidget, agentFlowChipsParity,
  agentFlowFiltersHeldOut, flowFilters.outcome, agentExecReach, agentWidgetControls, tests/test_uct_agent_f16_calls_control.py,
  tests/test_uct_agent_f16_flow_chips.py` is empty.
- On 034113c9b5, 13 rail files pass 295/295. They are those six vitest rails, agentWidgetOptions, agentExcludedApproved,
  agentExcludedGate, agentEveryExceptSet, agentExceptCard, agentNoLookbehind988, and the deixis digest rail
  (agentNoLookbehindEquivalence). The digest did not change, so nothing was re-recorded. Logs are in
  evidence/988/merge-b786/rails_merge.log. The f16 pytest files were not run here: they are byte-identical, and #988 changes no
  backend file.
- Mutant "approved refusal switched off" (useAgent.js): 24 of 27 agentExcludedApproved tests fail
  (evidence/988/merge-b786/mut_approvedRefusalOff.log).
- New rail agentFastPathEveryExcept: 28/28 on 666900bd65. Mutant "fastPath drops the exclusion clause": 22 of 28 fail.
- AUDIT probes 1-21 + guides on 034113c9b5: 4 failed | 278 passed (282). These are the same 4 guide tests as before, and they fail
  on master too. The raw log is kept privately at C:/Users/blake/uct-backups/988-whole-tree/merge-b786232486/probes_merge.log
  (SHA256SUMS beside it).
- Scoped suite on 666900bd65 (src/agent minus the zzAudit files, plus 7 agent-importing tests; under the suite lock,
  BelowNormal, node_modules Junction): Test Files 348 passed | 5 skipped (353), Tests 13557 passed | 6 skipped | 24 todo,
  EXIT 0, 842.81s. Raw log: C:/Users/blake/uct-backups/988-whole-tree/merge-b786232486/scoped_merge.log (sha256 f086edee52…).
