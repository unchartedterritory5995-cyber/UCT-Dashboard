---
id: e-cp14-build-record
unit: E CP14
packet: packet-e-ci-gap-gate
merges-after: E CP13
status: UNSIGNED
---

# E CP14 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP14 — the publish step names its own failure, in the one channel a stranger can
> read.** Scope is `.github/workflows/full-suite-report.yml` and `tools/ci_publish.py` **as
> enumerated by `git show --stat` of `c47d96c16`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP13**; manifest rows are **CP2, CP4–CP13** (25 rows total).
**CP14 free.**

---

## 1 · Run #11 — the prediction was wrong for the third time on this job

| E CP13 predicted | actual | |
|---|---|---|
| the publish step reaches `ci_publish.py` | **unknown — it failed at the same 2 s** | ❌ |
| `publish`: success | **failure** | ❌ |
| a record on `ci-results` | **none** — still three commits, newest run #4 | ❌ |
| 19 of 20 jobs green | **19 of 20**, every shard and profile job | ✅ |

⛔⛔ **Three confident predictions about this one job, three times wrong** — and each was a
claim about a command nobody could see. **The wall, not the guess, is the thing to remove.**

## 2 · ⭐⭐ THE MEASUREMENT THAT CHANGES THE APPROACH

Re-taken rather than assumed, because the last UNREADABLE claim I published was false:

| channel | anonymous |
|---|---|
| `GET /actions/jobs/<id>/logs` | **403** |
| `GET /actions/runs/<id>/logs` | **403** |
| `…/actions/runs/<id>/summary_partial` (the step summary) | **404** |
| `GET /repos/{o}/{r}/actions/runs/<id>/jobs` — steps + timings | ✅ **200** |
| **`GET /repos/{o}/{r}/check-runs/<id>/annotations`** | ✅ **200** |

⛔ **So `$GITHUB_STEP_SUMMARY` is not readable without a login either.** E CP9 and E CP11
both aimed their fallback there — correct for the owner on a phone, and **useless to anyone
without an account**, which is the reader F-CI-7 is written about.

⭐ **Annotations are the channel that answers anonymously.** GitHub already writes one for
this failure and it says, in full: *"Process completed with exit code 1."* **It names
nothing.**

## 3 · The fix — an ERR trap that speaks in both directions

```bash
_publish_failed() {
  cmd="$1"; rc="$2"
  echo "::error title=publish failed::${cmd} (exit ${rc})"
  { …failing command, exit code, remote-tracking refs, current branch… } >> "$GITHUB_STEP_SUMMARY"
}
trap '_publish_failed "$BASH_COMMAND" "$?"' ERR
```

- the **annotation** reaches a reader with no account — the F-CI-7 requirement;
- the **step summary** block reaches the owner's phone with the git state attached;
- the `nothing to commit` branch becomes an annotation for the same reason.

⭐ **This is E CP11's lesson one level down.** The skeleton summary made the JOB legible
whatever happened; this makes the STEP legible. Both were built because a fallback that
only covers the failure you imagined is not a fallback.

## 4 · And the git stops relying on DWIM

```
git fetch origin ci-results     -> exit 0, "* branch ci-results -> FETCH_HEAD"
refs/remotes/origin/ci-results  -> MISSING
git checkout ci-results         -> error: pathspec 'ci-results' did not match  (exit 1)
```

Measured on a clone built to `actions/checkout@v4`'s shape
(`--depth 1 --branch <b> --single-branch`). The workflow and `push_with_retry` now both
fetch `+refs/heads/ci-results:refs/remotes/origin/ci-results` and check out
`-B ci-results origin/ci-results`.

⚠️ **NOT claimed as the cause of runs #10 or #11.** Runs #3 and #4 checked this branch out
on the runner, so the ref demonstrably resolves there. This is the difference between an
operation that is well-defined and one that relies on DWIM — **the annotation is what will
name the cause.** ⛔ Saying which of these is the fix, before the annotation arrives, would
be the third confident guess in a row.

## 5 · ⚠️ AND MY OWN PARSE CHECK PASSED VACUOUSLY, ON THE FIRST TRY

The first `bash -n` of the extracted step printed **PARSES** over an **empty file**: the
python that extracted the step body died of a cp1252 `UnicodeEncodeError` (seventh sighting
this programme), `bash -n` read nothing, and nothing is syntactically valid.

⭐ It was caught only by adding the two things this programme always asks for: a
**non-vacuity check** (`test -s`) and a **control** (a deliberately broken copy that must be
rejected). Re-run properly:

```
step body: 89 lines · non-empty: OK
bash -n            -> PARSES (exit 0)
control: broken copy -> REJECTED, so the check can fail
```

⛔ **A YAML-embedded bash function with a trap is exactly where an escaping bug hides**, and
this session has already had two. It is now parsed as shell, with a control.

## 6 · Files

```
.github/workflows/full-suite-report.yml   (ERR trap -> annotation + step summary; explicit refspec)
tools/ci_publish.py                       (explicit refspec on fetch, so the rebase upstream exists)
```

## 7 · Validators

```
yaml.safe_load             -> OK
bash -n on the extracted step body -> PARSES, non-vacuity + control both green
check_workflow_expressions -> exit 0, 20 expressions
check_repo_hygiene         -> clean, 9,557 tracked files
self-checks                -> ci_summarize · ci_outcome · ci_aggregate · ci_record ·
                              ci_latest · ci_publish · pytest_shards — all exit 0
actionlint                 -> UNREADABLE-TOOL (not installed)
```

## 8 · ⚠️ PREDICTION for run #12 — and the `publish` line is deliberately UNKNOWN

| field | prediction |
|---|---|
| **an `::error::` annotation names the failing command** | **yes.** This is the one firm prediction, and it is about a channel measured to answer anonymously |
| `publish` job result | ⚠️ **UNKNOWN.** Three confident guesses about this job have been wrong; the explicit refspec may be the cause or may be insurance, and I have not read the failure |
| 19 of 20 jobs green | **yes**, as in runs #9, #10 and #11 |
| if publish succeeds: `shards_without_totals` | `[]` — **condition (b)** |

⭐ **Predicting UNKNOWN here is the same call E CP11 got right and E CP12/CP13 got wrong.**
The difference is not confidence, it is whether a cause has been *read*.

## 9 · Drafted ledger row — NOT written

| 92 | `c47d96c16` | 2026-09-15 | CI | 1 | E CP14: publish failed identically in runs #10 and #11 and every readable channel was shut — log 403, step summary 404 anonymously. Check-run annotations DO answer anonymously, and GitHub's own says only "Process completed with exit code 1"; an ERR trap now emits the failing command and exit code as an `::error::` annotation and into the step summary with the git refs. Fetch/checkout also stop relying on DWIM. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔ **Remove the wall before guessing again.** Three wrong predictions were three claims
  about a command nobody could see.
- ⭐ **Check-run annotations are the anonymous channel** — the step summary and the log are
  both gated. Any fallback written for "a reader with no account" must go there.
- ⛔ A `bash -n` over an empty file PASSES. Non-vacuity and a control, every time.
