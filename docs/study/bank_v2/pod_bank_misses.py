"""READ-ONLY on the web pod: which bank items have no daily bars in the pod's own bars.db (the importer's "misses").

The 2026-11-06 import of bank v2 reported 69 misses ("no_bars"): items stored without a chart because the pod's
bars.db has no daily rows for the ticker before the chart's date, though the dump the bank was built from did. This
lists every one with the ticker's oldest and newest daily bar on the pod, so the misses can be removed or the bars
filled. It reads the segment files from the deployed repo and bars.db through bars_sqlite.get_bars_before (the
importer's own read); it writes nothing.

  ! powershell -File <scratchpad>/run_pod_py.ps1 -Script C:/Users/pgosz/uct-worktrees/study-hve-overlay/docs/study/bank_v2/pod_bank_misses.py
"""
import json
import os
import sqlite3
import sys

ROOT = next((r for r in (os.getcwd(), "/app") if os.path.exists(os.path.join(r, "docs", "study", "bank"))), None)
if ROOT is None:
    raise SystemExit("no docs/study/bank here")
sys.path.insert(0, ROOT)
from api.services import bars_sqlite  # noqa: E402

SEGMENTS = ("spot.setups", "cycle.price_action", "chart.events")


def main() -> None:
    db = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    out, span = [], {}
    for seg in SEGMENTS:
        items = json.load(open(os.path.join(ROOT, "docs", "study", "bank", seg + ".json"), encoding="utf-8"))
        for it in items:
            b = it.get("bars") or {}
            sym, asof = str(b.get("sym") or "").upper(), str(b.get("asof") or "")
            if not sym or not asof:
                continue
            key = int(asof.replace("-", ""))
            if bars_sqlite.get_bars_before(sym, "D", int(b.get("window") or 120), key):
                continue
            if sym not in span:
                span[sym] = con.execute("SELECT min(ts), max(ts), count(*) FROM ohlcv WHERE ticker=? AND tf='D'", (sym,)).fetchone()
            out.append({"segment": seg, "id": it["id"], "sym": sym, "asof": asof, "status": it.get("review_status"),
                        "pod_daily": {"first": span[sym][0], "last": span[sym][1], "rows": span[sym][2]}})
    print(json.dumps({"misses": len(out), "tickers": sorted({m["sym"] for m in out}), "items": out}, indent=1))


if __name__ == "__main__":
    main()
