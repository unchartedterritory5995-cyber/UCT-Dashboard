"""Weekly Conviction Flow → Discord.

Top-10 bullish + top-10 bearish options-flow names over the last N days
(adjustable; default 5 = the trading week) whose flow is STILL OPEN (position not
closed / no profit-taking — current OI >= 75% of peak), excluding short-dated
flow (DTE < 30). Server-side re-port of the OptionsFlow "Leaderboard" tab so the
numbers match what the owner reads (classifier decision B). Runs on the
FLOW-WORKER (owns flow.db + contract_oi_snapshots).

Design: docs/superpowers/specs/2026-08-01-weekly-conviction-flow-design.md
Reuses alpha_gold_eod's Discord multipart post + premium formatter.

Env (flow-worker):
  WEEKLY_FLOW_ENABLED         "1" arms the Friday cron (default off / dark)
  WEEKLY_FLOW_WEBHOOK_URL     Discord webhook (falls back to LiveFlow/admin;
                              never defaults to a public channel)
  WEEKLY_FLOW_DAYS            window in trading days (default 5)
  WEEKLY_FLOW_TOP_N           names per side (default 10)
  WEEKLY_FLOW_MIN_DTE         short-term cutoff, exclude DTE < this (default 30)
  WEEKLY_FLOW_STILL_OPEN_FRAC current OI must be >= frac * peak OI (default 0.75)
  WEEKLY_FLOW_SORT_BULL       net (default) | premium | pct
  WEEKLY_FLOW_SORT_BEAR       net (default) | premium (Bear $) | pct
  WEEKLY_FLOW_CAP             all (default) | mega | large | mid_small
  WEEKLY_FLOW_CRON_CAPS       comma list the Fri cron posts (default all,mid_small)
"""
from __future__ import annotations

import io
import logging
import os
import sqlite3
from datetime import date, datetime

from api.alpha_gold_eod import _fmt_prem, _post_discord_image

log = logging.getLogger("weekly_flow")

_ASSETS = os.path.join(os.path.dirname(__file__), "services", "desk_assets")

# ── palette (shared brand look with the Top Flow card) ─────────────────────
_BG = (12, 14, 17)
_BAND = (18, 21, 25)
_ROWALT = (16, 19, 23)
_GOLD = (201, 168, 76)
_GOLD_DIM = (150, 128, 66)
_TXT = (223, 227, 231)
_DIM = (132, 139, 148)
_DIV = (36, 40, 46)
_BULL = (74, 200, 120)
_BEAR = (232, 96, 96)

_HEAVY_BLOCK_PREMIUM = 10e6   # BLOCK >= $10M → non-directional (flowCompute rule)


# ── small parsers ──────────────────────────────────────────────────────────
def _pint(v) -> int:
    try:
        return int(float(str(v).replace(",", "").replace("$", "").strip() or 0))
    except (TypeError, ValueError):
        return 0


