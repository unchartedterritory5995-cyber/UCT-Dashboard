"""BANK V2: take pod_scan_more.py's hits (the pod's whole universe) into the local pipeline.

pod_scan_more.py prints its Kicker and High Volume Edge hits, each with the bars its chart needs, between BEGIN_HITS and
END_HITS. This decodes them, writes those bars into a LOCAL sandbox bars database (INSERT OR IGNORE: a bar already there
is never changed; refused for any path outside the Temp sandboxes), and writes an atlas file in scan_history.py's shape
so choose.py, enrich_meta.py and draft_pass.py run on the hits unchanged.

  python -X utf8 scripts/study/bank_v2/ingest_pod_hits.py --dump <the ! output file> --bars-db <sandbox bars.db> --out <atlas.jsonl.gz>
"""
from __future__ import annotations

import argparse
import base64
import gzip
import re
import json
import sqlite3
import zlib
from collections import Counter


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True)
    ap.add_argument("--bars-db", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if "uct_tests_datadir_" not in a.bars_db.replace("\\", "/"):
        raise SystemExit("refusing: --bars-db must be a local Temp sandbox (uct_tests_datadir_*)")
    txt = open(a.dump, encoding="utf-8", errors="ignore").read()
    # the pod's progress lines travel on stderr, and ssh can drop one INSIDE a batch line (seen 2026-11-08: "  200/1251
    # tickers, 50 hits, 162s" in the middle of a blob); they have one exact shape, so they come out before decoding
    txt = re.sub(r"  \d+/\d+ tickers, \d+ hits, \d+s\n", "", txt)
    hits = []
    for blob in re.findall(r"BEGIN_HITS[^\n]*\n(.*?)END_HITS", txt, flags=re.S):   # every batch printed
        hits += json.loads(zlib.decompress(base64.b64decode("".join(blob.split()))).decode())
    con = sqlite3.connect(a.bars_db)
    rows = [(h["sym"], "D", int(t), o, hi, lo, c, int(v or 0)) for h in hits for t, o, hi, lo, c, v in h["bars"]]
    before = con.execute("SELECT count(*) FROM ohlcv").fetchone()[0]
    con.executemany("INSERT OR IGNORE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", rows)
    con.commit()
    added = con.execute("SELECT count(*) FROM ohlcv").fetchone()[0] - before
    con.close()
    with gzip.open(a.out, "wt", encoding="utf-8") as fh:
        for h in hits:
            r = {k: v for k, v in h.items() if k != "bars"}
            r.setdefault("sector", None)
            r.setdefault("industry", None)
            fh.write(json.dumps(r, default=str) + "\n")
    print(f"{len(hits)} hits ({dict(Counter(h['skill'] for h in hits))}) in {len({h['sym'] for h in hits})} tickers; "
          f"{added} bars added to the sandbox; atlas -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
