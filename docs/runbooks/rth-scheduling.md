# RTH sessions, scheduled — how Monday runs itself

Nine Windows scheduled tasks run the Monday RTH session end to end. This file is how to
check on them, abort them, and re-arm them.

---

## ⛔ THE ONE THING THAT CANNOT BE AUTOMATED

**The machine must be ON, or ASLEEP. Never shut down.**

Measured with `powercfg /a` on this box: **Standby (S3)**, **Hibernate** and **Hybrid
Sleep** are available; S0 low-power idle and S1/S2 are not. `WakeToRun` is set on every
task, so Windows will wake the machine from S3/S4 to run them.

⛔ **Nothing wakes a machine that is powered off.** A BIOS/UEFI RTC alarm could, but
Windows exposes no supported way to read or set it, so this cannot be checked or
configured from here — it is a firmware setting, outside anything a script can reach.

⭐ **The Sunday 20:00 ET preflight is itself the power check.** If it ran at all, the
machine was on. So **a missing Sunday alert is the signal** — not a quiet success. That
is why the preflight alerts on GO as well as NO-GO: silence should never need
interpreting.

Everything else that used to be a thing you had to remember is now checked, held, or
shouted about:

| was | now |
|---|---|
| remember not to let the screen lock | `UCT RTH Keepalive` holds it awake and unlocked, and `UCT RTH Restore` puts every setting back |
| remember the screen must not be already locked | preflight fails with the literal message **"unlock the screen"** |
| remember the Railway login might have expired | checked twice, Sunday and Monday, with a one-command fix |
| hope the task actually fired | watchdogs at 09:35 / 16:35 ET say so if it did not |
| hope nobody deployed mid-measurement | the open run lists master pushes since 09:00 ET, and each item re-runs once after a swap |

---

## Every task, both time zones

| task | ET | **local (Central)** | what it does |
|---|---|---|---|
| `UCT RTH Preflight Sunday` | **Sun 20:00** | Sun 19:00 | full preflight (no rig). Its alert is also the "machine is on" proof |
| `UCT RTH Preflight Monday` | **Mon 07:45** | Mon 06:45 | full preflight **+ one path-B rig run** — proves the chain 35 min early |
| `UCT RTH Keepalive` | **Mon 08:10** | Mon 07:10 | saves lock/power settings, disables lock, holds the machine awake until 18:00 ET |
| `UCT RTH Open` | **Mon 09:20** | Mon 08:20 | items 1–15, 7 h limit |
| `UCT RTH Watchdog Open` | **Mon 09:35** | Mon 08:35 | alerts if `run-open.json` is missing or stale |
| `UCT RTH Close` | **Mon 16:20** | Mon 15:20 | items 16–23, 2 h limit, pushes after 16:15 ET |
| `UCT RTH Watchdog Close` | **Mon 16:35** | Mon 15:35 | alerts if `run-close.json` is missing or stale |
| `UCT RTH Restore` | **Mon 18:00** | Mon 17:00 | restores every setting the keepalive changed — **runs regardless of how anything else ended** |

All one-time triggers · `Interactive only` · `WakeToRun` · `MultipleInstances=IgnoreNew`
· RunLevel `Limited`. **ET → local is computed** (Eastern → UTC → local) at registration,
never typed, so it survives a DST boundary.

```powershell
# every RTH task, next run time and last result
Get-ScheduledTask -TaskName 'UCT RTH*' | Get-ScheduledTaskInfo |
    Select-Object TaskName, NextRunTime, LastRunTime, LastTaskResult | Format-Table -AutoSize

schtasks /run    /tn "UCT RTH Open"      # run now, ignoring the trigger
schtasks /end    /tn "UCT RTH Open"      # stop a running one
schtasks /delete /tn "UCT RTH Open" /f   # remove
```

---

## Alerts — where you will actually see them

**Channel: a Windows toast, plus a file.** Both, every time, because a toast is missable
and transient while the file is a record.

