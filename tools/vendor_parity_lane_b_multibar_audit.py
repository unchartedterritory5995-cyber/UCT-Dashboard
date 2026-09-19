#!/usr/bin/env python3
"""Lane B multi-bar parity audit -- expands the single-probe comparison.

WHY THIS EXISTS
----------------
Vendor Parity Tranche 2, Lane B shipped VENDOR-PARITY VERIFIED for `ta.rising`,
`ta.median`, `ta.percentrank`, `ta.bbw` off exactly ONE probe row per function
(the `phase==24` bar). The owner's review correctly flagged that a single
selected point cannot discriminate semantics across meaningful state changes --
"agreement at one point" and "parity across the state space" are different
claims, and the standing observation JSONs only ever encoded the first.

THE RAW ARTIFACT ALREADY HOLDS MORE THAN THAT
-----------------------------------------------
`tests/fixtures/vendor/raw_captures/2026-09-05-tv_oracle_capture_2026-09-05.csv`
is not 12 copies of one probe. It is 300 chronologically-ordered rows covering
ALL 25 distinct values of the synthetic script's `phase` cycle (12 full
cycles), with the real TradingView-computed value of all four candidate
columns on EVERY row. The observation JSONs simply never read past the one
row they were built to isolate.

This tool does not fetch anything new. It re-reads the SAME preserved CSV,
rebuilds the input series from its own `raw` column (verified 1:1 with
`phase`, verified chronologically sorted, verified that all 12 recurrences of
every phase agree exactly with each other -- see `--rows-only`), feeds that
series through the SAME production Python interpreter every other lane in
this repo uses (`ast_conformance.run_py`), and compares EVERY row the
interpreter can validly answer against the vendor's own column.

WARM-UP, PRECISELY
-------------------
The CSV's vendor columns are already warm for all 300 rows (Pine's `ta.*`
functions ran against the real chart's off-screen history before this visible
window began). OUR recomputation is cold: it starts at CSV row 0 with no
off-screen history at all. Because the input is exactly periodic (period 25)
and clean (no gaps), a window that lies ENTIRELY inside our own reconstructed
array is byte-identical to the true off-screen window at the same phase --
so once our own rolling window has filled (index >= lookback-1 for a
size-`lookback` window), our value is directly comparable to the vendor's,
with no synthetic phase-remapping needed. Rows before that are excluded, and
the exact count and reason are reported, not folded into "compared".
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import ast_conformance as ac  # noqa: E402

CSV_PATH = os.path.join(
    ROOT, "tests", "fixtures", "vendor", "raw_captures",
    "2026-09-05-tv_oracle_capture_2026-09-05.csv")

OBS_DIR = os.path.join(ROOT, "tests", "fixtures", "vendor", "observations")

#: (function key, builtin CSV column, observation filename, lookback = the
#: first 0-based index our OWN cold recomputation can answer, kind, and the
#: REJECTED candidate's own CSV column -- the real vendor-computed output of
#: the semantics this ruling did NOT choose, at every one of the same 300
#: rows. Comparing UCT's real output against this column (rather than a
#: locally-invented mutation) is the mutation control: it proves the check
#: discriminates using real vendor data for the wrong answer, not a guess at
#: what "wrong" would look like.
_FUNCTIONS = [
    ("rising", "rising_builtin",
     "ta-rising-oracle-ambiguity-v3-1-2026-09-05.json", 3, "bool",
     "rising_candA_runningMax"),
    ("median", "median_builtin",
     "ta-median_even_length-oracle-ambiguity-v3-1-2026-09-05.json", 3, "float",
     "median_candLower"),
    ("percentrank", "percentrank_builtin",
     "ta-percentrank-oracle-ambiguity-v3-1-2026-09-05.json", 9, "float",
     "percentrank_candB_overLplus1"),
    ("bbw", "bbw_builtin",
     "ta-bbw-oracle-ambiguity-v3-1-2026-09-05.json", 19, "float",
     "bbw_candRatio"),
]


def _read_json(path: str) -> dict:
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_rows() -> list[dict]:
    with io.open(CSV_PATH, encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def build_bars(rows: list[dict]) -> list[dict]:
    """The full 300-row series, in chronological order, `c` = the `raw` column.

    `raw` (not `close`) is the series the packet script's indicators are
    plotted from -- `close` in this CSV is the REAL chart's own unrelated
    price history, which the synthetic oracle script never reads.
    """
    bars = []
    for r in rows:
        v = float(r["raw"])
        bars.append({"t": int(r["time"]), "o": v, "h": v, "l": v, "c": v, "v": 0})
    return bars


def rows_sanity(rows: list[dict]) -> dict:
    """The three preconditions this whole approach rests on -- verify, don't assume."""
    times = [int(r["time"]) for r in rows]
    sorted_ok = times == sorted(times)

    by_phase: dict[str, dict[str, set]] = {}
    for r in rows:
        ph = r["phase"]
        slot = by_phase.setdefault(ph, {})
        for col in ("rising_builtin", "median_builtin", "percentrank_builtin", "bbw_builtin"):
            slot.setdefault(col, set()).add(r[col])
    disagreements = [
        (ph, col, vals) for ph, cols in by_phase.items()
        for col, vals in cols.items() if len(vals) > 1
    ]

    raw_to_phase: dict[str, set] = {}
    for r in rows:
        raw_to_phase.setdefault(r["raw"], set()).add(r["phase"])
    ambiguous_raw = {k: v for k, v in raw_to_phase.items() if len(v) > 1}

    return {
        "total_rows": len(rows),
        "distinct_phases": len(by_phase),
        "chronologically_sorted": sorted_ok,
        "per_phase_disagreements": disagreements,
        "raw_values_mapping_to_multiple_phases": ambiguous_raw,
    }


