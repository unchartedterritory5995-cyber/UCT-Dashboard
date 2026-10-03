"""FT-072 / FT-073 — one screener per option strategy, over COV-02's prebuilt screen file.

BUILT ON COV-02 (`origin/lane/cov-02-03`, `api/services/research/options_screener.py`), which was
NOT merged into integrate/terminal-fixes when this was written. This module reads COV-02's
per-session SQLite file (its `_SCHEMA`: contracts(contract, underlying, exp YYYYMMDD, dte, cp,
strike_m x1000, otm_d x10 (+ = out of the money), iv_bp, delta_m x1000, bid_c, ask_c cents,
spread_d x10, oi, vol), underlyings(underlying, price), meta(k, v)) through COV-02's own store
(`get_store().screen_sessions()` / `screen_db(session)`), imported lazily. Until COV-02 lands,
the routes answer 503 "the COV-02 screen store is not on this build" — never an empty screen.

  covered_calls      calls 0-10% OTM, 14-60 days: premium yield on the stock, annualized, and
                     the return if called away.
  cash_secured_puts  puts 0-15% OTM, 14-60 days: premium yield on the cash, annualized,
                     breakeven and cushion. (Market Chameleon's "naked puts" screen.)
  bull_put_spreads   short put 2-10% OTM at |delta| 0.15-0.35, long put the next strike below
                     within 5% of spot: credit, max loss, return on risk.
  bear_call_spreads  the mirror on calls, above spot.
  bull_call_spreads  long call -2..+3% from spot, short call the next strike above within 10%:
                     debit, max profit, reward to risk.

⛔ END-OF-DAY, AND EVERY ROW SAYS SO: the screen file is the session's close snapshot, not a live
  chain. Prices are the logged bid/ask (sell at bid, buy at ask - the conservative fill), stated.
⛔ A contract without the field a strategy needs is not a match; the count of candidates the
  filters read is returned beside the matches.
⛔ Read-only: no route here places, stages or simulates an order beyond the arithmetic shown.
"""
from __future__ import annotations

import sqlite3
from typing import Callable, Optional

MAX_ROWS = 100
CANDIDATE_CAP = 3000
DATA_BASIS = "end-of-day snapshot"
FILL = "Short legs at the logged bid, long legs at the logged ask (the conservative fill)."

STRATEGIES = {
    "covered_calls": {"label": "Covered calls", "legs": 1, "description":
                      "Calls 0-10% out of the money, 14-60 days out, bid at least $0.10, spread at "
                      "most 15% of mid, open interest 100+. Sorted by annualized premium yield."},
    "cash_secured_puts": {"label": "Cash-secured puts", "legs": 1, "description":
                          "Puts 0-15% out of the money, 14-60 days out, bid at least $0.10, spread at "
                          "most 15% of mid, open interest 100+. Sorted by annualized yield on cash."},
    "bull_put_spreads": {"label": "Bull put spreads", "legs": 2, "description":
                         "Sell a put 2-10% out of the money at |delta| 0.15-0.35, buy the next listed "
                         "strike below within 5% of spot, 14-60 days, open interest 100+ on both legs, "
                         "net credit > 0. Sorted by return on risk."},
    "bear_call_spreads": {"label": "Bear call spreads", "legs": 2, "description":
                          "Sell a call 2-10% out of the money at |delta| 0.15-0.35, buy the next listed "
                          "strike above within 5% of spot, 14-60 days, open interest 100+ on both legs, "
                          "net credit > 0. Sorted by return on risk."},
    "bull_call_spreads": {"label": "Bull call spreads", "legs": 2, "description":
                          "Buy a call from 2% in to 3% out of the money, sell the next listed strike "
                          "above within 10% of spot, 14-60 days, open interest 100+ on both legs, net "
                          "debit > 0. Sorted by reward to risk."},
}

_COLS = "contract, underlying, exp, dte, cp, strike_m, otm_d, iv_bp, delta_m, bid_c, ask_c, spread_d, oi"


