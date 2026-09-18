---
id: e-cp11-build-record
unit: E CP11
packet: packet-e-ci-gap-gate
merges-after: E CP10
status: UNSIGNED
---

# E CP11 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  0207d7f25
SCOPE APPROVED:   CP11 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP11 — the safety net moves to the front, and the shard directories get their real
> prefix.** Scope is `tools/ci_aggregate.py` and
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of
> `e825a4df4`.**

⛔ **Collision proof:** table CP1–CP3; records and rows CP2, CP4–CP9; CP10 in the same push
family. **CP11 free.**

---

## 1 · ⛔⛔ I PUT THE SAFETY NET AFTER THE TRAPEZE

Run #8: **19 of 20 jobs succeeded** — all twelve shards, all five profile jobs, vitest,
plan — and **`publish` failed in 22 s**. Third consecutive publish failure, third run with
no record.

E CP9's entire F-CI-7 fix was to write the phone-readable summary **before the push**. That
covers a **push** failure. ⛔ **But publish has been dying at ~22 s for three runs — long
before step 11 of 12 — so no summary was written either.**

⭐⭐ **A fallback placed after the thing that fails is not a fallback.** I built the guard
for the failure I imagined rather than the one that was actually happening, and the evidence
that it was happening early (22 s, 13 s, 61 s) was in front of me each time.

**Fixed:** a skeleton summary is now the **third named step**, before any artifact is read,
built only from `needs.*.result` — data that **cannot** be missing. It states in words that
if nothing follows it, publish died before it could build the full record.

## 2 · The shard directories were never where the aggregator looked

`actions/download-artifact@v4` with `pattern:` and **no `merge-multiple`** unpacks **each
artifact into its own subdirectory named after the artifact**:

```
real      shards/pytest-shard-tests-01/summary.json
expected  shards/tests-01/summary.json
```

**Every shard would have read MISSING** — ⛔ a *silent wrong answer*, not a crash — and in
run #8 all twelve were in fact green.

**Fixed:** `--dir-prefix pytest-shard-` is **passed, not guessed**, and the aggregator tries
**both** spellings so it is correct whether or not a caller merges.

## 3 · ⚠️ NEITHER IS CLAIMED TO BE THE 22-SECOND CRASH

The log endpoint returns **403** and the `jobs` API returns an **empty `steps` array**, so
the failing step is **UNREADABLE**. These two are what *reading the file* proves.

⭐ **The skeleton summary is the part that matters most**, because it is what makes the next
failure readable **without a log at all** — turning an UNREADABLE into a measurement rather
than fixing a cause I cannot see.

## 4 · Files

```
tools/ci_aggregate.py                     (--dir-prefix; both spellings tried)
.github/workflows/full-suite-report.yml   (skeleton summary as step 3; --dir-prefix passed)
```

## 5 · Validators

```
yaml.safe_load             -> OK, 8 named publish steps, skeleton at position 3
check_workflow_expressions -> exit 0, 20 expressions, every call in the documented set
actionlint                 -> UNREADABLE-TOOL (not installed)
```

## 6 · ⚠️ PREDICTION for run #9 — written before pushing

| field | prediction |
|---|---|
| a **skeleton summary** appears on the publish job's page | **yes**, whatever else happens |
| `publish` job result | ⚠️ **UNKNOWN — genuinely.** Three failures with an unreadable cause; I have fixed two provable defects and cannot claim the third |
| if publish succeeds: `shards_without_totals` | `[]` — condition (b) |
| shards | 12 of 12 succeed, as in runs #6 and #8 |

⭐ **`publish` is predicted UNKNOWN rather than `success`.** Two prior predictions of
`success` were wrong, and a fourth confident guess would be a claim about a cause I still
cannot read.

## 7 · Drafted ledger row — NOT written

| 89 | `e825a4df4` | 2026-09-15 | CI | 1 | E CP11: the phone-readable summary sat at step 11 of 12 while publish died at ~22 s for three runs, so the fallback never ran — moved to step 3, built from job results alone. Also `download-artifact@v4 pattern:` puts each artifact in its own subdirectory, so every shard read MISSING; the prefix is now passed. |

## 8 · Drafted RESUME delta — NOT applied

- ⛔ **Put the fallback before the thing that fails, not after it.**
- ⛔ `publish` has failed three runs running and the cause is **UNREADABLE**. The skeleton
  summary is the instrument that should make run #9's failure legible.
- A `pattern:` download without `merge-multiple` nests each artifact in its own directory.
