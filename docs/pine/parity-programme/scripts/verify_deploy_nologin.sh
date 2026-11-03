#!/usr/bin/env bash
# Post-merge production check that needs NO account login (owner ruling 2026-11-02: the coordinator
# may not create or change passwords, so the signed-in smoke cannot be the gate on the laptop).
# usage: verify_deploy_nologin.sh <merge-sha> [baseline-errors-file]
#   1. waits until <merge-sha> is promoted to production and a SUCCESS web deploy contains it;
#   2. waits until /api/health uptime >= 745 s (settled, no restart loop);
#   3. scans the web service's recent log lines for new errors / tracebacks against the baseline
#      count taken before the merge (pass the file written by: verify_deploy_nologin.sh baseline);
#   4. loads public pages and the health endpoint and requires HTTP 200.
# Prints VERIFY PASS (no-login) or VERIFY FAIL <reason>.
UCT_WORKTREES=${UCT_WORKTREES:-/c/Users/Patrick/uct-worktrees}
W=$UCT_WORKTREES/_smoke-1031; cd "$W" || exit 9
PY=${UCT_PY:-python}
UA="Mozilla/5.0 (Windows NT 10.0)"
errcount() { timeout 90 railway logs --service web 2>/dev/null | tail -n 400 | grep -c -E 'Traceback|\bERROR\b|CRITICAL'; }
if [ "$1" = "baseline" ]; then n=$(errcount); echo "$n" > "${2:-/dev/stdout}"; echo "baseline errors in last 400 lines: $n"; exit 0; fi
SHA=$1; BASE_FILE=$2; t0=$(date +%s); lim=5400
until git fetch -q origin production 2>/dev/null; git merge-base --is-ancestor "$SHA" origin/production 2>/dev/null; do
  [ $(( $(date +%s)-t0 )) -gt $lim ] && { echo "VERIFY FAIL timeout waiting for promotion"; exit 3; }; sleep 30; done
echo "promoted $(date +%T) production=$(git rev-parse --short origin/production)"
dep=""
until [ -n "$dep" ]; do
  [ $(( $(date +%s)-t0 )) -gt $lim ] && { echo "VERIFY FAIL timeout waiting for deploy"; exit 4; }
  line=$(timeout 60 railway deployment list --service web --json 2>/dev/null | "$PY" -c "
import sys,json
d=json.load(sys.stdin)[:5]
sk=[x for x in d if x.get('status')=='SKIPPED' and (x.get('meta') or {}).get('commitHash','').startswith(sys.argv[1])]
if sk: print('SKIPPED', sk[0].get('createdAt')); raise SystemExit
for x in d:
    if x.get('status')=='SUCCESS': print((x.get('meta') or {}).get('commitHash',''), x.get('createdAt')); break" "$SHA" 2>/dev/null)
  h=${line%% *}
  if [ "$h" = "SKIPPED" ]; then dep="web deploy SKIPPED (no watched file changed; the running build is unchanged)"
  elif [ -n "$h" ] && git cat-file -e "$h" 2>/dev/null && git merge-base --is-ancestor "$SHA" "$h"; then dep=$line; else sleep 30; fi
done
echo "deployed $(date +%T) $dep"
up(){ curl -s -m 15 -A "$UA" https://uctintelligence.com/api/health | "$PY" -c "import sys,json;print(int(json.load(sys.stdin)['uptime_seconds']))" 2>/dev/null || echo -1; }
until [ "$(up)" -ge 745 ]; do [ $(( $(date +%s)-t0 )) -gt $lim ] && { echo "VERIFY FAIL never settled (uptime $(up))"; exit 5; }; sleep 20; done
echo "settled $(date +%T) uptime=$(up)"
fail=""
for p in / /morning-wire /api/health; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -A "$UA" "https://uctintelligence.com$p"); echo "GET $p -> $c"
  [ "$c" = "200" ] || fail="$fail $p=$c"
done
now=$(errcount); base=$( [ -n "$BASE_FILE" ] && cat "$BASE_FILE" 2>/dev/null || echo "")
echo "errors in last 400 log lines: now=$now baseline=${base:-none}"
if [ -n "$base" ] && [ "$now" -gt $(( base + 5 )) ]; then fail="$fail log-errors:$base->$now"; fi
[ -z "$fail" ] && echo "VERIFY PASS (no-login) $(date +%T)" || { echo "VERIFY FAIL$fail"; exit 6; }
