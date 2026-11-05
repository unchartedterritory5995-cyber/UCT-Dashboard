#!/bin/bash
cd /c/Users/pgosz/uct-worktrees/study-hve-overlay || exit 1
SP=/c/Users/pgosz/AppData/Local/Temp/claude/C--Users-pgosz/e53aca68-7b0c-4e23-87db-a74a97087865/scratchpad/local_study
export PUSH_SECRET=$(/c/Users/pgosz/uct-worktrees/study/.venv/Scripts/python.exe -c "import json;print(json.load(open(r'C:/Users/pgosz/AppData/Local/Temp/claude/C--Users-pgosz/e53aca68-7b0c-4e23-87db-a74a97087865/scratchpad/local_study/sandbox_env.json'))['PUSH_SECRET'])")
export STUDY_ENABLED=1
exec /c/Users/pgosz/uct-worktrees/study/.venv/Scripts/python.exe -X utf8 tools/local_backend_sandbox.py --port 8077 --email study-local@local.dev --log-level warning
