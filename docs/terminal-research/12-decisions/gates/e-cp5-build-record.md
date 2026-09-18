---
id: e-cp5-build-record
unit: E CP5
packet: packet-e-ci-gap-gate
merges-after: E CP4
status: UNSIGNED
---

# E CP5 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  789e35efd
SCOPE APPROVED:   CP5 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP5 — a job's outcome is read from the RUNNER, never from its log.** `oom_or_timeout`
> is deleted; `job_result`, `test_step_outcome` and a derived `timed_out` replace it. Scope
> is `tools/ci_outcome.py`, `tools/ci_summarize.py` and
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of this
> unit's commit.**

## 0 · ⚠️ COLLISION PROOF — and grepping the TABLE alone would have been wrong

E's checkpoint table declares **CP1, CP2, CP3**. On that evidence CP4 looks free.
**It is not:** `e-cp4-build-record.md` exists and holds **manifest row 15**.

⭐ **The rule needs its second half stated: grep the packet's table AND the build records
AND the manifest.** A checkpoint that got a build record without a table row is invisible
to the table-only check — which is exactly how the E CP2 and K CP2 collisions happened,
one level along. **Next free: CP5 and CP6.** This is CP5.

⚠️ Recorded, not fixed: **E's table does not list CP4**. Adding it would churn packet-e's
fingerprint for a bookkeeping reason; it is an OPEN QUESTION.

---

## 1 · What was deleted, verbatim

```python
_OOM = re.compile(r"(Killed|out of memory|OOMKilled|exit code 137|MemoryError)", re.I)
_TIMEOUT = re.compile(r"(timed out|timeout|The operation was canceled)", re.I)
           "oom_or_timeout": bool(_OOM.search(text) or _TIMEOUT.search(text)),
    out["ok"] = bool(out["totals_line_found"] and out["collected"] > 0
                     and not out["oom_or_timeout"])
    s = summarize("pytest", "Killed\n")
    show("OOM is detected and is never ok", (s["oom_or_timeout"], s["ok"]), (True, False))
```

⛔ **Deleted, not patched.** The regex was measured wrong in **both** directions:

| run | what happened | the flag said |
|---|---|---|
| #2, #3 | both suites completed with totals lines | **true** |
| #4 | the pytest job was CANCELLED at its 45-minute cap | **false** |

⭐ **It fired on the WORD without the EVENT and missed the EVENT without the WORD.** No
regex fixes that, because the fact it wanted was never in the text: GitHub's cancellation
does not write "timeout" into the captured log. **A flag wrong in both directions is worse
than absent** — absent, nobody consults it.

## 2 · The fields that replace it

Per suite, in `latest.json` under `outcome`:

| field | source |
|---|---|
| `job_result` | `needs.<job>.result` — the runner's own verdict |
| `test_step_outcome` | the `Run` step's **`outcome`** |
| `elapsed_s` | `completed_at − started_at` from the run's `jobs` API |
| `timed_out` | derived, below |
| `timed_out_basis` | the derivation as a sentence, with both numbers |

⛔ **`outcome`, NOT `conclusion`, for the step.** `continue-on-error: true` rewrites
`conclusion` to `success` for a step that failed — that mask is the same class of lie this
unit removes.

**The derivation, and its two numbers are printed:**

```
timed_out == (job_result == "cancelled") AND (elapsed_s >= timeout_minutes*60 - 60)
```

⭐ **The one-minute slack is the whole point.** A job the RUNNER cut at its cap and a job a
HUMAN cancelled early both report `cancelled`; only elapsed separates them, and they are
not the same fact. Run #4's real shape — `elapsed_s=2716, cap_s=2700` — reads TIMED OUT;
the same result at three minutes does not.

⛔ **`ok` now requires the runner agreed.** `ci_outcome.suite_ok` =
`totals_line_found AND collected > 0 AND job_result == "success" AND failed == 0`. Every
clause is a way a suite has actually lied in this repository. ⚠️ `collected > 0` is kept
beyond the commissioned three: dropping it would re-admit run #3's `collected: 2` of 481.

