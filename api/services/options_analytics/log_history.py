"""History surfaces read from OUR options log only (the same store `research/iv_history.py` reads):

  * straddle_history  (FT-009) — the front ATM straddle each logged session, in dollars and as a
                                  percent of the underlying.
  * daily_move        (FT-007) — each logged session's implied 1-day move (ATM IV / sqrt 252)
                                  against the move that followed to the NEXT logged session.
  * iv_crush          (FT-010) — ATM IV at -5..+5 sessions around each earnings print.

⛔ THE LOG BEGAN 2026-09-30. Every answer carries `n`, `logging_began`, the sessions it should
  hold and does not, and — where a summary needs more than it has — the count it needs and the
  first session the summary can exist on. A summary below its minimum is a sentence, never a
  number.
⛔ A SESSION THE LOG DID NOT RECORD IS A GAP, NEVER INTERPOLATED. A daily-move pair needs two
  CONSECUTIVE trading sessions both logged; a missed day breaks the pair, it is not bridged.
⛔ Computed values say so (`label`); the inputs (ATM IV, straddle mids, underlying price) are the
  vendor's, recorded by `options_universe_log.py` at 16:30 ET.
⛔ Blocking reads (R2 mirror, gzip): callers are plain `def` routes.
"""
from __future__ import annotations

import datetime as _dt
import math
from typing import Callable, Optional

from api.services.options_analytics import move_convention as _mc

DAILY_MOVE_MIN_PAIRS = 20
CRUSH_MIN_PRINTS = 4
CRUSH_OFFSETS = tuple(range(-5, 6))
SQRT_252 = math.sqrt(_mc.SESSIONS_PER_YEAR)  # O11: the one convention, one session = IV / sqrt(252)


def _ivh():
    from api.services.research import iv_history
    return iv_history


def _rows(sym: str, store=None) -> tuple:
    """(manifests, [(session, row|None)]) for every logged session, oldest first."""
    ivh = _ivh()
    store = store or ivh.get_store()
    manifests = store.sessions()
    return store, manifests, [(d, ivh._day_row(store, d, sym)) for d in sorted(manifests)]


def _coverage(manifests: dict, now: Optional[_dt.datetime]) -> dict:
    ivh = _ivh()
    if not manifests:
        return {"logging_began": None, "missing_sessions": [], "as_of": None}
    began = min(manifests)
    return {"logging_began": began,
            "missing_sessions": [d for d in ivh.expected_sessions(began, now) if d not in manifests],
            # TERM-019: the newest session the log recorded (written 16:30 ET that day).
            "as_of": max(manifests)}


def _nth_trading_after(start: str, n: int) -> Optional[str]:
    from api.services import session_calendar
    d, k = _dt.date.fromisoformat(start), 0
    try:
        while k < n:
            d += _dt.timedelta(days=1)
            if session_calendar.is_trading_day(d):
                k += 1
    except Exception:  # noqa: BLE001 -- past the calendar horizon: no date rather than a guess
        return None
    return d.isoformat()


# ── FT-009 straddle history ────────────────────────────────────────────────────

STRADDLE_METHOD = ("The front straddle: first expiry after the session, strike closest to the "
                   "underlying with a two-sided quote on both legs, call mid + put mid, recorded "
                   "at 16:30 ET. As a percent of the underlying it is the market's priced move to "
                   "that expiry. Its days to expiry changes session to session and is shown.")


def straddle_history(sym: str, *, now: Optional[_dt.datetime] = None, store=None) -> dict:
    ivh = _ivh()
    _, manifests, rows = _rows(sym, store)
    pts, absent = [], []
    for d, r in rows:
        st = ivh._num((r or {}).get("front_straddle"))
        px = ivh._num((r or {}).get("underlying_price"))
        if r is None or st is None or not px:
            absent.append(d)
            continue
        pts.append({"date": d, "straddle": round(st, 4), "straddle_pct": round(st / px * 100, 3),
                    "underlying_price": px, "front_expiration": r.get("front_expiration") or None,
                    "front_dte": int(ivh._num(r.get("front_dte"))) if ivh._num(r.get("front_dte")) is not None else None,
                    "front_strike": ivh._num(r.get("front_strike"))})
    return {"symbol": sym, "label": "computed from vendor quotes", "source": ivh.SOURCE,
            "method": STRADDLE_METHOD, "points": pts, "n": len(pts),
            "sessions_without_straddle": absent, **_coverage(manifests, now)}


# ── FT-007 daily implied vs actual ─────────────────────────────────────────────

DAILY_METHOD = ("Implied 1-day move = the session's ATM IV / sqrt(252), a one-standard-deviation "
                "day (ATM IV from the expiry closest to 30 days). Actual = the underlying's change "
                "from that session's 16:30 ET log to the NEXT trading session's. A pair needs both "
                "sessions logged; a missed day is a gap, never bridged.")


