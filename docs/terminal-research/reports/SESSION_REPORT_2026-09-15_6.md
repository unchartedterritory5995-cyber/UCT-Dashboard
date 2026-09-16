# Session report — 2026-09-15, session 6

**THE SCOPE FIX · A THREE-SITTING RUNBOOK · THE GATE PROMOTED · 27 ENTRIES THAT WERE THE
CHECKOUT · AND FOUR DEFECTS FOUND BY BUILDING THE CONTROLS**

---

## 1 · ET, trees, poll log

Start **2026-09-15 19:59 EDT Tue**, end **2026-09-15 21:1x EDT Tue**
(`python tools/weekly_exec.py et`). Both worktrees `git status --porcelain` → **0** at
start. **Gate-box lock: ABSENT.**

⛔ **No persistent watcher processes.** Bounded polls, one ET line each:

```
run #27   20:48:54 … 20:51:35 ET   (1 bounded call)
T5 bisect 20:52:33 …               (background, bounded per call, returns)
```

**7 commits** — 3 code (`8a8ebe0ab`, `4274e26cc`, and session 5's tail), 5 docs
(`80313cac7`, `b9aa452d2`, `e643b6017`, `0a8d8d4c5`, `cf75e187f`). **Nothing signed,
nothing merged, nothing pushed to master. No deploys, flag flips, daemon pauses or
wake-ups.**

---

## 2 · K6 — the scope fix, before any signing

`sign()` accepted a `scope` argument and never read it — three fields written into a
four-field block. AST, with `by`/`on` as the positive control:

```
sign() parameters : ['path', 'by', 'on', 'scope']
  path READ · by READ · on READ · scope NEVER READ  <-- the drop
```

⭐ **Not a cosmetic gap.** `read_approval` answers SIGNED on the AT SHA line alone, so a
scope-less approval reads as a full one: the packet says a person approved something and
does not say what. **Three signed blocks in this tree are already in that state**, and 40
more were one command away.

**Now written, and refused when it cannot be:** `2` blank · `3` names a checkpoint the
packet does not declare · `4` no blank `SCOPE APPROVED:` line. All three fire **before any
span is read**, and each refusal is proved by **sha256 on both sides** — an exit code says
the process stopped, only a hash says the disk is unchanged. The scope is spliced **by
span** into the block being signed, never `re.sub(count=1)`, and the span is re-found from
the AT SHA line *as it now stands* because the BY/ON writes move every offset after them.

**The checkpoint table is DERIVED** from the packet's own `unit:` line or the first cell of
its checkpoint table — **37 of 40 rows** — with a **named `prose` fallback** for the three
that have neither and declare their checkpoint in a heading or a sentence. A deriver that
refused those would have stopped the session at its first row. Hyphen and space are the
same character (`A-CP1` ≡ `A CP1`), and `E CP25` satisfies a row that says `CP25`.
**Pre-flight against the real manifest: 40 rows, 0 refused.**

**Fingerprints did not move.** `sign()` hashes *before* it writes, so `verify_manifest` is
**40 OK, 0 STALE** and nothing regenerated. `rederive_signed` now blanks **four** fields
instead of three, or nothing this tool signs would re-derive again.

**A SIGNED block with a blank scope is now MALFORMED.**

### ⛔ One instruction could not be executed, with the measurement

The prompt asked that a two-checkpoint row *"signs twice, once per CP."*

```
rows with two or more checkpoints: 4
across all 40 rows: rows NOT (1 blank AT SHA, 1 blank SCOPE) = 0
```

Each holds **one** blank approval block and `target_span` refuses more than one. Signing
twice would mean **adding a second approval block to four approved-shape documents** — an
edit to the packets, not a change to the signer. **One signature whose scope names both
checkpoints** is what ships, which is what the manifest already encodes.

---

## 3 · R — three sittings, and the arithmetic that forces three

| | rows | ends at | minutes |
|---|---|---|---|
| **1** | 1–17 | `e-cp12-build-record` | **86.1** |
| **2** | 18–39 | `d3-cp2-build-record` | **86.5** |
| **3** | 40 | `s2-accelerator-chord…` (`--include-member-visible`) | **5.7** |

31 of 40 units push; each costs ~8 s + a **186 s** build + the guard's **150 s** settle =
**5.73 min**; total **178.3 min**. ⛔ **Two sittings cannot both be ≤ 90 min** — the best
possible balance is 91.9 / 86.4. With **F-S2-1 alone**, the remaining 172.5 min splits
**86.1 / 86.5**. That is why there are three, and the runbook states it.

`--until <stem>` is on both tools; the **order check runs over the whole list before any
truncation**, so a boundary cannot hide a violation after it. An `--until` naming nothing is
**exit 2** and names the last five rows.

---

## 4 · ⛔⛔ FOUR DEFECTS, EVERY ONE FOUND BY BUILDING THE CONTROL

None of these came from reading the code. All of it had been read.

### (a) `merge_all` cherry-picked onto whatever was checked out

```
s7-price-level is on feat/s7-price-level
git merge-base --is-ancestor 18dd13683 HEAD -> unit 1's commit is ALREADY in that history
```

So `git cherry-pick 18dd13683` is **empty**, exits 1, leaves `CHERRY_PICK_HEAD` behind.
**The owner's very first merge command would have died on the very first unit.** It now
refuses unless the worktree is at `origin/master` and names the command; it will not move a
shared worktree's HEAD for you.

### (b) ⚰️ K CP5's merged-state check was WRONG — RETRACTED

K CP5 shipped `merge-base --is-ancestor <commit> origin/master`, and last session's report
called it *"reading MASTER, both directions"*. **Cherry-pick rewrites the commit**, so the
original sha is never an ancestor of master however thoroughly the change landed:

```
                     --is-ancestor        truth               git cherry
unit 1 (merged)      exit 1 "not merged"  IS on master  WRONG "- d0a33c45b"  right
unit 2 (merged)      exit 1 "not merged"  IS on master  WRONG "- a62470bcb"  right
unit 3 (not merged)  exit 1 "not merged"  is NOT        right "+ 4326b6e7a"  right
```

A resumed run would have re-cherry-picked an already-merged unit — **the exact failure
K CP5 was written to remove.** Now `git cherry`, which compares patch ids.

⚠️ **The first version of that control said `--is-ancestor` was fine.** Its fixture put the
feature branch directly on master, so cherry-pick reproduced byte-identical commits and both
primitives agreed. **A fixture that cannot distinguish is not a control.**

### (c) the resumed settle

A run killed between a push and its settle leaves master's tip mid-deploy; the next run
skips that unit (correctly) and would push the next one straight into a Layer-0 refusal. It
now waits **once, on `origin/master`'s tip**, before the run's first push.

### (d) the eleventh cp1252 sighting, inside the signer

`sign_all.py` had no `stdout.reconfigure`, and the gap was invisible because the paths that
print ⛔ are the **refusal** paths. `--until` naming no row raised `UnicodeEncodeError`
**instead of** the refusal it was about to print. **A refusal that cannot be printed is a
refusal nobody receives.**

### The R.3 control, as run

```
SITTING 1 (--until u2)      u1 merged, u2 merged, exit 0
THE INTERRUPT (--until u3)  u3 pushed, then killed at its OWN settle (wait #2)
SITTING 2 (no flags)        u1/u2/u3 ALREADY MERGED, read from master by patch id
                            ⏳ RESUMING — waiting on master's tip before pushing
                            u4 merged and deployed                      exit 0
  ALREADY MERGED -> 3 · resumed settle -> 1 · units merged this run -> 1 · exit 0
```

⚠️ The interrupt is keyed on the **Nth wait**, not on a sha: the first version keyed it on
the ORIGINAL commit's sha, the deploy carries the CHERRY-PICKED one, so it never fired and
the control reported a resume it had not tested.

---

## 5 · E26 — the gate promoted, scored on run #27

`continue-on-error` removed from the `gate` job. The criterion was met **by the record**:
run #24 `NEW_FAILURES` (41 real entries), run #25 `NO_NEW_FAILURES`. Scored:

```
run #27   gate job conclusion: success   (21 of 21 jobs success)
          VERDICT NO_NEW_FAILURES   new 0 · fixed 2 · unchanged 120 · MISSING 0
          flaky_size 6 · flaky_new 1 · new_flaky 1
```

⭐ **`new_flaky: 1` is F-CI-30 firing for the first time in a real run** — one NEW entry was
in the derived flaky set, excluded from the verdict and named in its own bucket. The green
check is green *because* the exclusion worked.

⛔⛔ **NO branch protection and NO required check**, written into the workflow header: a
required check would block the 31 pushes the signing session is built on. **Promotion means
the colour is TRUTHFUL, not that it blocks.**

---

## 6 · I — inventory, retractions, and 27 entries that were the checkout

**Run #27: 121 entries · 6 environment-shaped · 115 product-shaped.**

⛔ **The top bucket, 13 entries, is `invalid object name '4eec5e0aa'` — and a pattern scan
of the whole record puts 27 of 121 (22%) on git objects a depth-1 checkout does not have.**
A previous session called those *"22 STALE TESTS"* and proposed rewriting or deleting them.
`4eec5e0aa` is a **live ancestor 292 commits back**, committed two days earlier.
`fetch-depth: 0` now applies to **every** job — cost measured first, on one job: **7 s → 13
s, +6 s**.

**I.2 — the retractions propagate.** Five sites asserted a withdrawn claim; each now carries
`RETRACTED → <ID>`. ⛔ Coverage was checked **by paragraph, not by line** — a line-scoped
`grep -v RETRACTED` mis-filters a multi-line annotation and reported a clean tree that was
not. 6 paragraphs cite a retracted claim, **0 unmarked**, with a probe proving the check can
still see an unmarked one. `e-cp23` is in the manifest, so editing it moved its fingerprint
(`e35593e5d → 78583d19b`) in the same commit.

**I.3 — F-CI-29 is CLOSED, by the record.** On run #27 `test_ast_math_parity` shows **40
testcases collected and 0 failure entries**. The lane runs and the lanes agree. The
"defect" was `subprocess(LIST, shell=True)` running nothing.

---

## 7 · Findings

| # | finding |
|---|---|
| **F-SIGN-5** | `sign_gate.sign()` never read its `scope`. **FIXED — K CP6.** |
| **F-SIGN-7** | `merge_all` cherry-picked onto whatever was checked out; unit 1 would have died. **FIXED — K CP6.** |
| **F-SIGN-8** | ⚰️ **K CP5's `--is-ancestor` merged-state check was wrong** for a cherry-pick workflow. **RETRACTED and FIXED — K CP6** (`git cherry`). |
| **F-SIGN-9** | A run killed between a push and its settle bounced the next run off the Layer-0 guard. **FIXED — K CP6.** |
| **F-SIGN-10** | `sign_all.py` had no cp1252 reconfigure; refusals raised instead of printing. **FIXED — K CP6.** |
| **F-CI-29** | The parity lane ran nothing in CI. **CLOSED — 40 collected, 0 failures on run #27.** |
| **F-CI-31** | ⚰️ **RETRACTED — empty population.** Nothing was stale; the checkout was shallow. **CLOSED by `fetch-depth: 0`.** |
| **F-CI-32** | 27 of 121 entries (22%) are the depth-1 checkout. **FIXED — E CP26**, +6 s measured. |
| **F-CI-35** | `tests-05` exceeds its 20-minute cap. **STILL OPEN** — the split that would fix it was reverted (see F-CI-36); the remedy is a TIME-weighted partition. |
| **F-CI-36** | **`tests/test_voice_router.py` is order-dependent** — 52 of its tests return `402 Payment Required` when the file is shuffled into a different shard. **REPRODUCED LOCALLY AND DETERMINISTICALLY**: the 52 files that join its process at 12 buckets, then the file, → 52 failed / 939 passed. It passes alone (48 passed). Bisect in flight at session end. |
| **F-CI-38** | ⚠️ **96 test files install a `dependency_overrides[...]` on the shared `app`; only 50 ever clear one.** Not the cause of F-CI-36 (measured — `test_theme_sets` + the voice file pass together, 65 passed), but a standing class. **FILED.** |

---

## 8 · OPEN QUESTIONS

1. **Which of the 52 files leaks the state behind F-CI-36?** The bisect was running at
   session end; its oracle is proved non-vacuous at both ends (full set FAILS in 343 s,
   empty set clean in 31 s).
2. **`tests-05`'s cap** — a finer alphabetical split is ruled out (it caused F-CI-36). A
   time-weighted partition uses the `collect_profile` timings the workflow already gathers,
   and does not re-shuffle neighbours. It is a real change to `pytest_shards.py`.
3. **The two single-file product buckets** (`test_web_capture_coverage` 8 entries,
   `test_screener_wave2_analyst_store` 8) are classified but not investigated.
4. **F-CI-38** — an autouse fixture clearing `app.dependency_overrides` after each test is a
   one-file change with suite-wide blast radius. It needs its own run to score.

---

## 9 · [KEYBOARD]

```
# SITTING 1 — 86.1 min, rows 1-17
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp12-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp12-build-record

# SITTING 2 — 86.5 min, rows 18-39
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until d3-cp2-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until d3-cp2-build-record
```

**40 rows.** Runbook: `docs/terminal-research/SIGNING_SESSION.md`. Sitting totals **86.1**
and **86.5** minutes.

⛔ **Before the first merge:**
`git -C C:\Users\Patrick\uct-worktrees\s7-price-level checkout -B merge-run origin/master`

**Production impact:** 31 of 40 rows reach master.
**F-S2-1 is sitting 3, alone, and needs `--include-member-visible`.**

---

## 10 · Merge readiness

- **40/40 units mapped**; `merge_all --self-check` PASS; `--dry-run` 40 units, 32
  constraints, exit 0.
- `verify_manifest` **40 OK, 0 STALE**.
- Reader exit codes: `sign_gate` self-check and read-check both PASS; the three scope
  refusals return 2 / 3 / 4 with the file byte-identical.
- `sign_all --dry-run` **40 rows, 40 ok, 0 refusing**, exit 0.
- **Resume control PASSED** (§4).

---

## 11 · Three phone-readable sentences

1. **Every signature now says what it approved** — the signer dropped its scope argument on
   the floor, and three approvals in the tree already show it.
2. **The merge script would have died on unit one**, because it cherry-picks onto whatever
   is checked out and the worktree is on the feature branch; that and a wrong
   already-merged check are both fixed and both were found by building the resume control.
3. **The gate is promoted and green on its own terms**, and 22% of the failure list turned
   out to be a shallow checkout rather than the twenty-two stale tests it was called.

---

## 12 · Status

STATUS: RAN
