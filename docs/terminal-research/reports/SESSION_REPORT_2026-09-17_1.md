# SESSION REPORT — 2026-09-17, session 1

**The signable surface is frozen at 80 paths, both shells are proved from real shells rather
than asserted, and the sitting verifier reads master instead of the terminal tail. Two of
this prompt's premises were backwards and are corrected below.**

---

## 1 · ET, trees, gate-box lock, freeze confirmation

```
ET start   2026-09-17 07:32 EDT Thu   (tools/weekly_exec.py et)
ET end     2026-09-17 08:41 EDT Thu
docs   terminal-research   dd8df4b47 -> a83364c34   (1 commit)
code   feat/s7-price-level e703af0a8 == origin/feat/s7-price-level   ✅ UNCHANGED
gate-box lock   absent; no local vitest run and none needed
freeze          80 of 80 paths match their recorded SHA — exit 0
poll log        none; no code commit, so no CI run triggered
```

⚠️ `origin/master` moved twice during the session (`9906a7fcd` → `9081799f2`) from other
workstreams. **The replay re-clones and re-checks against the current tip each run**, and
said `CLEAN 46 of 46` at both.

## 2 · F — the freeze

`tools/freeze_check.py` records and re-checks **80 paths**, derived rather than typed:

```
6   tools whose content decides a fingerprint, the universe, the order or the replay
    sign_manifest.txt · sign_gate.py · sign_all.py · merge_all.py
    verify_manifest.py · pre_sitting.py
73  every .md under docs/terminal-research/12-decisions/gates/   (directory listed)
1   @code:feat/s7-price-level — the branch tip
```

Baseline: `tools/freeze_baseline.txt`, written once by `--record`.

⭐ **`freeze_check.py` is deliberately NOT in its own freeze set.** Freezing the instrument
against its own baseline is the self-reference this programme keeps paying for.

**Controls:**

```
the freeze set is non-empty                                      ok   <- non-vacuity
it includes the code branch tip                                  ok
a clean tree compares equal to itself                            ok
one frozen file moved -> DIFF, and it is NAMED                   ok
the CODE BRANCH moving is a DIFF too                             ok
a path absent from the baseline is a DIFF, never skipped         ok
main() exits 1 on a corrupted baseline (end to end)              ok
```

⛔ **Mid-freeze fixes are a NEW ROW after the current `--until`, never an edit** — editing a
packet moves its fingerprint and a row signed in Sitting 1 stops verifying in Sitting 2.

## 3 · R — both shell forms, both proved

### ⛔ Git Bash: `MSYS_NO_PATHCONV=1` is BACKWARDS

```
MERGE=/c/... , no env var          -> code repo: C:\Users\...\_merge-master   exit 0
MERGE=/c/... , MSYS_NO_PATHCONV=1  -> ⛔ --code-repo C:\c\Users\...\_merge-master
                                       is not a directory.  STOPPED.          exit 2
```

Suppressing the conversion means Python receives `/c/Users/…` and resolves it against the
drive as `C:\c\Users\…`. **The plain `/c/…` form is correct.** ⭐ K CP7's directory check
caught the mangled path **by name** rather than failing obscurely later — which is what that
check was built for.

### ⛔ cmd.exe: `set` must be on its own line — and my first harness had the bug, not the runbook

```
cmd /c "set MERGE=... && python tools\pre_sitting.py --code-repo %MERGE%"
  -> PRE-SITTING: NOT-READY
```

`%MERGE%` expands at **parse** time, before `set` runs, so the tool received an empty path.
Re-proved faithfully as a `.bat` with `set` on its own line:

| command | bash | cmd (.bat) |
|---|---|---|
| `freeze_check` | exit 0 · OK, 80 paths | exit 0 · OK |
| `pre_sitting --code-repo` | exit 0 · **READY** | exit 0 · **READY** |
| `sign_all --dry-run --until e-cp9` | exit 0 · **15** commands | exit 0 · **15** commands |
| `merge_all --dry-run --until e-cp9 --code-repo` | exit 0 · **replay CLEAN 46 of 46** | exit 0 · **replay CLEAN 46 of 46** |

