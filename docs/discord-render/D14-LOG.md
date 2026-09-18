# D-14 run log

Append-only. A dated section per checklist state change. No interim reports to the
owner; if the session dies, this file plus `D14-CHECKLIST.md` IS the report.

---

## 2026-09-15 21:35 ET — W0 opened

```
================================================================================
D-14 W0 — autonomy infrastructure opened
master 9ccb3f795 | hardening b94ffb1b2 | gate ccf4fbcb6 live (RenderGate)
================================================================================

DONE
  A1  D14-CHECKLIST.md written -- the resume point.
  A6  this log.

REVISED, AND THE REVISIONS ARE OPERATIVE
  A4  the session does NOT self-grant via ~/.claude/settings.json. On a denial:
      retry once with the action restated; if denied again, record
      BLOCKED-permission with the exact settings block the owner needs, and
      continue with unblocked work. Grounds: the owner's own standing preference
      feedback_when_blocked_enumerate_tool_paths -- "never self-grant via
      settings.json". A denial is the human-in-the-loop control working.
  A3  the Playwright/debug-port rig is NOT built. No device-pick prompt was
      observed on 2026-09-15; tabs_context_mcp returned tabs directly and five
      smoke rows were driven through the MCP browser. The real friction was
      document.visibilityState == "hidden", fixed with PowerShell UI Automation.
      Relaunching the owner's logged-in Chrome with --remote-debugging-port would
      kill their working windows and expose an authenticated browser to anything
      on localhost -- real cost, for a blocker not in evidence.

CARRIED FORWARD FROM THE PRE-FLIGHT (all read-only, 2026-09-15 evening)
  OI-45 named: loop_stalled has never been able to fire in production. One
    Observer instantiation (commands.py:144), one caller (main.py:7816), inside
    if _render_v2.enabled(); V2 unset. Corroborated in-process by /renderhealth's
    own "Renderer: not probed yet". OI-43 fixed the instrument, not its reader.
  Delivery path for the fix verified LIVE and not V2-gated: chart_health_alerts
    .emit(key, severity, message); pages only at severity "critical"; on web the
    webhook is present and CHART_HEALTH_DISCORD_ENABLED is unset -> ON.
  Webhook target GREEN: #system-alerts, guild UCT Intelligence, 4 members -- NOT
    the ~750-member guild. Zero member exposure. Privacy rests on guild
    membership, not an @everyone VIEW deny -> OI-46, non-blocking.
  R34 tier-1 rationale corrected: the 20,446.6 ms stall occurred at uptime
    670-893 s, BELOW the 900 s floor. Tier 1 is the working path for that class,
    not a backstop above it. Tier-1 page volume is unknown; n=2.
  conftest.shared_data_root_census() confirmed at conftest.py:266 returning
    (literals, env_pins, unpinnable); SharedDataRootWrite at :159; idiom
    auth_db.py:10. Both /data writers must use it or they trip the tripwire.

NEXT UNBLOCKED
  A5 monitors. Note: background pollers die with the session -- overnight
  coverage needs a Task Scheduler entry, which is an owner action, so the
  overnight boot-window sample is opportunistic, not guaranteed.
  W1 is clock-gated to Wed >= 09:00 ET and is the next substantive item.

================================================================================
master 9ccb3f795 | W0 opened, no production change, budget intact
================================================================================
```

---

## 2026-09-17 08:47 ET — W2 smoke: 9 PASS, two rows corrected, one instrument thrown out

