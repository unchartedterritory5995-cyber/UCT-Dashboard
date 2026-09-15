# PR body — `tools/gate-harness-2026-09-14` → `master`

> ⏳ **PREPARED, NOT OPENED.** No PR exists.

---

## Title

```
gate harness: the exit code is READ, the verdict is a LINE, clearance is SAMPLED, and the box is LOCKED
```

## Body

**Tooling, tests and docs only.** Every path is under `docs/`, `scripts/`, `tests/` or `tools/` —
**none** under `app/src/` or `api/`. The file list is the evidence.

### The file list — `git diff --name-only master...HEAD`

```
docs/plans/joystick/harness/2026-09-14-box-clearance-first-reading.md
docs/plans/joystick/harness/2026-09-14-gate-harness-pr-body.md
docs/plans/joystick/harness/2026-09-14-gate-lock-adoption.md
docs/plans/joystick/harness/2026-09-14-gate-serialisation-proposal.md
docs/plans/joystick/stage-2-verification.md
scripts/gate_shards.py
tests/test_gate_box_lock.py
tests/test_gate_box_sampler.py
tests/test_gate_shards.py
tools/gate_box_lock.py
tools/gate_box_sampler.py
```

**11 files.** Merge-base **`47e1516b5`**; master **`569485a12`**.
`git merge-tree --write-tree` → **exit 0, no conflicts**.

⚠️ No head SHA is quoted: this document ships *inside* the commit it describes, so any SHA written
here is stale the moment it is written. Read the branch tip.

⚠️ **Three-dot, and on this repo that is measured, not ceremonial.** `master...HEAD` reports
**11**; `master..HEAD` reports **97**. The extra are other workstreams' files landed on
master since the base, shown **backwards** — as though this branch had reverted them. A body
asserting "tooling only" while listing another team's docs would refute itself in its own evidence,
which is exactly what an earlier PR here had to correct (two-dot **115** against three-dot **29**).

⚰️ **This list was wrong once, in this very file.** It was generated while the three new
files were still untracked, and a diff cannot see an untracked file — so it reported 8 and
silently omitted `gate_box_lock.py`, its rails, and the adoption note. ⭐ **Derive the list
AFTER the commit, never before it**: a file list assembled from a working tree is a claim
about what git can see, not about what the branch contains.

---

## What this branch does, in one line each

1. **`_capture` reads the exit code it used to throw away** — the one place this tool reads a
   subprocess returned the same value for exit 2 and exit 0.
2. **The wrapper prints a `VERDICT=` line**, because the exit code is not trustworthy in transit.
3. **`tools/gate_box_sampler.py`** samples box clearance *during* a run, not at its endpoints.
4. **`tools/gate_box_lock.py`** — a machine-wide advisory lock, owner rulings R1/R2/R3.
5. **An adoption note** naming every other entry point that can start a gate-shaped run here.

---

### 1 · The exit-code lie, fixed at its source

`scripts/gate_shards.py::_capture` — the function whose own docstring calls itself *"THE ONE PLACE A
SUBPROCESS IS READ"* — returned `proc.stdout + proc.stderr` and **never read `proc.returncode`**.

| waiter | true code | before | after |
|---|---|---|---|
| prints `TIMEOUT …`, exits 2 | 2 | bare `str`, reportable `0` | **2** |
| control, exits 0 | 0 | bare `str`, reportable `0` | **0** |
| | | **distinguishes: NO** | **YES** |

⚰️ On 2026-09-14 a box-clearance waiter did exactly this; what reached the operator was **exit 0**.
Read as "clear", it would have sent a settling run into a live six-shard gate.

`Captured(str)` carries `.returncode` — a **`str` subclass deliberately**, because this wrapper is
shared and other workstreams run it. Every existing consumer keeps working byte-for-byte.
⛔ **Recorded, never the arbiter**: vitest exits 1 on an ordinary red test.

### 2 · The verdict is a line of output

```
VERDICT=NEW_FAILURES exit=1 new=1 no_longer_failing=0 expected_red_seen=0 …
```

