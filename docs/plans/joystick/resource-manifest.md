# The lean-run manifest — what the box was, what was insured, and what that makes cheap

> **Owner ruling, 2026-09-17: "I cannot close the other Claude sessions. Proceed anyway, with the
> risk made cheap and the footprint made small."** This file is the record of steps 1–3 of that
> ruling and the standing conditions every later step in this programme runs under.

---

## 0 · The state of the box, measured

| | |
|---|---|
| total RAM | 31.8 GB |
| free physical at first refusal | **3.1 GB** — *below* the 4.8 GB at which this box OOM-swept a worktree on 2026-09-12 |
| commit charge at first refusal | **46.2 / 49.1 GB = 94%** |
| concurrent `claude` processes | **7** (owner cap is 3 + integrator) |
| `llama-server` | **4,096 MB** |

⛔ **Commit charge is the number that bites, not free physical.** At the commit limit Windows
fails allocations, and a failed allocation inside `npm ci` is exactly how the 2026-09-12 incident
deleted `app/node_modules` down to zero entries and then destroyed the worktree's `.git` file. A
killed `npm ci` **deletes before it installs**.

---

## 1 · THE WORST CASE IS NOW RECOVERABLE

```
C:\Users\Patrick\uct-backups\uct-dashboard-ALL-20260917-213535.bundle      468 MB
C:\Users\Patrick\uct-backups\LATEST_BUNDLE.txt                            (the path, for scripts)
```

- Outside **every** worktree (checked against `git worktree list`, 91 of them) and outside
  `C:\data`.
- `git bundle create --all refs/stash`, pack threads pinned to 1 and window memory capped at 64m
  so the insurance could not itself cause the sweep it insures against. 33 seconds.
- `git bundle verify` → **"The bundle records a complete history."**

⭐ **VERIFIED BY CONTENT, NOT BY EXIT CODE.** 934 refs, and four spot checks that each had to be
present — this branch's tip, `refs/stash`, `worktree-indicator-ecosystem` (recorded in memory as
deliberately never pushed) and `feat/inc4-home` — **plus a control**: a fabricated sha had to be
ABSENT, which it was. Without that control "found it" would be indistinguishable from a search
that matches everything.

> ### ⛔ FROM HERE ON, A SWEPT WORKTREE COSTS A RE-CLONE AND AN `npm ci`, NOT DATA.
> Recovery is `git clone <bundle> <dir>` then `npm ci` in `app/`. **~370 packages, minutes.**

⚠️ **77 local branch tips are on no remote**, across 91 worktrees belonging to other workstreams —
several deliberately so (`worktree-indicator-ecosystem` is recorded as "NOT pushed"). They were
**not** pushed: publishing other sessions' branches without their knowledge is not this session's
call. The bundle is what protects them, and it protects them better, because it also carries the
shared stash that a push could not.

**This branch's own tip is pushed and identical to `origin/design/bar-and-strong-cut`** — verified
by sha equality, not by `git status`.

---

## 2 · WHAT WAS SHED: NOTHING, AND THE CHECK IS WHY

`llama-server` (4,096 MB) was the candidate. It **failed the first condition** and was left alone.

| check | result |
|---|---|
| no live connection | ❌ **FOUR `ESTABLISHED` sockets** on `127.0.0.1:8125` |
| whose | **pid 528**, a python process running from another Claude session's scratchpad (`5691081b-…`, not this session's `1c73ae1b-…`). Four connections matches the server's own `-np 4`. |
| an invoker in any worktree | none — the only `8125` hits are incidental numeric values inside `darkpool_cache/*.json` and a research JSON, i.e. **data, not code** |
| control on the socket query | an `ESTABLISHED` socket was found elsewhere (pid 4276), so the query works and "four" is a real reading |

Then this session's own footprint: **no stray node/python process carries this session's id**, and
the live `vitest` workers belong to `breadth-dc` and `notebook-k` — other worktrees, not mine.

> ### **Total freed: 0 MB. Nothing was mine to shed, and the one big thing is in use.**

⭐ Recorded as a result rather than skipped. A shed step that frees nothing and a shed step that
was never run look identical afterwards unless one of them is written down.

---

## 3 · LEAN RUN RULES — in force for the rest of this programme

