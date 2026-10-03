"""BRK-01 increment 4 (roadmap RM-L01) -- the options strategy backtester, first slice.

THE QUESTION IT ANSWERS
    "If I had bought this structure N trading days before each monthly expiration over the past
    year, at this moneyness, and held it, what would have happened?" -- a historical simulation,
    never a recommendation, and never a trade.

WHAT THE VENDOR HAS, AND WHAT THIS READS (Massive, answered 2026-09-30)
    No historical chains, greeks, IV or open interest. YES historical aggregates, trades and
    QUOTES. So every input here is one of three REST reads the repo already makes
    (`api/services/implied_backfill.py` reconstructs past straddles the same way):
      * `/v2/aggs/ticker/{SYM}/range/1/day/...`  adjusted=false -- the trading calendar and the
        underlying's closes (unadjusted, so they share a scale with the strikes listed THEN);
      * `/v3/reference/options/contracts` with `as_of` -- the strike ladder that EXISTED at entry,
        not today's (which would include strikes listed after the fact);
      * `/v3/quotes/{optionTicker}` -- the last NBBO at or before 16:00 New York on a given
        session. ⛔ NEVER a trade print: a last trade can be hours stale, and a backtest priced off
        prints would be a different statistic wearing the same name.
    No S3 flat file is read: one run needs a few dozen contracts, not a day's whole OPRA file.

THE RULE (first slice)
    For each monthly expiration (the third Friday, or the session before it when that Friday is
    not a session) whose expiry falls inside the lookback: enter at the close N trading days
    before expiry, at the strike `offset` ladder steps from the at-the-money strike, and hold to
    expiry -- or exit at the first session close whose mid-marked value crosses an optional
    take-profit / stop-loss on the debit. Expiry value is INTRINSIC from the underlying's close.

HONESTY RAILS (each is a test in tests/test_options_backtest.py)
    * a leg with no two-sided quote at the entry close is EXCLUDED and COUNTED with its reason --
      never priced off a trade, never silently dropped;
    * fewer than MIN_SUMMARY_N trades: no summary, a sentence saying the sample is too small;
    * the window says where it starts, and the first trade says where the history actually begins;
    * an IV shown is COMPUTED here by Black-Scholes inversion from the entry mid, and labelled so;
    * the vendor request budget per run is fixed and stated; expirations it could not reach are
      COUNTED as not run, never presented as the whole year.

OFF THE REQUEST PATH
    `submit` queues a run on a 2-thread pool and returns at once; `job_status` is what the poll
    reads. Results are cached by (symbol, strategy, params). Runs are de-duplicated in flight.
"""
from __future__ import annotations

import logging
import math
import statistics
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Any, Callable
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)

NY = ZoneInfo("America/New_York")

# Each leg is (type, signed quantity, ladder steps from the anchor in units of `width`). The anchor
# is the at-the-money strike moved `offset` steps; a leg at 0 sits ON the anchor.
STRATEGIES = {
    "long_call": {"label": "Long call", "legs": 1, "type": "call", "spec": (("call", 1, 0),)},
    "long_put": {"label": "Long put", "legs": 1, "type": "put", "spec": (("put", 1, 0),)},
    "bull_call": {"label": "Bull call spread", "legs": 2, "type": "call",
                  "spec": (("call", 1, 0), ("call", -1, 1))},
    "bear_put": {"label": "Bear put spread", "legs": 2, "type": "put",
                 "spec": (("put", 1, 0), ("put", -1, -1))},
}
# FT-011 (lane/o-options-remainders): more structures, served only while
# OPTIONS_BACKTEST_MORE_ENABLED is on (`more_enabled`). Credit structures carry a NEGATIVE debit.
MORE_STRATEGIES = {
    "bear_call": {"label": "Bear call spread (credit)", "legs": 2,
                  "spec": (("call", -1, 0), ("call", 1, 1))},
    "bull_put": {"label": "Bull put spread (credit)", "legs": 2,
                 "spec": (("put", -1, 0), ("put", 1, -1))},
    "long_straddle": {"label": "Long straddle", "legs": 2, "spec": (("call", 1, 0), ("put", 1, 0))},
    "short_straddle": {"label": "Short straddle", "legs": 2, "spec": (("call", -1, 0), ("put", -1, 0))},
    "long_strangle": {"label": "Long strangle", "legs": 2, "spec": (("call", 1, 1), ("put", 1, -1))},
    "short_strangle": {"label": "Short strangle", "legs": 2, "spec": (("call", -1, 1), ("put", -1, -1))},
    "iron_condor": {"label": "Iron condor (credit)", "legs": 4,
                    "spec": (("put", 1, -2), ("put", -1, -1), ("call", -1, 1), ("call", 1, 2))},
    "call_butterfly": {"label": "Long call butterfly", "legs": 3,
                       "spec": (("call", 1, -1), ("call", -2, 0), ("call", 1, 1))},
}
ANCHORS = ("monthly", "earnings")
MORE_FLAG = "OPTIONS_BACKTEST_MORE_ENABLED"


def more_enabled() -> bool:
    """FT-011's switch, read per call (api/services/options_analytics/flags.py owns the name)."""
    from api.services.options_analytics import flags
    return flags.is_on(MORE_FLAG)


