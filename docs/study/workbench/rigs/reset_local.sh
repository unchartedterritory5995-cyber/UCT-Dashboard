#!/bin/bash
# Restart the sandboxed backend (fresh temp data dir), re-import the bank, approve everything, recreate the local admin.
SP=/c/Users/pgosz/AppData/Local/Temp/claude/C--Users-pgosz/e53aca68-7b0c-4e23-87db-a74a97087865/scratchpad/local_study
PY=/c/Users/pgosz/uct-worktrees/study/.venv/Scripts/python.exe
cd /c/Users/pgosz/uct-worktrees/study-hve-overlay || exit 1
for pid in $(netstat -ano | grep -E ":8077 .*LISTENING|:5231 .*LISTENING" | awk '{print $5}' | sort -u); do taskkill //PID $pid //F >/dev/null 2>&1; done
sleep 2
(nohup bash $SP/start_backend.sh > $SP/backend.log 2>&1 &)
for i in $(seq 1 40); do c=$(curl -s -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:8077/api/health); [ "$c" = "200" ] && break; sleep 5; done
echo "health $c"
export PUSH_SECRET=$($PY -c "import json;print(json.load(open(r'C:/Users/pgosz/AppData/Local/Temp/claude/C--Users-pgosz/e53aca68-7b0c-4e23-87db-a74a97087865/scratchpad/local_study/sandbox_env.json'))['PUSH_SECRET'])")
$PY -X utf8 $SP/load_bars_local.py >/dev/null; $PY -X utf8 scripts/study/import_bank.py --url http://127.0.0.1:8077/api/study/import 2>&1 | grep "TOTAL"
$PY -X utf8 - <<'PY'
import sqlite3, glob, json, urllib.request
best=None
for p in glob.glob(r"C:\Users\pgosz\AppData\Local\Temp\uct_tests_datadir_*\study.db"):
    try:
        c=sqlite3.connect(p); n=c.execute("select count(*) from study_items").fetchone()[0]
    except Exception: continue
    if n: c.execute("update study_items set review_status='approved' where review_status='draft'"); c.commit(); print("approved all in", p, n)
    c.close()
env=json.load(open(r"C:/Users/pgosz/AppData/Local/Temp/claude/C--Users-pgosz/e53aca68-7b0c-4e23-87db-a74a97087865/scratchpad/local_study/sandbox_env.json"))
req=urllib.request.Request("http://127.0.0.1:8077/api/auth/signup",data=json.dumps({"email":env["EMAIL"],"password":env["UCT_SANDBOX_PASSWORD"],"display_name":"Local reviewer"}).encode(),headers={"Content-Type":"application/json"},method="POST")
try: print("signup", urllib.request.urlopen(req,timeout=60).status)
except urllib.error.HTTPError as e: print("signup", e.code, e.read()[:120])
PY
