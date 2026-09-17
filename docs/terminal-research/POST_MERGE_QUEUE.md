# POST-MERGE QUEUE — PLANNED ONLY

⛔⛔ **NOTHING HERE IS BUILT, AND NOTHING HERE HAS A MANIFEST ROW.** The signable surface is
frozen until Sitting 4 is reported complete. Every checkpoint below is **PROPOSED**, with its
collision proof, and becomes a row only after the freeze lifts.

**Collision proof for the E numbers below:** E's packet table declares **CP1–CP3**; build
records on disk top out at **e-cp33**; manifest rows top out at **CP33**. **CP34+ free.**

---

## P.1 — PROPOSED **E CP34**: CI does not run on master at all

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

## P.2 — PROPOSED **E CP35**: re-anchor the baseline to a master run

`BASELINE_RUN_ID` currently points at a **feat** run (`35008710335`, #19). Once P.1 lands and
one clean master run exists, re-anchor to it.

⛔ **The acceptance is a reconciliation, not a green:** the diff between the last feat
baseline and the first master run must close with **FIXED = {F-CI-42's entry} and nothing
else**. Any other FIXED or NEW means the merge changed behaviour, and that is a finding
before it is a re-anchor.

## P.3 — Promotion's second half stays OUT — restated

**No branch protection. No required check.** `merge_all` pushes master directly 41 times; a
required check would refuse every one of those pushes. **The gate's colour is truthful
(E CP26); that it does not block is a separate decision and remains unmade.**

## P.4 — The whole-queue premise audit, refreshed against master

**The first thing built after Sitting 4.** Method (unchanged, and it is the point): re-resolve
every noun each packet names against the tree **as master will then stand**, and classify
**BUILDABLE / NEEDS-REWORD / UNBUILDABLE** with the resolution printed beside each.

Queued subjects: **D5 CP3–CP7 · S6 CP2–CP5 · S3 `/status` · the bell panel ·
COMPLETION_AUDIT recount**, plus a dependency map across the whole queue.

⚠️ **Not started.** It is docs-only and therefore permitted during the freeze, but it must be
run against **post-merge master**, and master does not contain the units yet. Running it now
would audit a tree that is about to change under it — the exact staleness the audit exists to
find.

## P.5 — Open items, one line each

| item | status, derived today | what unblocks it |
|---|---|---|
| **F-NAV-1** | Still open. `nav_manifest.mjs` lists UNLISTED routes incl. `/post-market`, `/setup-library`, `/journal-2-0/report`, `/catalysts/history` — reachable, member-facing, no nav entry | an owner ruling on which are meant to be reachable; the generator already names them |
| **F-CI-38** | **Structurally closed, population unchanged**: 95 test files install a `dependency_overrides`, 27 clear one, **70 install without clearing** — and all 70 are protected by E CP28's autouse fixture (present in `tests/conftest.py`, verified) | nothing; the sweep was deliberately not done, and the harness guarantee replaces it |
| **the four flaky findings** | flaky set is 6 and stable across #29–#31; `AuthContext.test.jsx` correctly counted `new_flaky` | a master-run baseline (P.2) before re-deriving |
| **the two single-file buckets** | not re-measured this session — the 12-bucket split holds with 633 s of headroom | a post-merge run at ROOT_BUCKETS 12 |
| **D4 CP4's corrected assertion** | untouched during the freeze (it is a gates/ file) | the freeze lifting |
| **F-CI-42** | OPEN, Notebook-owned, untouched. Goes green when `HEAD..origin/master` is empty — i.e. after Sitting 4 | Sitting 4, or a Notebook fix; ⚠️ it will also go green on any branch that is merely current, which is the vacuity |

## P.6 — PROPOSAL ONLY: the wall-time cost of one-unit-one-merge

**41 pushing units × 5.73 min = 235.1 min**, of which **41 × 186 s = 127 min is build** and
**41 × 150 s = 102.5 min is settle**. The work itself — cherry-pick and push — is about
**5.5 min in total**.

**Proposed (NOT decided):** consecutive **docs-only** units may be batched into one push.

- **The standing rule it bends:** *"ONE UNIT AT A TIME, AND IT WAITS"*, written after
  2026-09-12, when two merges four minutes apart marked the first deploy `REMOVED` and
  `/api/health` served 502 for ~45 s.
- **Why docs-only is arguably different:** the failure that rule was written for is a
  **deploy** colliding with a **deploy**. A docs-only batch still triggers exactly one build,
  so it does not add a collision — it removes N−1 of them.
- **What it costs:** revert granularity. A bad batch reverts as a batch, and this programme's
  whole unit discipline is that one unit is one revertable thing.
- **The number:** of 51 rows, **10 carry no commits** and 41 do; batching would only help
  where consecutive rows are docs-only, so the saving is smaller than it looks. **Measure the
  actual runs of consecutive docs-only rows before ruling.**

⛔ **For the owner to rule on after Sitting 4. Not adopted, not built.**

## PROPOSED — F-MV-1 · the member-visible gate reads a FLAG; the `#!last:` rule DERIVES

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

## PROPOSED — F-VERIFY-1 · `verify_manifest` cannot read a manifest once ANY row is signed

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

## PROPOSED — ⛔⛔ F-DEPLOY-1 · `merge_all.wait_for_deploy` CANNOT INVOKE `railway` ON WINDOWS

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
