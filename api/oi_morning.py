"""Morning OI Update → Discord.

Early-morning (pre-open) leaderboard of the biggest OVERNIGHT open-interest builds
on contracts that had notable options flow — the "did yesterday's flow actually
build a position?" read.

OI is a once-daily OCC figure reported the NEXT morning, so a print on day T carries
day T-1's OI (the flow row's OI), and the 5:30 AM ET oi_snapshots cron then captures
day T's EOD OI. The difference (latest snapshot − flow-time OI) = the OI that grew on
the flow day = confirmation the position is real, not same-day churn.

Flow-confirmed universe ONLY (contracts present in flow.db), NOT market-wide — it's
the server-side twin of the OptionsFlow "OI Check" tab. Runs on the FLOW-WORKER
(owns flow.db + oi_snapshots.db). Mirrors weekly_flow / darkpool_eod: brand PNG +
hand-rolled Discord multipart, flag-gated, manual preview/post endpoint.

Env (flow-worker):
  OI_MORNING_ENABLED       "1" arms the 8:00 AM ET weekday cron (default off / dark)
  OI_MORNING_WEBHOOK_URL   Discord webhook (falls back to the shared flow channel;
                           never a public default)
  OI_MORNING_TOP_N         rows on the card (default 20)
  OI_MORNING_MIN_DELTA     min ΔOI (contracts) to qualify (default 500)
  OI_MORNING_MIN_PREMIUM   min aggregate premium to qualify (default 0 = off)
  OI_MORNING_DAYS          flow window in trading days (default 1 = last session)
  OI_MORNING_SOURCES       comma flow sources (default "stocks" = single names only;
                           ETFs carry huge OI and swamp the board — "stocks,indexes"
                           to include ETFs/indexes)
"""
from __future__ import annotations

import io
import logging
import os
import sqlite3
from datetime import date

from api.alpha_gold_eod import _fmt_prem, _post_discord_image
from api import oi_snapshots

log = logging.getLogger("oi_morning")

_ASSETS = os.path.join(os.path.dirname(__file__), "services", "desk_assets")

# ── palette (shared brand look with the flow cards) ────────────────────────
_BG = (12, 14, 17)
_BAND = (18, 21, 25)
_ROWALT = (16, 19, 23)
_GOLD = (201, 168, 76)
_GOLD_DIM = (150, 128, 66)
_TXT = (223, 227, 231)
_DIM = (132, 139, 148)
_DIV = (36, 40, 46)
_BULL = (74, 200, 120)     # calls
_BEAR = (232, 96, 96)      # puts
_UP = (74, 200, 120)       # positive ΔOI
_NEW = (201, 168, 76)      # NEW state
_BLD = (107, 163, 190)     # BUILDING state


# ── parsers ────────────────────────────────────────────────────────────────
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


def _parse_mdy(s):
    try:
        m, d, y = (int(x) for x in str(s).split("/")[:3])
        return date(y if y > 99 else y + 2000, m, d)
    except (ValueError, TypeError):
        return None


def _exp_short(exp) -> str:
    """M/D/YYYY -> M/D/YY (keeps the year — LEAP contracts span multiple years)."""
    p = str(exp).split("/")
    return f"{int(p[0])}/{int(p[1])}/{p[2][2:]}" if len(p) == 3 and p[2] else str(exp)


def _dte(exp, ref=None):
    d = _parse_mdy(exp)
    return (d - (ref or date.today())).days if d else None


def _fmt_oi(n) -> str:
    n = int(n or 0)
    a = abs(n)
    if a >= 1_000_000:
        return f"{n/1e6:.1f}M"
    if a >= 1_000:
        return f"{n/1e3:.1f}K"
    return str(n)


def _fmt_delta(n) -> str:
    n = int(n or 0)
    return ("+" if n >= 0 else "−") + _fmt_oi(abs(n))


def _fmt_prem_k(v) -> str:
    """Premium: $X.XXB / $X.XXM for ≥ $1M, else $NNNK (sub-million shown in K, not
    a fractional M like '$0.52M')."""
    v = float(v or 0)
    if v >= 1e9:
        return f"${v/1e9:.2f}B"
    if v >= 1e6:
        return f"${v/1e6:.2f}M"
    if v >= 1e3:
        return f"${v/1e3:.0f}K"
    return f"${v:.0f}"


def _fmt_date(iso_or_mdy) -> str:
    """ISO (YYYY-MM-DD) or M/D/YYYY → 'Mon D, YYYY'."""
    s = str(iso_or_mdy or "")
    d = None
    if "-" in s:
        try:
            p = s.split("-")
            d = date(int(p[0]), int(p[1]), int(p[2]))
        except (ValueError, IndexError):
            d = None
    else:
        d = _parse_mdy(s)
    if not d:
        return s
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def _flow_db_path() -> str:
    from api.live_massive_router import DB_PATH
    return DB_PATH


