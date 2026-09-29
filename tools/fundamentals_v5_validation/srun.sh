#!/usr/bin/env bash
# usage: srun.sh <service> <dir> <name> <local_script.py> [args...]
# sha-verified upload to <dir>/<name>.py, then DETACHED run under PID 1's env (cwd = pinned code)
# log -> <dir>/<name>.log, exit -> <dir>/<name>.exit
set -u
svc="$1"; D="$2"; name="$3"; src="$4"; shift 4; args="$*"
SP=$(dirname "$0")
python -c "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())" "$src" || { echo "PARSE FAIL"; exit 1; }
bash "$SP/rput.sh" "$svc" "$D/$name.py" "$src" || exit 1
cd /c/Users/blake/projects/UCT-Dashboard || exit 1
runner="import os,subprocess,sys,time
D='$D'
env=dict(kv.split('=',1) for kv in open('/proc/1/environ','rb').read().decode('utf-8','replace').split(chr(0)) if '=' in kv)
env['PYTHONPATH']='/data/fundamentals_pit_v5/code/7dfda83de6a7'
if os.fork(): sys.exit(0)
os.setsid()
log=open(D+'/$name.log','ab')
rc=subprocess.call(['/opt/venv/bin/python',D+'/$name.py']+'$args'.split(),cwd='/data/fundamentals_pit_v5/code/7dfda83de6a7',env=env,stdout=log,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL)
open(D+'/$name.exit','w').write('%d %s\n'%(rc,time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())))"
rb=$(printf %s "$runner" | base64 -w0)
MSYS_NO_PATHCONV=1 timeout 60 railway ssh --service "$svc" "rm -f $D/$name.exit $D/$name.log; echo $rb | base64 -d | /opt/venv/bin/python && echo launched $name" 2>&1 | grep -v "Using SSH" | tail -1
