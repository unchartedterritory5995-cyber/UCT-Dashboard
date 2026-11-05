#!/usr/bin/env bash
# Portable paths (override per machine):
UCT_WORKTREES=${UCT_WORKTREES:-/c/Users/Patrick/uct-worktrees}
UCT_RESUME=${UCT_RESUME:-$UCT_WORKTREES/_resume-2026-11-01}
HEAVY_LOCK=${HEAVY_LOCK:-C:/Users/Patrick/uct-clips/tools/heavy_lock.py}
# usage (under ONE heavy-lock hold): measure-pair.sh <outdir> <tipName>:<tipWorktree> <baseName>:<baseWorktree> [runtime_on 0|1] [census 0|1]
# Per side: C18 corpus audit, C18 constructed probes, reviewer probes1-6 (if REV_DIR set), runtime/production census (optional), vendor harness.
# BASE CACHE (OPS-SPEED.md): the BASE side (2nd pair) is reused when its key matches: base SHA + runtime lane + census flag +
#   the sha256 of every measuring input copied in + node version. Cache: $UCT_RESUME/mp-cache/<key>/. MP_CACHE=0 disables.
#   Any doubt (output-changing env var set, dirty or untracked-file base tree, changed node_modules lock, unreadable input, incomplete entry) = miss. A miss runs as before and fills the cache.
# BASE_HEAD lines are printed before and after each side; a moved HEAD fails the script (rc 4).
set -u
O=$1; shift; RT=${3:-1}; CEN=${4:-1}
R=$UCT_RESUME; A=${AUDIT_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../audit" && pwd)}; mkdir -p $O
CACHE_ROOT=$R/mp-cache
head_of() { git -C "$1" rev-parse HEAD; }
sha_of() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }

run_side() { # n W
  local n=$1 W=$2 T=$2/app/src/components/chart/engine/__tests__ flag pf
  cp ${AUDIT_FILE:-$A/zzAuditC18.measure.test.js} $T/zzMPAudit.measure.test.js; cp $A/zzAuditC18Probe.measure.test.js $T/zzMPProbe.measure.test.js
  [ -n "${REV_DIR:-}" ] && cp $REV_DIR/zzRevWsa3.measure.test.js $T/zzMPRev.measure.test.js
  cd $W/app
  AUDIT_C18_OUT=$O/out-$n.json node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/zzMPAudit.measure.test.js > $O/log-$n.txt 2>&1; echo "audit $n rc=$?"
  AUDIT_C18_PROBE_OUT=$O/probe-$n.json node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/zzMPProbe.measure.test.js > $O/plog-$n.txt 2>&1; echo "probe $n rc=$?"
  if [ -n "${REV_DIR:-}" ]; then for pf in probes probes2 probes3 probes4 probes5 probes6; do
    REV_PROBES=$REV_DIR/$pf.json REV_OUT=$O/rev-$n-$pf.json node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/zzMPRev.measure.test.js > $O/rlog-$n-$pf.txt 2>&1; echo "rev $n $pf rc=$?"; done; fi
  rm -f $T/zzMPAudit.measure.test.js $T/zzMPProbe.measure.test.js $T/zzMPRev.measure.test.js
  if [ "$CEN" = 1 ]; then
    mkdir -p $O/$n/census; cp -r $R/pine-sample/. $O/$n/census/
    flag=""; [ "$RT" = 1 ] && flag=--runtime-on
    cd $W && python tools/pine_coverage/run_census.py $flag --cache $O/$n/census --ref $R/runs/C/ref_rebuilt.json > $O/$n/census.log 2>&1; echo "census $n rc=$?"; tail -2 $O/$n/census.log
  fi
  cd $W/app && VENDOR_HARNESS_RUNTIME_ON=$RT VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/harness-$n node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js > $O/hlog-$n.txt 2>&1; echo "harness $n rc=$?"; grep -a -E "^TOTAL" $O/hlog-$n.txt
}

# Files this side produces under $O (relative names), for cache store/restore.
side_files() { # n
  local n=$1 pf
  echo "out-$n.json log-$n.txt probe-$n.json plog-$n.txt harness-$n hlog-$n.txt"
  [ "$CEN" = 1 ] && echo "$n"
  if [ -n "${REV_DIR:-}" ]; then for pf in probes probes2 probes3 probes4 probes5 probes6; do echo "rev-$n-$pf.json rlog-$n-$pf.txt"; done; fi
}

