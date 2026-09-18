# POST-MERGE QUEUE — RE-DERIVED AGAINST MASTER, 2026-09-18

⭐ **The freeze lifted 2026-09-18.** Every item below is re-derived against the CURRENT tree
(origin/master `56f6a6fe9`, `sitting_verify` CLEAN — 65 rows signed, 45 merged, universe 0
unclaimed) rather than restated from when this file was written PLANNED-ONLY. Disposition per
item: **CLOSED** (built and verified), **CARRIED** (moved into a section of the current session
prompt — Q or O — rather than duplicated here), or **OPEN-WITH-OWNER** (still needs the owner's
call; nothing here can close it).

---

## P.1 — CLOSED. **E CP34**: CI does not run on master at all

⛔ **Measured, and it is worse than "the baseline is on the wrong branch":**

```yaml
on:
  push:        { branches: [feat/s7-price-level] }
  pull_request:{ branches: [master] }
  workflow_dispatch:
```

`merge_all` pushes **directly to master** — no PR — so **none of the 46 merged commits will
run the suite.** After Sitting 4, master carries every unit and has **zero** CI runs against
any of them. The Railway deploy still builds, so the guard's `SUCCESS` is a **deploy**
success and says nothing about tests.

**The unit:** add `master` to `push.branches`. **Prediction, recorded now:** the first master
run is identical to the last feat run **except** that F-CI-42's single NEW entry is gone,
because its self-check scans `HEAD..origin/master` and that range is empty once master
contains the branch. So: `NEW 0 · verdict NO_NEW_FAILURES`.

⚠️ **Non-vacuity for that prediction:** if the first master run shows `NEW 0` because it
never ran, the record will show `ZERO-RECORDS` or a missing `results/<id>/`, not a pass.

⭐ **CLOSED, but the prediction was wrong, and that is worth keeping.** `master` was added to
`push.branches` on the E CP34 commit itself; the first two real master runs
(`35315716615` then, after E CP36/37, `35340953181`) both fired for real. The `NEW 0` prediction
did not hold — the first run showed `verdict: COVERAGE_LOST` (a real defect, F-CI-46, not
predicted), and even after that fix the second run showed `NEW 41` — but every one of those 41 is
now attributed (§E38 of the current session), and none of them means the PREDICTION MECHANISM
was wrong; it means the prediction's premise ("identical to the last feat run") assumed a quiet
master, and master turned out to be under heavy concurrent development from other workstreams the
same night. The trigger itself works exactly as built.

## P.2 — CARRIED into E38 (this session). Baseline re-anchor, renumbered twice more

