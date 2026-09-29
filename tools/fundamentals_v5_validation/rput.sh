#!/usr/bin/env bash
# usage: rput.sh <service> <remote_path> <local_file>  -- chunked, sha256-verified upload over railway ssh
set -u
svc="$1"; dst="$2"; src="$3"
cd /c/Users/blake/projects/UCT-Dashboard || exit 1
b64=$(base64 -w0 "$src"); n=${#b64}; want=$(sha256sum "$src" | cut -c1-64)
MSYS_NO_PATHCONV=1 timeout 60 railway ssh --service "$svc" "mkdir -p \$(dirname $dst); : > $dst.b64" >/dev/null 2>&1
for ((o=0; o<n; o+=6000)); do
  chunk=${b64:o:6000}
  for try in 1 2 3 4 5; do
    MSYS_NO_PATHCONV=1 timeout 60 railway ssh --service "$svc" "L=\$(stat -c %s $dst.b64); [ \$L -eq $o ] && printf %s '$chunk' >> $dst.b64; true" >/dev/null 2>&1
    got=$(MSYS_NO_PATHCONV=1 timeout 60 railway ssh --service "$svc" "stat -c %s $dst.b64" 2>/dev/null | tr -dc '0-9')
    [ "$got" = "$(( o + ${#chunk} ))" ] && break
    sleep 2
  done
done
have=$(MSYS_NO_PATHCONV=1 timeout 60 railway ssh --service "$svc" "base64 -d $dst.b64 > $dst && rm -f $dst.b64 && sha256sum $dst | cut -c1-64" 2>/dev/null | tr -dc '0-9a-f')
[ "$have" = "$want" ] && echo "OK $dst $want" || { echo "HASH MISMATCH $dst ($have vs $want)"; exit 1; }
