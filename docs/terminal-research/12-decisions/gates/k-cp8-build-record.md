---
id: k-cp8-build-record
unit: K CP8
packet: packet-k-two-command-signing-gate
merges-after: K CP7
status: UNSIGNED
---

# K CP8 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  5695c7919
SCOPE APPROVED:   CP8 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP8 — the commit universe is git's, and the coverage check can now be proved to
> FAIL.** Scope is `tools/verify_manifest.py` **as enumerated by `git show --stat` of this
> unit's commit.**

⛔ **Collision proof, three sources:** K's packet table declares **CP1–CP2**; build records
on disk top out at **k-cp7**; manifest rows top out at **CP7**. **CP8 free.**

---

## 1 · ⚠️ THE PREMISE WAS WRONG, AND THE TRUTH IS WORSE

The brief said `--check-commits` *"has reported N/N mapped every session while eleven
commits were unmapped — it must have been checking the manifest's own list against
itself."* **Measured, before touching anything:**

```
[verify-manifest] commit coverage: origin/master..feat/s7-price-level
  commits on the branch : 46          mapped: 35 of 46
  ⛔ UNREFERENCED: e703af0a8  E CP29 …            (eleven lines)
exit=1
```

**It derives its universe from `git log origin/master..feat/s7-price-level` — exactly the
rule — and it has been right all along.** It is not reporting a property of its own list.

⛔ **What actually happened: it stopped being run.** The citation trail ends at session 2:

```
SESSION_REPORT_2026-09-14_2  "first run, and not vacuous — 11 of 13 mapped, exit 1"
SESSION_REPORT_2026-09-15_1  "13 of 13 commits mapped, exit 0"   F-MERGE-1 CLOSED
SESSION_REPORT_2026-09-15_2  "19 of 19 commits mapped"
sessions 3,4,5,6,7           ← no citation. The flag appears nowhere.
```

Sessions 5–7 recorded `verify_manifest  40 OK, 0 STALE` — **the fingerprint check, which is
a different question** — and the eleven accumulated underneath. ⭐ *An audit nobody runs is
worse than none: it reads as coverage.* This file's own directory says so about a different
tool, and then it happened here.

⚰️ **And session 2's report already flagged the mechanism**, in its own words: the check
*"was run as `… | tail -10; echo; echo`"*. That is the pipe trap that also made session 6
record two exit-1 audits as exit 0. **The same defect has now cost three separate false
readings.**

## 2 · The two real defects, both of which the brief's remedy would have missed

⛔ **"EXACTLY one" was never checked.** The claim map was a dict write:

```python
claimed[sha] = stem          # a second row claiming the same sha SILENTLY WINS
```

A commit claimed by two rows is cherry-picked twice; the second pick is **EMPTY, exits 1,
and strands the run mid-list** — the same shape as the empty-pick trap K CP6 refuses. It
also under-counted `commits claimed by a unit` by one per duplicate, so the printed
arithmetic quietly stopped closing.

⛔ **The base and the tip were literals inside the function**, so the only fixture this
check ever had was *production*. It could be demonstrated passing; it could never be
constructed failing. That is why a duplicate row was never noticed: **nothing could build
one.**

## 3 · Controls (5 new self-check rows, all on a throwaway repo)

```
every commit claimed            -> exit 0                      ok
ONE extra orphan commit         -> exit 1                      ok   <- non-vacuity
...and claiming it              -> exit 0 again                ok   <- it goes back
ONE sha claimed by TWO rows     -> exit 1                      ok
an EMPTY range is UNREADABLE, never coverage  -> exit 2        ok
```

⭐ **The third row is the one that makes the second mean something.** "Adding a commit turns
it red" is satisfied by a check that is *always* red; it has to go green again when the
commit is claimed.

## 4 · The four demanded controls, verbose, on the REAL units

```
1  the real tree                    46 commits, 35 mapped, ELEVEN named      exit 1
2  a real CLONE + one orphan        47 commits, 35 mapped, TWELVE named      exit 1
     ⛔ UNREFERENCED: 0ceec3b60  AN ORPHAN nobody claims
3  a row claiming a sha twice       names the PAIR                           exit 1
     ⛔ CLAIMED TWICE: 18dd13683  by `packet-a-absent-bound-gate`
                                   AND `a-second-row-claiming-the-same-commit`
4  every commit claimed            46 of 46                                  exit 0
```

⭐ **Control 2 clones the real repository** rather than simulating one, so the twelve are
the real eleven plus a real planted commit. Control 4 proves the check is not simply always
red.

## 5 · Files

```
tools/verify_manifest.py   check_commits: duplicate detection + `repo`/`units` injection ·
                           --base / --branch · the subject lookup now reads the repo under
                           test, not the hard-wired one
```

⚠️ **A third bug fixed in passing:** the UNREFERENCED subject lookup read `cwd=CODE_REPO`
while everything around it read the repo under test — so against any repo but the default
it would have printed **blank subjects** and read as a nameless list.

## 6 · ⛔ THIS TOOL NOW FAILS ON ITS OWN TREE, AND THAT IS CORRECT

`verify_manifest --check-commits` exits **1** until section A attributes the eleven. That is
the finding, not a regression. **Recorded here so the next session does not "fix" the red by
weakening the check** — the eleven are:

```
ce615a2eb E CP25   e02dca955 F-CI-29   16027f239 run-#23 scoring   4feaeb86f the revert
8c39c4c28 F-CI-30  8a8ebe0ab E CP26    4274e26cc F-CI-32           240bb3305 F-CI-36
5a58d91cf E CP27   304ac481c E CP28    e703af0a8 E CP29
```

## 7 · Validators

```
ast.parse                             OK
verify_manifest --self-check          PASS, exit 0 (5 new rows)
verify_manifest --check-commits       exit 1, eleven named  (expected; see §6)
the four demanded controls            PASS (1,2,3 -> exit 1 · 4 -> exit 0)
exit codes captured from the process, never from a pipe
```

## 8 · Drafted ledger row — NOT written

| 111 | *(this unit's commit — named in the session report)* | 2026-09-16 | SIGNING | 1 | K CP8: `--check-commits` was never broken — it derives its universe from `git log origin/master..feat` and has been right since it was built. It simply **stopped being run** after session 2, while sessions 5–7 recorded the *fingerprint* check's "40 OK, 0 STALE" as though it answered the same question. Two real defects fixed: a sha claimed by two rows was a silent dict overwrite (a second cherry-pick is EMPTY and strands the run), and the base/tip were literals so the only fixture was production. Now injectable, duplicate-detecting, and controlled five ways on a throwaway. |

## 9 · Drafted RESUME delta — NOT applied

- ⛔ **A check that is not in a runnable list is not a check.** This one was correct,
  controlled, and silent for five sessions because no validator block named it.
- ⛔ **"Exactly one" needs a duplicate test, not a membership test.** A dict keyed by the
  thing you are counting cannot report the collision it just swallowed.
- ⭐ **If a check's only fixture is production, it can be shown passing and never shown
  failing.** Make the universe injectable before trusting a green.
