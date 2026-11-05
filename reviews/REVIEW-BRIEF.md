# Independent merge-gating review (desktop, owner-authorised 2026-11-04)

You are an INDEPENDENT reviewer. You did not build these lanes. Your verdict gates a merge into master (= production).

Start EVERY Bash call with:
export H=C:/Users/Patrick/uct-worktrees/pine-handoff-dsk; source $H/docs/pine/parity-programme/scripts/env-desktop.sh

Read first: $H/docs/pine/parity-programme/LAPTOP-PROMPT.md STEP 4 (the non-negotiable rules), AGENT-RULES.md, BUILDER-RULES.md (definition of done). Then for each lane: its EVIDENCE.md on the branch, the spec section it names, and the lane's OWN diff.

Read-only: use `git -C $UCT_WORKTREES/pine-base fetch origin` then `git -C $UCT_WORKTREES/pine-base log/diff/show` against origin refs. Do NOT create worktrees, run heavy jobs, edit, commit or push any branch. You may run a single focused test file only if a claim cannot be judged otherwise, via `git worktree add --detach` into C:/Users/Patrick/uct-worktrees/rv-<lane> and remove it afterwards (unlink any junction first, never recursive); never pytest/--collect-only the whole tests/ tree.

The lane's own diff: `git log --oneline <parent>..<tip>` and `git diff <parent> <tip>`, where <parent> is the stacked parent tip given below, or `git merge-base <tip> origin/master` when the lane is on master. For a stacked lane, review ONLY its own commits.

Judge, with file:line evidence:
1. Correctness against the spec and Pine semantics; refuse-by-name for anything unproven; never draw where TradingView hides; never stop drawing a value that matched.
2. Guards: each mutation-proved per EVIDENCE (spot-check that the named rails really assert the behaviour; a rail that cannot fail is a finding).
3. One authority per value; no second copy of a constant/rule; no shadowed definition.
4. Member safety: nothing reaches members while flags/stages are off; no flag set; no secret in code; object door keeps master's answer unless proven.
5. The evidence's claims match the diff (files listed = files changed; final-tip on the final code tree; measure-pair on the same engine code).
6. Merge hazards: conflicts with the parent/master, merge-order requirements, engine bump yes/no.

Verdict per lane: GO, GO-WITH-NOTES (non-blocking notes), or NO-GO (each blocking finding: severity, file:line, why, the fix). Do not nitpick style.

Write one file per lane: C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/reviews/<LANE>.md (e.g. W4-T2.md) starting with the line `VERDICT: GO|GO-WITH-NOTES|NO-GO @<tip>`, then findings. Use a temp file then rename.

Final report in 150 words or fewer per lane: lane, tip, verdict, blocking findings (one line each), merge-order notes.
