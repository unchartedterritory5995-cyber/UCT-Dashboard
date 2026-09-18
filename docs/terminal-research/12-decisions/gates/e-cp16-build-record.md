---
id: e-cp16-build-record
unit: E CP16
packet: packet-e-ci-gap-gate
merges-after: E CP15
status: UNSIGNED
---

# E CP16 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  f62b29968
SCOPE APPROVED:   CP16 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP16 — rc 128 is a FATAL git error, not a conflict, and git's own words now reach the
> log.** Scope is `tools/ci_publish.py` **as enumerated by `git show --stat` of
> `792d1595e`.**

⛔ **Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records
on disk are **CP2, CP4–CP15**; manifest rows are **CP2, CP4–CP15** (27 rows total).
**CP16 free.**

---

## 1 · Run #13 — E CP15's prediction landed, and it gave the answer

| E CP15 predicted | actual | |
|---|---|---|
| **the annotation names WHICH branch the publisher took** | **yes, with per-attempt rc values** | ✅ |
| `publish` — deliberately **UNKNOWN** | failure | — *(unscored; CP15 was an instrument)* |
| 19 of 20 jobs green | **19 of 20** | ✅ |

Read anonymously:

```
attempt 1: fetch rc=0
attempt 1: rebase rc=128
attempt 1: ⛔ REBASE CONFLICT — two publishers wrote one path; …
```

⭐ **Three facts in three lines.** The explicit refspec works (`fetch rc=0`), the upstream
resolves (no `UPSTREAM-UNREADABLE`), and **`git rebase` returns 128.**

## 2 · ⛔⛔ AND THE THIRD LINE IS WRONG — THE SAME DEFECT, ONE BRANCH OVER

**A rebase conflict is rc 1, and only rc 1.** git exits **128** on a *fatal refusal* — a
state it will not act on, a bad argument, a repository it cannot read.

⛔ E CP13 split `UPSTREAM-UNREADABLE` out of this very function precisely because it was
*"a confident diagnosis of a cause it had not established."* **The branch one line below kept
doing it**, and this time it published a sentence — *"two publishers wrote one path"* —
describing a collision that cannot have happened: run #13 was the only publisher.

⭐ **A mislabel in a diagnostic is worse than silence**, because it is the sentence the next
reader quotes. Fixed: `rc == 1` is a CONFLICT; any other non-zero is **REBASE FATAL**, with
the rc named in the message.

## 3 · ⚰️ AND `run()` HAS RETURNED THE OUTPUT ALL ALONG

```python
def run(cmd, cwd=None, runner=None):
    """(rc, output). …"""
```

Every caller took the rc and **discarded the text**. That is why run #13 could *name* the
failure and not *explain* it — git had already printed its reason, into a variable nobody
read, and from there into stdout, which is 403 without a login.

`tail(out)` now carries the last few non-empty lines into the log, and from there into the
annotation. ⭐ **The TAIL, not the head:** git prints `fatal: …` last, after any progress
chatter. One line, because it rides an annotation; bounded, because a diagnostic that floods
the channel is a diagnostic nobody reads. An empty output is **NAMED** (`(no output)`) rather
than rendered as a blank.

## 4 · ⭐ A HYPOTHESIS TESTED AND FALSIFIED BEFORE SHIPPING

`actions/checkout@v4` clones **depth 1**, so the publish job works in a **shallow**
repository — and a shallow repo is a classic source of a fatal `git rebase`. It is a good
hypothesis, it fits rc 128, and **it is wrong**:

```
clone --depth 1 --branch feat/x --single-branch file://…   ->  is-shallow-repository: true
git fetch origin +refs/heads/ci-results:refs/remotes/origin/ci-results  -> rc 0
git checkout -B ci-results origin/ci-results                             -> rc 0
git commit …                                                             -> rc 0
git rebase origin/ci-results        ->  "Current branch ci-results is up to date."  rc 0
```

⛔ **Recorded so nobody re-derives it.** `file://` is load-bearing — git ignores `--depth` on
a local path clone and silently gives you a full one, which would have made the test pass for
the wrong reason.

⭐ **This is the discipline the last five checkpoints kept failing:** a plausible cause that
fits the evidence is still a guess until it is run. **Four confident diagnoses have now been
wrong** (CP12's publish prediction, CP13's missing-script story, CP14's "not the cause" hedge
which *was* the cause, and the 21-second retry-exhaustion read). This one was tested and
thrown away before it could become a fifth.

## 5 · Controls

```
rc 128 exits 1                                             -> 1     ok
...and is NOT called a conflict                            -> False ok
...it is called FATAL and says the rc                      -> True  ok
...and git's OWN sentence reaches the log                  -> True  ok
rc 1 IS a conflict                                         -> True  ok
fatal and conflict are distinguishable (non-vacuity)       -> True  ok
tail() takes the LAST lines, where git puts `fatal:`       -> ok
tail() of nothing is NAMED, not empty                      -> (no output) ok
```

## 6 · Files

```
tools/ci_publish.py   (tail(); rc-keyed rebase outcome; git's text into the log; 8 controls)
```

## 7 · Validators

```
ci_publish --self-check -> exit 0
check_repo_hygiene      -> clean, 9,557 tracked files
actionlint              -> UNREADABLE-TOOL (not installed)
```

## 8 · ⚠️ PREDICTION for run #14

| field | prediction |
|---|---|
| **the annotation carries git's own `fatal:` sentence for the rebase** | **yes** — this is the one firm prediction, and it is what CP16 exists for |
| the rebase line says **FATAL**, not CONFLICT | **yes**, with `rc=128` |
| `publish` job result | ⚠️ **UNKNOWN.** CP16 changes nothing about what the publisher does |
| 19 of 20 jobs green | **yes** |

⛔ **I am deliberately not naming the cause.** The shallow-clone hypothesis was tested and
failed; the remaining candidates (an unstaged change, a refused state, a bad argument) are
distinguished by one sentence that run #14 will print. **Guessing it now would be the fifth.**

## 9 · Drafted ledger row — NOT written

| 94 | `792d1595e` | 2026-09-15 | CI | 1 | E CP16: run #13's rebase returned **128** and the publisher called it a REBASE CONFLICT — a conflict is rc 1; 128 is a fatal refusal, and the message described a collision that cannot have happened with one publisher. rc is now keyed (1 = conflict, else FATAL) and `run()`'s output — returned all along and discarded by every caller — reaches the log via `tail()`. The shallow-clone hypothesis was reproduced and FALSIFIED before shipping. |

## 10 · Drafted RESUME delta — NOT applied

- ⛔ **An exit code is a fact; a label for it is a claim.** 1 is a conflict, 128 is fatal.
- ⛔ **If a function returns output, a caller that drops it is choosing to be blind later.**
- ⭐ **Test the plausible cause before shipping the fix for it.** Shallow-clone fit the
  evidence perfectly and was wrong.
- ⚠️ `--depth` is IGNORED on a local-path clone: use `file://` or the control passes for the
  wrong reason.
