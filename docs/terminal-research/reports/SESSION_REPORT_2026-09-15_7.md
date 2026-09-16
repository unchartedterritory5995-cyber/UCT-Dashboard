# SESSION REPORT — 2026-09-15, session 7

**T5b scored and PASSED. E CP29 scored and PASSED. K CP7 built. And the runbook, rewritten
against the tools, exposed eleven commits that would never have reached master.**

---

## 1 · ET, trees, poll log

```
ET start   2026-09-15 21:40 EDT Tue        ET end   2026-09-15 23:48 EDT Tue
docs   terminal-research   606fcd865 -> ea5835c68   (2 commits, not pushed)
code   feat/s7-price-level e703af0a8  PUSHED (origin now e703af0a8)
gate-box lock   PRESENT all session (notebook-k, scripts/gate_shards.py --shards 6, since 20:26)
                -> NO local vitest this session, by rule
manifest   43 rows -> 44      constraints   35 -> 36      UNITS   43 -> 44

CI polled anonymously (no gh CLI on this box; the public API answers)
  #30  5a58d91cf  completed/failure   NEW 1  FIXED 31  MISSING 1  flaky 6   16/16 shards
  #31  e703af0a8  completed/failure   NEW 1  FIXED 34  MISSING 0  flaky 6   16/16 shards
```

⚠️ `gh` is **not installed** on this box. `curl` against `api.github.com` answers
unauthenticated because the repo is public — and *that* is why a token being absent looked
like a capability gap rather than a spelling of the same question.

## 2 · T5b — the shard split, second attempt, SCORED AND PASSED

Run #30 is the first run at `ROOT_BUCKETS = 12`. It tested `5a58d91cf`, which carries
**E CP27 only** — E CP28 and E CP29 were still local. That makes it a *clean* test of the
split: the 12-bucket partition ran on the per-file F-CI-36 fix alone, without the class fix.

**The revert trigger did not fire, and the reason is not an opinion:**

| run | buckets | failures naming `voice_router` / `thesis_reviews` |
|---|---|---|
| **#24** first split attempt, pre-fix | 12 | **41** |
| #25 – #29 | 8 | 0 |
| **#30** second split attempt | **12** | **0** |

⭐ **The instrument is non-vacuous: it sees 41 in #24 and 0 in #30.** Both leak files share
bucket `tests-11` at 12 buckets — resolved from the plan, not assumed — so the isolation
class had its chance and did not take it. tests-11: `11 failed, 1630 passed`, every one of
those 11 already in the baseline.

**The NEW set is byte-identical across the split:**

```
#29 (8 buckets)   NEW ['pytest|tests.test_nb_foreign_commits|test_the_tools_own_self_check_passes[args0-0]']
#30 (12 buckets)  NEW ['pytest|tests.test_nb_foreign_commits|test_the_tools_own_self_check_passes[args0-0]']
```

**Collection did not move at all** — 24,445 on #27, #28, #29 and #30. Not one test lost or
gained by re-partitioning 1,430 files.

### The cap question, and the answer

```
bucket    Run step      bucket    Run step
tests-07     567 s      tests-09     170 s
tests-01     404 s      tests-03     164 s
tests-05     376 s      tests-10     138 s
tests-11     297 s      tests-06     128 s
tests-08     232 s      tests-04     123 s
tests-12     193 s      tests-02      89 s
```

**Worst 567 s against a 1,200 s cap — 633 s of headroom. Nothing within 200 s of its cap, so
no sub-split finding is owed.** And `tests-05`, the bucket that could not print a totals line
at 8 buckets and made run #23 INVALID, came in third at 376 s. **16 of 16 shards reported a
totals line.**

## 3 · ⚠️ E CP27's PREDICTION WAS RIGHT ABOUT SAFETY AND WRONG THREE WAYS, ALL ONE CAUSE

