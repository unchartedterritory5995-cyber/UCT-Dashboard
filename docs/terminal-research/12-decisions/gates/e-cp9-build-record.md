---
id: e-cp9-build-record
unit: E CP9
packet: packet-e-ci-gap-gate
merges-after: E CP8
status: UNSIGNED
---

# E CP9 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP9 — the publisher is serialized, proves its reads, retries, fails loudly, and no
> longer writes a shared pointer.** Scope is `tools/ci_latest.py`, `tools/ci_publish.py` and
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of this
> unit's commit.**

⛔ **Collision proof, all three sources:** E's table declares CP1–CP3; build records exist
for CP4–CP8; manifest rows carry CP2, CP4, CP5, CP6, CP7, CP8. **CP9 free.**

⚠️ **The file sets of CP7, CP8 and CP9 are NOT disjoint** — all three edit
`.github/workflows/full-suite-report.yml`. That is structural, like `sign_manifest.txt`:
three consecutive fixes to one file. The `merges-after` chain (CP7←CP6, CP8←CP7, CP9←CP8)
encodes the ordering, and `merge_all` cherry-picks them in that order. **Stated rather than
claimed disjoint.**

---

## 1 · F-CI-7 — the publisher had no failure path

Runs **#5 and #6** both had `publish` fail, so **no record exists for either** and the only
evidence is behind a **403**. ⛔ **Every guard this programme built — zero-collected,
totals-line, runner-sourced outcome, shards-missing — lives INSIDE the job that did not
run.** A publisher that can fail silently is a measurement system with a hole exactly where
the bad news goes.

## 2 · The five changes

**(a) Serialize.** Job-level `concurrency: { group: ci-results-publish,
cancel-in-progress: false }`. Publishers queue instead of colliding — the **primary**
defence against F-CI-8. ⛔ `cancel-in-progress: false` is load-bearing: **cancelling a
publisher destroys the record it was about to write**, which is the very failure F-CI-7
names.

**(b) Prove before read.** Every artifact reports **EXISTS + SIZE** before it is read,
including each shard's `summary.json`; a missing one prints **UNREADABLE with the path
NAMED**. ⚰️ E CP8 was a read-before-create that no test could see.

**(c) Bounded retry, then fail.** `fetch → rebase → push`, **3 attempts, 5 s backoff**,
**exit 1** on final failure. A rebase *conflict* is refused rather than forced past — with
the pointer gone it should be impossible, so it means an assumption broke.

**(d) Phone-readable summary, written BEFORE the push.** `$GITHUB_STEP_SUMMARY` gets the
verdict, both suites' counts and the shard fields **unconditionally**, so the outcome is
readable in the Actions tab even when the repo record never lands.

**(e) `latest.json` is DELETED.** It was **the only path two publishers both wrote**, and
therefore the only place they could conflict. The record moves to
`results/<run_id>/summary.json`; **"latest" is DERIVED at read time** by
`tools/ci_latest.py`.

⭐ **Why the rebase cannot conflict now:** each run writes only `results/<run_id>/…`, a
directory no other run touches. Two publishers' commits are disjoint by construction. **The
conflict was a property of the pointer, not of the branch.**

## 3 · ⭐ TOLD-VS-FOUND on the reader grep, and it mattered

`grep -rn latest.json` returns **20+ hits**. **Every one outside the workflow is a different
artifact** — the R2 `barspack/` and `intradaypack/` manifests, a separate system with its
own publish-last ordering guarantee. **The only `ci-results` readers were the workflow's own
2 hits** (control: the needle was findable before the edit, 2 hits).

⛔ **Updating "each reader" as the instruction read would have edited a live R2 manifest
path in the bars pipeline.** Dotted-form matching over a bare string is the difference.

## 4 · Controls — 26 across the two tools, both exit 0

