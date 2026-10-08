# Wave 14, lane OPS: the restore-drill checkout, and the 13A shutdown checkpoint

Branch `feat/notebook-w14-ops`, cut from `c55d73ae69`. Written 2026-10-04.

Scorecard clause 7a is a scheduled restore drill (`UCT-AuthDB-Restore-Drill`, Sundays 09:00 local).
On 2026-10-04 its 09:00 run failed before the drill started. This lane hardens the wrapper,
finds why the checkout keeps disappearing, and makes a contained change to the 13A walk's shutdown.

## 1. What happened at 09:00

Task definition (`schtasks /query /tn UCT-AuthDB-Restore-Drill /v`): runs
`C:\Users\Patrick\uct-q1-observe\restore_drill_weekly.cmd` with **Start In: N/A**, so the process
starts in `C:\Windows\System32`. The wrapper is outside the repo.

`C:\Users\Patrick\uct-q1-observe\restore_drill.run.log`, lines 405-407:

```
---- Sun 10/04/2026  9:00:01.10 ----
python: can't open file 'C:\\Windows\\System32\\tools\\authdb_restore_drill.py': [Errno 2] No such file or directory
DRILL exit=2
```

The old wrapper ran `cd /d C:\Users\Patrick\uct-worktrees\notebook-soak-ref` with no error check,
so when the directory was missing the `cd` failed, the wrapper continued from System32, and it
logged `DRILL exit=2`. That is the same code an honest INCONCLUSIVE drill returns (line 404, the
2026-09-27 run). Nothing reached `soak-drills\` and no alert was sent. A session re-created the
checkout at 09:15 (its `.git` file and every tracked file are stamped 09:15:06) and a manual run
at 09:15 passed (log lines 408-633, `drill-2026-10-04.md`).

## 2. The hardened wrapper (task 1)

Repo source: `tools/restore_drill_weekly.cmd`. Pre-flight: `tools/restore_drill_guard.py`, which
the wrapper calls from its own directory (`%~dp0`), so it still runs when the checkout is gone.

In order, any failure stops the run:

1. `cd /d` into the observe directory first, so the run never starts from System32.
2. Python is the absolute path `C:\Python314\python.exe`. This is the interpreter `python` resolved
   to for the 09:15 PASS (`where python` lists it first), and it imports `boto3`.
   `PYTHONIOENCODING=utf-8` is set, as in `nb_soak.cmd`.
3. The guard checks four things. The checkout exists. It contains `tools/authdb_restore_drill.py`.
   `git rev-parse --show-toplevel` is that directory and not a parent repo. Its HEAD is on
   `origin/master`'s history (`git merge-base --is-ancestor HEAD origin/master`), so the drill
   never runs from a feature branch somebody left checked out there.
4. The wrapper `cd`s into the checkout again with its own error check, and only then runs the drill.

A failure does four things:

- writes `PREFLIGHT FAIL: <why>` and `DRILL exit=4` to `restore_drill.run.log`;
- writes `soak-drills\drill-YYYY-MM-DD-preflight.md` with the headline
  `# auth.db restore drill - FAIL`. `nb_soak.parse_drill` reads it as FAIL, so the soak's weekly
  block says *FAILED and no passing run* instead of *no drill report*. A PASS later in the same
  7-day block clears the week;
- alerts through the soak's own channel, `nb_soak.send`: the Discord webhook in
  `NB_SOAK_DISCORD_WEBHOOK`, or the desktop balloon when that is blank. A failed send is written
  to the log as `ALERT NOT sent: ...`;
- exits **4**. The drill never returns 4, so the run log and the task's *Last Result* can tell a
  pre-flight abort apart from a drill verdict.

`tests/test_restore_drill_wrapper.py` covers this with 12 tests. All checkouts are temp git
repos with a stub drill, and the real `notebook-soak-ref` is never touched. The tests run the
real `.cmd` via `cmd /c` with `RD_REPO` pointed at a missing temp path and assert exit 4, a FAIL
report, and that the stub drill never ran. A control on a good checkout asserts the stub runs and
its exit code passes through. Mutation proof: removing the wrapper's abort and its `cd` check
(the old behaviour) turns both abort tests red. The `.cmd` is pinned CRLF in `.gitattributes`,
because `cmd.exe` mis-parses labels in an LF-only batch file.

