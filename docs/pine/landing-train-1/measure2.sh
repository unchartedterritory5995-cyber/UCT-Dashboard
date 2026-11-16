#!/bin/bash
# usage: measure2.sh after|before   (one lock hold per step, 90 s after each release: lock.sh)
S=C:/Users/Patrick/AppData/Local/Temp/claude/6c61ec7db4c79b74/07178e6c-7af0-41a1-b915-7a5db939d0d5/scratchpad/TRAIN1
TAG=$1
mkdir -p $S/$TAG
for k in f0 f1 h0 h1 c0 c1; do bash $S/lock.sh m-$TAG-$k 43200 $S/$TAG/run-$k $S/m-$TAG-$k.shards --mw 1; done
echo DONE > $S/$TAG/DONE