def strategy_spec(name: str) -> dict | None:
    if name in STRATEGIES:
        return STRATEGIES[name]
    if name in MORE_STRATEGIES and more_enabled():
        return MORE_STRATEGIES[name]
    return None


def uses_width(name: str) -> bool:
    spec = STRATEGIES.get(name) or MORE_STRATEGIES.get(name) or {}
    return any(m != 0 for _, _, m in spec.get("spec", ()))


def catalog() -> dict:
    """What the panel may offer while FT-011 is on: every structure and both entry anchors."""
    rows = [{"id": k, "label": v["label"], "legs": v["legs"], "uses_width": uses_width(k)}
            for k, v in {**STRATEGIES, **MORE_STRATEGIES}.items()]
    return {"strategies": rows, "anchors": list(ANCHORS), "entry_dtes": list(ENTRY_DTES),
            "earnings_rule": EARNINGS_RULE_TEXT, "earnings_lookback": EARNINGS_LOOKBACK}
ENTRY_DTES = (7, 14, 30, 45)
MAX_OFFSET = 5
MAX_WIDTH = 5
EXIT_PCTS = (25, 50, 75, 100)

LOOKBACK_MONTHS = 12
MIN_SUMMARY_N = 6
MULTIPLIER = 100

# ── the budget ────────────────────────────────────────────────────────────────────────────────
# One run, hold-to-expiry, 12 monthlies, a spread: 1 bars read + 12 x (1 ladder + 2 quotes) = 37.
# An exit rule marks every session close in the hold: up to 12 x 44 x 2 more. The cap below is
# what a run may spend; expirations it cannot reach are counted as NOT RUN (newest are run first).
MAX_VENDOR_REQUESTS = 400
RUN_WALL_SECONDS = 240

RISK_FREE_RATE = 0.04   # flat, stated wherever an IV is shown
IV_SOURCE_TEXT = ("IV is COMPUTED here, not the vendor's: a Black-Scholes inversion of the entry mid "
                  "(European exercise, no dividends, a flat 4.0% rate, calendar days to expiry). "
                  "Massive keeps no historical IV.")
EARNINGS_LOOKBACK = 8      # the most recent past prints read for the earnings anchor
EARNINGS_MAX_EXPIRY_DAYS = 45
EARNINGS_RULE_TEXT = (
    "Earnings anchor: enter at the close of the last session before the report reaches the market "
    "and exit at the close of the first session that trades on it. A report after the close (AMC) "
    "enters on the report day and exits the next session; a report before the open (BMO) enters "
    "the session before and exits on the report day. A print whose timing is not on file is "
    "EXCLUDED and counted, because its entry close would be a guess. The options are the first "
    "listed expiration on or after the exit session; both ends are priced at the quote mid.")
BASIS_TEXT = ("A historical simulation, not advice. One contract per leg, every fill at the mid of the "
              "bid and ask, before commissions and fees. Entry prices are option QUOTES at the entry "
              "close, never trade prints; the expiry value is intrinsic from the underlying's close.")


class BadParams(ValueError):
    """A request the backtester will not run, in a sentence."""


class BudgetExhausted(RuntimeError):
    pass


# ── params ────────────────────────────────────────────────────────────────────────────────────

def normalize_params(sym: str, raw: dict) -> dict:
    s = (sym or "").upper().strip()
    if not s or len(s) > 10 or not all(c.isalnum() or c in ".-" for c in s):
        raise BadParams("Pick a symbol.")
    strategy = str(raw.get("strategy") or "")
    spec = strategy_spec(strategy)
    if spec is None:
        if more_enabled():
            raise BadParams("Pick one of: " + ", ".join(
                v["label"].lower() for v in {**STRATEGIES, **MORE_STRATEGIES}.values()) + ".")
        raise BadParams("Pick one of: long call, long put, bull call spread, bear put spread.")
    anchor = str(raw.get("anchor") or "monthly")
    if anchor not in ANCHORS or (anchor != "monthly" and not more_enabled()):
        raise BadParams("Entries anchor on monthly expirations"
                        + (" or earnings prints." if more_enabled() else "."))
    try:
        dte = int(raw.get("dte") or 0) if anchor == "earnings" else int(raw.get("dte"))
        offset = int(raw.get("offset", 0))
        width = int(raw.get("width", 1))
    except (TypeError, ValueError):
        raise BadParams("Entry days, offset and width must be whole numbers.") from None
    if anchor == "earnings":
        dte = 0                      # the earnings anchor sets its own entry and exit
    elif dte not in ENTRY_DTES:
        raise BadParams(f"Entry must be one of {', '.join(map(str, ENTRY_DTES))} trading days before expiry.")
    if abs(offset) > MAX_OFFSET:
        raise BadParams(f"The strike offset must be within {MAX_OFFSET} strikes of the money.")
    if not uses_width(strategy):
        width = 0
    elif not 1 <= width <= MAX_WIDTH:
        raise BadParams(f"A spread is 1 to {MAX_WIDTH} strikes wide.")

    def _pct(name):
        v = raw.get(name)
        if v in (None, "", 0, "0"):
            return None
        try:
            v = int(v)
        except (TypeError, ValueError):
            raise BadParams("Exit percentages must be whole numbers.") from None
        if v not in EXIT_PCTS:
            raise BadParams(f"Exit percentages must be one of {', '.join(map(str, EXIT_PCTS))}.")
        return v
    out = {"sym": s, "strategy": strategy, "dte": dte, "offset": offset, "width": width,
           "take_profit_pct": _pct("take_profit_pct"), "stop_loss_pct": _pct("stop_loss_pct")}
    if anchor == "earnings":
        # one session in, one session out: an exit rule has no session to fire on
        out.update(anchor="earnings", take_profit_pct=None, stop_loss_pct=None)
    return out


