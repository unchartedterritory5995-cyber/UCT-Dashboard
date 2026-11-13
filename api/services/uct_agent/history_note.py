"""The `history.afterEvent` request → Market Intelligence's event-study request (W2-B2, builder-b). PURE: no reads.

Shared by the gateway kind (`marketdata/history_event_study.py`) and the turn's local-result boundary (`turn.py`,
which rebuilds a LOCAL-ONLY row's note from the member's validated request and may import NO gateway module —
agent-qa L6). Lives outside `marketdata/` for that reason.
"""
from __future__ import annotations

INDICATORS = ("gap_pct", "pct_from_sma", "rsi", "bb_pct_b", "macd_hist", "pct_from_high", "day_pct")
NO_PERIOD = ("gap_pct", "macd_hist", "day_pct")
ALLOWED_SERIES_KINDS = ("technical",)
DEFAULT_HORIZONS = (1, 5, 21)


def study_request(params: dict) -> dict:
    """Capability params → the event study's own request. Shape only; `event_study.validate` judges it."""
    sym = str(params.get("symbol") or "").strip().upper()
    ind = params.get("indicator")
    series = {"kind": "technical", "symbol": sym, "indicator": ind}
    if ind not in NO_PERIOD:
        series["period"] = params.get("period")
    hz = params.get("horizons")
    if not isinstance(hz, list) or not hz:
        hz = list(DEFAULT_HORIZONS)
    return {
        "condition": {"series": series, "op": params.get("op"), "threshold": params.get("threshold")},
        "symbol": sym,
        "horizons": [{"sessions": n} for n in hz],
        "episodes": params.get("episodes") or "first",
        "entry": params.get("entry") or "event_close",
        "non_overlapping": False, "baseline": True,
        "start": params.get("since"), "end": None,
        # Phase 2 history: "the last N times" — the most recent N events, chosen by date alone (event_study.MAX_LAST)
        **({"last": params["last"]} if params.get("last") is not None else {}),
    }


def request_note(params: dict) -> str:
    """The value-free note of a VALIDATED request (symbol, condition, windows, dates) — "" when it does not validate."""
    from api.services.market_intel import event_study
    if not isinstance(params, dict):
        return ""
    ok, err = event_study.validate(study_request(params), allowed_kinds=ALLOWED_SERIES_KINDS)
    if err or not ok:
        return ""
    return str(event_study.request_note(study_request(params)) or "")[:300]
