@echo off
REM LAYER 2 - the claude invocation, in a CHILD process so the webhook variable can be
REM cleared before the model ever exists. Clearing it in the parent would also blind the
REM curl that has to report the outcome, so the two must live in different processes.
REM
REM  %1 = prompt file    %2 = permissions profile
setlocal
set "UCT_TERMINAL_NEXT_WEBHOOK="
REM --add-dir is why the 2026-09-13 dry run could not read the docs worktree and
REM reported check 1 as HALF. claude -p only reaches its cwd without it.
type "%~1" | claude -p --settings "%~2" --add-dir "%~3" --permission-prompts none --output-format text
exit /b %ERRORLEVEL%
