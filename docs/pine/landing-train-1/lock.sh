#!/bin/bash
# usage: lock.sh LABEL TIMEOUT OUTDIR SHARDFILE [inlock args...]
L=$1; T=$2; O=$3; F=$4; shift 4
python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --timeout $T --label train1-$L run -- python C:/Users/Patrick/AppData/Local/Temp/claude/6c61ec7db4c79b74/07178e6c-7af0-41a1-b915-7a5db939d0d5/scratchpad/TRAIN1/inlock.py "$O" "$F" "$@" > "$O.lock.log" 2>&1
echo "lock-rc=$?" >> "$O.lock.log"
