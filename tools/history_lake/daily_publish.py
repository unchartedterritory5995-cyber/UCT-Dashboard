"""Step 5 of the deep daily rebuild (2026-11-18): publish the checked series the servers serve.

Uploads one gzipped series per ticker on the serve list to the bars bucket under `daily-rebuild/v<N>/`, then
the manifest LAST (the servers read only what the manifest names, so a half-finished upload is never served):

    daily-rebuild/v<N>/<SYM>.json.gz   {"sym", "end", "bars": [[ISO, o, h, l, c, v], ...]}
    daily-rebuild/manifest.json        {"version": N, "end": ISO, "built_at": ..., "symbols": [...]}

The serve list (`D:/uct-history/daily-v1/serve_list.json`) is every ticker whose rebuild agrees with an
independent vendor at least as well as the served series, changes a bar, and loses no more than a year of
depth (daily_check.py). `--stage test` names only `--test` in the manifest (the rest are uploaded, not served):
the rollout widens by publishing the manifest again, with no deploy.

  python tools/history_lake/daily_publish.py --version 1 --stage test --test ASB,BCPC,MNST,BALL
  python tools/history_lake/daily_publish.py --version 1 --stage all
Credentials: DATA_SYNC_* in the environment (the same as the history lake publish).
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.history_lake.publish import s3_client_from_env  # noqa: E402

PREFIX = "daily-rebuild/"


def payload_body(rec: dict) -> bytes:
    bars = rec["bars"]
    body = {"sym": rec["sym"], "end": bars[-1][0] if bars else None, "bars": bars}
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


def payload(rec: dict) -> bytes:
    return gzip.compress(payload_body(rec), 6)


def plan(prev: dict | None, version: int, names, hashes: dict) -> dict:
    """revs / retired / hashes for a manifest (U5): a ticker whose series bytes equal the previous manifest's keeps its
    rev (its file stays at v<rev>, its epoch does not move); new, re-listed, changed and newly retired tickers get
    `version`. Versions only rise. Derived from the previous manifest, never typed."""
    prev = prev or {}
    pv = int(prev.get("version") or 0)
    if version <= pv:
        raise SystemExit(f"refused: version {version} is not above the published v{pv} (versions only rise)")
    names = sorted({str(s).upper() for s in names})
    p_syms = {str(s).upper() for s in (prev.get("symbols") or ())}
    p_ret = {str(s).upper() for s in (prev.get("retired") or ())}
    p_revs = {str(k).upper(): int(v) for k, v in (prev.get("revs") or {}).items()}
    p_hash = prev.get("hashes") or {}
    retired = sorted((p_syms | p_ret) - set(names))
    revs = {}
    for s in names:
        same = s in p_syms and hashes.get(s) is not None and hashes.get(s) == p_hash.get(s)
        revs[s] = int(p_revs.get(s) or pv) if same else version
    for s in retired:
        revs[s] = int(p_revs.get(s) or pv) if s in p_ret else version
    return {"symbols": names, "retired": retired, "revs": revs, "hashes": {s: hashes[s] for s in names if s in hashes}}


def main(argv=None) -> int:
    import os
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="D:/uct-history")
    ap.add_argument("--version", type=int, required=True)
    ap.add_argument("--stage", choices=("test", "all"), required=True)
    ap.add_argument("--test", default="")
    ap.add_argument("--skip-upload", action="store_true", help="manifest only (the series are already up)")
    a = ap.parse_args(argv)
    root = Path(a.root) / "daily-v1"
    serve = json.loads((root / "serve_list.json").read_text(encoding="utf-8"))
    bucket = os.environ["DATA_SYNC_BUCKET"]
    s3 = s3_client_from_env()
    import hashlib
    vp = f"{PREFIX}v{a.version}/"
    try:
        prev = json.loads(s3.get_object(Bucket=bucket, Key=f"{PREFIX}manifest.json")["Body"].read())
    except Exception:  # noqa: BLE001 - the first manifest
        prev = None
    names = serve if a.stage == "all" else [s for s in a.test.split(",") if s in serve]
    recs = {sym: json.loads((root / "joined" / f"{sym}.json").read_text(encoding="utf-8")) for sym in serve}
    hashes = {sym: hashlib.sha256(payload_body(recs[sym])).hexdigest() for sym in names}
    p = plan(prev, a.version, names, hashes)
    end = None
    t0 = time.time()
    for k, sym in enumerate(serve):
        rec = recs[sym]
        if rec["bars"]:
            end = max(end or "", rec["bars"][-1][0])
        # Only a ticker whose rev is this version uploads: an unchanged one is already at v<rev>.
        if not a.skip_upload and p["revs"].get(sym) == a.version:
            s3.put_object(Bucket=bucket, Key=f"{vp}{sym}.json.gz", Body=payload(rec),
                          ContentType="application/json", ContentEncoding="gzip")
        if k % 100 == 0:
            print(f"{k}/{len(serve)} {sym} {time.time() - t0:.0f}s", flush=True)
    manifest = {"version": a.version, "end": end, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "stage": a.stage, **p}
    s3.put_object(Bucket=bucket, Key=f"{PREFIX}manifest.json", Body=json.dumps(manifest).encode("utf-8"),
                  ContentType="application/json", CacheControl="no-store")
    print("manifest", {k: (v if k != "symbols" else len(v)) for k, v in manifest.items()}, "serving", names[:12])
    return 0


if __name__ == "__main__":
    sys.exit(main())