def _to_bool(s: str) -> bool:
    return s not in ("0", "0.0", "", "False", "false")


def audit_one(fn_key: str, builtin_col: str, obs_name: str, lookback0: int,
              kind: str, rejected_col: str, rows: list[dict], bars: list[dict]) -> dict:
    obs = _read_json(os.path.join(OBS_DIR, obs_name))
    ast = obs["engine"]["ast"]

    case = {"id": fn_key, "ast": ast}
    py_cols = ac.run_py([case], bars)
    uct_col = py_cols[fn_key]

    n = len(rows)
    assert len(uct_col) == n, f"{fn_key}: interpreter returned {len(uct_col)} rows, expected {n}"

    excluded_cold_start = lookback0  # rows [0, lookback0) cannot be validly answered cold
    compared = 0
    mismatches = []
    max_abs = 0.0
    max_rel = 0.0
    transitions = []  # for boolean series: index where value flips vs the prior compared row
    distinct_compared_vendor_values = set()
    prev_vendor_bool = None
    rejected_agree = 0
    rejected_disagree = 0

    for i in range(n):
        if i < lookback0:
            continue
        uct_v = uct_col[i]
        vendor_raw = rows[i][builtin_col]
        rejected_raw = rows[i][rejected_col]
        if uct_v is None:
            # our own cold window produced NaN past the declared lookback --
            # a real finding, not silently dropped from "compared"
            mismatches.append({"index": i, "reason": "uct_produced_nan_past_declared_lookback",
                                "vendor": vendor_raw})
            continue
        compared += 1
        if kind == "bool":
            uct_b = bool(uct_v)
            vendor_b = _to_bool(vendor_raw)
            rejected_b = _to_bool(rejected_raw)
            distinct_compared_vendor_values.add(vendor_b)
            if prev_vendor_bool is not None and vendor_b != prev_vendor_bool:
                transitions.append(i)
            prev_vendor_bool = vendor_b
            if uct_b != vendor_b:
                mismatches.append({"index": i, "uct": uct_b, "vendor": vendor_b})
            if uct_b == rejected_b:
                rejected_agree += 1
            else:
                rejected_disagree += 1
        else:
            uct_f = float(uct_v)
            vendor_f = float(vendor_raw)
            rejected_f = float(rejected_raw)
            distinct_compared_vendor_values.add(round(vendor_f, 6))
            abs_d = abs(uct_f - vendor_f)
            scale = max(abs(uct_f), abs(vendor_f), 1e-12)
            rel_d = abs_d / scale
            max_abs = max(max_abs, abs_d)
            max_rel = max(max_rel, rel_d)
            if rel_d > 1e-6:
                mismatches.append({"index": i, "uct": uct_f, "vendor": vendor_f,
                                    "abs_delta": abs_d, "rel_delta": rel_d})
            rej_scale = max(abs(uct_f), abs(rejected_f), 1e-12)
            rej_rel = abs(uct_f - rejected_f) / rej_scale
            if rej_rel <= 1e-6:
                rejected_agree += 1
            else:
                rejected_disagree += 1

    return {
        "function": fn_key,
        "total_rows": n,
        "excluded_cold_start_rows": excluded_cold_start,
        "excluded_cold_start_reason": (
            "our own recomputation has no off-screen history before CSV row 0; "
            f"the first {excluded_cold_start} rows cannot fill a real window even "
            "though the vendor's own value on those same rows IS valid (warmed by "
            "real off-screen history we do not have)."
        ),
        "compared_rows": compared,
        "mismatches": mismatches,
        "mismatch_count": len(mismatches),
        "max_abs_delta": max_abs if kind != "bool" else None,
        "max_rel_delta": max_rel if kind != "bool" else None,
        "distinct_compared_vendor_values": sorted(distinct_compared_vendor_values, key=str),
        "boolean_transition_count": len(transitions) if kind == "bool" else None,
        "boolean_transition_indices_sample": transitions[:10] if kind == "bool" else None,
        "mutation_control": {
            "rejected_candidate_column": rejected_col,
            "description": (
                "UCT's real output compared against the REJECTED candidate's real "
                "vendor-computed value, same rows, same comparison. High disagreement "
                "here (not a locally-invented mutation) proves the check discriminates "
                "the ruling from the alternative across the compared state space."
            ),
            "rows_uct_agrees_with_rejected_candidate": rejected_agree,
            "rows_uct_disagrees_with_rejected_candidate": rejected_disagree,
        },
    }


def main() -> int:
    rows = load_rows()
    sanity = rows_sanity(rows)
    bars = build_bars(rows)

    report = {"csv_sanity": sanity, "per_function": {}}
    for fn_key, builtin_col, obs_name, lookback0, kind, rejected_col in _FUNCTIONS:
        report["per_function"][fn_key] = audit_one(
            fn_key, builtin_col, obs_name, lookback0, kind, rejected_col, rows, bars)

    print(json.dumps(report, indent=2, default=str))
    any_mismatch = any(r["mismatch_count"] for r in report["per_function"].values())
    return 1 if any_mismatch else 0


if __name__ == "__main__":
    raise SystemExit(main())
