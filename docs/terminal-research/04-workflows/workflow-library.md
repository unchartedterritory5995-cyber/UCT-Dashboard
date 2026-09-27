---
id: F-07-WORKFLOWS
title: Professional Workflow Library — how the work flows in time, and where it leaves our site
role: MASTER_CHECKLIST item 14 ("Professional Workflow Library"), gate 10, owned by F-07 (`AGENT_REGISTRY.md:139`, "Workflow / JTBD synthesizer"). ⛔ There is NO contract file for F-07 — `00-program-control/contracts/` holds F-03a, F-03b, F-04, F-06, F-08, F-09 and no `F-07.md` (`ls 00-program-control/contracts/ | grep -c '^F-07'` → 0). Written against `contracts/_SHARED_PREAMBLE.md` plus the MASTER_CHECKLIST row; that absence is in `## GAPS`, not papered over. Siblings at the same address: `jobs-to-be-done.md` (item 13, DRAFT COMPLETE) is the input; `personas.md` (item 12) and `daily-journey.md` are NOT STARTED and nothing here writes them.
wave: 3
group: F
category: workflows
inputs: 04-workflows/jobs-to-be-done.md (item 13 — the nouns; this file is the verbs, the clock and the break-out) · 00-program-control/charter/OWNER_SEED_FACTS.md §2 (Level-1, the PC Task Scheduler roster) and §6 (the no-execution default) · 00-program-control/OWNER_INPUTS_REQUESTED.md:14 (OI-06, whose "stamped artifacts" cell names THIS FILE) · 12-decisions/DECISION_CARDS_2026-09-26.md CARD 17, CARD 22, CARD 23 (price and the PRODUCT BOUNDARY), CARD 24 (the in-app Finviz chart embed is GONE) · three owner statements of 2026-09-26, relayed to this deliverable mid-flight (§2.2 tier 1) · 01-existing-system/terminal-current-map.md §5, §7 · 01-existing-system/capability-ledger.md (under its staleness banner; G5 for the Finviz scans) · verification/2026-09-14/OI-06-telemetry-derived-defaults.md · CODE at origin/master `74bdf4f68dd020af10a64b3cb5a6a64e0751ac11`: api/main.py, api/services/engine.py, api/services/desk_session_audit.py, api/services/discord_buzz_digest.py, api/routers/push.py, app/src/pages/Breadth.jsx, app/src/pages/ThemeTrackerPage.jsx, docs/runbooks/rth-scheduling.md, CLAUDE.md · READ-ONLY, outside the dashboard repo: C:\Users\Patrick\morning-wire\morning_wire_engine.py
scope: States each workflow as a sequence in time — what starts it, who does each step, what is on screen, what artifact crosses which boundary, where the clock stalls, what makes a step fail, and ⭐ WHERE THE FLOW LEAVES OUR SITE AND WHAT FOR. Cites item 13's JTBD ids and restates none of them. Does NOT rank workflows, does not size them, does not assign them to a Terminal-Next surface, does not name a tier, does not price anything, does not decide any displace/absorb/bridge call, does not propose execution, and does not supply frequency for any workflow. ⛔ Per the owner's 2026-09-26 instruction it carries NO cost analysis and NO usage-rate reasoning.
confidence: 🟢 on every clock time, job id, trigger expression and code behaviour in §4 groups A/B and in §8, because each is the literal at a cited line of a pinned SHA · 🟢 on the EXISTENCE of every external tool named in a break-out, because the owner stated on 2026-09-26 that he personally uses every site the programme names · 🟡 on every interactive sequence in group C and on every break-out's STEP, because which step uses which tool was explicitly declined (CP-06) and is therefore inference · 🔴 on frequency, duration and within-session ordering for every workflow without exception
evidence_ceiling: "ZERO observed human sequences. No session recording, no click path, no screen capture, no think-aloud, no support transcript exists in this programme's inputs — item 13's ceiling, and it bites harder here, because a workflow IS a sequence and a sequence is exactly what nothing recorded. ⭐ What this file has instead: A SCHEDULED JOB IS A WORKFLOW SOMEBODY AUTOMATED BECAUSE THEY WERE DOING IT BY HAND, and this estate is dense with them — the pod-side roster runs to the count derived in §2.5, every entry carrying a literal clock, a literal gate and sometimes a comment naming the person who asked for that time. ⛔ That is evidence about THE OWNER AND THE POD, never about a population. ⭐⭐ Since 2026-09-26 there is a second, narrower primary source: the owner's own statement that he personally uses every desk tool this programme names. That converts every break-out's TOOL from speculation to owner-stated fact and leaves the STEP as inference — the distinction is carried on every row rather than averaged away. ⛔ Three negatives are load-bearing and kept: (1) the one telemetry ordering the programme owns is measured over ADMIN session-days only; (2) NOTHING in this estate records a transition between two surfaces, so the break-out list in §5 is derived from capability gaps and owner tool-use, never from an observed exit; (3) a tool dependency can be retired by ordinary refactoring while the documentation describing it stays intact — CARD 24 measured exactly that, so every dependency claim here carries a date and a re-grep."
status: draft
date: 2026-09-26
---

# Professional Workflow Library

> ⭐⭐ **THE THESIS THIS FILE IS A COVERAGE INSTRUMENT FOR.** Owner, 2026-09-26: *"the goal is to
> aggreagte all the best features so someone can only use our site instead of the others."*
> ⛔ A workflow is exactly where that succeeds or fails. Features can all be present and the flow
> still break, because the member leaves at the one step nobody covered. So every entry below carries
> a **Break-out** line — where this flow leaves our site, and what for — and §5 is the ledger of
> those break-outs, which is the part of this document the thesis actually needs.

## 1. Headline — the four findings

**F1. ⭐⭐ The guard that watches for a missed morning wire cannot fire on the morning it names.**
`register_wire_watchdog_job` runs at **09:05 ET** on weekdays (`api/main.py:2515-2518`) and alerts when
`wire_date < expected` (`:2503`), with a message saying *"the engine laptop is likely off/asleep.
Members are seeing yesterday's list."* (`:2508-2510`). But `expected` comes from
`engine.expected_wire_date()`, which **rolls back one day whenever the clock is before 09:30 ET**
(`api/services/engine.py:545`). At 09:05, `expected` is *yesterday* — and a wire that missed this
morning is stamped *yesterday* too, because the payload's `date` is the run date
(`morning_wire_engine.py:12765` assigns `today_s`, set at `:12261` from `today_iso()` at `:154`,
which is `now_et()`). `yesterday < yesterday` is false. **The alert fires only when the wire is two
runs stale.** The same rollback makes the member badge read *fresh*: `wire_freshness()` returns
`"fresh"` when `wire_d >= expected_wire_date()` (`engine.py:573`), so between the expected landing
(~07:35 ET, that function's own docstring at `:531`) and 09:30 ET, a wire that never ran renders as
current and raises nothing. ⛔ **That blind window is the entire pre-open workflow** — everything item
13 files under §3.1 (`JTBD-P01`…`JTBD-P07`). And it has happened: the neighbouring docstring records
*"On 2026-08-14 the 06:35 run crashed before pushing and the dashboard served the prior day's rating
all day with nothing on screen, or in the payload, able to say so"* (`engine.py:558-560`).
⚠️ `wire_freshness` was **built for that incident** and does fix the render after 09:30; what
survives is the 07:35→09:30 window and the watchdog's one-day off-by-one.

**F2. ⭐⭐ The two schedulers that run this business are on different machines, different clocks, and
only one can be read.** The owner's PC roster is Level-1 seed fact (`charter/OWNER_SEED_FACTS.md:20`)
and ends with the sentence that shapes this whole document: *"None of this is visible from any
repository runtime. Start times are local Central Time."* The pod roster is in `api/main.py` and is
fully derivable (§2.5). So the estate's day is **half legible** — the consumer's clock answers a grep
and the producer's does not, and the only bridge is `POST /api/push` plus the two watchdogs in F1.
⛔ Worse for a workflow library: the seed fact names the PC jobs and **carries no start time for any
of them.** The times exist only outside this programme's tree, and the two rosters do not agree on
how many jobs there are (§8, C-3).

**F3. ⭐ The morning's first automated step is scheduled after the step that consumes it, and the
consumer does the work anyway.** `CLAUDE.md:3979` (master) says the scanner *"should run at 7:00 AM CT
via separate Task Scheduler entry to avoid 151s inline cost"*, while `:3978` puts the wire at
**7:35 AM ET = 6:35 CT** — twenty-five minutes *earlier*. The wire calls the scanner **inline
regardless** (`morning_wire_engine.py:11476`), which `capability-ledger.md` G5 independently records:
the scanner *"runs **in-process inside the morning wire on the PC**"*. ⛔ So the separate task does not
avoid the cost it was created to avoid, and the file path it feeds (`engine.get_candidates()`'s third
fallback, `api/services/engine.py:2701`) is reachable only by a run that happens *after* the wire
that would have read it. ⚠️ **And that step's health record cannot distinguish an empty scan from a
good one**: `morning_wire_engine.py:11478` writes `{"ok": True, "count": n}` on every non-exception
path, so a zero-name morning is `ok: True` with `count: 0`, distinguished only by a `print` to stdout
on one laptop (`:11479-11480`).

**F4. ⭐⭐ The break-out ledger, and the shape it comes out in.** §5 classifies every workflow by
where it leaves our site. The classes are derived, not typed (§2.5), and the shape is the finding:
**the break-outs that can be closed cluster in a handful of named steps, while the ones that cannot
are almost all destinations we chose** — Discord, Substack, YouTube, a broker, a member's own calendar.
⛔ And one is closed by governing default rather than by capability: `OWNER_SEED_FACTS.md` §6 puts
*"no execution or order management"* off the table for V1, so **every workflow that ends in placing a
trade leaves our site by design.** That is a structural break-out, it is recorded as one, and nothing
here proposes execution.

⚠️ **A fifth thing, found while writing this and large enough to name here.** CARD 24 measured that
the in-app Finviz static chart is **gone**: `git grep -nE "chart\.ashx" origin/master -- app/src`
returns **zero occurrences** (re-run for this file; the only master hits outside `app/src` are
`CLAUDE.md`, three design docs, and two lines in the partner-owned `api/schwab_router.py:424`,
`:440`), `app/src/pages/Breadth.jsx:343` records the old `DrillModal` as **deleted** and `:347`
lazy-imports `pages/breadth/drill/BreadthDrillModal` instead, `:49` lazy-imports `ChartPane`, and
`ThemeTrackerPage.jsx:7`/`:39`/`:1505`/`:1537` mounts `StockChart` **and** `ChartPane`. Master's
`CLAUDE.md` still documents the deleted Finviz PNG tabs and a `chartPeriod` default of `'tv'` as live.
⛔ **So item 13's `JTBD-M02` "current solution" line describes a component that no longer exists**,
and CARD 24 flags re-reading item 13's absorb-outright verdict against master as *"the highest-value
correction outstanding"*. This file does not re-cut that verdict — it records the state, dates it, and
writes WF-C13 around what survives: **whether the owner opens finviz.com by hand**, which is a
desk-behaviour question no code read can answer.

---

## 2. Method

### 2.1 What a workflow is here, and how it differs from item 13

Item 13 asks *what is someone trying to accomplish*. This file asks *how the work moves through time,
and where it leaves*. Every entry in §4 answers every one of these or it does not belong there:

1. **Trigger** — what starts it: a clock, an arrival, or a person's intent.
2. **Runs** — does this sequence execute today? `yes` / `partly` / `no` / `not measured`.
3. **Sequence** — ordered steps, each attributed: `[owner]`, `[owner-pc]`, `[pod]`, `[desk]`,
   `[member]`, `[external]`, `[programme]`.
4. **On screen** — what is open while it happens, cited, or **not measured**.
5. **Hand-off** — the artifact that crosses a boundary, and which boundary.
6. **Waiting** — where the clock stalls, with a measured duration where one exists.
7. **Fails when** — the step that breaks, and **whether anything notices**.
8. ⭐ **Break-out** — where the flow leaves our site and what for, in one of five classes (§2.4).

Plus **Serves** (item 13's JTBD ids, cited never restated) and **Evidence** (`path:line` against a
pinned SHA, or a named artifact).

⛔ The test applied before keeping an entry: **could this be written without naming a time, an order,
or a boundary?** If yes it is a job, not a workflow, and item 13 owns it. Four candidates failed and
were dropped rather than padded — "screening", "journalling", "alerting" and "charting" are each a
capability whose timing lives entirely inside one of the entries below.

### 2.2 The evidence tiers, in the order they were trusted

1. **Owner testimony, Level-1** (`GOVERNING_PRINCIPLES.md` §2). The statements that reach this file:
   `OWNER_SEED_FACTS.md:20` (the PC roster, names only) · the 2026-09-19 OI-06 answer naming four
   hand-opened tools plus unitemised others (`OWNER_INPUTS_REQUESTED.md:14`) · and three of
   2026-09-26, relayed mid-flight: **(a)** *"the goal is to aggreagte all the best features so
   someone can only use our site instead of the others"* — the thesis this file instruments;
   **(b)** *"Assume that i personally use every other site mentioned"* — ⭐ which makes every external
   tool this programme names **confirmed in the owner's personal use**, and is why no break-out below
   is hypothetical as to its tool; **(c)** *"We have 750 members in discord paying. Dont worry aobut
   anything else on costs or uses."* — a population fact bounded in §2.3 and a de-scoping obeyed in
   §2.4.
   ⛔ **(b) is an existence statement, not a task attribution.** It says he uses Finviz; it does not
   say which step. CP-06 records that he declined to itemise per-tool workflows, so every break-out
   row separates **tool: owner-stated** from **step: inference**.
2. **A scheduled job.** ⭐ The workhorse of this file. A `CronTrigger` is a machine-readable statement
   that somebody wanted a thing to happen at a time — usually because they had been doing it by hand.
   Several name the person in the comment: the catalyst hunter's times are annotated *"(user-defined
   2026-07-02): traders check the board at 8:00 / 8:30 / 8:45 AM ET"* (`api/main.py:6832-6835`), and
   the buzz digest's slot loop *"The owner asked for the board through the session (2026-09-02), not
   once at the close"* (`:6502-6504`). ⚠️ A cron line proves intent, never use.
3. **A recorded incident with a date.** `engine.py:558-560` (the 2026-08-14 wire crash); the
   2026-08-31 `SCAN HEALTH FAILED` run (item 13 `JTBD-P02`); the 2026-09-13 escalation in which
   *"27 videos were set unlisted and then restored"* (`CLAUDE.md:15-18`, this worktree); the
   2026-05-22 COT miss (`CLAUDE.md`, COT section). ⭐ An incident is the only class that describes a
   sequence *as it actually ran*.
4. **Production telemetry**, as an existence check only — `OI-06-telemetry-derived-defaults.md`, read
   in-pod against `/data/auth.db` at `mode=ro`, 29 users (6 admin · 23 member), 13 with any
   `page_views` row (`:8`).
5. **Code paths and in-file comments**, labelled CLAIM unless a scheduler entry, log line or artifact
   confirms them, per `_SHARED_PREAMBLE.md`. ⛔ **And re-grepped with a date**, per CARD 24's lesson:
   *"a COMPETITIVE dependency can be retired by ordinary refactoring while the research describing it
   stays perfectly intact."*

### 2.3 ⛔ Whose workflow, and whose population

CARD 22 refused a simulated beta test because *"a simulated trader preferring a simulated terminal is
evidence about the simulation."* The sequence-specific form of that rule governs here: **a sequence
attributed to "professional traders" with no artifact is a fabrication.** So:

- Groups A and B are **the owner's and the pod's**, labelled as such. A cron line the owner wrote is
  legitimate evidence about the owner; an external tool he says he uses is legitimate evidence about
  his desk.
- Group C is **the desk's**, and its one telemetry anchor is admin-only: the session-opener column in
  `OI-06-telemetry-derived-defaults.md:26-28` is headed *"by FIRST surface of a session-day (admins,
  50 day-sessions)"*. ⚠️ The total-views column beside it is over all 13 users with rows, so the two
  halves of that finding have **different populations**.
- ⛔⛔ **Two products, two populations, never one denominator.** CARD 23 rules that the **$7/week is
  the Whop plan — a separate live-trading Discord product**, merely promoted through the wire's
  Substack, and *"out of this programme's boundary"*. The owner's ~750 paying members are **Whop's**.
  UCT Intelligence's population is the 29-account roster above, 13 of them with any page-view row.
  **Nothing in this file merges them**, and no workflow below is built on the Whop product without
  saying so (none is).
