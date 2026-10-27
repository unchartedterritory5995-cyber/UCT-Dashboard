#!/bin/sh
cd <scratchpad>/rewalk-20261027091520-work/drv
export TEMP="$(cygpath -w <scratchpad>/rewalk-20261027091520-work/tmp)" TMP="$(cygpath -w <scratchpad>/rewalk-20261027091520-work/tmp)" PYTHONDONTWRITEBYTECODE=1 PYTHONIOENCODING=utf-8
exec python -u walk.py "$@"
