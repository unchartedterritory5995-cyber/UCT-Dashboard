# #988: the anchor of a relation is never the target (agent/pl/fix-relative-refs)

LOCAL / SIMULATED evidence (jsdom, scripted model plans, through the real panel). Production is checked only after merge.

## Newly fixed on this head (since the AUDIT hold at 91cf48dc79)

1. **A price clause is no longer read as "leave the clicked chart alone"** (AUDIT probe 2, the release blocker).
   "make it weekly, it is right above support" with a chart clicked used to reply "You said not the chart you clicked…" and change
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

- "make it weekly, it is right above support": the clicked chart goes weekly, nothing is asked.
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
| probe 19, case 4 | "the other two" around the click; plan includes the click | changed nothing, no question | "Which chart do you mean?" offering the 2 right charts, not the click | PASS |
| probe 19, case 5 | every chart except a side line; correct plan | applied the plan | one question, one choice = the right set of 4, the click in it | PASS |

**Named fail-closed limitations.** Each of these asks where master applied (or left the board alone) without asking:
- Probe 11 case 10 and probe 19 case 5 ask before applying a correct plan. Planned fix: apply directly when the plan equals the
  resolved set (option 1). That is the follow-up sentence-family PR, which opens right after #988 merges.
- Probe 18 case 8 and probe 19 case 4 ask where master quietly changed nothing.
- Probe 19 case 4 ("the other two …", with no "except") is not in the option-2 family. Its question still offers one chart per
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

## Known limits

- The four cases above.
- The option-2 question is on the model path (the gates after a model plan). A sentence the instant path answers on its own is
  not changed by it.
- The set question needs one uniform change across the plan (the same change on each chart). A mixed plan is asked about as before.
- An exclusion the board can't place (a relation with no chart there, a ticker on several charts outside the scope) is not read
  as this family. The checks ask as before.

## Verification on this head

- Rails: agentEveryExceptSet 20/20 (red first at 6088c0cc89: 8 failed | 12 passed on 41546eab65); agentStativePriceClause +
  agentNegatedClickAct 439/439; the deixis digest rail (agentNoLookbehindEquivalence) 6/6 after the master merge (no re-record).
- Mutants: M1-M6 (stative guards, see evidence/988/stative/README.md) each turn their rail red. M7 (quantifier test always true)
  turns 3 anchor-only controls red.
- AUDIT probes 1-21 + guides: 4 failed | 278 passed (282). The 4 are the guide tests "how do I add another one…", which fail the
  same way on master. No wrong-chart result, and no "You said not" without a negation word.
- Scoped suite on 9e9234cc5f (src/agent minus the zzAudit files, plus 7 agent-importing tests; under the suite lock, BelowNormal,
  node_modules Junction): Test Files 343 passed | 5 skipped (348), Tests 13451 passed | 6 skipped | 24 todo, EXIT 0, 837.22s.
- Raw logs: C:/Users/blake/uct-backups/988-whole-tree/every-except-9e9234cc5f/ (SHA256SUMS beside them).
