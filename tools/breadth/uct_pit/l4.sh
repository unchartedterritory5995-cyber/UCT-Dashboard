#!/bin/bash
pkill -f harvest_pre.py; sleep 1
export $(tr '\0' '\n' < /proc/1/environ | grep -E '^LD_LIBRARY_PATH=' | head -1)
cd /app; export PYTHONPATH=/app MCAP_CACHE=/data/_audit/uct_pit/sec_cache SEC_MAX_RPS=8
setsid nohup nice -n 15 /opt/venv/bin/python /data/_audit/uct_pit/code/harvest_pre.py > /data/_audit/uct_pit/harvest_pre.out 2>&1 < /dev/null &
