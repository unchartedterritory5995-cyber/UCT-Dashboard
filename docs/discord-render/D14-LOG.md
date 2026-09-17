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