**`ci_latest --self-check` (11):** ZERO-RECORDS for no directory *and* for an empty one;
`latest` is `None`, never an empty dict; three records all read; **latest is the max run id
NUMERICALLY** — ⭐ a string sort puts `"9"` after `"34949032368"`; a malformed record is
**NAMED while the others still read**; **only-malformed is MALFORMED, not ZERO-RECORDS**
(different facts); a directory without `summary.json` is not a record.

**`ci_publish --self-check` (15):** two rejections then success → 3 attempts, backoff
`[5, 5]`, exit 0; permanent rejection → **exit 1** and **the step summary is still written**;
missing artifact → UNREADABLE **with the path named**; an existing one reports its size; a
rebase conflict → exit 1 **saying two publishers wrote one path**; success and failure are
distinguishable.

⛔ **ZERO RECORDS IS NOT ZERO FAILURES**, and the reader says so in those words.

## 5 · Validators

```
yaml.safe_load  -> OK
  jobs: ['plan', 'vitest', 'pytest', 'collect_profile', 'publish']
  publish concurrency: {'group': 'ci-results-publish', 'cancel-in-progress': False}
  publish steps: ["Fetch this run's job outcomes", 'Prove the artifacts exist before
                  reading them', 'Summarise', 'Extract the failure text', 'Build the
                  record', 'Write the phone-readable summary', 'Publish onto the orphan
                  ci-results branch']
  top perms: {'contents': 'read'} | publish perms: {'contents': 'write'}
actionlint      -> UNREADABLE-TOOL (not installed on this box)
```

⚠️ `latest.json` still returns **2 grep hits** in the workflow — both are **README prose
explaining the deletion** and one comment. **No writes remain** (checked for `cp`/`>`
forms).

## 6 · ⚠️ PREDICTION for the run CP7+CP8+CP9 triggers — written before pushing

| field | prediction | basis |
|---|---|---|
| vitest `job_result` | `success` | it has completed every run |
| vitest `timed_out` | `false` | 901–1,341 s against a 45-min cap |
| vitest `totals_line_found` | `true` | it has printed totals every run |
| vitest `ok` | **`false`** | 21 real failures, 5 of them genuine |
| pytest `shards_total` | **12** | the proved partition |
| pytest `shards_success` | **12 of 12** | all twelve succeeded in run #6 |
| pytest `shards_without_totals` | **`[]`** | ⭐ **this is condition (b)'s evidence** |
| pytest `shards_missing` | `[]` | |
| pytest `collected` | **thousands** | ⚠️ never measured; 1,430 files is the only anchor |
| pytest `ok` | **`false`** | real failures expected once they are finally visible |
| collect-profile jobs | **5 of 5** succeed | E CP7's slash fix |
| `publish` job result | **`success`** | E CP9 — ⚠️ it has failed twice, so this is the load-bearing one |
| F-CI-8 serialization | **UNTESTED-LIVE** | ⚠️ one push means one run; the group cannot be observed serializing without a second concurrent run |

⭐ **The two that matter: `publish` succeeding at all, and `shards_without_totals == []`.**
The first is the whole unit; the second is the condition that unparks the commands.

## 7 · Files

```
tools/ci_latest.py                        (new — derive latest, never write a pointer)
tools/ci_publish.py                       (new — bounded retry, loud failure, step summary)
.github/workflows/full-suite-report.yml   (concurrency, prove-before-read, summary, no pointer)
```

## 8 · Drafted ledger row — NOT written

| 87 | *(this commit)* | 2026-09-15 | CI | 1 | E CP9: publishers serialize on a concurrency group, artifacts are proven present before reading, the push retries 3× and then FAILS non-zero, the summary reaches `$GITHUB_STEP_SUMMARY` before the push is attempted, and `latest.json` — the only path two publishers both wrote — is deleted in favour of deriving latest at read time. |

## 9 · Drafted RESUME delta — NOT applied

- **"Latest" is derived, never written.** `tools/ci_latest.py`; ZERO-RECORDS ≠ no failures.
- A publisher that cannot push **fails the job**; the Actions-tab summary is written first.
- ⚠️ **F-CI-8's live control is UNTESTED** until two runs overlap for real.
