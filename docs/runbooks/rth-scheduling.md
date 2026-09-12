# RTH sessions, scheduled — how the Monday run starts itself

Two Windows scheduled tasks run the Monday RTH session end to end without anyone opening
a terminal. This file is how to check on them, abort them, and re-arm them.

---

## ⛔ PRECONDITIONS YOU MUST MEET — nothing below works without all of them

| | why |
|---|---|
| **PC on** | a scheduled task cannot run on a powered-off machine. `WakeToRun` is enabled, which wakes the box from *sleep* — it cannot wake it from *off*. |
| **User logged in** | both tasks are registered `Interactive only`. They do not run as SYSTEM, and they do not run at the logon screen. |
| **Session not locked** | the rig drives a **visible** browser tab. A locked session can throttle or suspend rendering, and a rig run against a throttled tab produces numbers that look like a product regression. This is the precondition most likely to be missed. |
| **On power** | the tasks are set to start on battery, so this is not enforced — but a laptop that sleeps mid-session loses the run. |
| **Network up** | the open wrapper refuses if `/api/health` is unreachable. |
| **Before 09:20 ET Monday** | the trigger is one-time. A machine that boots at 09:25 runs it late via `StartWhenAvailable`, which is worse than not running: it would miss the open. |

⚠️ **`WakeToRun` wakes from sleep, not from hibernate-to-disk in every configuration, and
never from off.** If the box is normally shut down overnight, leave it on Sunday night.

---

## The two tasks

| task | ET | **local (Central)** | prompt | limit |
|---|---|---|---|---|
| `UCT RTH Open` | **Mon 2026-09-14 09:20** | **Mon 2026-09-14 08:20** | `docs/runbooks/monday-rth-prompt-open.md` (items 1–15) | 7 h |
| `UCT RTH Close` | **Mon 2026-09-14 16:20** | **Mon 2026-09-14 15:20** | `docs/runbooks/monday-rth-prompt-close.md` (items 16–23) | 2 h |

Both are **one-time triggers, not recurring** — you decide per session. Both:
`Interactive only` · `WakeToRun` · `StartWhenAvailable` · `MultipleInstances=IgnoreNew`
(a second instance never starts while one is running) · start-on-battery allowed ·
RunLevel `Limited` (no elevation needed).

⭐ **ET → local is computed, not typed.** The registration converts through
`Eastern Standard Time` → UTC → local, so it stays correct across a DST boundary. On
2026-09-14 both zones are on daylight time, so ET − 1 h = local.

### Managing them without help

```powershell
# list (both, with next run time and last result)
schtasks /query /tn "UCT RTH Open"  /fo LIST /v
schtasks /query /tn "UCT RTH Close" /fo LIST /v

# run one NOW, ignoring its trigger (the wrapper's preconditions still apply)
schtasks /run /tn "UCT RTH Open"

# stop a running one (see "abort" below before you do this)
schtasks /end /tn "UCT RTH Open"

# delete
schtasks /delete /tn "UCT RTH Open"  /f
schtasks /delete /tn "UCT RTH Close" /f
```

---

## What the wrappers do before spending a session

`scripts/rth-open.ps1` and `scripts/rth-close.ps1`. Both set the working directory to the
`flow-watch-rail` worktree and hydrate `MEMBER_SMOKE_*` / `SMOKE_*` from the **User**
environment scope.

⚠️ **The hydration is not decoration.** `setx` writes those variables into the registry;
a process whose parent predates the `setx` never sees them. The wrapper reads the User
scope explicitly so the run does not depend on which shell happened to launch it.

⛔ **`RAILWAY_TOKEN` does not exist on this machine and is not needed.** The Railway CLI
authenticates from its own rolling session at `~/.railway/config.json`. The wrapper checks
that file exists and **warns** if it does not — it does not refuse, because most of the
session's measurements do not need the pod. If that warning appears, items 1, 5 and 7 will
be thin.

**The open wrapper REFUSES (exit 3) and starts no session if:**

1. it is not a weekday (override for a rehearsal with `-AllowWeekend`),
2. `/api/health` is not reachable or does not return 200,
3. free physical memory is under **3 GB**.

⭐ Why refuse rather than try: a run against a dead origin or a memory-starved box
produces a transcript full of failures that reads, a week later, exactly like a product
finding. Refusing costs nothing. A false finding costs a day.

The close wrapper drops the health refusal — it reads files and pushes docs, so an origin
blip is no reason to lose the write-up — and keeps the weekday and memory refusals.

### Permissions

Both run `claude -p` with `--permission-mode acceptEdits --permission-prompts none` and an
explicit `--allowedTools` list. **`--permission-prompts none` is the load-bearing flag: it
denies anything not allowlisted instead of waiting for an answer nobody is there to give.**
An unattended run therefore cannot hang on a prompt.

- **Open** allows `python`, read-only `railway` (`logs`/`status`/`deployment`/`ssh`), and
  read-only `git` plus `add`/`commit`. **`git push` is denied** — the open run commits
  locally and the close run pushes. `railway variables`/`redeploy`/`up` are denied so the
  pod stays read-only.