Full `sign_all --dry-run` (no `--until`): **51 commands, 0 skipped**, both shells.

### `_merge-master`

Already a worktree — detached at `ccf4fbcb6`, **tree clean**, and no other worktree holds a
`merge-run` branch. So `checkout -B merge-run origin/master` is safe and **no
`git worktree add` is needed**; the creation line is recorded in the runbook for the case
where it is ever missing. No test worktree was created.

## 4 · V — the sitting verifier

`tools/sitting_verify.py --until <row>` reads **master and the packets**, never the terminal
tail. For every row through `--until`: reader state must be `SIGNED` **and** `git cherry`
against `origin/master` must say merged. For every row after it: `UNSIGNED` and absent.

⛔ **Two different BLOCKERs, named separately:** `SIGNED but NOT MERGED` (the sitting stopped,
or a push was refused) and `MERGED but UNSIGNED` (something reached master without a
signature).

**Nine controls, on fixtures** — because the live tree is entirely `UNSIGNED` / `NOT-MERGED`
and can only ever demonstrate one of the four states:

```
the real UNITS list is non-empty                          ok   <- non-vacuity
--until splits the list, and names row 15 for e-cp9       ok
an unknown --until is UNREADABLE, not an empty pass       ok
the fixture's signed packet reads SIGNED                  ok
the fixture's empty packet reads UNSIGNED                 ok
signed-through + unsigned-after -> CLEAN                  ok
a row through --until that is UNSIGNED -> BLOCKER         ok
...and a row after --until that IS signed is named too    ok
```

**Live probe now (pre-Sitting-1):** `--until packet-a-absent-bound-gate` → **exit 1**, 1
blocker (`reader=UNSIGNED merged=NOT-MERGED`), 50 rows after it reading `ok(after)`. Correct
before any sitting has run.

**The four failure branches** are written into the runbook §3a: guard REFUSE (wait for
SUCCESS ≥150 s, re-run — the tool resumes by patch id); STRAND (master moved under us — a new
row after `--until`, never a force-push); `sign_all` STALE (`freeze_check` already named the
path; re-fingerprint only if docs-side and explained, else stop); deploy non-SUCCESS (stop; a
revert commit as a new row; owner decides).

## 5 · P — the post-merge queue (PLANNED, nothing built, nothing rowed)

`docs/terminal-research/POST_MERGE_QUEUE.md`. **Collision proof:** E's table declares CP1–CP3;
records on disk top out at `e-cp33`; manifest rows top out at CP33. **CP34+ free.**

⛔⛔ **P.1 is worse than "the baseline is on the wrong branch": CI does not run on master at
all.**

```yaml
push:         { branches: [feat/s7-price-level] }
pull_request: { branches: [master] }
```

`merge_all` pushes **directly**, not via PR. **All 46 commits will reach master with zero
suite runs**, and the guard's `SUCCESS` is a **deploy** success that says nothing about
tests. PROPOSED **E CP34** adds `master` to `push.branches`; prediction recorded: the first
master run is identical to the last feat run except F-CI-42's single NEW entry is gone →
`NEW 0 · NO_NEW_FAILURES`, with `ZERO-RECORDS` as the non-vacuity guard.

**P.2** PROPOSED E CP35 — re-anchor `BASELINE_RUN_ID` to the first clean master run; the
acceptance is that the diff reconciles with **FIXED = F-CI-42 only**.
**P.3** Promotion's second half stays out — no branch protection while `merge_all` pushes
master 41 times.
**P.4** The whole-queue premise audit is **not started, deliberately**: it is docs-only and
permitted, but it must run against **post-merge master**, and running it now would audit a
tree about to change under it.

