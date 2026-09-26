# SESSION REPORT — 2026-09-17, session 7

**Route C.** The split is derived, the instrument-only replay is CLEAN, and the offline diff
already isolates the change under test to **five units and twelve files**. CI evidence and the
sittings follow below.

---

## 1 · ET, trees, remote, freeze, poll log

```
ET start   2026-09-17 17:30 EDT Thu   (tools/weekly_exec.py et, exit 0)
ET end     2026-09-17 19:40 EDT Thu
remote     https://github.com/unchartedterritory5995-cyber/UCT-Dashboard.git
origin/master pinned base 110f250b7   (moves ~hourly; both tips built on THIS sha)
code   feat/s7-price-level d50fadadf   UNCHANGED
docs   000d2eca6 -> (this commit)
freeze  84/84 OK
replay-preview  217ae7230 -> d25a84ae4 (baseline) -> 35ce385b5 (current), both forced
poll log  21:40:48Z baseline pushed · 21:40:52Z run #36 queued (35278018147)
          22:03:16Z run #36 finished · 22:06:24Z current pushed · run #37 queued
```

⛔ **The freeze is 84/84, not 85/85.** Sessions 5 and 6 both reported 85; the baseline file has
held **84** entries since session 5's authorised window took it 83 → 84. Nothing was dropped —
all 77 `gates/*.md` are recorded and every path matches its SHA. **The number in those two
reports was simply wrong**, and it is corrected here rather than carried a third time.

## 2 · P — THE SPLIT (R-SPLIT, derived)

```
INSTRUMENT   50 rows   43 commits
PRODUCT       5 rows    5 commits
             ---------------------
             55 rows   48 commits      <- sums
```

**PRODUCT, with the one path that disqualifies each:**

| row | disqualifying path |
|---|---|
| `s4-cp2-build-record` | `app/src/lib/context/symbolLinkChannels.test.js` |
| `packet-t-stale-test-gate` | `app/src/pages/ThemeTrackerPage.chartmount.test.jsx` |
| `d3-cp2-build-record` | `api/routers/stream.py` |
| `s2-accelerator-chord-pre-implementation-gate` | `app/src/components/TickerPopup.flagkey.test.jsx` |
| `t-cp2-build-record` | `app/src/pages/ThemeTrackerPage.flagkey.test.jsx` |

⚠️ **This is 50/5, not the ~32/16 the prompt predicted, and the difference is definitional.**
Session 6's estimate used a narrow instrument cut (`.github/**`, `tools/ci_*`, `pytest_shards`);
**R-SPLIT as written places all of `tests/` in INSTRUMENT**, so every backend-test unit moves to
the baseline. R-SPLIT is the rule and R-SPLIT is what ran. The consequence is worth stating
plainly: the baseline carries the new backend tests, so a new test that fails against old
product code shows up as **FIXED in the current run, never NEW** — the safe direction.

**P.2 — the instrument-only replay was CLEAN on the FIRST iteration.** No unit stranded and none
cherry-picked empty, so **no dependency moves were required** and the loop converged immediately.

```
[split] instrument-only replay CLEAN 43 of 43 onto origin/master (110f250b7)
        (1 resolution applied: e-cp28-build-record--tests-conftest-py.md)
```

**Both mandatory conditions hold, measured:**

```
#8  packet-e-ci-gap-gate  06d5bde92   .github/workflows/full-suite-report.yml   status A  (CREATES)
    in INSTRUMENT                                                                         yes
#47 e-cp34-build-record   4c4ba1cb1   same file                                 status M
    in INSTRUMENT                                                                         yes
control  the file on origin/master  -> ABSENT      CLAUDE.md on origin/master -> present
```

⭐ **The control is the load-bearing half.** "ABSENT" is only evidence because the same probe
reports a file that IS there. Session 6's finding is confirmed, not re-assumed.

## 3 · The offline diff — the measurement that decides Route C

Both tips built on ONE pinned base `110f250b7`:

```
BASELINE (INSTRUMENT only)  d25a84ae4   43 commits ahead
CURRENT  (all 48)           35ce385b5   48 commits ahead
```

