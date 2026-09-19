---
id: e-cp26-build-record
unit: E CP26
packet: packet-e-ci-gap-gate
merges-after: E CP25
status: SIGNED (E CP26, fingerprint cff0f04a6)
---

# E CP26 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  cff0f04a6
SCOPE APPROVED:   CP26 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP26 — the gate is promoted, and the checkout stops lying about the repository.**
> Scope is `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat`
> of this unit's TWO commits, both named in `SESSION_REPORT_2026-09-15_6.md`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP25**; manifest rows run to **CP25**. **CP26 free.**

---

## 1 · ⭐⭐ PROMOTION — and the criterion was met by the RECORD, not by assertion

`continue-on-error: true` is **removed from the `gate` job**. `NEW_FAILURES`, `INVALID` and
`DID_NOT_RECONCILE` now turn the check red.

E's rewritten criterion asks for the gate to have been **observed answering both ways**.
Both answers are published on `ci-results`:

```
run #24   VERDICT: NEW_FAILURES      new 41 · fixed 5 · unchanged 117 · MISSING 0
run #25   VERDICT: NO_NEW_FAILURES   new 0  · fixed 3 · unchanged 119 · MISSING 0
```

⭐ And run #24's 41 were **real** — a shard re-partition that broke test isolation, caught
by name inside one run, with **none of it excused as flaky**. A gate nobody has seen fail is
not a gate; a gate nobody has seen pass is worse. This one has been seen doing both.

**Scored on run #27, the first run after promotion:**

```
gate job conclusion: success      (21 of 21 jobs success)
VERDICT: NO_NEW_FAILURES   new 0 · fixed 2 · unchanged 120 · MISSING 0
flaky_size 6 · flaky_new 1 · new_flaky 1
```

⭐ `new_flaky: 1` is F-CI-30 **firing for the first time in a real run**: one entry was NEW,
it is in the derived flaky set, it was excluded from the verdict and named in its own
bucket. The green check is green *because* the exclusion worked, and the record says so.

## 2 · ⛔⛔ NO BRANCH PROTECTION, AND NO REQUIRED CHECK — DELIBERATELY

Written into the workflow header, because a rule that lives only in a report is a rule that
lasts until somebody changes a setting:

> **No branch protection or required check while `tools/merge_all.py` pushes master
> directly.**

A required check would block the **31 pushes** the signing session is built on. ⭐
**Promotion means the check's colour is TRUTHFUL, not that it blocks.** Those are two
different decisions and only the first has been taken.

⛔ The suite jobs (`vitest`, `pytest`, `collect_profile`) **keep** `continue-on-error`. They
publish a RECORD, and a red test in a suite with ~85 known-failing pytest entries must not
read as a broken pipeline. The header no longer claims the gate is report-only — it said so
for as long as it was true and not one commit longer.

## 3 · ⚰️ FULL HISTORY — 27 OF 121 FAILURE ENTRIES WERE THE CHECKOUT

Measured on run #27's published record, by pattern over the failure text:

```
entries total: 121   naming a git-object/ref problem: 27  (22%)
   tests.test_discord_render_vintage_url                          13
   src/hub/rule12Paths.test.js                                     4
   src/hub/surfaceMatrixIsCurrent.test.js                          4
   src/components/chart/engine/readout.test.js                     3
   tests.test_alert_taxonomy_scan_membership_change_schema         1
   src/components/chart/engine/__tests__/enumerationSites.test.js  1
   src/components/chart/engine/__tests__/legendFromDefinitions     1
```

⚰️ **A previous session called these "22 STALE TESTS" and proposed rewriting or deleting
them.** Retracted last session and now closed: `4eec5e0aa` is a **live ancestor 292 commits
back**, committed two days earlier, and `git cat-file -e` finds it locally with a
`deadbeefdeadbeef` miss beside it as the positive control. **Nothing was stale — the
checkout was depth-1.**

`fetch-depth: 0` now applies to **every** checkout in this workflow, not just `publish`.

⚠️ **COST, MEASURED BEFORE IT WAS APPLIED ANYWHERE ELSE** — the publish job in run #23:

```
run #22, shallow:  Run actions/checkout@v4   7 s
run #23, depth 0:  Run actions/checkout@v4  13 s      +6 s
```

**+6 s against the 60 s budget E CP25 set.** ⛔ The measurement came first and on one job,
because the twelve pytest shards are the expensive place to be wrong.

## 4 · Files

```
.github/workflows/full-suite-report.yml
   - continue-on-error removed from `gate` (the job only; its artifact-download step keeps
     its own, so "the artifact is missing" is reported by the step that can say WHY)
   - the header's report-only claim replaced with the promotion and the no-protection rule
   - fetch-depth: 0 on all five checkouts
```