## 3. Why `notebook-soak-ref` vanishes (task 2)

Both disappearances come from disk-cleanup sweeps run by other Claude sessions. Each one picked
worktrees that were clean, fully pushed and idle, which describes a reference checkout exactly.
Neither sweep read `.uct-session-owner`. Both would have skipped a **locked** worktree.

| | 1st, found 2026-10-01 | 2nd, found 2026-10-04 |
|---|---|---|
| When | 2026-09-29 ~14:12 CDT | 2026-10-02 ~23:31-23:52 CDT |
| Who | session `86ee0df3` (Pine programme), disk-full cleanup | session `0456c851` (`uct-growth` ops), "Batch 2" disk cleanup |
| Evidence | `<scratchpad 86ee0df3>\worktrees-safe-to-remove.txt` line 163: `C:/Users/Patrick/uct-worktrees/notebook-soak-ref\|notebook-soak-ref`. Removed by `wt_cleanup.py` (`git worktree remove --force`, every clean listed path), written 2026-09-29T19:12:57Z | `C:\Users\Patrick\uct-growth\ops\disk-cleanup-2.sh:19` `git -C .../uct-dashboard worktree remove ".../notebook-soak-ref"`. `disk-cleanup-2.log:15` `removed (781 MB): .../notebook-soak-ref` |
| Classifier | "safe-to-remove" = clean + merged, made during the 09-29 disk-full | `ops/disk_worktree_audit.py`: **REMOVE** = clean, nothing unpushed, **not locked**, idle > 1 day. `disk-worktree-audit.tsv:108` `uct-dashboard REMOVE 1.5 0 0 0 - 781 ...notebook-soak-ref` |

Corroborating evidence:

- A transcript `git worktree list` showed the checkout at 2026-10-02 00:57Z
  (`87df77c43b [notebook-soak-ref]`). An `ls` of `uct-worktrees` at 2026-10-03 05:23Z no longer
  showed it, and neither did `notebook-k`, `notebook-s` or `notebook-q2a`, the neighbouring rows
  in the same batch script.
- Both times the directory **and** its git registration were gone. That fits `git worktree remove`.
  It does not fit a bare delete, a temp or Storage Sense cleanup, or `git worktree prune`. Prune
  only drops the registration of a directory that is already missing, and the prune on 10-01
  14:58Z printed nothing.
- The 2026-10-01 re-creation was found missing again on 10-04, before the drill. The 10-01 session
  could not establish when it vanished. The audit TSV pins the second removal to 10-02 night.

Ruled out: Windows temp and disk cleanup (the path is not under `%TEMP%` and the git metadata was
removed cleanly), `git gc` auto-prune (it needs the directory to be gone first), and tools in this
repo (`git grep` for `worktree remove`, `prune` and `_throwaway` in `tools/` and `scripts/` finds
no sweep that targets `uct-worktrees`). The three scheduled tasks that touch the soak
(`UCT-AuthDB-Restore-Drill`, `UCT-NB-Soak`, `UCT-WaveQ1-Observe`) only read it.

Secondary finding, fixed on this branch afterwards (see section 6): `nb_soak.py` checks the copies against the repo through
`NB_SOAK_REPO=...\notebook-soak-ref`. When that checkout is missing it reports `not in repo` and
`drift 0`, so the daily roll-up stayed quiet through both gaps (`nb_soak.run.log`, 10-01 to 10-04).

### Durable fix

A lock is the immediate fix. Both classifiers honour it: `disk_worktree_audit.py` returns KEEP
for a locked tree, and `git worktree remove` refuses a locked tree unless `-f` is given **twice**.
The 09-29 run used a single `--force`, which a lock blocks.