- Nothing anywhere here is attributed to "members" as a behavioural claim. Where a member path exists
  in code, the entry says the path exists and that use is **not measured**.

### 2.4 The break-out field — definition, classes, and two constraints

A **break-out** is a point where the person doing this workflow **leaves our site**, and what they
leave it for. It is a property of a *sequence*, which is why nothing else in the programme is
positioned to list them: item 13 has the jobs and the competitive research has the tools, but the
hand-off happens in an order.

Exactly one class per entry, written as the first token of the Break-out line so it can be counted
(§2.5):

- **NONE** — the flow completes on our site today. ⭐ Fully substituted; the thesis already holds here.
- **ADDRESSABLE** — a person leaves for a named tool at a named step. **Tool: owner-stated
  2026-09-26. Step: this file's inference, labelled.** ⭐ This is the list the thesis needs.
- **STRUCTURAL** — leaves by design, and no feature closes it. Three sources: a destination we chose
  and do not own (Discord, Substack, YouTube), a place the member's capital or calendar actually lives
  (a broker, a calendar app), or a governing default. ⛔ **The governing one:
  `OWNER_SEED_FACTS.md` §6 puts *"no execution or order management"* off the table for V1, so any flow
  ending in placing a trade is structural and stays structural. Nothing here proposes execution.**
- **NOT MEASURED** — the flow certainly ends somewhere and nothing in the inputs says where.
  ⛔ Kept, never converted to NONE: an unobserved exit is not an absent exit.
- **N/A (machine flow)** — no person in the loop. External *provider* dependencies are named on the
  row but are not break-outs, because nobody opens a tab.

⛔ **Two things this field is not.** It is not a feature gap — a gap with no step is item 16's. And it
carries **no cost, spend or usage-rate reasoning**, per the owner's *"Dont worry aobut anything else
on costs or uses."*

### 2.5 Counting discipline

⛔ No count in this file is hand-typed. Each is a command with its output.

- **Workflows** = `grep -c '^#### WF-' docs/terminal-research/04-workflows/workflow-library.md`
- **Quarantined** = `grep -c '^#### WEAK-WF-' docs/terminal-research/04-workflows/workflow-library.md`
- **Break-outs by class**, over the same file — the four that matter and the machine remainder:
  ```
  grep -c '^- \*\*Break-out\.\*\* NONE'          <file>
  grep -c '^- \*\*Break-out\.\*\* ADDRESSABLE'   <file>
  grep -c '^- \*\*Break-out\.\*\* STRUCTURAL'    <file>
  grep -c '^- \*\*Break-out\.\*\* NOT MEASURED'  <file>
  grep -c '^- \*\*Break-out\.\*\* N/A'           <file>
  ```
  ⭐ Their sum must equal the workflow count; if it does not, an entry is missing its field and that
  is a defect in this document, catchable by one addition.
- **Pod-side scheduled registrations** (group B's raw material), by AST over the pinned blob, never a
  grep:
  ```
  git show origin/master:api/main.py > /tmp/main_master.py
  python -c "import ast; t=ast.parse(open('/tmp/main_master.py',encoding='utf-8').read()); \
    print(sum(1 for n in ast.walk(t) if isinstance(n,ast.Call) and \
    (ast.unparse(n.func).endswith('.add_job') or ast.unparse(n.func)=='_add_compass_job')))"
  ```
  → **168** at `74bdf4f68dd020af10a64b3cb5a6a64e0751ac11`. Distinct **literal** ids, same walk
  filtered to `k.arg=='id' and isinstance(k.value, ast.Constant)` → **164**; the remainder are three
  f-string ids and one registration with no `id`. Registrations whose call text contains `mon-fri`
  → **68**.
- **PC-side jobs named by the Level-1 seed fact**:
  ```
  sed -n '20p' docs/terminal-research/00-program-control/charter/OWNER_SEED_FACTS.md \
    | sed 's/^.*daily pipeline: //; s/\. None of this.*$//' | tr ',' '\n' \
    | sed 's/^ *and *//' | grep -c .
  ```
  → **9**. The same roster **with start times**, from outside the programme
  (`…\memory\MEMORY.md:187`): `sed -n '187p' … | tr '·' '\n' | grep -c .` → **8**. ⚠️ They disagree;
  §8, C-3.
- **Windows tasks in the RTH runbook's own table**:
  `git show origin/master:docs/runbooks/rth-scheduling.md | grep -c '^| \`UCT RTH'` → **8**, against
  that file's opening *"Nine Windows scheduled tasks…"* (`:3`). ⚠️ §8, C-4.
- **In-app Finviz chart occurrences** (the CARD 24 re-grep, dated 2026-09-26):
  `git grep -nE "chart\.ashx" origin/master -- app/src` → **zero**.
- Item 13's populations, quoted with the commands that file states: `grep -c '^#### JTBD-'` → **45**;
  `grep -c '^#### WEAK-'` → **6**.

⭐ **Every clock time in groups A and B is the literal inside the cited `CronTrigger`**, read off the
pinned blob. None was typed from memory, and `_ET = ZoneInfo("America/New_York")` is
`api/main.py:19` — which matters, because a naive trigger resolves to UTC on Railway and the file says
so at `:6500-6501`.

### 2.6 Grouping, and why by machine before by hour

§4 is **A: the owner's PC (Central Time) · B: the pod (Eastern Time) · C: the desk at a screen ·
D: the desk as publisher · E: the programme's own measurement.** Grouping by hour would have been
prettier and would have hidden F2: the two automated groups are on different clocks and only one is
readable, and a merged timeline would have silently normalised them. ⚠️ Central and Eastern are one
hour apart in this roster; every cross-group time is written in the zone its source used, with the
conversion inline where the comparison matters.

---

## 3. The clock, as far as it is readable

### 3.1 The owner's machine — Central Time; names from the programme, times from outside it

| job (seed-fact name) | start (CT) | = ET | what the programme knows |
|---|---|---|---|
| wire critic | 05:00 | 06:00 | pulls the owner's per-segment thumbs/notes and writes `wire_prompt_config` (WF-D02) |
| morning wire | 06:35 | 07:35 | the engine; `engine.expected_wire_date()`'s docstring independently states *"The wire lands ~7:35 AM ET on weekdays"* (`engine.py:531`) |
| pre-market scanner | 07:00 | 08:00 | ⛔ **after** the wire that consumes it — F3; and `capability-ledger.md` G5 says the scan runs *in-process inside the wire* |
| breadth collector | 15:15 | 16:15 | ⚠️ `CLAUDE.md:4010` and `:5921` say **16:30 ET**; `:4168` says *"the 4:15 collector"* — §8, C-2 |
| UCT20 end-of-day | 15:20 | 16:20 | `UCT20_INCEPTION` / `BOOK_RECORD_START` are the only record authorities (item 13 `JTBD-C03`) |
| brain pre-close | 15:30 | 16:30 | the five-times-daily brain's pre-close pass (item 13 `JTBD-C01`) |
| EOD updater | 16:05 | 17:05 | **not measured** — no input characterises it beyond the name |
| market ingest | 20:05 | 21:05 | **not measured** |
| *(a five-times-daily brain)* | — | — | named at `OWNER_SEED_FACTS.md:20`; **no times anywhere** |
| *(UCT Brain Pack Export)* | 21:00 | 22:00 | `CLAUDE.md:572-573`, a CLAIM; **absent from the seed-fact roster** |

⛔ The EOD updater and market ingest are names only — no input characterises either beyond its hour —
and a further job is scheduled on this machine per `CLAUDE.md:572-573` and is missing from the Level-1
roster the §2.5 derivation counts. **The PC roster is not a closed list.**

### 3.2 The pod — Eastern Time, fully derivable

The roster is the AST walk in §2.5. Read as a day: a **nightly rebuild** 02:00→05:30 ET
(`screener_analyst_pass` 02:00 `:1970`, `ratings_percentile_nightly` 02:30 `:6719`,
`broker_sync_nightly_reconcile` 02:30 `:6160`, `authdb_backup_nightly` 02:55 `:6339`,
`screener_snapshot_nightly` 03:00 `:1680`, `screener_scan_hits_prune` 04:00 `:1795`,
`ticker_types_daily_sync` 05:30 `:5914`, `oi_snapshot_daily` 05:30 `:7600`); a **pre-open warm and
brief chain** 06:20→09:20 (WF-B02); a **continuous open** 09:30→16:00 with per-minute samplers
(WF-B03); a **close chain** 15:45→23:59 (WF-B05); and a **weekly rail** Friday afternoon through
Sunday (WF-B08).

⭐ **The most workflow-revealing property of this roster is that its busiest hour is 08:00–09:30 ET —
before the bell.** Several subsystems each schedule their own pre-open pass, and `catalyst_premarket_hunt`
(`:6838`), `ai_search_briefings_premarket` (`:6760`) and `floor_premarket_brief` (`:5416`) each exist to
have an answer ready *before* a person asks. That is what an automated pre-open workflow looks like from
outside.

---

## 4. The library

Read **Evidence** first, then **Runs**, then **Break-out**. An entry whose Evidence line carries no
path, SHA or named artifact is a defect in this document.

### 4.1 Group A — the owner's own automated day (PC, Central Time)

⚠️ Every entry here is **the owner's workflow**, evidenced by the owner's own automation and Level-1
seed fact. None is a claim about any other person.

#### WF-A01 — The overnight correction, then the pre-open build
- **Trigger.** Clock: 05:00 CT (wire critic), then 06:35 CT (the engine).
- **Runs.** `yes` — 🟡 from the roster and the engine's code; the pod independently expects the output
  at 07:35 ET (`engine.py:531`), and `wire_freshness`'s docstring records a run of it crashing on a
  named date (`:558-560`), the strongest available confirmation that this sequence runs.
- **Sequence.** `[owner-pc]` 05:00 CT the critic reads the previous issue's per-segment 👍/👎 and notes
  and writes distilled guidance plus ≤3 exemplars into `wire_prompt_config` → `[owner-pc]` 06:35 CT
  the engine runs and `generate_rundown` reads that config back → `[owner-pc]` the engine runs the
  **three Finviz scans in-process** (`morning_wire_engine.py:11476`; `capability-ledger.md` G5) plus
  gappers, breadth, leadership and earnings → `[owner-pc]` assembles `_wire_data`, stamping
  `"date": today_s` (`:12765`) → `[owner-pc → pod]` `POST /api/push` with
  `Authorization: Bearer <PUSH_SECRET>` → `[pod]` `api/routers/push.py` writes the payload to
  `PERSISTENT_WIRE_DATA_FILE` (default `/data/wire_data.json`) and invalidates every key in
  `INVALIDATE_KEYS` → `[pod]` every wire-reading surface re-renders.
- **On screen.** ⛔ **Not measured.** Nothing says whether the owner watches the run or reads the draft.
- **Hand-off.** ⭐ **The most important boundary crossing in the estate**: one HTTP POST from a Windows
  laptop to a Railway pod, carrying the whole payload. `push.py`'s own header warns that its writer
  constant and `api/main.py:192`'s boot-time reader hold *"the SAME literal … one value with two
  authorities"*.
- **Waiting.** The engine's runtime, stated twice and inconsistently: *"~7.7 min"* (`CLAUDE.md:3977`)
  and *"~10-11 min total"* (`:4328`) — §8, C-1.
- **Fails when.** The laptop is off or asleep, or the run crashes before pushing. ⛔ **Nothing notices
  inside the pre-open window** — F1. `CLAUDE.md`'s *"NEVER do a partial `/api/push` — always push full
  wire_data or the cache gets clobbered"* names a second failure of the same hand-off.
- **Break-out.** N/A (machine flow) — no person in the loop. ⚠️ Its **provider** dependency is real
  and is the desk's one hard operational one: Finviz Elite's three scans (`capability-ledger.md` G5;
  item 13 `JTBD-P02`). ⛔ CARD 24 retired the in-app Finviz **chart**; it does not touch these
  **scans**, which are a separate dependency and still load-bearing as of 2026-09-26.
- **Serves.** `JTBD-P01`, `JTBD-P02`, `JTBD-P05`, `JTBD-B01`, `JTBD-B02`.
- **Evidence.** 🟢 `OWNER_SEED_FACTS.md:20`. 🟢 `morning_wire_engine.py:154`, `:11472-11487`, `:12261`,
  `:12765`. 🟢 `api/routers/push.py` (header + `INVALIDATE_KEYS`). 🟢 `api/services/engine.py:528-573`.
  🟡 `capability-ledger.md` G5 (under the staleness banner). 🟡 runtime: `CLAUDE.md:3977` / `:4328`.

#### WF-A02 — The standalone pre-market scanner nothing downstream waits for
- **Trigger.** Clock: 07:00 CT (08:00 ET).
- **Runs.** `yes` per the roster — 🔴 on whether its output is ever consumed (F3).
- **Sequence.** `[owner-pc]` three Finviz Elite queries → the 7-criteria candle score and
  `_detect_wedge_flag` → atomic write of `data/candidates.json` → `[nothing]`. The reader prefers the
  cache, then `wire_data["candidates"]`, and only then the file (`api/services/engine.py:2689-2710`) —
  and on a normal morning `wire_data["candidates"]` is already populated by WF-A01's in-process run.
- **On screen.** Not measured.
- **Hand-off.** A file on one machine whose only reader labels it *"local file (dev fallback)"*
  (`engine.py:2700`).
- **Waiting.** ⛔ The inverse: the consumer does not wait, because it already ran the producer itself
  twenty-five minutes earlier.
- **Fails when.** Finviz returns nothing. ⛔ **The structured health record says OK**
  (`morning_wire_engine.py:11478`); the distinction is a `print` to one laptop's stdout
  (`:11479-11480`).
- **Break-out.** N/A (machine flow) — provider dependency Finviz Elite, as WF-A01.
- **Serves.** `JTBD-P02`, `JTBD-P04`.
- **Evidence.** 🟢 `CLAUDE.md:3979` (the stated purpose, a CLAIM). 🟢
  `morning_wire_engine.py:11476-11487`. 🟢 `api/services/engine.py:2687-2710`. 🟡 the 2026-08-31
  observed failure via item 13 `JTBD-P02`.

#### WF-A03 — The intraday breadth collect
- **Trigger.** Clock: 15:15 CT per the roster — ⚠️ or 16:15 ET, or 16:30 ET, depending which artifact
  you read (§8, C-2).
- **Runs.** `yes` — 🟡, with the pod side confirmed by construction: `useLiveBreadth` returns nothing
  once the collector's day is `superseded` (`CLAUDE.md:4168`), so the live row's disappearance **is**
  the arrival signal.
- **Sequence.** `[owner-pc]` `breadth_collector.py` computes the 40+ metrics → pushes to the pod →
  `[pod]` the recorded day supersedes the intraday row, which is then hidden **by design**.
- **On screen.** The Breadth Monitor's live row, until it vanishes. Not measured for the owner.
- **Hand-off.** PC → pod push, then an in-product *state* change (live row → recorded row).
- **Waiting.** ⭐ The gap between 16:00 ET and the collector's write is the window in which the live
  row is the only answer — and `CLAUDE.md:4168` says *"No live row after 4:15 is not a regression"*,
  which is a statement about a workflow, not a bug report.
- **Fails when.** The machine is unplugged: `CLAUDE.md:5921` records *"Battery settings disabled (was
  killing the job on unplug)"* — a real, fixed, workflow-level failure of this exact step.
- **Break-out.** N/A (machine flow).
- **Serves.** `JTBD-M01`, `JTBD-C03`.
- **Evidence.** 🟢 `OWNER_SEED_FACTS.md:20`. 🟡 `CLAUDE.md:4010`, `:4168`, `:5921`.

#### WF-A04 — The close-out chain
- **Trigger.** Clock: 15:20 CT (UCT20 EOD) → 15:30 CT (brain pre-close) → 16:05 CT (EOD updater).
- **Runs.** `yes` per the roster. 🔴 on internals — **not measured**.
- **Sequence.** `[owner-pc]` UCT20 end-of-day → `[owner-pc]` brain pre-close → `[owner-pc]` EOD
  updater. ⛔ Whether these are a chain or three adjacent independent jobs is **not established**: the
  roster is a list, not a dependency graph.
- **On screen.** Not measured.
- **Hand-off.** Presumed PC → pod pushes; not measured per job.
- **Waiting.** Not measured.
- **Fails when.** The same single-machine dependency as every entry in this group.
- **Break-out.** N/A (machine flow).
- **Serves.** `JTBD-C01`, `JTBD-C03`.
- **Evidence.** 🟢 `OWNER_SEED_FACTS.md:20` for existence and ordering-by-clock. 🔴 nothing else.