**P.5, derived today:**

| item | status |
|---|---|
| **F-CI-38** | **structurally closed, population unchanged**: 95 files install an override, 27 clear one, **70 install without clearing** — all protected by E CP28's autouse fixture (verified present) |
| **F-NAV-1** | still open; `nav_manifest.mjs` names `/post-market`, `/setup-library`, `/journal-2-0/report`, `/catalysts/history` as reachable with no nav entry |
| flaky findings | set is 6, stable across #29–#31; re-derive after a master baseline |
| single-file buckets | not re-measured; the 12-bucket split holds with 633 s headroom |
| D4 CP4 | untouched — it is a `gates/` file and therefore frozen |
| **F-CI-42** | OPEN, Notebook-owned, untouched |

**P.6 (proposal only):** of the 235.1 min, **127 min is build and 102.5 min is settle**; the
cherry-picks and pushes themselves are ~5.5 min. Batching consecutive **docs-only** units
would bend *"ONE UNIT AT A TIME, AND IT WAITS"* — written after two merges four minutes apart
served 502s. The honest counter-argument is included: that rule guards deploy-vs-deploy
collisions and a docs-only batch is still one build. **The cost is revert granularity. Not
adopted; for the owner to rule on after Sitting 4.**

## 6 · Corrections to this prompt's premises

1. **"MSYS_NO_PATHCONV=1 where a path crosses into Python"** — backwards. It *causes* the
   mangling (`C:\c\Users\…`, exit 2). Plain `/c/…` is correct.
2. **"the runbook's `set MERGE=…` / `%MERGE%` lines won't expand in Git Bash"** — true, and
   the fix is the bash form. But the cmd form is also fine **only because `set` is on its own
   line**; a one-liner breaks it, which is a different trap and is now recorded.
3. **"F-CI-42 … goes green when master == HEAD"** — true, and the report records the vacuity
   with it: it also goes green on any branch that merely happens to be current, which is why
   it is a finding rather than a fixed test.

## 7 · Findings filed / closed

| id | finding | state |
|---|---|---|
| **F-SIGN-12** | the signable surface had no freeze; any edit mid-sitting would break a signed row's fingerprint | ✅ **CLOSED** — `freeze_check.py`, 80 paths, 7 controls |
| **F-SIGN-13** | the runbook was cmd-only; the bash path form is the one this box actually uses | ✅ **CLOSED** — both forms, both proved |
| **F-SIGN-14** | `MSYS_NO_PATHCONV=1` corrupts `--code-repo` into `C:\c\Users\…` | ✅ recorded; the runbook forbids it |
| **F-SIGN-15** | a sitting's result had no derivation — only the owner's summary | ✅ **CLOSED** — `sitting_verify.py`, 9 controls |
| **F-CI-43** | **CI does not run on master at all**; 46 commits will merge untested and the guard's SUCCESS is deploy-only | ⛔ **OPEN** — PROPOSED E CP34, post-merge |
| **F-CI-42** | Notebook self-check asserts a property of the live repo | ⛔ **OPEN** — Notebook-owned, untouched |

## 8 · OPEN QUESTIONS

- **P.6** — batch consecutive docs-only units, or keep one-unit-one-merge at 235 min?
- **F-NAV-1's four unlisted routes** — which are meant to be reachable without a nav entry?
- **h14 / s10 / s12** still carry signed lines naming no checkpoint; numbering them is what
  turns `audit_scope_vs_checkpoints` green, and they are frozen until Sitting 4.
- **Does the Layer-1 monitor still post?** Not derivable from this worktree; recorded as
  UNREADABLE rather than assumed healthy.

## 9 · [KEYBOARD]

