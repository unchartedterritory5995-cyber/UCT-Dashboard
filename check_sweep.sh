#!/bin/sh
# Did tonight's implied_backfill_sweep write rows? Run from uct-dashboard.
CODE='
import sqlite3, os
db="/data/implied_moves.db"
c=sqlite3.connect(db)
tot=c.execute("SELECT COUNT(*) FROM implied_snapshots").fetchone()[0]
bf=c.execute("SELECT COUNT(*) FROM implied_snapshots WHERE source=?",("massive-backfill",)).fetchone()[0]
s3=c.execute("SELECT COUNT(*) FROM (SELECT sym FROM implied_snapshots GROUP BY sym HAVING COUNT(*)>=3)").fetchone()[0]
print(f"total rows      : {tot}")
print(f"backfilled      : {bf}")
print(f"symbols w/ 3+ Q : {s3}   <- RICH/CHEAP needs 3 paired quarters")
'
B64=$(printf '%s' "$CODE" | base64 -w0)
MSYS_NO_PATHCONV=1 railway ssh -s web echo "$B64" "|" base64 -d "|" /opt/venv/bin/python
