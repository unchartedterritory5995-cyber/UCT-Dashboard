# Breadth History Reader — PROGRAMME CHECKLIST

**This file is the source of truth for the programme's state.** Standing directive SD-1
(issued 2026-09-15) says a fresh session must be able to resume from this file alone, and
that it is updated **in the same commit as the work it records**. A checklist that lags is
a false instrument.

The programme ends when this file reads **DONE** — that is, when D4 (`FINAL.md`) is merged.

Created 2026-09-15 (Session 13, first run under SD-1).
Last updated: **2026-09-15 16:11 ET, Session 13 (SD-1.1).**

---

## STATE VOCABULARY

| State | Means |
|---|---|
| `DONE` | finished and merged to master; nothing further |
| `BUILT` | built and gated on a branch, **not on master** — names the branch |
| `READY` | preconditions met, waiting only for a slot (window / settle / n) |
| `BLOCKED` | a named precondition is not met — names it |
| `OWNER-PENDING` | needs the owner's keyboard; carries the click-path |
| `STOPPED` | hit a §5 hard stop; stays stopped until the owner changes this line |
| `NOT STARTED` | no work done |

⛔ **A state is changed only by evidence, never by expectation.** "It should have landed"
is not `DONE`.

---

## THE ONE-SCREEN ANSWER

