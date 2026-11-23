#!/bin/bash
export $(tr '\0' '\n' < /proc/1/environ | grep -E '^LD_LIBRARY_PATH=' | head -1)
cd /app; export PYTHONPATH=/app MCAP_CACHE=/data/_audit/uct_pit/sec_cache
C=/data/_audit/uct_pit/code; O=/data/_audit/uct_pit
LEDGER=/data/breadth_v2_producer/vintages/p202611202129/pit_uct_ledger.json setsid nohup nice -n 12 /opt/venv/bin/python $C/compute.py 2026-03-23 2026-11-20 > $O/val_ledger.out 2>&1 < /dev/null &
setsid nohup nice -n 12 /opt/venv/bin/python $C/compute.py 2026-03-23 2026-11-20 > $O/val_rebuilt.out 2>&1 < /dev/null &
