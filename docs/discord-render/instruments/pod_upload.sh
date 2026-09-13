#!/usr/bin/env bash
# Upload one local file into the web pod at $2 via railway ssh, gzip+base64 in chunks.
# Usage: pod_upload.sh <local file> <remote path>
set -u
SRC="$1"; DST="$2"
B64=$(gzip -9 -c "$SRC" | base64 -w0)
LEN=${#B64}
CH=6000
echo "upload $SRC -> $DST ($LEN b64 chars, $(( (LEN + CH - 1) / CH )) chunks)"
i=0; first=1
while [ $i -lt $LEN ]; do
  part=${B64:$i:$CH}
  if [ $first = 1 ]; then op=">"; first=0; else op=">>"; fi
  MSYS_NO_PATHCONV=1 railway ssh -s web echo "$part" "$op" "$DST.b64" >/dev/null 2>&1 || { echo "chunk at $i failed"; exit 1; }
  i=$((i + CH))
done
CMD=$(printf '%s' "base64 -d $DST.b64 | gunzip > $DST && rm $DST.b64 && sha256sum $DST" | base64 -w0)
MSYS_NO_PATHCONV=1 railway ssh -s web echo "$CMD" "|" base64 -d "|" sh 2>&1 | tail -2
echo "local: $(sha256sum "$SRC" | cut -c1-64)"
