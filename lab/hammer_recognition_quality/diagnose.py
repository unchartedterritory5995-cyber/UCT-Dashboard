"""Diagnose Hammer's blind-corpus FP/FN cases against real bars.db data.
Read-only. Reuses the corpus's own symbol/as_of_t pairs (no new sampling).
"""
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from api.services.pattern_engine.detectors.candlestick.hammer import (
    detect_hammer, _is_swing_low, _below_sma50, _recent_decline_pct, _try_extract,
)
from api.services.pattern_engine.primitives.context import build_context

BARS_DB = r"C:\data\bars.db"
WINDOW_BARS = 400

CORPUS_DIR = Path(r"C:\Users\Patrick\uct-dashboard-pattern-intelligence-lab\lab\quality\blind_corpus\hammer")
answer_key = json.loads((CORPUS_DIR / "answer_key_ingredients.json").read_text())

FP_CASES = ["case_0000","case_0001","case_0003","case_0006","case_0007","case_0011","case_0014","case_0016","case_0017","case_0021","case_0022","case_0023"]
FN_CASES = ["case_0005"]


def bars_for_upto(con, ticker, as_of_t, limit):
    cur = con.cursor()
    cur.execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?",
        (ticker, as_of_t, limit),
    )
    rows = cur.fetchall()
    rows.reverse()
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def main():
    con = sqlite3.connect(f"file:{BARS_DB}?mode=ro", uri=True)
    for case_id in FP_CASES + FN_CASES:
        entry = answer_key[case_id]
        sym, as_of_t = entry["symbol"], entry["as_of_t"]
        window = bars_for_upto(con, sym, as_of_t, WINDOW_BARS)
        assert window[-1]["t"] == as_of_t, f"{case_id}: last bar {window[-1]['t']} != as_of_t {as_of_t}"
        ctx = build_context(window, sym=sym)
        dets = detect_hammer(window, ctx)
        last_idx = len(window) - 1
        if dets:
            d = dets[0]
            fired_t = d["start_t"]
            fired_idx = next((i for i, b in enumerate(window) if b["t"] == fired_t), None)
            lag = last_idx - fired_idx if fired_idx is not None else None
            sw = _is_swing_low(window, fired_idx)
            b50 = _below_sma50(window, fired_idx)
            dp = _recent_decline_pct(window, fired_idx)
            print(f"{case_id} ({sym}@{as_of_t}): FIRED at idx={fired_idx}/{last_idx} (lag={lag} bars back) "
                  f"sw={sw} b50={b50} dp={dp:.3f} conf={d['confidence']}")
        else:
            print(f"{case_id} ({sym}@{as_of_t}): NOT FIRED (last_idx={last_idx})")
            # check anatomy + context at the literal last bar for diagnostic purposes
            cand = _try_extract(window, last_idx)
            if cand is None:
                print(f"    last-bar anatomy: FAILS extract (not hammer-shaped)")
            else:
                sw = _is_swing_low(window, last_idx)
                b50 = _below_sma50(window, last_idx)
                dp = _recent_decline_pct(window, last_idx)
                print(f"    last-bar anatomy OK; context sw={sw} b50={b50} dp={dp:.3f}")
    con.close()


if __name__ == "__main__":
    main()
