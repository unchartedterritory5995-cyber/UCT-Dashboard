#!/usr/bin/env bash
# Step 3 in `--real` mode. ⛔ AFTER 16:00 ET ONLY — it drives the shared chart-renderer.
#
#   bash docs/discord-render/instruments/step3_real.sh [--deliver-channel <id>]
#
# ⛔⛔ EVERY RUN'S EXIT CODE IS CAPTURED AND PRINTED, AND THE SCRIPT DOES NOT STOP ON A FAILURE.
# A load run that misses an SLO is a RESULT, not a reason to abandon the other three — and a
# `set -e` here would make one miss look like the rest never happened. The verdicts are collected
# and reprinted at the end so nothing is read off scrollback.
#
# ⛔ NO PIPE TO `tail` ANYWHERE. `cmd | tail` reports tail's exit code; this project has banked a
# killed run as green that way. Output goes to a file and the file is read afterwards.
#
# ⛔ `RENDER_CACHE_ENABLED=1` so the cache hit rate is measurable — the harness sandboxes
# `DISCORD_RENDER_CACHE_DIR` into a temp directory, so nothing touches the production volume.
set -u
cd "$(dirname "$0")/../../.." || exit 2

E=docs/discord-render/evidence/step3
L=/tmp/step3-real
mkdir -p "$E" "$L"
export RENDER_CACHE_ENABLED=1
export PYTHONIOENCODING=utf-8

DELIVER=""
[ "${1:-}" = "--deliver-channel" ] && DELIVER="--deliver-channel ${2:-}"
[ -n "$DELIVER" ] && echo "delivery: a REAL Discord channel — ${2:-}" || \
  echo "delivery: NONE (no channel). The wire hop is NOT measured; everything up to it is."

T="NVDA,AMD,SPY,AAPL,TSLA,QQQ,MSFT,META,AMZN,GOOGL,NFLX,AVGO,SMH,IWM,COIN,PLTR,MU,CRWD,SNOW,ORCL"
declare -A RC

run () {                      # run <name> <logfile> <command...>
  local name="$1" log="$2"; shift 2
  echo "=== $name"
  "$@" > "$log" 2>&1
  RC["$name"]=$?
  # ⛔ A RUN WITH NO TOTALS LINE IS NOT A RUN, whatever the exit code says.
  if ! grep -q "TOTALS" "$log"; then
    echo "    ⛔ NO TOTALS LINE — this did not run. See $log"
    RC["$name"]=99
  else
    grep -E "TOTALS|S2 end-to-end|success |CLOCK-DEPENDENT" "$log" | sed 's/^/    /'
  fi
}

run "3.1a real 30 concurrent x 20 symbols" "$L/load-a.log" \
  python -u docs/discord-render/instruments/load_harness.py --real \
  --concurrency 30 --seconds 20 --members 30 --tickers "$T" --drain-s 180 \
  --out "$E/load-real-a-concurrent30.json" $DELIVER

run "3.1b real 100 burst" "$L/load-b.log" \
  python -u docs/discord-render/instruments/load_harness.py --real \
  --arrival-rate 100 --seconds 1 --members 30 --tickers "$T" --min-samples 20 --drain-s 240 \
  --out "$E/load-real-b-burst100.json" $DELIVER

run "3.1c real 1/s x 10 min" "$L/load-c.log" \
  python -u docs/discord-render/instruments/load_harness.py --real \
  --arrival-rate 1 --seconds 600 --members 20 --tickers "$T" --drain-s 120 \
  --out "$E/load-real-c-sustained.json" $DELIVER

run "3.2 chaos --real" "$L/chaos.log" \
  python -u docs/discord-render/instruments/chaos_scenarios.py --real \
  --out "$E/chaos-real.json"

run "3.3 determinism x20 (incl. L1->L2)" "$L/det.log" \
  python -u docs/discord-render/instruments/determinism_runner.py --runs 20 --gap 0.15 \
  --out "$E/determinism-real-20runs.json"

echo
echo "================ VERDICTS"
fail=0
for k in "${!RC[@]}"; do
  case "${RC[$k]}" in
    0) v="PASS" ;;
    1) v="FAIL"; fail=1 ;;
    2) v="INCONCLUSIVE"; fail=1 ;;
    99) v="DID NOT RUN"; fail=1 ;;
    *) v="EXIT ${RC[$k]}"; fail=1 ;;
  esac
  printf '  %-42s %s\n' "$k" "$v"
done
echo "  organic members exposed to V2: 0"
echo "================ logs in $L, evidence in $E"
exit $fail
