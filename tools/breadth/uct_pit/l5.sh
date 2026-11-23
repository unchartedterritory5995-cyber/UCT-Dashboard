#!/bin/bash
export $(tr '\0' '\n' < /proc/1/environ | grep -E '^LD_LIBRARY_PATH=' | head -1)
cd /app; export PYTHONPATH=/app NO_TEXT_SHARES=${NO_TEXT_SHARES:-}
C=/data/_audit/uct_pit/code; O=/data/_audit/uct_pit
run() { setsid nohup nice -n 12 /opt/venv/bin/python $C/compute.py $1 $2 > $O/full_$1.out 2>&1 < /dev/null & }
run 2008-01-02 2012-12-31
run 2013-01-01 2017-12-31
run 2018-01-01 2022-12-31
run 2023-01-01 2026-11-20
