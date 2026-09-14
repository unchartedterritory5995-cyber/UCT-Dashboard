"""OUTCOME engine, methodology outcomes-v1 (manifest §7.3; docs/wisdom/methodology/metrics-v1.md).

Pure: a record dict and a BarsAsOf in, one wisdom_outcomes row out. No writes here.

WHAT THIS DELIBERATELY DOES NOT COPY
  * pattern_engine.memory._resolve_outcome checks the stop FIRST on a bar that spans both stop
    and target and books it a loss. Here that bar is `same_bar_ambiguity=1` and stays unresolved
    unless 5-minute bars for that session say which level traded first.
  * that function also skips the MFE/MAE update on the resolving bar. Here every horizon window
    includes its last bar.
  * ENGINE resolver._horizons measures from the entry level on unadjusted yfinance bars. Here the
    anchor follows §7.3 and the bars are the split-adjusted store.

ANCHOR (outcomes-v1)
  stated with minute precision before 16:00 ET on a session day  -> anchor session = that day
  otherwise (after 16:00, non-session day, day/week precision)   -> anchor session = next session
  anchor price: the stated entry if the anchor session's range traded through it,
                else that session's close (same-session) or open (next-session).
  The anchor bar itself counts toward MFE/MAE and level hits only for the next-open anchor: for
  a close or an in-bar entry, the daily bar cannot say what traded before the anchor.
"""
from __future__ import annotations

import json
from datetime import date, datetime, time
from typing import Any, Optional

from api.services.wisdom.core import timeutil
from api.services.wisdom.evals.bars_asof import Bar, BarsAsOf, int_to_date, last_closed_session_date

METHODOLOGY_VERSION = "outcomes-v1"
HORIZONS = (1, 3, 5, 10, 20)
MAX_HORIZON = max(HORIZONS)
RECONCILE_LOOKBACK_SESSIONS = 60
_PAST_STANCES = frozenset({"exited", "stopped_out", "trimmed", "hindsight"})


def _iso(session: Optional[int]) -> Optional[str]:
    return int_to_date(session).isoformat() if session else None