def cache_key(p: dict) -> tuple:
    return (p["sym"], p["strategy"], p["dte"], p["offset"], p["width"],
            p["take_profit_pct"], p["stop_loss_pct"], p.get("anchor", "monthly"))


# ── the vendor, behind a budget ───────────────────────────────────────────────────────────────

class Vendor:
    """Every vendor read of one run goes through here, so the budget cannot be bypassed.
    `get(path, params)` -> dict. Tests replace `fetch` with a recorded-fixture replay."""

    def __init__(self, fetch: Callable[[str, dict], dict] | None = None,
                 budget: int = MAX_VENDOR_REQUESTS):
        self._fetch = fetch or _massive_fetch
        self.budget = budget
        self.used = 0

    def get(self, path: str, params: dict) -> dict:
        if self.used >= self.budget:
            raise BudgetExhausted()
        self.used += 1
        return self._fetch(path, params)


def _massive_fetch(path: str, params: dict) -> dict:
    from api.services import polygon_options
    return polygon_options._safe_get(f"{polygon_options._BASE}{path}", params)


# ── calendar + time ───────────────────────────────────────────────────────────────────────────

def third_friday(y: int, m: int) -> date:
    d = date(y, m, 1)
    first_fri = d + timedelta(days=(4 - d.weekday()) % 7)
    return first_fri + timedelta(days=14)


def _ny_instant(day: date, hh: int, mm: int) -> str:
    """An ISO UTC instant for hh:mm New York time on `day` (DST-correct -- 16:00 ET is 20:00Z in
    summer and 21:00Z in winter)."""
    local = datetime(day.year, day.month, day.day, hh, mm, tzinfo=NY)
    return local.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def monthly_expirations(sessions: list[date], window_start: date, last: date) -> list[date]:
    """The monthly expiration SESSION for each month whose expiry is in (window_start, last]:
    the third Friday, or the last session before it when that Friday was a holiday."""
    have = set(sessions)
    out = []
    y, m = window_start.year, window_start.month
    while date(y, m, 1) <= last:
        tf = third_friday(y, m)
        d = tf
        while d not in have and d > tf - timedelta(days=4):
            d -= timedelta(days=1)
        if d in have and window_start < d <= last:
            out.append(d)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


# ── pricing ───────────────────────────────────────────────────────────────────────────────────

def two_sided_mid(q: dict | None) -> float | None:
    if not q:
        return None
    b, a = q.get("bid_price"), q.get("ask_price")
    if not isinstance(b, (int, float)) or not isinstance(a, (int, float)):
        return None
    if b <= 0 or a <= 0 or a < b:
        return None
    return (a + b) / 2


