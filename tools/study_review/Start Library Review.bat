@echo off
title Study Library Review - keep this window open
cd /d "%~dp0"
set "PY=C:\Users\pgosz\uct-worktrees\study\.venv\Scripts\python.exe"
set "REPO=C:\Users\pgosz\uct-worktrees\study-hve-overlay"
if not exist "%PY%" set "PY=python"
echo.
echo  Refreshing the question list from the latest library...
if exist data_new rmdir /s /q data_new
"%PY%" build_data.py "%REPO%" "%~dp0data_new" > build.log 2>&1
if not errorlevel 1 "%PY%" first_pass.py "%REPO%" "%~dp0data_new" >> build.log 2>&1
if errorlevel 1 (
  echo  Could not refresh the list, so the last saved list will be used. See build.log.
) else (
  if exist data rmdir /s /q data
  move /y data_new data >nul
)
echo.
"%PY%" server.py --home "%~dp0."
echo.
echo  The review program has stopped. Your work is saved in the verdicts folder.
pause
