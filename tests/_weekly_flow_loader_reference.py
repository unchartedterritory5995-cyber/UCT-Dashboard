"""FROZEN REFERENCE -- the board loader as it was before the 2026-10-11 speed pass (origin/master
`api/weekly_flow.py`, `_last_n_dates` + `load_directional_trades`). tests/test_flow_board_perf.py
execs this source against weekly_flow's own helpers and asserts the live loader returns the SAME
trades and window on a fixture. Do not edit it to make a test pass: it is the parity oracle.
"""
REFERENCE_SRC = r'''
def _last_n_dates(conn, n: int, source: str = "stocks") -> list[str]:
    rows = conn.execute(
        "SELECT DISTINCT CreatedDate FROM flow WHERE source=?", (source,)).fetchall()
    dated = sorted((r[0] for r in rows if r[0]),
                   key=lambda s: _parse_mdy(s) or date.min)
    return dated[-n:] if n > 0 else dated


def load_directional_trades(days: int, min_dte: int, cap: str | None = None,
                            today: date | None = None,
                            min_premium: float = 0.0,
                            clean_only: bool = False) -> tuple[list[dict], list[str]]:
    """Port of flowCompute.js `filtered` + `all_directional`, plus the weekly
    DTE≥min_dte cut. Returns (trades, window_dates). Each trade dict carries the
    fields the aggregation + card need. `min_premium` pushes a SQL-level premium
    floor into the row pull (0 = off, keeps card parity) — the searchable board
    uses it so a multi-week scan doesn't classify millions of odd-lot prints."""
    ref = today or date.today()
    is_etf = (cap or "").strip().lower() == "etf"   # ETFs live under source='indexes'
    src = "indexes" if is_etf else "stocks"
    conn = sqlite3.connect(_flow_db_path(), timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        window = _last_n_dates(conn, days, src)
        if not window:
            return [], []
        qs = ",".join("?" * len(window))
        params = [src] + list(window)
        prem_sql = ""
        if min_premium and min_premium > 0:
            # Premium is stored as TEXT in flow.db — MUST CAST or ">= ?" is a
            # lexicographic string compare ("9000" > "100000"), which inverts the
            # floor. Matches the CAST(Premium AS REAL) pattern used everywhere else.
            prem_sql = " AND CAST(Premium AS REAL) >= ?"
            params.append(min_premium)
        rows = conn.execute(f"""
            SELECT CreatedDate, CreatedTime, Symbol, Type, Volume, Side, CallPut,
                   Strike, Spot, Premium, ExpirationDate, Color, Dte, StockEtf, MktCap, OI
              FROM flow
             WHERE source=? AND CreatedDate IN ({qs}){prem_sql}
        """, params).fetchall()
    finally:
        conn.close()

    # ── base filter (flowCompute L1106): non-ML, has ticker/type/cp, DTE≥0,
    #    V>0, P>0. Ty must be SWP or BLK (null-type dropped). ────────────────
    base = []
    for r in rows:
        ty = _ty(r["Type"])
        if ty in (None, "ML"):
            continue
        sym = (r["Symbol"] or "").upper().strip()
        cpr = (r["CallPut"] or "").upper().strip()
        cp = "C" if cpr == "CALL" else "P" if cpr == "PUT" else (cpr[:1] if cpr[:1] in ("C", "P") else "")
        vol = _pint(r["Volume"])
        prem = _pfloat(r["Premium"])
        dte_row = _pint(r["Dte"])
        if not sym or not cp or vol <= 0 or prem <= 0 or dte_row < 0:
            continue
        color = _color_norm(r["Color"])
        if color in ("ORANGE", "ARB"):     # dark-pool + arb noise dropped
            continue
        # clean-only: keep just CONFIRMED clusters (YELLOW/MAGENTA), drop
        # unconfirmed WHITE flow. Used for the mega/large weekly cards where the
        # owner wants only clean, high-conviction names (WHITE-dominant megacap
        # flow is noisy and out-sizes everything). Mid-small keeps all directional.
        if clean_only and color not in ("YELLOW", "MAGENTA"):
            continue
        mktcap = _pfloat(r["MktCap"])
        stk = (r["StockEtf"] or "").upper().strip()
        if is_etf:
            if stk == "INDEX":             # ETFs scope: drop true index options (SPX/VIX)
                continue
        elif not _cap_ok(mktcap, cap):     # stock cap-band filter (mega/large/mid_small)
            continue
        exp = r["ExpirationDate"] or ""
        exp_d = _parse_mdy(exp)
        live_dte = (exp_d - ref).days if exp_d else dte_row
        base.append({
            "S": sym, "CP": cp, "K": _pfloat(r["Strike"]), "Spot": _pfloat(r["Spot"]),
            "V": vol, "P": prem, "OI": _pint(r["OI"]), "E": exp, "live_dte": live_dte,
            "Ty": ty, "Si": _side_norm(r["Side"]), "Co": color,
            "mktcap": _pfloat(r["MktCap"]), "Dt": r["CreatedDate"],
            "time": r["CreatedTime"], "stocketf": stk,
        })

    # ── same-second 3+ strike spread drop (flowCompute L1110) ──────────────
    ts_strikes: dict = {}
    for t in base:
        ts_strikes.setdefault((t["S"], t["CP"], t["time"]), set()).add(t["K"])
    spread = {k for k, s in ts_strikes.items() if len(s) >= 3}
    base = [t for t in base if (t["S"], t["CP"], t["time"]) not in spread]

    # ── deep ITM/OTM arb (flowCompute L1147) ───────────────────────────────
    deep_blk, deep_swp = set(), set()
    for t in base:
        pct = abs(t["K"] - t["Spot"]) / t["Spot"] * 100 if t["Spot"] > 0 else 0
        if pct < 10:
            continue
        itm = (t["CP"] == "C" and t["K"] < t["Spot"]) or (t["CP"] == "P" and t["K"] > t["Spot"])
        if not itm:
            key = (t["S"], t["CP"], t["K"], t["E"])
            if t["Ty"] == "BLK":
                deep_blk.add(key)
            elif t["Ty"] == "SWP":
                deep_swp.add(key)

    def _keep_arb(t) -> bool:
        pct = abs(t["K"] - t["Spot"]) / t["Spot"] * 100 if t["Spot"] > 0 else 0
        is_deep = pct >= (10 if t["Ty"] == "BLK" else 20)
        if not is_deep:
            return True
        itm = (t["CP"] == "C" and t["K"] < t["Spot"]) or (t["CP"] == "P" and t["K"] > t["Spot"])
        if itm and t["Ty"] == "BLK":
            return False
        if itm:
            intrinsic = (t["Spot"] - t["K"]) if t["CP"] == "C" else (t["K"] - t["Spot"])
            return not (t["Spot"] > 0 and intrinsic > t["Spot"] * 0.5)
        key = (t["S"], t["CP"], t["K"], t["E"])
        if key in deep_blk and key in deep_swp:
            return True
        return t["Ty"] != "BLK"

    base = [t for t in base if _keep_arb(t)]

    # ── direction + heavy-block strip + mega premium floor + DTE≥min_dte ────
    out = []
    for t in base:
        d = _direction(t["CP"], t["Si"], t["Ty"] == "SWP", t["Spot"], t["K"],
                       t["mktcap"], t["live_dte"])
        if d and t["Ty"] == "BLK" and t["P"] >= _HEAVY_BLOCK_PREMIUM:
            d = None                                  # heavy block = non-directional
        if not d:
            continue                                  # all_directional = has direction
        if t["mktcap"] >= 500e9 and t["P"] < 100000:  # premiumFilter mega floor
            continue
        if t["live_dte"] < min_dte:                   # short-term cut (owner: <30)
            continue
        t["D"] = d
        out.append(t)
    return out, window

'''
