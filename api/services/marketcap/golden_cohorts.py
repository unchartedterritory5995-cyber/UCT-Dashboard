"""Representative cohort examples, chosen DETERMINISTICALLY from a universe audit (one per category).

    python -m api.services.marketcap.golden_cohorts --audit-rows audit_rows.json.gz --build B.db --data C:/mcapdata \
        --out cohorts.json

Each category picks the qualifying security with the most expected sessions (ties: ticker). Every pick reports
BEFORE vs V1 coverage, internal gaps, structure and the V1 reasons, so a reviewer sees one concrete case per cohort.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os

from .build import load_ref


def _pick(rows, pred, exclude=()):
    c = [r for r in rows if pred(r) and r["ticker"] not in exclude]
    return max(c, key=lambda r: (r["expected_sessions"], r["ticker"])) if c else None


def run(rows_path: str, build: str, data: str) -> dict:
    import sqlite3
    rows = json.load(gzip.open(rows_path, "rt"))
    ref = load_ref(os.path.join(data, "ref.jsonl"))
    B = sqlite3.connect(build)
    named = {"ARM", "AMD", "MU", "AAPL", "KO", "NVDA", "META", "GOOG", "GOOGL", "ABNB", "PLTR", "COIN", "SHOP", "V"}

    def splits(t, rev):
        sp = (ref.get(t) or (None, []))[1]
        return any((s.ratio < 1) == rev and s.ex_date.year >= 2015 for s in sp)

    def structure(r, word):
        return any(word in s for s in r["structure"])

    cats = {
        "domestic_single_class": lambda r: not r["foreign"] and r["structure"] == ["SINGLE"] and r["v1"]["valued"],
        "foreign_20F": lambda r: r["foreign"] and not r["adr"] and r["v1"]["valued"],
        "adr_ads": lambda r: r["adr"] and r["v1"]["valued"] > 0,
        "multi_class": lambda r: r["multi"] and r["v1"]["valued"] > 0,
        "recent_ipo_2024plus": lambda r: (r["listing_start"] or 0) >= 20240101 and r["v1"]["valued"],
        "old_edgar_evidence_pre1997": lambda r: (r["v1"]["first"] or 99999999) < 19970101,
        "pre_edgar_limited": lambda r: r["pre_edgar"],
        "ticker_reuse": lambda r: bool(r["ticker_reuse"]),
        "reverse_split_2015plus": lambda r: splits(r["ticker"], True) and r["v1"]["valued"],
        "normal_split_2015plus": lambda r: splits(r["ticker"], False) and r["v1"]["valued"],
        "complex_capital_structure": lambda r: "COMPLEX_CAPITAL_STRUCTURE_UNRESOLVED" in r["v1_reasons_all"],
        "split_ledger_gap_hold": lambda r: "CORPORATE_ACTION_HOLD" in r["v1_reasons_all"],
        "still_missing_all": lambda r: r["v1"]["valued"] == 0,
    }
    out = {}
    for name, pred in cats.items():
        r = _pick(rows, pred, exclude=named)
        if r is None:
            out[name] = None
            continue
        last = B.execute("SELECT d, cap FROM cap_daily WHERE cik=? ORDER BY d DESC LIMIT 1", (r["cik"],)).fetchone()
        out[name] = {"ticker": r["ticker"], "cik": r["cik"], "structure": r["structure"], "listing_start": r["listing_start"],
                     "expected_sessions": r["expected_sessions"],
                     "before": {k: r["before"][k] for k in ("valued", "internal_days", "trailing")},
                     "v1": {k: r["v1"][k] for k in ("valued", "internal_days", "trailing")},
                     "v1_reasons": r["v1_reasons_all"], "v1_last": last,
                     "contaminated_before": r["contaminated_before_sessions"]}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    for k in ("--audit-rows", "--build", "--data", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args(argv)
    res = run(a.audit_rows, a.build, a.data)
    json.dump(res, open(a.out, "w"), indent=1, default=str)
    for k, v in res.items():
        print(k, v and (v["ticker"], v["before"], v["v1"], v["v1_reasons"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