| | |
|---|---|
| toast | WinRT, raised from Windows PowerShell 5.1 (the WinRT types do not load in PS 7 — the alert script shells out to 5.1 if needed) |
| latest status | `C:\Users\Patrick\Desktop\UCT-RTH-STATUS.txt` **and** the OneDrive-redirected `…\OneDrive\Desktop\UCT-RTH-STATUS.txt` — both exist on this box, both are written, each overwritten by the next alert |
| full history | `logs\rth-alerts.log` — appended, never truncated |

⛔ **Deliberately NOT Discord.** The only webhooks configured on this machine are
`SUNDAY_SCAN_WEBHOOK_URL` and `SUNDAY_SCAN_BRACCO_WEBHOOK_URL`, which belong to the
Sunday-scan **publishing** path — a content channel with an audience. Ops chatter from a
measurement run does not belong there, and creating a new webhook was out of scope. If an
ops `DISCORD_WEBHOOK_URL` ever appears in the environment, `rth-alert.ps1` will post to it
as well — opt-in by presence, never created here, never printed.

**You get an alert at:** Sunday preflight result · Monday preflight result · open run
started (with the list of master pushes since 09:00 ET) · open run finished (measured /
INCONCLUSIVE / unmeasured counts) · any `INCIDENT.md` · close run finished (with the path
to `FINAL-REPORT.md`) · either watchdog · settings restored.

---

## The preflight, and the one-command fix for each failure

Written to `scratchpad\monday-rth\preflight-<sun|mon>.json`, one human line per check.

| check | if it fails, run this |
|---|---|
| on AC power | plug the machine in |
| network up | check the connection |
| `/api/health` 200 + pod age | check production is up |
| railway auth valid | **`railway login`** then `schtasks /run /tn "UCT RTH Preflight Monday"` |
| railway token not expiring soon *(warn)* | `railway login` if commands start failing |
| `MEMBER_SMOKE_*` present | `setx MEMBER_SMOKE_EMAIL …` / `setx MEMBER_SMOKE_PASSWORD …` |
| member-smoke login 200 `role=member` | if 429, wait a minute — the endpoint is 5/min per IP |
| free memory ≥ 3 GB | close memory-hungry processes |
| no runaway process | stop the named PID |
| **screen not locked** | **unlock the screen** |
| both RTH tasks armed | re-register per this file |
| worktree clean *(warn)* | `git status`; commit or stash |
| 0 behind `origin/master` | fast-forwards itself when it safely can; if diverged: `git fetch origin master; git rebase origin/master` |
| no leftover rig browser | `Stop-Process` the named `ms-playwright` PIDs |
| *(Monday)* rig path-B dry run | `python tools\flow_cold_paint_rig.py --path b --runs 1` |

⭐ **It alerts on success too** — `RTH open is GO`. A monitor that only speaks on failure
cannot be told apart from one that is not running.

### Railway session expiry

`~/.railway/config.json` carries `user.tokenExpiresAt`. Both `accessToken` and
`refreshToken` are **43-character opaque strings, not JWTs**, so there are no claims to
read — the epoch field is the only expiry visible anywhere.

⚠️ The access token is short-lived (hours) and the CLI rolls it using the refresh token.
**The refresh token's own lifetime is not exposed in any readable form**, so "when will
the login actually die" cannot be answered from this machine. That is precisely why the
preflight runs twice rather than once, and why the fix is one command.

If a project token is ever set as `RAILWAY_TOKEN`, the preflight uses it in preference to
the CLI session and says so in its output.

---

## The keepalive, and the restore guarantee

`UCT RTH Keepalive` **saves before it changes**, into
`scratchpad\monday-rth\lock-state-saved.json`:

`ScreenSaveActive` · `ScreenSaverIsSecure` · `ScreenSaveTimeOut` · `EnableGoodbye`
(dynamic lock) · `MonitorTimeoutAC` · `StandbyTimeoutAC`

then disables the screensaver and its secure flag, turns dynamic lock off, sets monitor
and standby timeouts to never on AC, and holds
`SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_DISPLAY_REQUIRED)` in a
Python loop (`scripts/rth_keepalive_hold.py`) until 18:00 ET or a stop file.

