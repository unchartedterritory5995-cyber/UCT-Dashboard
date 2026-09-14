---
id: WEEKLY-AUTONOMOUS-PROMPT
title: Terminal-Next — the weekly autonomous run. This file IS the instruction.
role: fed verbatim to `claude -p` by Task Scheduler, Saturdays 09:30 CT. Nothing else is passed.
status: ACTIVE. Pre-authorizations below are signed by this file; everything else is refused.
date: 2026-09-13
---

# Terminal-Next — weekly autonomous run

You are running **non-interactively**. Nobody will answer a question, so a question is a **stop**,
not a prompt. When in doubt, do less and say so.

⛔⛔ **THE ONE RULE THAT OUTRANKS EVERY OTHER LINE HERE: IF IT IS NOT PRE-AUTHORIZED IN §3, YOU DO
NOT BUILD IT.** Not "it is obviously fine", not "it is only a test", not "the owner would want it".
An autonomous run that widens its own scope is the failure this whole programme is arranged to
prevent, and there is nobody awake to catch it.

---

## 1. Start: resume, then verify. **Refuse to proceed if any check fails.**

Read `docs/terminal-research/00-program-control/RESUME.md` first — it is the entry point and it is
current. Then run the **eight environment checks** from its §5 and the verification pass:

1. both worktrees on their branches, **clean, and each HEAD CONTAINED IN ITS PUBLISH REF** —
   run `python tools/terminal_next_env_check.py` (exit **0** PASS · **1** measured FAIL ·
   **2** UNREADABLE). ⛔ **"matching origin" does NOT mean `origin/<branch>`.**
   `feat/s7-price-level` publishes to **master**, so `origin/feat/s7-price-level` is a stale
   ref it outruns permanently — measured 2026-09-13 at `ahead 99` with **zero** commits
   actually unpublished. Reading it that way full-stops this run every week on a clean tree.
2. `railway whoami` succeeds without prompting
3. `app/node_modules` present and a real directory
4. one **named** test file runs green, `PYTEST_EXIT` captured
5. shell identified; `MSYS_NO_PATHCONV=1` applied for any pod path
6. Task Scheduler production jobs enabled with next-run times
7. production: `/api/health` 200; the eight flags read `1` **in-process**; flag audit 0/0/0/0; doc-SHA rail OK
8. the other session's stash and the wisdom job present/absent — **touch neither**

⛔ **A FAILED CHECK IS A FULL STOP.** Post the failure to the **admin** Discord webhook
(`DISCORD_WEBHOOK_URL` — never `DISCORD_TSDR_WEBHOOK_URL`, which is the public ~750-member channel)
and exit. Do not "work around" a red check; a run that begins on an unverified box is a run whose
results cannot be trusted, and the whole point of this file is trustworthy results.

⛔ **MEMORY GATE, CHECKED FIRST OF ALL:** if the box is above **70% memory used** at start, post
that and exit **without building**. Three sessions once OOM-swept this machine and deleted a
worktree; an autonomous run must never be the fourth.

### ⚠️ WHAT THE FIRST DRY RUN FOUND (2026-09-13) — read this before trusting a quiet Saturday

The run stopped at §1 exactly as written, built nothing, merged nothing, and left both trees and
the shared stash untouched. **Three findings, and two of them make this layer silent:**

1. ⛔ **FOUR OF THE EIGHT CHECKS WERE DENIED BY THE SANDBOX PROFILE** the job launches into —
   `railway`, `schtasks`, `pytest` and network egress are all refused, and a non-interactive run
   can approve nothing. As registered, the Saturday job stops here **every week**.
2. ⛔⛔ **THE FAILURE NOTICE COULD NOT REACH ADMIN DISCORD.** §1 and §4 route every outcome to
   `DISCORD_WEBHOOK_URL`; with no egress and no permission to read the variable there was **no
   destination**. The log file was the only copy. **A stop that cannot report is a silent stop**,
   which is the one failure mode this layer exists to prevent.
3. ⚠️ **THE RUNNER REPORTED `exit=0` FOR A RUN THAT STOPPED.** `claude -p` exits 0 having
   successfully written a report *about refusing to proceed*, so Task Scheduler records **success**.
   Filed as **F-L2-1**; until it is fixed, `Last Result: 0` on this job means *nothing*.

⭐ It also caught the `ahead 99` false alarm in check 1 independently, before the fix above was
written — which is the best argument that this layer earns its keep once it can actually report.

---

---

## 2. Read the Saturday numbers. **Do not re-derive them.**

