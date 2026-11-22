"""READ-ONLY on the web pod: the exact daily bars each bank chart resolves to, as three dates per item.

pod_bars_coverage.py showed which charts are short. A chart can also be full length and still not be the chart the
bank was built from: if the pod's history has a gap inside the window, its 120 bars reach further back, and if the pod
lacks the chart's own last day, the question would be asked of the day before. This prints, for every item of the three
bank v2 segments, the pod's first bar of the 120-bar window, whether the chart's last day itself is on the pod, and the
pod's last bar of the 20-bar forward strip, so the bank side can compare them with the bars it was built from. Writes
nothing.

  ! powershell -File <scratchpad>/run_pod_py.ps1 -Script C:/Users/pgosz/uct-worktrees/study-hve-overlay/docs/study/bank_v2/pod_window_check.py
"""
import json
import os
import sqlite3

ROOT = next((r for r in (os.getcwd(), "/app") if os.path.exists(os.path.join(r, "docs", "study", "bank"))), None)
if ROOT is None:
    raise SystemExit("no docs/study/bank here")
SEGMENTS = ("spot.setups", "cycle.price_action", "chart.events")


def main() -> None:
    db = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    out = {}
    for seg in SEGMENTS:
        for it in json.load(open(os.path.join(ROOT, "docs", "study", "bank", seg + ".json"), encoding="utf-8")):
            b = it.get("bars") or {}
            sym, asof = str(b.get("sym") or "").upper(), str(b.get("asof") or "")
            if not sym or not asof:
                continue
            key = int(asof.replace("-", ""))
            w, f = int(b.get("window") or 120), int(b.get("forward") or 20)
            back = con.execute("SELECT ts FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?",
                               (sym, key, w)).fetchall()
            fwd = con.execute("SELECT ts FROM ohlcv WHERE ticker=? AND tf='D' AND ts>? ORDER BY ts LIMIT ?",
                              (sym, key, f)).fetchall()
            out[it["id"]] = [back[-1][0] if back else None, bool(back) and back[0][0] == key, len(back),
                             fwd[-1][0] if fwd else None, len(fwd)]
    print(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
