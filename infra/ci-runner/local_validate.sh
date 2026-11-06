#!/bin/bash
# Runs the offline-runner validation in the distro: every suite in its own fresh container, at most
# SLOTS at once, through launcher.py's real flags. Nothing registers a runner.
#   usage: local_validate.sh <image> <results-dir> [suite-spec ...]
set -uo pipefail
IMG=$1; OUT=$2; shift 2
KIT=/srv/uct/kit; SRC=/srv/uct/src; SLOTS=${SLOTS:-2}; CPUS=${CPUS:-4}; MEM=${MEM:-10}
mkdir -p "$OUT"
one() {
  spec=$1; suite=${spec%:*}; arg=""; if [ "$spec" != "$suite" ]; then arg=${spec#*:}; fi
  d="$OUT/$suite$arg"; mkdir -p "$d"
  s=$(date +%s)
  tar -C "$SRC" -cf - . | python3 "$KIT/launcher.py" local --image "$IMG" --cpus "$CPUS" --memory-gib "$MEM" \
    --name "uct-ci-v-$suite$arg-$$" -- bash -c "$(cat "$KIT/suite_in_container.sh")" _ "$suite" $arg 2> "$d/stderr.log" | tar xf - -C "$d"
  rc=${PIPESTATUS[1]}
  echo "$spec rc=$rc wall=$(( $(date +%s) - s ))s" | tee -a "$OUT/index.txt"
}
for spec in "$@"; do
  while [ "$(jobs -rp | wc -l)" -ge "$SLOTS" ]; do wait -n; done
  one "$spec" &
done
wait
echo "left-behind containers: $(docker ps -aq --filter label=uct.ci=1 | wc -l)" | tee -a "$OUT/index.txt"
echo VALIDATE-DONE | tee -a "$OUT/index.txt"
