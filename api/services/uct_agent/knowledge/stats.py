"""Statistical reliability for setup records: sample floors, an uncertainty interval, and the label.

The wording rule (UCT's own scorecard): no setup proves edge on its own. The engine's numbers are the brain's
logged / published outcomes, NOT controlled against a base rate, so they are labelled descriptive. Only the
team archive's control-relative verdict may say "measured edge", and only in its own definition.
"""
from __future__ import annotations

import math
from typing import Optional

CAUTION = ("Historical, descriptive figures; not a forecast and not advice. UCT's own scorecard finds that no "
           "setup proves an edge on its own; market context matters more than the setup name.")
LABELS = {
    "insufficient_sample": "not enough sample to state a figure",
    "descriptive_uncontrolled": "descriptive record, not compared with a base rate (not evidence of an edge)",
    "measured_edge_controlled": "measured OUTPERFORMANCE versus the same stock on random days (z >= +3 on enough calls)",
    "measured_underperformance_controlled": "measured UNDERPERFORMANCE versus the same stock on random days (z <= -3 on enough calls)",
    "undated_record": "the record carries no refresh date; figure withheld",
    "not_proven": "no measured edge versus the base rate",
}


def wilson(wins: int, n: int, z: float = 1.96) -> Optional[tuple[float, float]]:
    """95 % Wilson score interval for a proportion, in percent; None when n <= 0."""
    if n <= 0 or wins < 0 or wins > n:
        return None
    p = wins / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return round(max(0.0, c - h) * 100, 1), round(min(1.0, c + h) * 100, 1)


def _num(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def engine_block(perf: Optional[dict], n_min: int, method: str) -> dict:
    """One floored, labelled record block from an engine stats row."""
    perf = perf or {}
    n = int(_num(perf.get("total_trades")) or 0)
    w_raw = _num(perf.get("wins"))
    if n < n_min or w_raw is None or not (0 <= w_raw <= n):
        # below the floor, OR no trustworthy win count: no figure (a count alone never becomes a rate)
        if n >= n_min:
            return {"label": "insufficient_sample", "label_text": "the record carries no usable win count; no figure is stated",
                    "n": n, "n_min": n_min, "method": method}
        return {"label": "insufficient_sample", "label_text": LABELS["insufficient_sample"],
                "n": n if n else None, "n_min": n_min, "method": method}
    wins = int(w_raw)
    wr = round(100.0 * wins / n, 1)                    # the interval and the rate come from the same counts
    out = {"label": "descriptive_uncontrolled", "label_text": LABELS["descriptive_uncontrolled"], "n": n,
           "wins": wins, "losses": int(_num(perf.get("losses")) or max(0, n - wins)), "win_rate_pct": wr,
           "win_rate_ci95": wilson(wins, n), "method": method, "n_min": n_min}
    for k in ("expectancy", "expectancy_r", "avg_gain_pct", "avg_loss_pct", "sample_start", "sample_end", "updated_at"):
        if perf.get(k) is not None:
            v = _num(perf[k]) if k not in ("sample_start", "sample_end", "updated_at") else perf[k]
            if v is not None:
                out[k] = v
    return out


ARCHIVE_STATS_KEY = "all_calls"     # wisdom/archive/team_record._setup_payload: every call of the setup


def archive_block(rec: Optional[dict], n_min: int, as_of: Optional[str] = None) -> Optional[dict]:
    """The team archive's verdict block (control-relative), floored, SIGNED; None when the archive has no record.

    The stats block is chosen BY NAME (`all_calls`). The archive's verdict "measured edge" means |z| >= 3, so the sign
    of edge_z decides the label: positive -> outperformance, negative -> UNDERPERFORMANCE, unknown sign -> not_proven.
    The archive record carries no refresh date today: without `as_of` the figures are withheld (undated = stale)."""
    if not isinstance(rec, dict):
        return None
    st = rec.get(ARCHIVE_STATS_KEY)
    if not isinstance(st, dict) or "n_scored" not in st:
        return None
    method = "the team's posted calls vs the same stock on random days (control-relative, 20-session horizon)"
    n = int(_num(st.get("n_scored")) or 0)
    if n < n_min:
        return {"label": "insufficient_sample", "label_text": LABELS["insufficient_sample"], "n": n or None,
                "n_min": n_min, "method": method}
    if not as_of:
        return {"label": "undated_record", "label_text": LABELS["undated_record"], "n": n, "method": method}
    verdict = str(st.get("verdict") or "")
    z = _num(st.get("edgeR_z"))
    if verdict == "measured edge" and z is not None and z > 0:
        label = "measured_edge_controlled"
    elif verdict == "measured edge" and z is not None and z < 0:
        label = "measured_underperformance_controlled"
    else:
        label = "not_proven"
    out = {"label": label, "label_text": LABELS[label], "n": n, "method": method, "as_of": as_of}
    w = _num(st.get("win20"))
    if w is not None:
        out["win_rate_20d_pct"] = round(w * 100, 1) if w <= 1 else round(w, 1)
        out["win_rate_20d_ci95"] = wilson(int(round(out["win_rate_20d_pct"] * n / 100)), n)
    if z is not None:
        out["edge_z"] = round(z, 2)
    return out