| field | predicted | observed | |
|---|---|---|---|
| every bucket's Run step < 1000 s | yes | **yes**, worst 567 | ✅ |
| worst bucket | **tests-05**, ≈938 s | **tests-07**, 567 s | ❌ value *and* rank |
| MISSING | 0 | 1 | ❌ |
| collected | "unchanged, 24,454" | 24,445, unchanged | ⚠️ right property, wrong figure |
| FLAKY_SIZE ≤ 4 ("3 on run #28") | ≤ 4 | 6 | ❌ |

⭐ **Three of the four misses have one cause: the prediction was anchored to run #28 while
run #29 was the actual predecessor.** `flaky_size` was already 6 at #29 (it moved 3 → 6
before the split, and 6 → 6 across it). `collected` was already 24,445 at #28 — the 24,454
was a transcription slip. MISSING 1 was `legendFromDefinitions`, whose fix (E CP29) was not
in the run.

⛔ **The lesson is narrower than "calibrate better": a prediction must be anchored to the run
it will be SCORED against, not the run it was calibrated on.** Every field the split actually
controlled — NEW, collected, the leak class — moved by exactly zero.

⛔ **And the ranking error is not the calibration's fault.** A uniform worst-case ratio
(2.22) cannot reorder buckets, so the mis-ranking was already in the raw per-test sum:
collection cost is per-FILE and is not proportional to test time. If a future split is sized
by "which bucket is worst", that input was wrong by two places.

## 4 · E CP29 — SCORED, CLEAN SWEEP

Run #31 is the first carrying E CP28 and E CP29. Every predicted field landed:

```
                        predicted        observed
MISSING                 0                0            ✅
file_level_resolved     1 (legendFrom…)  exactly that ✅
verdict                 not COVERAGE_LOST  NEW_FAILURES ✅
coverage_lost           —                []           ✅
the gate's MISSING list names buckets, or prints none  -> missing_buckets {} ✅
```

And E CP28's class fix shows where it should: **FIXED 31 → 34, UNCHANGED 90 → 88, MISSING
1 → 0.** `legendFromDefinitions` resolved to FIXED by shape, exactly as F-CI-41 said it
would.

## 5 · K CP7 — the code repo is an argument, not a place you stand

R3.1's decision is that the first line of each sitting is `cd <the master checkout>`. **That
sentence could not have worked.** `merge_all` resolved its target from `__file__`:

```
cwd = …\s7-price-level   (FEAT)     -> BYTE-IDENTICAL refusal, naming feat/s7-price-level
cwd = …\_merge-master    (MASTER)   -> BYTE-IDENTICAL refusal, naming feat/s7-price-level
```

⛔ **And the remedy was worse than the defect.** It printed
`git -C …\s7-price-level checkout -B merge-run origin/master` — instructing the owner to
move the branch holding this programme's unpushed work and its in-flight CI run onto master.
*A remedy that destroys the checkout it is run from is not a remedy.*

`--code-repo` is now the one authority; the default is unchanged; a typo and a real
directory that is not a work tree are both refused **by name**; every run announces its
target. **13 controls, 3 mutations, every diff by EDIT.**

⚰️ **A second defect, walked into while fixing the first.** Adding K CP7's manifest row left
`UNITS` at 43 against the manifest's 44 — `sign_all` would sign 44 and `merge_all` merge 43,
the 44th approved and silently never merged. The self-check now takes the set difference
**both ways** and names offenders. Mutation 3 replays the exact slip and prints
`['k-cp7-build-record']` — a name, not a count.

## 6 · ⛔⛔ F-SIGN-1 — ELEVEN COMMITS THAT WOULD NEVER HAVE REACHED MASTER

Rewriting the runbook forced its numbers to be re-derived, and the derivation found this:

```
commits ahead of master on feat/s7-price-level : 46
claimed by some UNITS entry                    : 35
⛔ claimed by NO unit                           : 11
```

The eleven are the **entire CI arc of sessions 5–7**: E CP25, E CP26, E CP27, E CP28,
E CP29, plus F-CI-29, F-CI-30, F-CI-32, F-CI-36, the shard-split revert, and the run-#23
scoring commit.

**Cause:** `E CP26`–`E CP29` are recorded in `UNITS` as `[], # docs worktree only`. They are
not docs-only — each has a real commit in the code repo. Four findings-fixes are unattributed
altogether.