class BadQuery(ValueError):
    pass


class NoStore(RuntimeError):
    pass


def _row(t) -> dict:
    keys = [c.strip() for c in _COLS.split(",")]
    r = dict(zip(keys, t))
    e = r["exp"]
    return {"contract": r["contract"], "underlying": r["underlying"],
            "expiration": f"{e // 10000:04d}-{e // 100 % 100:02d}-{e % 100:02d}", "dte": r["dte"],
            "type": "call" if r["cp"] == "C" else "put", "strike": r["strike_m"] / 1000,
            "otm_pct": None if r["otm_d"] is None else r["otm_d"] / 10,
            "iv": None if r["iv_bp"] is None else r["iv_bp"] / 10000,
            "delta": None if r["delta_m"] is None else r["delta_m"] / 1000,
            "bid": None if r["bid_c"] is None else r["bid_c"] / 100,
            "ask": None if r["ask_c"] is None else r["ask_c"] / 100,
            "spread_pct": None if r["spread_d"] is None else r["spread_d"] / 10, "open_interest": r["oi"]}


def _scope(underlyings: Optional[list]) -> tuple:
    if not underlyings:
        return "", []
    return f" AND underlying IN ({','.join('?' * len(underlyings))})", list(underlyings)


def _single(con, cp: str, otm_max: int, underlyings, prices: dict, kind: str) -> tuple:
    sc, args = _scope(underlyings)
    rows = con.execute(
        f"SELECT {_COLS} FROM contracts WHERE cp = ? AND otm_d BETWEEN 0 AND ? AND dte BETWEEN 14 AND 60 "
        f"AND bid_c >= 10 AND spread_d <= 150 AND oi >= 100{sc} ORDER BY oi DESC LIMIT ?",
        [cp, otm_max * 10, *args, CANDIDATE_CAP]).fetchall()
    out = []
    for t in rows:
        r = _row(t)
        px = prices.get(r["underlying"])
        if not px:
            continue
        bid = r["bid"]
        if kind == "covered_calls":
            static = bid / px
            r.update(underlying_price=px, premium_yield_pct=round(static * 100, 2),
                     annualized_pct=round(static * 365 / r["dte"] * 100, 1),
                     if_called_pct=round((r["strike"] - px + bid) / px * 100, 2))
        else:
            onc = bid / r["strike"]
            be = r["strike"] - bid
            r.update(underlying_price=px, yield_on_cash_pct=round(onc * 100, 2),
                     annualized_pct=round(onc * 365 / r["dte"] * 100, 1), breakeven=round(be, 2),
                     cushion_pct=round((px - be) / px * 100, 2))
        out.append(r)
    out.sort(key=lambda r: r["annualized_pct"], reverse=True)
    return out, len(rows)