def _pfloat(v) -> float:
    try:
        return float(str(v).replace(",", "").replace("$", "").strip() or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_mdy(s: str):
    try:
        m, d, y = (int(x) for x in str(s).split("/")[:3])
        return date(y if y > 99 else y + 2000, m, d)
    except (ValueError, TypeError):
        return None


def _dte_of(exp, ref: date | None = None) -> str:
    d = _parse_mdy(exp)
    return f"{(d - (ref or date.today())).days}d" if d else "—"


def _exp_short(exp) -> str:
    """M/D/YYYY -> M/D/YY. Keeps the year — standing-conviction contracts span
    2026-2028, so a bare M/D can't tell a Jan '27 from a Jan '28."""
    p = str(exp).split("/")
    return f"{int(p[0])}/{int(p[1])}/{p[2][2:]}" if len(p) == 3 and p[2] else str(exp)


# ── cap bands (match the OptionsFlow Leaderboard cap filter) ───────────────
_CAP_LABELS = {"all": "All Caps", "mega": "Mega Cap", "large": "Large Cap",
               "mid_small": "Mid-Small Cap"}


def _cap_ok(mktcap: float, cap: str | None) -> bool:
    if not cap or cap == "all":
        return True
    if cap == "mega":
        return mktcap > 200e9
    if cap == "large":
        return 10e9 <= mktcap <= 200e9
    if cap == "mid_small":
        return 0 < mktcap < 10e9        # excludes unknown (0) mktcap
    return True


# ── classification — PORT of flowCompute.js processFlowData (decision B) ───
def _side_norm(s: str) -> str:
    s = (s or "").upper().strip()
    if "ABOVE" in s or s == "AA":
        return "AA"
    if "BELOW" in s or s == "BB":
        return "BB"
    if s == "A" or "ASK" in s:
        return "A"
    if s == "B" or "BID" in s:
        return "B"
    return ""


def _ty(type_: str) -> str | None:
    t = (type_ or "").upper().strip()
    if t == "ML/" or t.startswith("ML/"):
        return "ML"
    if t == "SWEEP" or "SWP" in t or "SWEEP" in t:
        return "SWP"
    if t == "BLOCK" or "BLK" in t:
        return "BLK"
    return None


def _color_norm(c: str) -> str:
    c = (c or "").upper().strip()
    if c in ("YELLOW", "Y"):
        return "YELLOW"
    if c in ("MAGENTA", "PURPLE", "M"):
        return "MAGENTA"
    if c == "ORANGE":
        return "ORANGE"
    if c == "ARB":
        return "ARB"
    return "WHITE"


def _direction(cp: str, side: str, is_swp: bool, spot: float, strike: float,
               mktcap: float, live_dte: int) -> str | None:
    """flowCompute.js:854-877 — CALL A/AA→BULL, BB+sweep→BEAR, blank+sweep→BULL;
    PUT inverse; then the ≤7-DTE mega/large-cap OTM lottery kill."""
    d = None
    if cp == "C":
        if side in ("A", "AA"):
            d = "BULL"
        elif side == "BB" and is_swp:
            d = "BEAR"
        elif not side and is_swp:
            d = "BULL"
    elif cp == "P":
        if side in ("A", "AA"):
            d = "BEAR"
        elif side == "BB" and is_swp:
            d = "BULL"
        elif not side and is_swp:
            d = "BEAR"
    if d and spot > 0 and 0 <= live_dte <= 7 and mktcap >= 10e9:
        is_otm = (cp == "C" and strike > spot) or (cp == "P" and strike < spot)
        if is_otm:
            otm_pct = abs(strike - spot) / spot * 100
            if otm_pct >= (10 if mktcap >= 200e9 else 15):
                d = None
    return d


def _flow_db_path() -> str:
    from api.live_massive_router import DB_PATH
    return DB_PATH


def _last_n_dates(conn, n: int) -> list[str]:
    rows = conn.execute(
        "SELECT DISTINCT CreatedDate FROM flow WHERE source='stocks'").fetchall()
    dated = sorted((r[0] for r in rows if r[0]),
                   key=lambda s: _parse_mdy(s) or date.min)
    return dated[-n:] if n > 0 else dated


def load_directional_trades(days: int, min_dte: int, cap: str | None = None,
                            today: date | None = None) -> tuple[list[dict], list[str]]:
    """Port of flowCompute.js `filtered` + `all_directional`, plus the weekly
    DTE≥min_dte cut. Returns (trades, window_dates). Each trade dict carries the
    fields the aggregation + card need."""
    ref = today or date.today()
    conn = sqlite3.connect(_flow_db_path(), timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        window = _last_n_dates(conn, days)
        if not window:
            return [], []
        qs = ",".join("?" * len(window))
        rows = conn.execute(f"""
            SELECT CreatedDate, CreatedTime, Symbol, Type, Volume, Side, CallPut,
                   Strike, Spot, Premium, ExpirationDate, Color, Dte, StockEtf, MktCap, OI
              FROM flow
             WHERE source='stocks' AND CreatedDate IN ({qs})
        """, window).fetchall()
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
        mktcap = _pfloat(r["MktCap"])
        if not _cap_ok(mktcap, cap):       # cap-band filter (mega/large/mid_small)
            continue
        exp = r["ExpirationDate"] or ""
        exp_d = _parse_mdy(exp)
        live_dte = (exp_d - ref).days if exp_d else dte_row
        base.append({
            "S": sym, "CP": cp, "K": _pfloat(r["Strike"]), "Spot": _pfloat(r["Spot"]),
            "V": vol, "P": prem, "OI": _pint(r["OI"]), "E": exp, "live_dte": live_dte,
            "Ty": ty, "Si": _side_norm(r["Side"]), "Co": color,
            "mktcap": _pfloat(r["MktCap"]), "Dt": r["CreatedDate"],
            "time": r["CreatedTime"], "stocketf": (r["StockEtf"] or "").upper().strip(),
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


# ── still-open (current OI >= frac * peak, from contract_oi_snapshots) ─────
def _still_open_keys(contract_keys: set, frac: float) -> set:
    from api import oi_snapshots
    keys = [k for k in contract_keys if k]
    if not keys:
        return set()
    latest = oi_snapshots.get_latest_oi_batch(keys) or {}
    peak: dict = {}
    conn = sqlite3.connect(oi_snapshots.OI_DB_PATH, timeout=10)
    try:
        for i in range(0, len(keys), 400):
            chunk = keys[i:i + 400]
            q = ("SELECT contract_key, MAX(oi) FROM contract_oi_snapshots "
                 f"WHERE contract_key IN ({','.join('?' * len(chunk))}) "
                 "GROUP BY contract_key")
            for k, mx in conn.execute(q, chunk):
                peak[k] = mx or 0
    except Exception:  # noqa: BLE001
        log.exception("[weekly-flow] peak-OI query failed")
        return set()
    finally:
        conn.close()
    out = set()
    for k in keys:
        p = peak.get(k, 0)
        lv = latest.get(k)                       # get_latest_oi_batch → (oi, snap_date)
        lat = lv[0] if isinstance(lv, (tuple, list)) else (lv or 0)
        if p > 0 and lat >= frac * p:
            out.add(k)
    return out


def _contract_key(t: dict) -> str:
    from api import oi_snapshots
    return oi_snapshots.make_key(t["S"], t["CP"], t["K"], t["E"])


# ── aggregate per ticker + rank ────────────────────────────────────────────
# Independent sort keys per side (all used reverse=True). net negated for bears
# so the most-negative net ranks first; pct tiebreaks on directional premium.
_BULL_SORT = {"net": lambda e: e["net"], "premium": lambda e: e["bull"],
              "pct": lambda e: (e["bullPct"], e["bull"])}
_BEAR_SORT = {"net": lambda e: -e["net"], "premium": lambda e: e["bear"],
              "pct": lambda e: (100 - e["bullPct"], e["bear"])}


def aggregate(trades: list[dict], top_n: int, still_open_frac: float,
              sort_bull: str = "net", sort_bear: str = "premium") -> dict:
    """Filter to still-open contracts, sum bull/bear premium per ticker, split
    and rank top-N each (bulls by sort_bull, bears by sort_bear)."""
    keys = {_contract_key(t) for t in trades}
    open_keys = _still_open_keys(keys, still_open_frac)
    trades = [t for t in trades if _contract_key(t) in open_keys]

    tk: dict = {}
    for t in trades:
        e = tk.setdefault(t["S"], {"sym": t["S"], "bull": 0.0, "bear": 0.0,
                                   "contracts": {}, "first": None, "first_spot": 0.0,
                                   "last_dt": None, "last_spot": 0.0})
        if t["D"] == "BULL":
            e["bull"] += t["P"]
        else:
            e["bear"] += t["P"]
        ck = f'{t["CP"]}|{t["K"]}|{t["E"]}'
        c = e["contracts"].setdefault(ck, {"cp": t["CP"], "K": t["K"], "exp": t["E"],
                                           "prem": 0.0, "dir": t["D"]})
        c["prem"] += t["P"]
        # earliest/latest print date + the underlying spot at each, for the
        # Standing Conviction card's "since"/age + since-open performance (spot at
        # first print vs latest spot on the tape). Weekly ignores these; test
        # trades carry no "Dt"/"Spot" and stay None/0 — harmless.
        dt = _parse_mdy(t.get("Dt", ""))
        sp = t.get("Spot", 0.0) or 0.0
        if dt:
            if e["first"] is None or dt < e["first"]:
                e["first"], e["first_spot"] = dt, sp
            if e["last_dt"] is None or dt > e["last_dt"]:
                e["last_dt"], e["last_spot"] = dt, sp

    for e in tk.values():
        e["net"] = e["bull"] - e["bear"]
        tot = e["bull"] + e["bear"]
        e["bullPct"] = round(e["bull"] / tot * 100) if tot else 50
        e["top"] = max(e["contracts"].values(), key=lambda c: c["prem"], default=None)

    names = list(tk.values())
    bulls = sorted((e for e in names if e["net"] > 0),
                   key=_BULL_SORT.get(sort_bull, _BULL_SORT["net"]), reverse=True)[:top_n]
    bears = sorted((e for e in names if e["net"] < 0),
                   key=_BEAR_SORT.get(sort_bear, _BEAR_SORT["premium"]), reverse=True)[:top_n]
    return {"bulls": bulls, "bears": bears, "open_contracts": len(open_keys),
            "n_names": len(names)}


# ── render ─────────────────────────────────────────────────────────────────
_W = 1040


def _week_range(window: list[str]) -> str:
    if not window:
        return ""
    ds = sorted((_parse_mdy(d) for d in window if _parse_mdy(d)))
    if not ds:
        return ""
    a, b = ds[0], ds[-1]
    if a == b:
        return f"{a.strftime('%b')} {a.day}, {a.year}"
    same_m = a.month == b.month
    return (f"{a.strftime('%b')} {a.day}"
            + (f"–{b.day}" if same_m else f" – {b.strftime('%b')} {b.day}")
            + f", {b.year}")


def render_card(agg: dict, window: list[str], days: int, min_dte: int,
                cap_label: str = "") -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    SS = 2

    def font(name, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, name), int(pt * SS))

    def s(v):
        return int(v * SS)

    ROWH, TOP, SECH = 34, 126, 32
    sections = [("▲  TOP BULLISH", agg["bulls"], _BULL),
                ("▼  TOP BEARISH", agg["bears"], _BEAR)]
    body = sum(SECH + max(1, len(rows)) * ROWH for _, rows, _ in sections)
    H = TOP + body + 54

    img = Image.new("RGB", (s(_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    f_title = font("DejaVuSans-Bold.ttf", 30)
    f_date, f_sum = font("DejaVuSans.ttf", 19), font("DejaVuSans-Bold.ttf", 16)
    f_hdr = font("DejaVuSans-Bold.ttf", 12)
    f_sec = font("DejaVuSans-Bold.ttf", 15)
    f_row, f_rowb = font("DejaVuSans.ttf", 15), font("DejaVuSans-Bold.ttf", 15)
    f_foot = font("DejaVuSans.ttf", 12)

    def txt(x, y, t, fnt, fill, align="l"):
        t = str(t)
        w = d.textlength(t, font=fnt)
        d.text(((x * SS - w) if align == "r" else s(x), s(y)), t, font=fnt, fill=fill)
        return w / SS

    # title band + UCT logo
    d.rectangle([0, 0, s(_W), s(TOP - 26)], fill=_BAND)
    try:
        lg = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        lg.putdata([(r, g, b, 0 if (r > 242 and g > 242 and b > 242) else a)
                    for (r, g, b, a) in lg.getdata()])
        lg = lg.resize((s(48), s(48)), Image.LANCZOS)
        img.paste(lg, (s(32), s(18)), lg)
    except Exception:  # noqa: BLE001
        pass
    tx = 94
    tx += txt(tx, 18, "UCT Intelligence", f_title, _GOLD) + 12
    tx += txt(tx, 18, "· Weekly Conviction", f_title, _GOLD_DIM) + 12
    if cap_label:
        txt(tx, 18, "· " + cap_label, f_title, _GOLD_DIM)
    txt(94, 58, _week_range(window), f_date, _DIM)

    # column headers
    cols = [("TICKER", 36, "l"), ("BULL", 290, "r"), ("BEAR", 408, "r"),
            ("BULL%", 486, "r"), ("NET", 610, "r"), ("EXP", 656, "l"),
            ("STRIKE", 800, "r"), ("C/P", 808, "l"), ("DTE", 1000, "r")]
    for hdr, x, al in cols:
        txt(x, TOP - 30, hdr, f_hdr, _DIM, al)
    d.rectangle([s(36), s(TOP - 10), s(_W - 36), s(TOP - 10) + 1], fill=_DIV)

    y = TOP + 4
    for label, rows, col in sections:
        d.rectangle([0, s(y - 4), s(_W), s(y - 4) + s(SECH - 6)], fill=_BAND)
        txt(40, y, label, f_sec, col)
        y += SECH
        if not rows:
            txt(40, y, "—", f_row, _DIM)
            y += ROWH
        for i, e in enumerate(rows):
            if i % 2 == 1:
                d.rectangle([0, s(y - 6), s(_W), s(y - 6) + s(ROWH)], fill=_ROWALT)
            txt(36, y, e["sym"], f_rowb, _GOLD)
            txt(290, y, _fmt_prem(e["bull"]) if e["bull"] else "—", f_row, _BULL, "r")
            txt(408, y, _fmt_prem(e["bear"]) if e["bear"] else "—", f_row, _BEAR, "r")
            txt(486, y, f'{e["bullPct"]}%', f_row, _TXT, "r")
            net = e["net"]
            txt(610, y, f'{"+" if net >= 0 else "−"}{_fmt_prem(abs(net))}', f_rowb,
                _BULL if net >= 0 else _BEAR, "r")
            tc = e.get("top")
            if tc:
                k = int(tc["K"]) if float(tc["K"]).is_integer() else tc["K"]
                cp = tc["cp"]
                txt(656, y, "/".join(str(tc["exp"]).split("/")[:2]), f_row, _DIM)   # EXP
                txt(800, y, f"${k}", f_row, _TXT, "r")                              # STRIKE
                txt(808, y, cp, f_rowb, _BULL if cp == "C" else _BEAR)             # C/P
                txt(1000, y, _dte_of(tc["exp"]), f_row, _DIM, "r")                  # DTE
            y += ROWH
        y += 6

    d.rectangle([s(36), s(H - 40), s(_W - 36), s(H - 40) + 1], fill=_DIV)
    txt(36, H - 32, "UCT Intelligence", f_foot, _DIM)
    txt(_W - 36, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_W, H), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def render_standing_card(agg: dict, window: list[str], top_n: int,
                         ref_date: date | None = None, cap_label: str = "") -> bytes:
    """Standing Conviction card — same still-open, top-N-by-premium board as the
    weekly one, over a longer rolling window, with FIRST-SEEN + AGE columns so a
    name whose flow has been open for weeks reads as long-standing conviction.
    Separate from render_card so the weekly card + its wiring guard stay put."""
    from PIL import Image, ImageDraw, ImageFont

    SS = 2
    ref = ref_date or date.today()

    def font(name, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, name), int(pt * SS))

    def s(v):
        return int(v * SS)

    ROWH, TOP, SECH = 34, 126, 32
    sections = [("▲  TOP BULLISH", agg["bulls"], _BULL),
                ("▼  TOP BEARISH", agg["bears"], _BEAR)]
    body = sum(SECH + max(1, len(rows)) * ROWH for _, rows, _ in sections)
    H = TOP + body + 54

    img = Image.new("RGB", (s(_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    f_title = font("DejaVuSans-Bold.ttf", 30)
    f_date = font("DejaVuSans.ttf", 17)
    f_hdr = font("DejaVuSans-Bold.ttf", 12)
    f_sec = font("DejaVuSans-Bold.ttf", 15)
    f_row, f_rowb = font("DejaVuSans.ttf", 15), font("DejaVuSans-Bold.ttf", 15)
    f_foot = font("DejaVuSans.ttf", 12)

    def txt(x, y, t, fnt, fill, align="l"):
        t = str(t)
        w = d.textlength(t, font=fnt)
        d.text(((x * SS - w) if align == "r" else s(x), s(y)), t, font=fnt, fill=fill)
        return w / SS

    d.rectangle([0, 0, s(_W), s(TOP - 26)], fill=_BAND)
    try:
        lg = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        lg.putdata([(r, g, b, 0 if (r > 242 and g > 242 and b > 242) else a)
                    for (r, g, b, a) in lg.getdata()])
        lg = lg.resize((s(48), s(48)), Image.LANCZOS)
        img.paste(lg, (s(32), s(18)), lg)
    except Exception:  # noqa: BLE001
        pass
    tx = 94
    tx += txt(tx, 18, "UCT Intelligence", f_title, _GOLD) + 12
    tx += txt(tx, 18, "· Standing Conviction", f_title, _GOLD_DIM) + 12
    if cap_label:
        txt(tx, 18, "· " + cap_label, f_title, _GOLD_DIM)
    rng = _week_range(window)
    txt(94, 60, f"{rng}   ·   still open · top {top_n} by premium", f_date, _DIM)

    # TICKER · BULL · BEAR · NET · TOP CONTRACT (EXP/STRIKE/C-P) · SINCE · PERF · DTE
    # PERF = underlying spot at first print vs latest spot on the tape (since-open move)
    cols = [("TICKER", 36, "l"), ("BULL", 240, "r"), ("BEAR", 350, "r"),
            ("NET", 468, "r"), ("EXP", 512, "l"), ("STRIKE", 648, "r"),
            ("C/P", 656, "l"), ("SINCE", 806, "r"), ("PERF", 912, "r"),
            ("DTE", 1000, "r")]
    for hdr, x, al in cols:
        txt(x, TOP - 30, hdr, f_hdr, _DIM, al)
    d.rectangle([s(36), s(TOP - 10), s(_W - 36), s(TOP - 10) + 1], fill=_DIV)

    y = TOP + 4
    for label, rows, col in sections:
        d.rectangle([0, s(y - 4), s(_W), s(y - 4) + s(SECH - 6)], fill=_BAND)
        txt(40, y, label, f_sec, col)
        y += SECH
        if not rows:
            txt(40, y, "—", f_row, _DIM)
            y += ROWH
        for i, e in enumerate(rows):
            if i % 2 == 1:
                d.rectangle([0, s(y - 6), s(_W), s(y - 6) + s(ROWH)], fill=_ROWALT)
            txt(36, y, e["sym"], f_rowb, _GOLD)
            txt(240, y, _fmt_prem(e["bull"]) if e["bull"] else "—", f_row, _BULL, "r")
            txt(350, y, _fmt_prem(e["bear"]) if e["bear"] else "—", f_row, _BEAR, "r")
            net = e["net"]
            txt(468, y, f'{"+" if net >= 0 else "−"}{_fmt_prem(abs(net))}', f_rowb,
                _BULL if net >= 0 else _BEAR, "r")
            tc = e.get("top")
            if tc:
                k = int(tc["K"]) if float(tc["K"]).is_integer() else tc["K"]
                txt(512, y, _exp_short(tc["exp"]), f_row, _DIM)                     # EXP (yr)
                txt(648, y, f"${k}", f_row, _TXT, "r")                              # STRIKE
                txt(656, y, tc["cp"], f_rowb, _BULL if tc["cp"] == "C" else _BEAR)  # C/P
            first = e.get("first")
            txt(806, y, f"{first.strftime('%b')} {first.day}" if first else "—",
                f_row, _TXT if first else _DIM, "r")                                  # SINCE
            # PERF — underlying's move from first-seen spot to latest spot on the tape
            fs, ls = e.get("first_spot", 0) or 0, e.get("last_spot", 0) or 0
            if fs > 0 and ls > 0:
                pf = (ls / fs - 1) * 100
                txt(912, y, f'{"+" if pf >= 0 else "−"}{abs(pf):.1f}%', f_row,
                    _BULL if pf >= 0 else _BEAR, "r")
            else:
                txt(912, y, "—", f_row, _DIM, "r")
            txt(1000, y, _dte_of(tc["exp"], ref) if tc else "—", f_row, _DIM, "r")    # DTE
            y += ROWH
        y += 6

    d.rectangle([s(36), s(H - 40), s(_W - 36), s(H - 40) + 1], fill=_DIV)
    txt(36, H - 32, "UCT Intelligence", f_foot, _DIM)
    txt(_W - 36, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_W, H), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


# ── orchestration ──────────────────────────────────────────────────────────
def _webhook() -> str:
    return (os.getenv("WEEKLY_FLOW_WEBHOOK_URL")
            or os.getenv("DISCORD_MASSIVE_WEBHOOK_URL")
            or os.getenv("DISCORD_LIVE_FLOW_WEBHOOK_URL")
            or os.getenv("DISCORD_WEBHOOK_URL", "")).strip()


def run_weekly(*, force: bool = False, post: bool = True, days: int | None = None,
               cap: str | None = None, sort_bull: str | None = None,
               sort_bear: str | None = None) -> dict:
    """Build + optionally post the weekly conviction card. `force` bypasses the
    WEEKLY_FLOW_ENABLED gate (manual trigger). post=False returns the PNG under
    'png' for preview. `cap` = all/mega/large/mid_small. Never raises."""
    try:
        if os.getenv("WEEKLY_FLOW_ENABLED", "0") != "1" and not force:
            return {"ok": False, "reason": "disabled (WEEKLY_FLOW_ENABLED != 1)"}
        n_days = days if days is not None else int(os.getenv("WEEKLY_FLOW_DAYS", "5"))
        top_n = int(os.getenv("WEEKLY_FLOW_TOP_N", "10"))
        min_dte = int(os.getenv("WEEKLY_FLOW_MIN_DTE", "30"))
        frac = float(os.getenv("WEEKLY_FLOW_STILL_OPEN_FRAC", "0.75"))
        cap = (cap or os.getenv("WEEKLY_FLOW_CAP", "all")).strip().lower()
        sort_bull = (sort_bull or os.getenv("WEEKLY_FLOW_SORT_BULL", "net")).strip().lower()
        sort_bear = (sort_bear or os.getenv("WEEKLY_FLOW_SORT_BEAR", "net")).strip().lower()

        trades, window = load_directional_trades(n_days, min_dte, cap)
        agg = aggregate(trades, top_n, frac, sort_bull, sort_bear)
        png = render_card(agg, window, n_days, min_dte, _CAP_LABELS.get(cap, ""))
        res = {"ok": True, "days": n_days, "cap": cap, "names": agg["n_names"],
               "bulls": len(agg["bulls"]), "bears": len(agg["bears"]),
               "open_contracts": agg["open_contracts"]}
        if not post:
            res["png"] = png
            return res
        wh = _webhook()
        if not wh:
            res.update(posted=False, reason="no webhook (set WEEKLY_FLOW_WEBHOOK_URL)")
            return res
        ok, detail = _post_discord_image(wh, png, "", filename="weekly_flow.png")
        res.update(posted=ok, detail=detail)
        log.info("[weekly-flow] %dd — %d names, posted=%s (%s)",
                 n_days, agg["n_names"], ok, detail)
        return res
    except Exception as e:  # noqa: BLE001
        log.exception("[weekly-flow] run failed")
        return {"ok": False, "reason": f"error: {e}"}


def run_weekly_cron() -> dict:
    """Scheduled Friday push (P2) — posts ONE card per cap in WEEKLY_FLOW_CRON_CAPS
    (default 'all,mid_small': the big board + the mid-small board). Each goes
    through run_weekly (gated by WEEKLY_FLOW_ENABLED). Never raises."""
    try:
        caps = [c.strip().lower() for c in
                os.getenv("WEEKLY_FLOW_CRON_CAPS", "all,mid_small").split(",") if c.strip()]
        return {"posts": [run_weekly(cap=cap) for cap in (caps or ["all"])]}
    except Exception as e:  # noqa: BLE001
        log.exception("[weekly-flow] cron failed")
        return {"ok": False, "reason": f"error: {e}"}


def _standing_webhook() -> str:
    return (os.getenv("STANDING_FLOW_WEBHOOK_URL", "").strip() or _webhook())


def run_standing(*, force: bool = False, post: bool = True, days: int | None = None,
                 cap: str | None = None, top_n: int | None = None) -> dict:
    """Build + optionally post the Standing Conviction card — a rolling
    still-open, top-N-by-premium board over a longer window (default 60 trading
    days ≈ 6 weeks) with a FIRST-SEEN / AGE column. Reuses the weekly engine
    (flow.db scan + OI still-open) with sort=premium both sides. `force` bypasses
    STANDING_FLOW_ENABLED; post=False returns the PNG under 'png'. Never raises."""
    try:
        if os.getenv("STANDING_FLOW_ENABLED", "0") != "1" and not force:
            return {"ok": False, "reason": "disabled (STANDING_FLOW_ENABLED != 1)"}
        n_days = days if days is not None else int(os.getenv("STANDING_FLOW_DAYS", "60"))
        top_n = top_n if top_n is not None else int(os.getenv("STANDING_FLOW_TOP_N", "10"))
        min_dte = int(os.getenv("STANDING_FLOW_MIN_DTE", "30"))
        frac = float(os.getenv("STANDING_FLOW_STILL_OPEN_FRAC", "0.75"))
        cap = (cap or os.getenv("STANDING_FLOW_CAP", "all")).strip().lower()

        trades, window = load_directional_trades(n_days, min_dte, cap)
        agg = aggregate(trades, top_n, frac, sort_bull="premium", sort_bear="premium")
        png = render_standing_card(agg, window, top_n, cap_label=_CAP_LABELS.get(cap, ""))
        res = {"ok": True, "days": n_days, "cap": cap, "names": agg["n_names"],
               "bulls": len(agg["bulls"]), "bears": len(agg["bears"]),
               "open_contracts": agg["open_contracts"]}
        if not post:
            res["png"] = png
            return res
        wh = _standing_webhook()
        if not wh:
            res.update(posted=False, reason="no webhook (set STANDING_FLOW_WEBHOOK_URL)")
            return res
        ok, detail = _post_discord_image(wh, png, "", filename="standing_flow.png")
        res.update(posted=ok, detail=detail)
        log.info("[standing-flow] %dd — %d names, posted=%s (%s)",
                 n_days, agg["n_names"], ok, detail)
        return res
    except Exception as e:  # noqa: BLE001
        log.exception("[standing-flow] run failed")
        return {"ok": False, "reason": f"error: {e}"}


def run_standing_cron() -> dict:
    """Scheduled Standing Conviction push — one card per cap in
    STANDING_FLOW_CRON_CAPS (default 'all'). Gated by STANDING_FLOW_ENABLED."""
    try:
        caps = [c.strip().lower() for c in
                os.getenv("STANDING_FLOW_CRON_CAPS", "all").split(",") if c.strip()]
        return {"posts": [run_standing(cap=cap) for cap in (caps or ["all"])]}
    except Exception as e:  # noqa: BLE001
        log.exception("[standing-flow] cron failed")
        return {"ok": False, "reason": f"error: {e}"}