## 5 · Validators

```
yaml.safe_load                 OK; gate continue-on-error is None; the suite jobs keep True
every checkout fetch-depth     0, asserted over the parsed document
check_workflow_expressions     exit 0
check_repo_hygiene             clean, no line-ending flip
run #27 (promotion)            gate SUCCESS, NO_NEW_FAILURES, new_flaky 1
```

## 6 · ⚠️ PREDICTION for the next run (recorded before pushing)

| field | prediction |
|---|---|
| FIXED | climbs by **up to 27** — the git-object entries |
| NEW | **0** among those files; full history cannot break a test that needed it |
| verdict | **NO_NEW_FAILURES**, so the promoted gate stays green |
| every checkout's added time | **≤ 60 s** each, on the same measurement as publish's +6 s |

⛔ **If NEW > 0 among those files, full history is not the whole story and this is
REVERTED, not argued with** — the same rule that reverted the shard split within the hour.

## 6b · SCORED — run #28

```
VERDICT: NEW_FAILURES   (run conclusion FAILURE — the promoted gate turned the check red)
new 2 · fixed 28 · unchanged 93 · MISSING 1 · current_ran 44,414
new_flaky 1 · flaky_size 3 · flaky_fixed 3
```

| predicted | actual | |
|---|---|---|
| FIXED climbs by up to 27 | **28** | ✅ |
| NEW 0 **among those files** | **0 among them** | ✅ |
| verdict NO_NEW_FAILURES | **NEW_FAILURES** | ❌ |

⭐ **The FIXED breakdown is the predicted list, name for name:**

```
tests.test_discord_render_vintage_url                          13
src/hub/rule12Paths.test.js                                     4
src/hub/surfaceMatrixIsCurrent.test.js                          4
src/components/chart/engine/readout.test.js                     3
tests.test_alert_taxonomy_scan_membership_change_schema         1
src/components/chart/engine/__tests__/enumerationSites.test.js  1
tests.test_ast_math_parity                                      1   (F-CI-29, closed)
tests.test_ticker_logos_prewarm                                 1
```

### ⛔ THE REVERT CONDITION IS NOT MET, AND ONE NEW ENTRY IS THE CHANGE WORKING

**`tests.test_nb_foreign_commits::test_the_tools_own_self_check_passes`** is NEW, and it is
**caused by this change** — its failure text is full of real commit subjects and
`notebook_files` lists, because **it walks git history**. On a depth-1 clone it had almost
nothing to walk and **was passing vacuously**. ⭐ **Reverting would restore a green that
meant nothing**, which is the exact shape this programme refuses
(`lesson_gate_that_cannot_fail`). It is a test that started working. **F-CI-39.**

**`src/context/AuthContext.test.jsx`** (a 503-refetch assertion, `expected false, received
true`) has nothing to do with clone depth. **F-CI-40**, unclassified.

### ⚠️ AND ONE MISSING, WHICH IS NEVER "FIXED"

**`src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx`** was in the
git-object list and came back **MISSING**, not FIXED — 0 failure entries and not collected.
A test that stops being collected has left coverage, and the diff refuses to count that as
progress. **F-CI-41, owed an investigation**: most likely it now fails at IMPORT rather than
at an assertion, which drops it from the testcase list entirely.

## 7 · Drafted ledger row — NOT written

| 106 | *(this unit's two commits — named in the session report)* | 2026-09-15 | CI | 1 | E CP26: the gate job is promoted — `continue-on-error` removed, so the check's colour is the verdict's colour. The criterion was met by the published record (run #24 NEW_FAILURES, run #25 NO_NEW_FAILURES) and scored on run #27, where `new_flaky: 1` shows F-CI-30 excluding a flaky NEW entry for the first time in a real run. NO branch protection and no required check while merge_all pushes master directly — promotion means the colour is truthful, not that it blocks. And `fetch-depth: 0` on every job: 27 of 121 failure entries (22%) name a git object a depth-1 checkout does not have, which a previous session called 22 stale tests. Cost +6 s, measured on one job first. |

## 8 · Drafted RESUME delta — NOT applied

- ⛔ **Promoting a check and requiring a check are two decisions.** Take the first without
  the second when the merge path cannot honour it, and write that sentence where the
  setting lives.
- ⛔ **A criterion is met by the record or it is not met.** Both verdicts were published
  before this was built; neither was asserted.
- ⭐ **22% of a failure list can be one line of YAML.** Read the failure TEXT before
  proposing to rewrite the tests that produce it.
