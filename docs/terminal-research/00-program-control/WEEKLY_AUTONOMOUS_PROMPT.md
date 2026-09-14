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

## 0. ⛔⛔ THE LAST LINE OF YOUR REPORT IS A CONTRACT. PRINT IT OR THE RUN IS A SILENT FAILURE.

**The final line of everything you print must be exactly one of these, and nothing else:**

```
STATUS: RAN
STATUS: STOPPED-ENV
STATUS: STOPPED-NOTHING-READY
STATUS: STOPPED-ERROR
```

| status | means | runner exit |
|---|---|---|
| `STATUS: RAN` | a pre-authorized unit was completed | **0** |
| `STATUS: STOPPED-NOTHING-READY` | checks passed, **nothing was eligible** — a successful run | **0** |
| `STATUS: STOPPED-ENV` | an environment check failed; **nothing was attempted** | 3 |
| `STATUS: STOPPED-ERROR` | you tried and something broke | 4 |
| *(no STATUS line)* | crash, truncation, kill, permission starvation | **5** |

⚰️ **WHY THIS EXISTS — F-L2-1.** `claude -p` exits **0** having successfully written a report
*about refusing to proceed*. On 2026-09-13 this run stopped at §1, reached nobody, and Task
Scheduler recorded **success**. `tools/weekly_status.py` now reads this line and sets the process
exit code; a report without one is **exit 5**, never 0. **Omitting the line does not make the run
look fine — it makes it look broken**, which is the correct direction.

⭐ **YOU DO NOT POST TO DISCORD. THE RUNNER DOES.** `tools/terminal_next_weekly.cmd` posts the
status, the log path and the exit code with `curl` from a Windows-side variable, on **every** run.
That post does not depend on you succeeding, having egress, or reading anything — and you have no
access to the webhook, deliberately. **Print your report; the runner delivers the verdict.**

---

⛔⛔ **THE ONE RULE THAT OUTRANKS EVERY OTHER LINE HERE: IF IT IS NOT PRE-AUTHORIZED IN §3, YOU DO
NOT BUILD IT.** Not "it is obviously fine", not "it is only a test", not "the owner would want it".
An autonomous run that widens its own scope is the failure this whole programme is arranged to
prevent, and there is nobody awake to catch it.

---

## 1. Start: resume, then verify. **Refuse to proceed if any check fails.**

Read `docs/terminal-research/00-program-control/RESUME.md` first — it is the entry point and it is
current. Then run the **eight environment checks** from its §5 and the verification pass:

⛔ **YOU ARE RUNNING UNDER A NARROW PERMISSIONS PROFILE** —
`.claude/weekly-autonomous.settings.json`, loaded by the runner. Anything not allow-listed is
**denied outright** (`--permission-prompts none`), because nobody is awake to approve it. Use these
and do not hunt for alternatives when one is refused — a refusal is the profile working:

| you need | run exactly |
|---|---|
| trees clean + published | `python tools/terminal_next_env_check.py` |
| a named test | `python tools/weekly_exec.py tests tests/test_<name>.py` |
| a pod report | `python tools/weekly_exec.py pod ticking` · `pod report` · `pod gate-check` |
| production health | `python tools/weekly_exec.py health` |
| **the memory gate** | `python tools/weekly_exec.py memory` — exit **0** under 70%, **1** at or over, **REFUSED** if unmeasurable |
| the flag ledger | `python tools/flag_ledger_audit.py` |
| the doc-SHA rail | `python <docs-worktree>/tools/verify_doc_shas.py` |

⛔ **RAW `pytest` AND RAW `railway ssh` ARE DENIED, ON PURPOSE.** A permission prefix cannot end
mid-token, so the rule that would allow `pytest tests/test_x.py` also allows the bare
`pytest tests/` that OOM-killed this box, and the rule that would allow one pod reporter also
allows an unrestricted shell on the production pod. Both constraints live in
`tools/weekly_exec.py` instead, where they are tested. **Go through the guard.**

⚠️ **CHECK 6 (Task Scheduler) IS OUT OF SCOPE HEADLESS.** `schtasks` is denied by the profile —
this run never needs to create or inspect a task, and **the fact that you are executing at all is
the proof that the job fired.** Report it as `n/a (denied by profile, by design)`, **not** as a
failed check. A check that cannot be performed must never be dressed up as one that passed.

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

⛔ **A FAILED CHECK IS A FULL STOP.** Say which check failed and what it returned, then end
with `STATUS: STOPPED-ENV` and stop. Do not "work around" a red check; a run that begins on an
unverified box is a run whose results cannot be trusted, and the whole point of this file is
trustworthy results. ⚠️ You cannot post to Discord and must not try — the runner reports for you.

✅ **AND IT IS NOW RUNNABLE.** Until 2026-09-14 this gate had **no allow-listed command**:
`systeminfo` is denied by the profile and nothing replaced it, so every run either skipped the
gate in silence or stopped on it. **The weekly run found that itself** and said so — *"a check
that cannot run looks identical to one that passed"*, which is F-L2-1 one layer down. Use
`python tools/weekly_exec.py memory`. ⛔ If it REFUSES, report the gate as **unperformed**, never
as passed.

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

