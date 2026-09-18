---
id: e-cp20-build-record
unit: E CP20
packet: packet-e-ci-gap-gate
merges-after: E CP19
status: UNSIGNED
---

# E CP20 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  8b1afab93
SCOPE APPROVED:   CP20 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP20 — an UNREADABLE runner verdict is not a failure, and the fetch that lost it is now
> authenticated.** Scope is `tools/ci_aggregate.py` and
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of
> `c89dd6b81`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP19**; manifest rows are **CP2, CP4–CP19** (31 rows total).
**CP20 free.**

---

## 1 · ⭐⭐ RUN #17 HIT EVERY PREDICTION E CP19 MADE

| E CP19 predicted | actual | |
|---|---|---|
| `shards_without_totals: []` | **`[]`** — all twelve | ✅ |
| pytest `collected` ≈ 24,400 | **24,445** | ✅ |
| pytest `failed` ≈ 185 | **185** | ✅ |
| `contract_gaps: []` | **`[]`** | ✅ |
| `pytest_failures.txt` present and non-ZERO | **45,850 bytes** | ✅ |
| VERDICT RED | **RED** | ✅ |

**Every detail path the record names now exists**, and the failure text is diagnosable:

```
tests.test_alert_user_admission | test_…BOTH_LANES_AGREE_on_the_bars | AssertionError: Regex pattern did not match.
tests.pattern_engine.test_pattern_db_shared_root_guard | test_… | AssertionError: assert '/data/patterns.db' == '/home/runner…'
```

⭐ **148 → 185 is the measurement improving**, as E CP19 asked to have it read.

## 2 · ⛔⛔ AND THE SAME RECORD SAYS `shards 0/12 success · shards_failed: 12`

The jobs API says all twelve pytest jobs **succeeded** in run #17, exactly as in run #16.

**Proven from the record itself, not inferred** — the two runs' outcome blocks, side by side:

```
run #16  pytest  job_result=success  timed_out_basis=job_result=success, elapsed_s=96, cap_s=1200 …
run #17  pytest  job_result=success  timed_out_basis=no job matching 'pytest' in the jobs payload — UNREADABLE, not false
```

**`jobs.json` came back EMPTY in run #17.** Two separate defects follow.

## 3 · Defect 1 — the fetch was anonymous

```yaml
curl -sSL -H "Accept: application/vnd.github+json" \
  ".../actions/runs/$GITHUB_RUN_ID/jobs?per_page=100" -o jobs.json || echo '{}' > jobs.json
```

⚰️ The comment above it read: *"The repo is public, so this endpoint answers with the workflow
token or without one."* **True of a single request; not true of a shared runner IP against a
60-per-hour anonymous limit.** Run #16 read 20 jobs. Run #17 read zero.

**Fixed:** `-H "Authorization: Bearer ${{ github.token }}"` plus `actions: read` on the job,
and an **empty payload now emits an `::error::` annotation** rather than passing as a quiet
default — `|| echo '{}'` degraded honestly but silently, and every downstream verdict became
UNREADABLE on the strength of it.

## 4 · ⛔⛔ Defect 2 — UNREADABLE WAS COUNTED AS FAILED

```python
if res == "success":   ok_jobs.append(sid)
elif res == "cancelled": cancelled.append(sid)
else:                  failed_jobs.append(sid)      # ⛔ UNREADABLE lands here
```

So the record published **`all_success=False (0/12)`, `shards_failed: 12`** for a run in which
all twelve shards succeeded.

⛔ **"We could not read the verdict" and "the verdict was failure" are different facts**, and
naming the third state is this programme's whole method. ⭐ **`ci_outcome` said
`UNREADABLE, not false` about the same payload, in the same record, three fields away** — the
two tools disagreed about honesty and the less honest one wrote the headline.

**Fixed:** `shards_unreadable` is its own named bucket; `ok` stays **False** because we could
not verify; and `ok_basis` now says `runner_verdict_unreadable=N` with *"the RUNNER's verdict
could not be read for these — NOT a failure"*, instead of leaving a reader to infer twelve
red shards.

## 5 · Controls

```
unreadable verdicts are NOT counted as failed        -> 0                ok
...they are their own bucket, NAMED                  -> ['s1','s2','s3'] ok
...ok is still False — we could not verify           -> False            ok
...and the basis SAYS unreadable                     -> True             ok
CONTROL: a real failure still counts as failed       -> 1                ok
...and is NOT called unreadable                      -> []               ok
```

⛔ The **control** is the load-bearing pair: without it, "unreadable is not failed" is
satisfied just as well by a function that never counts failures at all.

## 6 · Files

```
tools/ci_aggregate.py                     (shards_unreadable; basis names it; 6 controls)
.github/workflows/full-suite-report.yml   (authenticated jobs fetch; actions: read; empty-payload annotation)
```

## 7 · Validators

```
five tool self-checks      -> all exit 0
yaml.safe_load             -> OK
bash -n on the fetch step  -> PARSES
check_workflow_expressions -> exit 0, 22 expressions
check_repo_hygiene         -> clean, 9,557 tracked files
actionlint                 -> UNREADABLE-TOOL (not installed)
```

## 8 · ⚠️ PREDICTION for run #18

| field | prediction |
|---|---|
| `shards_success` | **12 of 12** — the fetch is authenticated |
| `shards_unreadable` | **`[]`** |
| `ok_basis` | contains `runner_verdict_unreadable=0` |
| pytest `collected` / `failed` | **~24,445 / ~185**, unchanged — nothing in CP20 touches what the tests do |
| VERDICT | **RED** |

⚠️ **What would falsify it:** `shards_unreadable` non-empty again, which would mean the fetch
fails for a reason other than the anonymous rate limit — and the new annotation would say so
on the job page, readable without an account.

## 9 · Drafted ledger row — NOT written

| 98 | `c89dd6b81` | 2026-09-15 | CI | 1 | E CP20: run #17's `jobs.json` came back empty because the fetch was anonymous, and `ci_aggregate` bucketed every UNREADABLE runner verdict into `shards_failed` — publishing `0/12 success` for twelve jobs that had all succeeded, while `ci_outcome` called the same payload UNREADABLE three fields away. The fetch is authenticated (`actions: read` + token), an empty payload annotates, and `shards_unreadable` is its own named bucket with the basis saying so. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔⛔ **UNREADABLE is not FAILED, in every tool, not just the honest one.** Two tools in one
  record disagreed about the same payload and the blunter one wrote the headline.
- ⛔ **"The endpoint answers without a token" is true of one request and false of a fleet.**
  Rate limits are per-IP and runners share them.
- ⛔ A `|| echo '{}'` fallback degrades honestly and **silently**. Make the degraded state
  annotate.