#### WF-A05 — The overnight ingest
- **Trigger.** Clock: 20:05 CT (21:05 ET).
- **Runs.** `yes` per the roster; **not measured** otherwise.
- **Sequence / On screen / Hand-off / Waiting / Fails when.** ⛔ **Not measured.** Recorded so its
  absence is a decision rather than an oversight — it is one of the nine Level-1 jobs and the
  programme knows nothing but its name and its hour.
- **Break-out.** N/A (machine flow).
- **Serves.** Not determined.
- **Evidence.** 🟢 `OWNER_SEED_FACTS.md:20`. 🔴 nothing else in the inputs.

#### WF-A06 — The nightly brain pack, PC → R2 → pod
- **Trigger.** Clock: weekdays 21:00 CT.
- **Runs.** `not measured` — a CLAIM in `CLAUDE.md` and **absent from the Level-1 roster**, which is
  itself the finding: the nine-job list does not close.
- **Sequence.** `[owner-pc]` `scripts/brain_pack_export.py --upload` builds engine code plus a
  consistent SQLite backup of the KB → writes `brain/<ts>.tar.gz` and `brain/latest.txt` to R2,
  pruning to the newest five → `[pod]` `brain_sync` pulls `latest.txt` on boot and every 6 h, verifies
  (path-traversal guard, required members, `PRAGMA integrity_check`), installs atomically → `[pod]` an
  `on_install` callback reindexes the semantic KB.
- **On screen.** None — machine to machine.
- **Hand-off.** ⭐ **A two-repo contract**: the pack layout is *"a contract between uct-intelligence …
  and uct-dashboard … Change both sides together or not at all."*
- **Waiting.** Up to 6 h for the pod's refresh; new engine *code* also needs a process restart while
  the *DB* re-reads per connection.
- **Fails when.** Either side of the layout contract moves alone.
- **Break-out.** N/A (machine flow).
- **Serves.** `JTBD-X05`, `JTBD-B03`.
- **Evidence.** 🟡 `CLAUDE.md:572-573` and its Brain-Pack section (CLAIM throughout).

#### WF-A07 — The Monday measurement rig (operator, not trader)
- **Trigger.** Clock: Sunday 20:00 ET preflight, then Monday 07:45 → 18:00 ET.
- **Runs.** `yes` — 🟢 mechanism, from a runbook naming each task and both zones.
- **Sequence.** `[owner-pc]` Sun 20:00 ET preflight (no rig) → Mon 07:45 ET preflight **+ one rig
  run** → 08:10 ET keepalive saves and disables lock/power settings and holds the machine awake until
  18:00 → 09:20 ET open run (items 1–15, 7 h limit) → 09:35 ET watchdog → 16:20 ET close run (items
  16–23, pushes after 16:15 ET) → 16:35 ET watchdog → 18:00 ET restore, *"regardless of how anything
  else ended"*.
- **On screen.** An unlocked, awake Windows desktop — the preflight *"fails with the literal message
  'unlock the screen'"*.
- **Hand-off.** `run-open.json` / `run-close.json` on disk; a Windows toast **plus** a status file,
  deliberately **not** Discord (*"The only webhooks configured on this machine … belong to the
  Sunday-scan publishing path"*).
- **Waiting.** The whole session; the watchdogs exist because the waiting is otherwise unobservable.
- **Fails when.** ⛔⛔ **The machine is powered off.** *"Nothing wakes a machine that is powered off"*,
  and the mitigation is that *"a missing Sunday alert is the signal — not a quiet success."*
  ⭐ **This is the same single point of failure as WF-A01 through WF-A05, written down once, in the one
  place that treats it as a first-class operational fact.**
- **Break-out.** STRUCTURAL — this flow lives on a Windows desktop, in a toast and in a file; it is
  not a site workflow and cannot be made one. Recorded because it is the only artifact that states the
  power dependency the whole PC-side pipeline shares.
- **Serves.** Nothing in item 13 — an operator workflow, kept for that one sentence.
- **Evidence.** 🟢 `docs/runbooks/rth-scheduling.md:3`, `:11-23`, `:42-49`, `:51-53`, `:64-70`
  (master). ⚠️ Its prose count and its own table disagree — §8, C-4.

### 4.2 Group B — the pod's automated day (Eastern Time)

⚠️ This group is **the product's** workflow, not a person's. Each clock is the literal in the cited
trigger at `74bdf4f68`.

#### WF-B01 — The nightly rebuild, 02:00 → 05:30 ET
- **Trigger.** Clock, nightly (mostly **not** weekday-gated).
- **Runs.** `partly` — registrations 🟢 by code; several flag-gated with the flag unreadable from here.
  `scan_evaluator.enabled()` defaults `"0"` while `SCAN_SWEEP_ENABLED=1` was read live on web, so
  **a local run behaves differently from production**.
- **Sequence.** `[pod]` `screener_analyst_pass` 02:00 (`:1970`) → `screener_insider_capture` 02:40
  (`:1957`) → `screener_finviz_universe` 02:45 (`:1909`) → `screener_earnings_dates` 02:50 (`:1922`) →
  `screener_opt_flow_pull` 02:55 (`:1944`) → `screener_snapshot_nightly` 03:00 (`:1680`) → the sweep
  and its alerts at `scan_evaluator.SWEEP_HOUR_ET` / `+10 min` (`:1763`, `:1873`) →
  `alert_taxonomy_scan_membership_dark` at `+20 min` (`:7328`) → `screener_scan_hits_prune` 04:00
  (`:1795`); alongside `patterns_universe_scan` 01:00 (`:7750`) and `patterns_prune` 00:40 (`:7757`).
- **On screen.** Nobody — that is the point of the hour.
- **Hand-off.** ⭐ `screener_rows` → a scan definition's answer. `scan_evaluator.cadence_ceiling`
  derives that *"all declared scalars are `cadence: nightly`, so a scan re-read at noon returns the
  same answer off the same 03:00 snapshot"* — i.e. **the freshness of a member's screen is a property
  of this chain's clock, not of when they open it.**
- **Waiting.** Up to 21 h between a definition's answer and the next rebuild.
- **Fails when.** A stage fails silently. The estate's rail is `CoverageLine`'s four counts
  (*evaluated · answered · dropped · not computable*), because *"a screen that silently loses symbols
  returns fewer hits and looks like a quiet market."*
- **Break-out.** N/A (machine flow) — provider dependency includes Finviz's universe pull (`:1909`).
- **Serves.** `JTBD-P02`, `JTBD-X07`, `JTBD-M06`.
- **Evidence.** 🟢 `api/main.py:1680`, `:1763`, `:1795`, `:1873`, `:1909`, `:1922`, `:1944`, `:1957`,
  `:1970`, `:7328`, `:7750`, `:7757`. 🟡 flag state and the `CoverageLine` reasoning: `CLAUDE.md`.

#### WF-B02 — The pre-open warm-and-brief chain, 06:20 → 09:20 ET
- **Trigger.** Clock, weekday-gated from 08:00 on.
- **Runs.** `partly` — registrations 🟢; several gates default off (`calendar_alerts_*` default 0,
  `terminal-current-map.md:543`).
- **Sequence.** `[pod]` `earnings_preview_warm` 06:20 (`:6741`) → `catalyst_premarket` feed ticks
  06:00/06:30/07:00/07:30 (`:6845`) → `calendar_alerts_morning` 07:00 (`:7010`) →
  `compass_daily_focus` 07:30 (`:7518`) → `catalyst_morning_digest` 08:00 (`:6954`) →
  `catalyst_premarket_hunt` 08:00/08:30/08:45 (`:6838`) → `ai_search_briefings_premarket` 08:20
  (`:6760`) → `earnings_analysis_warm` 08:35 (`:6748`) → `floor_premarket_brief` 08:45 (`:5416`) →
  `breadth_live_preopen_warm` 09:05 (`:5955`) **and** `wire_freshness_watchdog` 09:05 (`:2515`) →
  `desk_article_audit` 09:10 (`:6617`) → `floor_daily_heartbeat` 09:20 (`:5400`), with
  `voice_proactive_premarket` every 15 min across the whole of it (`:7096`).
- **On screen.** ⭐ The hunt's comment names it: *"traders check the board at 8:00 / 8:30 / 8:45 AM
  ET"* (`:6832-6835`) — an owner-stated screen-check rhythm recorded in code on 2026-07-02.
- **Hand-off.** Independent subsystems each produce their own *brief* for the same window
  (`compass_daily_focus`, `catalyst_morning_digest`, `ai_search_briefings_premarket`,
  `floor_premarket_brief`) and **nothing joins them**. ⛔ That is item 13's `JTBD-E02` join gap on the
  producing side.
- **Waiting.** The warms exist *because of* waiting: `earnings_preview_warm` removes a *"25–40 s cold
  wait"* inside the earnings modal (`terminal-current-map.md:662`).
- **Fails when.** The wire never lands (WF-A01) — every job here runs anyway, on yesterday's payload,
  with the watchdog structurally unable to say so (F1).
- **Break-out.** N/A (machine flow).
- **Serves.** `JTBD-P01`, `JTBD-P03`, `JTBD-P04`, `JTBD-P07`, `JTBD-X05`.
- **Evidence.** 🟢 every `api/main.py` line above. 🟢 `terminal-current-map.md:541-543`, `:662`.

#### WF-B03 — The open, 09:30 → 16:00 ET: sampling instead of watching
- **Trigger.** Clock: the session.
- **Runs.** `yes` for the ungated samplers; `partly` for the dark alert lanes.
- **Sequence (concurrent, not ordered).** `[pod]` `breadth_live_intraday_sample` every minute hours
  9–16 (`:6021`) · `exposure_gate_watch` every 2 min (`:6555`) · `darkpool_intraday_ingest` every
  3 min hours 7–16 (`:5644`), `…_scanner` every 5 min (`:5682`), `…_warm` every 12 min (`:5676`) ·
  `pattern_vision_judge` hourly (`:3007`) · `floor_signal_cycle` at :00 and :30 (`:5412`) ·
  `tweet_poll_burst_open` 09:30–09:58 every 2 min (`:6572`), `…_regular_midday` every 15 min
  (`:6578`) · `voice_proactive_scan` every 30 min (`:7101`) · `awareness_engine_scan` every 20 min
  hours 4–20 (`:7130`) · three `alert_taxonomy_*_dark` lanes on **every minute** of 9–16 (`:7195`,
  `:7283`, `:7448`) · `d2_dual_compute_warm_reader` at :45 (`:7497`).
- **On screen.** Not measured. ⚠️ The one thing known about the intraday screen is that the desk's
  *total* views concentrate in `/journal/notebook` and `/charts`
  (`OI-06-telemetry-derived-defaults.md:28`) — a volume fact with no timestamps, so it cannot be
  placed inside the session.
- **Hand-off.** Sampler → store → poll. The breadth live row is the clean case: a drill list *"MUST
  come from the mask that produced the count — never a second pass"*, and the lists are *"cached
  BESIDE the payload, never IN it"* because the live endpoint *"is polled every 60 s by every
  Dashboard user on a single-process pod."*
- **Waiting.** ⭐ **The group exists to remove a person's waiting and replaces it with a sampling
  interval** — a different thing, and a per-minute sampler on a single-process pod is a load statement
  as much as a freshness one.
- **Fails when.** A sampler saturates — `lesson_a_saturated_instrument_reports_zero`; the concrete
  instance is the bars broadcaster's `Queue(64)` drop-oldest (`capability-ledger.md` A5).
- **Break-out.** N/A (machine flow).
- **Serves.** `JTBD-O01`, `JTBD-O03`, `JTBD-O04`, `JTBD-M01`, `JTBD-M06`.
- **Evidence.** 🟢 every `api/main.py` line above. 🟡 `capability-ledger.md` A5 (staleness banner).
  🟡 `CLAUDE.md` for the drill-list invariants.

#### WF-B04 — The intraday board, posted on the owner's own slots
- **Trigger.** Clock: seven ET slots, weekdays.
- **Runs.** `partly` — registered; gated, and the gate's failure direction is silence.
- **Sequence.** `[pod]` `buzz_poll` on an interval (`:6486`) → one `add_job` **per slot** from
  `discord_buzz_digest.digest_times()` (`:6511-6519`), each labelled so *"the per-slot dedup keys off
  what was SCHEDULED, not off the clock when it happened to fire"* → `[external]` Discord.
- **On screen.** Discord, not the product.
- **Hand-off.** Product → community channel.
- **Waiting.** Up to one slot gap.
- **Fails when.** `BUZZ_DIGEST_TIMES` is malformed: `digest_times()` returns **empty and warns**, and
  says why it must never fall back — *"Falling back would post at times the owner did not ask for and
  make a typo indistinguishable from the default"* (`discord_buzz_digest.py:52-55`).
- **Break-out.** STRUCTURAL — the destination **is** Discord, a platform we do not own. ⛔ Closing it
  would mean moving the board into our site, which is a different product decision and not this
  file's.
- **Serves.** `JTBD-M06`, `JTBD-B03`.
- **Evidence.** 🟢 `api/main.py:6486`, `:6500-6519`. 🟢 `api/services/discord_buzz_digest.py:46`,
  `:49-74`. ⭐ `api/main.py:6502-6508` records the owner's own request and `DEFAULT_TIMES` (`:46`) is
  where it now lives — **read from the constant, not typed here.**

#### WF-B05 — The close chain, 15:45 → 23:59 ET
- **Trigger.** Clock, weekday-gated for most steps.
- **Runs.** `partly`.
- **Sequence.** `[pod]` `discord_index_close` 15:45 (`:2861`) → retry 15:58 (`:2876`) →
  `bars_nightly_refresh` 16:15 (`:7061`) → `discord_flow_daily_stats` 16:25 (`:6466`) →
  `compass_eod_recap` 16:30 (`:7661`) → `broker_live_sentinel_daily_pulse` 16:35 (`:6247`) →
  `ai_search_briefings_postmarket` 16:45 (`:6763`) → `watchlist_daily_digest` 17:00 (`:7050`) →
  `breadth_ohlc_intraday_agg` 17:15 (`:6046`) → `alert_taxonomy_catalyst_match_dark` 17:30 (`:7366`) →
  `calendar_alerts_evening` 18:00 (`:7003`) → `transcript_keyword_alerts` 18:30 (`:2831`) →
  `darkpool_massive_ingest` 19:20 (`:5576`) → `nightly_side_heal` 19:30 (`:5757`) →
  `flow_nightly_prune` 20:00 (`:7557`) → `signature_sweep` 20:05 (`:2220`) → `darkpool_eod` 20:10
  (`:5703`) → `catalyst_coverage_audit` 20:15 (`:6898`) → `darkpool_intraday_roll` /
  `ssetf_nightly_rebuild` 20:30 (`:5653`, `:5568`) → `catalyst_rule_learner` 20:30 (`:6914`) →
  `theme_engine_orphans` 23:00 (`:7921`) → `mrr_snapshot` 23:59 (`:7043`).
- **On screen.** ⚠️ Nothing measures whether a person is present. The 15:45 index-close post is the one
  step with a member-visible product and a **retry thirteen minutes later**, which is a statement that
  its first attempt is expected to fail sometimes.
- **Hand-off.** Three different carriers inside one hour, each with its own success criterion: product
  → Discord (15:45), product → email (17:00), product → its own store (17:15).
- **Waiting.** ⭐ The chain's real wait is the **PC** collector landing between 16:15 and 16:30 ET
  (WF-A03, §8 C-2) — the pod's 17:15 aggregation is downstream of a machine the pod cannot see.
- **Fails when.** Any single step; the only rails are per-subsystem, not per-chain.
- **Break-out.** STRUCTURAL — two of its member-visible outputs land on Discord and in email, neither
  of which is our site, both by design.
- **Serves.** `JTBD-C01`, `JTBD-C02`, `JTBD-C03`, `JTBD-E01`, `JTBD-E04`, `JTBD-M06`.
- **Evidence.** 🟢 every `api/main.py` line above.

#### WF-B06 — The alert lane, dark
- **Trigger.** Clock, per taxonomy family.
- **Runs.** `partly` — ids all carry `_dark`; registrations 🟢 by code, production arming unreadable.
- **Sequence.** `[pod]` `alert_taxonomy_document_arrival` every 20 min (`:7153`) ·
  `…_price_level_dark` every minute 9–16 (`:7195`) · `…_event_proximity_dark` 07:05 and 18:05
  (`:7236`) · `…_position_risk_dark` every minute 9–16 (`:7283`) · `…_scan_membership_dark` at the
  sweep +20 min (`:7328`) · `…_catalyst_match_dark` 17:30 (`:7366`) · `…_regime_change_dark` every
  20 min hours 4–20 (`:7410`) · `…_indicator_condition_dark` every minute 9–16 (`:7448`).
- **On screen.** Wherever the member is; delivery is out-of-product by design.
- **Hand-off.** ⛔ **Item 13's `JTBD-M06` records the structural defect and this roster is what it
  looks like on a clock**: `best-of-breed.md` §3.4 S7's *"five-plus subsystems share one delivery
  function, no shared trigger model"* appears here as **a set of independently-scheduled families whose
  only common property is that each picked its own cadence** — enumerated in the Sequence line above,
  and countable off the Evidence line rather than asserted.
- **Waiting.** One minute to one day, depending entirely on which family owns the condition — which is
  the defect, not a tuning choice.
- **Fails when.** A condition falls between two families' cadences.
- **Break-out.** ADDRESSABLE — **TradingView, for authoring and receiving a condition.** Tool:
  owner-stated 2026-09-26, and separately owner-confirmed 2026-09-19 that *TradingView alerts are part
  of the workflow*. Step: inference — item 13's `JTBD-M07` records that **no bridge exists** while the
  receiving mechanism is documented and cheap (webhooks POST to a URL you provide, JSON auto-detected,
  ports 80/443, 2FA mandatory, a **3-second** receiver timeout).
- **Serves.** `JTBD-M06`, `JTBD-M07`, `JTBD-O03`, `JTBD-P07`.
- **Evidence.** 🟢 `api/main.py:7153`, `:7195`, `:7236`, `:7283`, `:7328`, `:7366`, `:7410`, `:7448`.
  🟡 `best-of-breed.md` §3.4 S7 and `tradingview-desk-use.md` §6, via item 13.

#### WF-B07 — The broker mirror loop
- **Trigger.** Interval plus clock.
- **Runs.** `yes` in production per `CLAUDE.md`'s broker-sync section (a CLAIM, with live env names and
  a stated invariant).
