# The gate scans one commit, and a push is not one commit

**SD-1.1 A2.5.** Measured 2026-09-15, Session 13. Advisory implementation lands with this
document; promotion to gating is a later, criterion-driven step.

---

## The mechanism

`master-deploy-gate.yml` runs `on: push`. GitHub fires that **once per push**, with
`head_sha` set to the **tip**. The secret-scan step then reads:

```sh
git diff --name-only --diff-filter=d HEAD^ HEAD
```

— one commit's files. **Every other commit in a multi-commit push is scanned by nothing.**

⛔ This is not the `production..candidate` passenger case recorded in D-053 §4. That one
concerned a commit whose own gate run went red and which later rode in behind a green tip;
it was a single commit. **This is structural and applies to every green push.**

## The measurement

Over the first-parent commits that reached `origin/production` **after this gate existed**
(`beace00e0`, 2026-09-14):

| | |
|---|---|
| first-parent commits since the gate existed | **85** |
| of those, with **no gate run of their own** | **66** |
| pushes that carried more than one commit | **7** |
| largest single push | **18 commits** |
| second largest | **13 commits** |

Examples, each `tip → the commits it carried unscanned`:

| tip (got the run) | carried, unscanned |
|---|---|
| `1216958ed` | **18** |
| `5e88b38c4` | **13** |
| `a7579af4c` | 7 |
| `569485a12` | 4 |
| `d25a69b86` | 2 — `b5b4a7f77`, `6b4311953` |
| `57e5131a3` | 1 — `3758cd75e` |

⭐ **The repository is public.** `master-deploy-gate.yml`'s own comment says it: *"A PUSHED
SECRET IS PUBLIC EVEN IF DELETED AFTERWARDS."* A credential introduced in commit 3 of an
18-commit push was reviewed by the pre-push hook only — the very thing the gate exists to
back up, because `--no-verify` skips it and leaves no trace.

⚠️ **Not a fault of anyone's.** The per-commit scan is correct for what it claims, its own
comment warns that `--scan` takes paths and not a range, and it carries an emptiness guard
precisely so it cannot pass vacuously. The gap is that "the files this push changed" and
"the files `HEAD^..HEAD` changed" are the same sentence only when a push is one commit.

## What ships now — advisory, and it heartbeats

A second step scanning `origin/production..HEAD`, `continue-on-error: true`, ending in
`exit 0`. It reports **one line on every run**, and its states are deliberately distinct:

| line | meaning | counts toward promotion? |
|---|---|---|
| `range-scan: EXECUTED … verdict=CLEAN` | compared a real range, found nothing | **yes** |
| `range-scan: EXECUTED … verdict=FINDING` | compared a real range, found something | no — review |
| `range-scan: EXECUTED … NOTHING-TO-SCAN` | real base, zero changed files | no |
| `range-scan: NOTHING AHEAD` | HEAD already contained in the base | no |
| `range-scan: INCONCLUSIVE` | **base unreachable in this clone** | **no** |
| `range-scan: NO RANGE` | new ref / force push, no `before` | no |

⛔⛔ **`INCONCLUSIVE` exists because the first version of this step would have been
vacuous.** The job checks out with `fetch-depth: 2`, so neither `origin/production` nor the
push's `before` commit is in the clone; every git command would have failed quietly and the
step would have printed *"nothing to scan"* on every run — **meeting a 20-run promotion
criterion having compared nothing.** The step now fetches first and reports an unreachable
base as inconclusive, never as clean.

⭐ That is the third time in one day this repository has met the same shape: an empty warn
log reading as zero false positives; a pause logged only on state change; and this. **A
check that speaks only when it finds something cannot be distinguished from a check that
never ran.**

## Promotion to gating (SD-1.1 A2.5)

Promote when **either**:

- **≥ 20 runs** logging `range-scan: EXECUTED` with `verdict=CLEAN` on green tips — note
  that `INCONCLUSIVE`, `NO RANGE`, `NOTHING AHEAD` and `NOTHING-TO-SCAN` do **not** count;
  or
- the **first true finding**, after review.

Promotion means dropping `continue-on-error` and the trailing `exit 0`. ⚠️ Do not promote
it in the same change that widens what it scans.

---

## The states were RUN, not just written

