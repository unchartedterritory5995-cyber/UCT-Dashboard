# Breadth History Reader — PROGRAMME CHECKLIST

**This file is the source of truth for the programme's state.** Standing directive SD-1
(issued 2026-09-15) says a fresh session must be able to resume from this file alone, and
that it is updated **in the same commit as the work it records**. A checklist that lags is
a false instrument.

The programme ends when this file reads **DONE** — that is, when D4 (`FINAL.md`) is merged.

Created 2026-09-15 (Session 13, first run under SD-1).
Last updated: **2026-09-15 14:33 ET, Session 13.**

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
| **G** Deploy gate | G1–G2 `READY` this session (browser authorised by SD-1 §2 G-browser). G3+ behind G2. |
| **S** Repo safety | S3 `BUILT`. S1/S2 `NOT STARTED`, both now authorised. |
| **D** Record | D1–D3 rolling. D4 `NOT STARTED` — it is the last item in the programme. |

**The single blocking fact right now:** it is inside push-guard hours (09:25–16:05 ET), so
nothing may push. The landing script is alive and holds R1/R3; everything else this session
is build, record, and the browser-side G work that needs no push.

---

## R — READER

### R1 · M12 (sampler) landed, SUCCESS
**`READY`** — held by the landing script (PID 15940, started 13:26:31 ET 2026-09-15),
which pushes `breadth/sampler` → master at 16:05 ET after M14.
- Branch `breadth/sampler`, local tip `41bd58eb7`, **ahead of `origin/breadth/sampler` by 23** (master merged in for re-gating, plus the encoding fix below).
- Re-gated 2026-09-15: master is ancestor; no file overlap with master's changes; hot-path diff **empty** (5 files, 0 under `api/`); **20 tests green** (17 + 3 added this session).
- ⚠️ **The branch moved after Session 12 gated it.** `41bd58eb7` fixes a defect that would have shipped: see *Session 13 findings* below. Re-gated after the change.
- Evidence to record on landing: deploy SHA, status, time.

### R2 · S1 registered; sampler producing lines; summary regenerated each run
**`BLOCKED`** on R1 (the sampler's files are not on master until M12 lands).
- Task Scheduler: **no sampler job exists** — verified 2026-09-15 against the full task list. Proposed name `UCT Breadth Sampler`, matching the existing `UCT Breadth *` convention.
- ⭐ The report tool now writes `docs/breadth-history-reader/sampler-summary.md` on every run and **survives this box's cp1252 console** (fixed `41bd58eb7`). Before that fix a scheduled run would have exited 1 with no file — R2 could not have been satisfied.

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
**`READY`** — SD-1 §2 G-browser authorises this session to read it if a browser is
available and Railway is logged in. One minute. Carried unanswered since Session 10.

### G2 · C.2.i probe run and result recorded
**`READY`** after G1. Design is `docs/breadth/deploy-gate-cutover-runbook.md` §C.2.i.
- ⛔ **Stop condition: inherited variables that cannot be removed before the first build.**
  If that happens: delete the service, mark G2 `STOPPED`, G track `OWNER-PENDING`.

### G3 · Cutover executed (watched branch → `production`, Wait-for-CI OFF)
**`BLOCKED`** on G2 showing TRIGGERED, and on SD-1 §4.1's preconditions (outside
push-guard hours; last deploy SUCCESS + settled ≥ 600 s; `production` HEAD == master HEAD
== deployed SHA; no other workstream deploy in 15 min; landing script not mid-step).
- **Current stop condition still true:** the newest web deploy is `65899a8f7`, `meta.branch = master`. The cutover has not happened.

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

### S1 · `.gitattributes` for the raw-byte docs
**`NOT STARTED`**, authorised by SD-1. Additive, `-text` or `binary`, with a round-trip
test. Cause is measured: `core.autocrlf=true` and `git check-attr -a` returns nothing for
those paths, so git decides by sniffing and a mostly-ASCII file with control bytes sniffs
as text.
- ⛔ Scope: paths git shows unprotected **AND** that carry a raw-byte marker in history —
  derive the list, never type it.

### S2 · Scope checker in the shared pre-commit, WARN for 24 h then ENFORCE
**`NOT STARTED`**, authorised by SD-1 as an **additive call at the end of the existing
pre-commit**.
- ⛔ **Never edit the credential scan's lines** — another programme owns them.
- WARN mode logs and never refuses. Promote to ENFORCE only on **zero false positives in
  24 h of other workstreams' commits**; any false positive → fix the scope declarations and
  re-warn 24 h.
- Proposal already written: `docs/breadth/git-scope-hook-proposal.md` (on `repo/git-scope`).

### S3 · The unborn-branch defect fixed
**`BUILT`** on `repo/git-scope` @ `568e2377d` (pushed, unmerged).
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
**`NOT STARTED`**. It is the last item; the checklist reads DONE when it is merged.
Drafted incrementally while waiting (SD-1 §6).

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
