@echo off
REM LAYER 2 — Terminal-Next weekly autonomous run. Saturdays 09:30 CT.
REM Launched by Task Scheduler; the PROMPT FILE is the whole instruction.
REM
REM Log rotation is MONTHLY by filename: logs\terminal-next-weekly\YYYY-MM.log
REM (append). One file a month, never deleted by this script -- a rotation that
REM deletes is a rotation that can delete the evidence of the run that failed.

setlocal
set REPO=C:\Users\Patrick\uct-worktrees\s7-price-level
set DOCS=C:\Users\Patrick\uct-worktrees\terminal-research
set PROMPT=%DOCS%\docs\terminal-research\00-program-control\WEEKLY_AUTONOMOUS_PROMPT.md
set LOGDIR=%REPO%\logs\terminal-next-weekly

for /f "tokens=1-2 delims=-" %%a in ("%DATE:~10,4%-%DATE:~4,2%") do set YM=%%a-%%b
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOG=%LOGDIR%\%YM%.log

echo. >> "%LOG%"
echo ==================================================================== >> "%LOG%"
echo RUN START %DATE% %TIME% >> "%LOG%"
echo ==================================================================== >> "%LOG%"

if not exist "%PROMPT%" (
  echo PROMPT FILE MISSING: %PROMPT% >> "%LOG%"
  echo A missing prompt is a STOP, never a free-form run. >> "%LOG%"
  exit /b 1
)

cd /d "%REPO%"
type "%PROMPT%" | claude -p >> "%LOG%" 2>&1
echo RUN END %DATE% %TIME% exit=%ERRORLEVEL% >> "%LOG%"
endlocal