## 3 · Controls — five job shapes plus empty (`--self-check`, exit 0)

```
SUCCESS: job_result                                      -> success    ok
SUCCESS: timed_out is False                              -> False      ok
FAILURE: step outcome survives continue-on-error         -> ('failure', 'failure') ok
FAILURE: timed_out is False                              -> False      ok
CANCELLED AT CAP: timed_out is True                      -> True       ok
...and the basis names both numbers                      -> True       ok
CANCELLED EARLY: timed_out is False                      -> False      ok
...distinguished from the cap cut by elapsed alone       -> cancelled  ok
SKIPPED: no job in payload -> timed_out UNREADABLE       -> UNREADABLE ok
EMPTY jobs JSON: job_result UNREADABLE                   -> UNREADABLE ok
EMPTY jobs JSON: timed_out UNREADABLE, never False       -> UNREADABLE ok
ok TRUE only when the runner agrees                      -> True       ok
ok FALSE when the job was cancelled                      -> False      ok
ok FALSE with no totals line                             -> False      ok
ok FALSE when zero collected                             -> False      ok
timed_out takes all three values across real shapes      -> ['False', 'True', 'UNREADABLE'] ok
SELF-CHECK: PASS
```

⛔ **UNREADABLE is a third state here too.** An empty or unmatched jobs payload yields
`timed_out: "UNREADABLE"`, never `false` — *we could not look* and *it did not happen* are
different facts, and collapsing them is what the deleted flag did.

### ⚰️ The non-vacuity control was WRONG, and fixing the code to satisfy it would have broken the feature

Its first version varied only `needs_result` while holding elapsed at 20 minutes against a
45-minute cap — where **every correct answer is `False`**. It therefore demanded a spread a
correct implementation must not produce, and the only way to pass it was to delete the
elapsed comparison: the one thing separating a cap cut from a human cancel.

⭐ **A control that fails a correct implementation is a defect in the control.** The fix
varies the input that actually discriminates — `success@20m`, `cancelled@cap`,
`cancelled@3m`, `no-job` — and asserts all three values appear. **Recorded because the
tempting move was to weaken the code.**

## 4 · PREDICTION for the next run — written before pushing

⚠️ Sharding (E CP6) is **not** in this commit, so pytest still faces one 45-minute cap.

| field | vitest | pytest |
|---|---|---|
| `job_result` | `success` | **`cancelled`** |
| `test_step_outcome` | `success` | `cancelled` |
| `timed_out` | `false` | **`true`** ← the field that read `false` on run #4 |
| `totals_line_found` | `true` | `false` |
| `ok` | **`false`** (21 real failures) | `false` |
| verdict | \multicolumn — **RED** | |

⭐ **The load-bearing prediction is `pytest.timed_out == true`.** Run #4 was the same event
and the old flag said `false`. If this run reports `true`, the replacement is proved on the
exact case that defeated its predecessor.

## 5 · Files

```
tools/ci_outcome.py                       (new)
tools/ci_summarize.py                     (flag deleted; ok narrowed to the log's half)
.github/workflows/full-suite-report.yml   (jobs-API fetch, needs.*.result env, record fields)
```

⚠️ `ci_summarize.py`'s module docstring also had its **F-CI-2** claim corrected in place —
it asserted a run was UNREADABLE without `gh` or a token. The repo is public and the API
answers anonymously; what is genuinely 403 is the **log** endpoint. Same file, same unit,
stated rather than slipped in.

## 6 · Drafted ledger row — NOT written

| 83 | *(this commit)* | 2026-09-15 | CI | 1 | E CP5: `oom_or_timeout` deleted — it was true for two suites that completed and false for a job cancelled at its cap. Replaced by runner-sourced `job_result` / `test_step_outcome` / derived `timed_out` with its two numbers printed. `ok` now requires the runner agreed. |

## 7 · Drafted RESUME delta — NOT applied

- **Outcome comes from the runner.** Log text may be quoted as evidence, never used as the
  source of a flag.
- Collision proof needs all three sources: the packet's table, the build records, the
  manifest.
- ⚠️ E's table still does not list **CP4**.