`BASELINE_RUN_ID` currently points at a **feat** run (`35008710335`, #19). This slot was
originally planned as E CP35, then (per E CP35's own build record) renumbered to E CP36 when
F-OPS-1 built first, then again to E CP37 when the PyYAML fix (F-CI-46) built first, then again
to **E CP38** when the stale `test_weekly_exec` fix built first. Collision proof is the
authority, not this file's spelling, each time.

⛔ **The acceptance bar as originally written — "FIXED = {F-CI-42's entry} and nothing else" —
is no longer the right bar**, and the current session's own ruling (R-ROLLING-BASELINE, E CP38)
replaces it: a fixed baseline on a shared, multi-workstream master measures everyone's drift, not
just this programme's, so the fix is a ROLLING baseline with per-entry attribution, not a
stricter reconciliation against a fixed point. See E38 in the current session report.

## P.3 — OPEN-WITH-OWNER, unchanged

**No branch protection. No required check.** `merge_all` pushed master directly many more times
than 41 by the time the programme finished; a required check would have refused every one of
those pushes. **The gate's colour is truthful (E CP26); that it does not block is a separate
decision and remains unmade.** Nothing this session did resolves this — it is restated, not
re-derived, because nothing changed.

## P.4 — CARRIED into Q (this session)

**The whole-queue premise audit** (D5 CP3–CP7 · S6 CP2–CP5 · S3 `/status` · the bell panel ·
COMPLETION_AUDIT recount, plus D4 CP4's corrected assertion) is Q.1–Q.4 of the current session
prompt. Not duplicated here — see that section for the resolved-nouns table, verdicts, and any
units built from it.

## P.5 — Open items, re-derived

| item | status, re-derived 2026-09-18 | disposition |
|---|---|---|
| **F-NAV-1** | Still open, same shape: `nav_manifest.mjs` lists UNLISTED routes incl. `/post-market`, `/setup-library`, `/journal-2-0/report`, `/catalysts/history` | **CARRIED into O.3** — the current session prompt's R-NAV ruling gives a measured default (inbound links + traffic) rather than waiting on a bare owner ruling |
| **F-CI-38** | Unchanged since last measured — structurally closed, population unchanged (70 of 95 `dependency_overrides` sites protected by E CP28's autouse fixture) | **CLOSED**, nothing to re-open |
| **the four flaky findings** | **UNBLOCKED, not yet re-derived.** A real master-run baseline now exists (`35340953181`); `flaky_size: 2` on that run (not 6 — the number moved since this row was last measured, on a different branch/session's own flaky tracking). Re-deriving against the master-anchored flaky set is real, undone work | **OPEN-WITH-OWNER** — not in scope for E38/Q/O this session; flagged so it is not silently dropped |
| **the two single-file buckets** | still not re-measured against a post-merge master run | **OPEN-WITH-OWNER**, same reason |
| **D4 CP4's corrected assertion** | the freeze that blocked it is lifted | **CARRIED into Q.1** — explicitly named in the current session prompt's Q.1 subject list |
| **F-CI-42** | **CLOSED.** Confirmed directly against `35340953181`'s diff.json: `legendFromDefinitions.test.jsx` now appears in `fixed`, `file_level_resolved: 1` — exactly the E CP29 mechanism working as designed, now that `HEAD..origin/master` is genuinely non-empty | closed by the merge itself, no code change needed |

## P.6 — CLOSED. Superseded by R-BATCH, adopted and used repeatedly

The batching proposal here was explicitly adopted by the owner's own R-BATCH ruling this
session ("consecutive non-member-visible units push as one batch, PRODUCT units alone, F-S2-1
alone") and used for real, multiple times: T CP2/E CP34/E CP35 batched together, and again for
E CP36/E CP37 individually where batching didn't apply (each depended on the prior run's fresh
CI result). **The revert-granularity cost this section worried about did not materialise** — no
batch needed reverting. This proposal is superseded by the ruling, not merely decided in its
favor; nothing further to build.

## CLOSED — F-MV-1 · the member-visible gate reads a FLAG; the `#!last:` rule DERIVES

**Found 2026-09-17 (session 7), during Route C. FIXED by K CP15 this programme** — the exact
shape this section asked for: `is_member_visible_path()`, `_strip_line_comment()`,
`_diff_lines()`, `_is_comment_only_change()`, `member_visible_files()` (comment-stripped
multiset diff comparison, surface = `app/src/` + `api/routers/` expanded). K CP15's own build
record and self-check cover exactly the two cases this section named as the acceptance bar: a
comment-only edit to an `app/src/` file reads as NOT member-visible, and a real JSX change
reads as member-visible. Nothing further to build.

---

## PROPOSED — F-MV-1 (original text, kept for the record) — the member-visible gate reads a FLAG; the `#!last:` rule DERIVES

**Found 2026-09-17 (session 7), during Route C. Not built: a fix is a new signable row and the
signing freeze forbids one mid-merge. Drafted here, unsigned.**

There are two authorities on *"is this unit member-visible"* and nothing compares them:

```
merge_all.main()      member_visible  <- the THIRD ELEMENT of the UNITS tuple (hand-declared)
check_order 'last'    member_visible_files(stem)  <- DERIVED from the commits' file set
```

They disagree on exactly one row today:

```
row 51  d3-cp2-build-record   flag=False   derived= app/src/lib/barsStreamManager.js
```

⭐ **On this row the FLAG is right and the derived rule is over-broad.** `af9fe21a6`'s edit to
that file is a **comment**, value unchanged:

```
-export const MAX_BARS_PAIRS = 50   // mirror of api/routers/stream.py pairs[:50]
+export const MAX_BARS_PAIRS = 50   // mirror of api/routers/stream.py MAX_BARS_PAIRS
```

`is_member_visible_path` is purely path-shaped — *under `app/src/` and not a test* — so a
comment-only edit to a product file reads as member-visible. No member experiences anything.
**Sitting 3 therefore merges row 51 without `--include-member-visible`, correctly.**

⛔ **The defect is structural, not this row.** Because the gate trusts a hand-typed boolean that
nothing validates against the file set, **a row whose flag is wrongly `False` on a genuinely
member-facing change would merge with no deliberate stop** — and the stop is the entire purpose
of `--include-member-visible`. That is the same shape as the writer-index `FOUR`, the COT
router's "4 routes" and the setup catalog's "24": *a hand-maintained value beside the source
that owns it.*

⚠️ **And it cannot simply be "derive it instead".** If the gate derived the property it would
fire on row 51's comment, and a stop that cries wolf on a comment gets waved through — which is
worse than no stop. The unit therefore needs BOTH: derive the file set, and narrow the predicate
so a change with no reachable effect (comment/whitespace-only hunks) is not member-visible.

**Proposed shape:** a validator in `pre_sitting` that derives the set per row and **fails naming
any row where declared and derived disagree**, with the declared flag remaining the gate until
the predicate is narrowed. Its self-check must include *"a comment-only edit to an `app/src/`
file is NOT member-visible"* and *"a real JSX change IS"* — a predicate that cannot tell those
apart is the thing being fixed.

## CLOSED — F-VERIFY-1 · `verify_manifest` cannot read a manifest once ANY row is signed

**FIXED by K CP14 this programme.** `verify_manifest.py` gained `_at_sha_matches()`,
`_row_state()` (the SIGNED-aware branch this section asks for), a rewritten `check()` that asks
`read_approval()` first, and a hardened `main()` with `_GOOD_STATES = ("OK", "SIGNED-OK")`. The
self-check this session's own `pre_sitting.py` runs (`verify_manifest --check-commits`,
`50 of 50 mapped`) is direct, running proof the fix holds under real signed rows, not just K
CP14's own fixtures. Nothing further to build.

---

## PROPOSED — F-VERIFY-1 (original text, kept for the record) — `verify_manifest` cannot read a manifest once ANY row is signed

**Found 2026-09-17 (session 7), one signature into Sitting 1. Not fixed: `tools/verify_manifest.py`
is IN the freeze set, and the freeze's own rule is "a new row after the current `--until` is the
fix, never an edit." Drafted here, unsigned.**

The moment `merge_all` signed row 1, the mandated pre-sitting gate went red:

```
PRE-SITTING: NOT-READY
  verify_manifest (fingerprints)     1  (no line matched)
  verify_manifest --check-commits    1  (no line matched)
```

Both from ONE cause. `verify_manifest.main()` runs the fingerprint pass FIRST and dies on the
first signed packet:

```
no UNSIGNED `APPROVED AT SHA:` line (every block already carries a fingerprint).
```

`check_commits` sits at line 404, AFTER that pass, so **K CP8's commit-coverage proof goes dark
as collateral** — it is never reached.

⭐ **`sign_all` gets this right and `verify_manifest` does not.** `sign_all.fingerprint_of` falls
back to `sign_gate.rederive_signed(text, span)` for a filled block and reports *"1 skipped as
already signed"*, exit 0. `verify_manifest` has its own `fingerprint_text` and no such fallback.
**Two tools, one computation, one of them signed-aware** — the second-authority shape again.

⛔ **The consequence is structural, not cosmetic.** `pre_sitting` is mandated before EVERY
sitting, and it can never read READY again from the first signature onward. Sittings 2, 3 and 4
cannot pass their own gate as the runbook specifies.

⚰️ **And the specific check it darkens is the one `pre_sitting` was built to protect.** F-SIGN-6:
`--check-commits` "was correct throughout, and stopped being run — because it was in no list",
while eleven commits went unclaimed for five sessions. It is now in the list and the list cannot
run it.

**Established by substitute measurement** (the tool's own functions, called directly, unmodified):

```
V.check_commits(branch=..., base=...)   ->  mapped: 48 of 48      exit 0
V.check_resolutions()                   ->  1 parsed, 0 corrupt   exit 0
sign_all --dry-run                      ->  54 verified, 1 skipped as signed, exit 0
```

So the manifest's integrity is intact; only the CLI packaging is broken. **That is why the
sitting continued** — the failure is UNREADABLE, not a detected fault, and this programme's own
rule is that those are different states.

**Proposed fix:** give `verify_manifest.fingerprint_text` the same signed-aware fallback
`sign_all` already has, and move `check_commits`/`check_resolutions` AHEAD of the fingerprint
pass — or make main() run all three and report each independently, so one unreadable pass can
never blind the other two. Self-check must include *"a manifest with one signed row still
verifies the other 54 and still reports commit coverage."*

## CLOSED — F-DEPLOY-1 · `merge_all.wait_for_deploy` CANNOT INVOKE `railway` ON WINDOWS

**FIXED by K CP13 this programme.** `_resolve_bin(name)` + a `_RESOLVED_BIN` cache, exactly the
`shutil.which`-based fix this section proposed, matching `pre_push_guard._railway()`'s existing
pattern in the same repo. `merge_all` has since completed real, multi-unit sittings across many
sessions with real `wait_for_deploy` calls succeeding — the operational consequence this section
called total ("can merge at most one unit per run") is the thing that got fixed; every session
since has merged far more than one unit per invocation. Nothing further to build.

---

## PROPOSED — F-DEPLOY-1 (original text, kept for the record) — `merge_all.wait_for_deploy` CANNOT INVOKE `railway` ON WINDOWS

**Found 2026-09-17 (session 7) by merging the first unit. `tools/merge_all.py` is IN the freeze
set, so the fix is a new signable row, not an edit. Drafted here, unsigned.**

`merge_all` pushed unit 1 successfully, then **crashed**:

```
File "tools/merge_all.py", line 830, in wait_for_deploy
  rc, out = run(["railway", "deployment", "list", "--service", "web", "--json"], ...)
File "subprocess.py", line 1552, in _execute_child
  hp, ht, pid, tid = _winapi.CreateProcess(executable, args, ...)
FileNotFoundError: [WinError 2] The system cannot find the file specified
```

`merge_all.run()` hands the bare string `"railway"` to `subprocess.run([...])`. On Windows the
CLI is an npm shim at `AppData/Roaming/npm/railway` with no executable extension, and
`CreateProcess` cannot resolve it. Bash can, which is why `railway --version` succeeds in a
terminal and the same call dies inside the merge engine.

⚰️ **THE SIBLING TOOL ALREADY KNOWS.** `pre_push_guard._railway()`, in this very repo:

> *"⛔ Resolved with `shutil.which`, never `shell=True`. On Windows the CLI is a `.cmd` shim
> that `subprocess.run([...])` cannot resolve on its own"* — `return shutil.which("railway")`

**The lesson was learned, written down, and left in one tool.** `merge_all` never got it. This is
the repeated shape of this programme — a fix that lands in the instrument that found it and not
in its sibling.

⛔⛔ **THE OPERATIONAL CONSEQUENCE IS TOTAL: `merge_all` CAN MERGE AT MOST ONE UNIT PER RUN.**
It pushes a unit, calls `wait_for_deploy`, and dies. A sitting of 13 units cannot complete in one
invocation — not because of a guard, a strand, or master moving, but because the merge engine
crashes immediately after its first successful push.

⭐ **Why five sessions never saw it: nothing had ever merged.** `wait_for_deploy` runs only AFTER
a push succeeds, and until 23:22Z today no push had ever succeeded — every prior run stopped at
a strand, a constraint, a stale base, or the guard. **The dry run cannot reach this line**
(`wait_for_deploy(sha, dry)` returns early), so `--dry-run` was green over a fatal defect for
five sessions. A replay that performs everything except the one call that crashes is not a
replay of the run.

⚠️ **Safety impact is small; throughput impact is total.** The 150 s settle that `wait_for_deploy`
exists to enforce is ALSO enforced by the pre-push hook before the NEXT push (clause 1, recency,
600 s — stricter than 150 s). So a crashed wait cannot push into an in-flight swap. What is lost
is the engine's own confirmation that the unit it just merged actually deployed — which is
exactly the R-STOP condition *"deploy non-SUCCESS on a merged unit"*, now unmeasured by the tool
that is supposed to measure it.

**Proposed fix:** resolve the binary once with `shutil.which("railway")` — the identical call
`pre_push_guard` already makes — and REFUSE with a named reason when it returns `None`, never
crash. Its self-check must include *"the CLI is absent → REFUSED with a reason, not a
traceback"*, and the deploy wait must be exercised by a fixture that reaches the call, since
`--dry-run` structurally cannot.

⭐ **Wider rule worth carrying:** every external binary this programme shells out to should be
resolved through one helper with one `shutil.which`, because the second copy is where the
Windows shim bites.
