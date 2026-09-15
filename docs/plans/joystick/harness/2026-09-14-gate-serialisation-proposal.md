# Serialising gates on this box — ⏳ **DRAFT. NEEDS AN OWNER RULING. NOTHING IS ENFORCED.**

> ⛔ **This document changes no behaviour and no file.** No lock is taken, no tool refuses
> anything, and nothing owned by another workstream is modified. It exists because the
> harness-hardening brief asked for a proposal *"draft only, do not enforce"* — and because the
> first thing it asked for was to go and look whether a convention already exists.
>
> **It does.** That finding is the larger half of this document, and it changes what should be
> proposed.

---

## 1 · A lock convention already exists — `tools/measure_lock.py`

Found in `tools/`, 294 lines, authored by the **Notebook** workstream as their **R-S**
(`1f7cfd500` → `6db8ba93a` → `aa18ed580`). Its opening paragraph is the argument, verbatim:

> *"⚰️ WHY THIS IS A LOCK AND NOT A RULE. Editing the tree mid-run voided two 13-minute
> full-suite runs in one session — the second one AFTER a ruling had been written saying not to.
> The ruling was read, agreed with, and then broken by the same agent that wrote it. ⛔ A rule
> that depends on remembering is not a control; it is a hope with a timestamp."*

and its mechanism:

> *"⭐ SO THE ENFORCEMENT IS THE FILESYSTEM. While a measurement holds the lock, every source file
> under the guarded roots carries the OS read-only attribute, so an edit fails at the syscall — no
> cooperation required from the thing being restrained. That is the difference between a lock and
> a note on the door."*

It is good work and this proposal does not duplicate it. What it already solves:

| | |
|---|---|
| Problem | the **tree changing under a measurement** |
| Mechanism | OS read-only on `app/src`, `api`, `tools`, `scripts` (`GUARDED`, `:76`) |
| Lock location | the **git dir**, never the working tree (`_lock_path`, `:42`) — so `git status` never sees it and `gate_shards.py`'s dirty-tree refusal cannot trip on the guard itself |
| Stale handling | `lock_state()` (`:117`) — `bound_pid` liveness via `tasklist`, plus a heartbeat TTL (`LOCK_TTL_S = 2h`, `:114`); **unknown ⇒ assume alive, never auto-clear on a guess** (`_alive`, `:105`) |
| Recovery | `release` idempotent, `status` reports STALE, `--force` clears |
| Proof it can fail | `--self-check` (`:205`) |

### 1b · And a second precedent, at a different layer — the `master deploy gate`

`CLAUDE.md:2512` records that master pushes are already serialised, **at GitHub**, by a workflow
using `concurrency: master-deploy` with `cancel-in-progress: false`, with Railway's *Wait for CI*
holding the build behind it. Its stated reason is exactly the argument of §1:

> *"a client hook asks every session to cooperate, and that does not."*

⭐ **Worth citing because it settles the shape question before it is asked.** The repo's own
answer to "several sessions, one shared resource" is a **named queue that does not cancel**, owned
by the layer that can actually see every contender — not a per-session flag. A box lock is the
same idea one layer down, where the shared resource is the machine's CPU and RAM rather than
master. The difference — and it is the whole of §3's caveat — is that GitHub can *enforce*
its concurrency group and nothing on this box can.

## 2 · What it does **not** solve, and it says so itself

The gap is not an oversight — it is a deliberate design decision stated in the tool's own
docstring, in the sentence explaining why the lock lives in the git dir:

> *"The git dir is per-worktree, so **two worktrees never share a lock by accident**, and
> `git status` never reports it."*

That is exactly right for its problem and exactly wrong for ours. The 2026-09-14 failure was not
a tree being edited — it was **a second six-shard gate starting in a different worktree on the
same physical machine**, seconds after a clearance pre-check passed:

| time | what happened |
|---|---|
| 18:25:49 | pid 50356, shard 6/6 — the box was already held |
| 18:51:30 | 50356 gone; successor pid 29740, shard 4/6 |
| 19:02:21 | clear, 11.8 GB free |
| ~19:02:50 | **pid 50288 starts — a third gate, seconds into the window** |

A per-worktree lock cannot see any of that by construction. Two more facts to put beside it:

- ⚠️ **`measure_lock.py` has ZERO callers.** `git grep -l measure_lock` returns only the file
  itself, and no document in `docs/` mentions it. It is built, self-checked, and wired to nothing
  — the `lesson_built_tested_green_and_unreachable` shape. Stated plainly rather than treated as
  a criticism: an unwired tool is a decision someone has not made yet, and this document is not
  the place to make it for them.
- ⚠️ **Its `REPO` constant is hard-coded to `C:\Users\Patrick\uct-worktrees\notebook-primary-platform`**
  (`:41`). Any use from another worktree passes `repo=` explicitly or gets the wrong tree. That is
  a one-line change *in a file this workstream does not own*, which is why it is reported here
  rather than made.