- **Close** allows exactly one push form (`git push origin HEAD:master`) and **denies the
  rig** (`flow_cold_paint_rig.py`, `flow_storm_probe.py`). Items 16–23 must not re-measure,
  and taking the tool away is a stronger guarantee than asking nicely.

---

## Where everything lands

| what | where |
|---|---|
| transcript (stdout + stderr) | `logs/rth-<YYYY-MM-DD>-<open\|close>.log` — **gitignored** |
| exit code + wall time + refusals | `scratchpad/monday-rth/run-<open\|close>.json` |
| per-item raw results and guard verdicts | `scratchpad/monday-rth/item<N>.json` |
| manifest of which items exist | `scratchpad/monday-rth/index.json` |
| committed results | `docs/runbooks/monday-rth-results/` |
| **the report to read afterwards** | **`docs/runbooks/monday-rth-results/FINAL-REPORT.md`** |
| an incident | `scratchpad/monday-rth/INCIDENT.md`, and the run exits non-zero |

⭐ The report is written **into the repo**, not just to stdout, precisely because the
session output may be gone by the time anyone looks.

---

## Monday morning — did it start? (one command)

```powershell
schtasks /query /tn "UCT RTH Open" /fo LIST /v | Select-String 'Status|Last Run Time|Last Result|Next Run Time'
```

`Status: Running` means it is working. `Last Result: 0` after it finishes means it
completed; **`3` means it refused** — read the refusal reason:

```powershell
Get-Content .\scratchpad\monday-rth\run-open.json -Raw
```

Live progress, if you want it:

```powershell
Get-Content .\logs\rth-2026-09-14-open.log -Wait -Tail 40
```

## Aborting mid-run, safely

```powershell
schtasks /end /tn "UCT RTH Open"        # stops the task tree
```

Then check nothing was left behind — the rig drives a real browser:

```powershell
Get-Process chrome,chromium,msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -or $_.Path -like '*ms-playwright*' } |
    Select-Object Id, ProcessName, Path
```

⛔ **Do not kill the Chrome processes that belong to the persistent Wave-Q1 rig profile.**
Kill by the Playwright path or by the browser the rig launched, never a blanket
`Stop-Process -Name chrome`.

Anything already written to `scratchpad/monday-rth/` stays valid — that is the whole point
of writing each item as it finishes. The close run can still produce a partial report from
whatever exists, and it will mark the rest `unmeasured`.

## ⚰️ What the rehearsal caught — two real bugs, before Monday

The smoke run on 2026-09-12 fired on schedule twice and is the reason two defects are not
waiting for Monday morning.

1. **`run-<phase>.json` was written with a UTF-8 BOM.** Windows PowerShell's
   `Set-Content -Encoding utf8` emits one, and Python's `json.load` refuses it outright —
   `Unexpected UTF-8 BOM`. Every consumer of the run record would have crashed on the
   first line. Both wrappers now write through
   `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`, and the second smoke
   confirmed the files start `7b` (`{`) rather than `efbbbf`.
2. **The rig saved nothing.** `tools/flow_cold_paint_rig.py` prints to stdout and writes
   a file only when given `--out`. The smoke's path-B run completed cleanly and left no
   artefact at all. The open prompt now requires `--out` on every rig invocation, named
   after the item it serves.

⭐ Both are the same class: **a step that "worked" and produced nothing durable.** Neither
would have shown up as a failure on Monday — the run would have looked fine and the close
session would have found an empty cupboard.

The smoke also reported, correctly, that it could not verify its own browser cleanup
because `tasklist` was not on its allowlist. It is now (read-only, open run only).

## Re-arming for another day

```powershell
$repo = 'C:\Users\Patrick\uct-worktrees\flow-watch-rail'
$et   = [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
$etTime = [datetime]'2026-09-21 09:20:00'                       # <- the ET time you want
$local  = [System.TimeZoneInfo]::ConvertTimeFromUtc(
             [System.TimeZoneInfo]::ConvertTimeToUtc($etTime, $et), [System.TimeZoneInfo]::Local)
"ET $etTime = LOCAL $local"
Set-ScheduledTask -TaskName 'UCT RTH Open' -Trigger (New-ScheduledTaskTrigger -Once -At $local)
```

Repeat with `16:20` for `UCT RTH Close`. ⭐ Always print both zones — a task silently
armed an hour off is indistinguishable from one armed correctly until the morning it
misses the open.

## Rehearsing the chain again

```powershell
# any time, from a normal shell - proves scheduler -> wrapper -> claude -> git works
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\rth-open.ps1 `
    -PromptFile "docs\runbooks\rth-smoke-prompt.md" -AllowWeekend -Phase smoke
```

It writes `scratchpad/monday-rth/smoke.json`, makes a local commit, and pushes nothing.
Everything it touches is labelled **NOT A MEASUREMENT**. Reset it with
`git reset --soft HEAD~1` if you do not want the commit.

To rehearse the **refusal** path instead:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\rth-open.ps1 `
    -HealthUrl "https://uctintelligence.invalid/api/health" -AllowWeekend -Phase failtest
```

Expect exit **3**, a refusal line naming the unreachable host, and no session started.
