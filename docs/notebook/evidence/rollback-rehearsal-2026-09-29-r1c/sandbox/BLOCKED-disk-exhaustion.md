# Sandbox boot rehearsal — BLOCKED by disk exhaustion (environment, not this branch)

**Refusal, reported per instruction: "any refusal, report it; never work around it."**

## What was attempted

`rehearse.py extract s00-tip` succeeded and verified **IDENTICAL** (17,102 files, tree
`ee8c22f5c1` = the tip `0812b5ec3`). `rehearse.py extract s-L5` also succeeded and verified
**IDENTICAL** (17,101 files, tree `edccdb85a0` = `--through L5`'s tree). Both extract-verify
lines are recorded below (the same evidence `objects.py`-style extraction integrity this
programme's earlier lanes used).

`rehearse.py extract s-L4` **failed**:

```
OSError: [Errno 28] No space left on device
```

## What was measured, not assumed

`Get-Volume C | Select-Object SizeRemaining, Size` (PowerShell), read **before** touching
anything of mine:

```
SizeRemaining         Size
-------------         ----
            0 499279458304
```

**Zero bytes free on the whole C: drive**, machine-wide, at the moment `s-L4`'s extraction hit
it — not a quota inside this lane's own scratch directory. This lane's own scratch usage at
that point was measured at 1.48 GB (`Get-ChildItem -Recurse | Measure-Object -Property Length
-Sum`), which is not what emptied a 465 GB drive.

## What was done about it

Per CLAUDE.md's worktree-ownership rule, a session deletes only what it created in that same
session. The two directories removed here are exactly that — this lane's own scratch
extractions, already verified IDENTICAL and logged (see `extract-verify.log`), so no evidence
was lost by removing them:

- removed the partial, corrupt `s-L4` extraction (this run's own failed write);
- removed `s00-tip` and `s-L5` (already verified; the verify log is the durable record).

That recovered the drive to **~4.2 GB free** — still razor-thin for a machine other sessions
are actively using, and not something a build-plus-Playwright-Chromium boot across three
targets should spend down further on a box that was AT ZERO moments earlier. Nothing belonging
to another worktree or another session was touched.

## What this means for the deliverable

- The **objects-only chain build** (the actual measurement this lane owns) is complete and
  independently verified: `--through L5`, `--through L4`, `--through L2` and `--through wave5`
  all ran clean from the new tip, all ten pins recorded at f4cec49be came back byte-identical,
  and the one new pin (`caf6d1b9e` / `Support.jsx`) is recorded and re-derivable
  (`--record-pins --through wave5`). None of that needed a boot.
- The **live sandbox rehearsal** (booting the tip, L5 and L4, probing the L4 door and the L5
  behaviour-preservation check) is **NOT completed** and is **not claimed** as completed
  anywhere in this lane's report. `rehearse.py`, `probe.py` and this evidence directory are
  ready to run the moment disk headroom is real again — `python rehearse.py extract s00-tip`
  (etc.) through `boot <label>`, unchanged.
- This is reported as a refusal, not worked around: no attempt was made to free space by
  deleting anything outside this lane's own, already-logged scratch output.

## Extract-verify log (both successful extractions, before the failure)

```
s00-tip: tree ee8c22f5c1 -- 17102 files expected, 17102 re-hashed, IDENTICAL
s-L5: tree edccdb85a0 -- 17101 files expected, 17101 re-hashed, IDENTICAL
```
