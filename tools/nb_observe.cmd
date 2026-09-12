@echo off
REM Wave Q1 observation sampler - registered with Task Scheduler, every 2 hours.
REM The rig profile is named ABSOLUTELY here: a scheduled task inherits no shell
REM environment, and a fresh profile is a SIGNED-OUT profile.
set UCT_Q1_RIG_PROFILE=C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome-profile-persistent
set PYTHONIOENCODING=utf-8
cd /d C:\Users\Patrick\uct-worktrees\notebook-flip
python tools\nb_observe.py >> "%TEMP%\nb_observe.log" 2>&1