def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_price(kind: str, s: float, k: float, t: float, sigma: float, r: float = RISK_FREE_RATE) -> float:
    if t <= 0 or sigma <= 0:
        return max(0.0, s - k) if kind == "call" else max(0.0, k - s)
    d1 = (math.log(s / k) + (r + sigma * sigma / 2) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    if kind == "call":
        return s * _ncdf(d1) - k * math.exp(-r * t) * _ncdf(d2)
    return k * math.exp(-r * t) * _ncdf(-d2) - s * _ncdf(-d1)


def implied_vol(kind: str, price: float, s: float, k: float, t: float,
                r: float = RISK_FREE_RATE) -> float | None:
    """Bisection on sigma in [0.001, 5]. None when the price is outside what any sigma in that
    range produces (e.g. a mid below discounted intrinsic) -- never a clamped number."""
    if not (price > 0 and s > 0 and k > 0 and t > 0):
        return None
    lo, hi = 0.001, 5.0
    if price < bs_price(kind, s, k, t, lo, r) or price > bs_price(kind, s, k, t, hi, r):
        return None
    for _ in range(100):
        mid = (lo + hi) / 2
        if bs_price(kind, s, k, t, mid, r) < price:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-6:
            break
    return round((lo + hi) / 2, 4)


def intrinsic(kind: str, strike: float, s: float) -> float:
    return max(0.0, s - strike) if kind == "call" else max(0.0, strike - s)


# ── one run ───────────────────────────────────────────────────────────────────────────────────

def _bars(v: Vendor, sym: str, start: date, end: date) -> list[tuple[date, float]]:
    data = v.get(f"/v2/aggs/ticker/{sym}/range/1/day/{start.isoformat()}/{end.isoformat()}",
                 {"adjusted": "false", "sort": "asc", "limit": 5000})
    out = []
    for row in data.get("results") or []:
        c, t = row.get("c"), row.get("t")
        if not isinstance(c, (int, float)) or isinstance(c, bool) or c <= 0 or not isinstance(t, (int, float)):
            continue
        # aggs `t` is the session's start in ms UTC; the New York date is the session.
        day = datetime.fromtimestamp(t / 1000, ZoneInfo("UTC")).astimezone(NY).date()
        out.append((day, float(c)))
    return out


def _ladder(v: Vendor, sym: str, kind: str, expiry: date, as_of: date, spot: float) -> list[dict]:
    data = v.get("/v3/reference/options/contracts",
                 {"underlying_ticker": sym, "contract_type": kind, "as_of": as_of.isoformat(),
                  "expiration_date": expiry.isoformat(),
                  "strike_price.gte": round(spot * 0.6, 2), "strike_price.lte": round(spot * 1.4, 2),
                  "sort": "strike_price", "order": "asc", "limit": 1000})
    rows = {}
    for c in data.get("results") or []:
        k, tick = c.get("strike_price"), c.get("ticker")
        if isinstance(k, (int, float)) and tick and c.get("contract_type") == kind:
            rows.setdefault(float(k), tick)   # one contract per strike (a non-standard dup is ignored)
    return [{"strike": k, "ticker": rows[k]} for k in sorted(rows)]


def _quote_at_close(v: Vendor, ticker: str, day: date) -> dict | None:
    """The last NBBO at or before 16:00 New York on `day`, and not before 09:30 that day -- a quote
    left over from a prior session is not the entry close."""
    data = v.get(f"/v3/quotes/{ticker}",
                 {"timestamp.gte": _ny_instant(day, 9, 30), "timestamp.lte": _ny_instant(day, 16, 0),
                  "order": "desc", "sort": "timestamp", "limit": 1})
    for q in data.get("results") or []:
        return q
    return None


def _ns_iso(ns) -> str | None:
    try:
        return datetime.fromtimestamp(int(ns) / 1e9, ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, OSError):
        return None


def leg_types(strategy: str) -> list[str]:
    """The option types a structure needs a ladder for, in a stable order (call before put)."""
    spec = (STRATEGIES.get(strategy) or MORE_STRATEGIES.get(strategy))["spec"]
    return [t for t in ("call", "put") if any(lt == t for lt, _, _ in spec)]


def _pick_legs(p: dict, ladders, spot: float) -> tuple[list[dict] | None, str | None]:
    """`ladders` is one ladder (single-type structures, the first slice's call shape) or a dict
    {type: ladder}. Each type anchors on ITS OWN at-the-money strike, moved `offset` steps; a leg
    sits `mult x width` steps from that anchor."""
    spec = (STRATEGIES.get(p["strategy"]) or MORE_STRATEGIES.get(p["strategy"]))["spec"]
    if not isinstance(ladders, dict):
        ladders = {spec[0][0]: ladders}
    out = []
    for kind, side, mult in spec:
        ladder = ladders.get(kind) or []
        if not ladder:
            return None, "no contracts listed for this expiration at entry"
        atm = min(range(len(ladder)), key=lambda i: (abs(ladder[i]["strike"] - spot), ladder[i]["strike"]))
        j = atm + p["offset"] + mult * p["width"]
        if j < 0 or j >= len(ladder):
            return None, "the strike offset falls outside the listed ladder"
        out.append({"type": kind, "side": side, "strike": ladder[j]["strike"], "ticker": ladder[j]["ticker"]})
    return out, None


def _value(legs: list[dict], mids: list[float]) -> float:
    return sum(l["side"] * m for l, m in zip(legs, mids)) * MULTIPLIER


def _ladders(vendor: Vendor, sym: str, strategy: str, exp: date, as_of: date, spot: float):
    types = leg_types(strategy)
    if len(types) == 1:
        return _ladder(vendor, sym, types[0], exp, as_of, spot)
    return {t: _ladder(vendor, sym, t, exp, as_of, spot) for t in types}


def _ret_pct(val: float, debit: float) -> float:
    """Return on the premium at risk: a debit pays `debit`, a credit collects `-debit`. Either way
    the base is its absolute size, so +50% on a credit means half the credit kept."""
    return (val - debit) / abs(debit) * 100


def run_backtest(p: dict, vendor: Vendor, today: date, prints=None) -> dict:
    """Pure over `vendor` -- every number traces to a read through it. `prints` (earnings anchor
    only) is the past-prints reader; default: the engine's quarterly history (FMP)."""
    if p.get("anchor") == "earnings":
        return run_earnings_backtest(p, vendor, today, prints or _default_prints)
    from api.services.massive import to_polygon_symbol
    sym = to_polygon_symbol(p["sym"])
    window_start = today - timedelta(days=round(LOOKBACK_MONTHS * 365 / 12))
    # bars reach back far enough to find an entry 45 sessions before the oldest expiry
    bars = _bars(vendor, sym, window_start - timedelta(days=80), today)
    sessions = [d for d, _ in bars]
    close = dict(bars)
    pos = {d: i for i, d in enumerate(sessions)}
    last_full = sessions[-1] if sessions else None
    if last_full == today:
        last_full = sessions[-2] if len(sessions) > 1 else None   # today's bar may still be forming
    expiries = monthly_expirations(sessions, window_start, last_full) if last_full else []

    trades, excluded, not_run = [], [], []
    unmarked = 0
    started = time.monotonic()
    for exp in sorted(expiries, reverse=True):                        # newest first under the budget
        if time.monotonic() - started > RUN_WALL_SECONDS:
            not_run.append({"expiry": exp.isoformat(), "reason": "the run's time budget ran out"})
            continue
        ei = pos[exp]
        if ei - p["dte"] < 0:
            excluded.append({"expiry": exp.isoformat(), "entry": None, "reason": "no session history that far back"})
            continue
        entry = sessions[ei - p["dte"]]
        spot = close[entry]
        try:
            ladder = _ladders(vendor, sym, p["strategy"], exp, entry, spot)
            legs, why = _pick_legs(p, ladder, spot)
            if legs is None:
                excluded.append({"expiry": exp.isoformat(), "entry": entry.isoformat(), "reason": why})
                continue
            quotes = [_quote_at_close(vendor, l["ticker"], entry) for l in legs]
            mids = [two_sided_mid(q) for q in quotes]
            missing = [l for l, m in zip(legs, mids) if m is None]
            if missing:
                names = " and ".join(f"{l['strike']:g} {l['type']}" for l in missing)
                excluded.append({"expiry": exp.isoformat(), "entry": entry.isoformat(),
                                 "reason": f"no two-sided quote for the {names} at the entry close"})
                continue
            t_years = (exp - entry).days / 365.0
            leg_out = []
            for l, q, m in zip(legs, quotes, mids):
                leg_out.append({**l, "bid": q["bid_price"], "ask": q["ask_price"], "mid": round(m, 4),
                                "quote_time": _ns_iso(q.get("sip_timestamp")),
                                "iv_computed": implied_vol(l["type"], m, spot, l["strike"], t_years)})
            debit = _value(legs, mids)
            exit_ = None
            if (p["take_profit_pct"] or p["stop_loss_pct"]) and debit != 0:
                for day in sessions[ei - p["dte"] + 1: ei]:
                    qs = [_quote_at_close(vendor, l["ticker"], day) for l in legs]
                    ms = [two_sided_mid(q) for q in qs]
                    if any(m is None for m in ms):
                        unmarked += 1
                        continue
                    val = _value(legs, ms)
                    ret = _ret_pct(val, debit)
                    if p["take_profit_pct"] and ret >= p["take_profit_pct"]:
                        exit_ = {"date": day.isoformat(), "kind": "take_profit", "value": round(val, 2),
                                 "underlying_close": close[day]}
                        break
                    if p["stop_loss_pct"] and ret <= -p["stop_loss_pct"]:
                        exit_ = {"date": day.isoformat(), "kind": "stop_loss", "value": round(val, 2),
                                 "underlying_close": close[day]}
                        break
            if exit_ is None:
                s_exp = close[exp]
                val = sum(l["side"] * intrinsic(l["type"], l["strike"], s_exp) for l in legs) * MULTIPLIER
                exit_ = {"date": exp.isoformat(), "kind": "expiry", "value": round(val, 2), "underlying_close": s_exp}
        except BudgetExhausted:
            not_run.append({"expiry": exp.isoformat(), "reason": "the vendor request budget ran out"})
            continue
        except Exception as exc:  # noqa: BLE001 -- one expiration's vendor failure is counted, not fatal
            _log.warning("options_backtest %s %s: %s", sym, exp, exc)
            not_run.append({"expiry": exp.isoformat(), "reason": "the vendor read failed"})
            continue
        pnl = round(exit_["value"] - debit, 2)
        trades.append({"expiry": exp.isoformat(), "entry_date": entry.isoformat(), "entry_close": spot,
                       "legs": leg_out, "debit": round(debit, 2), "exit": exit_, "pnl": pnl,
                       "pnl_pct": round(pnl / abs(debit) * 100, 1) if debit != 0 else None})

    trades.sort(key=lambda t: t["entry_date"])
    excluded.sort(key=lambda e: e["expiry"])
    not_run.sort(key=lambda e: e["expiry"])
    return {
        "sym": p["sym"], "params": p, "strategy_label": _label(p["strategy"]),
        "basis": BASIS_TEXT, "iv_source": "computed", "iv_source_text": IV_SOURCE_TEXT,
        "risk_free_rate": RISK_FREE_RATE,
        "window": {
            "lookback_months": LOOKBACK_MONTHS, "starts": window_start.isoformat(),
            "ends": last_full.isoformat() if last_full else None,
            "first_entry": trades[0]["entry_date"] if trades else None,
            "text": _window_text(window_start, trades),
        },
        "expirations_considered": len(expiries),
        "trades": trades,
        "excluded": excluded, "excluded_count": len(excluded),
        "not_run": not_run, "not_run_count": len(not_run),
        "unmarked_exit_checks": unmarked,
        "summary": summarize(trades),
        "summary_reason": None if len(trades) >= MIN_SUMMARY_N else small_sample_text(len(trades)),
        "vendor_requests": {"used": vendor.used, "budget": vendor.budget},
        "computed_at": datetime.now(ZoneInfo("UTC")).isoformat(timespec="seconds"),
    }


def _window_text(start: date, trades: list[dict]) -> str:
    s = f"Lookback of {LOOKBACK_MONTHS} months: monthly expirations after {start.isoformat()}."
    if trades:
        s += f" The first simulated entry is {trades[0]['entry_date']}."
    return s


def small_sample_text(n: int) -> str:
    return (f"Only {n} trade{'s' if n != 1 else ''} could be simulated; a sample under "
            f"{MIN_SUMMARY_N} is too small to summarise.")


def max_drawdown(pnls: list[float]) -> float:
    """Largest peak-to-trough fall of cumulative P&L, starting from zero, in chronological order.
    Reported as a non-positive number."""
    peak = cum = 0.0
    worst = 0.0
    for x in pnls:
        cum += x
        peak = max(peak, cum)
        worst = min(worst, cum - peak)
    return round(worst, 2)


def summarize(trades: list[dict]) -> dict | None:
    n = len(trades)
    if n < MIN_SUMMARY_N:
        return None
    pnls = [t["pnl"] for t in trades]
    wins = sum(1 for x in pnls if x > 0)
    return {"n": n, "wins": wins, "win_rate": round(wins / n, 4),
            "avg_pnl": round(sum(pnls) / n, 2), "median_pnl": round(statistics.median(pnls), 2),
            "worst": min(pnls), "best": max(pnls), "total_pnl": round(sum(pnls), 2),
            "max_drawdown": max_drawdown(pnls)}


# ── jobs ──────────────────────────────────────────────────────────────────────────────────────

MAX_WORKERS = 2
MAX_INFLIGHT = 8
MAX_INFLIGHT_PER_MEMBER = 2
CACHE_TTL_SECONDS = 6 * 3600
CACHE_MAX = 200
JOB_TTL_SECONDS = 3600
RUNS_PER_MEMBER_PER_HOUR = 6

_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="options-backtest")
_cache: dict[tuple, tuple[float, dict]] = {}
_failed: dict[tuple, tuple[float, str]] = {}
_inflight: dict[tuple, dict] = {}           # key -> {"state": "queued"|"running"}
_jobs: dict[str, dict] = {}                 # job_id -> {"owner", "key", "created"}
_member_runs: dict[str, list[float]] = {}

