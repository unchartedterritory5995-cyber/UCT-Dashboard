"""UCT Signature: Flow-Confirmed Breakout (fcb-v2). Daily timeframe, v1.

Closed-bar discipline: a bar is only evaluated once a later bar exists,
EXCEPT when the nightly sweep (post-close) passes include_last=True.
Nothing here may ever evaluate a forming bar in a user-request path.
"""
from __future__ import annotations

import csv
from datetime import datetime, timezone

from api.services.signature import rules
from api.services.signature.rules import parse_money

# The only three fields the flow→bar join reads. The flow CSV ships 22 columns
# (`flow_db.COLUMNS`); keeping full row dicts for a 90-day SPY history is a
# ~155MB transient on a 512MB pod, most of it never read.
FLOW_COLS = ("CreatedDate", "CallPut", "Premium")


def flow_by_date(lines, *, cutoff_iso: str = "") -> dict[str, list[dict]]:
    """Stream a flow CSV into `{iso_date: [{CreatedDate, CallPut, Premium}]}`.

    Takes an ITERABLE OF LINES (what `httpx.Response.iter_lines()` yields) and
    feeds `csv.reader` directly, so nothing bigger than one row is ever held.

    It lives HERE, next to `_bar_date_iso`, because the whole point of it is
    that the two agree — and because both flow readers need it. The router and
    the nightly sweep each grew their own copy of this normalization; they were
    the same eight lines with the same trap, and one of them had already
    diverged into materializing the whole body. Two copies of a silent-failure
    rule is one copy too many.

    Three things are load-bearing:

    * **Columns are resolved BY NAME from the header.** Upstream owns the column
      order (`flow_db.COLUMNS`); a positional read keeps working right up until
      someone inserts a column, and then parses a Symbol string as a premium —
      silently, toward no signal. A header missing one of the three RAISES
      rather than returning an empty join.
    * **The date key must agree with `_bar_date_iso`.** The flow table's
      `CreatedDate` is M/D/YYYY; the bar side is YYYYMMDD/ISO/epoch. If the two
      normalizations drift, the join matches nothing and the indicator ships
      silently dead — there is no error anywhere, just zero signals.
    * **`cutoff_iso` drops rows older than the oldest bar** the caller fetched.
      ISO dates sort chronologically, so the comparison is a plain string one.
    """
    reader = csv.reader(lines)
    header = next(reader, None)
    if header is None:
        return {}

    idx = {}
    for name in FLOW_COLS:
        try:
            idx[name] = header.index(name)
        except ValueError as exc:
            raise ValueError(f"flow CSV header is missing {name!r}: {header!r}") from exc
    width = max(idx.values()) + 1

    by_date: dict[str, list[dict]] = {}
    for row in reader:
        if len(row) < width:
            continue
        try:
            m, day, y = row[idx["CreatedDate"]].split("/")
            iso = f"{int(y):04d}-{int(m):02d}-{int(day):02d}"
        except (ValueError, AttributeError):
            continue
        if cutoff_iso and iso < cutoff_iso:
            continue
        by_date.setdefault(iso, []).append({name: row[i] for name, i in idx.items()})
    return by_date


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
    # max(..., 1.0) floors the OPPOSITE side: a zero or (from bad upstream data)
    # negative put sum must not make the dominance ratio trivially satisfiable.
    if direction == "bull":
        confirmed = call_prem >= min_prem and call_prem >= dominance * max(put_prem, 1.0)
    else:
        confirmed = put_prem >= min_prem and put_prem >= dominance * max(call_prem, 1.0)
    return {"confirmed": confirmed, "callPrem": call_prem, "putPrem": put_prem}


def _bar_date_iso(bar_time) -> str:
    """Session date for a bar timestamp, tolerant of BOTH store encodings.

    bars_sqlite stores daily/weekly/monthly ts as a YYYYMMDD integer
    (20260731) and intraday ts as unix seconds. Decoding a YYYYMMDD key as
    an epoch silently yields 1970-08-23 for EVERY 2026 session, so the flow
    join would match nothing and the indicator would ship dead.
    """
    try:
        s = str(bar_time).strip()
        if "-" in s:                        # already ISO (the /api/bars JSON shape)
            return s[:10]
        n = int(float(s))
        if 10_000_000 <= n <= 99_999_999:   # YYYYMMDD calendar key
            d = str(n)
            return f"{d[:4]}-{d[4:6]}-{d[6:]}"
        return datetime.fromtimestamp(n, tz=timezone.utc).date().isoformat()
    except (ValueError, TypeError, OverflowError, OSError):
        return ""                            # garbage -> no flow match, never raises


def fcb_signals(bars, flow_by_date, *, include_last=False):
    signals = []
    for b in detect_breakouts(bars, include_last=include_last):
        rows = flow_by_date.get(_bar_date_iso(b["barTime"]), [])
        conf = flow_confirms(rows, b["direction"])
        if conf["confirmed"]:
            signals.append({**b, **{k: conf[k] for k in ("callPrem", "putPrem")},
                            "version": rules.VERSIONS["fcb"]})
    return signals
