@echo off
REM Pine support loop, Phase B: the scheduled re-measure (docs/pine/support-loop/PHASE-B.md).
REM Runs from the MEASURING worktree (a clean, detached checkout kept only for this), moves it
REM to origin/master, re-runs the member-door census under heavy_lock and appends a dated row
REM to %SUPPORT_LOOP_DATA%\coverage-history. Writes nothing in the repo.
setlocal
set "MEASURE=%~dp0..\.."
if "%SUPPORT_LOOP_DATA%"=="" set "SUPPORT_LOOP_DATA=%LOCALAPPDATA%\uct-support-loop"
if "%PY%"=="" set "PY=C:\Python314\python.exe"
echo ---- %date% %time% ----
"%PY%" C:\Users\Patrick\uct-clips\tools\heavy_lock.py run --label pine-remeasure -- "%PY%" "%MEASURE%\tools\support_loop\remeasure.py" --repo "%MEASURE%" --sync-master --cache "%SUPPORT_LOOP_DATA%\pine-sample" --ref "%SUPPORT_LOOP_DATA%\ref\pine_v6_reference.json" --history "%SUPPORT_LOOP_DATA%\coverage-history"
exit /b %ERRORLEVEL%
