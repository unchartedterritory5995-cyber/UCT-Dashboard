"""The CURRENT breadth reading for one universe + measure — the breadth side of the UCT Agent
integration contract (`docs/breadth/current-reading-contract.md`).

⭐ WHY (2026-10-12, owner). The Agent answered a present-tense question on a Monday morning with
"as of October 8 close": correct under its finalized-only policy, and useless — Oct 9 was
waiting (by design) for the next session's row before finalizing, and Oct 12 was trading. The
owner's ruling: for "now / currently / today" questions, prefer the latest VALID intraday
reading, label it Intraday with its observation time; outside market hours prefer the latest
completed-session reading and say whether it is provisional or finalized; and NEVER present a
days-old finalized value as current without saying so.

⛔ NO SECOND PIPELINE. Every value here is one the members' charts already show:
  intraday / provisional   `breadth_live_universes` payload (the live bars on /breadth)
  finalized                the canonical store (`breadth_daily_ohlc`, V2/exchange authority)
This module only CHOOSES between them and says what it chose. It never computes inline
(`payload(cached_only=True)` kicks a background refresh when stale).

STATUS
  intraday     today's session in progress; `observed_at` = the VENDOR's observation time of
               the snapshot (`data_as_of`), never UCT's compute time (`computed_at`); current
               only when that observation is ≤ FRESH_MAX_S old
  provisional  a completed session measured from closing prices, not yet finalized
  finalized    the canonical value (what history, backtests and closing questions use)

`current` is True only when the reading is for the session a present-tense question means
(today once the session has started, else the last completed session) AND, for intraday, fresh.
When it is False, `stale_reason` says why — the caller must not present it as "now".
"""
from __future__ import annotations

import logging
import math
import time
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
_log = logging.getLogger("breadth_current")

UNIVERSES = ("us", "nyse", "nasdaq")
#: An intraday payload older than this during market hours is not "now" (refresh is 55 s).
FRESH_MAX_S = 300
#: A provisional session row is only as good as the population it was measured on.
MAX_POPULATION_DRIFT = 0.05

#: Measures with no live reading — finalized only, never "current" mid-session.
#: (the live method withholds these; see `breadth_live_universes._NEVER_PUBLISH`)
FINALIZED_ONLY = ("mcclellan_osc", "mcclellan_sum", "new_ath")
#: ⛔ NOT YET VALIDATED LIVE (2026-10-12 production replay, 20 sessions × US/NYSE/Nasdaq): the
#: new-high / new-low family missed canonical by more than a few names on most sessions — the
#: replay grades the closing-price method while the live rows use the intraday high/low basis,
#: so this is unproven rather than proven wrong. Finalized-only until an NH/NL-basis grade
#: (provisional row vs the session's canonical value once it finalizes) passes.
UNVALIDATED_LIVE = ("new_52w_highs", "new_52w_lows", "net_new_high_low", "new_20d_highs",
                    "new_20d_lows", "hi_ratio", "lo_ratio")
#: Validated, but 1-day counts move by a few dozen names against the finalized value: label
#: them provisional/intraday and never quote them to the single name.
APPROXIMATE_LIVE = ("advancing", "declining", "adv_decline", "unchanged", "magna_up",
                    "magna_down", "stage2_count", "stage4_count")


def accuracy_tier(metric: str) -> str:
    if metric in FINALIZED_ONLY or metric in UNVALIDATED_LIVE:
        return "finalized_only"
    return "approximate" if metric in APPROXIMATE_LIVE else "validated"


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _parse(ts) -> Optional[datetime]:
    try:
        t = datetime.fromisoformat(str(ts))
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=_ET)


def expected_session(now: datetime) -> tuple:
    """(session a present-tense question means, is the market open now)."""
    from api.services import session_calendar as sc
    d = now.date()
    if sc.is_trading_day(d):
        close = sc.close_time(d)
        if now.hour * 100 + now.minute >= 930:
            return d.isoformat(), bool(close and now < close)
    d -= timedelta(days=1)
    for _ in range(10):
        if sc.is_trading_day(d):
            break
        d -= timedelta(days=1)
    return d.isoformat(), False


def _label(status: str, session: str, observed: Optional[datetime]) -> str:
    d = date.fromisoformat(session)
    day = f"{d:%b} {d.day}"
    if status == "intraday":
        if not observed:
            return "Intraday · observation time unknown"
        t = observed.astimezone(_ET)
        return f"Intraday · {t.hour % 12 or 12}:{t:%M} {t:%p} ET"
    if status == "provisional":
        return f"Provisional close · {day}"
    return f"Finalized close · {day}"


def row_observation(payload: Optional[dict], row: dict, now: datetime) -> dict:
    """THE freshness rule for one live-payload row — shared by the Agent contract (`choose`)
    and the member charts (`breadth_live_universes.append_library_bars`), so the two can never
    disagree about whether a reading is live.

    A `final` row is a completed session measured from its closing bars: provisional, observed
    at that session's close, never "stale". Today's row is observed at the VENDOR's snapshot
    time (`data_as_of`), never UCT's compute time: it is a provisional close once that data
    time has reached the close, else intraday — and an intraday row is `fresh` only when its
    market data is <= FRESH_MAX_S old. No data time => unknown => not fresh."""
    from api.services import session_calendar as sc
    d = row.get("date")
    close = sc.close_time(date.fromisoformat(d)) if d else None
    if row.get("final"):
        observed, basis, completed = close, "session_close", True
    else:
        # only the VENDOR's data time says whether the row saw the close — a delayed feed
        # computed at 16:05 still holds data from before 16:00
        observed = _parse((payload or {}).get("data_as_of"))
        basis = "vendor_snapshot" if observed else "unknown"
        completed = bool(close and observed and observed >= close)
    age = (now - observed).total_seconds() if observed else None
    status = "provisional" if completed else "intraday"
    fresh, reason = True, None
    if status == "intraday":
        if observed is None:
            fresh, reason = False, "market-data observation time unavailable"
        elif age > FRESH_MAX_S:
            fresh, reason = False, f"market data is {round(age)}s old (feed delayed or snapshot stale)"
    return {"session": d, "status": status, "observed": observed, "basis": basis,
            "age_s": age, "fresh": fresh, "reason": reason}