- **Sequence.** `[external]` broker activity → `[pod]` `broker_sync_due` on an interval with jitter
  (`:6143`) · `broker_recent_orders_poll` every 5 min (`:6154`) · `broker_sync_nightly_reconcile` 02:30
  (`:6160`) · `broker_canary_sync` 03:10 (`:6187`) · `broker_fidelity_audit` 03:40 (`:6197`) ·
  `broker_bias_digest` 08:05 (`:6221`) · `broker_live_sentinel` at :11 and :41 (`:6227`) · a Sunday
  drill 09:40 and digest 09:45 (`:6258`, `:6235`) → FIFO reconstruct → **holdings-as-truth** reconcile
  → balances and a daily equity snapshot.
- **On screen.** Open Positions and Trade Journal; `SyncTrustCenter` renders sync freshness.
- **Hand-off.** ⭐ **Broker → product, one-way and read-only** — which is exactly why item 13
  quarantined execution quality (`WEAK-02`): this loop mirrors a fill and never sees a fill's quality.
- **Waiting.** The sync interval plus a contractual ceiling the code enforces: *"≤1 poll/5min/account"*.
- **Fails when.** ⛔ Two recorded failure modes, both workflow-level: the router silently unmounted by
  a concurrent merge (*"`POST /connect` hit the SPA catch-all → 405"*, with
  `grep -c broker_sync api/main.py` ≥ 7 as the standing check), and a placeholder stop
  (`stop == entry`) counted as zero risk, which *"would green-light an over-cap add"*.
- **Break-out.** STRUCTURAL — the position lives at the broker. `thinkorswim.md` §4 (via item 13
  `JTBD-P06`) states the reason it cannot be closed: the platform is inseparable from a funded Schwab
  account, *"a brokerage-transfer decision, not a tool-preference decision"*.
- **Serves.** `JTBD-P03`, `JTBD-M03`, `JTBD-C01`.
- **Evidence.** 🟢 `api/main.py:6143`, `:6154`, `:6160`, `:6187`, `:6197`, `:6221`, `:6227`, `:6235`,
  `:6247`, `:6258`. 🟡 `CLAUDE.md` broker-sync + awareness sections. 🟡 `capability-ledger.md` A13 and
  item 13 `JTBD-P03` / `JTBD-P06`.

#### WF-B08 — The week, Friday 15:50 → Sunday 17:00 ET
- **Trigger.** Clock, day-of-week gated.
- **Runs.** `partly`.
- **Sequence.** `[pod]` `cot_weekly_refresh` Fri 15:50 (`:5789`) → retries Fri 16:15 and 16:45
  (`:5790`, `:5791`) → `watchlist_weekly_digest` Fri 17:05 (`:7051`) → `cot_narrative_prewarm` Fri
  17:05 (`:5812`) → `darkpool_eow` Fri 20:15 (`:5708`) → **`calendar_week_post` Sat 04:30** (`:6973`) →
  `cot_narrative_prewarm_retry` Sat 09:00 (`:5813`) → `theme_engine_improve` Sat 10:00 (`:7928`) →
  `compass_weekly_email_digest` Sun 08:00 (`:7695`) → `ipo_maintenance_weekly` Sun 08:30 (`:5784`) →
  `broker_live_sentinel_drill` Sun 09:40 and `…_weekly` 09:45 (`:6258`, `:6235`) →
  `ai_search_weekly_deep` Sun 10:00 (`:6771`) → `substack_poll_sunday_burst` Sun 13:00–17:00 every
  10 min (`:6598`).
- **On screen.** Discord (`#event-calendar`) for the Saturday post; email for the digests.
- **Hand-off.** ⭐ The Sunday burst is the pod **watching for a human publication**: its comment reads
  *"posts usually drop ~2 PM ET on Sundays"* (`:6595`), so the product polls for the owner's own
  Substack output. **Two hand-offs in this estate are the pod waiting on the owner — this and the
  wire — and only one has a watchdog.**
- **Waiting.** Up to 10 min for a Sunday post to be noticed; a whole week between COT reports.
- **Fails when.** The CFTC publishes late — hence two retries plus, per `CLAUDE.md`'s COT section, a
  request-driven self-heal and a startup catch-up: **three independent defence layers for one weekly
  arrival.** ⭐ That is what a workflow looks like after its failure has actually happened (the
  2026-05-22 incident in the same section).
- **Break-out.** STRUCTURAL — Discord and Substack are both destinations we chose and do not own.
- **Serves.** `JTBD-W01`, `JTBD-W02`, `JTBD-W03`, `JTBD-B04`, `JTBD-M01`.
- **Evidence.** 🟢 every `api/main.py` line above, incl. the comment at `:6595`. 🟡 `CLAUDE.md` COT
  section (CLAIM, with a dated incident).

### 4.3 Group C — the desk at a screen

⚠️ **Every entry here is 🟡 by construction.** A sequence a person walks is an inference; the one
telemetry anchor is admin-only and contains no transitions (§2.3). ⭐ Every ADDRESSABLE break-out
below names a tool the owner **stated on 2026-09-26** that he personally uses, and a step that is
**this file's inference**.

#### WF-C01 — Open on the dashboard, live in the notebook and the charts
- **Trigger.** Sitting down; a session start.
- **Runs.** `yes` — 🟢 for the ordering, which is measured; 🟡 for calling it a sequence.
- **Sequence.** `[desk]` `/dashboard` first (**22 of 50** admin session-days, twice the next surface) →
  `[desk]` thereafter, by volume, `/journal/notebook` (1097) and `/charts` (1010); `/dashboard` is
  third by volume (809).
- **On screen.** ⭐ The only entry in this file whose "on screen" is measured rather than inferred.
  ⛔ And the measurement has a hole this file must name: **it records which surface was first and which
  were most-viewed, and nothing records the step between them.** The source's sentence is *"The desk
  OPENS on the dashboard and LIVES in the notebook and charts"*; the arrow in it is not in the data.
- **Hand-off.** Not measured — no transition is recorded anywhere in this estate.
- **Waiting.** Not measured.
- **Fails when.** Not measured.
- **Break-out.** NOT MEASURED — ⛔ **the workflow with the best evidence in this file has the
  least-known exit.** The owner uses every tool the programme names (owner-stated 2026-09-26), so this
  session certainly leaves our site; nothing records when or for what. Converting this to NONE would be
  the worst error available here.
- **Serves.** `JTBD-P03`, `JTBD-C02`, `JTBD-M05`.
- **Evidence.** 🟢 `OI-06-telemetry-derived-defaults.md:24-33`, `:8`. ⚠️ Openers = admins over 50
  session-days; total views = all 13 users with rows. Different populations, same table.

#### WF-C02 — "Which of my names report this week?"
- **Trigger.** Landing on `/calendar`; the first page of the day.
- **Runs.** `yes` — 🟡. `/calendar` carries 161 total views and 2 session-opens
  (`OI-06-telemetry-derived-defaults.md:28`) — an existence check, not a rate.
- **Sequence.** `[desk]` land on the persisted view → in `table`, `TodaysBrief` leads with **YOUR
  REPORTS** badged POSITION / WATCHLIST / UCT20, then **REPORTED**, then **MACRO TODAY**; in `board`,
  scope with the **My Stocks** audience chip → day tabs carry a "mine" count beside the total.
- **On screen.** One page; *"a pure client-side join over data the page already has, zero new
  endpoints"*.
- **Hand-off.** ⛔ **A badge whose source is a broker mirror** — `sourceBadge` ranks a POSITION above a
  watch and gilds it, so WF-B07's staleness becomes this workflow's correctness.
- **Waiting.** None by design — *"the retention moat: a five-second personal answer pinned atop the
  Board"*.
- **Fails when.** The mirror is stale; item 13's `JTBD-P03` records that this renders as *confidently
  wrong* rather than blank.
- **Break-out.** NONE — the flow completes on our site.
- **Serves.** `JTBD-P03`, `JTBD-P07`.
- **Evidence.** 🟢 `terminal-current-map.md:655-658` (quoting `TodaysBrief.jsx:1-6`). 🟢
  `OI-06-telemetry-derived-defaults.md:28`.

#### WF-C03 — Pre-print depth, inside one modal
- **Trigger.** Clicking a ticker on the calendar.
- **Runs.** `yes` — 🟡.
- **Sequence.** `[desk]` click → **Setup** → **The Print → Earnings History** (4-quarter beat dots;
  `hist_stats` average absolute post-earnings move, up-count, total, last 8 moves newest-first) →
  **Brief** (the pre-generated preview) → **Coverage → The Street** (consensus, targets, rating
  changes). The card already carried the expected move and beat dots before the click.
- **On screen.** One modal; the deep link `?earnings=SYM&esection=` makes the position shareable.
- **Hand-off.** ⭐ WF-B02's `earnings_preview_warm` → this step. The warm exists *only* to remove this
  workflow's wait.
- **Waiting.** ⭐ **Measured, and the sharpest waiting number in the estate**: *"instant rather than a
  25–40 s cold wait"* (`terminal-current-map.md:661-662`), on top of the 130× cliff (`:547`:
  enrichment cold 17.9 s → warm 0.14 s; whole-week batch cold 24.8 s → warm 0.22 s, *"re-armed every
  five minutes"*).
- **Fails when.** The warmer has not run for this week, or the `_ENRICH_TTL` window just expired and
  this reader is first through.
- **Break-out.** NONE ⚰️ **RECLASSED FROM ADDRESSABLE 2026-09-26 — completing a correction the integrator left HALF-APPLIED, caught by the gate-item-30 author.** §5.1's withdrawal removed this row from the ADDRESSABLE table but NOT from this per-workflow field, so `grep -c '^- \*\*Break-out.\*\* ADDRESSABLE'` returned **7** against a table of **5**, and the class sum closed at 38 only because the withdrawal had not been applied here. ⛔ **A partial correction is worse than none: it leaves two numbers in one file disagreeing, which is the defect this programme records most often.** The capability is NOT absent — `ImpliedVsRealized` is the hero of `SetupSection.jsx:241` — so the flow does not leave our site for it. Original text kept below for the record. ~~ADDRESSABLE — **Market Chameleon, for the trailing calibration of the market's own
  pricing.** Tool: owner-stated 2026-09-26. Step: inference, on item 13 `JTBD-W04` — UCT computes the
  **forward** implied move and, per the reachable internal docs, does **not** keep the trailing
  calibration, while Market Chameleon states it per symbol in words. ⚠️ Item 13 grades the UCT-side
  absence as an inference from absence; under `capability-ledger.md`'s staleness banner this row
  specifically needs a re-grep before anyone builds on it.
- **Serves.** `JTBD-P07`, `JTBD-W04`, `JTBD-E04`.
- **Evidence.** 🟢 `terminal-current-map.md:541`, `:547`, `:660-662`. 🟡 `market-chameleon.md` OBS 2
  via item 13.

#### WF-C04 — "What just printed?"
- **Trigger.** A print window: BMO 06:00–09:00 ET, AMC 16:00 ET.
- **Runs.** `yes` — 🟢 **CONFIRMED by artifact**, uniquely in this group.
- **Sequence.** `[pod]` `wire_detector` ticks every 20 s inside the print windows (`:6791`) and hourly
  otherwise (`:6797`), upserting detected prints → `[desk]` the **Wire** view renders rows **ordered by
  arrival time, never by move**, so a row being read cannot jump; significance drives weight (`loud`
  ≥8%, `mid` ≥4%, `quiet` below) → above the rows a trust line states **complete**, **incomplete WITH
  THE NAMES**, or **unmeasured** → `[pod]` `wire_coverage_monitor` at 09:40 / 13:40 / 17:40 / 21:40
  measures, heals by running the tick itself, re-measures, and alerts only what survived (`:6817`).
- **On screen.** The Wire view and its own completeness sentence.
- **Hand-off.** Provider → wire store → the coverage diff. ⭐ The confirmation is an **artifact, not a
  log**: the 2026-09-02 production render showed *"1 reported name not shown yet: PANW"*, a string
  emitted **only** by `WireView`'s `CoverageLine` when the coverage endpoint returns a non-empty
  `missing_from_feed` for the current session — *"A wire that had never ticked would render the empty
  state, not a coverage diff"* (`terminal-current-map.md:557`).
- **Waiting.** Up to 20 s inside a window, up to an hour outside one.
- **Fails when.** The gate is off — deliberately strict (`== "1"`, not the looser idiom), *"so the
  failure direction must be OFF. A typo enables nothing"* (`:551`).
- **Break-out.** NONE — the flow completes on our site, including its own honesty line.
- **Serves.** `JTBD-O01`, `JTBD-P04`, `JTBD-E04`.
- **Evidence.** 🟢 `api/main.py:6791`, `:6797`, `:6817`. 🟢 `terminal-current-map.md:551`, `:557`,
  `:664-666`.

#### WF-C05 — Prepare the week, at the weekend
- **Trigger.** Saturday or Sunday.
- **Runs.** `yes` — 🟡, with a **dated symptom** behind it.
- **Sequence.** `[desk]` open `/calendar` → the anchor has already rolled forward to the upcoming week
  **by design** → Board for shape, Table for numbers.
- **On screen.** `/calendar`, on a day when nothing else in the estate is warm.
- **Hand-off.** WF-B02's `earnings_preview_warm` → here, and this is why that job runs **every day and
  not Mon–Fri**: *"the reader who opens Wednesday's NVDA tile on a SUNDAY was the reported symptom
  (2026-08-23). A weekday-only warm leaves the whole weekend cold for next week's board — which is
  exactly when someone sits down to prepare for it"* (`terminal-current-map.md:549`).
- **Waiting.** ⛔ A weekend session **is** the cold case by definition; the fix is a cadence and the
  evidence it was needed is a symptom with a date.
- **Fails when.** A warm cadence is narrowed back to weekdays for tidiness.
- **Break-out.** NONE — the flow completes on our site.
- **Serves.** `JTBD-W01`, `JTBD-P07`.
- **Evidence.** 🟢 `terminal-current-map.md:549`, `:668-669`.

#### WF-C06 — Follow one company through its cycle
- **Trigger.** A name worth tracking across prints.
- **Runs.** `yes` — 🟡.
- **Sequence.** `[desk]` `/calendar?earnings=SYM&esection=history` → arrow-step across the day's other
  reporters **without leaving the modal** → export one report via `/api/calendar/report.ics`.
