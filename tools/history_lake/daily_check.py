"""Step 4 of the deep daily rebuild (2026-11-18): check every rebuilt series before anything is served.

Per symbol, against an independent vendor (yfinance split-adjusted Close, auto_adjust=False) and against what
production serves today (bench member, /api/bars D 12500):
  * yf_agree     share of shared sessions within TOL of the second vendor, and the disagreeing runs
                 (BASIS = one ratio: the vendors adjust an event differently; OTHER = different prices)
  * served_diff  sessions where the rebuild differs from what members see now (what serving it would change)
  * pre_join     the pre-2003-09-10 join (plan step 3): the second vendor's close ratio over the first
                 JOIN_SESSIONS sessions after the rebuild starts; `stable` when every one is within JOIN_TOL
Reads only. Writes --out (jsonl, resumable).
  python tools/history_lake/daily_check.py --root D:/uct-history --out D:/uct-history/daily-v1/check.jsonl
"""
from __future__ import annotations

import argparse
import gzip
import http.client
import http.cookiejar
import json
import os
import ssl
import statistics
import sys
import time
import urllib.request
from pathlib import Path

HOST = "uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36"
TOL, MIN_RUN, CHUNK = 0.03, 15, 40
JOIN_SESSIONS, JOIN_TOL = 250, 0.02


def runs(pairs):
    out, cur = [], None
    for d, r in pairs:
        bad = r is not None and abs(r - 1) > TOL
        if bad:
            if cur is None:
                cur = [d, d, []]
            cur[1] = d
            cur[2].append(r)
        elif r is not None and cur is not None:
            out.append(cur)
            cur = None
    if cur is not None:
        out.append(cur)
    res = []
    for a, b, rs in out:
        if len(rs) < MIN_RUN:
            continue
        med = statistics.median(rs)
        spread = statistics.pstdev([x / med for x in rs])
        res.append({"from": a, "to": b, "n": len(rs), "ratio": round(med, 4),
                    "kind": "BASIS" if spread < 0.02 else "OTHER"})
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="D:/uct-history")
    ap.add_argument("--out", default="D:/uct-history/daily-v1/check.jsonl")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dir", default="series", help="series (step 2) or joined (step 3)")
    a = ap.parse_args(argv)
    import yfinance as yf

    series_dir = Path(a.root) / "daily-v1" / a.dir
    done = set()
    if os.path.exists(a.out):
        for line in open(a.out, encoding="utf-8"):
            try:
                done.add(json.loads(line)["sym"])
            except Exception:  # noqa: BLE001
                pass
    todo = sorted(p.stem for p in series_dir.glob("*.json") if p.stem not in done)
    if a.limit:
        todo = todo[: a.limit]

    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    r = urllib.request.Request(f"https://{HOST}/api/auth/login", method="POST",
                               data=json.dumps({"email": os.environ["BENCH_EMAIL"], "password": os.environ["BENCH_PASSWORD"]}).encode())
    r.add_header("User-Agent", UA)
    r.add_header("Content-Type", "application/json")
    op.open(r, timeout=30).read()
    cookie = "; ".join(f"{c.name}={c.value}" for c in jar)
    conn = http.client.HTTPSConnection(HOST, timeout=90, context=ssl.create_default_context())

    def served(sym):
        nonlocal conn
        for _ in range(3):
            try:
                conn.request("GET", f"/api/bars/{sym}?tf=D&bars=12500", headers={"User-Agent": UA, "Cookie": cookie, "Accept-Encoding": "gzip"})
                resp = conn.getresponse()
                raw = resp.read()
                if resp.getheader("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                if resp.status != 200:
                    return None
                return {str(b["t"])[:10]: float(b["c"]) for b in (json.loads(raw).get("bars") or []) if isinstance(b.get("t"), str)}
            except Exception:  # noqa: BLE001
                conn.close()
                conn = http.client.HTTPSConnection(HOST, timeout=90, context=ssl.create_default_context())
                time.sleep(2)
        return None

    f = open(a.out, "a", encoding="utf-8")
    t0 = time.time()
    for k in range(0, len(todo), CHUNK):
        chunk = todo[k:k + CHUNK]
        try:
            data = yf.download(chunk, period="max", auto_adjust=False, group_by="ticker", progress=False, threads=True)
        except Exception as e:  # noqa: BLE001
            print("yf chunk failed", chunk[0], e, flush=True)
            time.sleep(30)
            continue
        for sym in chunk:
            rec_in = json.loads((series_dir / f"{sym}.json").read_text(encoding="utf-8"))
            bars = rec_in["bars"]
            reb = {b[0]: b[4] for b in bars}
            try:
                col = data[sym]["Close"] if len(chunk) > 1 else data["Close"]
                yfc = {str(i)[:10]: float(v) for i, v in col.dropna().items()}
            except Exception:  # noqa: BLE001
                yfc = {}
            srv = served(sym) or {}
            out = {"sym": sym, "bars": len(bars), "first": bars[0][0] if bars else None,
                   "since": rec_in.get("since"), "segments": len(rec_in.get("segments") or []),
                   "splits": len(rec_in.get("splits") or [])}
            pairs = [(d, (c / yfc[d]) if yfc.get(d) else None) for d, c in sorted(reb.items())]
            both = [x for _, x in pairs if x is not None]
            out["yf_shared"] = len(both)
            out["yf_agree"] = round(sum(1 for x in both if abs(x - 1) <= TOL) / len(both), 4) if both else None
            out["yf_runs"] = runs(pairs)
            shared_s = [d for d in reb if d in srv and srv[d] > 0]
            diff = [d for d in shared_s if abs(reb[d] / srv[d] - 1) > 0.01]
            out["served_shared"] = len(shared_s)
            out["served_diff"] = len(diff)
            out["served_diff_span"] = [min(diff), max(diff)] if diff else None
            out["served_first"] = min(srv) if srv else None
            out["served_only_after_rebuild_start"] = sum(1 for d in srv if bars and d >= bars[0][0] and d not in reb)
            ratios = [yfc[d] / reb[d] for d, _ in sorted(reb.items())[:JOIN_SESSIONS] if yfc.get(d) and reb[d] > 0]
            if len(ratios) >= JOIN_SESSIONS // 2:
                med = statistics.median(ratios)
                out["pre_join"] = {"factor": round(med, 5), "stable": all(abs(x / med - 1) <= JOIN_TOL for x in ratios),
                                   "yf_first": min(yfc) if yfc else None}
            f.write(json.dumps(out) + "\n")
            f.flush()
        print(f"{k + len(chunk)}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
        time.sleep(3)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
