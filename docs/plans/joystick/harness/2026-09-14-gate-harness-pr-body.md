# PR body — `tools/gate-harness-2026-09-14` → `master`

> ⏳ **PREPARED, NOT OPENED.** The brief said prepare it. No PR exists.

---

## Title

```
gate harness: the exit code is READ, the verdict is a LINE, and clearance is SAMPLED
```

## Body

**Tooling, tests and docs only.** Every path is under `docs/`, `scripts/`, `tests/` or `tools/` —
**none** under `app/src/` or `api/`. The file list below is the evidence for that claim.

### The file list — `git diff --name-only master...HEAD`

```
docs/plans/joystick/harness/2026-09-14-box-clearance-first-reading.md
docs/plans/joystick/harness/2026-09-14-gate-harness-pr-body.md
docs/plans/joystick/harness/2026-09-14-gate-serialisation-proposal.md
scripts/gate_shards.py
tests/test_gate_box_sampler.py
tests/test_gate_shards.py
tools/gate_box_sampler.py
```

**7 files** (the last is this document itself). Merge-base **`47e1516b5`**; master was
**`154c50f71`** when this was written, 4 ahead.
`git merge-tree --write-tree` → **exit 0, no conflicts**.

⚠️ No head SHA is quoted here on purpose: this document ships *inside* the commit it describes, so
any SHA written in it is stale the moment it is written. Read the branch tip.

⚠️ **The list is a THREE-dot diff, and on this repo that is not a formality — it is measured.**
At the moment of writing, `master...HEAD` reports **7** files and `master..HEAD` reports **13**. The
six extra are not this branch's:

```
docs/notebook/deploy-checklist.md              tools/q1_window_queue.json
docs/notebook/expected-red-mutation-proof.md   docs/notebook/wave-q1-f5-production-matrix.json
docs/notebook/q1-red-cells-investigation.md    docs/notebook/wave-q1-f5-production-matrix.md
```

They are the **Notebook** workstream's, landed on master in the minutes since this branch was
rebased, and the two-dot form shows them **backwards** — as though this branch had reverted them. A
body asserting "tooling only" while listing another team's docs would refute itself in its own
evidence, which is exactly what the previous PR in this programme had to correct (two-dot **115**
against three-dot **29**).

⭐ **Four commits in the few minutes between the rebase and this sentence** is also the honest
reason the gap is small: master is moving quickly today. Re-run `master...HEAD` when you read this;
the set of seven is stable, the count of extras is not.

---

### 1 · The exit-code lie, fixed at its source

`scripts/gate_shards.py::_capture` — the function whose own docstring calls itself *"THE ONE PLACE A
SUBPROCESS IS READ"* — returned `proc.stdout + proc.stderr` and **never read `proc.returncode`**. So
at the one place this tool reads a process, exit 2 and exit 0 returned the same kind of value
carrying the same information. No caller could tell them apart, so none reported it, and an
unreported failure reads downstream as success.

**Reproduced deterministically** with a synthetic waiter printing
`TIMEOUT - box never cleared within 25 min` and exiting **2**, beside a control exiting **0**:

| waiter | true code | before | after |
|---|---|---|---|
| `timeout_exit2` | 2 | bare `str`, reportable code `0` | **2** |
| `clear_exit0` (control) | 0 | bare `str`, reportable code `0` | **0** |
| | | **distinguishes: NO** | **distinguishes: YES** |

⚰️ It is not hypothetical. On 2026-09-14 a box-clearance waiter did exactly this and what reached
the operator was **exit 0**; read as "clear", it would have sent a settling run into a live
six-shard gate and produced the load-contaminated answer that whole procedure exists to exclude.

**`Captured(str)` carries `.returncode` — a `str` subclass deliberately.** ⛔ This wrapper is
**shared**: it is on master, other workstreams run it, and one was running on this box during this
work. So every existing consumer — `.strip()`, `in`, `write_text`, `parse_totals` — keeps working
byte-for-byte, and a compatibility rail exercises all four. A tuple return would have touched every
call site and both existing capture rails to fix a bug in neither.

⛔ **Recorded, never the arbiter.** vitest exits 1 on an ordinary red test, so a non-zero shard is
not a defect; promoting this to a gate condition would fail every legitimately-red run twice. The
verdict stays the failing-set comparison. What the codes buy is *diagnosis* — the EMPTY CAPTURE and
NO TOTALS LINE refusals now say **why** a shard produced nothing, and `None` (not observed) stays
distinguishable from `0`.

### 2 · The verdict is a line of output

The exit code is not reliable **in transit**, twice measured in this repo: a runner that executed
nothing reported 0, and this wrapper printed its own `GATE EXIT: 1` while the task status said 0.
That channel is not ours to fix, so the tool stops depending on it:

```
VERDICT=NEW_FAILURES exit=1 new=1 no_longer_failing=0 expected_red_seen=0 ...
```

Derived from the **same manifest** as the exit code, in the same breath, so the two cannot disagree.
⛔ **Additive only** — not one existing line of output changed, not one exit code moved; a consumer
that has never heard of `VERDICT=` behaves exactly as before.

### 3 · Clearance is sampled DURING the run — `tools/gate_box_sampler.py`

On 2026-09-14 two settling runs checked the box before and after; both checks were clean, and a
third six-shard gate started between them and ran through the measurement. **Clearance is a property
of an interval, not of two instants.**