## 3 · The proposal — a **box** lock, beside the tree lock, not instead of it

Two different invariants, so two different locks. Conflating them would break the good one: the
tree lock MUST stay per-worktree (a measurement in worktree A has no business freezing worktree
B's source), while the box lock MUST be machine-wide (that is its entire content).

**Shape.** One file outside every worktree — `%TEMP%\uct-gate-box.lock`, or another agreed
machine-scoped path — holding JSON:

```json
{
  "pid": 50288,
  "workstream": "joystick",
  "worktree": "C:/Users/Patrick/uct-worktrees/joystick-launch-close",
  "run_id": "gate-2026-09-14T19-02",
  "started_at": "2026-09-14T19:02:50",
  "heartbeat": 1789178570.4,
  "ttl_s": 7200,
  "kind": "gate"
}
```

`workstream` is in the record because the operational question when you find a held lock is never
"which pid" — it is **"whose run am I about to kill, and can I ask them?"**. `started_at` separate
from `heartbeat` because "held since 18:25" and "last seen alive 12s ago" answer different
questions and the 2026-09-14 table above needed both.

**Stale handling: reuse `lock_state()`'s shape verbatim, do not invent a second one.** Liveness
by bound pid first, heartbeat TTL second, and ⛔ **unknown ⇒ assume alive**. A stale-lock rule that
guesses "probably dead" will eventually kill a live 15-minute gate, which is strictly worse than
the queueing it was meant to avoid.

**⛔ ADVISORY, NOT THE FILESYSTEM.** The tree lock can enforce with the read-only attribute because
it restrains *edits to files it can name*. A box lock restrains *starting a process*, and there is
no equivalent syscall-level hook — anything claiming to enforce it would be cooperation wearing a
lock's clothes. So the honest contract is: `gate_shards.py` **asks** before it starts, says who
holds it and since when, and refuses **its own** start. That is a queue, not a mutex, and calling
it a mutex is how the next person is surprised.

**What it would have cost on 2026-09-14:** nothing. Every one of those three gates would have
waited, and the settling runs would have been admissible on their first attempt instead of their
fifth.

## 4 · The override, and the ambiguity in the brief

The brief asks the proposal to say *"what notebook-kill-switch would change"*. ⚠️ **That phrase has
two readings and this document deliberately does not pick one** — the owner should. Both are cheap
to answer:

**(a) An override switch on this lock.** Any advisory gate needs a documented way past it, or the
first person blocked at 2 a.m. invents an undocumented one. The shape that works elsewhere in this
repo is the `UCT_SKIP_PREPUSH_GUARD=1` pattern: an environment variable that **does not silence the
check — it logs the bypass**, to `logs/pre-push-guard-bypass.log`, with pid, workstream and reason.
⛔ Never a `--no-verify`-shaped flag that leaves no trace; `CLAUDE.md:2508` already records why —
*"It skips every hook, leaves no trace anywhere, and is the one path that looks exactly like the
2026-09-14 stacked push that nobody could attribute."*

**(b) The Notebook workstream's own kill switch** (`NOTEBOOK_OFFLINE_DEFAULT_ON`, Wave K). It
changes **nothing here** — it governs a member-facing capability on the auth payload and has no
relationship to box scheduling. Recorded so the answer is on paper rather than re-derived.

What *is* a real Notebook dependency: `measure_lock.py` is theirs, and any repo-wide adoption —
un-hardcoding `REPO`, wiring it to a caller, or having a box lock coexist with it — is **their
ruling to make, not this programme's.**

## 5 · What this programme did instead, and why that is not a substitute

Shipped on `tools/gate-harness-2026-09-14`: `tools/gate_box_sampler.py`, which **samples** box
clearance continuously during a run and returns `INCONCLUSIVE-CONTENDED` — naming the intruder's
pid, command line and the sample time — rather than a corrupted measurement.

⭐ **That is detection, and detection is not serialisation.** It converts a silently wrong number
into a loudly refused one, which is the important half and the half that could be built without
an owner ruling. It does not stop the collision; it stops the collision being invisible. The two
are complementary and this document exists because only one of them is safe to build unilaterally.

## 6 · The ruling asked for

1. Is a **machine-wide advisory gate lock** wanted at all, or is "sample and refuse" (§5) enough?
2. If wanted — does it live beside `measure_lock.py` as a second tool, or does that tool grow a
   box-scoped mode? **Notebook's call either way.**
3. Does `gate_shards.py` **refuse** to start when the box lock is held, or only **warn**?
4. Override: the logged-bypass pattern of §4(a), or none at all?

⛔ Until those are answered, nothing in this document is implemented.
