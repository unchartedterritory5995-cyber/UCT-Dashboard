"""READ-ONLY on the web pod: how many bars each bank v2 chart really gets, and every ticker's daily history span.

pod_bank_misses.py found 69 items with no bars at all on the pod (2026-11-06): the pod's bars.db starts some tickers'
history in 2006, or only in 2024-2026, while the dump the bank was built from went back to 1995. The importer accepts a
chart with even one bar (study.resolve_bars: any visible row), so an item dated just after a ticker's pod history begins
can be stored with a stub of a chart. This prints, for every item of the three bank v2 segments whose chart or forward
strip is short of its spec (120 visible bars, 20 forward), the counts the pod really has; and, for every ticker, its
first and last daily bar and row count, so the next pass picks only charts the pod covers. Writes nothing.

  ! powershell -File <scratchpad>/run_pod_py.ps1 -Script C:/Users/pgosz/uct-worktrees/study-hve-overlay/docs/study/bank_v2/pod_bars_coverage.py
"""
import json
import os
import sqlite3
import sys

ROOT = next((r for r in (os.getcwd(), "/app") if os.path.exists(os.path.join(r, "docs", "study", "bank"))), None)
if ROOT is None:
    raise SystemExit("no docs/study/bank here")
SEGMENTS = ("spot.setups", "cycle.price_action", "chart.events")


def main() -> None:
    db = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    span = {t: [a, b, n] for t, a, b, n in
            con.execute("SELECT ticker, min(ts), max(ts), count(*) FROM ohlcv WHERE tf='D' GROUP BY ticker")}
    short = []
    for seg in SEGMENTS:
        items = json.load(open(os.path.join(ROOT, "docs", "study", "bank", seg + ".json"), encoding="utf-8"))
        for it in items:
            b = it.get("bars") or {}
            sym, asof = str(b.get("sym") or "").upper(), str(b.get("asof") or "")
            if not sym or not asof:
                continue
            key = int(asof.replace("-", ""))
            want_v, want_f = int(b.get("window") or 120), int(b.get("forward") or 20)
            v = con.execute("SELECT count(*) FROM (SELECT ts FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? "
                            "ORDER BY ts DESC LIMIT ?)", (sym, key, want_v)).fetchone()[0]
            f = con.execute("SELECT count(*) FROM (SELECT ts FROM ohlcv WHERE ticker=? AND tf='D' AND ts>? "
                            "ORDER BY ts LIMIT ?)", (sym, key, want_f)).fetchone()[0]
            if v < want_v or f < want_f:
                short.append([seg, it["id"], sym, asof, v, f])
    print(json.dumps({"short": short, "span": span}, separators=(",", ":")))


if __name__ == "__main__":
    main()
