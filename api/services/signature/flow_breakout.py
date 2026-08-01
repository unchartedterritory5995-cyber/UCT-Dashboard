"""UCT Signature: Flow-Confirmed Breakout (fcb-v1). Daily timeframe, v1.

Closed-bar discipline: a bar is only evaluated once a later bar exists,
EXCEPT when the nightly sweep (post-close) passes include_last=True.
Nothing here may ever evaluate a forming bar in a user-request path.
"""
from __future__ import annotations

from datetime import datetime, timezone

from api.services.signature import rules
from api.services.signature.rules import parse_money


def _is_call(v) -> bool:
    return str(v or "").strip().upper() in ("CALL", "C")


def _is_put(v) -> bool:
    return str(v or "").strip().upper() in ("PUT", "P")


def detect_breakouts(bars, *, lookback=None, vol_mult=None, include_last=False):
    lookback = rules.FCB_LOOKBACK if lookback is None else lookback
    vol_mult = rules.FCB_VOL_MULT if vol_mult is None else vol_mult
    out = []
    last_evaluable = len(bars) if include_last else len(bars) - 1
    for i in range(lookback, last_evaluable):
        window = bars[i - lookback:i]
        avg_vol = sum(b["v"] for b in window) / lookback
        if avg_vol <= 0 or bars[i]["v"] < vol_mult * avg_vol:
            continue
        hi = max(b["h"] for b in window)
        lo = min(b["l"] for b in window)
        c = bars[i]["c"]
        if c > hi:
            out.append({"barTime": bars[i]["t"], "direction": "bull", "close": c})
        elif c < lo:
            out.append({"barTime": bars[i]["t"], "direction": "bear", "close": c})
    return out


def flow_confirms(flow_rows, direction, *, min_prem=None, dominance=None):
    min_prem = rules.FCB_MIN_CALL_PREM if min_prem is None else min_prem
    dominance = rules.FCB_DOMINANCE if dominance is None else dominance
    # 0.0 start: an all-put (or empty) day must still report a FLOAT callPrem.
    call_prem = sum((parse_money(r.get("Premium"))
                     for r in flow_rows if _is_call(r.get("CallPut"))), 0.0)
    put_prem = sum((parse_money(r.get("Premium"))
                    for r in flow_rows if _is_put(r.get("CallPut"))), 0.0)
    if direction == "bull":
        confirmed = call_prem >= min_prem and call_prem >= dominance * max(put_prem, 1.0)
    else:
        confirmed = put_prem >= min_prem and put_prem >= dominance * max(call_prem, 1.0)
    return {"confirmed": confirmed, "callPrem": call_prem, "putPrem": put_prem}


def _bar_date_iso(bar_time: int) -> str:
    return datetime.fromtimestamp(int(bar_time), tz=timezone.utc).date().isoformat()


def fcb_signals(bars, flow_by_date, *, include_last=False):
    signals = []
    for b in detect_breakouts(bars, include_last=include_last):
        rows = flow_by_date.get(_bar_date_iso(b["barTime"]), [])
        conf = flow_confirms(rows, b["direction"])
        if conf["confirmed"]:
            signals.append({**b, **{k: conf[k] for k in ("callPrem", "putPrem")},
                            "version": rules.VERSIONS["fcb"]})
    return signals