⛔ **Run all three sittings today and the session reports success while master receives none
of it.** The 12-bucket split, the override-leak class fix, the COVERAGE_LOST verdict and
`fetch-depth: 0` would all stay on the branch.

⛔ **I did not guess the attribution.** Which unit owns a *revert* (`4feaeb86f`) or a
*scoring* commit (`16027f239`) is a decision about what master should contain. The runbook
carries a four-line snippet that **derives** the list and must print `[]` before Sitting 1.

⭐ K CP7 closed the *membership* half of this (a row in one list and not the other now fails
by name). **This is the other half — a unit that is present and empty — and it is open.**

## 7 · Findings

| id | finding | state |
|---|---|---|
| **F-SIGN-1** | 11 commits ahead of master claimed by no unit; E CP26–29 wrongly marked docs-only. The signing session would land none of the CI work. | **OPEN — owner decision** |
| **F-SIGN-2** | `merge_all` resolved its target from `__file__`, so the runbook's `cd` was inert and its remedy named the feat worktree | **FIXED, K CP7** |
| **F-SIGN-3** | `UNITS` and `sign_manifest.txt` are two hand-maintained lists with nothing comparing them | **FIXED, K CP7** |
| **F-CI-42** | `tools/nb_foreign_commits.py --self-check` asserts a property of the **live repository** (`HEAD..origin/master` is empty), not of the tool. Vacuous on a quiet week, red the moment anyone commits. | **OPEN — Notebook workstream** |
| **F-METHOD-1** | A prediction anchored to the run it was calibrated on, not the run it is scored against. Three of E CP27's four misses. | recorded |
| **F-METHOD-2** | Per-test time sums mis-rank shards: collection cost is per-file and not proportional to test time (predicted worst tests-05, actual tests-07) | recorded |

### ⚠️ A correction to session 6's section H

Section H recorded *"all three approval-reading audits exit 0."* **They do not.**

```
audit_scope_vs_checkpoints  -> exit 1        audit_signature_regexes -> exit 0
verify_doc_shas             -> exit 1
```

**Root cause reproduced:** the measurement was taken as `python tool.py 2>&1 | tail -3`,
which reports **tail's** status. This repo has a standing rule about exactly that trap, and
it cost a false reading in a report. The same trap bit twice more tonight and was caught
both times by measuring the command's own status.

## 8 · H — the historical blank scopes, re-derived on the corrected measurement

H.2's original conclusion rested on "all three audits exit 0", which was false. Re-derived:

- **They are not three blank blocks.** They are three packets each carrying **one** blank
  `SCOPE APPROVED:` — and `s2-command-search` and `intelligence-layer` *also* carry populated
  ones (2 and 3 scope lines respectively). `read_approval` is a **whole-file** verdict that
  goes MALFORMED if any block is blank; `audit_scope_vs_checkpoints` is **per-line** and
  reports the populated ones OK. The two readers never disagreed — they answer about
  different blocks.
- **`audit_scope_vs_checkpoints` exits 1 for a different reason**: 7 signed lines naming no
  checkpoint, across 4 packets (`h14-placeholder-stop-unification`, `intelligence-layer`,
  `s10-presentation-primitives`, `s12-rollout`). Of the three blank-scope packets only
  `intelligence-layer` appears, and for the **numbering** reason the audit itself names —
  *"closed by NUMBERING the packet, not by re-signing it."*
- **No refusal path is affected.** None of the three is in the manifest (44 rows) or in
  `UNITS` (44). `merge_all._cannot_be_signed` *would* refuse a MALFORMED packet with exit 3,
  but it is never asked about these.

⛔ **Verdict: finding only, no code** — per the owner's default, because nothing is broken
today. ⚠️ **The latent trap, stated precisely:** one trailing blank block makes
`read_approval` condemn a whole packet whose other blocks are well-formed. If any of these
three is ever added to the manifest, the merge refuses the lot. That is what LEGACY-BLANK-
SCOPE would fix, and it is not owed while no refusal path is reachable.

