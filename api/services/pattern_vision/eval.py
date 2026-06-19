"""Accuracy harness: measure the vision judge's recall against the Model Book.

The Model Book (`modelbook_setups`) is hand-labeled ground truth. For each labeled
(symbol, setup) we ask whether the judge confirms that setup — per-setup recall.
False-positive sampling is a follow-on (left null in v1, not faked).
"""
import logging
from collections import defaultdict

from .rubrics import FOCUSED_SETUPS

log = logging.getLogger(__name__)

# Model Book setup_type display names -> engine pattern ids.
_NORMALIZE = {
    "VCP": "vcp",
    "Flat Base Breakout": "flat_base", "Flat Base": "flat_base",
    "High Tight Flag (Powerplay)": "high_tight_flag", "High Tight Flag": "high_tight_flag",
    "Classic Flag/Pullback": "bull_flag", "Bull Flag": "bull_flag",
    "Power Earnings Gap": "power_earnings_gap", "News Gappers": "power_earnings_gap",
    "Episodic Pivot": "episodic_pivot",
    "Classic U&R": "u_and_r", "U&R (Undercut & Rally)": "u_and_r",
    "Remount": "remount",
    "Cup w/ Handle": "cup_handle_uct", "Cup with Handle": "cup_handle_uct",
}


def _norm(setup_type: str):
    if setup_type in _NORMALIZE:
        return _NORMALIZE[setup_type]
    s = (setup_type or "").strip().lower().replace(" ", "_")
    return s if s in FOCUSED_SETUPS else None


def _modelbook_truth() -> list[dict]:
    out = []
    try:
        from api.services import modelbook_service as mb
        for yr in mb.list_years():
            for stk in (mb.get_stocks_for_year(yr) or []):
                detail = mb.get_stock_detail(stk["id"]) or {}
                sym = detail.get("symbol")
                if not sym:
                    continue
                for su in detail.get("setups", []):
                    sid = _norm(su.get("setup_type"))
                    if sid:
                        out.append({"symbol": sym, "setup": sid,
                                    "label_date": su.get("label_date"),
                                    "timeframe": su.get("timeframe") or "D"})
    except Exception as e:
        log.warning("[pv-eval] truth load failed: %s", e)
    return out


def evaluate(*, judge_fn=None, max_rows=None) -> dict:
    """Per-setup recall vs the Model Book. judge_fn(symbol, setup, label_date) ->
    {"confirmed": bool} is injected in tests; default judges live via the orchestrator."""
    if judge_fn is None:
        def judge_fn(sym, setup, date):
            from . import orchestrator as orch, store
            orch.judge_ticker(sym, force=True)
            v = store.get_verdict(sym, "D", setup, date) or {}
            return {"confirmed": bool(v.get("confirmed"))}

    truth = _modelbook_truth()
    if max_rows:
        truth = truth[:max_rows]
    per = defaultdict(lambda: {"truth": 0, "detected": 0, "confirmed": 0, "recall": 0.0})
    for row in truth:
        p = per[row["setup"]]
        p["truth"] += 1
        try:
            if judge_fn(row["symbol"], row["setup"], row["label_date"]).get("confirmed"):
                p["confirmed"] += 1
        except Exception as e:
            log.warning("[pv-eval] judge %s failed: %s", row, e)
    for p in per.values():
        p["recall"] = round(p["confirmed"] / p["truth"], 3) if p["truth"] else 0.0
    return {"per_setup": dict(per), "false_positive_rate": None, "n": len(truth)}
