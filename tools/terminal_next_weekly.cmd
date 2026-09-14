@echo off
REM ===================================================================================
REM LAYER 2 - Terminal-Next weekly autonomous run. Saturdays 09:30 CT.
REM
REM THIS RUNNER REPORTS ON ITS OWN. The Discord post below is made by curl, from this
REM script, using a Windows-side environment variable. It does not depend on the claude
REM run succeeding, on that run having network egress, or on it being allowed to read
REM anything. The 2026-09-13 dry run stopped at section 1, reached NOBODY, and recorded
REM exit=0 - that is F-L2-1, and this file is the fix.
REM
REM Log rotation is MONTHLY by filename: logs\terminal-next-weekly\YYYY-MM.log (append).
REM One file a month, never deleted by this script - a rotation that deletes is a
REM rotation that can delete the evidence of the run that failed.
REM
REM EXIT CODES (Task Scheduler's Last Result):
REM   0  RAN, or STOPPED-NOTHING-READY   the two outcomes that are genuinely fine
REM   1  the prompt file is missing
REM   2  UCT_TERMINAL_NEXT_WEBHOOK is not set - this run could not have reported
REM   3  STOPPED-ENV       an environment check failed; nothing was attempted
REM   4  STOPPED-ERROR     it tried and something broke
REM   5  NO STATUS LINE    the silent-failure case; never 0
REM ===================================================================================

setlocal
set "REPO=C:\Users\Patrick\uct-worktrees\s7-price-level"
set "DOCS=C:\Users\Patrick\uct-worktrees\terminal-research"
set "PROMPT=%DOCS%\docs\terminal-research\00-program-control\WEEKLY_AUTONOMOUS_PROMPT.md"
set "PROFILE=%REPO%\.claude\weekly-autonomous.settings.json"
set "LOGDIR=%REPO%\logs\terminal-next-weekly"
REM TEST HOOK: fixture runs redirect the log so they never pollute the real record.
if defined UCT_WEEKLY_LOGDIR set "LOGDIR=%UCT_WEEKLY_LOGDIR%"

for /f "tokens=1-2 delims=-" %%a in ("%DATE:~10,4%-%DATE:~4,2%") do set "YM=%%a-%%b"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\%YM%.log"
set "REPORT=%LOGDIR%\last-report.txt"
set "STATUSTMP=%LOGDIR%\last-status.txt"

echo. >> "%LOG%"
echo ==================================================================== >> "%LOG%"
echo RUN START %DATE% %TIME% >> "%LOG%"
echo ==================================================================== >> "%LOG%"

REM --- 0. The reporter must exist BEFORE anything else, or this run is deaf ----------
if "%UCT_TERMINAL_NEXT_WEBHOOK%"=="" (
  echo FATAL: UCT_TERMINAL_NEXT_WEBHOOK is not set. >> "%LOG%"
  echo This run cannot report its own outcome, so it does not start one. >> "%LOG%"
  echo Set it once:  setx UCT_TERMINAL_NEXT_WEBHOOK "https://discord.com/api/webhooks/..." >> "%LOG%"
  echo RUN END %DATE% %TIME% exit=2 >> "%LOG%"
  exit /b 2
)

if not exist "%PROMPT%" (
  echo PROMPT FILE MISSING: %PROMPT% >> "%LOG%"
  echo A missing prompt is a STOP, never a free-form run. >> "%LOG%"
  set "STATUS=PROMPT-MISSING"
  set "RC=1"
  goto :report
)

REM --- 1. The run itself, in a child with the webhook cleared ------------------------
cd /d "%REPO%"
if defined UCT_WEEKLY_FIXTURE_REPORT (
  REM TEST HOOK: use a fixture report instead of invoking claude. Never set in production.
  copy /y "%UCT_WEEKLY_FIXTURE_REPORT%" "%REPORT%" >nul
) else (
  REM cmd /c eats the outer quote pair when the command AND its arguments are
  REM quoted, so the whole thing is wrapped in one more pair. Without it:
  REM "The filename, directory name, or volume label syntax is incorrect."
  cmd /c ""%REPO%\tools\weekly_claude_child.cmd" "%PROMPT%" "%PROFILE%" "%DOCS%"" > "%REPORT%" 2>&1
)

type "%REPORT%" >> "%LOG%"

REM --- 2. F-L2-1: an exit code that means something ----------------------------------
python "%REPO%\tools\weekly_status.py" --log "%REPORT%" > "%STATUSTMP%" 2>> "%LOG%"
set "RC=%ERRORLEVEL%"
set "STATUS=NO-STATUS"
if exist "%STATUSTMP%" set /p STATUS=<"%STATUSTMP%"

:report
REM --- 3. Report, whatever happened above -------------------------------------------
set "LOGJ=%LOG:\=/%"
set "PAYLOAD=%LOGDIR%\last-post.json"
> "%PAYLOAD%" echo {"content":"**Terminal-Next weekly run** | `STATUS: %STATUS%` | exit `%RC%` | %DATE% %TIME%\nlog: `%LOGJ%`"}

if defined UCT_WEEKLY_NO_POST (
  echo [post skipped: UCT_WEEKLY_NO_POST] >> "%LOG%"
) else (
  REM Cloudflare 1010-blocks default agents, so the UA is load-bearing.
  curl -sS -X POST -H "Content-Type: application/json" -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) terminal-next-weekly" --data-binary "@%PAYLOAD%" "%UCT_TERMINAL_NEXT_WEBHOOK%" >> "%LOG%" 2>&1
  echo. >> "%LOG%"
)

echo RUN END %DATE% %TIME% status=%STATUS% exit=%RC% >> "%LOG%"
exit /b %RC%