The `terminal-next-monitor` service posts a **WEEKLY READ** to admin Discord at 08:00 ET Saturday,
and writes `docs/terminal-research/10-roadmap/reads/<date>.md` when it has repo write access. Read
that. If it is absent, fetch the reports once via the same read-only surface the monitor uses.

⛔ **YOU DO NOT RECOMPUTE A VERDICT.** `verdict_ready`, the four outcome columns and the gate states
are produced by `tools/s7_price_level_report.py` and `tools/terminal_next_gate_check.py`, which are
the authority. Recomputing them here would be a second authority over the numbers that decide
whether something ships, and the first disagreement would be unresolvable.

---

## 3. Execute ONLY these, each as a **full unit**

A unit is: **gate line named by its §4 checkpoint ID → build → named tests → mutations restored by
edit → in-pod verification → `reachable_paths()` classification → merge in the weekend window →
ledger row → §6 row → RESUME**. A unit that cannot complete every step **does not merge**; leave the
branch, record the state in §6, and say so.

### (a) S7 CP4 — all-members cohort, STILL DARK

**Pre-signed by this file, and the condition is quoted so it cannot drift:**

> For any S7 type whose verdict is **READY** with **`legacy_only == 0`** and **`agreed ≥ 20`** over
> **≥ 5 sessions**: CP4 — all-members cohort, **STILL DARK**, via the S12 tag; **no delivery**.

⛔ Every clause is a conjunction. `legacy_only == 0` is the safety clause — it is the only column
that can say the new lane would have **dropped a member's alert** — and `agreed ≥ 20` over `≥ 5
sessions` is what stops a quiet week reading as agreement. **If any clause fails, the type is not
eligible; report it and move on.**
⛔ CP4 is **a tag assignment, not a code path** (`rollout.py`). It does not arm, flip, or deliver.

### (b) D2 CP3 — serve the book path for the one reader

> When the D2 sample gate reads **READY** — **≥ 200 AGREED rows, ≥ 1 full session, zero
> inequality** — serve the book path for the one reader and keep the equality rail as a fixture
> test.

⛔ **Zero inequality is zero, not "a few".** One inequality means the two paths disagree about a
value, and shipping the book path over a disagreement is exactly what D2 exists to prevent.

### (c) Follow-ups that need no ruling

Any item in the register whose closer is **"docs only"** or **"test only"** *and* needs no owner
ruling. ⛔ If closing it requires deciding anything — a convention, a threshold, a scope — it needs
a ruling and is **not** in scope.

### (d) Nothing else.

⛔ **No flips. No legacy switch-offs. No new systems. No gate the owner has not read. No flag
changes. No new signatures beyond the two pre-signed above.**
⚠️ **FLIPS REMAIN THE OWNER'S.** This was offered and **declined** — the owner did not hand over the
flip. If a type meets (a) and has since run dark cleanly, **report it as READY FOR THE OWNER**; do
not flip it.

---

## 4. Finish: post a summary to **admin** Discord

- what ran, and the **SHA** of each merge
- what is now **READY and needs the owner** (name the type, the numbers, and the line that would
  authorize it)
- which **`OWNER_INPUTS.md`** lines are still blank, and what each unblocks
- if nothing was eligible: **say that plainly.** A run that built nothing because nothing qualified
  is a **successful run**, and reporting it as such is what keeps the next one trusted.

---

## 5. Hard stops

1. ⛔ **No unscoped `pytest tests/`** — collection alone reached 6.6 GB; an unscoped run reached
   18 GB and was OOM-killed. **Name the files.** `-k` does not scope.
2. ⛔ **No `railway redeploy`.** Verify a boot by `/api/health` `uptime_seconds` resetting, never by
   `--kv`.
3. ⛔ **Marker bump only on a MEASURED strand** — `tools/flow_worker_watch_coverage.py` decides.
   A bump during RTH drops the Massive OPRA socket and that tape gap is permanent until T+1.
4. ⛔ **Never touch another session's processes, stashes or branches.** The stash stack is shared.
5. ⛔ **If master moved under you mid-unit: REBASE, never reset.** Other workstreams push to this
   same master; a reset discards their work.
6. ⛔ **The pre-push guard is not to be bypassed.** If it refuses, wait. `UCT_SKIP_PREPUSH_GUARD`
   is for a human with a reason, not for an unattended run.
7. ⛔ **Admin Discord only.** `DISCORD_TSDR_WEBHOOK_URL` is public and must never be written.

---

## 6. What "done" looks like

Both trees clean · every branch on origin · doc-SHA rail OK · flag audit 0/0/0/0 · the deploy
settled on a commit you can name · a summary posted. **Then stop.** Do not start a second unit
after the summary; the next run is a week away and the owner reads in between.
