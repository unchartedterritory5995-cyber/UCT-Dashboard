"""FT-073 remainder (lane/o-options-remainders): the strategy screens the first set left open.

  call_butterflies  over COV-02's end-of-day screen file: buy the strike below, sell two at the
                    center, buy the strike above at the same distance; center within 3% of spot,
                    14-60 days, open interest 100+ on every leg. Conservative fill (buy at the ask,
                    sell at the bid). Sorted by reward to risk.
  by_expiration     over the same file: per underlying and expiration, total volume, open
                    interest, the call share of volume and the at-the-money IV (the strike
                    nearest spot, the logged IV). Sorted by volume.
  block_trades      over TODAY'S flow tape: the prints the tape itself types BLOCK (Market Tide's
                    read, `market_tide.extras`), largest premium first.

⛔ NOT BUILT: "multi-leg option trades". The tape carries no multi-leg flag; the condition codes
   that mark a multi-leg print live on flow-worker's raw trades, not on the tape web reads.
⛔ End-of-day screens name their session and say so; the tape screen names its session and the
   tape's filters. Every count of what was read is returned beside what matched.
"""
from __future__ import annotations

import sqlite3
from typing import Optional

from api.services.options_analytics import strategy_screens as ss

MAX_ROWS = 100
MORE = {
    "call_butterflies": {"label": "Call butterflies", "source": "screen", "description":
                         "Buy the call one listed strike below, sell two at the center, buy the call the "
                         "same distance above; center within 3% of spot, 14-60 days, open interest 100+ on "
                         "every leg, net debit above 0 and below the wing width. Sorted by reward to risk."},
    "by_expiration": {"label": "Options by expiration", "source": "screen", "description":
                      "Per underlying and expiration: total volume and open interest, the call share of "
                      "volume, and the at-the-money IV (the strike nearest the logged spot). Sorted by "
                      "volume."},
    "block_trades": {"label": "Option block trades", "source": "tape", "description":
                     "Today's prints the flow tape types BLOCK, largest premium first."},
}
NOT_BUILT = {"multi_leg_trades": ("Multi-leg option trades are not screened: the flow tape carries no "
                                  "multi-leg flag (the condition codes live on flow-worker's raw trades).")}


def catalog() -> dict:
    return {"strategies": [{"id": k, "label": v["label"], "source": v["source"],
                            "description": v["description"]} for k, v in MORE.items()],
            "not_built": NOT_BUILT, "fill": ss.FILL, "data_basis": ss.DATA_BASIS}


def _butterflies(con, underlyings, prices: dict) -> tuple:
    sc, args = ss._scope(underlyings)
    centers = con.execute(
        f"SELECT {ss._COLS} FROM contracts WHERE cp = 'C' AND otm_d BETWEEN -30 AND 30 AND dte BETWEEN 14 AND 60 "
        f"AND oi >= 100 AND bid_c > 0{sc} ORDER BY oi DESC LIMIT ?", [*args, ss.CANDIDATE_CAP]).fetchall()
    out = []
    for t in centers:
        c = ss._row(t)
        px = prices.get(c["underlying"])
        if not px:
            continue
        exp_i = int(c["expiration"].replace("-", ""))
        km = int(round(c["strike"] * 1000))
        lo = con.execute(
            f"SELECT {ss._COLS} FROM contracts WHERE underlying = ? AND exp = ? AND cp = 'C' AND strike_m < ? "
            f"AND oi >= 100 ORDER BY strike_m DESC LIMIT 1", [c["underlying"], exp_i, km]).fetchone()
        if lo is None:
            continue
        lo = ss._row(lo)
        hi_m = 2 * km - int(round(lo["strike"] * 1000))
        hi = con.execute(
            f"SELECT {ss._COLS} FROM contracts WHERE underlying = ? AND exp = ? AND cp = 'C' AND strike_m = ? "
            f"AND oi >= 100", [c["underlying"], exp_i, hi_m]).fetchone()
        if hi is None:
            continue
        hi = ss._row(hi)
        if lo["ask"] is None or hi["ask"] is None or c["bid"] is None:
            continue
        width = round(c["strike"] - lo["strike"], 2)
        debit = round(lo["ask"] + hi["ask"] - 2 * c["bid"], 2)
        if width <= 0 or debit <= 0 or debit >= width:
            continue
        out.append({"underlying": c["underlying"], "underlying_price": px, "expiration": c["expiration"],
                    "dte": c["dte"], "lower": lo, "center": c, "upper": hi, "width": width, "debit": debit,
                    "max_profit": round(width - debit, 2), "max_loss": debit,
                    "reward_to_risk": round((width - debit) / debit, 2),
                    "breakevens": [round(lo["strike"] + debit, 2), round(hi["strike"] - debit, 2)]})
    out.sort(key=lambda r: (-r["reward_to_risk"], r["underlying"], r["expiration"]))
    return out, len(centers)


