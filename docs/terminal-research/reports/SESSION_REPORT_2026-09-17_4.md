# SESSION REPORT — 2026-09-17, session 4

**✅ F-MERGE-2 is CLOSED and `pre_sitting` reads READY.** The resolution lives *beside* the
commit, keyed by pre-image blob hashes — and it proved itself twice when master moved under it
mid-session without invalidating anything. **O, C and the sittings were not reached.**

---

## 1 · ET, trees, remote, freeze, poll log

```
ET start   2026-09-17 13:01 EDT Thu   (tools/weekly_exec.py et)
ET end     2026-09-17 15:20 EDT Thu
remote     https://github.com/unchartedterritory5995-cyber/UCT-Dashboard.git
origin/master  f86c3759e -> e50c0552d -> 0ec4d52e9   (twice this session, 6th and 7th moves)
code   feat/s7-price-level 4c4ba1cb1   UNCHANGED — not rewritten, not force-pushed
docs   83b3858f3 -> e1df9f81c
freeze  81/81 OK at start · authorised window · re-recorded 84/84 at the end
poll log  none — no CI run started this session
```

⭐ **`tests/conftest.py`'s blob never changed across either move** (`f4193ea6a` throughout),
which is exactly the distinction the resolution mechanism is keyed on.

## 2 · K CP11 — a strand is resolved from a recorded artifact

**The record** — `resolutions/e-cp28-build-record--tests-conftest-py.md`:

```
row               e-cp28-build-record          path  tests/conftest.py
unit commit       304ac481c    UNCHANGED — same SHA, same patch-id, no force-push
master pre-image  f4193ea6a335c6e2e7c0a3596dee1c15e9362841
unit   pre-image  056d959ec5ce7adc79be70af6464507a78cc4b54
resolved blob     ca74b3c5bfa2b806d7bbfcb155d95cec279222a4
```

**Additive proof, against the recorded pre-image:** `0 removed, 45 added`, and the added lines
are **byte-equal to E CP28's own hunk**.

**Mutation proof — four arms, and only the fourth attempt discriminated:**

```
A  master's conftest, class fix ABSENT      41 failed, 21 passed   <- the leak is LIVE on master
B  the resolved file                        62 passed
C  the cleanup ENTIRELY removed             41 failed, 21 passed   <- load-bearing
D  restored by EDIT                         62 passed
```

⚰️ **Two earlier attempts were vacuous, and each looked like a pass:** using the *post-fix*
router test made the class fix redundant (62 everywhere); and mutating only
`update(before or {})` left `clear()` in place, **which alone already stops the leak** — that
tested *restore vs clear*, not *fixture present vs absent*. ⭐ Arm **A** is what makes the rest
mean anything: the defect is still live on today's master.

**Controls — 5 for the mechanism, 4 for the validator, plus the new standing rule:**

```
1 matching resolution               -> CLEAN, "1 resolution applied: <file>"        ok
2 master pre-image off by ONE byte  -> STRAND-UNRESOLVED, NAMING the mismatch       ok
3 no resolution                     -> plain STRAND naming the file                 ok
4 resolved-blob != content          -> REFUSED-CORRUPT-RESOLUTION                   ok
5 no conflict, resolution present   -> not applied, count 0                         ok  <- non-vacuity
check_resolutions: real 0 · unknown row 1 · corrupt hash 1 · empty folder 0 (0 parsed)
⛔ EVERY REAL PACKET'S HASH IS UNCHANGED -> []   (74 packets, before and after)
```

⚰️ **Two controls could not fire as first written:** `check_resolutions` loaded a *fresh*
`merge_all` per call, so redirecting the caller's copy reached nothing (made injectable); and
`REFUSED-CORRUPT-RESOLUTION` fired on its **first real run** because the record's `content`
line carried trailing prose. ⛔ **Fixed by tightening the record, never the parser** — a parser
that tolerates prose is how CODE-NEVER-PROSE gets lost.

**The result, on the true base:**

```
[merge-all] replay CLEAN 47 of 47  onto origin/master (0ec4d52e9)
            (1 resolution applied: e-cp28-build-record--tests-conftest-py.md)
```

## 3 · K CP10 — rowed late, and why that is itself a finding

K CP10 (sign-per-unit) shipped last session in `1e10fd0d7` with **no build record and no
manifest row** — the same "work with no signable checkpoint" shape as F-SIGN-1, committed in
the session that found F-SIGN-1. Recorded now, with its own 8 controls and F-SIGN-19's
incident written into it.

## 4 · Sections not reached

**O (F-OPS-1)**, **C (true-base preview CI)** and **S (the four sittings)** were not started.
The blocker they were gated on is cleared; they are the next session's first act.