- **On screen.** One modal, one URL, and the URL is the state.
- **Hand-off.** Product → a calendar app, by file.
- **Waiting.** None recorded.
- **Fails when.** Not measured.
- **Break-out.** NONE ⚰️ **RECLASSED FROM ADDRESSABLE 2026-09-26 — completing a correction the integrator left HALF-APPLIED, caught by the gate-item-30 author.** §5.1's withdrawal removed this row from the ADDRESSABLE table but NOT from this per-workflow field, so `grep -c '^- \*\*Break-out.\*\* ADDRESSABLE'` returned **7** against a table of **5**, and the class sum closed at 38 only because the withdrawal had not been applied here. ⛔ **A partial correction is worse than none: it leaves two numbers in one file disagreeing, which is the defect this programme records most often.** The capability is NOT absent — `ImpliedVsRealized` is the hero of `SetupSection.jsx:241` — so the flow does not leave our site for it. Original text kept below for the record. ~~ADDRESSABLE — **Market Chameleon, for the per-print IV-crush table at −5 to +5
  trading days.** Tool: owner-stated 2026-09-26. Step: inference, on item 13 `JTBD-W04`, which records
  that mechanism verbatim and records UCT holding the inputs (`earnings_analytics`) without computing
  it. ⚠️ Same staleness caveat as WF-C03.
- **Serves.** `JTBD-E02`, `JTBD-W04`, `JTBD-X08`.
- **Evidence.** 🟢 `terminal-current-map.md:671-672`. 🟡 `market-chameleon.md` OBS 2 via item 13.

#### WF-C07 — Put the product's dates into the calendar you live in
- **Trigger.** Once, then never again.
- **Runs.** `yes` — 🟢 mechanism.
- **Sequence.** `[desk]` header → ICS → `scope=mine` with a stable HMAC token yields a `webcal://` URL
  that *"keeps working indefinitely"*; `scope=all` needs no token.
- **On screen.** Google or Apple Calendar — **outside the product**.
- **Hand-off.** ⭐ The estate's one working **egress** workflow, and item 13's `JTBD-X08` names its
  defect in the same breath: the token *"has no TTL"*.
- **Waiting.** Whatever the calendar client's refresh is — not measured.
- **Fails when.** A revocation is needed and no mechanism exists.
- **Break-out.** STRUCTURAL — and ⭐ **the one break-out in this file that is a feature.** The
  destination is the member's own calendar app; leaving is the point. ⚠️ What is addressable is not the
  exit but the credential: an expiring, revocable token.
- **Serves.** `JTBD-X08`, `JTBD-P07`.
- **Evidence.** 🟢 `terminal-current-map.md:674-675`. 🟡 `best-of-breed.md` §3.6 X2 via item 13.

#### WF-C08 — The unread queue
- **Trigger.** Coming back after being heads-down.
- **Runs.** `partly` — 🟢 that the mechanism exists, 🟢 that it is **barely used**.
- **Sequence.** `[desk]` `/calendar/mystocks` → five tabs (Earnings · News · Calls · Filings ·
  Insights), each with an unseen badge → opening an item marks it seen.
- **On screen.** One page; mobile stacks rather than scrolling horizontally.
- **Hand-off.** `calendar_seen` rows are both the state and the measurement.
- **Waiting.** None.
- **Fails when.** ⛔ **It has already failed, measurably**: `calendar_seen` holds **16 rows in total**
  across the roster (`OI-06-telemetry-derived-defaults.md:35`), and the programme's own test ruled that
  rows-per-user near zero means the unseen state stays Calendar-local. An unread count nobody clears is
  decoration.
- **Break-out.** NONE — the flow completes on our site. ⚠️ Which is the uncomfortable version of a
  NONE: fully substituted and barely used are not the same thing, and this row is both.
- **Serves.** `JTBD-E04`.
- **Evidence.** 🟢 `terminal-current-map.md:683-684`. 🟢 `OI-06-telemetry-derived-defaults.md:35`.

#### WF-C09 — The interrupt: a ticker comes up while working another one
- **Trigger.** A ticker in Discord, in the wire, in a headline, or spoken in a desk session.
- **Runs.** `yes` — 🟡.
- **Sequence.** `[desk]` `TickerPopup` opens in place → optionally `Ctrl/Cmd+Shift+F` flags the ticker
  on three surfaces → return to the unchanged screen.
- **On screen.** ⭐ Two things at once, which is the point: the working surface stays mounted behind a
  modal.
- **Hand-off.** ⛔ **The context does not follow**: item 13's `JTBD-M05` records the context bus as four
  colour groups, symbol-only, hydrated once per mount, and **four independent ticker resolvers** behind
  the doors — so which company the popup resolved may differ from the surface behind it.
- **Waiting.** A bars fetch; `prefetchBar(sym)` on hover pre-empts it.
- **Fails when.** Two resolvers disagree — silently, because both render.
- **Break-out.** ADDRESSABLE — **TradingView, for interactive inspection of the interrupting name.**
  Tool: owner-stated 2026-09-26. Step: inference, on `tradingview-desk-use.md` §2 via item 13, which
  characterises TradingView as sitting at *"the narrative and inspection edges of the desk's day…
  never at the generation edge."* ⚠️ **Dated, because it moved:** CARD 24's re-grep (re-run here,
  2026-09-26) finds the in-app Finviz PNG half of that inspection surface **gone** from `app/src`, so
  the break-out that remains is to the third-party site by hand, not to an embedded tab.
- **Serves.** `JTBD-M05`, `JTBD-X11`, `JTBD-M02`.
- **Evidence.** 🟡 item 13 `JTBD-M05` citing `best-of-breed.md` §3.4 S4/S2 and `COMPLETION_AUDIT.md`
  §3.4f. 🟢 the CARD 24 re-grep (§2.5). 🟡 `CLAUDE.md` TickerPopup section — ⚠️ a CLAIM, and one that
  carries its own ⚰️ correction about a "position calculator" that does not exist.

#### WF-C10 — Build a board, then come back to it
- **Trigger.** Arranging tools; every subsequent session start; every device change.
- **Runs.** `yes` — 🟢 that it happens, with a measured population.
- **Sequence.** `[desk]` add and arrange widgets on `/charts` → layout persists to
  `charts_workspace_layout` (a `pref_key` **value** inside `user_preferences`, not a table), debounced
  500 ms → `[desk]` next session, the board rehydrates.
- **On screen.** The board itself.
- **Hand-off.** Session → store → next session, **and across devices only as far as the store
  reaches** — item 13's `JTBD-W02` records device-local columns in the lists row as a live gap.
- **Waiting.** 500 ms debounce, then a hydration gate on the next load.
- **Fails when.** ⛔⛔ **The recovery destroys the thing it recovers**: a corrupt blob yields an empty
  board, *autosaved within 500 ms* — item 13 `JTBD-X02`, citing `best-of-breed.md` §3.4 S5, the
  ledger's only `needs-extension` row.
- **Break-out.** STRUCTURAL — the multi-monitor half. Item 13's `JTBD-X03` records the estate's answer
  as an RGL board plus a pop-out portal, and the comparison as *"native OS windows across four
  products"*. ⛔ A second physical monitor is the operating system's, not a feature.
- **Serves.** `JTBD-X02`, `JTBD-X03`, `JTBD-W02`.
- **Evidence.** 🟢 `OI-06-telemetry-derived-defaults.md:39-52` (**17 stored layouts, 7 distinct widget
  signatures**, nine of seventeen diverging from the largest cluster, blobs 111→6731 bytes). 🟡
  `best-of-breed.md` §3.4 S5 / S1 via item 13.

#### WF-C11 — Author a rule, then let it run
- **Trigger.** A condition the shipped vocabulary cannot say.
- **Runs.** `partly` — the authoring path is 🟢 in code; whether a member walks it is **not measured**.
- **Sequence.** `[desk]` write a definition in the CodeMirror editor against a **closed** grammar
  (`closedTable.json` v2), or transpile in from Pine / thinkScript / PCF → `[pod]` `user_definitions`
  stores it append-only with a tombstone delete and 64 KB / 50 caps → `[pod]` WF-B01's nightly sweep
  evaluates it → `[desk]` `/screener` → `SavedScreensPanel` → `ScanResults` → `CoverageLine` reading
  `GET /api/scans/definition-results` → `[pod]` `alert_taxonomy_scan_membership_dark` fires at the
  sweep +20 min (`:7328`).
- **On screen.** The builder, then the results panel with its four counts.
- **Hand-off.** ⭐ **Definition → nightly snapshot → member surface → alert**: four boundaries, and the
  freshness of the whole thing is WF-B01's 03:00 clock rather than the reader's.
- **Waiting.** Up to a day — *"a scan re-read at noon returns the same answer off the same 03:00
  snapshot."*
- **Fails when.** A criterion is not computable for part of the universe. The rail is `CoverageLine`'s
  refusal to *"present a receipt whose arithmetic does not close"*, and the worked example is real: on
  the live universe *"the naive formula returns `answered=0, not_computable=2615` because `rs_rank` is
  NULL in every screener row on this box, and rendering that as '0 matches' is a lie a member would act
  on."*
- **Break-out.** ADDRESSABLE — **TradingView (Pine) and thinkorswim (thinkScript), where rules are
  already written.** Tools: owner-stated 2026-09-26. Step: inference, and it is the best-evidenced
  inference in this section, because **the transpilers exist precisely because of this break-out**
  (item 13 `JTBD-X07`: `pine.js` 7,218 lines, `thinkscript.js` 4,728, `pcf.js` 1,935). ⛔ Not fully
  closable by choice: `thinkorswim.md` §5 verdicts thinkScript **leave-external** because UCT's grammar
  is *"closed-by-design … not a gap to fill"*.
- **Serves.** `JTBD-X07`, `JTBD-P02`, `JTBD-M06`, `JTBD-X10`.
- **Evidence.** 🟢 `api/main.py:1763`, `:1873`, `:7328`. 🟡 `capability-ledger.md` B5 (staleness banner)
  and `thinkorswim.md` §1–2, §4, §5 via item 13. 🟡 `CLAUDE.md` Phase-E section — a CLAIM carrying its
  own ⚰️ correction that the flag docstring's *"no surface wired"* sentence is false.

#### WF-C12 — Ask in words, check the answer
- **Trigger.** A question no screen is shaped like.
- **Runs.** `partly` — the lane exists with a measured population; its quality is measured and poor.
- **Sequence.** `[desk]` ask at one of the AI doors → `[pod]` a tool call over the registry, or
  `grade_ticker`'s structural verdict → `[desk]` read the answer and its citations → `[pod]`
  `ai_search_briefings_premarket` / `_postmarket` / `_weekly_deep` pre-compute the scheduled half of
  the same lane (`:6760`, `:6763`, `:6771`).
- **On screen.** A chat or a voice session over whatever surface was already open.
- **Hand-off.** WF-A06's brain pack → the KB index → the answer's citations.
- **Waiting.** Model latency, unmeasured here; the scheduled briefings remove it for the two windows
  somebody named.
- **Fails when.** ⛔ **Measured**: the estate's own exam reads **12/50 with Rungs 3–5 at zero**, and the
  population is **79 `ai_search_log` rows** — *"an existence check, not a rate."*
- **Break-out.** ADDRESSABLE — **TradingView, for disagreeing with a generated answer one piece at a
  time.** Tool: owner-stated 2026-09-26. Step: inference, on item 13 `JTBD-X06`: TradingView's AI
  screener emits *an editable configuration* with a filter-by-filter explanation, so *"the artefact
  **is** the citation"* and a wrong answer is disagreed with one filter at a time; nothing of that
  shape exists in UCT.
- **Serves.** `JTBD-X05`, `JTBD-X06`.
- **Evidence.** 🟢 `api/main.py:6760`, `:6763`, `:6771`. 🟢
  `OI-06-telemetry-derived-defaults.md` §5/§6 (79 rows). 🟡 the 12/50 figure and the TradingView
  mechanism via item 13 `JTBD-X05` / `JTBD-X06`.

#### WF-C13 — Inspect a chart the way the desk inspects it
- **Trigger.** A name that needs looking at rather than reading about — a drill cell, a scan row, a
  headline.
- **Runs.** `partly` — ⭐ **and this row exists because the product moved.** The in-product half is
  🟢 and **native**: `Breadth.jsx:49` lazy-imports `ChartPane` and `:347` `BreadthDrillModal`, with
  `:343` recording the old `DrillModal` (~320 lines, the Finviz PNG tabs inside it) as **DELETED**;
  `ThemeTrackerPage.jsx:7`, `:39`, `:1505`, `:1537` mounts `StockChart` **and** `ChartPane`. The
  by-hand half is **not measured**.
- **Sequence.** `[desk]` click a breadth cell or a row → `BreadthDrillModal` opens **the real
  charts-workspace widgets** — a watchlist widget holding the cell's constituents and the member's own
  chart widget, linked by colour group A, *"not a lookalike of those widgets, it IS them"*
  (`Breadth.jsx:340-344`) → `[desk]` **inference: some fraction of the time, open finviz.com or
  TradingView in another tab for the same purpose** → return.
- **On screen.** Our drill modal, plus **not measured** whether a third-party tab is beside it.
- **Hand-off.** In-product: a colour group binds the widgets. Out-of-product: nothing — there is no
  artifact, no link and no telemetry on the by-hand half, which is exactly why it is unmeasured rather
  than absent.
- **Waiting.** A bars fetch, lazily loaded so *"the breadth bundle does not pull the charts workspace
  until a cell is actually clicked"* (`Breadth.jsx:345-346`).
- **Fails when.** ⚠️ **A document, not the code.** Master's `CLAUDE.md` still describes the deleted
  DrillModal's *"Three chart tabs: Daily / Weekly (Finviz static PNG) / TradingView (iframe). Default:
  `'tv'`"* as live. Anyone planning around that plans around a component that does not exist — which
  CARD 24 records as the reason item 27's chosen displacement build was already void.
- **Break-out.** ADDRESSABLE — **finviz.com and TradingView, by hand, for chart inspection.** Tool:
  owner-stated 2026-09-26. Step: **inference, and explicitly unmeasured** — CARD 24 states that the
  by-hand half *"is untouched"* by the embed's deletion *"because it is a question about desk behaviour
  and no amount of code reading can answer it"*, and CP-06 records the owner declining to itemise
  per-tool workflows. ⭐ **This is the most valuable open question this file touches**: one cheap
  observation retires it, and until then it is the only break-out whose *existence* is owner-stated
  while its *step* is pure inference.
- **Serves.** `JTBD-M02`, `JTBD-O02`, `JTBD-E03`.
- **Evidence.** 🟢 `app/src/pages/Breadth.jsx:45-49`, `:339-347`; `app/src/pages/ThemeTrackerPage.jsx:7`,
  `:39`, `:1505`, `:1537`; `git grep -nE "chart\.ashx" origin/master -- app/src` → zero (all re-run for
  this file, 2026-09-26). 🟢 `12-decisions/DECISION_CARDS_2026-09-26.md` CARD 24. ⚠️ master
  `CLAUDE.md`'s DrillModal section, cited as the stale artifact it is.

#### WF-C14 — Size it, check the risk, then place it somewhere else
- **Trigger.** A plan about to become a position; any change to a stop.
- **Runs.** `partly` — the doctrine and its configuration are 🟢 (item 13 `JTBD-P06`); a member-facing
  risk surface is **absent** (A14 is `portfolio_heat.py` only, deferred by D8), and the last step is
  off the table by governing default.
- **Sequence.** `[desk]` a plan carries entry, stop and invalidation (WF-A01 publishes them) →
  `[desk]` apply the doctrine: `Account Risk % = Position Size % × Stop Distance %`, max 2% per trade,
  regime-adjusted → `[external]` **read live per-position risk in thinkorswim's Analyze tab** →
  `[external]` **place the order at the broker** → `[pod]` WF-B07 mirrors the result back, read-only.
- **On screen.** ⛔ **Not measured**, and this is the entry where that hurts most: the arithmetic is
  done by the trader and nothing records where.
- **Hand-off.** Doctrine (prose + `BOOK_DEFAULTS`) → a person's arithmetic → a broker → back as a
  read-only mirror. ⭐ **The only round trip in this estate that leaves and returns**, and it returns
  with less than it took: item 13 `WEAK-02` quarantines execution quality precisely because the mirror
  *"never sees a fill."*
- **Waiting.** Whatever the person takes. Not measured.
- **Fails when.** Aggregate heat — the thing that should veto an add — is computed nightly and is not
  readable at the moment of the decision (item 13 `JTBD-M03`); and a broker placeholder stop
  (`stop == entry`) reads as zero risk (WF-B07).
- **Break-out.** STRUCTURAL — **and neither half of it is a feature gap.** (a) thinkorswim, because
  `thinkorswim.md` §4 (via item 13 `JTBD-P06`) records the platform as inseparable from a funded Schwab
  account — *"a brokerage-transfer decision, not a tool-preference decision"*; tool owner-stated
  2026-09-26, step inference. (b) ⛔ **Order placement, by governing default**:
  `OWNER_SEED_FACTS.md` §6 puts *"no execution or order management"* off the table for V1. **Nothing
  here proposes execution.** ⚠️ `thinkorswim.md` §5 does name two narrow absorb candidates — options
  risk *visualisation* and options back-testing — which are capability questions for items 16/19, not
  changes to this classification.
