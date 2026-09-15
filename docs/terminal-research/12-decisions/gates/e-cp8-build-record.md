---
id: e-cp8-build-record
unit: E CP8
packet: packet-e-ci-gap-gate
merges-after: E CP7
status: UNSIGNED
---

# E CP8 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP8 — the publish job read `jobs.json` before the step that writes it.** Scope is the
> step ordering and one guarded verification block in
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of this
> unit's commit.**

⛔ **Collision proof:** E's table declares CP1–CP3; build records **and** manifest rows exist
for CP4, CP5, CP6, CP7. **CP8 free.**

---

## 1 · The defect, proven from the file

In `0d7c55fb1`:

```
line 255   ci_aggregate.py --jobs jobs.json      <- inside "Summarise"
line 282   -o jobs.json                          <- inside "Fetch this run's job outcomes"
```

**`jobs.json` was CONSUMED 27 lines before it was CREATED.**

Consequence: every shard's `job_result` came back **UNREADABLE**, `all_success` could never
be true, and the suite could never report `ok` — **regardless of how the twelve shards
actually did.** In run #6 **all twelve succeeded** and the aggregator could not have known
it.

⭐⭐ **IT DEGRADED HONESTLY RATHER THAN SILENTLY, AND THAT IS THE ONLY REASON IT WAS
FINDABLE.** `ci_aggregate` treats a missing jobs payload as `UNREADABLE` and **never** as
success, so the bug produced an *unreadable* suite instead of a *green* one. With the log
endpoint returning **403** throughout, reading the workflow was the entire diagnostic path —
and it worked because the failure mode was designed to be loud.

⛔ Had the aggregator defaulted a missing payload to `success`, this would have published a
**GREEN** suite over twelve shards whose results were never consulted.

## 2 · The fix

The fetch step moves ahead of `Summarise`. **Verified from the parsed YAML**, not by eye:

```
publish order: ["Fetch this run's job outcomes", "Summarise",
                "Extract the failure text", "Build the record", "Publish onto …"]
jobs.json:  created line 268   ·   consumed line 294
```

### And the verification line is now guarded

`|| echo '{}'` covered curl's **exit code**, not malformed output: a rate-limited or
truncated body is written by `-o` and then raises in `json.load`, **failing the step and
with it the entire publish job** — the one job whose failure loses the whole record
(**F-CI-7**).

⭐ **A verification line must never be able to destroy the thing it verifies.**

## 3 · ⚰️ The first attempt at that guard BROKE THE YAML

Escaped newlines in a one-liner collapsed into literal `\n` and the file stopped parsing.
**`yaml.safe_load` caught it before the commit** — the check firing on my own change is the
check working. Rewritten as a heredoc block and re-validated **from the parse tree**.

⚠️ This is the fourth time this session that a shell-escaping shortcut has produced a broken
artifact. The reliable path is a patch **file**, not an inline escape.

## 4 · What this does NOT fix

⛔ **`publish` failed in BOTH run #5 (61 s) and run #6 (13 s), and this may not be why.**
The log is 403 and the `jobs` API returned an empty `steps` array, so the failing step is
**UNREADABLE**. This unit fixes a defect that is provable from the file; it does not claim
to be the cause of either failure.

**F-CI-7** (the publisher has no failure path) and **F-CI-8** (two runs race on
`git push origin ci-results`, no retry, no lock) both remain **open**.

## 5 · Files

```
.github/workflows/full-suite-report.yml   (step order + one guarded block)
```

## 6 · Drafted ledger row — NOT written

| 86 | *(this commit)* | 2026-09-15 | CI | 1 | E CP8: `jobs.json` was consumed in `Summarise` 27 lines before `Fetch` created it, so every shard's `job_result` read UNREADABLE and the suite could never report ok — run #6's twelve successful shards included. Found by reading the file, because the aggregator degrades to UNREADABLE rather than to success. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔ **`publish` has failed twice. Do not trust a run until a record for it exists on
  `ci-results`.** F-CI-7 and F-CI-8 are open.
- **E CP7 and E CP8 are committed and UNPUSHED**, deliberately, until the publish race is
  resolved.
- ⭐ Degrade to UNREADABLE, never to success — it is what made this findable behind a 403.
