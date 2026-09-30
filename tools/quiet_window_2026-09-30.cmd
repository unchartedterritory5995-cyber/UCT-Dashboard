@echo off
rem TERM-007 quiet window 2026-09-30 09:30-10:30 ET (owner ruling 2026-09-29). One-shot.
cd /d C:\Users\Patrick\uct-worktrees\_merge-master
python tools\quiet_window_sampler.py --out docs\terminal-research\10-roadmap\evidence\2026-09-30-quiet-window --start 13:25 --end 14:35 > docs\terminal-research\10-roadmap\evidence\2026-09-30-quiet-window-run.log 2>&1