⚠️ **F-OPS-1 stands unfixed:** `weekly_exec.py et` still prints
`master-push window: CLOSED (Mon-Fri 09:00-16:00 ET)` — the blanket rule that
`docs/runbooks/deploy-windows.md` superseded on 2026-09-11. Derived again this session: all 47
units are **Tier 1** (32 files: tools 14 · app 10 · tests 5 · .github 1 · CLAUDE.md 1 · api 1,
the one `api/` file being `api/routers/stream.py`, which the authority says is not on
flow-worker's watch list), and `flow_worker_watch_coverage` exits **0**. Push any time.

## 5 · Per-sitting record

None — no sitting was run. Nothing signed, nothing merged, nothing on master.

## 6 · Post-merge premise audit

Unchanged in `POST_MERGE_QUEUE.md`, still deliberately not started: it must run against
post-merge master.

## 7 · Findings filed / closed

| id | finding | state |
|---|---|---|
| **F-MERGE-2** | the merge stranded at #41 on `tests/conftest.py` | ✅ **CLOSED** — recorded resolution, replay CLEAN 47/47 |
| **F-MERGE-3** | a commit cannot be rewritten to "fit a moved base" — its patch carries the base's own change | ✅ **CLOSED by method** — the fix lives beside the commit |
| **F-SIGN-20** | K CP10 shipped with no build record and no manifest row | ✅ **CLOSED** — rowed, with controls |
| **F-SIGN-21** | `pre_sitting`'s REPLAY row was `$`-anchored and went blank when the CLEAN line grew | ✅ FIXED |
| **F-OPS-1** | `weekly_exec.py` prints a superseded clock window; `deploy-windows.md` is the authority | ⛔ **OPEN** — next session's section O |
| **F-CI-42** | Notebook self-check reads the live repo | ⛔ OPEN, untouched |
| **F-CI-43** | CI never ran on master | ✅ CLOSED (E CP34, row 52) |

## 8 · OPEN QUESTIONS

- **Master moved 7 times in 4 sessions.** Every base move is survivable while no *unit file*
  moves; the first time master touches one, a resolution must be re-derived. How many
  re-derivations before the branch should simply be rebased?
- **F-OPS-1** — should `weekly_exec` read `deploy-windows.md`, or stop printing a window?
- **The preview CI run** takes ~20 min against a base that moves hourly; is a pre-merge run
  ever "current" enough, or is the per-unit deploy wait the real gate?

## 9 · Owner-readable summary

**Nothing reached master. Nothing was signed. Members are unaffected.**

**The blocker is gone.** Your ruling — resolve at merge time from a recorded resolution —
works, and it is now proven three ways: the conflict fix is additive (nothing of master's
removed), it still catches the bug it was written for on *today's* master, and the full
47-unit merge replays cleanly with it applied. E CP28's commit was not touched: same identity,
no force-push.

**The part worth knowing:** master moved twice more while this ran, and the fix stayed valid
both times — because it is keyed to the *contents of the file* it was proven against, not to a
position in history. It only needs redoing if someone edits that one test file.

**What is left:** one small tidy (a tool still printing an old push-window rule), one CI run on
the merge preview, then the four sittings.

**Where to watch:** nothing is in flight. No deploys, no CI runs from this session.

## 10 · Merge readiness

```
rows 54   SIGNED 0   MERGED 0
universe  47 covered 47, exit 0        verify_manifest 54 OK, 0 STALE
resolutions 1 parsed, 0 corrupt        drift (54, 54)
replay    CLEAN 47 of 47 onto origin/master (0ec4d52e9), 1 resolution applied
freeze    84/84 OK                     pre_sitting  READY
```

✅ **READY.** The next session runs O, then C, then Sitting 1.

## 11 · Three phone-readable sentences

**The conflict is closed and the branch was not touched to do it** — the fix sits beside the
commit as a recorded, proven artifact, applied only when the two files it was proven against
are byte-for-byte what it expects.

**Master moved twice more while this ran and the fix survived both**, because it is keyed to
file contents rather than to a place in history; it only needs redoing if someone edits that
one test file.

**Everything now reads ready** — fifty-four rows verified, the full merge replays cleanly on
today's master, and the only things left before the merge itself are one small tidy and one
test run.

## 12 · Status

⚠️ None of the four codes fits exactly: nothing failed, the environment was fine, and
"NOTHING-READY" is the opposite of the truth — everything reads READY. The session ran its
work and did not reach sections O, C and S. `RAN`, with section 4 naming precisely what was
not reached.

STATUS: RAN