⛔ **The hold must be a living loop.** That flag is per-thread and dies with the process,
so a script that sets it and exits has done nothing — and looks exactly like one that
worked.

⛔ **It cannot unlock a screen that is already locked.** Nothing in user space can. That
case is the preflight's job.

**THE RESTORE GUARANTEE:** `UCT RTH Restore` has its **own** one-time trigger at 18:00 ET
and runs regardless of how the open or close run ended — success, failure, crash, or
never started. It writes the stop file, restores each saved value (removing a key that
was unset rather than inventing a default), **reads every setting back and diffs it**, and
writes `scratchpad\monday-rth\restore-report.json`. A mismatch raises a FAIL alert naming
the setting. If there is no saved baseline it changes nothing and says so — guessing a
value there would silently rewrite a real preference.

Run it by hand any time: `powershell -File scripts\rth-restore.ps1`

---

## Where everything lands

| what | where |
|---|---|
| transcripts | `logs\rth-<date>-<phase>.log` · `logs\rth-alerts.log` · `logs\rth-keepalive.log` — **gitignored** |
| exit code, wall time, refusals | `scratchpad\monday-rth\run-<open\|close>.json` |
| preflight results | `scratchpad\monday-rth\preflight-<sun\|mon>.json` |
| per-item raw + guard verdicts | `scratchpad\monday-rth\item<N>.json` |
| rig output per item | `scratchpad\monday-rth\rig-item<N>.json` |
| saved / restored settings | `lock-state-saved.json` · `restore-report.json` |
| committed results | `docs\runbooks\monday-rth-results\` |
| **the report to read** | **`docs\runbooks\monday-rth-results\FINAL-REPORT.md`** |
| an incident | `scratchpad\monday-rth\INCIDENT.md`, run exits non-zero |

---

## Monday morning — one command

```powershell
Get-Content "$env:USERPROFILE\Desktop\UCT-RTH-STATUS.txt" -Raw
```

That is the latest alert. For the task view:

```powershell
Get-ScheduledTask -TaskName 'UCT RTH*' | Get-ScheduledTaskInfo |
    Select-Object TaskName, LastRunTime, LastTaskResult, NextRunTime | Format-Table -AutoSize
