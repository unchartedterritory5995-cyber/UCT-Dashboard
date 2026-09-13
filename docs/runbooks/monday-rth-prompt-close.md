# Monday RTH — CLOSE run (items 16–23)

> **This file is piped to `claude -p` by `scripts/rth-close.ps1`. Nobody is watching.**
> There is no human to ask. If a decision is not covered here, take the conservative
> option, record it, and continue. Do not message anyone. Do not wait for input.

**Working directory:** `C:\Users\Patrick\uct-worktrees\flow-watch-rail`.

---

## ⛔ YOU MEASURE NOTHING IN THIS RUN

The tape is closed. Everything you need was written by the OPEN run.

**Read, in this order:**

1. `docs/runbooks/monday-rth-results/` — the committed results (authoritative).
2. `scratchpad/monday-rth/` — the same files pre-commit; use only to fill a gap where the
   committed copy is missing, and say so when you do.
3. `scratchpad/monday-rth/index.json` — the manifest of which items exist and their status.

⛔ **Do not run the rig. Do not open a browser. Do not re-measure anything.** A number
measured after the close is a number from a different tape, and presenting it beside the
session's numbers would corrupt the whole record.

⛔ **If `INCIDENT.md` exists in either directory, that is the story.** Stop the normal
write-up. Produce `FINAL-REPORT.md` whose first section is the incident, verbatim, plus
whatever items completed before it. Do not diagnose the incident and do not fix it.

⛔ **A missing item file is a fact, not a gap to fill.** If `item10.json` is absent or its
`status` is `unmeasured`, the write-up says *unmeasured, and why*. **Never infer a number
from a neighbouring item, a prior session, or the weekend's quiet-tape figures.** The
whole point of this session was to replace projections with measurements; a projection
smuggled into the write-up is worse than a blank.

## Timing

- The OPEN run's commit is local and unpushed. **You push it, after 16:15 ET.**
- Check the clock first. If it is before 16:15 ET, wait until it passes, then proceed.
  Do not push early — a web rebuild before the close can still catch a straggling run.

---

## THE WORK

**16.** Fill `docs/runbooks/flow-worker-weekend-bundle.md` with every measured row; blanks
stay blank with reason. Commit and push (docs-only). Update `docs/feature_flags.json` if
any observation changes a flag's precondition.

**17.** Verdict, in one paragraph, no hedging beyond what the data requires: is Options
Flow fast for a member — path B median and worst, path A page-only number, versus what
members had before Friday (5.5 MB whole-D). **This is the sentence the owner will say to
members, so make it defensible.** If path B was not measured, the honest verdict is that
the headline number does not exist yet — say that instead of reaching for path A.

**18.** 6b proposal: the handoff fix, or "no fix justified yet" with what data would
justify one. Expected effect on p50/p95 handoff, files touched, deploy tier (web any-time
vs flow-worker after-hours/weekend), rollback. Diff in `scratchpad/`. **Not landed.**

**19.** TOP 10 / storm proposal: root cause, fix, files touched. If it's in
`OptionsFlow.jsx`, prepare the diff and a two-paragraph note for Manrav so the owner can
send it for his ack. **Not landed.**

**20.** Decisions (a) and (b): recommend drop both / reopen (a) / reopen (b) / reopen
both, with the cold-paint number that drives it. (b) reopening requires the reconcile path
in `OptionsFlow.jsx` and Manrav's ack; say so if that's the recommendation.

**21.** Head-name Search / MU: staleness problem, derive-cost problem, or
timeout-behaviour problem — and the next step. **Proposal only.**

**22.** GEX crosshair lag — the last open thread from the original list, unresolved since
May, five speculative fixes, never traced. **Do not start it.** Produce the spike plan in
≤ 10 lines: which page and interaction, what to instrument (input event → state update →
render → paint, with timestamps), whether it needs RTH, which files it touches, and what a
definitive trace would look like.

**23.** Ranked next-actions list: every fix and decision from 18–22 ordered by member-felt
impact, each with its deploy tier and whether it needs Manrav's ack or the owner's
decision. **That list becomes the next prompt.**

---

## OUTPUT — WRITE IT TO THE REPO, NOT JUST TO STDOUT

⭐ **The session's stdout may be gone by the time anyone looks.** The report must survive
in the repo.

Write **`docs/runbooks/monday-rth-results/FINAL-REPORT.md`** containing the full final
report, in this order:

> pre-open state; first live `rolls_steady[]` read with 10 rolls; pre-warming under load
> (held or broke, evidence); members-on-parts ratio; Measured p50 row with distribution
> and delta; path A and path B cold first paint (median, worst, intro share) and warm
> re-entry; handoff attribution distribution and three worst rolls with classification;
> the TOP 10 / storm diagnosis; head-name Search observations; anomalies; the docs commit
> SHA; the one-paragraph verdict; items 18–23 as proposals awaiting the owner's go.

**Anything not measured stays labelled unmeasured with the reason.**

At the top of `FINAL-REPORT.md` put a provenance block: which item files it was built
from, their `status` values, and the OPEN run's commit SHA. A reader must be able to tell
at a glance what is measured and what is missing.

## PUSH

After 16:15 ET, push the docs commits (the OPEN run's local commit plus yours) to master:

```sh
git push origin HEAD:master
```

Docs-only, so expect **web to rebuild and worker / bars-api / flow-worker to report
SKIPPED**. Confirm that and record it in `FINAL-REPORT.md`.

If the push is rejected because master moved, rebase onto `origin/master` and push again
— but first confirm the overlap is empty:

```sh
BASE=$(git merge-base origin/master HEAD)
comm -12 <(git diff --name-only $BASE..origin/master | sort -u) <(git diff --name-only $BASE..HEAD | sort -u)
```

Empty overlap ⇒ rebase and push. **Non-empty overlap ⇒ stop, and record it** — do not
resolve someone else's conflict unattended.

⛔ Never force-push.

Print the pushed SHA as the last line of your output. **Exit 0** when `FINAL-REPORT.md`
exists and the push has either succeeded or been recorded as deliberately not attempted.