```
================================================================================
D-14 W2 -- the non-clock-bound smoke rows, on live commit d9455a6d64a5
web SUCCESS | V2 DARK (confirmed in-product) | no push, no env change this block
================================================================================

RAN (full record: docs/discord-render/evidence/smoke-2026-09-17/INDEX.md)
  9 PASS  -- rows 1, 4, 8, 9, 10, 11, 12, 13, 14
  2 pending clock gate -- rows 5, 6 at the 10:00 ET window
  3 not-runnable / inconclusive BY CONSTRUCTION -- rows 2, 3, 7 (V2 dark)
  0 FAIL, 0 unexplained NOT RUN

TWO ROWS NAMED A SURFACE THE PRODUCT DOES NOT HAVE, AND THE DEFECT WAS IN THE
SMOKE FILE, NOT THE BOT.
  Row 10 asked for `/charts`. Discord offers no such command in this guild:
    build_commands() (discord_interactions.py:1094) omits it and says why --
    "/charts is retired: /chart NVDA AMD AVGO is the same thing through one
    door. Its handler stays for a deploy cycle." build_charts_command() still
    EXISTS and is registered nowhere, so grepping for the payload finds one and
    concludes the command ships. The live door is routers/
    discord_interactions.py:562 -- len(reqs) > 1 -> run_multi_chart_job, type 5.
    Followed literally the row would have scored NOT RUN ("command not found")
    against a working feature, which is the most expensive shape of wrong row.
  Row 12 asked for "the /chartsettings surface opens". The gear EXPANDS the
    in-message controls (owner ruling 2026-08-26, recorded at chart_components:
    "the gear opens the full surface ... the open/closed state rides in the ids
    so it survives every click"). /chartsettings is a separate command.
  Both corrected in SMOKE-3.5.md rather than struck: each row's ASSERTION was
  right and only its door was stale.

ROWS 2, 3 AND 7 ARE OI-45's CLASS ONE LEVEL UP -- built, tested, mutation-
covered, and the door shut in production. Row 2's proof is in the product's own
docstring (discord_chart_house.py:270): "THE PRE-V2 PATH PASSES NEITHER KEY, so
it leaves with None before the import, and its URL is unchanged down to the
byte." No ticker and no market condition makes the pre-V2 path emit ?stale=.
  => NOT RUNNABLE, never FAIL -- and never PASS on the strength of a chart that
  had no badge: absence of a badge there is absence of the MECHANISM.

AN INSTRUMENT REPORTED A PROPERTY OF ITSELF AND IT READ LIKE A FINDING.
  The R31 boot trace probed loopwatch.snapshot() INSIDE a `railway ssh` python
  process. loopwatch's window is in-process state of the UVICORN process, so a
  fresh process imports a fresh, never-started watcher: 19 rows of
  {"running": false, "samples": 0} -- while d14_monitor.py, polling the SAME pod
  over HTTP in the SAME minute, recorded {"running": true, "samples": 600,
  "max_ms": 507.1}. Two instruments, one pod, one minute, opposite answers.
  The ssh answer reads as "the loop watcher is dead", not as a blank.
  => every loop block in r31-trace.jsonl BEFORE loop_src:"http" is VACUOUS and
     must not be scored. R31 is NOT satisfied by those rows.
  => replaced by docs/discord-render/instruments/r31_boot_trace.py: loop over
     HTTP (in-process truth), durable halves by import (volume truth, and the
     only route while OI-47 drops them from the payload), every field carrying
     its SOURCE. --self-check proves a failed probe RECORDS a gap. Running since
     08:45 ET, 60 s cadence, 4 h.
  ⭐ The durable halves were right all along and for the right reason: they live
     on the volume, which is exactly why W1 made them durable.

WHAT THE DURABLE RECORD SAYS ON THIS POD (uptime 1,344 s at 12:44:58Z)
  stall record   lifetime_max_ms 0.0 | recorded 0 | below_floor 0
                 CORRECT AND NOT A GAP: the trailing window's max is 664.9 ms,
                 under LOOP_STALL_ALERT_MS = 1000. The record is armed and
                 honestly silent. First page will be its first real test.
  token slots    current 127 | previous 0 | since 2026-09-17T12:23:20Z |
                 unreadable false
                 R29 is accumulating and no previous-slot sender has appeared.
  ⛔ DURABILITY ACROSS A RESTART IS STILL UNOBSERVED. `since` is 45 s after this
     pod's boot because that is when the file was first created -- no pod has
     restarted under commit B yet. THE TELL AT THE NEXT BOOT IS `slots_since`:
     if it moves, the counter is not durable and R29 cannot be satisfied by it.
     Check that before reading any count as a weekday span.

OI-47 CONFIRMED LIVE, unchanged: d14_monitor records stall_record: null and
token_slots: null on every poll against a volume that demonstrably holds both.
One-line fix stays staged for the next push.

NOT EXPLAINED, RECORDED: the pod restarted at 12:22:35Z with NO commit change
(/renderhealth still reports d9455a6d64a5, merged yesterday).

NEXT
  10:00 ET window: R17 (/flow SPY days:30) + rows 5 and 6, with web's log line
  captured inside Railway's retention window -- the cause of a row-5 refusal is
  recoverable from that line and nowhere else.
================================================================================
master unchanged | no env change | budget intact
================================================================================
```

