---
id: e-cp7-build-record
unit: E CP7
packet: packet-e-ci-gap-gate
merges-after: E CP6
status: UNSIGNED
---

# E CP7 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP7 — a GitHub artifact name cannot contain a slash.** The collection-profile matrix
> named its artifacts after directory PATHS, so four of five uploads were rejected and took
> their jobs down with them. Scope is the one artifact-name expression in
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of this
> unit's commit.**

⛔ **Collision proof:** E's table declares CP1–CP3; build records **and** manifest rows
exist for CP4, CP5, CP6. **CP7 free.** (Table alone would have said CP4 — see E CP5 §0.)

---

## 1 · The defect, measured

E CP6 wrote `name: collect-profile-${{ matrix.dir }}`, and the matrix values are paths.
**GitHub artifact names forbid `/ \ : < > | * ? "`.** Run #6:

| dir | has `/` | conclusion |
|---|---|---|
| `tests` | no | **success** |
| `tests/api` | yes | failure |
| `tests/pattern_engine` | yes | failure |
| `tests/theme_curation` | yes | failure |
| `tests/theme_engine` | yes | failure |

**5/5 correlation**, and the mechanism is a documented constraint.

⭐ **The shape of the failure is the interesting part: the jobs DID THE WORK and threw it
away at the last step.** Collection ran, `/usr/bin/time -v` measured it, the row was
reduced — and then the upload was rejected, failing the step and the job. Every number
those four jobs produced was lost after being computed.

⛔ **Downstream this reads as "that directory has no profile."** The aggregator reports it
as **unmeasured**, not zero — which is the only reason the failure is legible at all. ⭐ An
absence that reports itself as an absence is what separates this from a silent hole.

⚠️ **The pytest shard matrix is unaffected and that is visible in the same run**: its ids
are `dir-api`, `tests-01` — no slashes — and **9 of 12 shards had already succeeded** while
every slashed profile job failed.

## 2 · The fix

```yaml
name: collect-profile-${{ replace(matrix.dir, '/', '--') }}
```

The download side already globs `collect-profile-*`, so it needs no change.

## 3 · ⚠️ HONESTY ABOUT THE EVIDENCE

**The log endpoint returns HTTP 403 unauthenticated** (F-CI-2's other half), so this is an
**inference** from a 5/5 correlation plus a documented constraint — **not a log read**. It
is recorded as an inference. If run #7 shows all five profile jobs succeeding, that is the
confirmation; if it does not, the diagnosis was wrong and the record says so first.

## 4 · PREDICTION for the next run — written before pushing

| field | prediction |
|---|---|
| collect-profile jobs succeeding | **5 of 5** (was 1 of 5) |
| `collect_profile.json` `dirs_measured` | **5** |
| `dirs_unmeasured` | `[]` |
| pytest shards | unchanged — 12, all reporting |

## 5 · Files

```
.github/workflows/full-suite-report.yml   (one artifact-name expression)
```

## 6 · Drafted ledger row — NOT written

| 85 | *(this commit)* | 2026-09-15 | CI | 1 | E CP7: collection-profile artifacts were named after directory paths; GitHub rejects `/` in artifact names, so 4 of 5 jobs did their work and then failed at upload. Sanitised with `replace(matrix.dir, '/', '--')`. |

## 7 · Drafted RESUME delta — NOT applied

- **A matrix value that is a PATH cannot be used verbatim as an artifact name.**
- The aggregator's unmeasured-not-zero rule is what made this visible; keep it.