⛔ A workflow step that parses is not a step that behaves. Each branch was executed
locally against real repository state, with the same git commands the step uses:

```
### real base, real range
range-scan: EXECUTED  commits=4  files=3
range-scan: verdict=CLEAN

### base unreachable — the fetch-depth-2 case that would have been vacuous
range-scan: INCONCLUSIVE — base deadbeef… is not reachable in this clone (shallow fetch). NOT counted as clean.

### new ref / force push — before is all zeros
range-scan: NO RANGE (github.event.before is empty or a new ref) — nothing compared

### HEAD already contained in the base
range-scan: NOTHING AHEAD — HEAD is already contained in origin/production
```

⭐ The second line is the one worth having seen fire. Without it this step reports
*"nothing to scan"* on every run in CI and satisfies its own promotion criterion having
compared nothing — and the only way to know which of those two it was doing is to have
watched it do both.

## ⚠️ A process note, recorded because it is the same class

The run that produced the fourth case above did `git checkout` **in the shared worktree
while the landing script was unpaused** — the third such touch in one session, and it came
three commits after the same session wrote the standing rule forbidding it
(*"one worktree, one writer"*, `PROGRAMME-CHECKLIST.md`). Nothing broke: the tree was
clean, the checkouts were fast, and the branch was restored.

⛔ **The conclusion is structural, not a resolution to be more careful.** Discipline has
now failed three times against this specific hazard, twice with real consequences (a
sequence killed mid-flight; a correction staged onto the branch that was one push from
master). **The durable fix is to remove the opportunity:** every edit and every checkout
belongs in its own `git worktree add`, and the shared worktree belongs to the script
alone — which is how this document was written.

---

## ⛔⛔ And then it happened to us, live, on the very next push

Twenty minutes after this document was written, this programme landed **M14** — and its own
push is a textbook instance, with **zero overlap** between what the gate scanned and what
the push introduced.

`56b5554b1` is a merge. `HEAD^` is its **first parent**, and the landing script produces a
merge whose first parent is *the feature branch*:

```
git checkout docs/session11-record
git merge origin/master          # first parent = the branch, second = master
git push origin docs/session11-record:master
```

| | |
|---|---|
| what the gate scanned (`HEAD^..HEAD`) | **11 files** — all joystick, i.e. what *master* contributed |
| what the push actually introduced | **3 files** — `DECISIONS.md`, `00-profile.md`, `session11-report.md` |
| overlap | **0** |

**The scan did not miss some of the change. It scanned the other side of the merge** —
eleven files that had already been gated when master landed them — and looked at none of
the three the push was for.

### The direction is decided by where `git merge` was run

| merge shape | first parent | `HEAD^..HEAD` covers | verdict |
|---|---|---|---|
| `checkout master; merge feature` | old master | the feature's changes | ✅ correct |
| GitHub squash / PR merge | old master (or a single commit) | the PR's changes | ✅ correct |
| **`checkout feature; merge master; push feature:master`** | **the feature branch** | **master's changes** | ⛔ **backwards** |

Measured on the same day: `db5591c63`, another workstream's merge, has the old master as
its first parent and scanned its own 2 changed files — **correct**. Ours had the branch as
first parent and scanned 11 files belonging to somebody else's already-gated work.

⚠️ **`tools/…/land.py` uses the third shape, so every merge this programme lands is scanned
backwards** — M12, M13 and `repo/git-scope` included, unless something changes.

### ⭐ The range scan covers exactly the gap

At push time `production` was `57113d1ac`. `git diff production..56b5554b1` is precisely the
three files the per-commit scan missed. **The advisory step built above would have caught
this instance** — which is the first evidence that its base choice (`production..HEAD`
rather than `HEAD^..HEAD`) is the right one, produced by a real push rather than by
argument.

### What is NOT being changed, and why

⛔ **The landing flow is not being altered mid-sequence.** Switching to
`checkout master; merge branch` would fix the direction, but changing how a running
sequence lands three remaining merges — while a burst-guarded queue is in flight — trades a
documented, bounded gap for an undocumented risk. The range scan addresses it at the gate,
which is where it belongs.

**Recommended, for whoever picks this up:** either land via `checkout master; merge branch`,
or promote the range scan to gating. The two are alternatives, not a pair.
