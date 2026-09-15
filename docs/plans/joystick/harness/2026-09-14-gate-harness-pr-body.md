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
docs/plans/joystick/stage-2-verification.md
scripts/gate_shards.py
tests/test_gate_box_sampler.py
tests/test_gate_shards.py
tools/gate_box_sampler.py
```

**8 files** (one is this document itself). Merge-base **`47e1516b5`**; master **`154c50f71`**,
4 commits ahead. `git merge-tree --write-tree` → **exit 0, no conflicts**.

⚠️ No head SHA is quoted: this document ships *inside* the commit it describes, so any SHA written
here is stale the moment it is written. Read the branch tip.

⚠️ **The list is a THREE-dot diff, and on this repo that is measured, not ceremonial.**
`master...HEAD` reports **8** files; `master..HEAD` reports **13**. The extra are the **Notebook**
workstream's, landed on master since this branch was based, and the two-dot form shows them
**backwards** — as though this branch had reverted them:

```
docs/notebook/deploy-checklist.md              docs/notebook/wave-q1-f5-production-matrix.json
docs/notebook/expected-red-mutation-proof.md   docs/notebook/wave-q1-f5-production-matrix.md
docs/notebook/q1-red-cells-investigation.md    tools/q1_window_queue.json
```

A body asserting "tooling only" while listing another team's docs would refute itself in its own
evidence — which is exactly what the previous PR in this programme had to correct (two-dot **115**
against three-dot **29**).

### Re-verified against current master

- Master's 4 commits since the base touch **only** Notebook/Wave-Q1 files. **Zero overlap** with
  this branch's eight.
- `scripts/gate_shards.py` blob is **byte-identical** at the base and at master — the wrapper has
  not moved again, so there is no hunk to reconcile.
- The `EXIT_*` derivation was re-run **against the merge-result tree**, not the branch: all four
  codes (`0 NO_NEW_FAILURES`, `1 NEW_FAILURES`, `2 INVALID`, `3 DID_NOT_RECONCILE`) resolve to a
  name; none would print `UNKNOWN`.

---

### 1 · The exit-code lie, fixed at its source

`scripts/gate_shards.py::_capture` — the function whose own docstring calls itself *"THE ONE PLACE A
SUBPROCESS IS READ"* — returned `proc.stdout + proc.stderr` and **never read `proc.returncode`**. At
the one place this tool reads a process, exit 2 and exit 0 returned the same kind of value carrying
the same information. No caller could tell them apart, so none reported it, and an unreported
failure reads downstream as success.

**Reproduced deterministically** — a synthetic waiter printing `TIMEOUT - box never cleared within
25 min` and exiting **2**, beside a control exiting **0**:

| waiter | true code | before | after |
|---|---|---|---|
| `timeout_exit2` | 2 | bare `str`, reportable code `0` | **2** |
| `clear_exit0` (control) | 0 | bare `str`, reportable code `0` | **0** |
| | | **distinguishes: NO** | **distinguishes: YES** |

⚰️ Not hypothetical: on 2026-09-14 a box-clearance waiter did exactly this and what reached the
operator was **exit 0**. Read as "clear", it would have sent a settling run into a live six-shard
gate and produced the load-contaminated answer that procedure exists to exclude.

**`Captured(str)` carries `.returncode` — a `str` subclass deliberately.** ⛔ This wrapper is
**shared**: it is on master and other workstreams run it — one was running on this box during this
work, and another during the re-verification. So every existing consumer (`.strip()`, `in`,
`write_text`, `parse_totals`) keeps working byte-for-byte, and a compatibility rail exercises all
four. A tuple return would have touched every call site and both existing capture rails to fix a
bug in neither.

⛔ **Recorded, never the arbiter.** vitest exits 1 on an ordinary red test, so a non-zero shard is
not a defect; promoting this to a gate condition would fail every legitimately-red run twice. The
codes buy *diagnosis*: the EMPTY CAPTURE and NO TOTALS LINE refusals now say **why** a shard
produced nothing, and `None` (not observed) stays distinguishable from `0`.

### 2 · The verdict is a line of output

The exit code is not reliable **in transit** — twice measured here: a runner that executed nothing
reported 0, and this wrapper printed its own `GATE EXIT: 1` while the task status said 0. That
channel is not ours to fix, so the tool stops depending on it:

```
VERDICT=NEW_FAILURES exit=1 new=1 no_longer_failing=0 expected_red_seen=0 ...
```

Derived from the **same manifest** as the exit code, in the same breath, so the two cannot disagree.
⛔ **Additive only** — no existing output line changed, no exit code moved.

### 3 · Clearance is sampled DURING the run — `tools/gate_box_sampler.py`

On 2026-09-14 two settling runs checked the box before and after; both were clean, and a third
six-shard gate started between them and ran through the measurement. **Clearance is a property of an
interval, not of two instants.**

- **Interval 20s, derived** — a tenth of the *shortest* shard measured on this box (274.29s of six,
  read off the shard logs). A rail re-derives the bound and fails if the constant drifts above it.
- **`classify_process` is pure and named so it can be shown things.** It must call a real gate a
  gate, and must refuse `tests/test_gate_shards.py` (the gate's own *test*, which once made this
  probe report a gate that did not exist) and a shell whose command line merely *mentions* the gate
  (which once fabricated *"7 gates running"* — the OOM-sweep signature).
- Free memory recorded every sample; the **4.5 GB floor** stops cleanly as `INCONCLUSIVE-RESOURCE`.
- An empty sample set is `INCONCLUSIVE-NO-SAMPLES`. ⛔ *Nobody looked* ≠ *nothing was there*.
- **Contention outranks resource**: a low reading taken during someone else's run is a fact about
  their run.

### 4 · ⚰️ Third body of this tool's own disease — found during re-verification

`_self_pids()` walked **ancestors only**. That stops a shell from reporting itself; nothing walked
**downward**, so a run wrapped with `--watch-pid` reported **its own children** as intruders.

Not theoretical: `tests/test_gate_box_sampler.py` deliberately spawns a process carrying a gate
command line, so sampling the suite that tests this tool made the tool fail its own measurement —
and the failure would have looked **exactly like real contention**, which is the worst possible
disguise.

Fixed with a descendant walk computed from the *same snapshot* as the classification. Two rails:
a live one, and a transitivity control proving a **sibling** process is still caught (an exclusion
wide enough to swallow a real gate would disable the check it lives inside).

⭐ **Proven on real data within the hour.** During the re-verification run a genuine foreign gate
appeared — `pid 36644`, `python -u scripts/gate_shards.py --shards 6`, ancestry `bash ← bash ← bash
← claude.exe`, working in `uct-worktrees/notebook-k`. My own suite's spawned fixtures sat in my
subtree and were correctly excluded; the foreign gate was caught. Before this fix the two were
indistinguishable.

### 5 · Serialisation — ⏳ PROPOSAL ONLY, NOTHING ENFORCED

The brief said check for an existing convention first. **There is one**, and that changes the answer.

`tools/measure_lock.py` — the Notebook workstream's **R-S**. It locks the **tree** against edits
during a measurement, enforced by the OS read-only attribute. Its own docstring explains why its
lock lives in the git dir: *"two worktrees never share a lock by accident"* — correct for its
problem, and precisely why it **cannot see two gates on one box**.

Reported, not acted on: it has **zero callers** today, and its `REPO` is hard-coded to another
worktree. **It is theirs; this branch changes nothing of it.**

`…/2026-09-14-gate-serialisation-proposal.md` is a **DRAFT needing an owner ruling**, ending in four
questions. It changes no behaviour and no file.

⚠️ **The case for ruling on it got stronger during this PR's own re-verification**: a second session
started a six-shard gate on a box that already had a measurement running. That is the gap, observed
twice in one evening, unprompted.

### 6 · Runbook alignment — `stage-2-verification.md` §2

**+26 / −0, a pure addition.** Twelve headings before and after; steps 0–9 not renumbered, none
started. It records how to read a verdict now: `test:hub` emits no `VERDICT=` line and should not;
its **exit 2 is a refusal, not a verdict**; when the sharded gate is run, read `VERDICT=` and never
`$?`; per-shard exit codes are recorded, never the arbiter; and box clearance is sampled during the
run, `CLEAR` or `INCONCLUSIVE-CONTENDED`.

### 7 · ⛔ The `ThemeTrackerPage.chartmount` re-measurement was SKIPPED again, on evidence

Scoped as *"only under a CLEAR `--watch` for the whole run."* It was not clear — a **six-shard gate**
held the box:

```
VERDICT=INCONCLUSIVE-CONTENDED exit=3 samples=43 min_free_gb=7.95
  first_seen=2026-09-14T23:05:44 pid=36644 kind=gate intruders=147
  pid 36644  gate  seen in 37/43 samples, 23:05:44 .. 23:18:17
             C:\Python314\python.exe -u scripts/gate_shards.py --shards 6