| Track | Where it is |
|---|---|
| **R** Reader | R1–R3 `READY` — in the landing queue, no clock. R4–R8 blocked behind them. |
| **G** Deploy gate | **G1 + G5 `DONE`** (G5 on history). **G2 `RETIRED`** — the cutover is the probe. **G3 `READY`**: `deploymentTriggerUpdate` exists, so it is an **API call**, not a click. |
| **S** Repo safety | **S1 + S3 `READY`** — `repo/git-scope` is 4th in the landing queue (A2.1). **S2 placement resolved** (prepended + heartbeat); installs once that lands. |
| **D** Record | D1–D3 rolling (+D-053, +#40–#42). **D4 `DRAFT`** — 5 of 8 sections filled; merging it ends the programme. |

**The single blocking fact right now:** none of this programme's own making. ⛔ **There is
no market-hours window on this repo** — owner ruling SD-1.1 A0, *"we no longer have mid day
blocks ever"*. The landing script is alive, clockless, and holds R1–R3; its only gates are a
settled SUCCESS deploy, the lock, the pause sentinel, and the pre-push guard.

⚰️ **And the thing to carry out of Session 13:** a red gate has already shipped to
production once, because Railway's Wait-for-CI is off and the gate only serialises. The
cutover is what makes the gate actually gate, and it is now a single dashboard change.

---

## R — READER

### R1 · M12 (sampler) landed, SUCCESS
**`READY`** — held by the landing script, which pushes `breadth/sampler` → master after
M14. **No clock**: it proceeds as soon as the newest deploy is SUCCESS and settled ≥ 600 s.
- Branch `breadth/sampler`, local tip `41bd58eb7`, **ahead of `origin/breadth/sampler` by 23** (master merged in for re-gating, plus the encoding fix below).
- Re-gated 2026-09-15: master is ancestor; no file overlap with master's changes; hot-path diff **empty** (5 files, 0 under `api/`); **20 tests green** (17 + 3 added this session).
- ⚠️ **The branch moved after Session 12 gated it.** `41bd58eb7` fixes a defect that would have shipped: see *Session 13 findings* below. Re-gated after the change.
- Evidence to record on landing: deploy SHA, status, time.

> **RE-GATED AGAINST `79b4b2907` (SD-1 §6, master moved mid-session).** Master's delta is
> **3 files, 0 under `api/`, 0 hot**, and its overlap with every held branch is **NONE**.
> ⭐ This matters because the landing script merges `origin/master` immediately before
> pushing and does **not** re-run the parity gate — so the argument that M13's EXACT
> parity survives that merge has to be made from the delta, and it is: a change that
> touches no file the branch touches, and no file the reader executes, cannot move a
> byte of the response.

### R2 · S1 registered; sampler producing lines; summary regenerated each run
**`BLOCKED`** on R1 (the sampler's files are not on master until M12 lands).
- Task Scheduler: **no sampler job exists** — verified 2026-09-15 against the full task list. Proposed name `UCT Breadth Sampler`, matching the existing `UCT Breadth *` convention.
- ⭐ The report tool now writes `docs/breadth-history-reader/sampler-summary.md` on every run and **survives this box's cp1252 console** (fixed `41bd58eb7`). Before that fix a scheduled run would have exited 1 with no file — R2 could not have been satisfied.

**The registration, ready to run the moment M12 is on master** (shape copied from
`UCT Breadth Collector`, the convention on this box — `MultipleInstances IgnoreNew`,
Interactive/Limited, weekdays):

```powershell
$repo = 'C:\Users\Patrick\uct-worktrees\breadth-history-reader'
$act  = New-ScheduledTaskAction -Execute 'python' `
          -Argument "$repo\tools\breadth_sampler.py" -WorkingDirectory $repo
# 16:10 ET = 15:10 CT on this box. The clock HERE is LOCAL/CT; the sampler's OWN guard
# is ET via zoneinfo and is the authority. This trigger only avoids pointless wake-ups
# inside a window the sampler would refuse anyway.
$trg  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 15:10
$set  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName 'UCT Breadth Sampler' -Action $act -Trigger $trg -Settings $set
```

- ⛔ **`MultipleInstances IgnoreNew` is the "never two samplers" rule, in the scheduler
  rather than in a comment.** The sampler loops internally until its daily cap, so a
  second instance would double the production load that cap exists to bound.
- ⛔ **Do not register before M12 lands.** `tools/breadth_sampler.py` is not on master, so
  the task would start, fail to find the file, and record a green-looking run that
  sampled nothing.
- Verify after registering: `Get-ScheduledTask 'UCT Breadth Sampler'`, then one
  `python tools/breadth_sampler.py --once` — inside guard hours it must print a
  **refusal**, which is the check that the guard is live rather than merely present.

### R3 · M13 (resident copy, flag OFF) landed, SUCCESS
**`READY`** — landing script, after R1.
- Branch `breadth/resident-recon`, local tip `acddfabca`, ahead of its remote by 11.
- Re-gated 2026-09-15: parity **EXACT three ways** vs master `65899a8f7` — golden / flag OFF / flag ON all `sha256 7695923c…` over 5,576,278 bytes; 493 breadth + 187 ledger tests green.
- Lands with `BREADTH_RESIDENT_RECON_ENABLED` **unset** (OFF). The flip is R5, not this.

### R4 · Pool A — n ≥ 20 on M13's SHA, flag OFF (the *before*)
**`BLOCKED`** on R2/R3. Current pool: **n = 2** on SHA `4a0995a52`, `rf_pagecache = 1`.
- ⭐ That pool is still valid against today's master: the 8 hot files are **byte-identical** between `4a0995a52` and `65899a8f7`, and the discriminator fires (`fdf7c2201` vs `444f747d8` → `breadth_daily_ohlc.py`), so the identity is measured, not vacuous.
- ⛔ M13 lands a change to `breadth_daily_ohlc.py`, which **is** a hot file — so **M13 starts a new pool** and the existing n = 2 does not carry into Pool A.

### R5 · V3 flip ON; Pool B — n ≥ 20, same SHA, flag ON
**`BLOCKED`** on R4.

### R6 · Flip decision executed by SD-1 §3's criterion
**`BLOCKED`** on R5. The criterion is six terms, all of which must hold to keep ON; the
failing term is recorded either way.

### R7 · Winning pool n ≥ 59; p95 CI; the ~1 s bar; cap FINAL
**`BLOCKED`** on R6. `N_FOR_P95 = 59` is Session 10's derivation, pinned by a rail.
- Cap decision: 365 stands on the UI-maximum argument regardless — record the number and close.

### R8 · Reader work CLOSED
**`BLOCKED`** on R7. Names the remaining floor (`rf_materialise` + whatever the winning
configuration leaves) and writes the next candidate as a **proposal only**.

---

## G — DEPLOY GATE

### G1 · Wait-for-CI reading recorded
✅ **`DONE`** 2026-09-15 — **`checkSuites: False` on all six services.** Recorded in
**D-053**. Read from the Railway API with the CLI's own token, field name introspected
rather than guessed.
- ⭐ It never needed a browser. The toggle is the `checkSuites` Boolean on
  `Environment.deploymentTriggers`, and the service can be asked directly.
- ⚠️ It also settles a contradiction: `master-deploy-gate.yml`'s header claims Wait-for-CI
  holds the build, `promote-production.yml`'s says it does not gate. **The promotion
  workflow is right; the gate's header is stale.**
- ⚰️ And the negative case has **already happened**: of 59 gate runs exactly one failed
  (`beace00e0`), and Railway deployed that commit **in the same second**. A red gate does
  not stop a deploy today — measured, not inferred.

### G2 · C.2.i probe — ⚰️ RETIRED
**`RETIRED`** by SD-1.1 A1. **The cutover is the probe**: `production` is the throwaway,
§4's 20-minute auto-rollback bounds it, and G1 showed the API is reachable with the CLI
token — so the watched-branch change is a mutation, not a click.
- Session 13 had already measured away two of its three unknowns: environment shared
  variables are **0** (control: `serviceId=web` returns **248**), so its stop condition
  could not fire; and `origin/production` already exists and is being advanced.
- ⭐ The probe existed to de-risk a click nobody can undo. An API call with a scripted
  rollback is a different risk shape, and the owner re-scoped it rather than running a
  ceremony against the old one.

### G3 · Cutover — watched branch `master` → `production`
**`READY`** (was OWNER-PENDING). **A3.1 answered it: this is an API call, no browser.**

| | |
|---|---|
| Mutation | `deploymentTriggerUpdate(id, input)` — `input.branch` is a `String` |
| `web` trigger id | `61b50f1f-b011-42b1-82ba-77d080ad7108` |
| Now | `branch: master` · `checkSuites: False` |
| Rollback | the same mutation with `branch: "master"` |

- ⚠️ **Permission is untested by construction** — executing it *is* the test. The token
  already reads these objects and it is the owner's account.
- ⛔ **Preconditions (SD-1.1 A3.2):** last deploy SUCCESS and settled ≥ 600 s;
  `production` HEAD == master HEAD == deployed SHA; no deploy from any workstream in
  15 min; **landing script PAUSED between steps**. **No clock condition.**
- ⛔ **Must not interleave with the reader landings** — M12/M13 first.
- ⭐ A3.5's rollback rehearsal is now cheap: two API calls and two deploys.

### G4 · Verification push proves the deploy came from `production`
**`BLOCKED`** on G3. Auto-rollback per §4.4 — and **no retry under SD-1**.

### G5 · Negative case — a red gate must not deploy
✅ **`DONE` ON HISTORY** (SD-1.1 A1). Of **59** `master deploy gate` runs exactly one
failed — `beace00e0`, 2026-09-14T19:00:49Z — and Railway created a `web` deployment for
that commit **in the same second**.
- ⭐ Stronger than the planned test and free: an observation of the system as it ran,
  not a fixture. **E-neg authorisation withdrawn**; no marker-gated failing push.
- ⚠️ It evidences the PRE-cutover state. That a red gate stops a deploy AFTER G3 is what
  G4's verification push shows.

### G6 · Branch protection on `production`
**`OWNER-PENDING`** by default (GitHub admin). Packaged with exact settings; does not
block G7.

### G7 · `--audit` repointed; runbook updated to "as executed"; rollback rehearsed
**`BLOCKED`** on G4. A rehearsal that costs more than its evidence is worth may be
recorded `UNREHEARSED` with the reason, after verifying the dashboard state it changes.

### G8 · Shared CLAUDE.md carries the new topology in three lines
**`BLOCKED`** on G3 succeeding. Uses the scope override, logged.
- The three lines: deploys come from `production`; a master push is a gate run; a red gate is no deploy.

---

## S — REPO SAFETY

### S1 · `.gitattributes` for the blobs already stored with CR
**`READY`** — built on `repo/git-scope`, **4th in the landing queue** (authorised by
SD-1.1 A2.1). 10 paths derived from the index; 8 rails, mutation-proved.
- ⚰️ It corrects D-052 §6: no joystick document carries a control byte at HEAD or in its
  last fifteen commits. eol conversion rewrites CR and LF and nothing else, so it never
  could have touched ``. What the incident flattened was **line endings**.
- Landing gate (A2.1): 8 rails green, round-trip test per `-text` path, scope checker
  dogfooded on the merge commit, no `api/` file touched with the non-vacuity count driven.

### S2 · Scope checker in the shared pre-commit — WARN, then ENFORCE
**`READY TO INSTALL`** once `repo/git-scope` is on master. Placement and mode are settled
by SD-1.1 A2.2 and the code is built.
- ⛔ **PREPENDED, not appended.** Measured: appended after the credential scan's `exit 0`
  it never runs. Same commit, same staged out-of-scope path — appended → log empty;
  prepended → violation recorded. The credential scan's lines are not edited.
- ⛔ **Heartbeat on every invocation** (timestamp · branch · paths · verdict), including
  `in-scope` and `no-scope`. Without it a never-run trial and a clean trial produce the
  same artifact, and the empty one reads as the pass.
- **Promotion criterion (A2.2):** **≥ 20 heartbeats from ≥ 2 workstreams over ≥ 24 h with
  zero WOULD-REFUSE rows.** An empty or heartbeat-less log is a **failed instrument**,
  never a pass.
- The block to paste is in `docs/breadth/git-scope-hook-proposal.md`, verified end-to-end
  in a throwaway repo.

### S3 · The unborn-branch defect fixed
**`READY`** — same branch, same landing. `symbolic-ref` first, empty-tree diff for
`staged_paths()`. 11 rails green on the branch after merging current master.

### S4 · A2.5 — gate the promotion RANGE, not just the tip
**`NOT STARTED`** (accepted as a change by SD-1.1 A2.5; lands under M-docs **after** the
cutover).
- Per-commit secret scan over `production..candidate`, **ADVISORY first** (reports, does
  not gate) with a heartbeat, promoted to gating at **≥ 20 runs executed with zero
  findings on green tips**, or on the first true finding after review.
- Record which commits in `production`'s history were never scanned by a gating run —
  **by SHA**. It is a finding, not a fault.
- ⭐ Same shape as S2: advisory + heartbeat first, because an unrun check that reports
  nothing is indistinguishable from a clean one.

## D — RECORD

### D1 · Every session from 12 written up; every `docs/sessionN-record` merged
**`IN PROGRESS`**.

| Branch | Tip | Merged? |
|---|---|---|
| `docs/session11-record` | `57a0b70b3` | **no** — M14, first in the landing sequence |
| `docs/session12-record` | `26423b010` | **no** — M-docs when a slot is free |
| `docs/session13-record` | this branch | **no** |

### D2 · DECISIONS.md carries the required entries
**`IN PROGRESS`**. Present: D-049 … D-052 (D-052 = the four conventions + the operational
row). Outstanding: the flip decision (R6), the p95/cap final (R7), the cutover as executed
(G3/G4).

### D3 · Appendix current
**`IN PROGRESS`**. `00-profile.md` carries #1–#39. Session 13 adds #40 (below).

### D4 · FINAL programme report — `docs/breadth-history-reader/FINAL.md`
**`DRAFT`** — opened Session 13, sections **1, 2, 4, 6, 7** filled; **3, 5, 8** `PENDING`.
- ⛔ **Merging this file is the act that ends the programme.** Do not merge it while any
  section still reads `PENDING` — the file says so at the top, in its own voice.
- Drafted incrementally while waiting (SD-1 §6) so the closing session is an **edit**,
  not a composition.

---

## SESSION 13 FINDINGS (to fold into D3)

**#40 — the report tool's terminal echo could destroy the artifact it was echoing.**
`_run_and_capture` wrote to `sys.stdout` *before* writing the summary file. This box's
console is cp1252 and the report's text is full of `⛔` (U+26D4), so `sys.stdout.write`
raised `UnicodeEncodeError`, the exception escaped, and **the summary file was never
written** — exit 1, nothing on disk, on the exact box Task Scheduler was about to run it
on. C.1's guarantee ("one rendering written twice") failed closed, and it failed by
sacrificing the **durable** half to the **disposable** half.
⭐ The ordering was the whole defect: the artifact is written first now, and the echo
cannot raise. Three mutations, three different rails red.
⚠️ The same trap then bit an ad-hoc probe in the same session — it is a property of this
box, not of one tool. Scripts that print `⛔` need `PYTHONIOENCODING=utf-8` or a guarded
write.

---

## STANDING FACTS A RESUMING SESSION SHOULD NOT RE-DERIVE

| | |
|---|---|
| Push windows | ⛔ **NONE — retired by owner ruling SD-1.1 A0.** The gates are a settled SUCCESS deploy (≥ 600 s) and the pre-push guard, which remains the authority. ⚠️ That guard *itself* still carries a 09:25–16:05 refusal; it is another programme's file — see A0.4 in the Session 13 report. |
| Settle | **≥ 600 s** after any workstream's deploy |
| Hot path | the **8 files a deep read executes** — `docs/breadth/reader-hotpath.txt` |
| Pool flags | `rf_pagecache` (`POOL_FLAGS`); `rf_resident` joins it once M13 is live |
| p95 needs | **n ≥ 59** (Session 10) |
| Memory bound | **2× wire bytes**; strings, not parsed dicts |
| Never | `git add -A`, `--no-verify`, two landing scripts, two samplers |