- ⛔ **No six-shard gate while the box is like this.** Shards run **SEQUENTIALLY, one worker**,
  sampler wrapped. It counts as a gate only if the sampler is **CLEAR** and the totals reconcile,
  and it is recorded here as a **lean run**.
- ⛔ **No Vite dev server.** `npm run build` **once**, serve the static bundle with the lightest
  server available, point Chrome device emulation at that. **One tab. Closed between critique
  passes.**
- `vitest --pool=forks --poolOptions.forks.singleFork` (or equivalent), one worker.

### The threshold, and what happens mid-step

**Boot requires ≥ 4.5 GB free AND commit ≤ 92%, holding for THREE consecutive samples.**

Sample every **30 s** during any browser or build step. If free memory falls below **3.5 GB**
mid-step: stop that step **cleanly at the next boundary**, record **`INCONCLUSIVE-RESOURCE`**, wait
for the threshold, resume **from the boundary**. ⛔ Never let a step run into a sweep.

⛔ **`INCONCLUSIVE-RESOURCE` IS NOT A FAILURE AND MUST NEVER BE RECORDED AS ONE.** This programme
already has the precedent in `gate_box_sampler` — CLEAR vs INCONCLUSIVE-CONTENDED are different
facts, and collapsing "we could not measure it" into "it is broken" is the defect `CoverageLine`
exists to avoid. A resource-voided step says nothing whatsoever about the code.

---

## 4 · The samples so far

| when | free | commit | verdict |
|---|---|---|---|
| first refusal | 3.1 GB | 94% | REFUSE — below the 2026-09-12 incident level |
| after the bundle | 3.8 GB | 91% | REFUSE |
| threshold sample 1 | 5.0 GB | 83.7% | PASS |
| threshold sample 2 | 4.0 GB | 86.6% | **FAIL** |
| threshold sample 3 | 4.7 GB | 86.8% | PASS |

**2 of 3 — the hold is not met.** Commit charge has recovered substantially (94% → ~86%); free
physical is oscillating across the 4.5 GB line. Per step 5, work continues on everything that
needs neither a browser nor a build, sampling every 120 s, and the browser work starts the moment
three consecutive samples pass.

---

## 5 · Step 0 — the build. DONE, artifact verified, and one lesson the threshold did not carry

Ran at 3/3 threshold (5.8 / 5.7 / 5.6 GB free, ~88% commit). Sampled every 30 s throughout.

```
t+  0s  free 4.6 GB  commit 90.1%
t+ 30s  free 4.3 GB  commit 90.7%
t+ 60s  free 5.6 GB  commit 88.0%
t+150s  free 5.8 GB  commit 87.1%
t+180s  free 1.9 GB  commit 95.0%   <-- below the 3.5 GB abort line
t+210s  free 1.5 GB  commit 97.3%   <-- and further
```

**The build completed before a boundary could be taken.** It is recorded as DONE rather than
`INCONCLUSIVE-RESOURCE` because the artifact was then verified **by content, not by exit code**:

| checked | result |
|---|---|
| `node_modules` — the thing a sweep destroys | **368 entries, unchanged from before the build**; `vite` still present |
| the worktree is still a repository (a 2026-09-12 sweep destroyed a `.git` file) | `git rev-parse` works |
| `dist/` | **476 files, 38 MB**, `index.html` 16,586 bytes |
| the log's own tail | all three stages present (`vite build`, cot-facts, flow-facts), `EXIT=0` |

> ### ⭐ THE LESSON: A THRESHOLD ON THE BOX IS NOT A BUDGET FOR THE STEP.
> Three consecutive samples at **5.6 GB free** did not predict that this build would take the box
> to **1.5 GB**. `npm run build` has a peak demand of roughly **4 GB** all by itself. The threshold
> answers *"is there room right now"*; it says nothing about *"how much will this step ask for"*,
> and the two are different questions. **Budget the step's own peak against the headroom**, not
> just the headroom against a constant.

⚠️ It is also why the abort rule could not fire usefully here: the excursion and the completion
happened inside the same 30 s window. A rule that samples at 30 s cannot stop a step whose entire
danger window is shorter than that. **For the next expensive step, the headroom has to be there
BEFORE it starts, not watched for during it.**