def choose(universe: str, metric: str, now: datetime, payload: Optional[dict],
           finalized: dict) -> dict:
    """Pure decision. `payload` = the live-universes payload (or None); `finalized` =
    `{date: value}` canonical for this universe + measure."""
    want, market_open = expected_session(now)
    out = {"universe": universe, "metric": metric, "expected_session": want,
           "market_open": market_open, "accuracy_tier": accuracy_tier(metric)}
    reasons = []

    live = None
    p = payload or {}
    u = (p.get("universes") or {}).get(universe) or {}
    computed = _parse(p.get("as_of"))           # when UCT computed the payload
    observed, basis = None, None
    if metric in FINALIZED_ONLY:
        reasons.append("no live reading exists for this measure")
    elif metric in UNVALIDATED_LIVE:
        reasons.append("the live reading of this measure is not yet validated")
    elif not p.get("ok"):
        reasons.append(f"live breadth unavailable ({p.get('reason') or 'no payload'})")
    elif not u.get("ok"):
        reasons.append(f"live {universe} unavailable ({u.get('reason') or 'not ok'})")
    elif u.get("population_drift") is None or abs(u["population_drift"]) > MAX_POPULATION_DRIFT:
        reasons.append("live population does not reconcile with the canonical universe")
    else:
        for r in reversed(u.get("rows") or []):
            v = _finite((r.get("metrics") or {}).get(metric))
            if v is None:
                continue
            obs = row_observation(p, r, now)
            observed, basis = obs["observed"], obs["basis"]
            live = {"session": obs["session"], "value": v, "status": obs["status"], "obs": obs}
            break
        if live is None:
            reasons.append(f"live {universe} has no {metric} reading")

    fin_dates = sorted(d for d, v in (finalized or {}).items() if _finite(v) is not None)
    fin = ({"session": fin_dates[-1], "value": _finite(finalized[fin_dates[-1]]),
            "status": "finalized"} if fin_dates else None)

    pick = None
    if live and (not fin or live["session"] > fin["session"]):
        pick = live
    elif fin:
        pick = fin
    if pick is None:
        return dict(out, ok=False, current=False, stale_reason="; ".join(reasons) or "no reading")

    is_live = pick is live
    age = (now - observed).total_seconds() if (is_live and observed) else None
    res = dict(out, ok=True, value=pick["value"], status=pick["status"], session=pick["session"],
               observed_at=observed.isoformat() if (is_live and observed) else None,
               observation_basis=basis if is_live else "finalized_close",
               computed_at=computed.isoformat() if (is_live and computed) else None,
               data_age_s=round(age) if age is not None else None,
               compute_lag_s=(round((computed - observed).total_seconds())
                              if (is_live and computed and observed and basis == "vendor_snapshot")
                              else None),
               finalized_session=fin["session"] if fin else None,
               population_drift=u.get("population_drift") if is_live else None)
    current = pick["session"] == want
    if current and pick["status"] == "intraday" and not pick["obs"]["fresh"]:
        # ⛔ freshness is the age of the MARKET DATA, never of the computation: a payload
        # recomputed seconds ago over a delayed or frozen snapshot is not "now"
        current = False
        reasons.append(pick["obs"]["reason"])
    if current and market_open and pick["status"] != "intraday":
        current = False                      # a close while the session trades is not "now"
    if not current and pick["session"] != want:
        reasons.append(f"newest reading is for {pick['session']}, not {want}")
    res["current"] = current
    res["stale_reason"] = None if current else ("; ".join(reasons) or "not current")
    res["label"] = _label(pick["status"], pick["session"], observed if is_live else None)
    return res


def reading(universe: str, metric: str, now: Optional[datetime] = None) -> dict:
    """The contract call. Never computes inline; never raises."""
    u = (universe or "").strip().lower()
    if u not in UNIVERSES:
        return {"ok": False, "current": False, "stale_reason": f"unknown universe {universe!r}"}
    now = now or datetime.now(_ET)
    payload = None
    try:
        from api.services import breadth_live_universes as blu
        if blu.serving():
            payload = blu.payload(cached_only=True)
        else:
            payload = {"ok": False, "reason": "live universes not serving"}
    except Exception as e:                       # noqa: BLE001
        payload = {"ok": False, "reason": f"live read failed: {e}"}
    finalized: dict = {}
    t0 = time.monotonic()
    try:
        from api.services import breadth_daily_ohlc as store
        for d, r in (store.history(metric, limit=15, universe=u) or {}).items():
            if (r or {}).get("c") is not None:
                finalized[d] = r["c"]
    except Exception:                            # noqa: BLE001
        finalized = {}
    _log.info("[breadth_current] reading %s/%s history_ms=%d", u, metric,
              round((time.monotonic() - t0) * 1000))      # value-free: a duration only
    try:
        return choose(u, metric, now, payload, finalized)
    except Exception as e:                       # noqa: BLE001
        return {"ok": False, "current": False, "stale_reason": f"selection failed: {e}"}
