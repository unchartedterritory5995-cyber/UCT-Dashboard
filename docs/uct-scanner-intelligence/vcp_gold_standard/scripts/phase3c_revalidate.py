"""Phase 3C -- rerun System D against the frozen 82-case gold-standard set
after the Trend Template precondition correction.

Step 7 (targeted): reruns the 11 predicted-to-flip cases + 3 watchlist cases
+ 2 true positives FIRST, against the exact same bars each case's
`case_answer_key.json` `system_d.state` was originally computed from (same
BARS_WINDOW=400, same as-of cutoff per eval_label, same
`BaseCtx(bars=bars, bars_full=bars)` -> `vcp_state(ctx)` call shape as
`build_candidate_pool.py`).

Step 8-9 (broad): reruns the FULL 82-case set and recomputes precision/
recall/F1 for corrected System D against the frozen reviewer labels
(`adjudication.json` consensus_label), using the SAME comparison logic as
`adjudicate_and_compare.py` (read, never altered).

Read-only against C:\\data\\bars.db and the frozen evidence files. Writes
docs/uct-scanner-intelligence/vcp_gold_standard/data/phase3c_revalidation.json.

Run: python docs/uct-scanner-intelligence/vcp_gold_standard/scripts/phase3c_revalidate.py
"""
import json
import os
import sys

os.environ["DATA_DIR"] = "C:/data"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")))

from api.services import bars_sqlite  # noqa: E402
bars_sqlite._DB_PATH = "C:/data/bars.db"

from api.services.screener.bases import BaseCtx  # noqa: E402
from api.services.screener.base_catalog import vcp_state  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
BARS_WINDOW = 400
CUTOFF_BY_LABEL = {"current": None, "t_minus_6mo": 20260302, "t_minus_12mo": 20250902}


def load_bars(sym, eval_label):
    as_of = CUTOFF_BY_LABEL[eval_label]
    if as_of is None:
        rows = bars_sqlite.get_bars(sym, "D", BARS_WINDOW)
    else:
        rows = bars_sqlite.get_bars_before(sym, "D", BARS_WINDOW, as_of)
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def run_d(sym, eval_label):
    bars = load_bars(sym, eval_label)
    if not bars:
        return {"fired": False, "state": None, "bars_found": 0}
    ctx = BaseCtx(bars=bars, bars_full=bars)
    state = vcp_state(ctx)
    return {"fired": state is not None, "state": state, "bars_found": len(bars)}


