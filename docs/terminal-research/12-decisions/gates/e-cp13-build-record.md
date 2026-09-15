---
id: e-cp13-build-record
unit: E CP13
packet: packet-e-ci-gap-gate
merges-after: E CP12
status: UNSIGNED
---

# E CP13 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **E CP13 — the publisher deleted itself from disk one line before calling itself.** Scope
> is `tools/ci_publish.py`, `tools/ci_latest.py` and
> `.github/workflows/full-suite-report.yml` **as enumerated by `git show --stat` of
> `38aa2d9ad`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP12**; manifest rows are **CP2, CP4–CP12** (24 rows total).
**CP13 free.**

---

## 1 · Run #10 scored E CP12, and then falsified its prediction — exactly where predicted

| E CP12 predicted | actual | |
|---|---|---|
| `publish`: **success** | **failure** | ❌ |
| `Build the record` stops failing | **SUCCESS — first time in four runs** | ✅ |
| shards 12 of 12 | **12 of 12**, plus 5 profile jobs, vitest and plan — **19 of 20** | ✅ |
| a record on `ci-results` | **none** | ❌ |
| `contract_gaps: []` | not reachable | — |

⚠️ **§2 of this record was RETRACTED after run #12 — read it before the rest.**

⭐ **The falsifier was named in advance:** *"publish failing at a step OTHER than `Build the
record` would mean the KeyError was one of two causes, not the cause."* It failed at step
**15 · `Publish onto the orphan ci-results branch`**, in **2 seconds**. So CP12 fixed the
cause it named — provably — and a second, independent defect sat behind it.

## 2 · ⛔⛔ RETRACTED — THIS DIAGNOSIS WAS WRONG, AND THE EXIT CODE SAYS SO

**Added 2026-09-15, after run #12.** Everything below about the branch's contents is true and
the `/tmp` copy is still necessary. ⛔ **But it is NOT why runs #10 and #11 failed**, and I
published that it was.

**The discriminator is the exit code, measured on this box:**

| command | exit |
|---|---|
| `python <a path that does not exist>` | **2** |
| `git checkout <a branch that does not resolve>` | **1** |

**Runs #10 and #11 both reported `Process completed with exit code 1`** — read from the
check-run annotations, anonymously. Under `bash -e` the step exits with the failing command's
own status, so a missing script would have reported **2**. ⭐ **The step never reached the
script; it died at `git checkout ci-results`** — which is exactly what my own isolated repro
produced and what E CP14 then labelled *"NOT claimed as the cause"*. **It was the cause.**

⚰️ **And that exit code was in run #10's annotations from the moment it failed.** I read that
endpoint for the first time at run #11. A one-character discriminator sat in a channel I had
already proven readable, while I reasoned from a branch listing instead.

⭐ **What survives:** `ci-results` really does carry no `tools/`, so the `/tmp` copy is a real
fix for a real defect — one that would have fired the moment the checkout started working.
It was a correct repair filed under a wrong cause.

## 2b · The branch contents (still true, and still why the /tmp copy is needed)

`git ls-tree -r origin/ci-results` returns **fourteen paths**: `README.md` and
`results/**`. ⛔ **Zero paths under `tools/`.**

So `git checkout ci-results` — which the step does — **deletes `tools/ci_publish.py` from
the working tree.** The step's last line is then:

```
python tools/ci_publish.py --branch ci-results
```

⛔ ~~Python exits immediately on a path that does not exist. **Two seconds**, which is the
measured duration, and `set -e` kills the step.~~ **STRUCK — see §2.** Python exits **2** on a
missing file and the step reported **1**, so it never got here. The copy remains necessary;
the timing argument was a coincidence I read as a confirmation.

**Why runs #3 and #4 published and this cannot be a regression in them:** their publish step
ended in an inline `git push origin ci-results`, under a comment reading *"never rebase,
never force"*. `git cat-file -e 4ad1108d1:tools/ci_publish.py` → **the file did not exist at
run #4**. E CP9 introduced it. ⛔ **This line has never once executed.**

## 3 · ⚰️ AND THE COMMENT THREE LINES ABOVE THE CHECKOUT SAYS SO

```
# ⛔ The orphan checkout below wipes the working tree, so anything that must
# survive it is copied OUT first. /tmp is outside the repo and survives.
```

E CP9 added a script invocation **after** that checkout and did not copy the script out.
⭐ **The rule was written down, correctly, in the right place, and walked into anyway.** A
comment is not a guard; the rail in §4 is.

## 4 · Fix 1 — and the publisher asserts the condition of its own reachability

`tools/ci_publish.py` is copied to `/tmp` **before** the checkout and invoked from there.

The rail lives in `ci_publish --self-check`, which parses the workflow's own publish step,
finds every `python <path>` invocation **after** `git checkout ci-results`, and asserts none
points into `tools/`:

```
the publish step is READABLE (not a silent zero)                -> True   ok
at least one python call runs after the checkout (non-vacuity)  -> True   ok
...and none of them is under tools/, which the checkout deletes -> []     ok
control: the run-#10 spelling IS flagged   -> ['tools/ci_publish.py']     ok
```

⛔ Three properties, each earned: an unfindable step is **UNREADABLE, not a pass**; a step
with *no* python calls would make the assertion vacuous, so that is checked separately; and
the **control** proves the check catches the exact spelling that shipped.

⭐ It is deliberately inside the publisher rather than in a new file: **no other validator
could see this class.** `yaml.safe_load` sees valid YAML, the expression linter sees valid
expressions, and the defect is "a path that will not exist by the time this line runs".

⚠️ **CODE NEVER PROSE, and it bit within the minute.** A throwaway one-liner I wrote to
double-check the fix reported the workflow still invoking `python tools/ci_publish.py` — it
was matching **my own comment describing the defect**. The rail was unaffected (it requires
the line to *start with* `python`), but the trap fired on the first careless instrument
built beside it.

## 5 · Fix 2 — an unresolvable upstream is NOT a rebase conflict

`push_with_retry` ran `git fetch origin <b>` (rc **ignored**) then `git rebase origin/<b>`,
and reported **any** non-zero rebase as:

> *"⛔ REBASE CONFLICT — two publishers wrote one path; this should be impossible once
> latest.json is gone"*

⛔ **That is a confident diagnosis of a cause it had not established.** `git rebase` also
returns non-zero when the ref simply does not resolve — and `git fetch origin <b>` writes
**FETCH_HEAD**, which under a single-branch refspec need not create
`refs/remotes/origin/<b>` at all. Reproduced on a `checkout@v4`-shaped clone:

```
git fetch origin ci-results     -> exit 0, "* branch ci-results -> FETCH_HEAD"
refs/remotes/origin/ci-results  -> MISSING
git checkout ci-results         -> error: pathspec 'ci-results' did not match  (exit 1)
```

⚠️ **This is NOT claimed as run #10's cause, and the distinction matters.** Runs #3 and #4
checked out `ci-results` successfully on the runner, so the tracking ref demonstrably exists
there. The repro shows the *instrument* can mislabel a state it will meet; it does not show
that state occurred. **The fix is to the diagnosis, not to a cause I have not read.**

`UPSTREAM-UNREADABLE` is now its own outcome, with a non-vacuity control asserting the two
failures cannot print the same sentence.

## 6 · Fix 3 — the reader crashed on the one state that matters, and a stale pointer lived on

**`ci_latest.py` died with `UnicodeEncodeError: 'charmap'` on a Windows console** — on its
**ZERO-RECORDS** path specifically, the branch that exists to say *"we could not look"* out
loud. Sixth recurrence of the cp1252 crash in this programme; `sys.stdout.reconfigure` added.
Against the real branch it now prints:

```
ZERO-RECORDS
⛔ ZERO-RECORDS is not 'no failures' — it is 'no record to read'.   (exit 1)
```

**And `results/latest.json` is still on the branch.** E CP9 removed the WRITER and left the
FILE, so it has named run #4 as "latest" through six runs. ⛔ **A pointer nobody updates is
worse than no pointer** — a reader who finds it believes it. The publisher removes it once,
idempotently (`git rm -f --ignore-unmatch`), because the branch's only writer is the right
one to do it and it runs under this job's concurrency group.

## 7 · Files

```
.github/workflows/full-suite-report.yml   (publisher copied to /tmp, invoked there; latest.json removed)
tools/ci_publish.py                       (UPSTREAM-UNREADABLE; the reachability rail + control)
tools/ci_latest.py                        (stdout reconfigure — ZERO-RECORDS is printable again)
```

## 8 · Validators

```
yaml.safe_load             -> OK, 9 named publish steps, skeleton still at position 3
check_workflow_expressions -> exit 0, 20 expressions
check_repo_hygiene         -> clean, 9,557 tracked files, no line-ending flip
self-checks                -> ci_summarize · ci_outcome · ci_aggregate · ci_record ·
                              ci_latest · ci_publish · pytest_shards — all exit 0
actionlint                 -> UNREADABLE-TOOL (not installed)
```

## 9 · ⚠️ PREDICTION for run #11 — written before pushing

| field | prediction |
|---|---|
| `Publish onto the orphan ci-results branch` | **reaches `ci_publish.py`** — the script now exists at the path invoked |
| `publish` job result | **success**, with the residual named below |
| a record at `results/<run_id>/summary.json` | **yes** — the first since run #4 |
| `results/latest.json` | **gone from the branch** |
| `shards_without_totals` | `[]` — **condition (b)** |

⚠️ **The residual, stated rather than hidden:** `push_with_retry`'s fetch→rebase→push has
**still never executed**. If `origin/ci-results` does not resolve on the runner it will now
say **UPSTREAM-UNREADABLE** instead of inventing a conflict — a better failure, not an
absence of one. ⛔ **Two prior confident predictions about this job were wrong; this one is
about a path I have read end to end, and I am naming the part I have not.**

## 10 · Drafted ledger row — NOT written

| 91 | `38aa2d9ad` | 2026-09-15 | CI | 1 | E CP13: `git checkout ci-results` deletes `tools/` from the working tree (the branch has zero paths under it), so E CP9's `python tools/ci_publish.py` on the next line could never run — run #10 died there in 2 s with 19 of 20 jobs green. Publisher copied to /tmp before the checkout and railed by a check inside itself; an unresolvable upstream stops being reported as a rebase conflict; `ci_latest` can print ZERO-RECORDS on a cp1252 console; the stale `latest.json` is deleted. |

## 11 · Drafted RESUME delta — NOT applied

- ⛔ **A branch switch is a deletion.** Anything invoked after `git checkout <orphan>` must
  live outside the repo — the workflow's own comment said so and the next line ignored it.
- ⛔ **A failure message must not name a cause the code has not established.** "REBASE
  CONFLICT" for any non-zero rebase was a confident wrong answer.
- ⛔ A tool can rail the condition of **its own reachability** when nothing else can see it.
- ⛔ cp1252, sixth time. Reconfigure stdout in every tool that prints a glyph.