# Seams for tests: the vendor fetch and the clock's "today".
_fetch_override: Callable[[str, dict], dict] | None = None


def _today() -> date:
    return datetime.now(NY).date()


class Refused(RuntimeError):
    def __init__(self, msg: str, status: int, retry_after: int | None = None):
        super().__init__(msg)
        self.status = status
        self.retry_after = retry_after


class JobNotFound(KeyError):
    pass


def _cached(key: tuple) -> dict | None:
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
        return hit[1]
    _cache.pop(key, None)
    return None


def _evict() -> None:
    now = time.time()
    for jid in [j for j, r in _jobs.items() if now - r["created"] > JOB_TTL_SECONDS]:
        _jobs.pop(jid, None)
    for k in [k for k, (t, _) in _failed.items() if now - t > JOB_TTL_SECONDS]:
        _failed.pop(k, None)
    if len(_cache) > CACHE_MAX:
        for k, _ in sorted(_cache.items(), key=lambda kv: kv[1][0])[: len(_cache) - CACHE_MAX]:
            _cache.pop(k, None)


def _work(key: tuple, p: dict) -> None:
    with _lock:
        _inflight[key] = {**_inflight.get(key, {}), "state": "running"}
    try:
        out = run_backtest(p, Vendor(_fetch_override), _today())
        with _lock:
            _cache[key] = (time.time(), out)
            _failed.pop(key, None)
    except Exception as exc:  # noqa: BLE001 -- a crashed run is a terminal state the poll reports
        _log.exception("options_backtest run failed: %s", key)
        with _lock:
            _failed[key] = (time.time(), f"The backtest could not finish: {type(exc).__name__}.")
    finally:
        with _lock:
            _inflight.pop(key, None)