def _by_expiration(con, underlyings, prices: dict, limit: int) -> tuple:
    sc, args = ss._scope(underlyings)
    groups = con.execute(
        f"SELECT underlying, exp, MIN(dte), SUM(COALESCE(vol, 0)), SUM(COALESCE(oi, 0)), "
        f"SUM(CASE WHEN cp = 'C' THEN COALESCE(vol, 0) ELSE 0 END), COUNT(*) FROM contracts "
        f"WHERE 1 = 1{sc} GROUP BY underlying, exp ORDER BY SUM(COALESCE(vol, 0)) DESC, underlying, exp "
        f"LIMIT ?", [*args, max(1, min(MAX_ROWS, limit))]).fetchall()
    out = []
    for und, exp_i, dte, vol, oi, cvol, n in groups:
        atm = con.execute(
            "SELECT iv_bp, otm_d FROM contracts WHERE underlying = ? AND exp = ? AND iv_bp IS NOT NULL "
            "AND otm_d IS NOT NULL ORDER BY ABS(otm_d), cp LIMIT 1", [und, exp_i]).fetchone()
        out.append({"underlying": und, "underlying_price": prices.get(und),
                    "expiration": f"{exp_i // 10000:04d}-{exp_i // 100 % 100:02d}-{exp_i % 100:02d}",
                    "dte": dte, "volume": int(vol), "open_interest": int(oi), "contracts": n,
                    "call_share_pct": round(cvol / vol * 100, 1) if vol else None,
                    "atm_iv": None if atm is None else atm[0] / 10000})
    return out, len(out)


def run_on(path: str, kind: str, *, underlyings: Optional[list] = None, limit: int = 50) -> dict:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        prices = dict(con.execute("SELECT underlying, price FROM underlyings").fetchall())
        meta = dict(con.execute("SELECT k, v FROM meta").fetchall())
        if kind == "call_butterflies":
            rows, read = _butterflies(con, underlyings, prices)
        else:
            rows, read = _by_expiration(con, underlyings, prices, limit)
    finally:
        con.close()
    spec = MORE[kind]
    return {"strategy": kind, "label": spec["label"], "description": spec["description"],
            "session": meta.get("session"), "data_basis": ss.DATA_BASIS,
            "fill": ss.FILL if kind == "call_butterflies" else None,
            "computed": ("debits, reward to risk and breakevens are computed from the logged quotes"
                         if kind == "call_butterflies" else "sums and shares are computed from the logged file"),
            "candidates_read": read, "candidate_cap": ss.CANDIDATE_CAP, "matches": len(rows),
            "rows": rows[:max(1, min(MAX_ROWS, limit))]}


def block_trades(*, underlyings: Optional[list] = None, limit: int = 50) -> dict:
    from api.services.options_analytics import market_tide as mt
    ex = mt.extras("all")
    rows = ex.get("blocks") or []
    if underlyings:
        want = set(underlyings)
        rows = [r for r in rows if r["symbol"] in want]
    spec = MORE["block_trades"]
    return {"strategy": "block_trades", "label": spec["label"], "description": spec["description"],
            "session": ex.get("session"), "data_basis": "today's flow tape", "filters": mt.TAPE_FILTERS,
            "fill": None, "computed": "nothing: the prints are the tape's own",
            "candidates_read": ex.get("blocks_count", 0), "candidate_cap": len(ex.get("blocks") or []),
            "matches": len(rows), "partial": ex.get("partial"), "partial_reasons": ex.get("partial_reasons"),
            "rows": rows[:max(1, min(MAX_ROWS, limit))]}


def run(kind: str, *, underlyings: Optional[list] = None, limit: int = 50) -> dict:
    if kind not in MORE:
        raise ss.BadQuery(f"unknown screen {kind!r}; one of {', '.join(MORE)}")
    if kind == "block_trades":
        return block_trades(underlyings=underlyings, limit=limit)
    _, path = ss._screen_db()
    return run_on(path, kind, underlyings=underlyings, limit=limit)
