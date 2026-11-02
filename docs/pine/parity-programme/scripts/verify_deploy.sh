#!/usr/bin/env bash
# Portable paths (override per machine):
UCT_WORKTREES=${UCT_WORKTREES:-/c/Users/Patrick/uct-worktrees}
UCT_RESUME=${UCT_RESUME:-$UCT_WORKTREES/_resume-2026-11-01}
HEAVY_LOCK=${HEAVY_LOCK:-C:/Users/Patrick/uct-clips/tools/heavy_lock.py}
# usage: verify_deploy.sh <merge-sha>   -- waits for production promotion, Railway deploy of a descendant, settle, then smoke
SHA=$1; W=$UCT_WORKTREES/_smoke-1031; cd $W || exit 9
t0=$(date +%s); lim=5400
until git fetch -q origin production 2>/dev/null; git merge-base --is-ancestor $SHA origin/production 2>/dev/null; do
  [ $(( $(date +%s)-t0 )) -gt $lim ] && { echo "TIMEOUT waiting for promotion"; exit 3; }; sleep 30; done
echo "promoted $(date +%T) production=$(git rev-parse --short origin/production)"
dep=""
until [ -n "$dep" ]; do
  [ $(( $(date +%s)-t0 )) -gt $lim ] && { echo "TIMEOUT waiting for deploy"; exit 4; }
  line=$(timeout 60 railway deployment list --service web --json 2>/dev/null | python -c "
import sys,json
for x in json.load(sys.stdin)[:5]:
    if x.get('status')=='SUCCESS': print((x.get('meta') or {}).get('commitHash',''), x.get('createdAt')); break")
  h=${line%% *}; if [ -n "$h" ] && git cat-file -e $h 2>/dev/null && git merge-base --is-ancestor $SHA $h; then dep=$line; else sleep 30; fi
done
echo "deployed $(date +%T) $dep"
up(){ curl -s -m 15 -A "Mozilla/5.0 (Windows NT 10.0)" https://uctintelligence.com/api/health | python -c "import sys,json;print(int(json.load(sys.stdin)['uptime_seconds']))" 2>/dev/null || echo -1; }
until [ "$(up)" -ge 745 ]; do sleep 20; done; echo "settled $(date +%T) uptime=$(up)"
git checkout -q --detach origin/master && python tools/hub_nav_smoke.py --auth 2>&1 | tail -3