def submit(user_id: str, sym: str, raw: dict) -> str:
    """Queue (or reuse) a run; returns a job id. Raises BadParams or Refused. Never computes."""
    p = normalize_params(sym, raw)
    key = cache_key(p)
    uid = str(user_id)
    now = time.time()
    with _lock:
        _evict()
        jid = uuid.uuid4().hex
        if _cached(key) is None and key not in _inflight:
            recent = [t for t in _member_runs.get(uid, []) if now - t < 3600]
            if len(recent) >= RUNS_PER_MEMBER_PER_HOUR:
                wait = max(1, int(recent[0] + 3600 - now))
                raise Refused(f"At most {RUNS_PER_MEMBER_PER_HOUR} new backtests per hour. "
                              f"Try again in {wait // 60 + 1} min.", 429, wait)
            mine = sum(1 for r in _inflight.values() if r.get("owner") == uid)
            if mine >= MAX_INFLIGHT_PER_MEMBER:
                raise Refused(f"You already have {mine} backtests running. Wait for one to finish.",
                              429, 30)
            if len(_inflight) >= MAX_INFLIGHT:
                raise Refused("The backtester is busy. Try again in a minute.", 429, 60)
            recent.append(now)
            _member_runs[uid] = recent
            _failed.pop(key, None)
            _inflight[key] = {"state": "queued", "owner": uid}
            _executor.submit(_work, key, p)
        _jobs[jid] = {"owner": uid, "key": key, "created": now, "params": p}
    return jid


