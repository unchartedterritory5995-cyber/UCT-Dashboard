# Session report — 2026-09-15, session 2

**CONCLUSION-KEYED FLAG · SHARDED BACKEND SUITE · COLLECTION PROFILE · QUEUE READINESS**

---

## 1 · ET and trees

Start **2026-09-15 04:34 EDT Tue**, end below, both `python tools/weekly_exec.py et`. Both
worktrees `git status --porcelain` → **0** at start and end.

**6 commits** — four docs worktree, two code worktree (`c619ac82c`, `0d7c55fb1`, both
pushed to `feat/s7-price-level`). Nothing signed, nothing merged, nothing pushed to master.

## 2 · Prelude

**P.1 — F-MERGE-1 is CLOSED.** Confirmed from the file: `SESSION_REPORT_2026-09-15_1.md`
§6 records it closed; Packet A holds **manifest row 1**, `A-CP1`, fingerprint `f6180b3da`,
reader state **UNSIGNED**, `merges-after: none`. The mechanism is a standing rule at
`GOVERNING_PRINCIPLES.md` §15.

**P.2 — queue audit: BUILDABLE 6 · NEEDS-REWORD 2 · UNBUILDABLE 1 · NOT-AN-ASSERTION 4.**
BUILDABLE in §0.7 order with dependencies: **D5 CP3** ←D5 CP2 · **D5 CP5** ←D5 CP2,D5 CP3 ·
**D5 CP6** ←D5 CP5 · **D5 CP7** ←D5 CP4 · **S6 CP3** ←S6 CP2 · **S6 CP4** ←S6 CP2.

**P.3 — vitest: ENV 13 · KNOWN-RED 1 · REAL 5 · STALE-TEST 0 · UNREADABLE 0.** The five
REAL files: `hooks/pollingSites.rail.test.js`, `styles/tapFloor.test.js`,
`surfaces/manifest.test.js`, `breadth/heatmapRegistry.golden.test.js`,
`chart/engine/ast/manifestProse.test.js`.

**P.4 — collision proof, and the rule needed a second half.** E's table declares
**CP1, CP2, CP3**. On that alone CP4 looks free — **it is not**: `e-cp4-build-record.md`
exists and holds manifest row 15. ⭐ **Grep the table AND the build records AND the
manifest.** A checkpoint with a build record but no table row is invisible to a table-only
check — the same blindness that produced the E CP2 and K CP2 collisions, one level along.
**Used below: CP5 and CP6.** ⚠️ E's table still does not list CP4 (OPEN QUESTION).

## 3 · E5 — outcome comes from the runner (E CP5, `c619ac82c`, row 17)

### Deleted, verbatim

```python
_OOM = re.compile(r"(Killed|out of memory|OOMKilled|exit code 137|MemoryError)", re.I)
_TIMEOUT = re.compile(r"(timed out|timeout|The operation was canceled)", re.I)
           "oom_or_timeout": bool(_OOM.search(text) or _TIMEOUT.search(text)),
    out["ok"] = bool(out["totals_line_found"] and out["collected"] > 0
                     and not out["oom_or_timeout"])
    s = summarize("pytest", "Killed\n")
    show("OOM is detected and is never ok", (s["oom_or_timeout"], s["ok"]), (True, False))
```

⛔ **Deleted, not patched** — the flag was wrong in both directions (true for two suites
that completed, false for a job cancelled at its cap), and no regex fixes that because the
fact was never in the text.

### The fields, and the derivation

`job_result` ← `needs.<job>.result` · `test_step_outcome` ← the `Run` step's **`outcome`**
(not `conclusion`: `continue-on-error` rewrites that to `success`) · `elapsed_s` ← the run's
`jobs` API · plus:

```
timed_out == (job_result == "cancelled") AND (elapsed_s >= timeout_minutes*60 - 60)
```

