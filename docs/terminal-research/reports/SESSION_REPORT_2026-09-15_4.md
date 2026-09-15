# Session report — 2026-09-15, session 4

**BASELINE-DIFF GATE · THE FLAKE RATE THE GATE MEASURED · PRODUCT TRIAGE · COMMANDS UNPARKED**

---

## 1 · ET, trees, poll log

Start **2026-09-15 15:51 EDT Tue**, end **2026-09-15 16:50 EDT Tue**, both
`python tools/weekly_exec.py et`. Both worktrees `git status --porcelain` → **0** at start and
end. **Gate-box lock: ABSENT** (`C:\ProgramData\uct\gate-box.lock` does not exist); no local
vitest was run.

⛔ **No persistent watcher processes.** Every wait was a bounded poll that returns
(`scratchpad/poll.py <sha> <max-seconds>`), one ET line per poll:

```
run #21  16:00:54 … 16:24:07 ET   (4 bounded calls; 3 × HTTP 504 from the API, retried)
run #22  16:29:25 … 16:48:52 ET   (3 bounded calls)
```

**7 commits** — 4 code (`953142d0b`, `9fa4ee150`, and the two carried in from the previous
session's tail), 3 docs. Nothing signed, nothing merged, nothing pushed to master.

## 2 · Prelude

### P.1 · Condition (a) — F-MERGE-1 CLOSED ✅

Read from the file, not remembered: `packet-a-absent-bound-gate.md` reader state **UNSIGNED —
"1 block awaiting a fingerprint (0 of 1 signed)"**, i.e. **an approval block EXISTS** and is
correctly empty. Manifest **row 1**, `A-CP1`, fingerprint `f6180b3da` — matching.
`GOVERNING_PRINCIPLES.md` §15 present.

> ## ⭐⭐ COMMANDS UNPARKED
> **(a) F-MERGE-1 CLOSED — MET** (this section). **(b) a pytest totals line in the record —
> MET at run #17.** Both stated conditions are satisfied. What the commands now wait on is
> **signing**, which is yours; see §9.

### P.2 · D5 CP2

**Not built, and still not buildable by me.** Unchanged from the last session: the packet's
**signed** block approves CP1 only and says *"CP2-CP7 EACH NEED A NEW LINE"*, and its scope
excludes *"a ledger"* and *"a store touched"* — which is exactly what CP2 creates. A
ready-to-paste approval line is in session 3's report §Q.2b. **STARTABLE remains 0 of 6**;
the blocking edge is unchanged.

### P.3 · E's checkpoint IDs — collision proof, three sources

E's packet table declares **CP1–CP3**. Build records on disk: **CP2, CP4–CP22** at session
start. Manifest rows: the same set. **CP23 and CP24 were free** and are the IDs used.
No ENV fix unit was built (see §5), so no further IDs were taken.

### P.4 · Run #19 — E CP21 scored, line by line

| predicted | actual | |
|---|---|---|
| `LaneUnavailable` entries → **0** | **0** (ENV total 123 → 6) | ✅ |
| pytest `failed` in **60–120** | **85** (from 185) | ✅ |
| `collected` **≥ 24,445** | **24,445** | ✅ |
| `shards_without_totals` / `shards_unreadable` both `[]` | **both `[]`**, 12/12 success | ✅ |
| longest shard **under 1000 s** | **924 s** (`tests-07`) | ✅ |

**Five of five.** Per-shard `npm ci` cost and headroom against the 1200 s cap:

| shard | elapsed | was | npm ci | headroom |
|---|---|---|---|---|
| tests-07 | 924 s | 945 s | 9 s | **276 s** |
| tests-05 | 913 s | 888 s | 7 s | **287 s** |
| tests-01 | 504 s | 470 s | 6 s | 696 s |
| tests-03 | 502 s | 378 s | 8 s | 698 s |
| tests-08 | 420 s | 324 s | 8 s | 780 s |
| tests-04 | 428 s | 361 s | 8 s | 772 s |
| *(the four `dir-*` and tests-02/06)* | 66–255 s | | 7–8 s | ≥ 945 s |

⛔ **No shard is within 200 s of the cap, so no split is owed and none is proposed.**
⭐ The watch item E CP21 stated up front is closed **by measurement**: the warm npm cache
makes the install 6–9 s, not the minutes that would have forced a split.

### P.5 · The inventory against run #19

```
122 entries — 6 environment-shaped, 116 product-shaped
cross-check: 99 pytest lines + 23 vitest headers = 122   ✅
```

| n | suite | kind | bucket |
|---|---|---|---|
| 13 | pytest | PRODUCT | `could not read the base blob: fatal: invalid object name '4eec5e0aa'` |
| 8 | pytest | PRODUCT | `KeyError: 'text_origin'` |
| 8 | pytest | PRODUCT | `TypeError: 'NoneType' object is not subscriptable` |
| 4 | pytest | PRODUCT | `fake_fmp() got an unexpected keyword argument 'timeout'` |
| 4 | vitest | **ENV** | `RULE 12 RAIL CANNOT RUN — no base ref resolved` |
| 4 | vitest | PRODUCT | `shippedLegendChips: could not read d2733adc:…StockChart.jsx via git` |
| 3 | pytest | PRODUCT | `TestFmpIsThePrimaryFiscalSource…<locals>` |
| 3 | pytest | PRODUCT | `stub_services.<locals>.<lambda>() got an unexpected keyword argument 'user'` |
| 3 | pytest | PRODUCT | `assert False is True` |
| 3 | vitest | PRODUCT | `node … fatal: invalid object name 'febe8…'` |

## 3 · G — the baseline-diff gate (E CP23, E CP24)

### G.1 · Semantics

`tools/ci_inventory.py --baseline <run_id> --current <run_id>` keys every entry by
**(suite, classname, name)** and emits **NEW / FIXED / UNCHANGED / MISSING** with counts and
a verdict:

- **INVALID** — current has `shards_success < shards_total`, or non-empty `shards_unreadable`
  / `shards_without_totals` / `shards_missing`, or `collected == 0`, or **no junit readable at
  all** (RAN unknowable), or **a baseline of zero entries**;
- **DID_NOT_RECONCILE** — the counts do not close (the arithmetic is printed either way);
- **NEW_FAILURES** — NEW non-empty;
- else **NO_NEW_FAILURES**. ⛔ **Never the word "green".**

⛔ **MISSING is never counted as FIXED.** The record carries every shard's junit — **24,454
pytest testcases + 19,900 vitest** — so *"did this test run in the current record"* is
answered **exactly**, not inferred from a collected count. Baseline size, current size and
the RAN count are all printed (non-vacuity).

### G.2 · The seven controls, plus seven more

```
1 identical -> NO_NEW_FAILURES, FIXED 0                              ok
2 one added -> NEW_FAILURES, and it is NAMED                         ok
3 one removed that RAN -> FIXED 1                                    ok
4 one removed that did NOT run -> MISSING 1, FIXED stays 0, NAMED    ok
5 a current record with one unreadable shard -> INVALID, field named ok
6 an EMPTY baseline -> INVALID                                       ok
7 a real failure present in BOTH -> UNCHANGED (the pair control)     ok
+ the verdicts do not collapse to one                                ok
+ a clean diff reconciles, and the arithmetic is printed              ok
+ the RAN count is reported                                          ok
+ no junit readable -> INVALID, FIXED cannot be guessed               ok
+ a current dir with NO summary -> INVALID, naming `collected is 0`   ok
+ ...and WITH a summary the same inputs are NO_NEW_FAILURES           ok
+ (inventory) both file shapes parse; a 2-line vitest entry counts 1  ok
```

⛔ **Control 7 is load-bearing**: without it, *"no false NEW"* is satisfied perfectly by a
tool that sees no failures at all.

### G.3 · The workflow

`BASELINE_RUN_ID` is **one constant** at workflow level beside a comment pointing at the tool
— never a copied table. A **diff step** inside `publish` computes the diff, writes
`extract/<run>/diff.json` (so it publishes **with** the record), appends to
`$GITHUB_STEP_SUMMARY` and annotates. ⛔ **That step can never exit non-zero**: E CP17 is this
programme's record of a verification line that destroyed the thing it verified. The job that
**fails** is `gate` (`needs: [publish]`, `if: always()`), which reads the diff artifact and
exits 1 on NEW_FAILURES / INVALID / DID_NOT_RECONCILE / a missing diff.

⚠️ **`continue-on-error: true` sits at the `gate` JOB level.** Promotion is removing that one
line and adding the check to branch protection — a **separate checkpoint**, deliberately not
this one.

**Validators:** `yaml.safe_load` OK (6 jobs; `gate` needs `[publish]`, `if: always()`,
`continue-on-error: true`) · both new step bodies `bash -n` **PARSES** ·
`check_workflow_expressions` exit 0, 22 expressions · `check_repo_hygiene` clean ·
**`actionlint` UNREADABLE-TOOL (not installed)**.

### G.4 · Predictions and scores

**Baseline chosen: `35008710335` (run #19)** — it has `shards_success 12/12` and
`unreadable []`, which is the owner's stated rule.

**The diff that proves the point — baseline #18 → current #19:**

```
NEW 2 · FIXED 129 · UNCHANGED 120 · MISSING 0
baseline 249 = unchanged 120 + fixed 129 + missing 0  |  current 122 = unchanged 120 + new 2
```

⭐ The inventory alone read as *"ten fewer product failures"* (126 → 116). **The diff says
129 FIXED, 0 MISSING, 2 NEW.** That is the argument for a diff rather than a count, in one
line.

**Run #21 — E CP23's prediction: 1 of 5.**

| predicted | actual | |
|---|---|---|
| verdict NO_NEW_FAILURES | **INVALID** | ❌ |
| NEW 0 | 1 | ❌ |
| FIXED 0 | 2 | ❌ |
| MISSING 0 | **0** | ✅ |
| the gate RUNS and reports on the job page | **yes, annotated** | ✅ |

⚠️ The risk I named in the prediction — *"a flaky test would show as NEW"* — is exactly what
happened.

**Run #22 — E CP24's prediction: 4 of 4.**

| predicted | actual | |
|---|---|---|
| **not** INVALID | **NEW_FAILURES** | ✅ |
| NEW 0–3, expected a flapper not a regression | **1**, a *different* test again | ✅ |
| MISSING 0 | **0** | ✅ |
| the arithmetic reconciles | **yes** | ✅ |

⭐ **I deliberately declined to predict the verdict itself**, on the grounds that the flake
measurement made it a coin-toss — *"a point prediction here would be a claim about noise."*
That was right.

**diff.json, both runs:**

```
#21  INVALID          new 1 · fixed 2 · unchanged 120 · missing 0 · current_ran 44353
     invalid_because: current: collected is 0 — the suite did not run
#22  NEW_FAILURES     new 1 · fixed 1 · unchanged 121 · missing 0 · current_ran 44353
     NEW   vitest|src/pages/screener/ScreensManager.test.jsx|a second attempt replaces the
           previous refusal rather than stacking one under it
     FIXED pytest|tests.test_mutation_check.TestVerdicts|test_expect_red_naming_the_right_test_passes
```

### ⛔ The INVALID was mine, and it failed closed

`current: collected is 0` — for a run that collected **24,445**. `extract/<run>/` is **not a
record yet**: `summary.json` is written into it by the **publish** step, which runs *after*
the diff step. ⭐ It took one read because the tool **named the field** and because
`current_ran: 44353` in the same JSON proved the junits had been read perfectly. Fixed in
E CP24 and controlled three ways, the third being that the **same inputs with a summary** are
`NO_NEW_FAILURES` — otherwise the check is satisfied by a function that always returns
INVALID.

### G.5 · E's promotion criterion — rewritten, original struck through

The packet now carries:

> ~~≥1 **GREEN** run and ≥1 **RED** run recorded in the ledger.~~
>
> ⛔ **A GREEN RUN WAS NEVER GOING TO ARRIVE.** …**PROMOTION CRITERION, restated so it CAN be
> met:** the baseline-diff job has produced **`NO_NEW_FAILURES` on ≥1 run** and
> **`NEW_FAILURES` on ≥1 run** — a deliberate mutation run counts — **both present in the
> record**. ⛔ `INVALID` and `DID_NOT_RECONCILE` count as neither.

`packet-e-ci-gap-gate.md` re-fingerprinted `beeffe8e6` → `fdfc697ce`; the packet is unsigned,
so nothing historical was destroyed.

### ⛔ PROMOTION-CRITERION: HALF MET, and the mutation run was not needed

**`NEW_FAILURES` is in the record — run #22**, with the failing test named. ⭐ **A deliberate
mutation run would have proved the same thing less cheaply**, so it was not run: the criterion
asks for the verdict in the record, and the record has it.

**`NO_NEW_FAILURES` is not yet in the record**, and §4's flake finding is why — see OPEN
QUESTIONS 1. **PROMOTION-CRITERION-MET: NO.**

## 4 · ⚠️⚠️ THE GATE MEASURED THE SUITE'S FLAKE RATE ON ITS FIRST RUNS

Between runs with **no change to any test**, tests changed state anyway:

| diff | NEW | FIXED |
|---|---|---|
| #18 → #19 | `test_ast_math_parity::test_the_two_lanes_agree_everywhere`, `test_ticker_logos_prewarm::…` | 129 (the CP21 fix) |
| #19 → #21 | `test_massive_ws_stop::test_stop_sends_close_frame_and_joins` | `test_mutation_check.TestRestoreGuarantee::…`, `test_ticker_logos_prewarm::…` |
| #19 → #22 | `ScreensManager.test.jsx::a second attempt replaces the previous refusal…` | `test_mutation_check.TestVerdicts::…` |

⭐ `test_ticker_logos_prewarm` appears as **NEW in one diff and FIXED in the next** — it flaps
both ways. The flappers span **both suites**. Rate: **1–3 per run**.

⛔⛔ **A strict "any NEW → fail" gate therefore fires on noise most runs, and a gate that
cries wolf is muted inside a week** — `lesson_a_monitor_grading_a_population_that_cannot_answer`.
**Filed as F-CI-30, not fixed**: a flake policy is a design decision, not an implementation
detail. Three candidates are in OPEN QUESTIONS.

⭐ **The gate earned its keep on its first run** by measuring the very thing that decides
whether it can ever be promoted.

## 5 · T — product triage by bucket

**Buckets classified: 10 of 10 with ≥3 entries** (run #19's record).

| n | bucket | classification | evidence |
|---|---|---|---|
| 13 | `could not read the base blob: invalid object name '4eec5e0aa'` | ⛔ **STALE-TEST** | `4eec5e0aa` **does not exist** in this repository (`git cat-file -e` fails); the repo is **not shallow** (12,763 commits); the SHA is a **literal** in `tests/test_discord_render_vintage_url.py` |
| 4 | `shippedLegendChips: could not read d2733adc:…StockChart.jsx via git` | ⛔ **STALE-TEST** | `d2733adc` absent; literal in `nativeRegistry.js` + `readout.test.js` |
| 3 | `node … fatal: invalid object name 'febe8…'` | ⛔ **STALE-TEST** | `febe8ee67` absent; literal in `test_deploy_watch.py` + `HubRoot.jsx` |
| 1 | `computeNamesAt: … at 084eeded` | ⛔ **STALE-TEST** | `084eeded` absent; literal in `enumerationSites.test.js` + `StockChart.jsx` |
| 4+1 | `RULE 12 RAIL CANNOT RUN` / `merge-base HEAD origin/master` | **ENV** (already classified) | needs `origin/master`, which a single-branch checkout does not have |
| 8 | `KeyError: 'text_origin'` | **REAL-REGRESSION or STALE-TEST — UNREADABLE without reading the test** | all in `tests/test_web_capture_coverage.py::TestCoverageInTheEnvelope`; the key **is** produced at `api/services/journal_two/ask_evidence.py:213`, so the feature exists |
| 8 | `TypeError: 'NoneType' object is not subscriptable` | **UNREADABLE** pending a read | all in `tests/test_screener_wave2_analyst_store.py` (one file) |
| 4 | `fake_fmp() got an unexpected keyword argument 'timeout'` | **STALE-TEST (probable)** | a test double whose signature no longer matches its caller — the classic stale-stub shape |
| 3 | `stub_services.<locals>.<lambda>() … keyword argument 'user'` | **STALE-TEST (probable)** | same shape, `tests/test_scan_screener_auth.py` |
| 3 | `assert False is True` | **UNREADABLE** pending a read | `tests/test_document_ocr.py` |
| 1 | `assert '/data/patterns.db' == '/home/runner…'` | ⛔ **STALE-TEST** | see V.3 |

### ⭐⭐ The finding that inverted my own hypothesis

**22 entries name a git object the checkout does not have**, and the obvious move was to add
an ENV signature for `invalid object name`. ⛔ **That would have misfiled 22 real stale tests
as "environment"** — the exact failure direction `ci_inventory` was designed to avoid.

The check that settled it took one command: **the repository is not shallow, and none of the
four cited SHAs exist in it.** ⭐ **These tests fail on a complete checkout too.** They are
stale, not environmental.

### T.2 · Signatures added: **NONE**, and that is the finding

No ENV-MISFILED bucket was found. The one family that looked like it — the git-object
group — is **STALE-TEST**, proved above. ⛔ **`ci_inventory`'s signature table is unchanged,
deliberately.** ENV/PRODUCT counts before and after: **6 / 116 → 6 / 116.**

### T.3 · Fix units: **NONE**

⛔ **No bucket met the owner's bar** — *"a one-file cause AND covered by behavioural tests
already in the suite"*. The two single-file candidates (`text_origin`, `NoneType`) are
**UNREADABLE without reading the tests**, and classifying them by their message alone is the
mistake §5's headline finding exists to warn against. **Triage delivered; fixes deliberately
withheld.**

## 6 · V — remaining ENV signatures

**V.1 · `MODULE_NOT_FOUND` / node loader — 0 remaining.** E CP21's `npm ci` closed it
entirely (11 → 0). **Finding only, no unit owed.**

**V.2 · Shallow-checkout git ref — 5 entries, and the cost is NOT bounded.** Two families:
`tests/test_alert_taxonomy_scan_membership_change_schema.py:563` runs
`git merge-base HEAD origin/master` and asserts *"could not resolve the merge-base — the check
is broken, not green"*; `src/hub/rule12Paths.test.js` needs a base ref for its non-vacuity
control. ⛔ Both **fail closed by design**, which is right. But `merge-base` needs **common
history**, so a depth-1 fetch of `master` does not satisfy it — only `fetch-depth: 0`, a full
clone, does. The owner's rule is *"fetch-depth for the specific need, not 0 by default"*, and
**there is no bounded fetch that satisfies a merge-base**. **FINDING, no unit** — the decision
is whether a full clone is worth 5 entries.

**V.3 · `/data`-only path — 1 entry, STALE-TEST.** `tests/pattern_engine/test_pattern_db_shared_root_guard.py:111`
asserts `pattern_db._db_path() == os.path.abspath(r"C:\data\patterns.db")` — a **Windows
literal**, which on Linux resolves to `/home/runner/…/C:\data\patterns.db`. ⭐ It encodes the
dev box's **platform**, not merely a path. Rewrite-or-delete is owed (derive the expected root
from the same helper the guard uses — `conftest.shared_data_root_census`), but it is a real
change to another workstream's rail. **FINDING, no unit this session.**

## 7 · Findings

| id | one line |
|---|---|
| **F-CI-28** | **NEW.** `extract/<run>/` is not a record until publish writes `summary.json`; the diff read it as `collected is 0`. Failed closed, named the field. **CLOSED by E CP24.** |
| **F-CI-29** | **NEW.** Two failures newly revealed by E CP21's install — `test_ast_math_parity::test_the_two_lanes_agree_everywhere` (a JS-lane **parity** test that could not run before) and `test_ticker_logos_prewarm::…`. Filed **before** being baselined so the baseline forgives nothing silently. |
| **F-CI-30** | **NEW, and it gates promotion.** 1–3 tests change state per run with no code change, across both suites; `test_ticker_logos_prewarm` flaps both ways. A strict any-NEW gate fires on noise and will be muted. **Flake policy owed before promotion.** |
| **F-CI-31** | **NEW.** 22 failure entries cite **git objects that do not exist in this repository**, which is not shallow. They are **STALE TESTS** citing dead SHAs hard-coded in tests *and* source, and they fail on a complete checkout too. |
| **F-CI-32** | **NEW.** `merge-base`-based rails need `fetch-depth: 0`; **no bounded fetch satisfies a merge-base**. 5 entries. Decision, not a defect. |
| **F-CI-33** | **NEW.** `test_pattern_db_shared_root_guard` asserts a Windows literal and so encodes the dev box's platform. Rewrite-or-delete owed. |
| **F-CI-27** | **CLOSED.** The JS lane: 119 ENV entries → 6; `LaneUnavailable` 109 → 0. |
| **F-CI-20 / F-CI-21** | **CLOSED by run #19** — `shards_without_totals: []`, all twelve report. |

**Retractions:** none this session. ⭐ One was **avoided**: the `invalid object name` ENV
signature (§5) would have been a confident wrong classification of 22 stale tests.

## 8 · OPEN QUESTIONS

1. ⛔ **Flake policy (F-CI-30) — the one that gates promotion.** (a) **re-run the NEW set
   once** before declaring — standard, costs one short re-run; (b) **a known-flaky list** —
   drifts like every hand-kept list and needs its own rail; (c) **require NEW to persist
   across two consecutive runs** — no re-run cost, one run of latency, cannot be gamed by a
   list. **My recommendation: (c)**, because it needs no maintained artifact and this
   programme's recurring defect is the hand-kept list.
2. **22 stale tests citing dead SHAs (F-CI-31)** — rewrite to derive the commit, or delete
   the assertions? They are spread over ≥4 files and two workstreams.
3. **`fetch-depth: 0` for 5 entries (F-CI-32)** — worth a full clone on every run, or leave
   those rails INCONCLUSIVE in CI and rely on local runs?
4. **D5 CP2 still NOT AUTHORIZED** — the approval line from session 3 §Q.2b, or "drop it".
5. Carried: E's table does not list CP4–CP24; `actionlint` not installed; T2 CP1 has no parent
   packet; `entity-master-pre-implementation-gate.md` has no approval block.

## 9 · [KEYBOARD]

```
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt
```

## ⭐⭐ UNPARKED

**(a) F-MERGE-1 CLOSED — MET** (§P.1, read from the file). **(b) a pytest totals line in the
record — MET at run #17.** ⛔ **Both stated conditions are satisfied and the park is lifted.**

⚠️ **They still will not do anything useful yet, and the reason is not the park.** All **36**
manifest rows read **UNSIGNED**; `merge_all --dry-run` stops at the first unit with *"WOULD
STOP HERE: UNSIGNED"*. **Signing is yours** — the approval blocks are yours to fill — and a
master merge additionally needs an explicit deploy instruction and a member-impact paragraph.

**36 units waiting.** Manifest table (row · packet · CP · fingerprint · reader · merges-after)
is in this file's appendix; the first five rows and the count are on the terminal.

**Production impact, grouped:**

- **Rows 1–35 — docs, instruments and tests only. Nothing member-visible.** (35 units.)
- **Row 36 — `s2-accelerator-chord`** — the one member-visible unit: Ctrl/Cmd/Alt+Shift+F
  stops silently flagging tickers on three screens. `merge_all` **stops before it** unless
  `--include-member-visible` is passed.

## 10 · Merge readiness

**36 rows, 36 OK, 0 STALE. 35 of 35 commits mapped.** `verify_manifest --check-commits`
exit 0. `merge_all --dry-run` exit 0, **28 constraints SATISFIED**, 36 units, 0 MALFORMED,
0 UNSIGNABLE. Cherry-pick proof: every unit's commit is claimed by exactly one row and every
commit in `origin/master..feat/s7-price-level` is claimed. Reader exit codes:
`sign_gate --read-check` 0, `sign_gate --self-check` 0.

⛔ **Not ready to merge** — every row is UNSIGNED, and that is now the *only* thing in the way.

## 11 · Three phone-readable sentences

**The test system can now tell you the only thing that matters — "is anything broken that
was not broken before?" — instead of a number that was never going to reach zero; it answers
against a named earlier run, and it says so on the run's own page without needing a login.**

**The first thing it measured was that about two tests a run change their mind with no code
change at all, which means a checker that shouts at the first new failure would be shouting
at noise within a week — so it is deliberately not switched on to block anything yet, and
choosing how to handle that is the one decision I need from you.**

**Everything on the branch — thirty-six pieces of work — is now waiting only on your
signatures; both conditions I was told to wait for are met, and the one change a member would
notice is still held back behind its own switch.**

## 12 · Status

`STATUS: RAN`

---

## Appendix — the manifest, all 36 rows

Produced by `python tools/verify_manifest.py` (rows 63–98 of the file listing). Every row
reads **UNSIGNED**; **0 MALFORMED**; **0 STALE**.

| row | file | CP | fingerprint |
|---|---|---|---|
| 1 | `packet-a-absent-bound-gate.md` | A-CP1 | `f6180b3da` |
| 2 | `packet-c-instrument-and-claudemd-gate.md` | CP1,CP2 | `c443515eb` |
| 3 | `packet-d-nav-tabs-gate.md` | CP1,CP2 | `e279c828c` |
| 4 | `packet-b-schema-resolution-gate.md` | CP1,CP2,CP3 | `a03e0cbf5` |
| 5 | `packet-v-multi-volume-gate.md` | CP4 | `f94d7addc` |
| 6 | `s4-cp2-build-record.md` | CP2 | `21d6ad3e8` |
| 7 | `packet-e-ci-gap-gate.md` | CP1 | `fdfc697ce` |
| 8–29 | `e-cp2` … `e-cp22-build-record.md` | CP2, CP4–CP22 | *(see `tools/sign_manifest.txt`)* |
| 30 | `e-cp23-build-record.md` | CP23 | `e35593e5d` |
| 31 | `e-cp24-build-record.md` | CP24 | `c9904433a` |
| 32 | `t2-cp1-build-record.md` | T2-CP1 | `42eafe314` |
| 33 | `packet-k-two-command-signing-gate.md` | CP1,CP2 | `36179a330` |
| 34 | `k-cp3` / `k-cp4-build-record.md` | CP3, CP4 | `ba5e34e79`, `35237823c` |
| 35 | `packet-t-stale-test-gate.md` · `d3-cp2-build-record.md` | T-CP1, CP2 | `5179b2890`, `f7e851d58` |
| 36 | `s2-accelerator-chord-pre-implementation-gate.md` | CP1 | `72cda4cda` |

⛔ **The file `tools/sign_manifest.txt` is the authority**; this table is a reading of it and
is regenerated, never hand-maintained.