def job_status(job_id: str, user_id: str) -> dict:
    with _lock:
        rec = _jobs.get(job_id)
        if not rec or rec["owner"] != str(user_id):
            raise JobNotFound(job_id)       # not-there and not-yours read the same
        key = rec["key"]
        res = _cached(key)
        if res is not None:
            return {"job": job_id, "state": "done", "result": res}
        if key in _inflight:
            return {"job": job_id, "state": _inflight[key]["state"], "params": rec["params"],
                    "budget_text": f"At most {MAX_VENDOR_REQUESTS} vendor requests per run."}
        err = _failed.get(key)
        return {"job": job_id, "state": "failed",
                "error": err[1] if err else "The backtest result expired. Run it again."}


def _reset_for_tests() -> None:
    with _lock:
        _cache.clear()
        _failed.clear()
        _inflight.clear()
        _jobs.clear()
        _member_runs.clear()


def _label(strategy: str) -> str:
    return (STRATEGIES.get(strategy) or MORE_STRATEGIES.get(strategy) or {"label": strategy})["label"]


# ── FT-011: the earnings anchor ───────────────────────────────────────────────────────────────

def _default_prints(sym: str) -> list:
    """Past prints, newest first: [{reportedDate, reportTime}] -- the same reader the IV-history
    implied-vs-realized table uses (api/services/research/iv_history.py)."""
    from api.services.research import iv_history
    return iv_history._default_prints(sym) or []


def timing_of(raw) -> str | None:
    """'amc' / 'bmo' from the vendor's words, or None when it does not say."""
    t = str(raw or "").strip().lower()
    if not t:
        return None
    if t == "amc" or "post" in t or "after" in t:
        return "amc"
    if t == "bmo" or "pre" in t or "before" in t:
        return "bmo"
    return None


def earnings_window(report: date, timing: str, sessions: list[date]) -> tuple[date | None, date | None]:
    """(entry session, exit session) for one print on the sorted session calendar `sessions`.
    AMC: enter the report day's close, exit the next session. BMO: enter the prior session's
    close, exit the report day's close."""
    if report not in set(sessions):
        return None, None
    if timing == "amc":
        later = [d for d in sessions if d > report]
        return report, (later[0] if later else None)
    earlier = [d for d in sessions if d < report]
    return (earlier[-1] if earlier else None), report


def _first_expiry(v: Vendor, sym: str, kind: str, on_or_after: date, as_of: date,
                  spot: float) -> tuple[date | None, list[dict]]:
    """(expiry, ladder) of the FIRST expiration listed at entry on or after the exit session."""
    data = v.get("/v3/reference/options/contracts",
                 {"underlying_ticker": sym, "contract_type": kind, "as_of": as_of.isoformat(),
                  "expiration_date.gte": on_or_after.isoformat(),
                  "expiration_date.lte": (on_or_after + timedelta(days=EARNINGS_MAX_EXPIRY_DAYS)).isoformat(),
                  "strike_price.gte": round(spot * 0.6, 2), "strike_price.lte": round(spot * 1.4, 2),
                  "sort": "expiration_date", "order": "asc", "limit": 1000})
    by_exp: dict[str, dict[float, str]] = {}
    for c in data.get("results") or []:
        k, tick, e = c.get("strike_price"), c.get("ticker"), c.get("expiration_date")
        if isinstance(k, (int, float)) and tick and e and c.get("contract_type") == kind:
            by_exp.setdefault(e, {}).setdefault(float(k), tick)
    if not by_exp:
        return None, []
    first = min(by_exp)
    rows = by_exp[first]
    return date.fromisoformat(first), [{"strike": k, "ticker": rows[k]} for k in sorted(rows)]


def _missing_names(legs: list[dict], mids: list) -> str:
    return " and ".join(f"{l['strike']:g} {l['type']}" for l, m in zip(legs, mids) if m is None)