# Env vars that change what the measuring tools write (grepped from audit/zz*.js, run_census.py, vendorHarness/*.js and the
# engine's import.meta.env / process.env reads; the list is in OPS-SPEED.md). ANY of them set (even empty) = no cache.
# Extend per machine with MP_CACHE_EXTRA_ENV (an extended regex). Script-own vars (AUDIT_SRC, AUDIT_FILE, REV_DIR) are keyed instead.
MP_ENV_RE='^(AUDIT_C18_|VENDOR_|VITE_|PINE_|RUNTIME_|OOS_|COVERAGE_|RT[0-9]|UIE_|RF_|F4_|O1_|B1_|CAP3_|CAPABILITY_|TS_CORPUS|VAR_|BOOL_|HISTORY_|EXECUTION_|FORMULA_|MULTI_|PARAM_|PERIOD_|SESSION_|SCREENER_|P3_|H1_|C46_|BAR_INDEX|NODE_OPTIONS=|NODE_ENV=|MODE=|GUARD=|REV_PROBES|REV_OUT'"${MP_CACHE_EXTRA_ENV:+|$MP_CACHE_EXTRA_ENV}"')'

# Prints the cache key, or nothing (= miss) on any doubt. Reasons go to stderr.
cache_key() { # n W
  local n=$1 W=$2 sha parts f s why
  why() { echo "cache: no key ($1)" >&2; }
  local ev; ev=$(env | grep -E "$MP_ENV_RE" | cut -d= -f1 | head -3 | tr '\n' ' ')
  [ -z "$ev" ] || { why "output-changing env set: $ev"; return 0; }
  # tracked changes, staged changes AND untracked files all refuse (the audit lists corpus/fixture directories)
  local dirty; dirty=$(git -C $W status --porcelain 2>/dev/null | grep -v -F '.uct-session-owner' | head -2 | tr '\n' ' ')
  [ -z "$dirty" ] || { why "base tree not clean: $dirty"; return 0; }
  local ign; ign=$(git -C $W ls-files -o -i --exclude-standard -- corpus tests/fixtures app/src 2>/dev/null | head -2 | tr '\n' ' ')
  [ -z "$ign" ] || { why "ignored files under corpus/fixtures/app/src: $ign"; return 0; }
  sha=$(head_of $W 2>/dev/null) || return 0; [ -n "$sha" ] || return 0
  parts="base=$sha|side=$n|rt=$RT|cen=$CEN|node=$(node -v 2>/dev/null)|rev=${REV_DIR:+1}"
  local files="${AUDIT_FILE:-$A/zzAuditC18.measure.test.js} $A/zzAuditC18Probe.measure.test.js $W/app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js"
  files="$files $W/app/node_modules/.package-lock.json $W/app/node_modules/vitest/package.json $W/app/package-lock.json"
  [ "$CEN" = 1 ] && files="$files $W/tools/pine_coverage/run_census.py $R/runs/C/ref_rebuilt.json"
  [ -n "${REV_DIR:-}" ] && files="$files $REV_DIR/zzRevWsa3.measure.test.js $REV_DIR/probes.json $REV_DIR/probes2.json $REV_DIR/probes3.json $REV_DIR/probes4.json $REV_DIR/probes5.json $REV_DIR/probes6.json"
  for f in $W/app/.env*; do [ -e "$f" ] && files="$files $f"; done  # vite reads these into import.meta.env
  for f in $files; do s=$(sha_of $f); [ -n "$s" ] || { why "unreadable input $f"; return 0; }; parts="$parts|$(basename $f)=$s"; done
  if [ "$CEN" = 1 ]; then # the licence-held sample: hash every file (5 MB), names included
    s=$(cd $R/pine-sample 2>/dev/null && find . -type f | sort | xargs sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1); [ -n "$s" ] || return 0; parts="$parts|sample=$s"
  fi
  echo "${sha:0:12}-rt$RT-cen$CEN-$n-$(printf '%s' "$parts" | sha256sum | cut -c1-16)"
}

side_clean() { # n : delete this side's outputs so anything found afterwards was written by THIS run
  local f; for f in $(side_files $1); do rm -rf "$O/$f"; done
}