```

**Nothing was removed, re-banked or renumbered. The baseline count stays at 10, `#9` still
`provisional: true`.** Those two entries are classified *load-sensitive (~4 s)*; a timing
measurement taken beside a live six-shard gate cannot separate the hypothesis from the
contamination — and `#9`'s five runs are already on record as the case where a "load" label
predicted nothing.

---

### Tests

**The clean reference run**, before this PR's last two rails were added:

```
68 passed, 3027 warnings in 602.04s (0:10:02)
```

**The re-verification run**, with the two new descendant rails — content green, interval **not**
admissible:

```
70 passed, 3129 warnings in 861.57s (0:14:21)
```

`70 = 68 + 2` — exactly the rails added in §4, so the count is a finding, not a drift.
⛔ **That run is `INCONCLUSIVE-CONTENDED`**, per the box verdict above: a foreign six-shard gate was
present in 37 of 43 samples. It is quoted with its verdict rather than presented as a clean result.
⭐ The **+43 % wall time** (602 s → 862 s) corroborates the sampler from a completely independent
signal — contention showed up in the clock as well as in the process table.

`python -m pytest tests/test_gate_shards.py tests/test_gate_box_sampler.py -q` — scoped, named
files, never repo-wide. Every rail is paired with a control that must return the other answer.

**Mutation-proved** (original bytes captured first and restored by sha256 — never `git checkout --`):

| mutation | result |
|---|---|
| `Captured` pinned to `returncode = 0` (the shipped bug, in one line) | **RED** — and only the exit-2 rail, not its control |
| the `VERDICT=` line not emitted on a valid run | **RED** |
| an unobserved code rendered as `0` | **RED** |

Both self-checks pass and both can fail: `--self-check` is re-run with the decoy defence removed and
must report failure.

### Reviewer checks

1. `scripts/gate_shards.py` is the only behavioural file changed; `tools/gate_box_sampler.py` is new.
2. No existing output line or exit code moved — `VERDICT=` is purely additive.
3. Master's `expected_red` and `EXIT_DID_NOT_RECONCILE` are both intact and both now named.
4. §5 is a draft. No lock is taken and nothing refuses anything.
5. §6 is +26/−0 on the runbook; no step renumbered, none started.
6. The baseline is untouched — still 10, `#9` still `provisional: true`; boxes 1 and 2 still ☐.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QhCGpjyZyKAqNZbFuwVHRW
