@echo off
REM Weekly auth.db backup restore drill (scorecard clause 7a; soak plan section 3).
REM Repo source of C:\Users\Patrick\uct-q1-observe\restore_drill_weekly.cmd (Task Scheduler
REM "UCT-AuthDB-Restore-Drill", Sundays 09:00). Deploy by COPYING this file and
REM tools\restore_drill_guard.py beside it; the guard must sit next to this wrapper so it still
REM runs when the checkout is gone. Wave 14 lane OPS, see docs\notebook\wave14-ops.md.
REM
REM Read-only drill: downloads the newest R2 backup into a temp dir and checks it; restores
REM nothing; refuses C:\data. R2 credentials come from the user environment (DATA_SYNC_*).
REM
REM FAILS LOUD AND SAFE. On 2026-10-04 the old wrapper's "cd /d" failed (the checkout had been
REM removed), it carried on from C:\Windows\System32, and the drill died with Errno 2 as
REM "DRILL exit=2" -- the same code as an honest INCONCLUSIVE. Now: a pre-flight checks the
REM checkout (exists, has the drill, is a checkout root, HEAD is on origin/master) BEFORE
REM anything runs, every step after it aborts on failure, and an abort writes a FAIL report
REM where nb_soak.py reads drills, alerts through the soak's channel, and exits 4.
REM
REM Overrides (tests only; the scheduled task sets none of them):
REM   RD_REPO RD_OBSERVE RD_PY RD_REF RD_NO_ALERT=1
setlocal
if not defined RD_REPO set "RD_REPO=C:\Users\Patrick\uct-worktrees\notebook-soak-ref"
if not defined RD_OBSERVE set "RD_OBSERVE=C:\Users\Patrick\uct-q1-observe"
if not defined RD_PY set "RD_PY=C:\Python314\python.exe"
if not defined RD_REF set "RD_REF=origin/master"
set "LOG=%RD_OBSERVE%\restore_drill.run.log"
set "DRILLS=%RD_OBSERVE%\soak-drills"
set "GUARD=%~dp0restore_drill_guard.py"
set PYTHONIOENCODING=utf-8
REM Start from a directory we chose, never the Task Scheduler default (System32).
cd /d "%RD_OBSERVE%" || (echo PREFLIGHT FAIL: observe dir %RD_OBSERVE% missing & exit /b 4)
echo ---- %DATE% %TIME% ---- >> "%LOG%"

if not exist "%RD_PY%" (
  echo PREFLIGHT FAIL: python not found at %RD_PY% -- the drill did NOT run >> "%LOG%"
  echo DRILL exit=4 >> "%LOG%"
  exit /b 4
)
if not exist "%GUARD%" (
  echo PREFLIGHT FAIL: guard not found at %GUARD% -- the drill did NOT run >> "%LOG%"
  echo DRILL exit=4 >> "%LOG%"
  exit /b 4
)

"%RD_PY%" "%GUARD%" --repo "%RD_REPO%" --ref "%RD_REF%" --drills "%DRILLS%" >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
if not "%RC%"=="0" goto :abort

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set D=%%i
if not defined D (
  "%RD_PY%" "%GUARD%" --repo "%RD_REPO%" --drills "%DRILLS%" --fail "could not read today's date" >> "%LOG%" 2>&1
  set RC=4
  goto :abort
)
cd /d "%RD_REPO%"
if errorlevel 1 (
  "%RD_PY%" "%GUARD%" --repo "%RD_REPO%" --drills "%DRILLS%" --fail "cd into %RD_REPO% failed after the pre-flight passed" >> "%LOG%" 2>&1
  set RC=4
  goto :abort
)
"%RD_PY%" tools\authdb_restore_drill.py --report "%DRILLS%\drill-%D%.md" >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
echo DRILL exit=%RC% >> "%LOG%"
exit /b %RC%

:abort
echo PREFLIGHT ABORT -- the drill did NOT run (guard exit %RC%) >> "%LOG%"
echo DRILL exit=4 >> "%LOG%"
exit /b 4