cache_restore() { # key -> 0 on hit; verifies the sha256 manifest first
  local d=$CACHE_ROOT/$1 f
  [ -f "$d/COMPLETE" ] && [ -f "$d/MANIFEST" ] && [ -f "$d/RCS" ] || return 1
  for f in $(cat $d/FILES); do [ -e "$d/data/$f" ] || return 1; done
  (cd $d/data && sha256sum -c --quiet ../MANIFEST >/dev/null 2>&1) || { echo "cache: manifest check FAILED for $1, treating as miss" >&2; return 1; }
  [ "$(cd $d/data && find . -type f | wc -l)" = "$(wc -l < $d/MANIFEST)" ] || { echo "cache: unlisted files in $1, miss" >&2; return 1; }
  for f in $(cat $d/FILES); do rm -rf "$O/$f"; cp -r "$d/data/$f" "$O/$f" || return 1; done
  cat $d/RCS; return 0
}

cache_fill() { # key n : only a clean pass (every step rc=0, all steps present) with fresh outputs
  local d=$CACHE_ROOT/$1 t f want got bad; t=$d.tmp.$$
  want=3; [ "$CEN" = 1 ] && want=$((want+1)); [ -n "${REV_DIR:-}" ] && want=$((want+6))
  got=$(grep -c -E '^(audit|probe|rev|census|harness) .*rc=[0-9]+$' $SIDELOG)
  bad=$(grep -E '^(audit|probe|rev|census|harness) .*rc=[0-9]+$' $SIDELOG | grep -v -E 'rc=0$' | head -1)
  [ "$got" = "$want" ] && [ -z "$bad" ] || { echo "cache: not filling ($got/$want steps reported, failing: ${bad:-none})"; return 0; }
  rm -rf $t; mkdir -p $t/data || return 0
  side_files $2 | tr ' ' '\n' | grep -v '^$' > $t/FILES
  for f in $(cat $t/FILES); do [ -e "$O/$f" ] || { echo "cache: not filling, $f missing"; rm -rf $t; return 0; }; cp -r "$O/$f" "$t/data/$f" || { rm -rf $t; return 0; }; done
  (cd $t/data && find . -type f | sort | xargs sha256sum > ../MANIFEST) || { rm -rf $t; return 0; }
  cp $SIDELOG $t/RCS; date +%s > $t/COMPLETE; rm -rf $d; mv $t $d && echo "BASE CACHE FILLED $1"
}

# MP_SOURCE_ONLY=1 lets a self-test source the functions above without running any side.
if [ -n "${MP_SOURCE_ONLY:-}" ]; then return 0 2>/dev/null || exit 0; fi
idx=0
for pair in "$1" "$2"; do
  idx=$((idx+1)); n=${pair%%:*}; W=${pair#*:}
  H0=$(head_of $W); echo "BASE_HEAD $H0 $(date +%T) before $n"
  echo "== side $n $(git -C $W rev-parse --short=10 HEAD) $(date +%T)"
  key=""; [ $idx = 2 ] && [ "${MP_CACHE:-1}" != 0 ] && key=$(cache_key $n $W)
  if [ -n "$key" ] && cache_restore $key > ${O}/.cache-rcs.$$ ; then
    echo "BASE CACHE HIT $key"; cat ${O}/.cache-rcs.$$; rm -f ${O}/.cache-rcs.$$
  else
    rm -f ${O}/.cache-rcs.$$
    [ $idx = 2 ] && [ "${MP_CACHE:-1}" != 0 ] && echo "BASE CACHE MISS ${key:-(no key: doubt)}"
    SIDELOG=$O/.side-rcs.$n; [ $idx = 2 ] && side_clean $n; run_side $n $W 2>&1 | tee $SIDELOG
    [ "$(head_of $W)" = "$H0" ] && [ -n "$key" ] && [ -z "$(git -C $W status --porcelain | grep -v -F .uct-session-owner)" ] && cache_fill $key $n
    rm -f $SIDELOG
  fi
  H1=$(head_of $W); echo "BASE_HEAD $H1 $(date +%T) after $n"
  [ "$H1" = "$H0" ] || { echo "BASE_HEAD MOVED on $n: $H0 -> $H1"; MOVED=1; }
  git -C $W status --short | head -3
done
date +%T
if [ -n "${MOVED:-}" ]; then echo "MEASURE_FAILED base head moved"; exit 4; fi
echo MEASURE_DONE