- **Serves.** `JTBD-P05`, `JTBD-P06`, `JTBD-M03`, `JTBD-M04`.
- **Evidence.** 🟡 item 13 `JTBD-P05` / `JTBD-P06` / `JTBD-M03` citing `OWNER_SEED_FACTS.md` §6, D-13
  §3 (`BOOK_DEFAULTS`), `thinkorswim.md` §1–2, §4, §5 and `best-of-breed.md` §3.3 A14. 🟢
  `OWNER_SEED_FACTS.md` §6 for the no-execution default, read directly.

### 4.4 Group D — the desk as publisher

⚠️ `OWNER_SEED_FACTS.md` §6 sets the business priority as *"internal desk first, member onboarding
second"* (ruled D-001, `OWNER_DECISIONS.md:9`), and the PC roster is a publishing pipeline as much as a
trading one. These are the owner's workflows. ⛔ None of them is the Whop live-trading Discord, which
CARD 23 places outside this programme's boundary.

#### WF-D01 — The morning letter
- **Trigger.** WF-A01 completing.
- **Runs.** `yes` — 🟡.
- **Sequence.** `[owner-pc]` the engine composes against `voice_profile.json`'s measured bands and its
  exemplar set → renders the Substack build, which **screenshots `/r/calendar`** for the "This Week's
  Earnings" panel (`from=today`, 5 days) → `[external]` Substack → `[pod]` the same payload lands via
  `/api/push` and renders the in-product Morning Wire tab.
- **On screen.** The draft, then the published letter. ⛔ **The goal is auto-send**, so "on screen" is
  supposed to trend toward nothing — a workflow target, not a feature.
- **Hand-off.** ⭐ **One build, three destinations**: Substack, Discord and the product. The
  calendar panel crossing is worth naming: the letter *screenshots its own product* to illustrate
  itself.
- **Waiting.** The engine's runtime (§8, C-1).
- **Fails when.** The run crashes before pushing — the 2026-08-14 instance (`engine.py:558-560`).
- **Break-out.** STRUCTURAL — Substack is the destination, by choice and by the standing default that
  there is *no public Substack wire* to replace it with on our own site.
- **Serves.** `JTBD-B01`, `JTBD-B04`, `JTBD-W03`.
- **Evidence.** 🟢 `terminal-current-map.md:680-681` (W8). 🟡 D-13 §2f via item 13 `JTBD-B01`. 🟢
  `api/services/engine.py:552-573`.

#### WF-D02 — The correction loop: a thumb changes tomorrow's letter
- **Trigger.** Reading the draft and disagreeing with one segment.
- **Runs.** `partly` — 🟢 that the machinery exists and holds 26 config versions; ⚠️ D-13 grades the
  **round trip** a CLAIM: 26 rows are *consistent with* it running, not an observation of it running.
- **Sequence.** `[owner]` 👍/👎 or a note on a `section.rd-seg` label → `[pod]`
  `POST /api/wire-feedback` partial-merge upsert into `/data/wire_feedback.db`, snapshotting the segment
  text at write time → `[owner-pc]` 05:00 CT the critic pulls admin feedback via
  `GET /api/wire-feedback/recent-internal` (PUSH_SECRET bearer) → an Opus critic runs per qualifying
  segment → distilled guidance plus ≤3 exemplars into `wire_prompt_config` → `[owner-pc]` 06:35 CT
  `generate_rundown` reads it back.
- **On screen.** The rendered wire, with controls **DOM-injected into `dangerouslySetInnerHTML`**
  rather than mounted as components — a real constraint on this workflow, and the stated reason voice
  dictation was never added to the note box.
- **Hand-off.** ⭐ **The tightest loop in the estate, and it crosses the machine boundary twice**:
  product → store → PC critic → PC engine → product. Latency is therefore **one calendar day**, set by
  the 05:00 CT critic, not by any queue.
- **Waiting.** ~19 h from a thumb to its effect.
- **Fails when.** Notes *"bypass the min-votes gate and outweigh the thumbs"*, so one note is a
  directive — a designed asymmetry whose effect nothing measures.
- **Break-out.** NONE — ⭐ **the only closed loop in this file.** Every step is ours, and that is
  exactly why it is the tightest.
- **Serves.** `JTBD-B02`, `JTBD-B01`.
- **Evidence.** 🟡 D-13 §2d/§2e via item 13 `JTBD-B02`. 🟡 `CLAUDE.md` wire-feedback section (CLAIM).

#### WF-D03 — The Saturday week post
- **Trigger.** Clock: **Sat 04:30 ET**, pinned `America/New_York`.
- **Runs.** `partly` — 🟢 registration; `CALENDAR_WEEK_POST_ENABLED` **defaults 0** and nothing in the
  repo says it is on (`terminal-current-map.md:544`, `:556`).
- **Sequence.** `[pod]` render both week PNG cards → post as **ONE** Discord message into
  `#event-calendar` → once-per-week dedup.
- **On screen.** Discord. ⭐ The same card family is *"the top-of-funnel screenshot asset"*.
- **Hand-off.** Product → community → (by screenshot) marketing.
- **Waiting.** A week.
- **Fails when.** The gate is off, which is indistinguishable from the job not existing —
  `project_feature_flag_ledger`'s standing point that OFF-and-unset reads the same as off-on-purpose.
- **Break-out.** STRUCTURAL — Discord.
- **Serves.** `JTBD-W01`, `JTBD-B04`.
- **Evidence.** 🟢 `api/main.py:6973`. 🟢 `terminal-current-map.md:544`, `:556`, `:677-678`.

#### WF-D04 — The desk session publishes itself
- **Trigger.** Arrival: Zoom fires `recording.completed`.
- **Runs.** `yes` — 🟢 mechanism and scheduler, with a **dated production escalation** against it,
  which is the strongest possible evidence that it runs.
- **Sequence.** `[external]` Zoom automatic cloud recording ends → webhook to
  `POST /api/desk/zoom-webhook` (HMAC-validated, enqueued) → `[pod]` `desk_daily_session_process` drains
  every **5 min** (`:6658`): download the **largest** MP4 → upload to YouTube (privacy decided per
  routed **section**, not per typed topic) → set a branded thumbnail (**non-fatal**) → publish an
  `edu_videos` row → **defer** the Zoom delete → `[pod]` `maybe_announce` posts one rich Discord embed →
  `[pod]` `desk_session_insights` every 15 min at `minute='7/15'` (`:6666`): Zoom VTT → chapters,
  ticker moments, recap poster → **then** trashes the Zoom recording → `[pod]` `maybe_attach_recap`
  **edits the same Discord message** → `[pod]` `desk_cover_retry` at `minute='2/15'` (`:6682`) drains
  failed covers → `[pod]` `desk_session_audit` 09:00 (`:6699`) re-reads the artifacts and names what is
  missing → `[pod]` `desk_daily_session_safety` Mon–Fri 18:00 (`:6660`) alerts if nothing published.
- **On screen.** Nothing, for the owner. That is the product: *"zero per-session effort"*.
- **Hand-off.** ⭐⭐ The audit's own framing of this pipeline is *"Five subsystems on three schedules,
  every one of them failing quietly by design"* — quoted, with its source, rather than recounted. Boundaries: Zoom → pod → YouTube → `edu_videos` → Discord → back to the same
  Discord message.
- **Waiting.** ⭐ **Measured, and the measurement is why the audit exists**: insights land *"up to ~3h
  after publish"* — `_DEFAULT_GRACE_SECS = 3 * 3600` (`api/services/desk_session_audit.py:45`), with
  `_DEFAULT_WINDOW_DAYS = 3.0` (`:44`). A session younger than the grace period is **not checked at
  all**, and the file says why: *"Without it this fires on every healthy session and gets muted inside
  a week."*
- **Fails when.** ⛔⛔ **A privacy decision taken from a stale document.** Privacy comes from
  `DESK_PUBLIC_SHOWS` matched against the routed section; master records the live value as `*` — every
  show public (`CLAUDE.md:5388`) — while this worktree's copy still described the default. Believing
  the stale version produced the **2026-09-13 escalation in which 27 videos were set unlisted and then
  restored** (`CLAUDE.md:15-18`, this worktree). ⭐ **A workflow failure whose cause was a document, not
  a bug** — the only such instance in this file, and the same class as WF-C13's.
- **Break-out.** STRUCTURAL — Zoom, YouTube and Discord: three platforms we do not own, and the
  pipeline's entire value is that it crosses them unattended.
- **Serves.** `JTBD-B03`, `JTBD-E03`, `JTBD-B04`.
- **Evidence.** 🟢 `api/main.py:6658`, `:6660`, `:6666`, `:6682`, `:6699`. 🟢
  `api/services/desk_session_audit.py:24`, `:44-45`. 🟡 `CLAUDE.md` Desk sections. 🟢 the escalation
  record, `CLAUDE.md:15-18` (this worktree).

#### WF-D05 — The index close post
- **Trigger.** Clock: Mon–Fri **15:45 ET**, retried **15:58 ET**.
- **Runs.** `partly`.
- **Sequence.** `[pod]` compose → `[external]` Discord → `[pod]` retry thirteen minutes later.
- **On screen.** Discord.
- **Hand-off.** Product → community, fifteen minutes before the close.
- **Waiting.** Thirteen minutes, if the first attempt failed.
- **Fails when.** ⭐ The existence of `discord_index_close_retry` is the estate's own statement that it
  fails sometimes; nothing says how often.
- **Break-out.** STRUCTURAL — Discord.
- **Serves.** `JTBD-C03`, `JTBD-B03`.
- **Evidence.** 🟢 `api/main.py:2861`, `:2876`.

#### WF-D06 — The Sunday scan, published by hand and noticed by a poll
- **Trigger.** A human publication on Sunday afternoon.
- **Runs.** `yes` for the pod's half — 🟢. The PC-side producer's schedule is **not in this programme's
  tree** (§8, C-5).
- **Sequence.** `[owner]` publish → `[pod]` `substack_poll_hourly` at minute 7 (`:6593`) and
  `substack_poll_sunday_burst` Sun 13:00–17:00 every 10 min (`:6598`) notice it → the product ingests
  it.
- **On screen.** Substack, then the product.
- **Hand-off.** ⛔ **A poll, not a push** — the only signal the product has that its owner published is
  that it went looking. The comment explains the cadence: *"posts usually drop ~2 PM ET on Sundays"*
  (`:6595`).
- **Waiting.** Up to 10 min on Sunday, up to an hour otherwise.
- **Fails when.** A post lands outside the burst window; and the producing side has a reliability
  history this programme has not documented (§8, C-5).
- **Break-out.** STRUCTURAL — Substack.
- **Serves.** `JTBD-W03`, `JTBD-B04`, `JTBD-E02`.
- **Evidence.** 🟢 `api/main.py:6593`, `:6595`, `:6598`.

#### WF-D07 — The announcement allowlist: publishing something paywalled is one env var away
- **Trigger.** WF-D04 publishing a session.
- **Runs.** `partly`.
- **Sequence.** `[pod]` on publish, `maybe_announce` checks the **routed section** against
  `DESK_TSDR_ANNOUNCE_SHOWS` → if allowed, post to the **public** TSDR channel → later, edit that same
  message to fold in the recap, sending `attachments: [{id}]` or Discord drops the thumbnail.
- **On screen.** A public Discord channel.
- **Hand-off.** ⭐ **Paywalled content → public channel, with an allowlist as the only barrier.** The
  stated contract is that *"a blank value announces NOTHING — the failure direction is silence, never a
  leak"*, railed by `test_announce_refuses_a_paywalled_show_and_posts_nothing`, mutation-checked.
- **Waiting.** 15–40 min for the recap edit, *"and sometimes never"* — which is why the first post is
  written to read complete on its own.
- **Fails when.** The allowlist is widened, or an agent reads a stale copy of the value — WF-D04's
  2026-09-13 escalation is the same class on the neighbouring variable.
- **Break-out.** STRUCTURAL — Discord, and deliberately public.
- **Serves.** `JTBD-B03`, `JTBD-B04`.
- **Evidence.** 🟡 `CLAUDE.md` Desk announce section (CLAIM, naming its own rail and mutation check).
  🟢 `CLAUDE.md:5388` for the live `DESK_PUBLIC_SHOWS=*` on the sibling variable.

### 4.5 Group E — the programme's own workflow

#### WF-E01 — Measuring whether Terminal-Next is preferred
- **Trigger.** A named occasion, declared eligible **that morning**.
- **Runs.** `no` — ⛔ **not yet run, and blocked on one owner input**: CARD 22 §6 leaves *"name a
  non-builder subject"* as the only unblocked-except item.
- **Sequence.** `[programme]` **pre-register** the workflow, the incumbent tool it must displace, the
  subject and the span in a dated artifact whose timestamp **precedes day 1** — *"Absent ⇒ the claim is
  blocked regardless of anyone's opinion"* → `[subject]` on each occasion, do the work in Terminal-Next
  and **not open the named incumbent for that task** → `[recorder]` same day, one line per
  person-occasion, append-only, **with what else was open, named** → `[programme]` a **withdrawal
  block** inside or after the span: turn the surface off, unannounced; if nobody asks for it back
  before the close, it was tolerated → `[adjudicator]` a named non-subject answers
  **PASS / FAIL / INCONCLUSIVE** against the rule signed on date D.
- **On screen.** ⭐⭐ **The only workflow in the estate that requires "what else was open" to be
  recorded** — the exact field every other entry here writes "not measured" into. **CARD 22 commissions
  the instrument that would retire this file's evidence ceiling and populate §5 from observation
  instead of inference.**
- **Hand-off.** Recorder → adjudicator, deliberately different people.
- **Waiting.** A baseline phase first: K of N **eligible occasions**, where *"K and N are derived from a
  baseline phase that first measures how often the workflow occurs at all. A rate needs a denominator
  somebody measured, not a span somebody liked."*
- **Fails when.** ⛔ *"A missing day is UNREADABLE, never a zero."* More than a third ineligible ⇒
  INCONCLUSIVE. No non-subject adjudicator ⇒ **INCONCLUSIVE-BY-CONSTRUCTION**, which *"does not become
  a PASS because nobody was available to disagree."*
- **Break-out.** N/A (programme workflow) — no member in the loop. ⚠️ Counted with the machine flows in
  §2.5's `N/A` class, because the field's classes are about a person leaving our site and there is no
  such person here.
- **Serves.** Every entry in §4 — each is a candidate denominator.
- **Evidence.** 🟢 `12-decisions/DECISION_CARDS_2026-09-26.md:442-575`, §1–§6.

#### WF-E02 — Choosing which workflow to pre-register
- **Trigger.** CARD 22's baseline phase needing a candidate list.
- **Runs.** `no` — this file is its input, not its execution.
- **Sequence.** `[programme]` take §5's ADDRESSABLE rows (each already names an incumbent tool the owner
  confirms he uses) → measure the occurrence rate of that step for a baseline span → derive K and N →
  pre-register → run WF-E01. ⛔ **Do not pick a STRUCTURAL row**: a trial against a break-out no feature
  can close is unachievable by construction, which is the same trap CARD 24 found on the other side —
  a trial against an incumbent that no longer exists *"cannot be failed, cannot be passed, and cannot
  be run."*
- **On screen.** n/a.
- **Hand-off.** This file's §5 → CARD 22's pre-registration artifact.
- **Waiting.** ⛔ **The whole baseline phase, and it cannot be skipped**, because item 13 established
  that frequency is the one field the programme cannot fill (its `## GAPS` 2 and 7).
- **Fails when.** A span is chosen instead of a rate — CARD 22 §3 killed exactly that, because *"it is
  a conjunction of five events that a HEALTHY product fails."*
- **Break-out.** N/A (programme workflow).
- **Serves.** n/a.
- **Evidence.** 🟢 `DECISION_CARDS_2026-09-26.md:442-575` §3, §4; CARD 24's consequence 1. 🟢
  `04-workflows/jobs-to-be-done.md` §4 and `## GAPS` 2, 7.

---

## 5. ⭐⭐ The break-out ledger — where the flow leaves our site

The thesis is that someone should be able to **only use our site**. Every row below is a reason
somebody keeps another tab open, or a reason they always will. Class counts are derived in §2.5; the
sum of the five class counts must equal the workflow count.

### 5.1 ADDRESSABLE — a named tool at a named step