```

`LastTaskResult 0` = completed · `3` = the wrapper refused (read
`scratchpad\monday-rth\run-open.json` for which precondition) · `267009` = still running.

Live: `Get-Content .\logs\rth-2026-09-14-open.log -Wait -Tail 40`

## Aborting mid-run, safely

```powershell
schtasks /end /tn "UCT RTH Open"
powershell -File .\scripts\rth-restore.ps1        # do not wait for 18:00 ET
Get-Process | Where-Object { $_.Path -like '*ms-playwright*' } | Select-Object Id,ProcessName,Path
```

⛔ **Never a blanket `Stop-Process -Name chrome`** — the persistent Wave-Q1 rig profile
uses Chrome too. Kill by the `ms-playwright` path only.

Anything already in `scratchpad\monday-rth\` stays valid: that is the whole point of
writing each item as it finishes. The close run still produces a partial report and marks
the rest `unmeasured`.

## Re-arming for another day

```powershell
$et = [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
function ToLocal([datetime]$t) {
  [System.TimeZoneInfo]::ConvertTimeFromUtc([System.TimeZoneInfo]::ConvertTimeToUtc($t,$et),
                                            [System.TimeZoneInfo]::Local) }
$day = '2026-09-21'
@{ 'UCT RTH Preflight Monday' = '07:45'; 'UCT RTH Keepalive' = '08:10'; 'UCT RTH Open' = '09:20'
   'UCT RTH Watchdog Open'    = '09:35'; 'UCT RTH Close'     = '16:20'
   'UCT RTH Watchdog Close'   = '16:35'; 'UCT RTH Restore'   = '18:00' }.GetEnumerator() |
ForEach-Object {
    $l = ToLocal ([datetime]"$day $($_.Value)")
    "{0,-26} ET {1} = LOCAL {2}" -f $_.Key, $_.Value, $l.ToString('MM-dd HH:mm')
    Set-ScheduledTask -TaskName $_.Key -Trigger (New-ScheduledTaskTrigger -Once -At $l) | Out-Null
}
```

⭐ Always print both zones. A task armed an hour off is indistinguishable from a correct
one until the morning it misses the open.

## Rehearsing the chain

```powershell
powershell -File .\scripts\rth-preflight.ps1 -Phase rehearsal -AllowWeekend    # full preflight
powershell -File .\scripts\rth-keepalive.ps1 -DryRun                           # apply + read back + restore
powershell -File .\scripts\rth-open.ps1 -PromptFile "docs\runbooks\rth-smoke-prompt.md" -AllowWeekend -Phase smoke
powershell -File .\scripts\rth-open.ps1 -HealthUrl "https://uctintelligence.invalid/api/health" -AllowWeekend -Phase failtest   # expect exit 3
```

Everything a rehearsal writes is labelled **NOT A MEASUREMENT**. Reset a rehearsal commit
with `git reset HEAD~1` (never a push).

## ⚰️ What the rehearsals caught — seven real bugs, before Monday

Every one of these would have failed silently at 08:20 Monday.

1. **`$args` is a PowerShell automatic variable.** A registration helper took `$args` as a
   parameter, so it interpolated to **empty** and every task launched
   `powershell.exe -NoProfile -ExecutionPolicy Bypass` with **no `-File`** — an idle
   interactive shell that sat there until its time limit. No log, no error, no output:
   from the outside, indistinguishable from a slow run. The real tasks used a different
   parameter name and were unaffected, which is luck, not design.
2. **A quoted `-Deadline` never bound.** Through `powershell -File`, `-Deadline '…'`
   arrives with its quotes and fails to coerce to `[datetime]`. Parameter binding fails
   **before the script body**, so it exited 1 having written nothing. The parameter is now
   `[string]`, parsed inside, and accepts both quoted and unquoted forms.
3. **A non-zero exit that was not a failure.** The smoke session did all its work, wrote
   its files and committed — then exited 1 because a SessionEnd *plugin* hook was
   cancelled. Both runners now judge by the artifacts and report both numbers, so a
   healthy morning is never alarmed as a failed one.
4. **`Tee-Object` writes UTF-16** in PowerShell 5.1, making every log unreadable to
   `grep`/`tail`. Now written as UTF-8 explicitly.
5. **`run-<phase>.json` had a UTF-8 BOM** — `json.load` refuses it outright.
6. **The rig saved nothing** without `--out`; a clean run left no artefact.
7. **`powercfg` subgroups** — `STANDBYIDLE` is under `SUB_SLEEP`, not `SUB_VIDEO`; the
   wrong pair is fatal under `ErrorActionPreference = Stop`. And **`/api/health` has no
   `uptime_s`** — the field is `uptime_seconds`, so pod age was reporting blank.

⭐ Most of these share a shape: **a step that "worked" and produced nothing durable, or
produced a blank that nothing checked.** None would have raised an alarm on Monday; the
morning would simply have been empty.

## ⚰️ What the earlier rehearsal caught — four real bugs, before Monday

1. **`run-<phase>.json` was written with a UTF-8 BOM** — `json.load` refuses it outright.
   Every consumer would have crashed on line 1. Now `UTF8Encoding($false)`.
2. **The rig saved nothing** — it prints to stdout and writes a file only with `--out`. A
   clean path-B run completed and left no artefact. The open prompt now requires `--out`.
3. **`powercfg` subgroups** — `STANDBYIDLE` lives under `SUB_SLEEP`, not `SUB_VIDEO`. The
   wrong pair returns *"does not exist"*, fatal under `ErrorActionPreference = Stop`.
4. **`/api/health` has no `uptime_s`** — the field is `uptime_seconds`, so the preflight
   was reporting a blank pod age while otherwise passing.

⭐ The first two and the fourth are the same class: **a step that "worked" and produced
nothing durable, or produced a blank that nothing checked.** None would have surfaced as a
failure on Monday morning.