def _ty(t) -> str | None:
    t = (t or "").upper().strip()
    if t.startswith("ML/") or t == "ML/":
        return "ML"
    if "SWEEP" in t or "SWP" in t:
        return "SWP"
    if "BLOCK" in t or "BLK" in t:
        return "BLK"
    return None


def _oi_deltas(keys) -> dict:
    """{contract_key: (prior_oi, last_oi, last_date)} using the TWO most recent
    global snapshot dates in contract_oi_snapshots.

    prior_oi = the day-before OI (the real overnight baseline); 0 when the contract
    has no earlier snapshot (a brand-new position built from scratch). A contract
    absent from the latest snapshot is omitted (can't confirm). One bounded batch
    query over both dates — no per-contract fetch."""
    keys = list(dict.fromkeys(k for k in keys if k))
    if not keys:
        return {}
    conn = sqlite3.connect(oi_snapshots.OI_DB_PATH, timeout=10)
    try:
        dates = [r[0] for r in conn.execute(
            "SELECT DISTINCT snap_date FROM contract_oi_snapshots "
            "ORDER BY snap_date DESC LIMIT 2").fetchall()]
        if not dates:
            return {}
        d_last = dates[0]
        d_prior = dates[1] if len(dates) > 1 else None
        want = [d for d in (d_last, d_prior) if d]
        dph = ",".join("?" * len(want))
        by_ck: dict = {}
        for i in range(0, len(keys), 400):
            chunk = keys[i:i + 400]
            kph = ",".join("?" * len(chunk))
            for ck, sd, oi in conn.execute(
                f"SELECT contract_key, snap_date, oi FROM contract_oi_snapshots "
                f"WHERE contract_key IN ({kph}) AND snap_date IN ({dph})",
                (*chunk, *want),
            ):
                by_ck.setdefault(ck, {})[sd] = oi
    finally:
        conn.close()
    out = {}
    for ck, m in by_ck.items():
        last = m.get(d_last)
        if last is None:
            continue
        prior = m.get(d_prior, 0) if d_prior else 0
        out[ck] = (prior or 0, last, d_last)
    return out