⭐ **The one-minute slack is the whole point:** a job the RUNNER cut at its cap and a job a
HUMAN cancelled early both report `cancelled`. Run #4's real shape — `elapsed_s=2716,
cap_s=2700, threshold_s=2640` — reads TIMED OUT; the same result at three minutes does not.
`timed_out_basis` carries both numbers as a sentence.

`ok` now = `totals_line_found AND collected > 0 AND job_result == "success" AND failed == 0`.
⚠️ `collected > 0` kept beyond the commissioned three — dropping it re-admits run #3's
`collected: 2` of 481.

### Controls — 16 across five job shapes plus empty, exit 0

All pass (full output in the build record). The two that matter: **`CANCELLED AT CAP →
timed_out True`** and **`EMPTY jobs JSON → timed_out UNREADABLE, never False`**.

### ⚰️ The non-vacuity control was itself wrong

Its first version varied only `needs_result` while holding elapsed at 20 minutes against a
45-minute cap — **where every correct answer is `False`**. It demanded a spread a correct
implementation must not produce, and the only way to pass it was to delete the elapsed
comparison: the one thing separating a cap cut from a human cancel.

⭐ **A control that fails a correct implementation is a defect in the control.** Fixed to
vary what discriminates (`success@20m`, `cancelled@cap`, `cancelled@3m`, `no-job`) and to
assert all three values appear. **Recorded because the tempting move was to weaken the code.**

### Prediction for run #5 — written before pushing

| field | vitest | pytest |
|---|---|---|
| `job_result` | success | **cancelled** |
| `timed_out` | false | **true** ← read `false` on run #4 |
| `totals_line_found` | true | false |
| `ok` | false | false |

**SCORE: see §3b.**

## 3b · Run #5 — scored

*(filled below once published; UNREADABLE-PENDING otherwise)*

## 4 · E6 — the backend suite is split (E CP6, `0d7c55fb1`, row 18)

### `gate_shards.py` is NOT the shard source — positive proof, not an absence

| needle | code hits (comments stripped) |
|---|---|
| `pytest` | **0** |
| `tests/` | **0** |
| `APP` (`repo/app`) | 4, incl. `(APP / "src").rglob(...)` |
| `vitest` | 3, incl. `npx vitest run --shard={index}/{shards}` |

It is the **frontend** gate. ⚠️ **The comment-strip proved nothing here** — `pytest` appears
**0** times even raw, so there was no prose occurrence to exclude. The proof is the vitest
invocation.

**And the fallback does not balance:** `(root) 1248 · pattern_engine 136 · api 26 ·
theme_curation 13 · theme_engine 7` — **87% of the tree is loose in `tests/`**.

### The partition, proved

```
dir-api 26 · dir-pattern_engine 136 · dir-theme_curation 13 · dir-theme_engine 7
tests-01 … tests-08 @ 156 each

