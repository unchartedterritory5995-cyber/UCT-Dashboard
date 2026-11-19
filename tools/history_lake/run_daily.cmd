@echo off
rem History lake daily refresh: the entry the Task Scheduler runs ("UCT History Lake Daily").
rem Copy this file to D:\uct-history\tools\run_daily.cmd. Each run exports tools/history_lake from
rem origin/master (never a worktree's checked-out branch) and runs daily.py from that copy.
rem Needs: DATA_SYNC_* in the user environment (R2 upload), Massive keys in uct-intelligence\.env.
setlocal
rem The main repository (its object store is shared by every worktree; a worktree can be removed).
set REPO=C:\Users\Patrick\uct-dashboard
set CODE=D:\uct-history\tools\lake-code
set ZIP=%TEMP%\uct-lake-code.zip
set LOG=D:\uct-history\daily.log
echo ==== %DATE% %TIME% >> "%LOG%"
git -C "%REPO%" fetch -q origin master >> "%LOG%" 2>&1 || exit /b 1
if exist "%ZIP%" del /q "%ZIP%"
git -C "%REPO%" archive --format=zip -o "%ZIP%" origin/master tools/history_lake >> "%LOG%" 2>&1 || exit /b 1
if exist "%CODE%" rmdir /s /q "%CODE%"
mkdir "%CODE%"
tar -xf "%ZIP%" -C "%CODE%" >> "%LOG%" 2>&1 || exit /b 1
python "%CODE%\tools\history_lake\daily.py" --root D:\uct-history --tree packs-7 --bucket uct-bars-snapshots --prefix hist/ >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
