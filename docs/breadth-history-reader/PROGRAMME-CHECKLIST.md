# Breadth History Reader — PROGRAMME CHECKLIST

**This file is the source of truth for the programme's state.** Standing directive SD-1
(issued 2026-09-15) says a fresh session must be able to resume from this file alone, and
that it is updated **in the same commit as the work it records**. A checklist that lags is
a false instrument.

The programme ends when this file reads **DONE** — that is, when D4 (`FINAL.md`) is merged.

Created 2026-09-15 (Session 13, first run under SD-1).
Last updated: **2026-09-15 15:09 ET, Session 13.**

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
| **R** Reader | R1–R3 `READY` — waiting for the 16:05 ET window. R4–R8 blocked behind them. |
| **G** Deploy gate | **G1 `DONE`** — Wait-for-CI is OFF, read from the API (D-053). G2/G3 `OWNER-PENDING`: no usable browser, measured. G3 is now **one change**. |
| **S** Repo safety | **S1 + S3 `BUILT`** on `repo/git-scope` (10 derived `-text` paths, 16 rails). S2 `BLOCKED` — the trial is vacuous until the tool is on master. |
| **D** Record | D1–D3 rolling (+D-053, +#40–#42). **D4 `DRAFT`** — 5 of 8 sections filled; merging it ends the programme. |

**The single blocking fact right now:** it is inside push-guard hours (09:25–16:05 ET), so
nothing may push. The landing script is alive and holds R1/R3.

⚰️ **And the thing to carry out of Session 13:** a red gate has already shipped to
production once, because Railway's Wait-for-CI is off and the gate only serialises. The
cutover is what makes the gate actually gate, and it is now a single dashboard change.

---

## R — READER

### R1 · M12 (sampler) landed, SUCCESS
**`READY`** — held by the landing script (PID 15940, started 13:26:31 ET 2026-09-15),
which pushes `breadth/sampler` → master at 16:05 ET after M14.
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

### G2 · C.2.i probe run and result recorded
**`OWNER-PENDING`** — SD-1 §2 conditions it on a browser path this box does not have.
**Measured, not assumed:** the Chrome profile is not authenticated to Railway (project URL
returns "Login / 404") and the window reports a **0×0 viewport**. Authenticating is not
something an agent does.
- ⭐ **Two of the probe's three unknowns are already answered without it** (D-053 §6):
  environment-level shared variables are **0** — control: `serviceId=web` returns **248**,
  so the query can see variables and the zero is real — therefore **the stop condition
  cannot fire**; and `origin/production` already exists and is being advanced.
- ⚠️ **OPEN QUESTION for the owner:** given those readings, can G2 be reduced or skipped?
  Not an agent's call — recorded, not acted on.

### G3 · Cutover executed (watched branch → `production`, Wait-for-CI OFF)
**`OWNER-PENDING`** (was `BLOCKED`) — it is now **one change, not two**.

| runbook step | state |
|---|---|
| Wait-for-CI → OFF | **already true** (G1) |
| `production` exists | **already true** — `origin/production` == `origin/master` |
| promotion advancing it | **already true** — 41 runs, 40 success |
| watched branch → `production` | ⛔ **the one remaining change** |

- The observation window the runbook asked for is **already running**: `production`
  advances only on a green gate and no service watches it.
- **Stop condition still true:** the newest web deploy carries `meta.branch = master`.

### G4 · Verification push proves the deploy came from `production`
**`BLOCKED`** on G3. Auto-rollback per §4.4 — and **no retry under SD-1**.

### G5 · Negative case — a red gate on a docs-only push does NOT deploy
**`BLOCKED`** on G4.

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
**`BUILT`** on `repo/git-scope` @ `7073a66b0`. **10 paths, derived not typed**, plus
`tests/test_gitattributes_eol.py` (8 rails, mutation-proved).
- The derivation: index blob carries a CR (`git grep --cached`, because the working tree
  has CRLF on everything and would report the whole repo), no NUL, `text` unspecified.
- ⚰️ **AND IT CORRECTS THIS PROGRAMME'S OWN RECORD.** D-052 §6 says the incident
  "silently replaced another programme's deliberate raw `\x01` bytes". Measured: **no
  joystick document carries a control byte at HEAD or in its last 15 commits.** The only
  file that ever did is `app/src/hub/useHubCursor.js` at `2d8373449`, and joystick removed
  the byte themselves.
- ⭐ **The two hazards are not one hazard.** eol conversion rewrites CR and LF and nothing
  else, so it cannot touch `0x01` or `0x1B`. What the incident flattened was **line
  endings** — the R-2 class. So `-text` is the right protection and the CR-stored blobs are
  the right list; the two files that do carry bare control bytes are deliberately **not**
  listed, with a rail asserting that distinction rather than a comment claiming it.
- `-text`, never `binary`: `binary` also suppresses diffs and one of the ten is a document
  people review.

### S2 · Scope checker in the shared pre-commit, WARN for 24 h then ENFORCE
**`BLOCKED`** on S1/S3 reaching master. Built and proven on `repo/git-scope` @ `d9bbb7768`;
**nothing is installed and the shared hook is untouched.**
- ⛔ **SD-1 says "a call at the END of the existing pre-commit". Measured: appended, it
  never runs.** The credential-scan loop `exit 0`s from *inside* the loop as soon as it
  finds `secret_scrub.py` — the normal path here — so everything after line 13 is
  unreachable. Same commit, same staged out-of-scope path: **appended → warn log empty;
  prepended → violation recorded.**
- ⭐ **That is the worst failure available**: the trial would "run" for 24 h, the log would
  stay empty, and an empty log reads as *zero false positives* — the promotion criterion.
  It would have promoted itself to ENFORCE on the strength of never having executed. The
  criterion is restated: not "the log is empty" but "the log has entries and none are false
  positives".
- ⛔ **The trial cannot observe anyone else until the tool is on master.** The block is
  absent-safe and `tools/git_scope.py` exists only on `repo/git-scope`, so every other
  worktree skips it. A trial started now watches this programme and nobody else while
  looking repo-wide. **Order: land the tool → start the 24 h window → promote.**
- The block is PREPENDED, which still touches none of the credential scan's lines.

### S3 · The unborn-branch defect fixed
**`BUILT`** on `repo/git-scope` @ `d9bbb7768` (branch tip; pushed at `568e2377d`, unpushed since).
- Re-verified this session: `tests/test_git_scope.py` **8 passed** on the branch after merging current master.
- `current_branch()` uses `symbolic-ref --short HEAD` first; `staged_paths()` diffs against
  the **empty tree** `4b825dc642cb6eb9a060e54bf8d69288fbee4904` when HEAD does not verify.
- ⛔ Not `DONE` until merged. A pre-commit hook runs *precisely* when there is no commit
  yet, so this is the hook's first call, not an edge case.
- ⚠️ Re-verify by running `tests/test_git_scope.py` on that branch before merging.

---

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
| Push-guard hours | **09:25–16:05 ET**; the pre-push guard is the authority |
| Settle | **≥ 600 s** after any workstream's deploy |
| Hot path | the **8 files a deep read executes** — `docs/breadth/reader-hotpath.txt` |
| Pool flags | `rf_pagecache` (`POOL_FLAGS`); `rf_resident` joins it once M13 is live |
| p95 needs | **n ≥ 59** (Session 10) |
| Memory bound | **2× wire bytes**; strings, not parsed dicts |
| Never | `git add -A`, `--no-verify`, two landing scripts, two samplers |