⚰️⚰️ **CORRECTION, 2026-09-26, BY THE INTEGRATOR — THIS AUTHOR NAMED ITS OWN LIKELIEST ERROR, NAMED THE CHECK THAT WOULD SETTLE IT, AND WAS RIGHT. `WF-C03` AND `WF-C06` ARE WITHDRAWN FROM THIS TABLE.** Both rested on the UCT side LACKING a trailing implied-vs-realized calibration, flagged in-file as *"an inference from absence under the ledger's staleness banner"*. **It is not absent. It ships, and it is mounted.** Measured on `origin/master`: `app/src/components/research/sections/SetupSection.jsx:19` imports `ImpliedVsRealized` and `:241` renders it, and that file's own header reads *"§4.3.1 — the Setup canvas. ONE hero (ImpliedVsRealized)"* — so it is not merely present, it is the **hero** of a member-facing section. Backed by `api/services/implied_store.py` (an `implied_snapshots` table and a fiscal-identity pairing explicitly built for the *"implied-vs-realized RICH/CHEAP chip"*), `implied_move.py` and `implied_backfill.py`.

⭐ **The count therefore moves and is deliberately NOT re-stated as a new total here** — re-run the derivation command in §5 rather than trusting a number typed during a correction, which is the defect this programme keeps paying for. ⛔ **And the wider lesson is the one CARD 24 had already paid for once that day: an "UCT absent" cell is the single most dangerous kind in any coverage document, because it is the one that gets acted on.** Two of them were caught here only because the author labelled its own confidence honestly instead of asserting the absence.

