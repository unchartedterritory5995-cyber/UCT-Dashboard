#!/bin/sh
# usage: WALK_DATA=<dir> WALK_EVD=<dir> WALK_STATE=<file> ./run.sh --steps ... --vp ...
cd /c/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/5effcdc4-7e7d-42f4-a3df-67b99c63791b/scratchpad/w2
export TEMP="$(cygpath -w ../tmp-walk2)" TMP="$(cygpath -w ../tmp-walk2)" PYTHONDONTWRITEBYTECODE=1 PYTHONIOENCODING=utf-8
exec python -u walk.py "$@"