def daily_move(sym: str, *, now: Optional[_dt.datetime] = None, store=None) -> dict:
    ivh = _ivh()
    from api.services import session_calendar  # noqa: F401  -- _next_trading_day uses it
    _, manifests, rows = _rows(sym, store)
    by_date = {d: r for d, r in rows if r is not None}
    pairs, broken = [], []
    for d, r in rows:
        if r is None:
            continue
        nxt = ivh._next_trading_day(_dt.date.fromisoformat(d)).isoformat()
        iv, px = ivh._num(r.get("atm_iv")), ivh._num(r.get("underlying_price"))
        if nxt not in by_date:
            if nxt in manifests or nxt < max(manifests):
                broken.append({"date": d, "next": nxt, "reason": "the next session has no row for this symbol"
                               if nxt in manifests else "the next session was not logged"})
            continue
        px2 = ivh._num(by_date[nxt].get("underlying_price"))
        if iv is None or not px or not px2:
            broken.append({"date": d, "next": nxt, "reason": "no ATM IV or price on one side"})
            continue
        implied = iv / SQRT_252 * 100
        actual = (px2 / px - 1) * 100
        pairs.append({"date": d, "next": nxt, "atm_iv": iv, "implied_move_pct": round(implied, 3),
                      "actual_move_pct": round(actual, 3), "ratio": round(abs(actual) / implied, 2) if implied else None,
                      "inside": abs(actual) <= implied, "rule": r.get("_rule")})
    n = len(pairs)
    out = {"symbol": sym, "label": "computed", "source": ivh.SOURCE, "method": DAILY_METHOD,
           "pairs": pairs, "n": n, "broken_pairs": broken, "min_pairs": DAILY_MOVE_MIN_PAIRS,
           "summary": None, "summary_note": None, **_coverage(manifests, now)}
    if n >= DAILY_MOVE_MIN_PAIRS:
        out["summary"] = {"pairs": n, "inside_share": round(sum(p["inside"] for p in pairs) / n * 100, 1),
                          "mean_ratio": round(sum(p["ratio"] for p in pairs) / n, 2)}
    else:
        last = pairs[-1]["next"] if pairs else (max(manifests) if manifests else None)
        when = _nth_trading_after(last, DAILY_MOVE_MIN_PAIRS - n) if last else None
        out["summary_note"] = (f"{n} pair{'s' if n != 1 else ''} so far; how often the move stayed "
                               f"inside the implied move needs {DAILY_MOVE_MIN_PAIRS}"
                               + (f" (first possible {when})." if when else "."))
    return out


# ── FT-010 IV crush around earnings ────────────────────────────────────────────

CRUSH_METHOD = ("ATM IV (expiry closest to 30 days, from our log) at each trading session from 5 "
                "before to 5 after the print. Session 0 is the last session before the "
                "announcement for a pre-market or unknown-timing print, the announcement day for "
                "an after-close print. A session the log did not record is blank.")


def _default_prints(sym: str) -> list:
    return _ivh()._default_prints(sym)


_prints: Callable[[str], list] = _default_prints


def _shift(d: _dt.date, k: int) -> _dt.date:
    ivh = _ivh()
    for _ in range(abs(k)):
        d = ivh._next_trading_day(d) if k > 0 else ivh._prev_trading_day(d)
    return d


def iv_crush(sym: str, *, now: Optional[_dt.datetime] = None, store=None) -> dict:
    ivh = _ivh()
    _, manifests, rows = _rows(sym, store)
    iv_by = {d: ivh._num(r.get("atm_iv")) for d, r in rows if r is not None}
    began = min(manifests) if manifests else None
    today = (now or _dt.datetime.now(ivh._ET)).astimezone(ivh._ET).date()
    out_rows, before_log = [], 0
    for q in (_prints(sym) or [])[:13]:
        try:
            rd = _dt.date.fromisoformat((q.get("reportedDate") or "")[:10])
        except ValueError:
            continue
        timing = (q.get("reportTime") or "").lower()
        from api.services.options_backtest import timing_of
        when = timing_of(timing)                      # 'amc' / 'bmo' / None, the backtest's reader
        known = when is not None
        anchor = rd if when == "amc" else ivh._prev_trading_day(rd)
        window = {k: _shift(anchor, k).isoformat() for k in CRUSH_OFFSETS}
        if began is None or window[5] < began:
            before_log += 1
            continue
        cells = {}
        for k, d in window.items():
            if _dt.date.fromisoformat(d) > today:
                cells[str(k)] = None
            else:
                cells[str(k)] = iv_by.get(d)
        have = [v for v in cells.values() if v is not None]
        # O4: with the timing unknown, session 0 is a guess (before the open), and for an
        # after-the-close name the "crush" would measure the wrong day. The IV path is still
        # shown; the crush number is left blank and the row says why.
        out_rows.append({"report_date": rd.isoformat(), "timing": timing or "unknown",
                         "session_0": anchor.isoformat(), "iv": cells,
                         "complete": known and len(have) == len(CRUSH_OFFSETS),
                         "crush_pct": (round((cells["1"] / cells["0"] - 1) * 100, 1)
                                       if known and cells.get("0") and cells.get("1") else None),
                         "crush_note": None if known else
                         "Report time (before the open or after the close) not on file; no crush is computed."})
    complete = [r for r in out_rows if r["complete"]]
    out = {"symbol": sym, "label": "computed", "source": ivh.SOURCE, "method": CRUSH_METHOD,
           "offsets": list(CRUSH_OFFSETS), "prints": out_rows, "prints_before_log": before_log,
           "complete_prints": len(complete), "min_prints": CRUSH_MIN_PRINTS, "summary": None,
           "summary_note": None, "logging_began": began,
           "as_of": max(manifests) if manifests else None}
    if len(complete) >= CRUSH_MIN_PRINTS:
        def col(k):
            return [r["iv"][str(k)] for r in complete]
        out["summary"] = {stat: {str(k): round(fn(col(k)), 4) for k in CRUSH_OFFSETS}
                          for stat, fn in (("average", lambda v: sum(v) / len(v)), ("max", max), ("min", min))}
    else:
        out["summary_note"] = (f"{len(complete)} print{'s' if len(complete) != 1 else ''} with all 11 "
                               f"sessions logged; average/max/min rows need {CRUSH_MIN_PRINTS}. "
                               + (f"Logging began {began}; prints before it cannot be read."
                                  if began else "The options log holds no sessions yet."))
    return out