⛔ **They are independent cherry-pick lineages, so a commit count between them means nothing** —
`rev-list BASELINE..CURRENT` reports 48, not 5, because none of the baseline's commits are
ancestors of the current's. **The tree diff is the instrument**, and it reads:

```
baseline -> current : 12 files changed, 632 insertions(+), 13 deletions(-)
```

and those twelve files are **exactly** the five PRODUCT units' own file set, derived
independently from `git show --name-only` of their source commits.

```
api/routers/stream.py                                app/src/pages/ThemeTrackerPage.flagkey.test.jsx
app/src/components/TickerPopup.flagkey.test.jsx      app/src/pages/ThemeTrackerPage.jsx
app/src/components/TickerPopup.jsx                   app/src/pages/Watchlists.flagkey.test.jsx
app/src/lib/barsStreamManager.js                     app/src/pages/Watchlists.jsx
app/src/lib/context/symbolLinkChannels.test.js       app/src/pages/command/chordCollision.test.js
app/src/pages/ThemeTrackerPage.chartmount.test.jsx   tests/test_bars_pair_cap_is_named.py
```

```
INSTRUMENT set touches 21 files + PRODUCT 12 = 33 total     <- arithmetic reconciles
```

⚠️ **The equality control FAILED on its first run, and the failure was my own instrument.** The
two lists were byte-identical apart from line endings — one written by git (LF), one by Python
(CRLF). Re-run normalised it is IDENTICAL, and a deliberately shortened list is still reported
as different, so the check is not vacuous. **A control that fails because of how its inputs were
written is not a finding**, and publishing it as one would have been the third such artifact in
this programme.

## 4 · B — BASELINE RUN

```
pushed   21:40:48Z   replay-preview  217ae7230 -> d25a84ae4  (forced; preview branch only)
fired    21:40:52Z   run #36  id 35278018147  "full suite (report-only)"  23 jobs
trigger  push.branches: [feat/s7-price-level, master, replay-preview]  <- present on the tip
```