---

## 2026-09-17 09:26 ET — a clock gate that opened itself, and labelled UTC as ET

```
⛔ `TZ=America/New_York date` THROUGH THE BASH TOOL ON THIS BOX RETURNS UTC.

A background wait for the 10:00 ET window was written as

    until [ "$(TZ=America/New_York date +%H%M)" -ge "1000" ]; do sleep 20; done
    echo "WINDOW OPEN: $(TZ=America/New_York date +%H:%M:%S) ET"

It exited IMMEDIATELY, at 09:26 ET, and printed

    WINDOW OPEN: 13:26:05 ET

13:26 is UTC. The TZ prefix did nothing, `%H%M` was therefore `1326`, `1326 >= 1000`
is true, and the gate opened 34 minutes early. The word "ET" in the output is there
because I typed it into the echo -- nothing converted a timezone and nothing
checked that anything had.

⭐ THIS IS THE THIRD INSTANCE OF ONE CLASS TODAY, and the first two were mine as
well: an instrument stating a property it never verified.
  1. the R31 ssh trace reporting ITS OWN process's loopwatch as the pod's;
  2. a deploy read as a spontaneous restart because the analysis dropped the `sha`
     column and filled the gap from a 35-minute-old reading;
  3. this -- a clock gate whose label was an assertion, not a measurement.
⛔ A rule written down at 08:47 was violated by its author at 09:26. Writing the
lesson is not the same as holding it.

⚠️ THE SECOND HALF OF THE TRAP IS THE NOTIFICATION. The background task reported
"completed (exit code 0)", which is exactly what a correctly-waited gate looks
like. The repo's standing rule -- a task status reports the WRAPPER's exit, never
the condition -- caught it: the clock was re-read from PowerShell's own
TimeZoneInfo conversion before acting, and the two disagreed by 34 minutes.

✅ THE FIX, and it is two changes, not one:
   - compute the gate in UTC, which needs no conversion:
       until [ "$((10#$(date -u +%H%M)))" -ge 1400 ]; do sleep 20; done
     (10:00 ET = 14:00 UTC while EDT holds; `10#` forces decimal so an 08xx
     reading is not parsed as invalid octal -- a second bug waiting in the same line)
   - NEVER label a clock reading with a zone the code did not convert to. Print the
     offset, or print UTC and say UTC.

