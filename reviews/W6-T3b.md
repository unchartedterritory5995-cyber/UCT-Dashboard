VERDICT: GO-WITH-NOTES @92918d04a3

Delta re-review of W6-T3b, after the NO-GO @a01eec7203 (B1, a rail gap).
- Tip: 92918d04a3. Code tip: c0d9bce75c.
- Commits since the last verdict:
  - dbc39fdc19: rails only (w6ExprType.test.js);
  - c0d9bce75c: a merge of origin/master ca4f330ac3;
  - 92918d04a3: docs only.

## Checks
- **Docs only after the final-tip.** `git diff c0d9bce75c 92918d04a3` touches only
  docs/pine/evidence/2026-11-05-w6-t3b/EVIDENCE.md (+24). The final-tip therefore covers the tip.
- **ready-check, re-run by me** on 92918d04a3:
  - command: `ready-check.sh pine-dsk-w6t3b runs/w6t3b-final3`, run read-only in the builder's clean worktree;
  - result: READY-CHECK PASS (HEAD == origin, clean, TIP c0d9bce75c is the last non-docs commit, docs only after
    it, scope=full shards=2, rc gate=0 hyg=0 py=0 js=1);
  - jsfail is the 7 allowlisted baselines: controlDoorCensus, enumerationSites, vendorHarness.coverageAudit,
    vendorHarness, settingsScope.rail, pollingSites.rail, usePreferences.additionsOnly;
  - FINAL_DONE: integrity=ok, totals=ok, errors=0.
- **B1 is fixed (rails only; dbc39fdc19 changes no source).** w6ExprType gains three cases:
  - ifElifLastBad(1) -> null;
  - naPass("b") -> text and naPass(na) -> null;
  - an operators case: text + text, num + num, a comparison, and mixed.
- **My own mutations,** re-run under heavy-lock `rev-w6t3b-r2-mut`, ram_gate passed. Each was copied, mutated, run
  and restored by copy, and cmp verified every restore. Base is 52/52 green.
  - X12 (else-if continuation -> break): KILLED (1 failed).
  - X10 (na argument bound as NA_TY): KILLED.
  - X3 (text + text dropped): KILLED.
  - X2 and X9: still SURVIVE, equivalent as recorded (round-1 N2/N3).
- **The master merge touches no engine source.**
  - `git diff afea7afaf5 c0d9bce75c` under engine/ast, vm.js and collections.js shows only two *.measure.test.js
    files.
  - The lane's diff vs the new merge-base (ca4f330ac3) is the same 3 files: FE +356/-4, the rail, and EVIDENCE.
  - pineRuntimeFrontend.js is byte-identical to the round-1 code, so the round-1 measure-pair stands.
- **No engine bump: confirmed.**
  - The served path is unchanged. exprType's only served consumers are the two method-form sites
    (methodNsOf(exprType(name))), and there it returns the same slotTy as before.
  - measure-pair (round 1, same FE): C18 395+69 rows, 0 diffs on both lanes; the harness is byte-identical; the census
    has only the known noise rows.
  - No script's output changes.
- **Merge.** `git merge-tree --write-tree origin/master 92918d04a3` is clean (badcb575df). The lane's merge-base is
  current master's ca4f330ac3.

## Notes (non-blocking)
- N2: the `(methodDecls.get(name) || 0) > 1` check is a redundant second guard. fnSourceByName=false already covers
  it, and the lane refuses an overloaded method at build. Delete it, or keep it as documented.
- N3: the switch-arm `at < 0` check is unreachable.
- N4: a cached inference is not invalidated by an overload defined later. This is handed to T9, as accepted. T9 must
  re-check it before reading exprType during lowering.

## Carried from round 1 (verified then, unchanged code)
- exprType reads T3a's slotTy as its one authority, through writtenTyOf and bindingTy, and restates nothing.
- The na-arm rule is right for Pine.
- Recursion terminates through fnInferring, keyed by name, with the depth backstop at 48.
- null is never turned into a default type.

Merge order: after T3a (engine 18, on master). Unblocks T6 and T9.

VERDICT: GO-WITH-NOTES @92918d04a3