def _num(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


def _targets(record: dict) -> list[float]:
    raw = record.get("targets_json", record.get("targets"))
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = []
    out = []
    for item in raw or []:
        price = _num(item.get("price") if isinstance(item, dict) else item)
        if price is not None and price > 0:
            out.append(price)
    return out


def _stated_entry(record: dict) -> Optional[float]:
    entry = _num(record.get("entry"))
    if entry is not None and entry > 0:
        return entry
    lo, hi = _num(record.get("entry_zone_lo")), _num(record.get("entry_zone_hi"))
    if lo and hi and lo > 0 and hi > 0:
        return round((lo + hi) / 2.0, 6)
    return None


def _pct(sign: int, anchor: float, price: float) -> float:
    return round(sign * (price - anchor) / anchor * 100.0, 4)


def _crossed_stop(direction: str, bar: Bar, stop: float) -> bool:
    return bar.l <= stop if direction == "long" else bar.h >= stop


def _crossed_target(direction: str, bar: Bar, target: float) -> bool:
    return bar.h >= target if direction == "long" else bar.l <= target


def _empty_row(record_id: str, reason: str, now_iso: str, **extra) -> dict:
    row = {
        "record_id": record_id, "methodology_version": METHODOLOGY_VERSION,
        "anchor_session": None, "anchor_price": None, "anchor_rule": None,
        "ret_1": None, "ret_3": None, "ret_5": None, "ret_10": None, "ret_20": None,
        "mfe_pct": None, "mae_pct": None, "stop_hit": None, "stop_hit_session": None,
        "target_hit": None, "target_hit_session": None, "same_bar_ambiguity": 0,
        "resolved_with_intraday": 0, "n_sessions_available": 0, "reconciliation": None,
        "unverifiable_reason": reason, "computed_at": now_iso, "horizons_json": json.dumps({}),
    }
    row.update(extra)
    return row


def compute(record: dict, bars: BarsAsOf, *, now: Optional[datetime] = None) -> dict:
    """-> {"status": "computed" | "pending" | "unverifiable", "row": dict | None, "reason": str | None}

    pending      the anchor session has not closed yet; nothing is written.
    unverifiable written with the named reason; every number stays NULL, never 0.
    computed     written; individual horizons may still be null (immature or a missing bar),
                 and horizons_json names which and why.
    """
    now_iso = timeutil.iso_et(now or timeutil.now_et())
    rid = str(record.get("record_id"))
    ticker = (record.get("ticker") or "").strip().upper()
    direction = (record.get("direction") or "").strip().lower()
    stated = timeutil.parse_iso(record.get("stated_at_et"))
    precision = record.get("stated_at_precision") or "minute"

    if not ticker:
        return {"status": "unverifiable", "reason": "no_ticker", "row": _empty_row(rid, "no_ticker", now_iso)}
    if direction not in ("long", "short"):
        return {"status": "unverifiable", "reason": "no_direction", "row": _empty_row(rid, "no_direction", now_iso)}
    if stated is None:
        return {"status": "unverifiable", "reason": "no_stated_at", "row": _empty_row(rid, "no_stated_at", now_iso)}
    sign = 1 if direction == "long" else -1

    stated_day = stated.date()
    first = bars.next_session_on_or_after(stated_day)
    if first is None:
        return {"status": "pending", "reason": "anchor_session_not_closed", "row": None}
    same_session = precision == "minute" and stated.time() < time(16, 0) and first == ymd(stated_day)
    if same_session:
        anchor_session = first
    else:
        after = bars.sessions_from(date.fromordinal(stated_day.toordinal() + 1), 1)
        if not after:
            return {"status": "pending", "reason": "anchor_session_not_closed", "row": None}
        anchor_session = after[0]

    calendar = bars.sessions_from(int_to_date(anchor_session), MAX_HORIZON + 1)
    ticker_bars = {b.d: b for b in bars.daily_from(ticker, int_to_date(anchor_session), MAX_HORIZON + 1)}
    anchor_bar = ticker_bars.get(anchor_session)
    if anchor_bar is None:
        reason = f"no_bar_for_anchor_session:{_iso(anchor_session)}"
        return {"status": "unverifiable", "reason": reason,
                "row": _empty_row(rid, reason, now_iso, anchor_session=_iso(anchor_session))}

    entry = _stated_entry(record)
    if entry is not None and anchor_bar.l <= entry <= anchor_bar.h:
        anchor_price, rule, start = entry, "stated_entry_traded", 1
    elif same_session:
        anchor_price, rule, start = anchor_bar.c, "session_close", 1
    else:
        anchor_price, rule, start = anchor_bar.o, "next_open", 0

    # consecutive forward sessions with a bar for this ticker
    available = 0
    first_missing: Optional[int] = None
    for session in calendar[1:]:
        if session in ticker_bars:
            available += 1
        else:
            first_missing = session
            break

    horizons: dict = {}
    row = _empty_row(rid, None, now_iso, anchor_session=_iso(anchor_session),
                     anchor_price=round(anchor_price, 6), anchor_rule=rule, n_sessions_available=available)
    widest = None
    for n in HORIZONS:
        if len(calendar) <= n:
            horizons[str(n)] = {"status": "immature"}
            continue
        window_sessions = calendar[start:n + 1]
        missing = [s for s in window_sessions if s not in ticker_bars]
        if missing:
            horizons[str(n)] = {"status": "unverifiable", "reason": f"missing_bar:{_iso(missing[0])}"}
            continue
        window = [ticker_bars[s] for s in window_sessions]
        exit_bar = ticker_bars[calendar[n]]
        if sign == 1:
            mfe = _pct(1, anchor_price, max(b.h for b in window))
            mae = _pct(1, anchor_price, min(b.l for b in window))
        else:
            mfe = _pct(-1, anchor_price, min(b.l for b in window))
            mae = _pct(-1, anchor_price, max(b.h for b in window))
        ret = _pct(sign, anchor_price, exit_bar.c)
        horizons[str(n)] = {"status": "ok", "ret": ret, "mfe": mfe, "mae": mae, "exit_session": _iso(calendar[n]),
                            "bars_in_window": len(window)}
        row[f"ret_{n}"] = ret
        widest = n
    if widest is not None:
        row["mfe_pct"] = horizons[str(widest)]["mfe"]
        row["mae_pct"] = horizons[str(widest)]["mae"]
        row["mfe_mae_horizon"] = widest

    # stop / first target, scanned over the consecutive available window
    stop = _num(record.get("stop"))
    targets = _targets(record)
    target = targets[0] if targets else None
    scan = [ticker_bars[s] for s in calendar[start:available + 1] if s in ticker_bars]
    stop_session = next((b.d for b in scan if stop is not None and _crossed_stop(direction, b, stop)), None)
    target_session = next((b.d for b in scan if target is not None and _crossed_target(direction, b, target)), None)
    if stop is not None:
        row["stop_hit"] = 1 if stop_session else 0
        row["stop_hit_session"] = _iso(stop_session)
    if target is not None:
        row["target_hit"] = 1 if target_session else 0
        row["target_hit_session"] = _iso(target_session)

    first_hit = None
    if stop_session and target_session:
        if stop_session < target_session:
            first_hit = "stop"
        elif target_session < stop_session:
            first_hit = "target"
        else:
            row["same_bar_ambiguity"] = 1
            first_hit = "ambiguous"
            for bar in bars.intraday_session(ticker, stop_session):
                s_hit, t_hit = _crossed_stop(direction, bar, stop), _crossed_target(direction, bar, target)
                if s_hit and t_hit:
                    break
                if s_hit or t_hit:
                    first_hit = "stop" if s_hit else "target"
                    row["resolved_with_intraday"] = 1
                    break
    elif stop_session:
        first_hit = "stop"
    elif target_session:
        first_hit = "target"

    flags = []
    if stop is not None and sign * (anchor_price - stop) <= 0:
        flags.append("stop_not_beyond_anchor")
    if target is not None and sign * (target - anchor_price) <= 0:
        flags.append("target_not_beyond_anchor")
    row["reconciliation"], recon_reason = reconcile(record, bars, stated, precision)
    row["horizons_json"] = json.dumps({
        "horizons": horizons, "first_hit": first_hit, "target_used": target, "stop_used": stop,
        "window_start_index": start, "first_missing_session": _iso(first_missing),
        "flags": flags, "reconciliation_reason": recon_reason,
    }, sort_keys=True)
    row.pop("mfe_mae_horizon", None)
    matured_ok = [h for h in horizons.values() if h["status"] == "ok"]
    matured_bad = [h for h in horizons.values() if h["status"] == "unverifiable"]
    if not matured_ok and matured_bad:
        row["unverifiable_reason"] = matured_bad[0]["reason"]
        return {"status": "unverifiable", "reason": row["unverifiable_reason"], "row": row}
    return {"status": "computed", "reason": None, "row": row}


def ymd(d: date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def reconcile(record: dict, bars: BarsAsOf, stated: datetime, precision: str) -> tuple[Optional[str], Optional[str]]:
    """Stated-vs-computed reconciliation, CONTENT-STATED ONLY (W1 Part 10: no fills, no Journal).

    A stated outcome describes the PAST, so it is checked against bars up to the last session
    that had closed when it was said (RECONCILE_LOOKBACK_SESSIONS of them), never forward bars:
      stopped / breakeven  with a stated stop                  -> did price trade at that stop?
      profit / loss        with a stated entry AND return pct  -> did price trade at the entry AND
                                                                  at the exit that return implies?
    Anything the text does not pin to a number is `unverifiable`, with the reason."""
    outcome = record.get("stated_outcome")
    if not outcome:
        return None, None
    direction = (record.get("direction") or "long").lower()
    sign = -1 if direction == "short" else 1
    ticker = (record.get("ticker") or "").upper()
    lookback_end = last_closed_session_date(stated, precision)
    window = bars.history(ticker, lookback_end, RECONCILE_LOOKBACK_SESSIONS) if ticker else []

    def traded(price: float) -> bool:
        return any(b.l <= price <= b.h for b in window)

    if outcome in ("stopped", "breakeven"):
        stop = _num(record.get("stop"))
        if stop is None and outcome == "breakeven":
            stop = _num(record.get("entry"))
        if stop is None:
            return "unverifiable", "no_stated_stop"
        if not window:
            return "unverifiable", "no_bars_before_statement"
        if traded(stop):
            return "agrees", "price_traded_at_stated_stop"
        return ("disagrees", "stated_stop_never_traded_in_lookback") if len(window) >= 20 \
            else ("unverifiable", "lookback_under_20_sessions")
    if outcome in ("profit", "loss"):
        entry, pct = _num(record.get("entry")), _num(record.get("stated_return_pct"))
        if entry is None or pct is None:
            return "unverifiable", "no_stated_entry_and_return"
        if not window:
            return "unverifiable", "no_bars_before_statement"
        if outcome == "loss" and pct > 0:
            pct = -pct                      # "lost 5%" is usually written as a magnitude
        if outcome == "profit" and pct < 0:
            return "unverifiable", "stated_return_sign_contradicts_stated_outcome"
        exit_price = entry * (1 + sign * pct / 100.0)
        if traded(entry) and traded(exit_price):
            return "agrees", "price_traded_at_entry_and_implied_exit"
        return ("disagrees", "entry_or_implied_exit_never_traded_in_lookback") if len(window) >= 20 \
            else ("unverifiable", "lookback_under_20_sessions")
    return "unverifiable", f"stated_outcome_{outcome}_has_no_checkable_level"


def needs_refresh(existing: Optional[dict]) -> bool:
    """Refresh until all 20 sessions have closed; an anchor-level failure is final."""
    if existing is None:
        return True
    if existing.get("methodology_version") != METHODOLOGY_VERSION:
        return True
    reason = existing.get("unverifiable_reason") or ""
    if reason in ("no_ticker", "no_direction", "no_stated_at"):
        return False
    if reason.startswith("no_bar_for_anchor_session"):
        return False
    return int(existing.get("n_sessions_available") or 0) < MAX_HORIZON


def quality_weight(outcome: Optional[dict]) -> Optional[float]:
    """quality-v1, the 6.3 weight in [0, 1] (metrics-v1.md §6.3).

    1.0  first target traded before the stop (daily bars, or 5-minute bars on a shared bar)
    0.0  stop traded first
    else R at 10 sessions (fallback 5, then 20): clip(0.5 + R/4); R = return / stated risk when a
         stop is stated, else clip(0.5 + return%/20).
    None when nothing has matured (excluded from the weighted population, counted in notes)."""
    if not outcome:
        return None
    try:
        detail = json.loads(outcome.get("horizons_json") or "{}")
    except ValueError:
        detail = {}
    first = detail.get("first_hit")
    if first == "target":
        return 1.0
    if first == "stop":
        return 0.0
    ret = next((outcome.get(k) for k in ("ret_10", "ret_5", "ret_20") if outcome.get(k) is not None), None)
    if ret is None:
        return None
    anchor, stop = _num(outcome.get("anchor_price")), _num(detail.get("stop_used"))
    if anchor and stop and abs(anchor - stop) > 0:
        risk_pct = abs(anchor - stop) / anchor * 100.0
        value = 0.5 + (float(ret) / risk_pct) / 4.0
    else:
        value = 0.5 + float(ret) / 20.0
    return round(min(1.0, max(0.0, value)), 6)