- **Interval 20s, derived** — a tenth of the *shortest* shard actually measured on this box
  (274.29s of six, read off the shard logs), so a shard cannot begin and end unseen. A rail
  re-derives the bound and fails if the constant drifts above it.
- **`classify_process` is pure and named so it can be shown things.** It must call a real gate a
  gate, and must refuse `tests/test_gate_shards.py` (the gate's own *test*, which once made this
  probe report a gate that did not exist) and a shell whose command line merely *mentions* the gate
  (which once fabricated *"7 gates running"* — the OOM-sweep signature). A **live** rail spawns a
  gate command line and the pytest decoy **simultaneously** and requires exactly one to be reported.
- Free memory recorded every sample; the **4.5 GB floor** stops the run cleanly as
  `INCONCLUSIVE-RESOURCE`.
- An empty sample set is `INCONCLUSIVE-NO-SAMPLES`. ⛔ *Nobody looked* is not *nothing was there* —
  an earlier sampler's caller read empty as contended.
- **Contention outranks resource:** a low memory reading taken during someone else's run is a fact
  about their run, and naming it RESOURCE would send the next reader to tune the wrong thing.

### 4 · Serialisation — ⏳ PROPOSAL ONLY, NOTHING ENFORCED

The brief said check for an existing convention first. **There is one**, and that changes the answer.

`tools/measure_lock.py` — the Notebook workstream's **R-S**. It locks the **tree** against edits
during a measurement, enforced by the OS read-only attribute. Its own docstring explains why its
lock lives in the git dir: *"two worktrees never share a lock by accident"* — correct for its
problem, and precisely why it **cannot see two gates on one box**, which is the 2026-09-14 failure.

Two facts reported, not acted on: it has **zero callers** today, and its `REPO` is hard-coded to
another worktree. **It is theirs; this branch changes nothing of it.**

`docs/plans/joystick/harness/2026-09-14-gate-serialisation-proposal.md` is a **DRAFT needing an
owner ruling** — it changes no behaviour and no file, and it ends with four questions.

### 5 · ⛔ The `ThemeTrackerPage.chartmount` re-measurement was SKIPPED, on evidence

Scoped in the brief as *"only if the box is clear under the new sampler, otherwise skip and say so."*
It is not clear:

```
VERDICT=INCONCLUSIVE-CONTENDED exit=3 samples=7 min_free_gb=9.43 pid=7668 kind=vitest intruders=4
```

⭐ **The first and last of those seven samples are both CLEAN.** An endpoint check would have
reported CLEAR. The contention — vitest workers from `uct-worktrees/indicator-r0r1` — is visible
only because the interval was sampled, and it appeared twice inside two minutes. The 2026-09-14
failure reproduced itself against the instrument built to catch it, on that instrument's first real
use, unstaged.

**Nothing was removed, re-banked or changed. The baseline count stays at 10.** Those two entries are
already classified *load-sensitive (~4 s)*, so a timing measurement taken beside someone else's
vitest workers cannot separate the hypothesis from the contamination — and #9's five runs are
already on record as the case where a "load" label predicted nothing. Record:
`docs/plans/joystick/harness/2026-09-14-box-clearance-first-reading.md`.

### 6 · Rebased onto master, and the collision that exposed

Master shipped two commits to this same file while this branch was being written — `3a489fd22`
(`expected_red`: a deliberate reproduction is not a regression) and `22fe481bf` (the coverage check
is part of the verdict, `EXIT_DID_NOT_RECONCILE = 3`). Both landed at the same insertion point.
**Both sides are kept; nothing of master's was discarded.**

⛔ **The collision was not cosmetic.** `VERDICT_NAMES` knew 0, 1 and 2 — so master's new code would
have printed `VERDICT=UNKNOWN exit=3`. That is a suite which did not run every file, the outcome
that fails in the *flattering* direction, rendered anonymous on the very line this branch tells an
operator to read instead of the exit code. It is named now, the line also carries
`expected_red_seen` / `expected_red_stale`, and a rail **derives** the set of `EXIT_*` constants
from the module and fails when a code arrives without a name — so the next one is covered by
someone who has never read this file.

---

### Tests

```
68 passed, 3027 warnings in 602.04s (0:10:02)
```

`python -m pytest tests/test_gate_shards.py tests/test_gate_box_sampler.py -q` — scoped, named
files, never a repo-wide run. Every rail is paired with a control that must return the other
answer, because every historical failure here was an instrument giving one answer to two questions.

**Mutation-proved** (original bytes captured first and restored by sha256 — never `git checkout --`):

| mutation | result |
|---|---|
| `Captured` pinned to `returncode = 0` (the shipped bug, in one line) | **RED** — and only the exit-2 rail, not its control |
| the `VERDICT=` line not emitted on a valid run | **RED** |
| an unobserved code rendered as `0` | **RED** |

Both self-checks pass and both can fail: `tools/gate_box_sampler.py --self-check` is re-run with the
decoy defence removed and must report failure.

### Reviewer checks

1. `scripts/gate_shards.py` is the only behavioural file changed; `tools/gate_box_sampler.py` is new.
2. No existing output line or exit code moved — `VERDICT=` is purely additive.
3. Master's `expected_red` and `EXIT_DID_NOT_RECONCILE` are both intact and both now named.
4. §4 is a draft. No lock is taken and nothing refuses anything.
5. The baseline is untouched — still 10, `#9` still `provisional: true`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QhCGpjyZyKAqNZbFuwVHRW
