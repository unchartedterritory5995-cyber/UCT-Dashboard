---
id: e-cp15-build-record
unit: E CP15
packet: packet-e-ci-gap-gate
merges-after: E CP14
status: SIGNED (E CP15, fingerprint 7cd34db76)
---

# E CP15 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  7cd34db76
SCOPE APPROVED:   CP15 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP15 — the publisher's own trace leaves through the channel a stranger can read.**
> Scope is `tools/ci_publish.py` **as enumerated by `git show --stat` of `b2b864bf7`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP14**; manifest rows are **CP2, CP4–CP14** (26 rows total).
**CP15 free.**

---

## 1 · Run #12 — the firm prediction landed on its first run

| E CP14 predicted | actual | |
|---|---|---|
| **an `::error::` annotation names the failing command** | **yes** | ✅ |
| `publish` — deliberately **UNKNOWN** | failure | — *(unscored by construction)* |
| 19 of 20 jobs green | **19 of 20** | ✅ |

Read anonymously, with no account:

```
[failure] publish failed | python "/tmp/ci_publish.py" --branch ci-results (exit 1)
```

⭐ **Predicting `publish: UNKNOWN` was right for the second time**, and for the same reason:
a cause had not been read. The three confident guesses before it were all wrong.

## 2 · ⛔⛔ RETRACTION — E CP13's DIAGNOSIS WAS WRONG, AND THE EXIT CODE HAD ALWAYS SAID SO

E CP13 stated, in its build record, in the session report and in a commit message:

> *"`git checkout ci-results` deletes `tools/ci_publish.py` from the working tree… Python
> exits immediately on a path that does not exist. Two seconds, which is the measured
> duration."*

**The discriminator is the exit code, and it is one command to measure:**

| command | exit |
|---|---|
| `python <a path that does not exist>` | **2** |
| `git checkout <a branch that does not resolve>` | **1** |

**Runs #10 and #11 both reported `Process completed with exit code 1`.** Under `bash -e` a
step exits with the failing command's own status, so a missing script would have reported
**2**. ⛔ **The step never reached the script.** It died at **`git checkout ci-results`** —
precisely the state my own isolated repro had produced and which E CP14 then shipped a fix
for while labelling it *"NOT claimed as the cause."*

⭐⭐ **So the hedge was wrong in the other direction: the explicit refspec WAS the fix.** Run
#12 is the evidence — with `git fetch origin +refs/heads/ci-results:refs/remotes/origin/…`
and `checkout -B`, the step ran past the checkout and failed at its **last** command instead.

⚰️ **And run #10's exit code was in its annotations from the moment it failed.** I first read
that endpoint at run #11. ⛔ **A one-character discriminator sat in a channel I had already
proven readable**, while I reasoned from a branch listing. The E CP12 lesson — *re-take an
UNREADABLE before building on it* — had a sibling I did not spot: **once a channel opens,
re-read the CLOSED cases through it.**

⭐ **What survives from CP13:** `ci-results` genuinely carries no `tools/`, so the `/tmp` copy
is a real fix for a real defect — one that would have fired the moment the checkout started
working. **A correct repair, filed under a wrong cause.** Its record is retracted in place
(§2 there) and its manifest fingerprint re-derived.

## 3 · ⚠️ AND A SECOND WRONG READ, CAUGHT BEFORE IT REACHED A REPORT

Run #12's publish **job** ran 15:43:11 → 15:43:32 — **21 seconds** — and I took that as the
retry loop exhausting: three attempts at 5 s of backoff fits neatly, so the push must be
being rejected.

⛔ **21 s is the JOB. Step 15 took 3 SECONDS.** `push_with_retry` returned **early**, so it
took the `UPSTREAM-UNREADABLE` or `REBASE CONFLICT` branch and never reached a third push.

⭐ The inference was wrong in the *flattering* direction — it would have had me explaining a
push rejection that never happened, complete with arithmetic that fit. **A number that fits
a story is not evidence for it; the step's own duration was one field away.**

## 4 · The fix — one annotation, not one per line

`push_with_retry` writes its whole trace to **stdout**, which is the one place a reader with
no account cannot go. The trace now also leaves as a single annotation:

```
::error title=ci-publish::attempt 1: fetch rc=0%0Aattempt 1: ⛔ UPSTREAM-UNREADABLE …
```

⛔ **ONE annotation, deliberately.** GitHub caps annotations per step, and a trace truncated
at the cap loses its **tail** — which is exactly where the verdict sits. `%0A` is the
workflow-command newline escape, so it renders multi-line inside a single annotation and
cannot be clipped. Failure annotates at `error`, success at `notice`.

## 5 · Controls

```
a failure annotates at ERROR level                              -> True  ok
a success annotates at NOTICE level                             -> True  ok
the annotation is ONE line (the per-step cap cannot clip it)    -> 1     ok
...and it carries the VERDICT line, not just the first attempt  -> True  ok
...and every log line survives into it                          -> 2     ok
error and notice are distinguishable (non-vacuity)              -> True  ok
```

⛔ The fourth is the load-bearing one: an annotation that carried only `attempt 1: fetch
rc=0` would look like a trace and answer nothing.

## 6 · Files

```
tools/ci_publish.py   (annotation(); emitted from main(); six controls)
```

## 7 · Validators

```
ci_publish --self-check    -> exit 0
check_workflow_expressions -> exit 0, 20 expressions
check_repo_hygiene         -> clean, 9,557 tracked files
actionlint                 -> UNREADABLE-TOOL (not installed)
```

## 8 · ⚠️ PREDICTION for run #13

| field | prediction |
|---|---|
| **the annotation names WHICH branch `push_with_retry` took** | **yes** — `UPSTREAM-UNREADABLE`, `REBASE CONFLICT` or attempts exhausted, with the per-attempt rc values |
| `publish` job result | ⚠️ **UNKNOWN.** Nothing in CP15 changes what the publisher does — it only makes what it did legible |
| 19 of 20 jobs green | **yes** |

⭐ **CP15 is an instrument, not a repair, and it should not be scored as one.** The next
checkpoint can fix a cause; this one exists so there is a cause to fix rather than a fourth
guess.

## 9 · Drafted ledger row — NOT written

| 93 | `b2b864bf7` | 2026-09-15 | CI | 1 | E CP15: run #12's annotation named the failing command (`python /tmp/ci_publish.py`, exit 1) but not which of three branches push_with_retry took — those lines go to stdout, which is 403 without a login. The whole trace now leaves as ONE annotation (`%0A`-joined, so the per-step cap cannot clip its tail). Also retracts E CP13's diagnosis: python exits 2 on a missing file, the step reported 1, so it died at `git checkout` — E CP14's refspec was the fix. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔ **Once a channel opens, re-read the CLOSED cases through it.** Run #10's exit code was
  sitting in its annotations while I diagnosed it from a branch listing.
- ⛔ **A number that fits a story is not evidence for it** — 21 s was the job, not the step.
- ⛔ A trace is only a trace if its TAIL survives: one annotation, not one per line.
- ⭐ An instrument checkpoint should predict what becomes legible, never that a cause is
  fixed.