**BASELINE-RUN `35278018147` (#36), verdict RED, finished 22:03:16Z.** A baseline's job is to
be the reference inventory, not to be green.

```
pytest   shards 16/16 reported, 16 success, 0 failed, 0 cancelled
         missing []   unreadable []   without_totals []
         collected 22390 = passed 22194 + failed 105 + skipped 89 + errors 2      RECONCILES
vitest   collected 20641 = passed 20615 + failed 11 + skipped 15                  RECONCILES
         totals_line_found True, errored 0, 10 failing files
```

⚠️ **I first called the pytest arithmetic broken and I was wrong about the rule, not the data.**
`passed + failed` leaves a delta of 91, and `skipped + xfailed` over-counts it at 98. The closure
is **`collected = passed + failed + skipped + errors`**, which lands exactly on 22390 here and
exactly on 22407 for run #35. ⭐ **xfailed is not a separate bucket in this accounting** — that
was my error, and it is recorded because a reader re-deriving these totals will hit the same
trap.

⭐ **The two collection errors are ENV-shaped and identical across both runs**
(`ModuleNotFoundError: No module named 'yaml'`, `tests/test_promotion_control.py`); the two
records' collect-error files differ only in elapsed seconds. So the errors are a standing
property of the CI image, not something this baseline introduced.

**Prediction scored — half right.** I predicted before the run that the baseline would fail the
STALE `ThemeTrackerPage.chartmount.test.jsx` and `chordCollision.test.js`, since the units that
repair them are PRODUCT.

```
src/pages/ThemeTrackerPage.chartmount.test.jsx   FAILED in baseline   <- predicted, confirmed
src/pages/command/chordCollision.test.js         PASSED in baseline   <- predicted, WRONG
```

`chordCollision.test.js` is modified by `s2-accelerator-chord-pre-implementation-gate` but does
not fail without it. Recorded as a miss rather than quietly dropped.

## 5 · C — CURRENT RUN + verdict

**MERGE-EFFECT-RUN `35280322477` (#37), finished 22:30:02Z**, on `35ce385b5` — all 48 units on
the same pinned base as the baseline.

```
             collected            passed             failed
pytest   22390 ->  22415     22194 ->  22221     105 -> 103
vitest   20641 ->  20663     20615 ->  20639      11 ->   9
```

**R-INSTRUMENT-EVIDENCE (current run):** shards 16/16 reported, 16 success, 0 failed, 0
cancelled; `missing` `unreadable` `without_totals` all `[]`; pytest
`22221+103+89+2 = 22415` and vitest `20639+9+15 = 20663` — **both reconcile**.

### The set differences

```
vitest failing FILES   baseline 10   current 9
  NEW        0
  FIXED      1   src/pages/ThemeTrackerPage.chartmount.test.jsx
  UNCHANGED  9

pytest failing IDS     baseline 107   current 105     (107-2 collection errors = the 105 the
  NEW        0                                         summary reports; 105-2 = 103)
  FIXED      2   tests.test_mutation_check.TestRestoreGuarantee::test_the_file_is_byte_identical_after_a_detected_mutation
                 tests.test_mutation_check.TestVerdicts::test_expect_red_naming_the_right_test_passes
  UNCHANGED  105
```

⛔ **THE TWO PYTEST "FIXES" ARE NOT FIXES, AND THE INSTRUMENT SAYS SO ITSELF.** Both appear on
the run's own flaky list:

```
run #36  flaky_size 1   [TestVerdicts::test_expect_red_naming_the_right_test_passes]
run #37  flaky_size 2   [TestRestoreGuarantee::test_the_file_is_byte_identical...,
                         TestVerdicts::test_expect_red_naming_the_right_test_passes]
```

⭐ **So the honest count of real repairs is ONE, not three.** Claiming three would have been a
true arithmetic statement and a false engineering one — and `flaky.json` was sitting in the same
record the whole time. FLAKY_SIZE moved 1 → 2, inside the ≤7 bound.

### Prediction, scored

```
ThemeTrackerPage.chartmount.test.jsx  FAILS in baseline, FIXED in current   predicted, CONFIRMED
chordCollision.test.js                fails in baseline                     predicted, WRONG (it passes)
NEW n PRODUCT = empty                                                       predicted, CONFIRMED
```

### ⭐ R-PROCEED — the intersection line

```
PRODUCT files (the change under test)      : 12
NEW failing files that are PRODUCT files   :  0
NEW n PRODUCT                              :  EMPTY SET
```

**The matcher is controlled 9/9** — it matches all four PRODUCT spellings including the
`src/` vs `app/src/` prefix mismatch and the pytest path, and rejects all five non-PRODUCT
baseline failures. **An empty intersection here is a measurement, not a matcher that cannot
see.**

⚠️ **And the ∅ is not vacuous in the other direction either: the new rails RAN.** Collected rose
in both suites (+25 pytest, +22 vitest) and the five added test files are green. A ∅ produced by
tests that were never collected would look identical in the verdict line and mean nothing.

⛔ **ONE NUMBER I CANNOT FULLY ACCOUNT FOR, recorded rather than smoothed over.** The new pytest
file declares **6** test functions and carries no `parametrize`, yet pytest `collected` rose by
**25**. The mechanism plainly exists — 38 test files combine `parametrize` with a filesystem
sweep, so a tree that gains files generates more cases — but I checked the likely candidates
(`test_ast_lint`, `test_d3_realtime_topology_rail`) and they parametrize over corpora, not over
`app/src`, so **I have not identified which sweeps grew.** What is established: the direction is
MORE coverage, not less; no shard lost tests, went missing, or came back unreadable; and both
runs' arithmetic closes exactly. **A +19 I cannot attribute is an open question about the
counting, not a coverage loss** — and it is left open rather than explained away.

⚠️ **A caveat on what this ∅ licenses.** Because R-SPLIT puts all of `tests/` in INSTRUMENT, the
baseline already carries the new backend tests. A new test that fails against old product code
therefore shows up as FIXED, never NEW. That is the safe direction, but it means this comparison
answers *"do the product changes break anything?"* and **not** *"are the new backend tests
themselves sound?"* The ∅ should not be read as the second claim.

**VERDICT: the proceed rule is met.** NEW = 0 in both suites, the intersection is empty, evidence
is complete, and master's 5 commits of drift since the pinned base touch **none** of the 12 files
under test (control: the same comparison finds `api/main.py` when seeded).

## 6 · Sittings

### S.0 — the merge checkout

```
git -C _merge-master checkout -B merge-run origin/master   ->  e7369556d, tree clean
```

### Sitting 1 — gates green, then the Layer-0 guard REFUSED

```
freeze_check                              84/84 OK
pre_sitting                               READY (8 validators)
sign_all --dry-run --until e-cp9           15 rows verified, 0 stale, NOTHING WRITTEN
merge_all --until e-cp9-build-record       49 of 49 constraints SATISFIED
  row 1 packet-a-absent-bound-gate         SIGNED (scope A-CP1)
  push                                     ⛔ REFUSED
```

⚠️ **`sign_all --verify` DOES NOT EXIST.** The Route C prompt's sitting sequence names that
flag; `sign_all` has `--dry-run`, `--until`, `--by`, `--on`, `--runbook`, `--manifest` and no
`--verify`. **`--dry-run` is the verification step** — its docstring is explicit that every
row's fingerprint is recomputed from the packet on disk and compared to the manifest, and that
it writes nothing. That is what ran.

⭐ **And the bare `sign_all --until` in the OLD runbook was deliberately NOT run.** It would
bulk-sign all 15 rows up front, which is exactly what K CP10 abolished: signing is the last act
before *that unit's* merge, so a strand always lands on an UNSIGNED row. `merge_all` signs per
unit, and the refusal below proves the design — **only row 1 is signed.**

### ⛔ THE REFUSAL, in full

```
[pre-push] web is SUCCESS on e7369556d, 1536s settled — safe to push.
[pre-push] 4 distinct web deploys in the last 60 min (e7369556d, 2cb3ef508, c88f63581,
           4e855cc7d) — master is under concurrent development and a build may be in flight
           from a session this one cannot see. This is the D-05 shape; it needs a human who
           can see every workstream, not a guard.
[pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.
```

**This is NOT the settle-time refusal the runbook's failure table anticipates.** Clause 1
(recency) passed — the guard said *"safe to push"* in its own first line. **Clause 2 (BURST)
refused**: `BURST_MIN_DEPLOYS = 3` distinct deploys inside `BURST_WINDOW_SECONDS = 3600`.

⭐ **The guard in force is NOT the one in the feature branch.** `merge_all` pushes from
`_merge-master`, which is checked out at **master**, and master's `tools/pre_push_guard.py` is
**739 lines to the feature branch's 279** — the burst clause exists only in the newer copy. A
session reading the s7 worktree's guard would conclude no such check exists.

### State after the refusal — nothing reached master

```
origin/master        e7369556d   UNCHANGED
merge-run            52d994d06   2 commits ahead, UNPUSHED
git cherry           + fb01fa72f   + 52d994d06      (neither upstream)
packets SIGNED       1 of 55      packet-a-absent-bound-gate
sitting_verify       exit 1 — BLOCKER, as it should be: the sitting did not complete
```

### ⛔ R19 — the documented exit, and why this session did not take it

The burst clause has a designed exit: `UCT_BURST_ATTESTED_BY` + `UCT_BURST_ATTESTED_AT`, an
attestation valid for 15 minutes. Its own docstring says what it is:

> *"The burst refusal's own text asks for 'a human who can see every workstream, not a guard' —
> this is that human saying they looked."*

⛔ **It was not used, and neither was `UCT_SKIP_PREPUSH_GUARD`.** Three reasons, and the first
is sufficient:

1. **The clause exists precisely to encode a judgement a session cannot make for itself** — the
   file says so in those words. Attesting would be the session overruling a control written
   because a session overruled the same judgement before.
2. **I can read the deployment list but cannot see what other workstreams are about to push.**
   Four other sessions share this repo. The attestation asserts a person reviewed them.
3. **R-DELEGATE covers signing and merging, not attesting.** Writing the owner's name and a
   timestamp into a bypass log is manufacturing a human statement, which is a different act
   from the one delegated.

⭐ **The standing instruction is "never override, never `--no-verify`", and a documented
override is still an override.** The correct response to this refusal is the one the refusal
asks for: wait.

### ⛔⛔ F-GUARD-1 — THE SITTING CADENCE IS INCOMPATIBLE WITH MASTER'S OWN GUARD

The runbook budgets **74.5 min per sitting** — 13 pushes x (8 s push + 186 s build + 150 s
settle). **That arithmetic omits the two clauses that actually bind**, because they did not
exist on master when it was written.

```
RECENT_PUSH_WINDOW_SECONDS = 600     no push within 10 min of ANY deploy
BURST_WINDOW_SECONDS       = 3600    ... and
BURST_MIN_DEPLOYS          = 3       >=3 distinct deploys in 60 min REFUSES outright
```

⛔ **There is no same-session exemption.** `decide_cadence` dedupes by commit and counts every
deploy in the window whoever pushed it — so **this programme's own merges count against it.**
Recency alone caps the rate at 6/hour; the burst clause caps it at **3/hour**. 48 units is
therefore **~16 hours of wall time**, and Sitting 1 alone is ~4.3 hours, against a budget of 74.5
minutes. **The plan under-estimates by ~3.5x.**

⭐ **And the guard that binds is not the one anybody reads.** It is resolved from the PUSHING
repo, which is `_merge-master` — checked out at **master**, where `tools/pre_push_guard.py` is
**739 lines**. The feature branch's copy is **279 lines and has neither clause.** Every session
that reasoned about this merge read the short one.

### Sitting 1 — attempt log

| # | time | outcome |
|---|---|---|
| 1 | 22:41 | row 1 SIGNED; push refused — **BURST**, 4 deploys/60 min |
| — | 22:41-23:00 | one full re-wait; burst cleared at 23:00:19Z exactly as computed |
| 2 | 23:09 | refused pre-flight **exit 2** — master had moved to `4c78692c0`, `merge-run` stale |
| 3 | 23:11 | refused — **RECENCY + in-flight BUILDING**, another session's push landed **3 s** earlier |
| 4 | 23:13 | driver **killed by the host, low memory** — never reached a push |

⭐ **Attempt 2 is a tooling success, not a failure.** `merge_all` refused to cherry-pick onto a
stale `merge-run` and said so with the exact remedy. Without that check it would have applied
every unit onto a branch already carrying them, hit *"the previous cherry-pick is now empty"*,
and left `CHERRY_PICK_HEAD` behind — the F-MERGE class this repo has paid for before.

⛔ **Two of the four refusals were caused by OTHER sessions**, not by this one: master gained
`4c78692c0` mid-attempt, and its build was 3 seconds old at attempt 3. **Master is contended.**

⚠️ **The host is memory-starved** — 3.4 GB free of 31.8 GB (10.8%), seven `claude` processes, a
4 GB `llama-server`. The background driver was killed by the harness to relieve system pressure
while it sat WAITING on the guard; it had not reached a push, and no cycle log was written.

**State after all four attempts — nothing reached master:**

```
origin/master     4c78692c0   UNCHANGED throughout
merge-run         2 commits ahead, UNPUSHED, tree clean, no CHERRY_PICK_HEAD
packets SIGNED    1 of 55  (row 1, inside Sitting 1's authorised range)
freeze            1 DIFF — that same packet, fingerprint still matching the manifest
replay            CLEAN 48 of 48 onto 4c78692c0
```

⭐ **No lever was touched.** `UCT_SKIP_PREPUSH_GUARD` and the R19 attestation variables were
never set, in the driver or the shell — verified by grep and by `env`. The guard's own words on
attempt 3: *"No lever waives this."*

### ⛔⛔ F-DEPLOY-1 — THE MERGE ENGINE CRASHES AFTER ITS FIRST SUCCESSFUL PUSH

**Unit 1 merged at 23:22Z. `merge_all` then died.**

```
File "tools/merge_all.py", line 830, in wait_for_deploy
  rc, out = run(["railway", "deployment", "list", "--service", "web", "--json"], ...)
FileNotFoundError: [WinError 2] The system cannot find the file specified
```

`merge_all.run()` passes the bare string `"railway"` to `subprocess.run([...])`. On Windows the
CLI is an npm shim (`AppData/Roaming/npm/railway`, no extension) that `CreateProcess` cannot
resolve. **Bash resolves it, Python does not** — which is why `railway --version` works in a
terminal and the identical call dies inside the merge engine.

⚰️ **`pre_push_guard._railway()`, in this same repository, already documents and fixes this:**

> *"⛔ Resolved with `shutil.which`, never `shell=True`. On Windows the CLI is a `.cmd` shim that
> `subprocess.run([...])` cannot resolve on its own."*

**The lesson was learned, written down, and left in the tool that found it.**

⛔ **Consequence: `merge_all` can merge AT MOST ONE UNIT PER INVOCATION.** A 13-unit sitting
cannot complete in one run — not from a guard, a strand, or master moving, but because the engine
crashes immediately after its first successful push.

⭐ **Why five sessions never saw it: nothing had ever merged.** `wait_for_deploy` executes only
after a push succeeds, and until 23:22Z today none ever had. **`--dry-run` returns early from
that function**, so the REPLAY was green over a fatal defect for five sessions. *A replay that
performs everything except the call that crashes is not a replay of the run.*

⚠️ **Safety impact small, throughput impact total.** The settle `wait_for_deploy` enforces is
also enforced — more strictly — by the pre-push hook before the NEXT push (recency, 600 s vs
150 s). So a crashed wait cannot push into an in-flight swap. What is lost is the engine's own
confirmation that the unit it merged actually deployed, which is precisely the R-STOP condition
*"deploy non-SUCCESS on a merged unit"* — now unmeasured by the tool meant to measure it. **This
session verified that deploy by hand instead.**

### ✅ UNIT 1 — merged, deployed, verified

```
pushed          23:22Z      packet-a-absent-bound-gate  (rows 1, 2 commits)
master          4c78692c0 -> 105f9a195 -> 1996ccfb3
sitting_verify  packet-a-absent-bound-gate   SIGNED   MERGED   ok
deploy          1996ccfb3  BUILDING 23:25:09Z -> SUCCESS 23:28:06Z
                4c78692c0  -> REMOVED (superseded by ours)
```

⭐ **The first unit of this programme is on production master and serving members.** Its deploy
was confirmed SUCCESS by hand, because F-DEPLOY-1 stopped the engine from confirming it.

### The re-wait, computed rather than guessed

```
e7369556d  22:18:11Z  30.7 min  SUCCESS
2cb3ef508  22:12:50Z  36.1 min  REMOVED
c88f63581  21:59:44Z  49.2 min  REMOVED
4e855cc7d  21:52:16Z  56.6 min  REMOVED
```

Two must age past 60 minutes for the count to fall to 2; the deciding one is `c88f63581` at
21:59:44Z, so **the burst clears at ~22:59:44Z if no new deploy lands**. ⭐ Only the newest is
SUCCESS — the other three are REMOVED, i.e. superseded — so **nothing is actually building**;
it is the RATE that trips the clause, which is the point of it.

## 7 · ⛔ THE STOP — `merge_all` CANNOT MERGE A SECOND UNIT ON THIS MACHINE

**Unit 2 was attempted at 23:35Z to test whether F-DEPLOY-1's crash was a property or a one-off.
It is a property, and it is worse than the first crash showed.**

```
row 1  packet-a-absent-bound-gate        ✅ ALREADY MERGED — skipping     (sets skipped_any)
row 2  packet-c-instrument-and-claudemd  ✅ SIGNED
       ⏳ RESUMING after a skip — waiting on master's tip before pushing anything new
       FileNotFoundError: [WinError 2]          <- wait_for_deploy, BEFORE any push
```

⛔⛔ **The two failure modes compose into a hard block:**

- **Cold start** (nothing merged): merges exactly ONE unit, then crashes in `wait_for_deploy`
  *after* the push.
- **Every resume** (≥1 unit merged): `skipped_any` is set, so the RESUMED SETTLE fires and
  crashes *before pushing anything at all*.

**There is no path through.** The first run merges one unit; every run after it dies before it
can push. `origin/master` is unchanged at `1996ccfb3` and row 2 is **SIGNED but NOT-MERGED** —
the BLOCKER `sitting_verify` exists to name.

### ⛔ F-RESUME-1 — the REPLAY strands on a unit that has already merged

```
python tools/merge_all.py --dry-run     ->  exit 1
[merge-all] ⛔ STRAND at #1  packet-a-absent-bound-gate  18dd13683 — conflicting: (unnamed)
```

`replay()` cherry-picks all 48 onto `origin/master` and **never consults merged state**, so the
moment unit 1 landed, replaying it became an EMPTY pick — which surfaces as a STRAND with
`(unnamed)` conflicting files. **`--dry-run` is `pre_sitting`'s REPLAY validator**, so it is now
red for the same structural reason.

### ⭐ The shape of all five findings is ONE shape

**The toolchain was built and proved from a COLD START, and nothing had ever exercised the state
that exists one unit later.** Three validators break the moment anything merges or is signed:

| after the first... | what breaks | finding |
|---|---|---|
| signature | `verify_manifest` (and with it `--check-commits`) | F-VERIFY-1 |
| merge | `merge_all --dry-run` REPLAY | F-RESUME-1 |
| push | `wait_for_deploy`, hence every resume | F-DEPLOY-1 |

⚰️ **And `--dry-run` could not have caught any of them**, because a dry run starts cold, returns
early from `wait_for_deploy`, and signs nothing. **Five sessions of green previews sat on top of
three fatal defects**, and the first real push found all three inside thirteen minutes.

## 7a · Post-merge premise audit

Not started — still correctly gated on a post-merge master, and master now carries exactly one
unit of the forty-eight.

## 8 · Controls run this session

No mutation ladder was built — no product code was written. Every claim that decided something
carried an opposite-answer control:

| claim | control |
|---|---|
| the workflow is ABSENT on master | `CLAUDE.md` on the same ref reads **present** |
| baseline/current differ by the PRODUCT set | recomputed independently from `git show --name-only`; identical |
| NEW n PRODUCT is empty | matcher tested 9/9 — matches 4 PRODUCT spellings incl. the `src/` vs `app/src/` mismatch, rejects 5 non-PRODUCT baseline failures |
| the ∅ is not vacuous | collected ROSE (+25 pytest, +22 vitest); the added rails ran and passed |
| master's drift does not invalidate the verdict | `comm` finds `api/main.py` when seeded, and ∅ against the 12 |
| the guard's burst would clear at 22:59:44Z | it cleared at 23:00:19Z |
| `merge_all` crashes after a push | re-tested on unit 2 — reproduced, and in a DIFFERENT place |

⚠️ **Two of my own controls failed as instruments and were fixed, not reported as findings:** a
CRLF-vs-LF file comparison that called two identical lists different, and an `awk -F' \| '`
that silently emptied `$2` and reported 36 pytest failures where there were 107.

## 9 · Findings filed / closed

| id | finding | state |
|---|---|---|
| **F-DEPLOY-1** | `merge_all.run(["railway",...])` cannot resolve the Windows npm shim; crashes after the first push and before every resume's push. `pre_push_guard._railway()` already fixes this with `shutil.which` | ⛔ **OPEN — THE STOP** |
| **F-RESUME-1** | `replay()` never consults merged state, so an already-merged unit reads as a STRAND; kills `--dry-run` and `pre_sitting`'s REPLAY row | ⛔ OPEN |
| **F-VERIFY-1** | `verify_manifest` aborts on the first SIGNED row, taking K CP8's commit-coverage proof with it; `pre_sitting` can never read READY again | ⛔ OPEN |
| **F-GUARD-1** | master's guard caps merges at 3/hour with no same-session exemption; the 74.5 min/sitting budget under-estimates by ~3.5x | ⛔ OPEN |
| **F-MV-1** | the member-visible gate reads a hand-declared flag while `#!last:` derives it; they disagree on row 51 (there the flag is right) | ⛔ OPEN |
| **F-CI-45** | the CI workflow has never existed on master | ✅ **CLOSED by Route C** — the INSTRUMENT/PRODUCT split made the baseline constructible |
| **F-CI-44** | preview measured master's drift against a stale feat baseline | ✅ **CLOSED** — both tips built on ONE pinned base |
| **F-CI-43** | recorded as "push.branches excluded master" | ✅ amended (session 6), re-amended here: 46 of 48 commits land untested, not 47 |
| **F-CI-42** | Notebook self-check reads the live repo | ⛔ OPEN, untouched |

All five OPEN findings are in **frozen** tools (`merge_all.py`, `verify_manifest.py`), so every
fix is a new signable row. **Drafted, unsigned, in `POST_MERGE_QUEUE.md`. Nothing was built.**

## 10 · Merge readiness

```
rows 55        SIGNED 2        MERGED 1        universe 48 covered 48
origin/master  1996ccfb3  (carries unit 1: 105f9a195 + 1996ccfb3)
code           feat/s7-price-level d50fadadf   UNCHANGED, nothing pushed to it
docs           000d2eca6 -> this commit
merge-run      1996ccfb3, clean, no CHERRY_PICK_HEAD
replay-preview 35ce385b5  (the all-48 preview; baseline d25a84ae4 was superseded by it)

verify_manifest          ⛔ UNREADABLE on a signed manifest   (F-VERIFY-1)
  check_commits()        ✅ 48 of 48 mapped      (called directly)
  check_resolutions()    ✅ 1 parsed, 0 corrupt  (called directly)
sign_all --dry-run       ✅ exit 0, 53 verified, 2 skipped as already signed
merge_all --dry-run      ⛔ STRAND at #1 — an already-merged unit  (F-RESUME-1)
pre_sitting              ⛔ NOT-READY  (F-VERIFY-1 + F-RESUME-1)
freeze                   2 DIFF — both the SIGNED packets, fingerprints still matching
sitting_verify --until e-cp9   ⛔ BLOCKER: packet-c SIGNED but NOT-MERGED
PRE-MERGE-RUN            ✅ #37 35280322477 — NEW n PRODUCT = EMPTY SET
```

⛔ **NOT READY to continue.** Single blocking item: **F-DEPLOY-1**. It is not a judgement, a
cadence complaint, or a contended master — **the merge engine cannot push a second unit on this
machine**, and its fix is a frozen tool.

⭐ **Nothing is in a broken state.** Unit 1 is signed, merged and deployed SUCCESS. Row 2 is
signed and unmerged, which is a state `merge_all` resumes from by design the moment F-DEPLOY-1 is
fixed. No revert was executed — per R-STOP, a revert is a new signable row, drafted not run.

## 11 · Three phone-readable sentences

**The first of the forty-eight changes is live on the site and healthy** — it merged at 23:22,
built, and its deploy went green at 23:28, and the pre-merge test run said the merge breaks
nothing in any file it touches.

**The second one cannot go, and the reason is a one-line bug in our own merge script**: on
Windows it looks up the Railway command in a way that cannot find it, so it crashes the moment
it tries to check that a deploy finished — after the first push, and before every push after
that.

**We already fixed this exact bug once, in the sister tool that guards pushes, and never copied
the fix across** — so the repair is small and known, but it is a change to a frozen file, which
by your own rule is a new signed row rather than an edit, so I have written it up and left it
unsigned for you.

## 12 · Status

STATUS: STOPPED-BLOCKED  (F-DEPLOY-1)

- **merged to production master:** 1 of 48 units (`packet-a-absent-bound-gate`), deploy SUCCESS
- **signed, not merged:** 1 (`packet-c-instrument-and-claudemd-gate`)
- **pushed to master:** 2 commits, both belonging to unit 1
- **force-pushed:** `replay-preview` only, twice, as authorised
- **overrides used:** NONE — `UCT_SKIP_PREPUSH_GUARD` and the R19 attestation were never set
- **reverts executed:** NONE — drafted only, per R-STOP
- **built this session:** nothing. Five findings drafted unsigned in `POST_MERGE_QUEUE.md`