## 6 · Why the box is under pressure, measured rather than assumed

The five node processes holding ~1.9 GB after the build are **not this session's**:

```
pid 38636  574 MB  uct-worktrees\notebook-k\...\vitest.mjs run --shard=2/6
pid 50192  463 MB  vitest run src/components/chart/engine/ast ...
pid 42200  436 MB  + three more vitest workers
```

**Another session is running a six-shard gate right now.** That is the "one gate at a time on this
box" rule, and it is not this session's to enforce — but it is this session's to *account for*:
opening Chrome on top of a running six-shard gate is precisely the 2026-09-12 shape (three
concurrent gates plus an unscoped pytest, `node_modules` swept to zero, a `.git` destroyed).

⛔ **So Chrome waits.** The pressure is transient — a six-shard gate is ~25 minutes — and the built
bundle is on disk, so nothing has to be repeated when the window opens. Step 1 (BEFORE frames)
starts from `dist/`, not from a rebuild.

---

## 7 · ⛔⛔ THE SNAPSHOT RAIL FIRED, AND IT WAS NOT MINE — the attribution limit

The 22:23 sandbox boot produced this, and it is exactly the alarm the rail exists to raise:

```
2026-09-17 22:23:21  pre-boot (baseline)  — C:\data, 56 db files — CLEAN
2026-09-17 22:24:44  post-boot (+15s)     — C:\data, 56 db files — 1 FILE(S) CHANGED
   CHANGED  wisdom.db   425984 -> 425984 bytes; sha256 5c3aa90bae7a -> 24649b0417a6
```

**And the app really does write that file at boot** — `api/main.py:3245` calls
`wisdom.registry.init_stores()`, which applies migrations unconditionally. So the hypothesis
*"my sandbox leaked into the live root"* was specific, plausible, and had a named mechanism.

### It was false, and here is what settled it

| evidence | reading |
|---|---|
| `C:\data-hubtest\wisdom.db` exists, **610,304 bytes**, mtime 22:24 | the sandbox wrote its OWN copy — **the census pin worked** |
| `C:\data\wisdom.db` is **425,984 bytes** | a *different database*. The sandbox was never writing this one |
| `C:\data\auth.db` mtime **Sep 12**, and the sandbox made its own | the boot did not touch the live auth store at all |
| 43 `.db` files in `C:\data-hubtest`, all mtime 22:24 | the whole tree was redirected, not one lucky var |

`api/services/wisdom/core/store.py:43` resolves `WISDOM_DB_PATH` **on every call**, and
`hub_sandbox_boot.py` sets every census pin in `main()` before `api.main` is imported at `:391`.
Both halves were correct. **The isolation held.**

The live write at 22:24 was **another session** — the Wisdom programme is in active build, and a
python process from a different Claude scratchpad (`5691081b-…`) was on this box throughout.

> ### ⛔ THE LIMIT, STATED SO THE NEXT ALARM IS READ CORRECTLY:
> **The snapshot rail compares the shared root at two moments. On a box with concurrent sessions it
> cannot attribute a change to the process it is watching.** Its finding is *"something wrote
> here"*, never *"this boot wrote here"* — and its name, its placement and the moment it fires all
> suggest the second.

⭐ This is a **kind-2 proxy failure in an instrument I trust and still trust**: it keys on *did
anything change* while standing in for *did MY boot leak*. That is the same shape as
`uptime_seconds` standing in for *did my deploy ship*, and it fails the same way — silently, in
whichever direction the environment happens to lean.

⛔ **It must NOT be "fixed" by narrowing it to this process's writes.** A rail that only watches its
own handle would have said CLEAN through a genuine leak from a thread it did not own — and the
2026-09-08 incident was exactly that: a daemon thread writing `auth.db` while the operator believed
the sandbox was isolated. **The over-reporting is the safe direction.** What is needed beside it is
the attribution step this section documents: check whether the sandbox produced its OWN copy, and
compare sizes and mtimes, before concluding anything.

⚠️ And the honest residual: **nothing here proves the other session's write was safe.** It is not
this session's file, it was not this session's write, and `C:\data\wisdom.db` was deliberately
left untouched afterwards — including no `quick_check`, because opening it rewrites its `-shm` and
would put this session's fingerprints on another workstream's active database for no gain.