```
READY.  Run freeze_check + pre_sitting FIRST in every sitting.

--- cmd.exe ---
cd /d C:\Users\Patrick\uct-worktrees\terminal-research
set MERGE=C:\Users\Patrick\uct-worktrees\_merge-master
git -C %MERGE% checkout -B merge-run origin/master

:: SITTING 1 — 74.5 min
python tools\freeze_check.py
python tools\pre_sitting.py --code-repo %MERGE%
python tools\sign_all.py  --manifest tools\sign_manifest.txt --until e-cp9-build-record
python tools\merge_all.py --manifest tools\sign_manifest.txt --until e-cp9-build-record --code-repo %MERGE%

:: SITTING 2 — 74.5 min   (freeze_check + pre_sitting again first)
python tools\sign_all.py  --manifest tools\sign_manifest.txt --until e-cp22-build-record
python tools\merge_all.py --manifest tools\sign_manifest.txt --until e-cp22-build-record --code-repo %MERGE%

:: SITTING 3 — 74.5 min
python tools\sign_all.py  --manifest tools\sign_manifest.txt --until d3-cp2-build-record
python tools\merge_all.py --manifest tools\sign_manifest.txt --until d3-cp2-build-record --code-repo %MERGE%

:: SITTING 4 — 11.5 min
python tools\sign_all.py  --manifest tools\sign_manifest.txt
python tools\merge_all.py --manifest tools\sign_manifest.txt --include-member-visible --code-repo %MERGE%

--- Git Bash ---
cd /c/Users/Patrick/uct-worktrees/terminal-research
MERGE=/c/Users/Patrick/uct-worktrees/_merge-master
git -C "$MERGE" checkout -B merge-run origin/master

# SITTING 1 — 74.5 min
python tools/freeze_check.py
python tools/pre_sitting.py --code-repo "$MERGE"
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp9-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp9-build-record --code-repo "$MERGE"

# SITTING 2 — 74.5 min   (freeze_check + pre_sitting again first)
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp22-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp22-build-record --code-repo "$MERGE"

# SITTING 3 — 74.5 min
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until d3-cp2-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until d3-cp2-build-record --code-repo "$MERGE"

# SITTING 4 — 11.5 min
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt --include-member-visible --code-repo "$MERGE"

⛔ cmd: keep `set` on its own line.  ⛔ bash: do NOT set MSYS_NO_PATHCONV=1.

After each sitting, paste the last 30 lines of merge_all's output and say which
sitting; the next session runs `sitting_verify --until <row>` before anything else.
```

## 10 · Merge readiness — from `pre_sitting`'s own output

```
verify_manifest (fingerprints)         0  51 OK, 0 STALE
verify_manifest --check-commits        0  mapped: 46 of 46
merge_all --self-check (drift)         0  SELF-CHECK: PASS
verify_doc_shas                        0  every cited SHA resolves
audit_signature_regexes                0  every approval-block pattern is line-anchored
audit_scope_vs_checkpoints             1  EXPECTED-LEGACY: 4 packets, 0 manifest rows
sign_all --dry-run                     0  51 sign command(s), 0 skipped
merge_all --dry-run (REPLAY)           0  replay CLEAN 46 of 46
PRE-SITTING: READY
freeze_check                           0  80 of 80 paths match
```

⛔ Nothing signed, merged, or pushed to master. No deploys, flag flips, or wake-ups. The code
branch was not touched.

## 11 · Three phone-readable sentences

**The signable surface is frozen at eighty paths** — the six tools that decide a fingerprint
or the merge order, every gate packet, and the code branch tip — and the first line of every
sitting now proves none of them has moved.

**Both shells are proved rather than assumed, and the prompt's path advice was backwards:**
the environment variable it suggested is exactly what corrupts the path, while the plain bash
form works, and in cmd the only trap is putting `set` on the same line as the command.

**One thing found while planning the post-merge work is worth knowing before you start: the
test suite does not run on master at all**, so every commit these four sittings land will be
deployed without being tested, and the guard's green is a deploy's green.

## 12 · Status

STATUS: RAN