def _spread(con, kind: str, underlyings, prices: dict) -> tuple:
    cp = "P" if kind == "bull_put_spreads" else "C"
    sc, args = _scope(underlyings)
    if kind == "bull_call_spreads":
        where = "otm_d BETWEEN -20 AND 30 AND ask_c > 0"
    else:
        where = "otm_d BETWEEN 20 AND 100 AND ABS(delta_m) BETWEEN 150 AND 350 AND bid_c > 0"
    anchors = con.execute(
        f"SELECT {_COLS} FROM contracts WHERE cp = ? AND {where} AND dte BETWEEN 14 AND 60 "
        f"AND oi >= 100{sc} ORDER BY oi DESC LIMIT ?", [cp, *args, CANDIDATE_CAP]).fetchall()
    out = []
    for t in anchors:
        a = _row(t)
        px = prices.get(a["underlying"])
        if not px:
            continue
        exp_i = int(a["expiration"].replace("-", ""))
        higher = kind != "bull_put_spreads"
        max_w = px * (0.10 if kind == "bull_call_spreads" else 0.05)
        cmp = ">" if higher else "<"
        order = "ASC" if higher else "DESC"
        nxt = con.execute(
            f"SELECT {_COLS} FROM contracts WHERE underlying = ? AND exp = ? AND cp = ? "
            f"AND strike_m {cmp} ? AND oi >= 100 ORDER BY strike_m {order} LIMIT 1",
            [a["underlying"], exp_i, cp, int(round(a["strike"] * 1000))]).fetchone()
        if nxt is None:
            continue
        b = _row(nxt)
        width = abs(b["strike"] - a["strike"])
        if width <= 0 or width > max_w:
            continue
        if kind == "bull_call_spreads":
            if a["ask"] is None or b["bid"] is None:
                continue
            debit = round(a["ask"] - b["bid"], 2)
            if debit <= 0 or debit >= width:
                continue
            out.append({"underlying": a["underlying"], "underlying_price": px, "expiration": a["expiration"],
                        "dte": a["dte"], "long": a, "short": b, "width": round(width, 2), "debit": debit,
                        "max_profit": round(width - debit, 2), "max_loss": debit,
                        "reward_to_risk": round((width - debit) / debit, 2),
                        "breakeven": round(a["strike"] + debit, 2)})
        else:
            if a["bid"] is None or b["ask"] is None:
                continue
            credit = round(a["bid"] - b["ask"], 2)
            if credit <= 0 or credit >= width:
                continue
            out.append({"underlying": a["underlying"], "underlying_price": px, "expiration": a["expiration"],
                        "dte": a["dte"], "short": a, "long": b, "width": round(width, 2), "credit": credit,
                        "max_profit": credit, "max_loss": round(width - credit, 2),
                        "return_on_risk_pct": round(credit / (width - credit) * 100, 1),
                        "breakeven": round(a["strike"] - credit if kind == "bull_put_spreads"
                                           else a["strike"] + credit, 2)})
    key = "reward_to_risk" if kind == "bull_call_spreads" else "return_on_risk_pct"
    out.sort(key=lambda r: r[key], reverse=True)
    return out, len(anchors)


def run_on(path: str, kind: str, *, underlyings: Optional[list] = None, limit: int = 50) -> dict:
    if kind not in STRATEGIES:
        raise BadQuery(f"unknown strategy {kind!r}; one of {', '.join(STRATEGIES)}")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        prices = dict(con.execute("SELECT underlying, price FROM underlyings").fetchall())
        meta = dict(con.execute("SELECT k, v FROM meta").fetchall())
        if kind in ("covered_calls", "cash_secured_puts"):
            rows, read = _single(con, "C" if kind == "covered_calls" else "P",
                                 10 if kind == "covered_calls" else 15, underlyings, prices, kind)
        else:
            rows, read = _spread(con, kind, underlyings, prices)
    finally:
        con.close()
    spec = STRATEGIES[kind]
    return {"strategy": kind, "label": spec["label"], "description": spec["description"],
            "session": meta.get("session"), "data_basis": DATA_BASIS, "fill": FILL,
            "computed": "yields, credits, debits and breakevens are computed from the logged quotes",
            "candidates_read": read, "candidate_cap": CANDIDATE_CAP, "matches": len(rows),
            "rows": rows[:max(1, min(MAX_ROWS, limit))]}


# ── COV-02's store, imported lazily ─────────────────────────────────────────────

def _default_screen_db() -> tuple:
    try:
        from api.services.research import options_screener as cov02
    except ImportError as e:
        raise NoStore("the COV-02 screen store is not on this build") from e
    store = cov02.get_store()
    sessions = store.screen_sessions()
    if not sessions:
        raise NoStore("no session has a screen file yet")
    session = sessions[-1]
    path = store.screen_db(session)
    if not path:
        raise NoStore(f"the {session} screen file could not be read")
    return session, path


_screen_db: Callable[[], tuple] = _default_screen_db


def run(kind: str, *, underlyings: Optional[list] = None, limit: int = 50) -> dict:
    _, path = _screen_db()
    return run_on(path, kind, underlyings=underlyings, limit=limit)
