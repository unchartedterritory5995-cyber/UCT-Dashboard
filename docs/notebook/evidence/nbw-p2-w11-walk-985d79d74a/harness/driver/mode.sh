# source after env-*.sh:  runmode <bootname> <port> <steps> <vps> [extra walk.py args]
runmode() {
  local name=$1 port=$2 steps=$3 vps=$4; shift 4
  local S=/c/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/5effcdc4-7e7d-42f4-a3df-67b99c63791b/scratchpad
  export WALK_PID=$(python -c "import sys;print(open(sys.argv[1],encoding='utf-8-sig').read().split()[0])" "$(cygpath -w $S/sbx/pids/$name.pid)")
  export WALK_INSTANT=$(python -c "import json,urllib.request;print(json.loads(urllib.request.urlopen('http://127.0.0.1:$port/__uct_sandbox_identity').read())['clock_shift']['instant'])")
  export WALK_BOOTLOG=$(python -c "import sys;d=sys.argv[1];n=sys.argv[2];print(d+'\\\\'+n+'.out.log;'+d+'\\\\'+n+'.err.log')" "$(cygpath -w $S/sbx/logs)" "$name")
  echo "[mode] $name pid=$WALK_PID instant=$WALK_INSTANT port=$port log=$WALK_BOOTLOG"
  ./run.sh --base http://127.0.0.1:$port --steps $steps --vp $vps "$@"
}