## 9 · Product triage — the two NEW from run #28

**I.1 — `tests/test_nb_foreign_commits.py::test_the_tools_own_self_check_passes[args0-0]`
(F-CI-42).** Reproduced locally in 0.83 s. The guard's own `--self-check` has four
fixture-driven rows that pass and a fifth that scans the **live repository**:

```
ok   no foreign commits -> 0            ok   every SAVE_PATH entry is inside the Notebook tree
ok   foreign, not the save path -> 1    FAIL against HEAD..origin/master there is nothing ahead
ok   foreign IN the save path -> 2           got 5 commits by 'Claude Fable 5', want []
```

⭐ **It measures the repository, not the tool.** It passes whenever the range is empty (a
vacuous pass) and fails whenever anyone commits — in neither case is it measuring the guard.
**Owner: the Notebook workstream** (`tools/nb_foreign_commits.py`, last touched by
`c8b38058c fix(notebook): …`), and this branch must not edit it. ⭐ **It is the only NEW
entry on the branch: fix it and the gate reads NO_NEW_FAILURES.**

**I.2 — `AuthContext.test.jsx`.** Not a NEW failure and never was on #29–#31: it is the
sixth member of the **derived** flaky set, counted as `new_flaky 1`. F-CI-30's rule is doing
exactly its job — and `suite_harness_files` (F-CI-37) is holding, because the set stayed at
6 while 41 real failures were available to launder in #24's history and were not.

**I.3 — inventory.** 82 pytest + 9 vitest failures on #30; 90 current entries on #31 against
a 122-entry baseline: 88 unchanged, 34 fixed, 1 new, 1 new-but-flaky, 0 missing. Arithmetic
closes both directions.

## 10 · Merge readiness

```
docs   ea5835c68   2 commits, NOT pushed   (K CP7; the runbook + F-SIGN-1)
code   e703af0a8   PUSHED, origin agrees
manifest 44 rows · 44 sign commands · 0 skipped · 36 constraints, all SATISFIED
merge_all --self-check PASS (13 K CP7 rows)     R3.2 resume control PASS
⛔ NOT READY TO SIGN: F-SIGN-1 is open. Eleven commits are claimed by no unit.
```

⛔ Nothing was merged. Nothing was pushed to master. No deploys, no flag flips, no
wake-ups. The only push this session was the feature branch.

## 11 · Three phone-readable sentences

**The shard split held.** Twelve buckets, worst 567 s against a 1,200 s cap, every bucket
reported a totals line, and the 41-failure isolation class that killed the first attempt
produced **zero** — proved by a grep that still finds all 41 in run #24.

**The COVERAGE_LOST verdict scored a clean sweep** on the first run that carried it: MISSING
0, the repaired suite resolved to FIXED by shape, and the override-leak class fix moved
FIXED from 31 to 34.

**But the signing session is not ready, and the runbook is why we know.** Re-deriving its
numbers found eleven commits — the whole CI arc of the last three sessions — that belong to
no unit and would never have reached master.

## 12 · Status

| | |
|---|---|
| T5b (shard split, 2nd attempt) | ✅ **PASSED**, E CP27 stands, no revert |
| E CP29 (COVERAGE_LOST) | ✅ **PASSED**, every predicted field |
| E CP28 (override-leak class) | ✅ FIXED 31 → 34 |
| K CP7 (the code repo is an argument) | ✅ built, 13 controls, 3 mutations |
| R3.1 (three-sitting runbook) | ✅ rewritten, every number re-derived |
| R3.2 (resume control on `git cherry`) | ✅ PASS — `--is-ancestor` wrong on 2 of 3 |
| H (historical blank scopes) | ✅ finding only, on a corrected measurement |
| I (product triage) | ✅ both classified with evidence |
| **F-SIGN-1** | ⛔ **OPEN — blocks the signing session** |
| **F-CI-42** | ⛔ **OPEN — Notebook workstream; the only NEW on the branch** |

**Next session starts here:** attribute the eleven commits until the runbook's snippet prints
`[]`, then Sitting 1.
