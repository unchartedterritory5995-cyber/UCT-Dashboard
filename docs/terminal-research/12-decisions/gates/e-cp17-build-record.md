---
id: e-cp17-build-record
unit: E CP17
packet: packet-e-ci-gap-gate
merges-after: E CP16
status: UNSIGNED
---

# E CP17 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  f176b7212
SCOPE APPROVED:   CP17 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP17 — asking this tool to CHECK A FILE also pushed, and that is the root cause.**
> Scope is `tools/ci_publish.py` and `.github/workflows/full-suite-report.yml` **as
> enumerated by `git show --stat` of `e9cce57bc`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP16**; manifest rows are **CP2, CP4–CP16** (28 rows total).
**CP17 free.**

---

## 1 · Run #14 — E CP16's firm prediction landed, and it named the cause

| E CP16 predicted | actual | |
|---|---|---|
| **the annotation carries git's own `fatal:` sentence** | **yes** | ✅ |
| the rebase line says **FATAL**, not CONFLICT, with `rc=128` | **yes** | ✅ |
| `publish` — deliberately **UNKNOWN** | failure | — *(unscored; CP16 was an instrument)* |
| 19 of 20 jobs green | **19 of 20** | ✅ |

**Two annotations, from ONE check run**, which is the whole finding:

```
fatal: empty ident name (for <runner@runnervm…internal.cloudapp.net>) not allowed
rm -fr ".git/rebase-merge" | and run me again.  I am stopping in case you still have
something | valuable there.
```

⭐ **Two rebases in one job.** The publish step runs one. So something else ran the other.

## 2 · ⛔⛔ THE ROOT CAUSE — `main()` PUSHED WHATEVER IT WAS ASKED TO DO

```python
for path in a.check_artifact:
    print("[ci-publish] " + report_artifact(path))
…
rc, log = push_with_retry(a.branch)      # ⛔ unconditional
```

And the workflow, at line 299 — **step 8, `Prove the artifacts exist before reading them`**:

```
python tools/ci_publish.py --check-artifact jobs.json \
  --check-artifact logs/vitest.log --check-artifact logs/vitest-junit.xml || true
```

That step runs **before** the publish step's `git config user.name`, and **before** the
branch switch. So on **every run since E CP9** it has attempted a full fetch/rebase/push
against `ci-results`:

1. `git rebase` → **`fatal: empty ident name`** — nobody had told git who was committing yet;
2. the failed rebase **leaves `.git/rebase-merge`** in the repo;
3. the real publish, later in the same job, then refuses with *"there is already a
   rebase-merge directory… I am stopping in case you still have something valuable there."*

⛔⛔ **The `|| true` hid all of it.** The step reported success while performing an
unasked-for push **and corrupting the state of a step that had not run yet**.

⭐⭐ **This programme's own rule, inverted and worse.** The workflow says, above
`Fetch this run's job outcomes`: *"A verification line must never be able to destroy the
thing it verifies."* Here the verification line **performed the action** — a file-existence
check that fetched, rebased and pushed.

⚠️ **And it was invisible to every instrument built for it.** E CP14's step-level trap
reports the failing command of the step it is attached to; step 8's failure was swallowed by
`|| true` before any trap could see it. Only CP15+CP16 — the whole trace, with git's own
text, in a channel that answers anonymously — made two rebases visible as two.

## 3 · The fixes

**(1) `--push` is required for this tool to touch the branch.** Without it, it reports and
returns `OK`. Exactly one invocation in the workflow passes it.

**(2) Stale rebase state is cleared before rebasing** (`git rebase --abort`, result logged),
so a leftover from anything can never poison a publish. ⭐ That message — *"I am stopping in
case you still have something valuable there"* — says nothing about the run reading it, which
is the worst kind of diagnostic.

**(3) The committer identity is REPORTED, not assumed.** An unset `user.name` is named in the
log as `⛔ UNSET — git will refuse`, rather than inferred from a fatal three lines later.

## 4 · Controls — behavioural, and mutation-shaped

```
--check-artifact alone exits 0                           -> 0     ok
...and pushes NOTHING (the run-#14 defect)               -> 0     ok
--push DOES publish                                      -> 1     ok
report-mode and push-mode are distinguishable            -> True  ok
a stale rebase directory is cleared before rebasing      -> 1     ok
...and an UNSET committer is NAMED, not assumed          -> True  ok
the workflow invokes ci_publish at all (non-vacuity)     -> True  ok
...and EXACTLY ONE of them carries --push                -> 1     ok
...and the artifact-check invocation is NOT the one      -> []    ok
```

⛔ The first pair is asserted by **wiring a recorder in place of `push_with_retry`** and
counting calls — not by reading the source. The non-vacuity line exists because an unwired
stub would leave both counts at 0 and the pair would agree **for the wrong reason**.

⛔ The workflow rail pins the shape rather than the line: *at least two invocations, exactly
one with `--push`, and it is not the artifact check.* A second step that writes to the branch
as a side effect of doing something else now fails a check.

## 5 · Files

```
tools/ci_publish.py                       (--push; stale-rebase clear; ident reported; 9 controls)
.github/workflows/full-suite-report.yml   (the publish invocation passes --push; nothing else does)
```

## 6 · Validators

```
ci_publish --self-check    -> exit 0
yaml.safe_load             -> OK
check_workflow_expressions -> exit 0, 20 expressions
check_repo_hygiene         -> clean, 9,557 tracked files
actionlint                 -> UNREADABLE-TOOL (not installed)
```

## 7 · ⚠️ PREDICTION for run #15 — and this one is a claim about a cause I have READ

| field | prediction |
|---|---|
| `publish` job result | **success** |
| a record at `results/<run_id>/summary.json` on `ci-results` | **yes — the first since run #4** |
| `results/latest.json` | **gone from the branch** |
| the publisher's annotation | **`::notice::`**, not `::error::`, ending `published on attempt 1` |
| `shards_without_totals` | `[]` — **condition (b)** |

⭐ **The difference from CP12's and CP13's wrong predictions is not confidence — it is that
git said what was wrong, in its own words, and the fix removes exactly that.** Two rebases
became one; the one that remains runs after the identity is set and with no stale state.

⚠️ **What would falsify it:** any failure whose annotation is not about the rebase. That
would mean a further defect behind this one — and it would be **named**, which is what the
last three checkpoints bought.

## 8 · Drafted ledger row — NOT written

| 95 | `e9cce57bc` | 2026-09-15 | CI | 1 | E CP17: `ci_publish.main()` pushed unconditionally, so the workflow's artifact-check step (`--check-artifact … \|\| true`, run before any `git config`) attempted a rebase on every run since E CP9, died on `fatal: empty ident name`, and left `.git/rebase-merge` for the real publish to trip over. `--push` is now required; stale rebase state is cleared; the committer identity is reported. A workflow rail pins that exactly one invocation may push. |

## 9 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A tool that performs its side effect regardless of the flags it was given is a trap
  with a `--dry-run`-shaped hole.** Gate the ACTION on an explicit flag, never on "whatever
  arguments happened to arrive".
- ⛔ **`|| true` hides a step's whole behaviour, not just its exit code.** The step that
  reported success was the one corrupting the run.
- ⛔ A refusal that describes state left by a DIFFERENT step (*"in case you still have
  something valuable there"*) is a diagnostic about the wrong run — clear the state first.