⛔ THIS PROGRAMME HAS CLOCK-GATED DIRECTIVES (R17's 10:00 ET window, W3's Friday
08:23 ET, D-13's "Wed >= 09:00 ET"). Any of them waited on with `TZ=` through this
shell would open early and look like it had waited.
```

---

## 2026-09-17 09:30 ET — the record fired, the page landed, and I published a wrong cause

```
================================================================================
D-14 W2/W2b -- OI-45 CLOSED BY THE ARTIFACT. Live commit moved twice under us.
web SUCCESS 26147924dcbd (13:17:12Z) | V2 STILL DARK | no master push by this session
================================================================================

THE HEADLINE. A production pod blocked its event loop for 10,469.7 ms at uptime
103.6 s. W1 commit A recorded it on the volume, tiered it 1 under R34, paged --
and the page is in #system-alerts, verbatim:

  Chart health - loop_stalled: The event loop was blocked for 10470 ms at
  uptime 104s (tier 1). Discord closes an interaction at 3,000 ms and the
  renderer's page load fails in the same window (C-02).

OI-45 was "the rule exists, is tested, is mutation-covered, and can never fire".
This is the replacement path firing on a real pod with V2 still dark. The
10470/104s in Discord match the record's 10,469.7 ms @ 103.6 s, so the message
and the volume are ONE event.
  ⛔ `paged: true` WAS NOT THE PROOF. _page_discord is fire-and-forget with a
  bare `except: pass` and no logging on either path, so the log can never show
  delivery. The channel is the only artifact. I checked the channel.

SIX EVENTS ACROSS TWO COMMITS, carried through a deploy. The largest is
29,241.5 ms at uptime 58.3 s -- NINE TIMES Discord's 3 s deadline -- and it was
NOT paged, because the durable 30-minute cooldown was still running from the
first. That is correct, and it is the tension worth naming: without a durable
cooldown a pod that restarts all day re-pages every boot; with it, the biggest
event can be absorbed by a cooldown a smaller one opened. The RECORD catches it
either way. That is why there are two mechanisms -- the page is for attention,
the record is for truth -- and W1's separation justified itself in four hours.
  ⛔ DO NOT SHORTEN THE COOLDOWN. R35: the number moves after the cause is
  fixed, never to make a symptom louder.

R31 ANSWERED (R31-BOOT-WINDOW.md). Exposure-normalised, two runs shown as a
series: boot 1.94 -> 2.46 /pod-h against a tail that did not move at 1.08.
Minutes 0-3 carry a >=5 s rate of 4.17/pod-h against the settled tail's 0.16.
  ⭐ AND IT RECONCILES Q6 WITH THE CENSUS, WHICH WERE NEVER IN CONFLICT: D-12
  measured a RATE, the census measured a COUNT. Re-measured today the split is
  sharper still -- the >=1 s class is majority SETTLED (27 of 46) and the
  >=5 s class, the one that pages, is majority BOOT (9 of 13). Both true, about
  different populations; either alone misleads.
  ⛔ The hypothesised minute-11-to-15 block pages NOBODY: 4 events >=1 s, zero
  >=5 s, across both runs.

W2b MOVED AND STOPPED AT A CANDIDATE. Three log silences (25.3 s, 11.7 s, 6.7 s)
align with three recorded stalls; a log gap is what a blocked loop looks like
from outside. It does NOT name the blocker -- seven jobs ran in those windows.
The leading NAMED candidate leads only because it measures itself:
[discord-chart] hot warm reported 26.8 s and 33.5 s against its own 20 s budget,
and it fires EVERY MINUTE forever, not only at boot.

SMOKE: 10 PASS / 0 FAIL / 4 NOT RUNNABLE BY CONSTRUCTION (rows 2, 3, 5, 7).
  Row 5 joined the not-runnable set today and the reason was inside its own
  sentence: it asserts the `etfs` partition via discord_render.symbols
  .flow_source, whose ONLY caller is the V2 handler. The pre-V2 dispatch passes
  no `source` at all, so /flow SPY reads the STOCKS partition. Fourth instance
  of the built-tested-correct-and-behind-the-dark-flag class in one programme.
  Row 6 PASSED (NVDA, 246 contracts) and killed the pre-market hypothesis: a
  feed that answers an equity read in seconds is not a feed that is
  reconnecting. And row 5's cause was captured at last, inside the retention
  window: `[flow] fetch failed SPY (30): timed out`.

⛔⛔ AND I PUBLISHED A WRONG CAUSE, IN THREE ARTIFACTS, AND WITHDREW IT.
For forty minutes this programme's record said "three pod restarts in 55
minutes, all on the same commit, no push between them", with an exposure
argument on top. They were DEPLOYS -- another workstream merged 26147924d to
master mid-session, and the deploy list is the authority. The analysis printed a
table of t/uptime/current/previous/since and OMITTED `sha`, the one column that
answers "is this the same code?", then filled the gap from a /renderhealth
reading 35 minutes stale. The trace had recorded the change correctly the whole
time.
  ⭐ The retraction makes R29's durability STRONGER, not weaker: the counter
  survived a deploy to a DIFFERENT COMMIT -- slots_since held at 12:23:20Z,
  current went 251 -> 255 across the swap. R29's mechanism is proven in
  production; only its SPAN condition is outstanding (Friday ~08:23 ET).

THREE INSTRUMENT-HONESTY FAILURES TODAY, ALL MINE, ALL THE SAME CLASS:
  1. the R31 ssh trace reported ITS OWN process's loopwatch as the pod's
     (19 rows of running:false while the HTTP probe read 600 samples);
  2. the dropped `sha` column above;
  3. a clock gate that opened 34 minutes early and printed UTC labelled "ET".
  ⛔ All three were written AFTER the rule against them. Writing a lesson is
  not holding it.

PUSHED, NOT MERGED: fix/oi-47-health-early-return @ 494b20948. 2/2 mutations
RED, 108 tests green, zero file overlap with master's three new commits so it
merges clean. R22's one master push per session is SPENT (the W1 merge), and a
context compaction is NOT a session boundary -- treating it as one would let the
deploy budget be reset by an event with nothing to do with deploy risk.

STILL BLOCKED: C2/C3 BLOCKED-permission (Task Scheduler, owner action).
W3/OI-13 step 6 BLOCKED-until-FRIDAY ~08:23 ET (R29 span).

PENDING AT THE TIME OF WRITING: the 10:00 ET window (R17 + the RTH half of the
SPY/NVDA pair). Queue clear, live commit 26147924d, instruments alive.
================================================================================
master unchanged BY THIS SESSION | no env change | budget intact
================================================================================
```

---

## 2026-09-17 09:42 ET — W1's rails re-verified in THIS session, and the harness census re-derived

```
⭐ THE INTEGRATOR GATES IT ITSELF. W1 is merged and live, so its mutation proof
from the merging session is evidence, not a verdict. Re-run here, in this
session, on `feat/observability-stall-record` @ 246d6eff8:

  CONTROL BEFORE: exit=0   28 passed
  M1 the page is re-gated behind the dark V2 flag        RED  test_a_stall_pages_with_V2_DARK
  M2 the severity drops to warning                       RED  test_the_severity_is_critical
  M3 the cooldown stops being persisted                  RED  test_the_cooldown_survives_a_process_restart
  M4 the uptime floor reads as zero                      RED  test_tier2_pages_only_past_the_uptime_floor
  M5 tier 1 is raised out of reach                       RED  test_tier1_pages_at_any_uptime
  M6 the slot label is swapped                           RED  test_a_previous_match_increments_only_previous
  M7 the counter stops being persisted                   RED  test_counts_survive_a_process_restart
  M8 an unreadable counter reports itself as clean       RED  test_an_unreadable_counter_is_not_a_zero
  restore render_panels.py / stall_record.py / token_slots.py / observe.py -- all sha256 VERIFIED
  CONTROL AFTER:  exit=0   28 passed
  TOTALS mutation_harness_stall_record PASS declared=8 evaluated=8 failed=0

⭐ M2 and M3 are the two that matter most this morning, and both are now more
than theoretical. M2 (severity -> warning) is the mutation that would have
reproduced OI-45 in a new place -- recorded, never told -- and this morning the
unmutated path DID tell, in #system-alerts. M3 (cooldown not persisted) is the
one whose real-world behaviour we watched at 13:20:34Z: the durable cooldown
correctly suppressed a SECOND tier-1 page, which an in-memory cooldown on a pod
that redeploys all day could never have done.

W4 GATE ROW 4 -- "mutation NOT-APPLIED = 0" -- RE-DERIVED RATHER THAN RETYPED.
The snapshot says "15 harnesses, only 6 answer --dry-check". Measured today by
listing the directory and grepping each file, there are SIXTEEN, and still SIX:

  HAS --dry-check : adapters, contract, flipgate, image_delivery, load_model, push_guard
  NO  --dry-check : (the base harness), badge, cache, delivery, envlogs, observe,
                    renderer, stall_record, symbols, v2router

⛔ So the row is still NOT MEASURABLE, and for a reason worth stating precisely:
ten of sixteen harnesses cannot answer "was every mutation actually applied?"
without a FULL run, and a full run of ten harnesses is minutes each. The mover
is unchanged (--run-mutations, or read each merge row), and it is still
"unblocked and cheap" only in the sense that nothing external blocks it.
⚠️ The count moved 15 -> 16 because a harness was added since the snapshot. A
gate row quoting a hand-typed denominator drifts the moment the directory does;
this one is now derived by listing `mutation_harness*.py`.
```

```
================================================================================
2026-09-17 10:05 ET | R17 CLOSED | live commit 3648792d5a04 | V2 DARK | exposure 0
================================================================================
THE 10:00 ET WINDOW RAN. /flow ticker:SPY days:30 in #render-smoke at 14:00:07Z,
staged and zoom-verified in a rendered viewport before the key was pressed.

RESULT: SPY FAILS IN REGULAR TRADING HOURS TOO, byte-identical to pre-market.
  SPY  07:10 ET  FAIL  "the flow feed is reconnecting"
  NVDA 07:10 ET  PASS  rendered NVDA Flow card
  SPY  10:00 ET  FAIL  same sentence
(a) vs (c) controls the clock; (b) vs (c) controls the pod. The going-in
hypothesis -- pre-market feed warming, clears in RTH -- is REFUTED. The variable
is the SYMBOL.

CAUSE, from the pod log inside retention:
  14:00:37,886 WARNING [flow] fetch failed SPY (30): timed out
30.1 s after the ack, against timeout_s=30.0. A clean expiry.

AND NOT THE ETF PARTITION -- the obvious, well-cited, WRONG answer. A stocks-
partition miss returns ok:true/0 contracts and says "no significant options
flow"; we saw the not-ok branch. One grep separated them. That is the second
near-miss of this class in the programme and the first one that was caught
BEFORE publication rather than after.

OPEN, STATED NOT CLOSED: on 09-13 SPY-under-stocks returned fast enough to count
zero contracts; today it times out. Something changed, or the two readings were
not against the same flow-worker state. Next step is a flow-worker-side read, NOT
another Discord command.

ALSO THIS SESSION:
  - SMOKE_ROWS_TOTAL 15->14 is now MUTATION-PROVED (throwaway sandbox worktree):
      mutation_harness_flipgate PASS rows=11 cases=69 failed=0
      flip_preconditions --self-check PASS cases=11 mutation_failures=0 failed=0
    The single first-run failure was a STALE HAND-TYPED NEEDLE (says="only 1/15")
    with want=NOT MET got=NOT MET -- a red whose halves AGREE. Fixed by deriving
    it from fp.SMOKE_ROWS_TOTAL. Third count-beside-its-list defect fixed today.
  - SMOKE-3.5's unrunnable section said THREE over a list of FOUR. Corrected.
  - Row 7 settled NOT RUNNABLE on EVIDENCE (the run did not show s5's shape).
  - GATE UNCHANGED: VERDICT NOT MET, 6 MET / 2 NOT MET / 3 NOT MEASURABLE.
    ROW MOVED: canary scope MET -> NOT MEASURABLE, read-back aged past 24 h.
    NOT re-read: the instrument runs a LOCAL import of api.** under railway run,
    which this repo documents as writing to live C:\data outside pytest. The
    stronger fact -- V2 is off entirely -- is already measured in-product.
  - OI-47 OBSERVED LIVE AND CONTINUOUS: token_slots/stall_record are null in all
    85 r31 trace rows across THREE commits. The fix branch is still unmerged.
  - A SECOND PAGE DELIVERED, and it is TIER 2 -- the first tier-2 delivery seen:
    13:35:06Z, 1771.7 ms at uptime 930.1 s, paged=true. Both tiers now observed.
  - A 3572.1 ms block at uptime 281 s scored tier=null, correctly per R34, and
    would still have killed an interaction ack. The named design tension, again.

STILL BLOCKED: C2/C3 BLOCKED-permission (Task Scheduler, owner action).
W3/OI-13 step 6 BLOCKED-until-FRIDAY ~08:23 ET (R29 span).
NOT MERGED: fix/oi-47-health-early-return @ 494b20948 -- R22 budget spent.
================================================================================
master unchanged BY THIS SESSION | no env change | budget intact
================================================================================
```

```
================================================================================
2026-09-17 12:01 ET | D-15 MERGE PUSHED | e50c0552d -> master | V2 DARK | exposure 0
================================================================================
OWNER-DIRECTED MERGE (D-15). One master push, four commits, in the plan's order:

  ccb8f6bfd OI-47 the durable record + slot counter READABLE on BOTH health
                  branches. The two-branch schema diff is DERIVED from
                  observe.py's AST, not a typed key list, so a FOURTH
                  observability key is covered the day it lands. 2/2 RED.
  8ed544e24 R51   tier 1 = the Discord ack budget, 3,000 ms. 9/9 RED. M9 is the
                  PLAUSIBLE regression (back to 5,000), which is the one worth
                  railing -- M5's 1,000,000 ms nobody ships by accident.
  769189ccb R54   interaction type in band; an autocomplete stops counting as a
                  command arrival. Unknown is NEVER a command. 3/3 RED.
  46504fa88 R50   the smoke row scores the LATEST index on its own SHA; earlier
                  runs are named as history, never summed. No SHA or no run date
                  => rejected. 3/3 RED incl. the selector non-vacuity case where
                  filename order and the in-band date disagree.

PREFLIGHT ON THE LANDING TREE (master had not moved; f86c3759e was both the
merge-base and master's tip, so the landing tree WAS the branch tip):
  * roster DERIVED from tests importing the two changed api modules: 47 files,
    2 chunks, reconciled 24 + 23 = 47 -> 1,174 passed, 0 failed.
  * Python rail floor 164 passed / 1 failed. BASELINED LIKE-FOR-LIKE at
    f86c3759e in a detached worktree: fails there too, identically. This branch
    adds ZERO /data literals and none of the six files it names is in the diff.
    PRE-EXISTING, not a NEW failure.
  * hygiene clean (9,889 files) - flow_worker_watch_coverage OK (no tape gap) -
    guard: web SUCCESS on f86c3759e, 5,960s settled, master quiet.
  * invariants: broker_sync count 10 (>=7); api/main.py UNTOUCHED so main.py:838
    is untouched; RenderGate still in-process at
    api/services/discord_interactions.py:77 (it lives in api/services/, NOT in
    main.py -- checked rather than assumed, because it is a stop condition).

⛔ TWO INSTRUMENT DEFECTS CAUGHT IN MY OWN WORK BEFORE THEY COULD MISLEAD:
  1. R50's M2 first went RED by CRASHING (`if not sha:` -> `if False:` left the
     accept branch dereferencing None) and printed NO TOTALS LINE. Red for the
     wrong reason is not proof -- this repo's own totals-line rule in miniature.
     Retargeted so the REJECTION BEHAVIOUR is what fails.
  2. The first deploy poller would have accepted the PREVIOUS SUCCESS record
     from its third iteration, because it keyed on STATUS and not on whether the
     record was newer than the push. That is the "instrument pointed at something
     that moved" class, in a tool written minutes after reading the rule about
     it. Replaced with one that requires a timestamp after 12:01 ET.

⛔⛔ THE HARDENING BRANCH NOW CONFLICTS WITH MASTER, DELIBERATELY, IN TWO FILES.
It carries R16's SMOKE_ROWS_TOTAL = 14 and the derived needle; master carries
R50's rewritten scorer at 15. On merge: TAKE R50's SCORER AND R16's DENOMINATOR.
Orthogonal changes to the same files, both wanted. Recorded so the resolution is
a decision, not a scramble.

NEXT: OI-47's acceptance test on the live pod (stall_record + token_slots
non-null). If still null -> STOP and diagnose. Then R52 (OI-44, the top item).
================================================================================
one master push SPENT (owner-directed) | no env change | V2 flag unset
================================================================================
```
```
================================================================================
2026-09-18 01:41 ET | W3 DONE | c3fd509f7 pushed to discord-render-hardening
================================================================================
R52's static scanner named 17 async route handlers doing blocking sqlite3 I/O
directly on the shared loop: /api/oi/confirmation-map (member-reachable,
Search's OI-growth filter) + 15 /api/admin/{massive,oi,ticker-types,flow}/*
diagnostic routes, all in api/main.py. All 16 now wrap their existing body,
byte-for-byte unchanged, in `await run_in_threadpool(_sync)` -- a mechanical
move, not a rewrite (verified: zero awaits in any of the 15 admin bodies;
confirmation-map's one `await request.json()` stays outside `_sync()`).

Re-scanned after: route_handlers 17 -> 1. The remaining one (`enrich_oi` in
api/live_massive_router.py) is partner-owned (Ravi) and left untouched,
recorded rather than fixed -- same treatment as the two sync-HTTP findings
already standing in api/massive_ws_worker.py.

NEW GATE: tests/test_oi44_loop_blockers_gate.py -- a named allowlist (not a
count), so the class cannot silently return. Mutation-proved 2/2 RED: reverting
one handler to its actual pre-fix shape (blocking call at the top level, no
_sync) is caught; widening the allowlist with a stale entry is caught. Both
sha256-verified restores.

⛔ ONE HONEST GAP RECORDED, NOT FIXED: the scanner's OWN self-check requires it
to treat ANY nested plain `def` as an escape, even one never actually threaded
(`return _sync()` instead of `return await run_in_threadpool(_sync)`) --
that mutation came back GREEN. This is the existing tool's documented design
choice (not mine to redesign unilaterally this session); the mutation proof
above uses the real, historically-accurate regression shape instead, which the
scanner IS built to catch.

Behavioral coverage added (none existed before): test_oi_confirmation_map_
threadpool.py (real sqlite round-trip, both early-return paths, auth still
enforced) + test_admin_oi_routes_off_the_loop.py (all 15 admin routes answer
through the REAL AdminGuardMiddleware, no escaped exception; confirm=False on
flow/delete-by-date verified to still never mutate). 37/37 green.

flow_worker_watch_coverage: OK, no strand.

NEXT: W2b (OI-44 attribution -- correlate the stall record's wall-clock
timestamps against what else is running then: breadth collector, EOD updaters,
/api/push). W3-per-D14-CHECKLIST-section-3 (OI-13 step 6) remains
BLOCKED-until-Friday ~08:23 ET -- today is that Friday; not yet that hour.
================================================================================
W3 done, pushed to discord-render-hardening (feature branch, not master) | no env change
================================================================================
```