## 8 · And the first boot died, which is a tooling fact worth keeping

No shutdown line, no traceback, no signal, 5.8 GB free at the time — it stopped mid-prewarm.
`nohup … &` **inside** a backgrounded harness command does not detach: the wrapper exits
immediately, reports success, and the child goes down with it. The relaunch runs the server **as**
the background command instead, which is what keeps it alive across turns.

⛔ Note the shape: the wrapper reported **exit 0** for a server that was dead thirty seconds later,
and the `until` loop that had just printed `LISTENING` was correct when it printed it. Neither was
lying; both were answering a question about a moment. **`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`**, in a new costume.

---

## 9 · ⛔⛔ THE BROWSER WALL — and it is NOT memory

Memory was solved. The threshold held 3/3 (5.4 / 5.4 / 5.9 GB free, ~88% commit), the bundle
built, the sandbox booted twice and served both times. **The blocker is a live collision with
another session, and it is absolute for as long as that session runs.**

### The mechanism, read from the launcher's own source

`hub_sandbox_boot.py:288` starts a thread that re-hashes the whole shared root at **+15 s** and
again at **+120 s**, and on any difference calls:

```python
print("  ABORTING THE RUN. The sandbox reached live data.")
os._exit(2)
```

**Any change to `C:\data` kills the sandbox 15 seconds after it starts serving.** On this box
another session is writing `C:\data\wisdom.db` continuously — three distinct hashes across my two
boots:

```
5c3aa90bae7a  ->  24649b0417a6  ->  8471adb92cf1
```

So the sandbox survives ~15 s per attempt. That is enough to answer *"does it serve"* and nowhere
near enough for a critique pass.

### ⛔ THE ABORT MESSAGE IS WRONG IN THIS CASE, AND THAT IS THE DANGEROUS PART

*"The sandbox reached live data"* is a **conclusion the rail cannot support** (§7). Four
independent measurements say this sandbox reached nothing:

| evidence | attributable? | result |
|---|---|---|
| the in-process **tripwire**, `Guard mode: enforce`, `Shared roots: c:\data (writes RAISE)` | **YES — it raises on THIS process's writes** | **0 violation banners** |
| the sandbox's own tree | yes | **43 `.db` files created**, including its own `wisdom.db` at **610,304 bytes** |
| live `C:\data\auth.db` | — | mtime **Sep 12**, untouched |
| live `C:\data\wisdom.db` | **no** | **425,984 bytes** — a different database, changing on its own schedule |

⭐ **The tripwire is the guard that can attribute; the snapshot is the guard that cannot.** The
tripwire said clean. The snapshot aborted anyway, and told the console the opposite of the truth.

⛔ **And a reader would not see the abort line at all**: `os._exit(2)` skips stdio flushing, so the
message never leaves the buffer. The durable evidence is the run-record `.md`, appended *before*
the exit — which is precisely why that file exists.

### What was NOT done, and why

- ⛔ **The guard was not weakened, disabled, or narrowed to exclude `wisdom.db`.** It is the thing
  standing between a sandbox boot and the owner's live data, and the 2026-09-08 incident — a daemon
  thread writing `auth.db` while the operator believed the sandbox isolated — is why it exists. An
  exclusion "just for this run" is how that protection ends.
- ⛔ **The other session was not interfered with.** Its work is live and not this session's to stop.
- The launcher offers exactly four flags (`--data-dir`, `--test-email`, `--port`, `--host`). There
  is no sanctioned escape hatch, deliberately.

### ⭐ The fix worth making — for whoever owns this tool, not smuggled in here

**The snapshot rail should consult the tripwire before concluding.** The tripwire already knows,
per process, whether *this* boot attempted a shared-root write. A dirty snapshot plus a silent
tripwire is *"someone else is writing this box"* — an `INCONCLUSIVE-CONTENDED`, exactly the verdict
`gate_box_sampler` already draws and the vocabulary this programme already has. A dirty snapshot
plus a firing tripwire is the real leak, and should keep aborting exactly as it does now.

⛔ That is a change to another workstream's guard, made while its failure mode is fresh and
therefore the worst possible moment to be casual about it. **Recorded, not applied.**

