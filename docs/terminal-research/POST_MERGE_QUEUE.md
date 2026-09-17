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