shards 12 · files_total 1430 · files_in_shards 1430 · sum_of_shard_sizes 1430
is_partition True · largest_shard ('tests-01', 156) = 10.9%
```

⛔ **A shard plan that is not a partition is worse than no sharding** — a file in two shards
runs twice, a file in **none** is silently never tested, and the second is indistinguishable
from a pass. Mutation-proved both ways: a plan **missing** one file is refused, a plan
**duplicating** one is refused. ⭐ The `plan` job runs `--self-check` **before** emitting the
matrix, so an unprovable partition stops the run.

### Caps came DOWN

**45 → 20 minutes per shard**, plus `--timeout=120 --timeout-method=thread`
(`pytest-timeout==2.4.0`, **already in `requirements.txt`** — cited, not added). Without it
one hung test eats its shard's whole 20 minutes and the shard reports nothing: run #4's
shape, one level down.

### The aggregator refuses to let an absence read as zero

⛔⛔ **Sharding's dangerous arithmetic is `sum()`.** A shard that never reported contributes
0 collected and 0 failed. `ok` = every shard succeeded AND every shard has a totals line AND
`failed == 0` AND no shard missing.

⭐ **Shard results come from the RUNNER via the jobs API**, not from a file each shard writes
about itself — **a shard cancelled at its cap may never reach its own final step**, so a
self-reported outcome is precisely the evidence that vanishes when it matters.

**Controls — four shapes plus empty, exit 0:**

```
[all success]       {"shards_total":3,"shards_success":3,"collected":300,"failed":0,"ok":true}
[one cancelled]     {"shards_cancelled":1,"shards_without_totals":["s2"],"collected":200,"ok":false}
[one missing]       {"shards_total":3,"shards_reported":2,"shards_missing":["s2"],"collected":200,"ok":false}
[per-test timeouts] {"per_test_timeouts":2,"failed":2,"ok":false}
EMPTY → ok false, basis says UNREADABLE
```

The **one missing** row is the point: `collected` is 200 rather than 300 **and the shard is
NAMED**, instead of a tidy 200 that reads as a smaller suite.

### Prediction for run #6 — written before pushing

| field | prediction | basis |
|---|---|---|
| `shards_total` | 12 | the proved partition |
| longest shard | 8–14 min, under the cap | run #4 did the whole tree in >2,671 s; largest shard is 10.9% |
| `collected` | thousands, ≫ 2 | ⚠️ the only anchor is 1,430 **files**; the test count has never been measured |
| `per_test_timeouts` | 0 or small | ⚠️ **LOW CONFIDENCE, declared** — E7's profile had not landed, so there is no basis for naming which directories hang |
| `shards_missing` | `[]` | |
| `ok` | false | real failures exist |
| first totals line in CI history | yes | the headline if it appears |

**SCORE: see §4b.**

## 4b · Run #6 — scored

*(filled below once published; UNREADABLE-PENDING otherwise)*

## 5 · E7 — collection profile

A second matrix: `tests/api`, `tests/pattern_engine`, `tests/theme_curation`,
`tests/theme_engine`, and **`tests`** (the whole tree), each
`/usr/bin/time -v pytest --collect-only -q <dir>` capped at **10 minutes**, reduced to
`dir | collected | seconds | rss_mb | result` and aggregated into
`results/<run>/collect_profile.json`.

⭐ **Every OOM this repository has recorded happened at COLLECTION**, not during tests —
18 GB for `pytest tests/` and **6.6 GB for `--collect-only` alone** — and nobody has ever
attributed that to a directory. Including the whole tree is deliberate: *"does collection
alone fit in ten minutes?"* is the question the 18 GB warning raises, and a cap hit answers
it. ⚠️ A capped directory records `collected: null`, **never 0**.

13 controls pass, including `a capped dir has collected None, NOT 0` and
`aggregate NAMES the unmeasured`.

**Results: see §5b.**

## 5b · Profile results

*(filled below once published; UNREADABLE-PENDING otherwise)*

## 6 · Q — the BUILDABLE list is 6 and the STARTABLE list is 0

| unit | verdict | deps | deps built? | STARTABLE |
|---|---|---|---|---|
| D5 CP3 | BUILDABLE | D5 CP2 | no | **NO** |
| D5 CP5 | BUILDABLE | D5 CP2, D5 CP3 | no | **NO** |
| D5 CP6 | BUILDABLE | D5 CP5 | no | **NO** |
| D5 CP7 | BUILDABLE | D5 CP4 | no | **NO** |
| S6 CP3 | BUILDABLE | S6 CP2 | **UNBUILDABLE** | **NO** |
| S6 CP4 | BUILDABLE | S6 CP2 | **UNBUILDABLE** | **NO** |

⛔ **No unit was built, and the reason is a measurement rather than a shortage of time.**

⭐ **F-Q-1 — BUILDABLE ≠ STARTABLE, and the audit only measured the first.** Last session's
verdicts asked *"do this assertion's own nouns resolve?"*. They did, for six units. But
every one of those six sits downstream of a unit that is **not built** — and two sit
downstream of `S6 CP2`, which is **UNBUILDABLE** (F-S6-1). **A readiness list that ignores
dependencies will hand you a unit you cannot start**, and the instruction "take the first
BUILDABLE unit" would have done exactly that.

**The audit needs a second axis:** `STARTABLE = BUILDABLE AND every merges-after satisfied`.
Q.3's dependency map already holds the data; nothing derived it into a verdict.

⚠️ **The true unblocked root is `D5 CP2`** — it has no dependency, and its NEEDS-REWORD was
**applied last session** (the count dropped from the assertion). Building it would unblock
D5 CP3 → CP5 → CP6. **It is not on the BUILDABLE list this session was pointed at**, so it
was not built. **OPEN QUESTION.**

## 7 · Instrument self-reference, and prediction scores

| instrument | reported on itself |
|---|---|
| `ci_outcome` non-vacuity control | ⚰️ **failed a correct implementation.** The control was wrong; fixing the code to satisfy it would have deleted the cap-vs-human discrimination |
| `pytest_shards` | its mutation controls refuse a plan that is missing or duplicating a file — the check can fail |
| `ci_aggregate` | built entirely around refusing its own `sum()` |
| the comment-strip (twice) | ⚠️ proved **nothing** on `gate_shards.py` — the needle appears 0 times even raw. Said plainly rather than presented as rigour |
| `collect_profile_dirs` | records a capped directory as `null`, never 0 |

**Prediction scores — E5: see §3b. E6: see §4b.**

## 8 · Findings filed

| id | one line |
|---|---|
| **F-CI-3** | **CLOSED by E CP5.** The text-keyed flag is deleted and replaced with runner-sourced fields. |
| **F-CI-5** | **ADDRESSED by E CP6**, not by raising the cap: 45 → 20 min across a proved 12-shard partition. |
| **F-Q-1** | **NEW.** BUILDABLE ≠ STARTABLE. All six BUILDABLE units are blocked by unbuilt dependencies; the audit measured premise resolution only. |
| **F-CI-4** | still open — shallow `actions/checkout`, one line (`fetch-depth: 0`), not built. |
| **F-SIGN-2** | still open — `entity-master-pre-implementation-gate.md` has no approval block. |

**Corrections this session:** the `ci_outcome` non-vacuity control (above); and
`ci_summarize.py`'s docstring, which still asserted a run was UNREADABLE without `gh` or a
token (**F-CI-2**) — corrected in place, with the genuine 403 on the *log* endpoint stated.

## 9 · [KEYBOARD] — the two commands

```
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt
```

**Condition (a) F-MERGE-1 CLOSED — MET**, confirmed from the file (§2, P.1).
**Condition (b) pytest has produced a totals line in CI at least once — see §4b.**

| row | packet | CP | fingerprint | reader | merges-after |
|---|---|---|---|---|---|
| 1 | packet-a-absent-bound-gate | A-CP1 | `f6180b3da` | UNSIGNED | none |
| 2 | packet-c-instrument-and-claudemd-gate | CP1,CP2 | `c443515eb` | UNSIGNED | — |
| 3 | packet-d-nav-tabs-gate | CP1,CP2 | `e279c828c` | UNSIGNED | C |
| 4 | packet-b-schema-resolution-gate | CP1,CP2,CP3 | `a03e0cbf5` | UNSIGNED | — |
| 5 | packet-v-multi-volume-gate | CP4 | `f94d7addc` | UNSIGNED | B |
| 6 | s4-cp2-build-record | CP2 | `21d6ad3e8` | UNSIGNED | — |
| 7 | packet-e-ci-gap-gate | CP1 | `beeffe8e6` | UNSIGNED | — |
| 8 | e-cp2-build-record | CP2 | `00eecb391` | UNSIGNED | E CP1 |
| 9 | e-cp4-build-record | CP4 | `fcb2dd9b1` | UNSIGNED | E CP2 |
| 10 | e-cp5-build-record | CP5 | `789e35efd` | UNSIGNED | E CP4 |
| 11 | e-cp6-build-record | CP6 | `0052e2ac6` | UNSIGNED | E CP5 |
| 12 | t2-cp1-build-record | T2-CP1 | `42eafe314` | UNSIGNED | E CP4 |
| 13 | packet-k-two-command-signing-gate | CP1,CP2 | `36179a330` | UNSIGNED | — |
| 14 | k-cp3-build-record | CP3 | `ba5e34e79` | UNSIGNED | K CP2 |
| 15 | k-cp4-build-record | CP4 | `35237823c` | UNSIGNED | K CP3 |
| 16 | packet-t-stale-test-gate | T-CP1 | `5179b2890` | UNSIGNED | — |
| 17 | d3-cp2-build-record | CP2 | `f7e851d58` | UNSIGNED | — |
| 18 | s2-accelerator-chord-…-gate | CP1 | `72cda4cda` | UNSIGNED | last |

**Production impact: rows 1–17 → nothing member-visible.** Row 18 →
Ctrl/Cmd/Alt+Shift+F stops silently flagging tickers on three screens; plain Shift+F
unchanged. **This session merged and deployed nothing.**

## 10 · Merge readiness

**18 rows, 18 OK, 0 STALE. 17 of 17 commits mapped. `verify_manifest --check-commits`
exit 0.** `sign_gate --read-check` 0 · `--self-check` 0 · `ci_outcome --self-check` 0 ·
`ci_aggregate --self-check` 0 · `pytest_shards --self-check` 0 ·
`collect_profile_dirs --self-check` 0.

**`merge_all --dry-run` exit 0** — 10 constraints all SATISFIED, 18 units, 0 MALFORMED,
0 UNSIGNABLE, stopping at the member-visible unit. **`sign_all --dry-run` exit 0** — 18
sign commands. Cherry-pick cleanliness was proven per unit when each commit landed; no
unit's file set changed this session.

⛔ **Not ready to merge.** The branch's CI has never been green and the backend suite has
never produced a totals line.

## 11 · Three phone-readable sentences

**The flag that was supposed to tell us when a test run had been cut short has been deleted
rather than repaired — it was wrong in both directions — and replaced by asking the build
service directly what happened to the job.**

**The backend test suite is now split into twelve pieces that together cover every one of
its 1,430 files exactly once, each given twenty minutes instead of the whole suite getting
forty-five, and a single test that hangs now fails by name instead of silently taking its
whole piece down.**

**Nothing new was built from the work queue, and that is a finding rather than a shortfall:
all six items that looked ready depend on something that has not been built yet, so "ready"
had been measuring the wrong thing.**

## 12 · Status

`STATUS: RAN`
