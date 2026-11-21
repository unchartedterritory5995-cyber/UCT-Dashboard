"""How many series serve a DIFFERENT base history_rev on web and on bars-api (operator tool, read-only).

The bar contract's history_rev is comparable only within one store (docs/architecture/bar-contract.md), yet one
browser can get the same ticker/tf from both stores (the edge's fallback and breaker, web's own non-proxied reads).
The browser refuses a LOWER history_rev and re-reads in full on a HIGHER one, so a series whose base differs between
the stores can strand a browser on the store that answered last. Measured 2026-11-21: 72 of 72 series differed.

This runs ONE read-only SELECT of `series_meta` (and the tiny `store_meta` floors) on each service, mode=ro, under a
60 s timeout and `nice`, and prints counts only. The served base is max(series history_rev, rev_floor_ms), exactly as
`bars_sqlite.series_meta` serves it (the epochs on top are equal across pods since U5).

  python tools/bars_history_rev_cross_store.py                    # the default 24 tickers x D/W/M
  python tools/bars_history_rev_cross_store.py --tickers SPY,AAPL --json
Needs the Railway CLI linked to the project (railway.exe is called directly: npm's railway.CMD runs through cmd.exe,
which eats the `|` the remote command needs). Exit 0 = measured (whatever the count), 2 = a service could not be read.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys

DEFAULT_TICKERS = ("SPY QQQ AAPL MSFT NVDA AMZN GOOGL META TSLA FDX CX KO JNJ INTC CSCO PG XOM JPM WMT HD "
                   "ASB MNST BALL SUPN").split()
SERVICES = ("web", "bars-api")
RAILWAY_EXE = os.environ.get("RAILWAY_EXE") or os.path.expandvars(
    r"%APPDATA%\npm\node_modules\@railway\cli\bin\railway.exe")

#: Runs ON the pod. Read-only by construction: mode=ro plus query_only. One SELECT per table, nothing else.
PROBE = """import json, os, sqlite3
p = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True, timeout=5)
c.execute("PRAGMA query_only=1")
T = json.loads(%r)
q = "SELECT ticker, tf, rev, history_rev FROM series_meta WHERE tf IN ('D','W','M') AND ticker IN (" + ",".join("?" * len(T)) + ")"
print("J" + json.dumps({"rows": c.execute(q, T).fetchall(), "store_meta": c.execute("SELECT k, v FROM store_meta").fetchall()}))
"""


def probe_source(tickers) -> str:
    return PROBE % json.dumps(sorted({t.upper() for t in tickers}))


def parse(stdout: str) -> dict | None:
    """The probe's one `J{...}` line, or None when the pod printed none."""
    for line in (stdout or "").splitlines():
        if line.startswith("J{"):
            return json.loads(line[1:])
    return None


def served_bases(doc: dict) -> tuple[dict, int]:
    """({(ticker, tf): served base}, floor): base = max(series history_rev, the store's rev_floor_ms)."""
    floor = max([int(float(v)) for k, v in doc.get("store_meta") or () if k == "rev_floor_ms"] or [0])
    return {(t, tf): max(int(h or 0), floor) for t, tf, _r, h in doc.get("rows") or ()}, floor


def compare(a: dict, b: dict, names=SERVICES) -> dict:
    """Counts over the series both stores hold, plus the ones only one holds."""
    (A, fa), (B, fb) = served_bases(a), served_bases(b)
    both = sorted(set(A) & set(B))
    out = {"series_compared": len(both), "equal": 0, f"{names[0]}_higher": 0, f"{names[1]}_higher": 0,
           f"{names[0]}_at_floor": 0, f"{names[1]}_at_floor": 0,
           f"only_{names[0]}": len(set(A) - set(B)), f"only_{names[1]}": len(set(B) - set(A)),
           f"{names[0]}_floor_ms": fa, f"{names[1]}_floor_ms": fb, "max_abs_gap_ms": 0}
    for k in both:
        x, y = A[k], B[k]
        out["equal" if x == y else f"{names[0]}_higher" if x > y else f"{names[1]}_higher"] += 1
        out[f"{names[0]}_at_floor"] += x == fa
        out[f"{names[1]}_at_floor"] += y == fb
        out["max_abs_gap_ms"] = max(out["max_abs_gap_ms"], abs(x - y))
    out["diverged"] = out["series_compared"] - out["equal"]
    return out


def read_service(service: str, tickers, runner=subprocess.run) -> dict | None:
    b64 = base64.b64encode(probe_source(tickers).encode("utf-8")).decode("ascii")
    cmd = [RAILWAY_EXE, "ssh", "-s", service, "echo", b64, "|", "base64", "-d", "|",
           "timeout", "60", "nice", "/opt/venv/bin/python"]
    try:
        r = runner(cmd, capture_output=True, text=True, timeout=150)
    except (OSError, subprocess.SubprocessError):
        return None
    return parse(r.stdout)


def main(argv=None, runner=subprocess.run) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tickers", default=",".join(DEFAULT_TICKERS))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    tickers = [t.strip().upper() for t in a.tickers.split(",") if t.strip()]
    docs = {s: read_service(s, tickers, runner) for s in SERVICES}
    missing = [s for s, d in docs.items() if d is None]
    if missing:
        print(json.dumps({"ok": False, "unreadable": missing}))
        return 2
    res = {"ok": True, "tickers": len(tickers), **compare(docs[SERVICES[0]], docs[SERVICES[1]])}
    print(json.dumps(res) if a.json else "\n".join(f"{k}: {v}" for k, v in res.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