Derived from the **same manifest** as the exit code, in the same breath. ⛔ Additive only.

### 3 · Clearance is sampled DURING the run

Interval **20 s, derived** — a tenth of the shortest shard measured on this box (274.29 s of six).
`classify_process` is pure and named so it can be *shown* things: it must call a real gate a gate,
and refuse both `tests/test_gate_shards.py` (the gate's own test) and a shell that merely mentions
the gate. Free memory every sample; **4.5 GB floor**; an empty sample set is
`INCONCLUSIVE-NO-SAMPLES`; **contention outranks resource**.

⚰️ **Third body of this tool's own disease, found while re-verifying:** `_self_pids()` walked
*ancestors* only, so a run wrapped with `--watch-pid` reported **its own children** as intruders —
and this suite deliberately spawns a gate-shaped process. Fixed with a descendant walk; the control
proves a **sibling** is still caught.

### 4 · The box lock — owner rulings R1 / R2 / R3

**R2 — a second tool, and `measure_lock.py` is not touched.** The two answer different questions and
are named so they cannot be confused:

| | `measure_lock.py` (Notebook's R-S) | `gate_box_lock.py` (new) |
|---|---|---|
| answers | *is this **tree** safe to edit?* | *is this **box** free to measure?* |
| scope | one worktree | the whole machine |
| lives in | the git dir, per-worktree | `%PROGRAMDATA%\uct\gate-box.lock` |
| enforces | the OS read-only attribute — real | **advisory** |
| stale when | pid dead **or** heartbeat TTL | **pid dead. ONLY.** |

**The lock file is `%PROGRAMDATA%\uct\gate-box.lock`**, and each rejected alternative is a real
failure mode: **not the git dir** (per-worktree — the exact property this must not have); **not the
working tree** (`gate_shards` refuses a dirty tree, so a lock inside it deadlocks what it protects —
`measure_lock` shipped that way once, and `.gitignore` is not the fix); **not `%TEMP%`** (per-user
and swept by disk cleanup — a lock that can vanish under a live holder fails silently); **not
anything under `/data`** (`C:\data` is live owner data).

- **Atomic create** — `O_CREAT|O_EXCL`, never check-then-write. Proved by six real processes on a
  start barrier: exactly one wins, **and the winner did not reclaim** (see the race note below).
- **Contents**: pid, command line, worktree, workstream, `started_at`, hostname.
- **Stale = holder pid dead, and the reclaim is RECORDED** in the manifest, so a crashed gate is
  visible rather than silently forgotten. ⛔ **Alive-but-idle is NOT stale** (R1) — that is exactly a
  Live session waiting on a device mirror, and ageing it out would hand the box to a second gate.
- ⛔ **A corrupt lock reads as HELD, never as a free box.** A truncated write must not fail in the
  flattering direction.
- **Release is idempotent and only ever removes our own lock** — a blind release turns one crashed
  run into a free-for-all.

**R3 — the bypass lets you run; it does not let you pretend.** `UCT_SKIP_GATE_BOX_LOCK="<reason>"`,
the `UCT_SKIP_PREPUSH_GUARD` shape, logged to `logs/gate-box-lock-bypass.log` (ignored by git — a
bypass log that dirties the tree would deadlock the gate it belongs to). A blank reason is
**ignored**, i.e. refused as if unset. And the rule that matters:

> `test_R3_a_bypassed_run_under_a_live_holder_still_lands_INCONCLUSIVE_CONTENDED`

drives it end to end — live holder, bypass *with* a reason, and then the sampler, which knows
nothing about locks, asked for its verdict. It returns `INCONCLUSIVE-CONTENDED`, never `CLEAR`. The
bypass also does **not** steal the lock: the holder keeps it.

**Wired into `gate_shards.py` minimally.** `main()` became an arg-parse + lock shell around the
unchanged body, so `finally` covers every exit path — a verdict, a `GateError` refusal, any
exception. New code **`EXIT_LOCK_HELD = 4`**, named **`REFUSED-LOCK`** — ⛔ *not* a suite verdict,
consistent with how `stage-2-verification.md` §2 now treats `run-hub-rails.mjs`'s exit 2.

⭐ **The `EXIT_*` derivation rail covered the new code with ZERO edits to the rail:**

```
0  EXIT_NO_NEW                -> VERDICT=NO_NEW_FAILURES
1  EXIT_NEW_FAILURES          -> VERDICT=NEW_FAILURES
2  EXIT_INVALID               -> VERDICT=INVALID
3  EXIT_DID_NOT_RECONCILE     -> VERDICT=DID_NOT_RECONCILE
4  EXIT_LOCK_HELD             -> VERDICT=REFUSED-LOCK
unnamed: none
```

and it has teeth — adding an `EXIT_*` with no name turns it **RED**.

### 5 · Adoption note — a list, not enforcement

`…/2026-09-14-gate-lock-adoption.md` names **every** entry point that starts a gate-shaped run on
this box, by path and owner, derived by AST (docstring mentions discarded — `tools/tests_reaching.py`
mentions vitest in prose and is correctly *not* listed). ⛔ Its first paragraph says plainly that the
lock protects only runs going through `gate_shards.py`, so nobody reads it as coverage it does not
have. **Nothing on that list was edited.**

---

### ⚰️ A finding worth the space: the race test was wrong, and the lock was innocent

The first version of the atomic-create rail reported **four winners out of six**. The lock was
correct. The racers *exited the moment they printed*, so each winner's lock became stale within
milliseconds and the next racer legitimately **reclaimed** it — three of the four carried
`reclaimed=True`, and only one had won the actual create.

⭐ The lesson generalises past this file: **when staleness is defined by pid liveness, a holder that
dies instantly cannot be used to test contention at all.** The rail now keeps racers alive past the
window *and* asserts the winner did not reclaim — two assertions that fail for different reasons.

---

### 8 · The snapshot can fail, and a failed snapshot is not a clean one

**The defect, in two sentences.** `tools/gate_box_sampler.py` parsed its PowerShell snapshot with
`json.loads(proc.stdout)`, which raised `JSONDecodeError: Invalid control character at: line 1
column 106641` on live data — `ConvertTo-Json` had emitted a raw control character inside a
process's command line. `JSONDecodeError` subclasses `ValueError`, **not** `RuntimeError`, and
`watch()` catches `RuntimeError` only, so the exception walked past the handler written to contain
it, killed the run, and recorded nothing.

⛔ **Fixing the crash alone would have left the worse half open.** `watch()` used to print a failed
sample and *skip* it, so an interval where some snapshots failed still returned **CLEAR** from the
survivors — an unobserved instant reported as clean, which is the "absence recorded as a pass"
shape this whole tool exists to refuse.

Both halves are closed:

- **The parse** — `json.loads(..., strict=False)`, and any `ValueError` is converted to the
  `RuntimeError` callers already handle, so this function keeps **one contract**: it raises
  `RuntimeError` on any failure to produce a snapshot, whatever the cause.
- **The accounting** — a failed snapshot is **recorded** as an unobserved marker sample carrying
  `free_gb: None` and an empty foreign list (nothing was observed; inventing either would be the
  fabrication refused everywhere else), and a new verdict **`EXIT_UNOBSERVED = 6` /
  `INCONCLUSIVE-UNOBSERVED`** makes such an interval un-CLEAR-able.
- Precedence is deliberate: **contention** (a process actually seen — a positive finding naming a
  culprit) outranks **resource** (measured and actionable) outranks **unobserved** (the residual
  "we cannot honestly call this clear").

`tools/gate_box_sampler.py:200` is the **only** place a snapshot is parsed — verified from
`git show`. (`gate_box_lock.py:167` parses the *lock file*, a different source, already wrapped in
`except (OSError, ValueError)` returning a corrupt-marker.)

**Controls, all railed:**

| control | proves |
|---|---|
| (a) raw `` inside a gate command line | parsed **and** the process is still classified `gate` — a fix that dropped the row would read the box as quiet while a real gate ran |
| (b) truncated snapshot through `watch()` | recorded as an unobserved sample; run continues; verdict `INCONCLUSIVE-UNOBSERVED`, never CLEAR |
| (c) identical run, valid snapshot | `CLEAR` — so (b) is attributable to the bad snapshot, not to the harness |

⭐ **(b) is shown red-then-green**, which is the point of it: on the pre-fix file the
`JSONDecodeError` escapes `watch()` and the test errors out.

    pre-fix  sha256: 013ca553428e784baf097858221992088db00414686f6acf0667ab21c6e39956  -> RED
    fixed    sha256: 397c15fb2299c73d8b66e3434e5ca63ee0da12424e9fc066f2b76b8ed05d0e7f  -> GREEN

Bytes captured first and restored by sha256; never `git checkout --`.

⚠️ **The fixture is a stated stand-in.** The crashing snapshot was not kept and the offending
process is gone — a live snapshot taken while writing this contained **zero** raw control
characters. What is reproduced is its *shape*: a raw control byte inside a command-line string
value, which is where char 106640 sat. `json.dumps` would escape it to a valid ``, so the
escape is deliberately un-escaped back into a raw byte, and a non-vacuity rail asserts the fixture
really does defeat a strict parse.

⭐ **Two defects this found in passing.** A second unguarded `min(s["free_gb"] …)` in the
*contended* branch would have raised on a marker sample — caught by a precedence control, not by
review. And `watch()` consumes one snapshot before it samples (for `_self_pids()`), so a stub
sequence that forgets it feeds its first payload to a call that never reaches the sample set; the
first draft of one rail passed for exactly that wrong reason.

⚠️ **The file count does not move: still 11.** Both files this commit touches —
`tools/gate_box_sampler.py` and `tests/test_gate_box_sampler.py` — were already in the three-dot
set. The commit changes their contents, not the set.

### Tests

```
83 passed, 3902 warnings in 916.48s (0:15:16)
```

⭐ **Run under the continuous sampler, and admissible:** `VERDICT=CLEAR exit=0 samples=46 min_free_gb=10.3` — 46 samples over the whole interval, no foreign gate or vitest worker in any of them. ⛔ Two earlier attempts were **not** admissible and are not quoted as results: one landed `INCONCLUSIVE-CONTENDED` under another session's six-shard gate, and one exposed the suite defect in the box below.

`python -m pytest tests/test_gate_shards.py tests/test_gate_box_sampler.py tests/test_gate_box_lock.py -q`
— scoped, named files, never repo-wide. Every rail is paired with a control that must return the
other answer.

**Controls, as required — each with its opposite:**

| claim | control that must answer differently |
|---|---|
| no lock → runs normally | live holder → refused |
| live holder → refused, holder **named** (pid, cmdline, `started_at`) | dead holder → reclaimed |
| dead holder → reclaimed **and recorded** | alive-but-idle → still HELD, not aged out |
| bypass **with** reason → runs, still CONTENDED | bypass **without** reason → refused as if unset |
| six racers → exactly one wins, **without reclaiming** | zero would mean broken; two would mean not a lock |
| release removes our own lock | release refuses another pid's |
| lock tool's own process → never a finding | a real gate line → still classified `gate` |

**Mutation-proved** (bytes captured first, restored by sha256 — never `git checkout --`):
`Captured` pinned to 0 → RED; the `VERDICT=` line suppressed → RED; an unobserved code rendered as
`0` → RED; an `EXIT_*` added with no name → RED.

### Reviewer checks

1. `scripts/gate_shards.py` is the only behavioural file changed; the two `gate_box_*` tools are new.
2. `tools/measure_lock.py` is **untouched** (R2), as is everything owned by notebook-kill-switch and
   indicator-r0r1.
3. No existing output line or exit code moved; `VERDICT=` and `EXIT_LOCK_HELD` are additive.
4. The serialisation proposal and the adoption note are **drafts**; no lock is imposed on anyone.
5. The baseline is untouched — still 10, `#9` still `provisional: true`; boxes 1 and 2 still ☐.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QhCGpjyZyKAqNZbFuwVHRW
