"""Full 24-case Hammer diagnostic: any-lag fired vs last-bar-only fired,
cross-referenced against the judge's frozen verdicts. Read-only."""
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

# judge verdicts (from ADJUDICATION_JUDGE1.md summary table), hand-transcribed
JUDGE = {
    "case_0000": "NEGATIVE", "case_0001": "NEGATIVE", "case_0002": "NEGATIVE",
    "case_0003": "NEGATIVE", "case_0004": "NEGATIVE", "case_0005": "POSITIVE",
    "case_0006": "NEGATIVE", "case_0007": "NEGATIVE", "case_0008": "NEGATIVE",
    "case_0009": "NEGATIVE", "case_0010": "NEGATIVE", "case_0011": "NEGATIVE",
    "case_0012": "NEGATIVE", "case_0013": "NEGATIVE", "case_0014": "NEGATIVE",
    "case_0015": "NEGATIVE", "case_0016": "NEGATIVE", "case_0017": "NEGATIVE",
    "case_0018": "NEGATIVE", "case_0019": "NEGATIVE", "case_0020": "AMBIGUOUS",
    "case_0021": "NEGATIVE", "case_0022": "NEGATIVE", "case_0023": "NEGATIVE",
}


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
    rows = []
    for case_id in sorted(answer_key.keys()):
        entry = answer_key[case_id]
        sym, as_of_t = entry["symbol"], entry["as_of_t"]
        any_fired_recorded = entry["detector_candidate_fired"]
        window = bars_for_upto(con, sym, as_of_t, WINDOW_BARS)
        assert window[-1]["t"] == as_of_t
        dets = detect_hammer(window, build_context(window, sym=sym))
        last_idx = len(window) - 1
        any_fired = bool(dets)
        fired_idx = None
        if dets:
            fired_t = dets[0]["start_t"]
            fired_idx = next((i for i, b in enumerate(window) if b["t"] == fired_t), None)
        last_bar_fired = (fired_idx == last_idx)
        judge = JUDGE[case_id]
        rows.append({
            "case_id": case_id, "symbol": sym, "any_fired": any_fired,
            "any_fired_matches_recorded": any_fired == any_fired_recorded,
            "lag": (last_idx - fired_idx) if fired_idx is not None else None,
            "last_bar_fired": last_bar_fired, "judge": judge,
        })

    print(f"{'case':10} {'sym':6} {'any_fired':9} {'lag':4} {'last_bar_fired':14} {'judge':10}")
    for r in rows:
        print(f"{r['case_id']:10} {r['symbol']:6} {str(r['any_fired']):9} {str(r['lag']):4} {str(r['last_bar_fired']):14} {r['judge']:10}")

    # corrected confusion matrix using last_bar_fired as the prediction, judge as ground truth
    tp=fp=fn=tn=amb=0
    for r in rows:
        if r["judge"] == "AMBIGUOUS":
            amb += 1
            continue
        pred = r["last_bar_fired"]
        truth = (r["judge"] == "POSITIVE")
        if pred and truth: tp += 1
        elif pred and not truth: fp += 1
        elif not pred and truth: fn += 1
        else: tn += 1
    print(f"\nCORRECTED (last-bar-only) confusion matrix: TP={tp} FP={fp} FN={fn} TN={tn} (ambiguous excluded={amb})")
    prec = tp/(tp+fp) if (tp+fp) else float('nan')
    rec = tp/(tp+fn) if (tp+fn) else float('nan')
    print(f"precision={prec:.3f} recall={rec:.3f}")

    # sanity: does any_fired match the frozen answer_key_ingredients.json (i.e. is code unchanged since corpus was built)?
    mism = [r["case_id"] for r in rows if not r["any_fired_matches_recorded"]]
    print(f"\nany_fired mismatches vs frozen answer key (should be empty if code unchanged): {mism}")

if __name__ == "__main__":
    main()