### (b) S7 FLIP (member-facing) — ⛔ **DELETED. FLIPS REMAIN MANUAL.**

The owner's 2026-09-14 instruction carried a member-facing flip criterion marked
*"[DELETE THIS PARAGRAPH TO KEEP FLIPS MANUAL]"*. **It was deleted, deliberately**, and this
record is what the bracket asked for.

⛔ **Why.** A flip plus a legacy switch-off sends real alerts to real members from a lane that has
never produced a single comparison row. As of 2026-09-14 the S7 dark reads had **not started** —
three of the seven sweeps had not yet had one scheduled firing — so **zero** of the criteria the
paragraph tested (`legacy_only == 0` across five further sessions, `not_comparable < 20%`) had any
data behind them. Arming an automatic flip on an unmeasured population is not a judgement call.

⛔ **And the rollback rail proposed with it is not symmetric with the harm.** *"If the 48 hours
after a flip show any legacy-path fire with no matching new-type fire, revert"* means up to **two
days of members not getting an alert they were entitled to** before anything reverts. A missed
alert is not recoverable by a later revert.

⭐ **Re-adding it is one paragraph and this file is the only place it belongs** — but the
honest precondition is *"after the first type has run dark for five sessions and a human has read
the four outcome columns once"*, not *"after the machinery exists"*. The machinery is two days old
and produced four defects in the session that built it.

### (c) D2 CP3 — serve the book path for the one reader

> When the D2 sample gate reads **READY** — **≥ 200 AGREED rows, ≥ 1 full session, zero
> inequality** — serve the book path for the one reader and keep the equality rail as a fixture
> test.

⛔ **Zero inequality is zero, not "a few".** One inequality means the two paths disagree about a
value, and shipping the book path over a disagreement is exactly what D2 exists to prevent.

### (d) A9 / A11 / A13 — CP1 behind the S12 admin tag

> Each of A9, A11 and A13 may take **CP1 only**, behind the **S12 admin tag**, once **its own S7
> type has reached CP4**. ⛔ **Member exposure only after that type flips** — and flips are not
> in this file's gift, so in practice this stops at the admin tag until the owner acts.

⛔ The precondition is the type's OWN CP4, not any type's. Reading it loosely would expose A11 on
the strength of a different type's dark run.

### (e) Follow-ups that need no ruling

Any item in the register whose closer is **"docs only"** or **"test only"** *and* needs no owner
ruling. ⛔ If closing it requires deciding anything — a convention, a threshold, a scope — it needs
a ruling and is **not** in scope.

### (f) Nothing else.

⛔ **No flips. No legacy switch-offs. No new systems. No flag changes.** Anything not named in
(a) and (c)–(e) is **not authorized**: **list it and move on**. A run that widens its own scope is
the failure this whole programme is arranged to prevent, and there is nobody awake to catch it.

⚠️ **FLIPS REMAIN THE OWNER'S — offered twice, declined twice** (2026-09-13 by the owner,
2026-09-14 by this file under the owner's own delete-to-keep-manual bracket; see (b)). If a type
meets (a) and has since run dark cleanly, **report it as READY FOR THE OWNER**; do not flip it.

⛔ **AND NO FLIP MAY EVER RUN WHILE LAYER 1 OR LAYER 2 IS RED** — the owner's standing
precondition, recorded here so it survives the paragraph that would use it.

---

## 4. Finish: PRINT the summary (the runner posts it), then the STATUS line

- what ran, and the **SHA** of each merge
- what is now **READY and needs the owner** (name the type, the numbers, and the line that would
  authorize it)
- which **`OWNER_INPUTS.md`** lines are still blank, and what each unblocks
- if nothing was eligible: **say that plainly.** A run that built nothing because nothing qualified
  is a **successful run**, and reporting it as such is what keeps the next one trusted.

**THE POST ENDS IN A FIXED SHAPE. Four lines, in this order, every week:**

```
RAN:      <units completed, each with its merge SHA - or "nothing was eligible">
FLIPPED:  <none - flips are not in this file's gift; see section 3(b)>
NEXT:     <what the next run will attempt, and what it is waiting on>
OWNER ACTION NEEDED: NONE
```

⛔ **`OWNER ACTION NEEDED` IS THE ONLY LINE THE OWNER IS OBLIGED TO READ, SO IT MUST NEVER BE
DECORATIVE.** Write `NONE` only when **every** path to completion can proceed without a human. If
any path genuinely cannot, replace it with **one line naming exactly what and why** — not a
category, not "several items", not a pointer to a document:

```
OWNER ACTION NEEDED: <the one thing> - <why no procedure can decide it>
```

⭐ **The test for that line is whether a procedure COULD decide it, not whether deciding is
hard.** A threshold this file can state is not owner action. A fact behind a login, a contract, a
deliberate deferral, and a member-facing flip are — because no criterion written here can
manufacture consent, a credential, or a signature.

⚠️ **A conservative default is NOT owner action.** When an unknown fact has a safe side, take
it, say so under `NEXT:`, and keep the line at `NONE`. Blocking on a question that has a safe
answer is how an autonomous run quietly becomes a manual one.

⛔ **Then the last line, alone: `STATUS: ...`** — see §0. Nothing after it.

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