⛔ Read the two columns separately. **Tool** is owner-stated (2026-09-26: *"Assume that i personally
use every other site mentioned"*). **Step** is this file's inference, because CP-06 records the owner
declining to itemise which tool serves which step. Nothing below is an observed exit.

| workflow | the step where the flow leaves | tool (owner-stated) | what would close it, per the cited evidence | step confidence |
|---|---|---|---|---|
| WF-C13 | inspecting a chart after a drill or a scan row | finviz.com, TradingView | ⭐ **nothing may be needed** — CARD 24 measured the in-app embed already replaced by `ChartPane` / `BreadthDrillModal`; what survives is a by-hand habit nobody has observed | 🔴 inference, and the programme's own highest-value cheap observation |
| WF-C11 | writing a rule the shipped vocabulary cannot say | TradingView (Pine), thinkorswim (thinkScript) | partly closed already — the transpilers exist *because* of this exit; `thinkorswim.md` §5 verdicts thinkScript **leave-external** by design | 🟡 the strongest inference here: the transpilers are the artifact |
| WF-B06 | authoring and receiving a watched condition | TradingView alerts (**separately owner-confirmed 2026-09-19**) | item 13 `JTBD-M07`: a documented, cheap inbound webhook (JSON auto-detected, ports 80/443, 2FA, **3 s** receiver timeout) — *"turn a competitor surface into an upstream sensor instead of a destination"* | 🟢 for the tool being in the workflow; 🟡 for the step |
| ~~WF-C03~~ ⚰️ **WITHDRAWN — it ships (`SetupSection.jsx:241`, the section's hero)** | reading whether this name's options have historically over- or under-priced the move | Market Chameleon | item 13 `JTBD-W04`: arithmetic over data UCT already holds (`earnings_analytics`); UCT computes the **forward** move and not the **trailing calibration** | 🟡, and ⚠️ the UCT-side absence is an inference from absence under the ledger's staleness banner |
| ~~WF-C06~~ ⚰️ **WITHDRAWN — same finding as WF-C03** | the per-print IV-crush table around each of the last prints | Market Chameleon | same as above | 🟡, same caveat |
| WF-C12 | disagreeing with a generated answer one piece at a time | TradingView (AI screener → an editable configuration) | item 13 `JTBD-X06`: a posture, not a feature — the generator must emit the product's own editable object rather than prose about one | 🟡 |
| WF-C09 | inspecting an interrupting name without losing the working screen | TradingView | item 13 `JTBD-M05` records the interrupt itself as served in-product (`TickerPopup`); what leaves is the *interactive inspection* inside it — ⚠️ dated, because CARD 24 removed the embedded half | 🔴 inference; same open question as WF-C13 |

⭐ **What the shape of this table says.** ⛔ Its row count is
`grep -c '^- \*\*Break-out\.\*\* ADDRESSABLE'` (§2.5), not a number typed here — and the rows collapse
onto a short tool set (**TradingView · thinkorswim · Market Chameleon · finviz.com**) and **two
postures**: *let me express a condition and receive it back* (WF-B06, WF-C11, WF-C12) and *tell me how
this instrument has behaved before* (WF-C03, WF-C06); WF-C09 and WF-C13 are the same posture as each
other — *let me look at it properly* — and are the pair a single cheap observation would settle.
⛔ **None of these postures is a screen.** A roadmap that answers them with pages will leave the tabs
open.

### 5.2 STRUCTURAL — leaves by design, and no feature closes it

| workflow | destination | why it cannot be closed |
|---|---|---|
| WF-C14 | order placement | ⛔ **governing default**: `OWNER_SEED_FACTS.md` §6, *"no execution or order management"* for V1. Nothing here proposes execution |
| WF-C14, WF-B07 | thinkorswim / Schwab | the platform is inseparable from a funded brokerage account — *"a brokerage-transfer decision, not a tool-preference decision"* (`thinkorswim.md` §4 via item 13) |
| WF-C10 | a second physical monitor | the operating system's, not a feature |
| WF-C07 | the member's own calendar app | ⭐ leaving **is** the feature; what is addressable is the credential, not the exit |
| WF-B04, WF-B05, WF-D03, WF-D05, WF-D07 | Discord | a community platform we chose and do not own |
| WF-D01, WF-D06, WF-B08 | Substack | the letter's and the scans' publication channel, by choice |
| WF-D04 | Zoom, YouTube, Discord | the pipeline's whole value is crossing three platforms unattended |
| WF-A07 | a Windows desktop, a toast and a file | not a site workflow and cannot be made one |

⭐ **Read this column twice, because both readings matter to the thesis.** Most structural exits are
**destinations we chose** — publishing to the audience where the audience is. Those are not failures of
aggregation. The exits that *are* about the member's own life are the broker and the calendar, and both
are places where something other than information lives: capital, and time.

### 5.3 NOT MEASURED — the flow certainly leaves and nothing says where

- **WF-C01**, the session itself. ⛔ **The most important gap in this document.** The owner uses every
  tool the programme names, so his session leaves our site; the estate records the first surface and
  the most-viewed surfaces and **no transition between any two of them** (§6, H11). Converting this row
  to NONE would be the single worst error available in this file, and CARD 22's *"what else was open,
  named"* is exactly the instrument that would fill it.

### 5.4 NONE — fully substituted today

WF-C02, WF-C04, WF-C05, WF-C08, WF-D02 — the row count being
`grep -c '^- \*\*Break-out\.\*\* NONE'` (§2.5), not a number typed here. ⭐ **This is the thesis already
holding**, and two of these rows show why that is not sufficient on its own: **WF-D02** is the tightest
loop in the estate *because* every step is ours, and **WF-C08** is fully substituted and **measurably
barely used** (16 `calendar_seen` rows in total). ⛔ A NONE is a statement about coverage, never about
value.

---

## 6. The hand-off map — every boundary this estate's work crosses

⭐ A hand-off is where workflows break, because it is where one thing's success criterion stops
applying. Every row is cited in §4.

| # | from → to | carrier | watched by | latency |
|---|---|---|---|---|
| H1 | owner's PC → pod | `POST /api/push` (whole payload) | `wire_freshness_watchdog` 09:05 ET — ⛔ **structurally cannot see a one-run miss** (F1) | one run |
| H2 | owner's PC → R2 → pod | brain pack tarball + `brain/latest.txt` | nothing in this programme's reach | up to 6 h + a restart for code |
| H3 | worker pod → web pod | R2 snapshots/deltas, **newer-wins merge** | `bars_continuous_audit`, `bars_reconciliation` (30-min cycles) | `SNAPSHOT_INTERVAL_SECONDS` 1200 |
| H4 | provider → pod → member | wire store; `screener_rows`; breadth store | `wire_coverage_monitor`; `CoverageLine`'s four counts | 20 s to 21 h by lane |
| H5 | broker → pod | SnapTrade activities ledger, holdings-as-truth | `broker_live_sentinel`, `broker_fidelity_audit`, the `grep -c broker_sync` merge check | sync interval, ≤1 poll/5 min/account |
| H6 | Zoom → pod → YouTube → `edu_videos` → Discord → same Discord message | MP4, then a row, then an embed, then an edit | `desk_session_audit` 09:00 ET, **after a 3 h grace** | 5 min publish; ≤~3 h insights; *sometimes never* |
| H7 | pod → community/email | Discord webhooks, Resend | per-job; `discord_index_close_retry` is the only retry | by slot |
| H8 | owner → Substack → pod | a published post, found by polling | nothing — **a poll is the watcher** | ≤10 min Sunday, ≤1 h otherwise |
| H9 | member's thumb → next issue | `wire_feedback.db` → `wire_prompt_config` | ⚠️ round trip graded a **CLAIM** by D-13 | ~19 h |
| H10 | product → outside | ICS `webcal://` (no TTL), definition and chart share links | nothing | client-controlled |
| H11 | surface → surface, in one session | ⛔ **nothing** | ⛔ **nothing** | ⛔ **not measured, anywhere** |

⛔⛔ **H11 is the finding in this table, and it is why §5.3 exists.** Every other boundary above carries
an artifact somebody can point at. H11 — a person moving from one surface to the next, which is what a
workflow *is* — carries nothing, is watched by nothing, and is the reason every "on screen" line in
group C reads as it does.

---

## 7. Where the clock stalls — the waiting inventory

| workflow | the wait | measured? |
|---|---|---|
| WF-C03 | 25–40 s cold modal; enrichment cold 17.9 s → warm 0.14 s; whole-week 24.8 s → warm 0.22 s; **130× cliff re-armed every 5 min** | 🟢 on prod 2026-08-08 (`terminal-current-map.md:547`) |
| WF-D04 | insights land **≤~3 h** after publish; the audit's grace window is exactly that | 🟢 `desk_session_audit.py:45` |
| WF-D02 | **~19 h**, set by the 05:00 CT critic | 🟡 derived from two clocks |
| WF-A01 | *"~7.7 min"* or *"~10-11 min"* | ⚠️ two conflicting CLAIMs (§8, C-1) |
| WF-C11 | up to **21 h**, because the answer is the 03:00 snapshot | 🟢 by the cadence ceiling's own derivation |
| WF-B06 | **1 min to 1 day**, depending which family owns the condition | 🟢 from eight trigger literals |
| WF-D06 | ≤10 min in the burst, ≤1 h outside it | 🟢 `api/main.py:6598` |
| WF-A01 → the desk (F1) | ⛔ **the 07:35 → 09:30 ET blind window**: a wire that never ran renders *fresh* and alerts nothing | 🟢 derived: `engine.py:545`, `:573`; `api/main.py:2503` |
| WF-C14 | the trader's own arithmetic, and the trip to the broker | ⛔ **not measured** |
| every group C entry | the time a person spends in a step | ⛔ **not measured, and cannot be from anything here** |

---

## 8. Failure modes that nothing notices, and contradictions not resolved

### 8.1 Steps that can fail while every instrument reads green

1. ⛔⛔ **A missed morning wire, for one run.** F1. `api/main.py:2503` compares against
   `expected_wire_date()`, which `engine.py:545` rolls back before 09:30 ET, so at the 09:05 ET check a
   one-run miss satisfies the comparison; the member badge agrees (`engine.py:573`). **The guard's own
   docstring says it watches for *"a pre-today date"* (`api/main.py:2487`) — and at 09:05 `expected`
   IS pre-today.** Intent and implementation disagree by one day.
2. ⛔ **An empty pre-market scan.** `morning_wire_engine.py:11478` records `ok: True` with `count: 0`;
   the distinction is a `print` on one laptop (`:11479-11480`).
3. ⛔ **A producer scheduled after its consumer.** F3 — and the consumer runs the producer itself, so
   nothing ever errors.
4. ⚠️ **A desk session that published but never got its insights.** Caught, deliberately late: the
   audit waits 3 h and reads the **artifact** rather than a counter, because
   `desk_session_insights._FAIL_STREAKS` is in-memory and *"this pod redeploys several times a day, so
   the streak resets before it can fire"* — **a proxy that resets on redeploy reports healthy straight
   through a total failure.**
5. ⚠️ **A publish decision taken from a stale document.** WF-D04's 2026-09-13 escalation: 27 videos set
   unlisted and restored; cause = `CLAUDE.md`, not code.
6. ⚠️ **A workflow step planned around a deleted component.** WF-C13 / CARD 24: master's `CLAUDE.md`
   still documents the Finviz PNG tabs and a `chartPeriod` default of `'tv'` as live, and
   `git grep -nE "chart\.ashx" origin/master -- app/src` returns zero. ⭐ Same class as 5, on a
   *competitive* claim rather than a privacy one.
7. ⚠️ **A gated job that is off.** `CALENDAR_WEEK_POST_ENABLED` and `CALENDAR_ALERTS_ENABLED` both
   default 0 with nothing in the repo saying otherwise (`terminal-current-map.md:543-544`, `:556`), so
   WF-D03 and parts of WF-B02 / WF-B05 are indistinguishable from not existing.
8. ⚠️ **A board recovered into emptiness.** WF-C10: a corrupt blob autosaved within 500 ms.
9. ⛔ **A machine that is powered off.** WF-A07 is the only artifact treating this as first-class, and
   its mitigation — *"a missing Sunday alert is the signal"* — is the correct shape for WF-A01 through
   WF-A05 and is **not applied to them**.

### 8.2 Contradictions recorded, not resolved

**C-1 — the engine's runtime, twice in one file.** `CLAUDE.md:3977` (master): *"Takes ~7.7 min."*
`:4328`: *"Engine takes ~10-11 min total (scanner adds ~5-6 min to prior ~5 min runtime)."* Same
document, same pipeline. It matters because it is the only number bounding WF-A01's wait, and therefore
how close to the open a failed run can be discovered by hand.

**C-2 — the breadth collector's hour, three readings.** The roster this deliverable was briefed with
says **15:15 CT = 16:15 ET**; `CLAUDE.md:4010` and `:5921` say **16:30 ET**; `:4168` says *"the 4:15
collector"*. It matters because the live intraday row is hidden the moment the collector's day is
`superseded` — this is the clock on a member-visible state change.

**C-3 — how many PC jobs there are.** `OWNER_SEED_FACTS.md:20` (Level-1) names **9**; the only roster
carrying start times lists **8**; `CLAUDE.md:572-573` documents a tenth (weekdays 21:00 CT) present in
neither. Derivations in §2.5.

**C-4 — the RTH runbook's own count.** `docs/runbooks/rth-scheduling.md:3` says *"Nine Windows
scheduled tasks"*; its own table at `:42-49` lists **8**. Either a ninth exists and is missing from the
table, or the sentence is wrong. ⭐ This programme's signature defect — a hand-typed count beside the
list it describes — found in a runbook whose whole purpose is to be checkable.

**C-5 — the Sunday scan's producer is undocumented here.** The pod polls for it (WF-D06) and the RTH
runbook names `SUNDAY_SCAN_WEBHOOK_URL` and `SUNDAY_SCAN_BRACCO_WEBHOOK_URL` as *"the only webhooks
configured on this machine"*, so a publishing path exists on the PC. **No schedule for it appears
anywhere in this programme's tree**, including in the Level-1 roster of nine.

**C-6 — item 13's `JTBD-M02` describes a deleted component, and its headline verdict may follow.**
CARD 24 measured the in-app Finviz embed gone; item 13's *current solution* line for `JTBD-M02` names
it. ⛔ **Recorded, not re-cut**: CARD 24 itself declines to re-verdict item 13 from one grep and flags
it as *"the highest-value correction outstanding"*. WF-C13 is written around what survives.

**C-7 — carried forward from item 13, still unresolved.** `posts_total` **88** (D-13 §2f) vs **92**
(D-13 §11); `cap_universe` **3,742** (`capability-ledger.md` A8) vs **3,721** (D-13 §2a). Recorded only
so a reader does not re-derive them as new.

⚠️ **One thing that LOOKED like a contradiction and is not.** The price. CARD 23 rules that
`charter/OWNER_SEED_FACTS.md:61` spliced a UCT Intelligence *tier* statement and a **different
product's** promo price into one sentence: UCT Intelligence is **$200/month or $2,000/year**,
owner-ratified, and the **$7/week is the Whop plan**, a separate live-trading Discord outside this
programme's boundary. This file states no price, builds no workflow on the Whop product, and keeps the
two populations apart (§2.3).

---

## 9. Weak workflows — quarantined, not stated as findings

⛔ These are sequences I believe exist and **could not evidence as sequences**. They are here rather
than in §4 because the discipline that makes §4 worth reading is that every entry names a clock, an
actor or an artifact. The count is derived in §2.5.

#### WEAK-WF-01 — The member's own morning
- **Believed workflow.** A paying member sits down, opens something, moves through two or three
  surfaces, and forms a plan.
- **Why quarantined.** The only ordering the programme owns is **admin** session-days
  (`OI-06-telemetry-derived-defaults.md:26-28`), and of 29 accounts only 13 have any `page_views` row
  (`:8`), six of the roster being admins. ⛔ There is no member sequence in the inputs, and constructing
  one would be the CARD 22 error applied to a morning. ⚠️ **And it must not be borrowed from the other
  product**: the ~750 paying members are the Whop Discord's (CARD 23), not this product's.

#### WEAK-WF-02 — The order and frequency of the tool switch
- **Believed workflow.** During the session the desk moves between UCT and the external tools in some
  order, some number of times, for some purpose each.
- **Why quarantined.** ⭐ **Re-cut on 2026-09-26, because half of it stopped being a belief.** The
  owner states he personally uses every site the programme names, so **which tools** is settled and
  §5.1 now carries them as owner-stated fact. What remains unevidenced is the **order**, the
  **frequency**, and the **per-step attribution** — CP-06 records that he declined to itemise, and
  H11 records that nothing in the estate observes an exit. ⛔ The leak is silent by construction: UCT
  never links to thinkorswim, so no signal of a switch exists on either side.

#### WEAK-WF-03 — The partner hand-off on a live position
- **Believed workflow.** Two people in the same name coordinate.
- **Why quarantined.** The programme evidences partner collaboration only in **code ownership**
  (`OWNER_SEED_FACTS.md` §4, five partner-owned modules) and dogfooding headcount as a **DEFAULT**
  (*"2 to 5 internal users… Ask."*, `:63`). Nothing evidences co-trading; item 13 quarantined the same
  belief as `WEAK-03`. ⚠️ CARD 22 §6 makes naming a non-builder subject the one outstanding owner
  input, so this may become evidenceable by a decision rather than a measurement.

#### WEAK-WF-04 — The first week
- **Believed workflow.** A new member arrives, finds out what the product does, and builds a habit.
- **Why quarantined.** ⛔ The one thing measured about self-description points the other way: the
  programme's own ledger was **six for six wrong about what ships, every one understating it**
  (`capability-ledger.md:15`, `:17`, `:19`). Onboarding cannot be described as a sequence while the
  estate's inventory of what there is to onboard onto is known-wrong in one direction. Item 13 routes
  the job to `JTBD-X09`; the *sequence* has no artifact.

#### WEAK-WF-05 — The support loop
- **Believed workflow.** A member asks in Discord or a ticket; the desk answers from the record; the
  answer changes the product.
- **Why quarantined.** The corpora exist and are measured (D-13 §11: 7,766 Discord messages, ~300 video
  ticker-moments, the published archive) and item 13's `JTBD-B03` covers the *job*. ⛔ **Zero support
  artifacts exist in this programme's inputs** — no ticket, no transcript, no churn reason — so the
  loop's steps, latency and outcome are unevidenced. ⚠️ `feedback`, `support_tickets` and
  `ticket_messages` are named tables in `auth.db` (`CLAUDE.md`, Auth section), so the measurement is
  **cheap** and simply has not been taken.

#### WEAK-WF-06 — Checking in from a phone between screens
- **Believed workflow.** Away from the desk, a quick look at a position or a level.
- **Why quarantined.** Item 13 kept `JTBD-X12` on a competitor's investment and stated **"no observable
  can be stated"**; that applies harder to a sequence. ⛔ **No telemetry here distinguishes a mobile
  session from a desktop one**, so there is no way to say a mobile sequence happened at all, let alone
  what it was, let alone where it broke out to.

---

## 10. ⛔ What this document does NOT decide

1. **It does not rank workflows.** §1 argues four findings are most load-bearing and says why in
   evidence terms. The owner declined to rank by time spent.
2. **It does not supply frequency.** Not for one entry. WF-E02 exists because CARD 22 requires a
   denominator this programme has not measured.
3. **It does not assign a workflow to a Terminal-Next surface.** Items 19–20 own that.
4. **It does not size or sequence any build.** Item 16 owns sizing; no `FB-*` item is restated.
5. **It does not price anything, and carries no cost analysis.** CARD 23 settles the price and the
   product boundary; the owner de-scoped costs and usage on 2026-09-26. §5 therefore ranks nothing by
   spend and estimates nothing.
6. **It does not propose execution.** The no-execution default (`OWNER_SEED_FACTS.md` §6) is recorded
   as the reason one break-out is structural, and that is the whole of this file's position on it.
7. **It does not decide any displace / absorb / bridge call.** Item 13 §4 reports those verdicts, each
   labelled a hypothesis pending owner confirmation, and CARD 24 has put one of them under re-read.
   Nothing here moves one. §5.1's "what would close it" column reports what the cited evidence already
   says; it is not a recommendation to build.
8. **It does not re-verdict item 13.** C-6 records the conflict and stops, for the reason CARD 24 gives
   for stopping.
9. **It does not fix anything it found.** F1's off-by-one, §8.1's rows and §8.2's contradictions
   are **reported**. This is a docs branch; the fixes are engineering decisions with owners.
10. **It does not promote a quarantined entry.** §9 records beliefs and zero findings; promotion needs
    an artifact, not a second opinion.
11. **It does not supersede item 12 or `daily-journey.md`.** ⚠️ It overlaps the latter by design — §3 is
    a clock and a journey is a narrative over one — and whoever writes it should derive from §3 rather
    than re-read the roster.

---

## GAPS

1. ⛔⛔ **No observed sequence, and therefore no observed break-out.** H11. Every row in §5 is derived
   from a capability gap plus an owner-stated tool; **not one is an observed exit.** ⭐ The cheapest
   thing that would move this file is what item 13 also asked for, now twice-requested: **one recorded
   morning's click sequence, with what else was open.** CARD 22's measured clause already specifies the
   instrument — it is not built.
2. ⛔ **The single most valuable open question this file touches is one observation wide.** Does the
   owner open **finviz.com by hand** for chart inspection (WF-C13)? CARD 24 establishes that no code
   read can answer it and CP-06 that it was not itemised. ⭐ It is cheap, it is unmeasured, and it
   decides whether the largest ADDRESSABLE row in §5.1 is a real exit or a retired one.
3. ⛔ **There is no F-07 contract.** No `F-07.md` in `00-program-control/contracts/`. Items 12, 13 and
   14 all carry F-07 in the MASTER_CHECKLIST and none has a contract file, so this file's scope
   boundaries are self-imposed rather than contracted.
4. ⛔ **The Level-1 PC roster carries no times.** `OWNER_SEED_FACTS.md:20` names nine jobs and gives none
   an hour; every Central-Time clock in §3.1 comes from outside the programme's tree, and one roster is
   short by one job (C-3). ⭐ **The cheapest programme-side fix in this file: paste
   `Get-ScheduledTask | Get-ScheduledTaskInfo` output into the charter.**
   `docs/runbooks/rth-scheduling.md:64-70` already publishes that exact command for its own tasks.
5. ⛔ **Two of the nine PC jobs are names only** (WF-A04's EOD updater, WF-A05) — 2/9 of the desk's own
   automated day, uncharacterised in every input.
6. ⚠️ **Pod flag state is unreadable from here.** Every `partly` in groups B and D is `partly` because a
   registration is visible and its production arming is not. `railway variables --service web --json`,
   printing KEY NAMES ONLY, would move several to `yes` or `no`; per `_SHARED_PREAMBLE.md` that is
   contract-gated and this file did not have it.
7. ⚠️ **`capability-ledger.md` is under its staleness banner and every "current solution" reference
   inherits it** — six for six wrong, all **understating** what ships (`:15`, `:17`, `:19`). ⛔ Nothing
   here should be read as evidence that a capability is absent. Most exposed: WF-C03 and WF-C06 (whose
   ADDRESSABLE classification rests on an absence), WF-C11, WF-C12, WF-B03. ⭐ CARD 24 is the worked
   example of why: a dependency was retired and the documentation describing it did not move.
8. ⚠️ **Nothing here was executed.** No test run, no endpoint called, no job triggered. Every code
   statement is a read of the pinned blob `74bdf4f68dd020af10a64b3cb5a6a64e0751ac11` or of a read-only
   working tree. F1 in particular is a **derivation from two functions**, not an observed non-firing;
   the confirming observation would be a day on which the wire missed once and no `wire_missed` alert
   appeared.
9. ⚠️ **Group B's roster is registrations, not runs.** 168 `add_job` call sites counts what the code
   asks APScheduler for on boot. Duplicate ids with `replace_existing=True`, gates returning early, and
   jobs inside `try` blocks that raised all reduce it. The derivation is honest about being an upper
   bound.
10. ⚠️ **The desk-tool reports are pre-owner-answer** (all 2026-09-02), so nothing in the inputs
    describes a *sequence* involving the external tools — which is what makes WEAK-WF-02's surviving
    half unwriteable and §5.1's step column 🟡 or 🔴 throughout.
11. **Not read, named so the omission is a decision.** The Bloomberg and Gödel leaf files and every
    competitor dossier except `unusual-whales` were not opened; competitor mechanism references are
    second-hand through item 13, which read `best-of-breed.md`, which read them. The `uct-sunday-scan`
    repository was not opened (C-5), and the Discord-bot repository is recorded as *"Definitively not
    running on this PC"* (`OWNER_INPUTS_REQUESTED.md:14`, OI-16).

---

## SOURCES

**Owner testimony (Level-1, `GOVERNING_PRINCIPLES.md` §2).**
`charter/OWNER_SEED_FACTS.md:20` (the PC roster), `:61` (the tier half, per CARD 23), `:63`, §4, §6
(the no-execution default, the market-cap floors, "the UCT way") · `OWNER_INPUTS_REQUESTED.md:14`
(OI-06's 2026-09-19 answer **and** its "stamped artifacts" cell naming the workflow library; OI-16) ·
`OWNER_DECISIONS.md:9` (D-001 desk-first) · **three statements of 2026-09-26 relayed to this
deliverable**: the aggregation thesis, *"Assume that i personally use every other site mentioned"*, and
*"We have 750 members in discord paying. Dont worry aobut anything else on costs or uses."*

**Decision cards.** `12-decisions/DECISION_CARDS_2026-09-26.md:227` CARD 17 · `:442-575` **CARD 22**
§1–§6 · `:624` **CARD 23** (price and the product boundary) · `:645` **CARD 24** (the in-app Finviz
embed is gone).

**Code, at origin/master `74bdf4f68dd020af10a64b3cb5a6a64e0751ac11`** (read via `git show` /
`git grep`, never a checkout).
`api/main.py` — `:19` `_ET`; `:1680`–`:1970` screener nightly chain; `:2220` signature sweep;
`:2481`–`:2519` **the wire watchdog**, invoked at `:6377`; `:2831` transcript alerts; `:2861`/`:2876`
index close + retry; `:3007` pattern judge; `:5400`/`:5412`/`:5416` Floor; `:5568`/`:5576`/`:5644`–
`:5708` dark pool; `:5757` side heal; `:5784`–`:5813` weekly IPO/COT; `:5914` ticker types;
`:5955`/`:6021`/`:6046` breadth; `:6143`–`:6258` broker; `:6466` flow stats;
`:6486`/`:6500`–`:6519` **buzz digest slots**; `:6555` exposure gate; `:6570`–`:6584` tweet bursts;
`:6593`–`:6600` **Substack poll**; `:6617` desk article audit; `:6658`–`:6699` **desk session
pipeline**; `:6719` ratings; `:6741`/`:6748` earnings warms; `:6760`/`:6763`/`:6771` AI briefings;
`:6791`/`:6797`/`:6817` **wire detector + coverage**; `:6825`–`:6841` **catalyst hunt, with the
owner-stated times at `:6832-6835`**; `:6898`/`:6914`/`:6954` catalyst audit/learner/digest; `:6973`
**Saturday week post**; `:7003`/`:7010` calendar alerts; `:7042`/`:7043` churn/MRR; `:7050`/`:7051`
watchlist digests; `:7061` bars refresh; `:7096`–`:7130` Compass proactive + awareness; `:7153`–`:7448`
**the alert-taxonomy lanes**; `:7497` D2 warm reader; `:7518`/`:7661`/`:7695` Compass
focus/recap/digest; `:7557` flow prune; `:7600` OI snapshot; `:7750`/`:7757` patterns;
`:7921`/`:7928` theme engine.
`api/services/engine.py` — `:528-549` **`expected_wire_date`** (the `(9, 30)` rollback at `:545`);
`:552-573` **`wire_freshness`** and the **2026-08-14 incident** at `:558-560`; `:2687-2710`
`get_candidates`.
`api/services/desk_session_audit.py` — `:24`; `:44-45` window and grace constants.
`api/services/discord_buzz_digest.py` — `:46` `DEFAULT_TIMES`; `:49-74` `digest_times()`.
`api/routers/push.py` — the writer constant, its two-authorities warning, `INVALIDATE_KEYS`.
`app/src/pages/Breadth.jsx` — `:45-49` `ChartPane`; `:339-347` **the deleted `DrillModal` and
`BreadthDrillModal`**. `app/src/pages/ThemeTrackerPage.jsx` — `:7`, `:39`, `:1505`, `:1537`.
`git grep -nE "chart\.ashx" origin/master -- app/src` → **zero** (re-run 2026-09-26; the only master
hits are `CLAUDE.md`, three design docs, and the partner-owned `api/schwab_router.py:424`, `:440`,
whose existence is recorded and not described further).
`docs/runbooks/rth-scheduling.md` — `:3`; `:11-23`; `:42-49`; `:51-53`; `:64-70`.
`CLAUDE.md` (master) — `:572-573` brain pack; `:3977`/`:4328` **the two runtimes**; `:3978-3979` wire
and scanner tasks; `:4009-4010`/`:4168`/`:5921` **the three breadth-collector readings**; `:5388`
`DESK_PUBLIC_SHOWS=*` live; the DrillModal section, cited as the stale artifact it is.

**Read-only, outside the dashboard repository.**
`C:\Users\Patrick\morning-wire\morning_wire_engine.py` — `:154` `today_iso()`; `:11472-11487` **the
scanner stream, its in-process call at `:11476` and its `ok: True` health write at `:11478`**; `:12261`
`today_s`; `:12765` `"date": today_s`.

**This worktree, HEAD `abfc335d2`.**
`CLAUDE.md:15-18` — the stale-`DESK_PUBLIC_SHOWS` warning and the **2026-09-13 escalation** ·
`00-program-control/MASTER_CHECKLIST.md:20` (this row), `:19` (item 13) · `AGENT_REGISTRY.md:139` ·
`contracts/_SHARED_PREAMBLE.md` ·
`04-workflows/jobs-to-be-done.md` §1, §2.1–§2.6, §3 (every JTBD id cited above), §4, §5, §6, §7,
`## GAPS` 2, 3, 7, 10 ·
`01-existing-system/terminal-current-map.md:533-563` §5 (the 130× cliff at `:547`, the weekend cadence
at `:549`, the strict gate at `:551`, the production-render confirmation at `:557`, the PC dependency at
`:559`) and `:651-689` §7 W1–W9 ·
`01-existing-system/capability-ledger.md:15`, `:17`, `:19` (the staleness banner, read as a lead never
a fact); rows A5, A8, A13, B5, B7, **G5 (`:153`, the Finviz scans in-process inside the wire)** ·
`verification/2026-09-14/OI-06-telemetry-derived-defaults.md:8`, `:24-33`, `:35`, `:39-52`, §5–§6 ·
`C:\Users\Patrick\.claude\projects\C--Users-Patrick\memory\MEMORY.md:186-187` — the only roster
carrying PC start times, **outside this programme's tree**, cited so the dependency is visible.

---

## ⛔ What this document does NOT decide

See §10, which is this section in full and is placed where a reader needs it. Restated in one line:
**this file establishes how the estate's work moves in time and where it leaves our site, and cites
what establishes each; it does not rank workflows, supply their frequency, assign them to a surface,
price them, propose execution, re-verdict item 13, or fix the clock defects it found.**