Longer term, keep the reference checkout out of `uct-worktrees\` and out of `git worktree` altogether, as a
standalone clone (for example `C:\Users\Patrick\uct-ops\soak-ref`). No `git worktree` command run
from any session can then remove it, and no sweep of `uct-worktrees\` will list it. The cost is a
second object store (~0.8 GB) and an explicit `fetch` to update it. The wrapper's `RD_REPO`
default and `nb_soak.cmd`'s `NB_SOAK_REPO` would both move to the new path in the same change.

## 4. The 13A walk's shutdown checkpoint (task 3)

`docs/notebook/wave13-13a.md` section 7: none of 13A's walks recorded a clean four-checkpoint
integrity. The tool already had a graceful-stop path. It uses `notebook_perf_harness.Sandbox.stop`,
which sends CTRL_BREAK and waits for the launcher's SHUTDOWN checkpoint. What failed was reaching
that checkpoint. From the three committed runs:

| walk | `stop` |
|---|---|
| `walk-58c60ce741` | `FORCED after 120 s without a graceful exit` |
| `walk-a267f70c6f` | `FORCED after 120 s without a graceful exit` |
| `walk-a78cee85cf` | `graceful to the shutdown checkpoint, then forced exit` (CLEAN, 4 checkpoints) |

The §7 text says `a78cee85cf` lacks a shutdown row, but its `walk.json` records the checkpoint.
The 13X walk uses the same `Sandbox` and the same stop, and reached the checkpoint on all six runs.
It differs in one way: it blanks provider keys for the sandbox. Both forced 13A launcher logs end
inside the logo prewarm, a 12-worker CDN pass over 3,640 symbols (`[logo-prewarm] 2500/3640`,
`2000/3640`).

Contained change, in `tools/notebook_w13a_plan_grade_walk.py` only:

- `SANDBOX_ENV`: `TICKER_LOGOS_PREWARM_DISABLED=1`, which is the prewarm's own read flag
  (`api/services/ticker_logos_prewarm.py::start_async`), plus blank `FMP_API_KEY`,
  `FINNHUB_API_KEY`, `ALPHAVANTAGE_API_KEY` and `MASSIVE_API_KEY`, as 13X does. It is applied
  before `sb.start()` and recorded in `walk.json` as `sandbox_env`. Nothing 13A measures reads a
  vendor or a logo.
- `--stop-grace-s` defaults to 300 s instead of the harness's 120 s, is passed to
  `sb.stop(grace_s=...)` and recorded as `stop_grace_s`. A run that still overruns is still
  recorded as FORCED.

`tests/test_w13a_walk_shutdown.py` checks that every name in `SANDBOX_ENV` has a real read site
in `api/`, so an invented flag fails, with a control showing the search can return no match. It
also checks that the grace value reaches `Sandbox.stop` and the env is applied before the sandbox
starts. **No live walk was run in this lane**, because it needs an `app/dist` build and a browser.
Whether this produces the checkpoint is therefore not measured yet. The next 13A walk is the test.

## 5. Owner commands (none were run by this lane)

**A. Lock the checkout now** (one line, safe while the drill is idle):

```powershell
git -C C:\Users\Patrick\uct-dashboard worktree lock --reason "UCT-AuthDB-Restore-Drill + nb_soak NB_SOAK_REPO reference checkout; never remove (wave14-ops.md)" C:\Users\Patrick\uct-worktrees\notebook-soak-ref
git -C C:\Users\Patrick\uct-dashboard worktree list --porcelain | Select-String -Context 0,3 "notebook-soak-ref"   # expect a 'locked' line
```

**B. Deploy the hardened wrapper.** The task already points at this path, so **no Task Scheduler
change is needed**:

> ✅ **DONE 2026-10-06, and the copy source below no longer exists.** The worktree
> `C:\Users\Patrick\uct-worktrees\notebook-w14-ops` named in the commands was removed after this
> section was written, so do not run them as written. The finish program's controller deployed
> both files on 2026-10-06 from the `notebook-fin-walk` checkout (the same two committed files):
> - `C:\Users\Patrick\uct-q1-observe\restore_drill_weekly.cmd`, git blob `d1da73c0b5030e10ecadfc4640b7a6533fc9eb02`;
> - `C:\Users\Patrick\uct-q1-observe\restore_drill_guard.py`, git blob `fa9366381a2cbad2728430e0b6246c33e6111925`;
> - the old wrapper is kept beside them as `restore_drill_weekly.cmd.bak-2026-10-06` (1,003 bytes,
>   dated 2026-09-26).
>
> Read back the same day by the rollback lane: `git hash-object` on the two deployed files prints
> exactly those two hashes, and the backup file is present. Reported by the controller and not
> re-run by that lane: the pre-flight against `notebook-soak-ref` passed, and step C's abort path
> exited 4. To deploy again, copy `tools\restore_drill_weekly.cmd` and `tools\restore_drill_guard.py`
> from any checked-out worktree of this branch (a working file, never `git show`: the blob is LF
> and `cmd.exe` mis-reads labels in an LF batch file) and confirm the two hashes with
> `git -C <worktree> hash-object tools/restore_drill_weekly.cmd tools/restore_drill_guard.py`.

```powershell
$o = 'C:\Users\Patrick\uct-q1-observe'
$w = 'C:\Users\Patrick\uct-worktrees\notebook-w14-ops\tools'
# ⚰️ history: run on 2026-10-06 from another checkout (see the note above); $w no longer exists
Copy-Item "$o\restore_drill_weekly.cmd" "$o\restore_drill_weekly.cmd.bak-2026-10-04"
Copy-Item "$w\restore_drill_weekly.cmd" "$o\restore_drill_weekly.cmd"
Copy-Item "$w\restore_drill_guard.py"   "$o\restore_drill_guard.py"
```

`nb_soak.py` (which the guard imports to send the alert) is already in `$o`.

**C. Dry-run the abort against a throwaway observe dir.** This never touches the real log, the
real `soak-drills` or the checkout:

```powershell
$t = Join-Path $env:TEMP 'rd-dryrun'; New-Item -ItemType Directory -Force $t | Out-Null
$env:RD_OBSERVE = $t; $env:RD_REPO = 'C:\does-not-exist'; $env:RD_NO_ALERT = '1'
& C:\Users\Patrick\uct-q1-observe\restore_drill_weekly.cmd; $code = $LASTEXITCODE
Remove-Item Env:RD_OBSERVE, Env:RD_REPO, Env:RD_NO_ALERT
"exit $code (expect 4)"; Get-Content "$t\restore_drill.run.log"
```

**D. Optional: give the task a Start In.** This is belt-and-braces, because the new wrapper
already `cd`s first:

```powershell
schtasks /change /tn "UCT-AuthDB-Restore-Drill" /tr "C:\Users\Patrick\uct-q1-observe\restore_drill_weekly.cmd"
```

`schtasks /change` cannot set a working directory. To set one, use Task Scheduler,
Actions, *Start in*: `C:\Users\Patrick\uct-q1-observe`. Doing nothing here is acceptable.

**E. Later: the standalone reference clone** (section 3). Do it on a quiet Sunday afternoon, after
the drill:

```powershell
git clone https://github.com/unchartedterritory5995-cyber/UCT-Dashboard.git C:\Users\Patrick\uct-ops\soak-ref
git -C C:\Users\Patrick\uct-ops\soak-ref checkout --detach origin/master
# then point RD_REPO's default (restore_drill_weekly.cmd) and NB_SOAK_REPO (nb_soak.cmd) at it,
# and refresh it with: git -C C:\Users\Patrick\uct-ops\soak-ref fetch -q origin; git -C ... checkout --detach origin/master
```

The URL is `origin` as of 2026-10-04; re-check it with `git -C C:\Users\Patrick\uct-dashboard remote get-url origin`.

## 6. `nb_soak` now pages on a missing reference checkout

`tools/nb_soak.py::reference_problem` checks `NB_SOAK_REPO` before the copies are compared. A
missing directory, a plain directory, a directory inside some other checkout, or git failing to
run is reported, not passed. The alert key is `reference:checkout` and it goes through the same
`alerts()` -> `due()` -> `send()` path as DRIFT, once per ET day. When this fires, the stdout
line reads `drift ?` instead of `drift 0`, and the dashboard says the copies were NOT compared.
As with DRIFT, this is an alert and not a verdict condition. A standalone clone passes the
check, so the section 3 move needs no change here. An unset `NB_SOAK_REPO` still means "not
checked" and does not page. Rails are in `tests/test_nb_soak.py`: missing, not-a-checkout, inside
another checkout, a healthy-checkout control, and the alert built from the facts. The `_tree`
fixture is now a real `git init` checkout. Takes effect after the copy in `uct-q1-observe` is refreshed.