# ── data: rank flow contracts by overnight ΔOI ─────────────────────────────
def build_rows(days: int = 1, top_n: int = 20, min_delta: int = 500,
               min_premium: float = 0.0, sources: tuple = ("stocks",)):
    """Return (rows, window). Aggregate the last N sessions' flow per contract,
    join the latest OI snapshot, rank by ΔOI = latest snapshot − flow-time OI.

    `sources` selects the flow source: ('stocks',) = single names only (DEFAULT —
    ETFs carry huge OI and swamp a raw ΔOI ranking, so the board reads all-ETF);
    pass ('stocks','indexes') to include ETFs/indexes."""
    sources = tuple(sources) or ("stocks",)
    conn = sqlite3.connect(_flow_db_path(), timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        src_ph = ",".join("?" * len(sources))
        drows = conn.execute(
            f"SELECT DISTINCT CreatedDate FROM flow WHERE source IN ({src_ph})",
            list(sources)).fetchall()
        dated = sorted((r[0] for r in drows if r[0]),
                       key=lambda s: _parse_mdy(s) or date.min)
        window = dated[-days:] if days > 0 else dated
        if not window:
            return [], []
        qs = ",".join("?" * len(window))
        frows = conn.execute(f"""
            SELECT Symbol, CallPut, Strike, ExpirationDate, Type, Volume, Premium, OI,
                   Dte, Spot, StockEtf
              FROM flow
             WHERE source IN ({src_ph}) AND CreatedDate IN ({qs})
        """, [*sources, *window]).fetchall()
    finally:
        conn.close()

    # aggregate per contract
    agg: dict = {}
    for r in frows:
        sym = (r["Symbol"] or "").upper().strip()
        cpr = (r["CallPut"] or "").upper().strip()
        cp = "C" if cpr in ("C", "CALL") else "P" if cpr in ("P", "PUT") else (cpr[:1] if cpr[:1] in ("C", "P") else "")
        strike = _pfloat(r["Strike"])
        exp = r["ExpirationDate"] or ""
        if not sym or not cp or strike <= 0 or not exp:
            continue
        # Safety net for any ETF/index routed into a 'stocks' pull — keep the board
        # single-name (the 'source' filter is the primary cut; this catches strays).
        if (r["StockEtf"] or "").upper().strip() in ("ETF", "INDEX", "ETF/FUND", "FUND"):
            continue
        key = oi_snapshots.make_key(sym, cp, strike, exp)
        e = agg.get(key)
        if not e:
            e = agg[key] = {"sym": sym, "cp": cp, "K": strike, "E": exp, "prem": 0.0,
                            "vol": 0, "hits": 0, "flowOI": 0, "types": set(),
                            "dte": _pint(r["Dte"]), "spot": _pfloat(r["Spot"])}
        e["prem"] += _pfloat(r["Premium"])
        e["vol"] += _pint(r["Volume"])
        e["hits"] += 1
        oi = _pint(r["OI"])
        # flow-time OI = the OI when the print hit (= prior EOD OCC figure). Take the
        # lowest positive across the contract's prints as the "First OI" baseline.
        if oi > 0 and (e["flowOI"] == 0 or oi < e["flowOI"]):
            e["flowOI"] = oi
        ty = _ty(r["Type"])
        if ty:
            e["types"].add(ty)

    if not agg:
        return [], window

    deltas = _oi_deltas(list(agg.keys()))

    out = []
    for key, e in agg.items():
        dv = deltas.get(key)
        if not dv:                            # no fresh OI snapshot → can't confirm
            continue
        prior_oi, last_oi, snap_date = dv
        if not last_oi:
            continue
        # First OI = the prior-day snapshot (the real overnight baseline); fall back
        # to the flow-time OI, else 0 (a brand-new position built from scratch).
        first_oi = prior_oi if prior_oi > 0 else e["flowOI"]
        delta = last_oi - first_oi
        if delta < min_delta:
            continue
        if min_premium and e["prem"] < min_premium:
            continue
        tset = e["types"]
        flow = ("S+B" if ("SWP" in tset and "BLK" in tset)
                else "SWP" if "SWP" in tset
                else "BLK" if "BLK" in tset
                else "ML")
        if flow == "ML":                      # pure multi-leg = non-directional, drop
            continue
        _d = _dte(e["E"])
        if _d is not None and _d < 0:         # expired contract, drop
            continue
        out.append({**e, "firstOI": first_oi, "lastOI": last_oi, "delta": delta,
                    "flow": flow, "snapDate": snap_date,
                    "dte": _d if _d is not None else e["dte"],
                    "state": ("NEW" if first_oi == 0
                              else "BUILDING" if last_oi > first_oi else "")})

    out.sort(key=lambda x: x["delta"], reverse=True)
    return out[:top_n], window


# ── render ───────────────────────────────────────────────────────────────
_W = 1240
# (key, header, x, align)
_COLS = [
    ("ticker", "TICKER", 36, "l"), ("cp", "C/P", 130, "l"),
    ("strike", "STRIKE", 232, "r"), ("exp", "EXP", 272, "l"),
    ("dte", "DTE", 412, "r"), ("prem", "PREM", 544, "r"),
    ("vol", "VOL", 706, "r"), ("first", "FIRST OI", 846, "r"),
    ("last", "LAST OI", 966, "r"), ("delta", "Δ OI", 1082, "r"),
    ("state", "STATE", 1100, "l"),
]


def render_card(rows: list, window: list) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    SS = 2
    ROWH, TOP = 34, 128

    def font(name, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, name), int(pt * SS))

    def s(v):
        return int(v * SS)

    body = max(1, len(rows)) * ROWH
    H = TOP + body + 54

    img = Image.new("RGB", (s(_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    f_title = font("DejaVuSans-Bold.ttf", 30)
    f_date = font("DejaVuSans.ttf", 17)
    f_hdr = font("DejaVuSans-Bold.ttf", 12)
    f_row, f_rowb = font("DejaVuSans.ttf", 15), font("DejaVuSans-Bold.ttf", 15)
    f_foot = font("DejaVuSans.ttf", 12)
    f_tag = font("DejaVuSans-Bold.ttf", 11)

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
    txt(tx, 18, "· OI Update", f_title, _GOLD_DIM)
    # subtitle: which session's flow + when OI was measured
    _sess = ""
    if window:
        a, b = window[0], window[-1]
        _sess = _fmt_date(a) if a == b else f"{_fmt_date(a)} – {_fmt_date(b)}"
    _asof = rows[0].get("snapDate") if rows else None
    _sub = f"flow {_sess}" + (f"   ·   OI as of {_fmt_date(_asof)}" if _asof else "") + "   ·   heavy volume that carried into open interest"
    txt(94, 60, _sub, f_date, _DIM)

    # column headers
    for key, hdr, x, al in _COLS:
        txt(x, TOP - 30, hdr, f_hdr, _DIM, al)
    d.rectangle([s(36), s(TOP - 10), s(_W - 36), s(TOP - 10) + 1], fill=_DIV)

    y = TOP + 4
    if not rows:
        txt(40, y, "No qualifying OI builds on flow contracts.", f_row, _DIM)
        y += ROWH
    for i, e in enumerate(rows):
        if i % 2 == 1:
            d.rectangle([0, s(y - 6), s(_W), s(y - 6) + s(ROWH)], fill=_ROWALT)
        cpcol = _BULL if e["cp"] == "C" else _BEAR
        k = e["K"]
        kstr = f"${int(k)}" if float(k).is_integer() else f"${k}"
        for key, hdr, x, al in _COLS:
            if key == "ticker":
                txt(x, y, e["sym"], f_rowb, _GOLD)
            elif key == "cp":
                txt(x, y, "CALL" if e["cp"] == "C" else "PUT", f_rowb, cpcol)
            elif key == "strike":
                txt(x, y, kstr, f_row, _TXT, "r")
            elif key == "exp":
                txt(x, y, _exp_short(e["E"]), f_row, _DIM)
            elif key == "dte":
                txt(x, y, f'{e["dte"]}d' if e.get("dte") is not None else "—", f_row, _DIM, "r")
            elif key == "prem":
                txt(x, y, _fmt_prem_k(e["prem"]), f_rowb, _TXT, "r")
            elif key == "flow":
                txt(x, y, e["flow"], f_row, _DIM)
            elif key == "vol":
                txt(x, y, f'{e["vol"]:,}', f_row, _DIM, "r")
            elif key == "first":
                txt(x, y, _fmt_oi(e["firstOI"]), f_row, _DIM, "r")
            elif key == "last":
                txt(x, y, _fmt_oi(e["lastOI"]), f_row, _TXT, "r")
            elif key == "delta":
                txt(x, y, _fmt_delta(e["delta"]), f_rowb, _UP, "r")
            elif key == "state":
                st = e.get("state") or ""
                if st:
                    txt(x, y, st, f_tag, _NEW if st == "NEW" else _BLD)
        y += ROWH

    d.rectangle([s(36), s(H - 40), s(_W - 36), s(H - 40) + 1], fill=_DIV)
    txt(36, H - 32, f"UCT Intelligence  ·  {len(rows)} contracts  ·  heavy-volume flow that carried into open interest the next day",
        f_foot, _DIM)
    txt(_W - 36, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_W, H), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


# ── orchestration ──────────────────────────────────────────────────────────
def _webhook() -> str:
    return (os.getenv("OI_MORNING_WEBHOOK_URL")
            or os.getenv("ALPHA_GOLD_EOD_WEBHOOK_URL")
            or os.getenv("DISCORD_MASSIVE_WEBHOOK_URL")
            or os.getenv("DISCORD_LIVE_FLOW_WEBHOOK_URL")
            or os.getenv("DISCORD_WEBHOOK_URL", "")).strip()


def run_oi_morning(*, force: bool = False, post: bool = True,
                   days: int | None = None, top_n: int | None = None) -> dict:
    """Build + optionally post the morning OI card. `force` bypasses the
    OI_MORNING_ENABLED gate (manual trigger). post=False returns PNG under 'png'.
    Never raises."""
    try:
        if os.getenv("OI_MORNING_ENABLED", "0") != "1" and not force:
            return {"ok": False, "reason": "disabled (OI_MORNING_ENABLED != 1)"}
        days = days if days is not None else int(os.getenv("OI_MORNING_DAYS", "1"))
        top_n = top_n if top_n is not None else int(os.getenv("OI_MORNING_TOP_N", "20"))
        min_delta = int(os.getenv("OI_MORNING_MIN_DELTA", "500"))
        min_prem = float(os.getenv("OI_MORNING_MIN_PREMIUM", "0"))
        sources = tuple(s.strip() for s in
                        os.getenv("OI_MORNING_SOURCES", "stocks").split(",") if s.strip()) or ("stocks",)
        rows, window = build_rows(days=days, top_n=top_n, min_delta=min_delta,
                                  min_premium=min_prem, sources=sources)
        png = render_card(rows, window)
        res = {"ok": True, "rows": len(rows)}
        if not post:
            res["png"] = png
            return res
        if not rows:
            res.update(posted=False, reason="no qualifying OI builds")
            return res
        wh = _webhook()
        if not wh:
            res.update(posted=False, reason="no webhook (set OI_MORNING_WEBHOOK_URL)")
            return res
        ok, detail = _post_discord_image(wh, png, "", filename="oi_morning.png")
        res.update(posted=ok, detail=detail)
        log.info("[oi-morning] rows=%d posted=%s (%s)", len(rows), ok, detail)
        return res
    except Exception as e:  # noqa: BLE001
        log.exception("[oi-morning] run failed")
        return {"ok": False, "reason": f"error: {e}"}