def run_earnings_backtest(p: dict, vendor: Vendor, today: date, prints) -> dict:
    """Enter before each past print, exit on the first session that trades on it
    (EARNINGS_RULE_TEXT). Pure over `vendor` and `prints`."""
    from api.services.massive import to_polygon_symbol
    sym = to_polygon_symbol(p["sym"])
    quarters = []
    for q in (prints(p["sym"]) or []):
        try:
            d = date.fromisoformat(str(q.get("reportedDate") or q.get("date") or "")[:10])
        except ValueError:
            continue
        if d < today:
            quarters.append((d, q.get("reportTime") or q.get("time") or ""))
    quarters = sorted(quarters, reverse=True)[:EARNINGS_LOOKBACK]
    trades, excluded, not_run = [], [], []
    bars = (_bars(vendor, sym, min(d for d, _ in quarters) - timedelta(days=10), today)
            if quarters else [])
    sessions = [d for d, _ in bars]
    close = dict(bars)
    started = time.monotonic()
    for report, raw_timing in quarters:
        timing = timing_of(raw_timing)
        rec = {"expiry": None, "report_date": report.isoformat(), "timing": timing or "unknown"}
        if timing is None:
            excluded.append({**rec, "entry": None,
                             "reason": "the report time (before the open or after the close) is not on file"})
            continue
        entry, exit_day = earnings_window(report, timing, sessions)
        if entry is None or exit_day is None or exit_day >= today:
            excluded.append({**rec, "entry": entry.isoformat() if entry else None,
                             "reason": "no completed session on one side of the print"})
            continue
        if time.monotonic() - started > RUN_WALL_SECONDS:
            not_run.append({**rec, "reason": "the run's time budget ran out"})
            continue
        spot = close[entry]
        try:
            ladders, expiry, why = {}, None, None
            for t in leg_types(p["strategy"]):
                e, lad = _first_expiry(vendor, sym, t, exit_day, entry, spot)
                if e is None:
                    why = "no expiration listed at entry on or after the exit session"
                    break
                if expiry is not None and e != expiry:
                    why = "the call and put lists name different first expirations"
                    break
                expiry = e
                ladders[t] = lad
            if why:
                excluded.append({**rec, "entry": entry.isoformat(), "reason": why})
                continue
            rec["expiry"] = expiry.isoformat()
            legs, why = _pick_legs(p, ladders, spot)
            if legs is None:
                excluded.append({**rec, "entry": entry.isoformat(), "reason": why})
                continue
            q_in = [_quote_at_close(vendor, l["ticker"], entry) for l in legs]
            m_in = [two_sided_mid(q) for q in q_in]
            if any(m is None for m in m_in):
                excluded.append({**rec, "entry": entry.isoformat(),
                                 "reason": f"no two-sided quote for the {_missing_names(legs, m_in)} at the entry close"})
                continue
            if exit_day >= expiry:
                m_out = [intrinsic(l["type"], l["strike"], close[exit_day]) for l in legs]
                exit_kind = "expiry"
            else:
                m_out = [two_sided_mid(_quote_at_close(vendor, l["ticker"], exit_day)) for l in legs]
                exit_kind = "after_print"
                if any(m is None for m in m_out):
                    excluded.append({**rec, "entry": entry.isoformat(),
                                     "reason": f"no two-sided quote for the {_missing_names(legs, m_out)} at the exit close"})
                    continue
        except BudgetExhausted:
            not_run.append({**rec, "reason": "the vendor request budget ran out"})
            continue
        except Exception as exc:  # noqa: BLE001 -- one print's vendor failure is counted, not fatal
            _log.warning("options_backtest earnings %s %s: %s", sym, report, exc)
            not_run.append({**rec, "reason": "the vendor read failed"})
            continue
        t_years = max(1, (expiry - entry).days) / 365.0
        leg_out = [{**l, "bid": q["bid_price"], "ask": q["ask_price"], "mid": round(m, 4),
                    "quote_time": _ns_iso(q.get("sip_timestamp")),
                    "iv_computed": implied_vol(l["type"], m, spot, l["strike"], t_years)}
                   for l, q, m in zip(legs, q_in, m_in)]
        debit = _value(legs, m_in)
        val = _value(legs, m_out)
        pnl = round(val - debit, 2)
        trades.append({"expiry": expiry.isoformat(), "report_date": report.isoformat(), "timing": timing,
                       "entry_date": entry.isoformat(), "entry_close": spot, "legs": leg_out,
                       "debit": round(debit, 2),
                       "exit": {"date": exit_day.isoformat(), "kind": exit_kind, "value": round(val, 2),
                                "underlying_close": close[exit_day]},
                       "underlying_move_pct": round((close[exit_day] / spot - 1) * 100, 2),
                       "pnl": pnl, "pnl_pct": round(pnl / abs(debit) * 100, 1) if debit != 0 else None})
    trades.sort(key=lambda t: t["entry_date"])
    excluded.sort(key=lambda e: e["report_date"])
    not_run.sort(key=lambda e: e["report_date"])
    text = (f"The {len(quarters)} most recent past earnings print{'s' if len(quarters) != 1 else ''} "
            f"on file (at most {EARNINGS_LOOKBACK}).")
    if trades:
        text += f" The first simulated entry is {trades[0]['entry_date']}."
    return {
        "sym": p["sym"], "params": p, "strategy_label": _label(p["strategy"]), "anchor": "earnings",
        "anchor_text": EARNINGS_RULE_TEXT,
        "basis": BASIS_TEXT, "iv_source": "computed", "iv_source_text": IV_SOURCE_TEXT,
        "risk_free_rate": RISK_FREE_RATE,
        "window": {"prints_read": len(quarters),
                   "starts": quarters[-1][0].isoformat() if quarters else None,
                   "ends": quarters[0][0].isoformat() if quarters else None,
                   "first_entry": trades[0]["entry_date"] if trades else None, "text": text},
        "expirations_considered": len(quarters),
        "trades": trades,
        "excluded": excluded, "excluded_count": len(excluded),
        "not_run": not_run, "not_run_count": len(not_run),
        "unmarked_exit_checks": 0,
        "summary": summarize(trades),
        "summary_reason": None if len(trades) >= MIN_SUMMARY_N else small_sample_text(len(trades)),
        "vendor_requests": {"used": vendor.used, "budget": vendor.budget},
        "computed_at": datetime.now(ZoneInfo("UTC")).isoformat(timespec="seconds"),
    }