def main():
    with open(os.path.join(DATA_DIR, "case_answer_key.json"), encoding="utf-8") as f:
        cases = json.load(f)
    with open(os.path.join(DATA_DIR, "adjudication.json"), encoding="utf-8") as f:
        adjud = json.load(f)
    with open(os.path.join(DATA_DIR, "phase3c_predicted_flips.json"), encoding="utf-8") as f:
        predicted = json.load(f)

    # ── Step 7: targeted 14 cases (11 predicted flips + 3 watchlist) + 2 TPs ──
    targeted_ids = (
        [r["case_id"] for r in predicted["predicted_to_flip"]]
        + [r["case_id"] for r in predicted["not_predicted_to_flip_watchlist_second_fix"]]
        + [r["case_id"] for r in predicted["true_positives_must_not_flip"]]
    )
    targeted = []
    for cid in targeted_ids:
        c = cases[cid]
        a = adjud.get(cid, {})
        d_pre = c["system_d"]
        d_post = run_d(c["symbol"], c["eval_label"])
        pred_group = (
            "predicted_flip" if cid in [r["case_id"] for r in predicted["predicted_to_flip"]]
            else "watchlist_no_flip" if cid in [r["case_id"] for r in predicted["not_predicted_to_flip_watchlist_second_fix"]]
            else "true_positive_must_survive"
        )
        moved_toward_reviewed = None
        if a.get("consensus_label") == "negative":
            moved_toward_reviewed = (d_pre["fired"] is True) and (d_post["fired"] is False)
        elif a.get("consensus_label") == "positive":
            moved_toward_reviewed = (d_pre["fired"] is True) and (d_post["fired"] is True)
        targeted.append({
            "case_id": cid, "symbol": c["symbol"], "eval_label": c["eval_label"],
            "prediction_group": pred_group,
            "consensus_label": a.get("consensus_label"),
            "pre_fix_fired": d_pre["fired"],
            "post_fix_fired": d_post["fired"],
            "flipped": d_pre["fired"] != d_post["fired"],
            "moved_toward_reviewed_label": moved_toward_reviewed,
            "bars_found": d_post["bars_found"],
        })

    # ── Step 8: full 82-case rerun ──
    full = []
    for cid, c in cases.items():
        a = adjud.get(cid, {})
        d_pre = c["system_d"]
        d_post = run_d(c["symbol"], c["eval_label"])
        full.append({
            "case_id": cid, "symbol": c["symbol"], "eval_label": c["eval_label"],
            "agreement_category": c.get("agreement_category"),
            "consensus_label": a.get("consensus_label"),
            "system_a_fired": c["system_a"]["fired"],
            "pre_fix_d_fired": d_pre["fired"],
            "post_fix_d_fired": d_post["fired"],
            "flipped": d_pre["fired"] != d_post["fired"],
            "bars_found": d_post["bars_found"],
        })

    # ── Step 9: before/after metrics for corrected System D ──
    def metrics(fired_key):
        tp = fp = fn = tn = borderline = 0
        for row in full:
            label = row["consensus_label"]
            fired = row[fired_key]
            if label == "positive":
                if fired: tp += 1
                else: fn += 1
            elif label == "negative":
                if fired: fp += 1
                else: tn += 1
            else:
                borderline += 1
        precision = tp / (tp + fp) if (tp + fp) else None
        recall = tp / (tp + fn) if (tp + fn) else None
        f1 = (2 * precision * recall / (precision + recall)
              if precision and recall and (precision + recall) else None)
        return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "borderline_excluded": borderline,
                "precision": precision, "recall": recall, "f1": f1}

    pre_metrics = metrics("pre_fix_d_fired")
    post_metrics = metrics("post_fix_d_fired")

    # ── Step 10: new false-negative check ──
    new_false_negatives = [
        row for row in full
        if row["consensus_label"] == "positive"
        and row["pre_fix_d_fired"] and not row["post_fix_d_fired"]
    ]
    new_false_negatives_any_label = [
        row for row in full
        if row["pre_fix_d_fired"] and not row["post_fix_d_fired"]
        and row["consensus_label"] != "negative"
    ]

    out = {
        "targeted_14_plus_2": targeted,
        "targeted_summary": {
            "predicted_flip_actual_flip_count": sum(
                1 for r in targeted if r["prediction_group"] == "predicted_flip" and r["flipped"]),
            "predicted_flip_total": sum(
                1 for r in targeted if r["prediction_group"] == "predicted_flip"),
            "watchlist_unexpectedly_flipped": [
                r["case_id"] for r in targeted
                if r["prediction_group"] == "watchlist_no_flip" and r["flipped"]],
            "true_positives_unexpectedly_flipped": [
                r["case_id"] for r in targeted
                if r["prediction_group"] == "true_positive_must_survive" and r["flipped"]],
        },
        "full_82_case_rerun": full,
        "metrics_pre_fix": pre_metrics,
        "metrics_post_fix": post_metrics,
        "new_false_negatives_from_positive_consensus": new_false_negatives,
        "new_false_negatives_any_non_negative_label": new_false_negatives_any_label,
    }
    out_path = os.path.join(DATA_DIR, "phase3c_revalidation.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {out_path}")
    print(json.dumps(out["targeted_summary"], indent=2))
    print("pre_metrics:", json.dumps(pre_metrics, indent=2))
    print("post_metrics:", json.dumps(post_metrics, indent=2))
    print("new false negatives (consensus positive):", len(new_false_negatives))
    print("new false negatives (any non-negative label):", len(new_false_negatives_any_label))


if __name__ == "__main__":
    main()
