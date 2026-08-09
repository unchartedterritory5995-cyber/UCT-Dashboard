"""End-of-day / end-of-week Dark Pool summary — renders the session's notable
off-exchange (dark pool) block activity, GROUPED BY MARKET CAP, as a branded PNG
and posts it to Discord as an image attachment.

Mirrors alpha_gold_eod.py (the Top Flow card): same brand palette / fonts /
compass logo / hand-rolled multipart Discord post. Runs WEB-side (owns
darkpool.db + the aggregator + the Schwab/Yahoo market-cap source).

Dark by default: gated by DARKPOOL_EOD_ENABLED. A PUSH_SECRET endpoint triggers
it manually — ?post=0 returns the rendered PNG for preview, ?post=1 posts it.
EOD = last session (days=1). EOW = the trading week (days=5), Friday only.

Env:
  DARKPOOL_EOD_ENABLED      "1" to arm the scheduled post (default off)
  DARKPOOL_EOD_WEBHOOK_URL  Discord webhook; falls back to the admin webhook so it
                            can NEVER default to a public channel
  DARKPOOL_EOD_TOP_N        max rows per market-cap section (default 12)
  DARKPOOL_EOD_MIN_NOTIONAL floor to count as "notable" (default 5e6 = $5M)
"""
from __future__ import annotations

import io
import json
import logging
import os
import urllib.request
import urllib.error
from datetime import datetime

log = logging.getLogger("darkpool_eod")

_ASSETS = os.path.join(os.path.dirname(__file__), "services", "desk_assets")
_UA = "UCT-Massive/1.0 (+https://uctintelligence.com)"

# ── palette (identical to the Top Flow card) ───────────────────────────────
_BG = (12, 14, 17)
_BAND = (18, 21, 25)
_ROWALT = (16, 19, 23)
_GOLD = (201, 168, 76)
_GOLD_DIM = (150, 128, 66)
_TXT = (223, 227, 231)
_DIM = (132, 139, 148)
_DIV = (36, 40, 46)
# Dark pool is a LEVEL-OF-INTEREST read, not directional — no bull/bear or
# acc/dist coloring. The header bar shows the notional split across cap bands as
# a gold-intensity gradient (Mega brightest → ETF a neutral slate).
_CAP_COLORS = {
    "Mega": (201, 168, 76),
    "Large": (168, 142, 78),
    "Mid-Small": (128, 108, 60),
    "ETF/Index": (86, 96, 108),
}
_HOT = (210, 150, 70)      # % ADV highlight when the day's DP dwarfs normal volume
_PERF_UP = (74, 200, 120)  # price above the dark-pool level (green)
_PERF_DN = (232, 96, 96)   # price below the dark-pool level (red)


def _webhook() -> str:
    # Same channel as the options EOD / weekly alerts (owner decision): prefer the
    # Alpha Gold EOD webhook, then the shared Massive/LiveFlow ones. A dedicated
    # DARKPOOL_EOD_WEBHOOK_URL overrides if we ever want a separate channel.
    return (os.getenv("DARKPOOL_EOD_WEBHOOK_URL")
            or os.getenv("ALPHA_GOLD_EOD_WEBHOOK_URL")
            or os.getenv("DISCORD_MASSIVE_WEBHOOK_URL")
            or os.getenv("DISCORD_LIVE_FLOW_WEBHOOK_URL")
            or os.getenv("DISCORD_WEBHOOK_URL", "")).strip()


# ── market-cap bands (mirror flowCompute.capBand) ──────────────────────────
def _cap_band(mktcap) -> str:
    mc = float(mktcap or 0)
    if mc <= 0:
        return "ETF/Index"           # ETFs + anything with no mkt-cap
    if mc >= 500e9:
        return "Mega"
    if mc >= 10e9:
        return "Large"
    return "Mid-Small"


_BAND_ORDER = [
    ("Mega", "MEGA CAP  ·  ≥ $500B"),
    ("Large", "LARGE CAP  ·  $10B–$500B"),
    ("Mid-Small", "MID & SMALL CAP  ·  < $10B"),
    ("ETF/Index", "ETFs & INDEX"),
]

# The aggregator's own categories for fund products. An ETF's reported "market
# cap" is really its AUM, so it would mis-bucket into a stock band (SPY→Mega,
# TLT→Large) — instead route anything the aggregator tagged as a fund straight to
# the ETFs & Index section, and reserve market-cap bucketing for actual stocks.
_ETF_CATS = {"Indexes", "Sector ETFs", "Bond ETFs", "Intl/EM ETFs", "Commodity ETFs"}

# Funds the automated detection misses — chiefly single-stock leveraged ETFs
# (e.g. GOOGN) that FMP doesn't flag as ETFs and that aren't in the aggregator's
# lists. Seeded + env-extendable (DARKPOOL_EOD_ETF_EXTRA, comma-separated) so a
# new straggler can be added without a code change.
_ETF_OVERRIDE = {"GOOGN"} | {
    s.strip().upper() for s in os.getenv("DARKPOOL_EOD_ETF_EXTRA", "").split(",") if s.strip()
}
# Friendly ETF-type label for the SECTOR column (a fund has no GICS sector — FMP
# returns a bogus "Financial Services", so show what KIND of fund it is instead).
_ETF_TYPE = {"Indexes": "Index", "Sector ETFs": "Sector", "Bond ETFs": "Bond",
             "Intl/EM ETFs": "Intl/EM", "Commodity ETFs": "Commodity"}


def _etf_type(cat: str) -> str:
    return _ETF_TYPE.get((cat or "").strip(), "ETF")


# ── formatting helpers ─────────────────────────────────────────────────────
def _fmt_n(v) -> str:
    v = float(v or 0)
    if v >= 1e9:
        return f"${v / 1e9:.2f}B"
    m = v / 1e6
    if m >= 100:
        return f"${m:.0f}M"
    return f"${m:.1f}M" if m >= 10 else f"${m:.2f}M"


def _fmt_px(v) -> str:
    v = float(v or 0)
    if v <= 0:
        return "—"
    return f"{v:,.2f}" if v < 1000 else f"{v:,.0f}"


def _fmt_px_d(v) -> str:
    """Price with a $ prefix (for the Last / Zone / biggest-print price cells)."""
    v = float(v or 0)
    return ("$" + _fmt_px(v)) if v > 0 else "—"


def _fmt_adv(v) -> str:
    """Dark-pool activity as a % of the name's average daily volume."""
    v = float(v or 0)
    if v <= 0:
        return "—"
    return f"{v:.0f}%" if v >= 10 else f"{v:.1f}%"


def _fmt_perf(v) -> str:
    """Price move vs the dark-pool VWAP — 'are those levels in profit'."""
    if v is None:
        return "—"
    return f"{'+' if v >= 0 else ''}{v:.1f}%"


def _fmt_zone(lo, hi) -> str:
    """The price band the dark-pool prints landed in — the level of interest."""
    lo = float(lo or 0)
    hi = float(hi or 0)
    if lo <= 0 and hi <= 0:
        return "—"
    lo = lo or hi
    hi = hi or lo
    if abs(hi - lo) < 0.005 * max(hi, 1):
        return _fmt_px_d(hi)                     # essentially one level
    return f"{_fmt_px_d(lo)}–{_fmt_px_d(hi)}"


def _date_text(day_mdyyyy: str) -> str:
    try:
        dt = datetime.strptime(day_mdyyyy, "%m/%d/%Y")
        return f"{dt.strftime('%B')} {dt.day}, {dt.year}"
    except (ValueError, TypeError):
        return str(day_mdyyyy)


# ── render ─────────────────────────────────────────────────────────────────
# Columns: TICKER · NOTIONAL · % ADV · PRICE ZONE · LAST · BIGGEST PRINT · SECTOR
# PERF (price move vs the dark-pool VWAP — are those levels in profit) sits right
# after BIGGEST PRINT. On both cards: EOD shows the intraday move off the day's DP
# VWAP; weekly the move off the week's DP VWAP.
_COLS = [
    ("ticker", "TICKER", 36, "l"), ("notional", "NOTIONAL", 268, "r"),
    ("pctadv", "% ADV", 356, "r"), ("zone", "PRICE ZONE", 536, "r"),
    ("last", "LAST", 636, "r"), ("big", "BIGGEST PRINT", 852, "r"),
    ("perf", "PERF", 942, "r"), ("sector", "SECTOR", 982, "l"),
]
_W, _ROWH, _TOP, _SECH = 1150, 34, 170, 32
_SS = 2  # supersample then downscale for crisp text


def render_card(sections: list[tuple], date_text: str, summary: dict,
                subtitle: str = "Dark Pool", cols: list | None = None) -> bytes:
    """sections = [(band_label, [item, ...]), ...]. `cols` overrides the column
    layout (defaults to _COLS)."""
    from PIL import Image, ImageDraw, ImageFont
    cols = cols or _COLS

    def font(name, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, name), int(pt * _SS))

    def s(v):
        return int(v * _SS)

    sections = [(lbl, rows) for lbl, rows in sections if rows]
    body_h = sum(_SECH + max(1, len(rows)) * _ROWH for _, rows in sections) or _ROWH
    H = _TOP + body_h + 54

    img = Image.new("RGB", (s(_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    f_title, f_date = font("DejaVuSans-Bold.ttf", 30), font("DejaVuSans.ttf", 19)
    f_sum = font("DejaVuSans-Bold.ttf", 17)
    f_hdr = font("DejaVuSans-Bold.ttf", 12)
    f_sec = font("DejaVuSans-Bold.ttf", 14)
    f_row, f_rowb = font("DejaVuSans.ttf", 15), font("DejaVuSans-Bold.ttf", 15)
    f_n = font("DejaVuSans-Bold.ttf", 12)
    f_foot = font("DejaVuSans.ttf", 12)

    def txt(x, y, t, fnt, fill, align="l"):
        t = str(t)
        w = d.textlength(t, font=fnt)
        if align == "r":
            d.text((x * _SS - w, y * _SS), t, font=fnt, fill=fill)
        else:
            d.text((s(x), s(y)), t, font=fnt, fill=fill)
        return w / _SS

    # title band + UCT compass logo
    d.rectangle([0, 0, s(_W), s(_TOP - 26)], fill=_BAND)
    try:
        _logo = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        _logo.putdata([(r, g, b, 0 if (r > 242 and g > 242 and b > 242) else a)
                       for (r, g, b, a) in _logo.getdata()])
        _logo = _logo.resize((s(48), s(48)), Image.LANCZOS)
        img.paste(_logo, (s(32), s(18)), _logo)
    except Exception:
        pass
    tx = 94
    tx += txt(tx, 24, "UCT Intelligence", f_title, _GOLD) + 12
    tx += txt(tx, 24, f"· {subtitle}", f_title, _GOLD_DIM) + 12
    txt(tx, 32, "— " + date_text, f_date, _DIM)

    # Level-of-interest header — total dark-pool notional + how it splits across
    # market-cap bands. Deliberately NON-directional: dark pool tells us WHERE the
    # size traded, not whether it's buying or selling. Legend colors map to the bar.
    bands = summary.get("band_totals") or {}
    total_n = summary.get("total_n") or sum(bands.values()) or 0
    seg = [(b, bands.get(b, 0), _CAP_COLORS[b]) for b, _ in _BAND_ORDER]
    seg = [(name, val, col) for name, val, col in seg if val > 0]
    _tot = sum(v for _, v, _ in seg) or 1
    lx = 36
    for name, val, col in seg:
        _lbl = "ETFs" if name == "ETF/Index" else name
        lx += txt(lx, 76, f"{_lbl} {_fmt_n(val)}", f_sum, col)
        lx += txt(lx, 76, "    ", f_sum, _DIM)
    txt(_W - 36, 76, f"{_fmt_n(total_n)} total dark pool", f_sum, _GOLD, "r")
    _bx0, _bx1, _by, _bh = 36, _W - 36, 102, 14
    _rad = s(4)
    x = _bx0
    for i, (name, val, col) in enumerate(seg):
        w = (_bx1 - _bx0) * (val / _tot)
        if w < 2:
            continue
        first, last_seg = (i == 0), (i == len(seg) - 1)
        d.rounded_rectangle([s(x), s(_by), s(x + w), s(_by + _bh)], radius=_rad,
                            fill=col, corners=(first, last_seg, last_seg, first))
        x += w

    # column headers
    for key, hdr, x, al in cols:
        txt(x, _TOP - 30, hdr, f_hdr, _DIM, al)
    d.rectangle([s(36), s(_TOP - 10), s(_W - 36), s(_TOP - 10) + 1], fill=_DIV)

    y = _TOP + 4
    for label, rows in sections:
        d.rectangle([0, s(y - 4), s(_W), s(y - 4) + s(_SECH - 6)], fill=_BAND)
        txt(40, y, label, f_sec, _GOLD)
        y += _SECH
        for i, it in enumerate(rows):
            if i % 2 == 1:
                d.rectangle([0, s(y - 6), s(_W), s(y - 6) + s(_ROWH)], fill=_ROWALT)
            _adv = it.get("pctADV") or 0
            for key, hdr, x, al in cols:
                if key == "ticker":
                    txt(x, y, it.get("t") or "", f_rowb, _GOLD)
                elif key == "notional":
                    txt(x, y, _fmt_n(it.get("n")), f_rowb, _GOLD, "r")
                elif key == "pctadv":
                    txt(x, y, _fmt_adv(_adv), f_row, _HOT if _adv >= 100 else _TXT, "r")
                elif key == "zone":
                    txt(x, y, _fmt_zone(it.get("zoneLo"), it.get("zoneHi")), f_row, _TXT, "r")
                elif key == "last":
                    txt(x, y, _fmt_px_d(it.get("last")), f_row, _DIM, "r")
                elif key == "perf":
                    _p = it.get("perf")
                    _pc = _PERF_UP if (_p is not None and _p >= 0) else _PERF_DN if _p is not None else _DIM
                    txt(x, y, _fmt_perf(_p), f_rowb, _pc, "r")
                elif key == "big":
                    _bn = _fmt_n(it.get("bigN"))
                    _bp = it.get("bigPx")
                    txt(x, y, f"{_bn} @ {_fmt_px_d(_bp)}" if _bp else _bn, f_row, _DIM, "r")
                elif key == "sector":
                    sec = (it.get("sector") or "").strip()
                    if len(sec) > 18:
                        sec = sec[:17] + "…"
                    txt(x, y, sec or "—", f_row, _DIM)
            y += _ROWH
        y += 6

    # footer
    d.rectangle([s(36), s(H - 40), s(_W - 36), s(H - 40) + 1], fill=_DIV)
    txt(36, H - 32, f"UCT Intelligence  ·  {summary.get('n_tickers', 0)} tickers  ·  "
                    f"{summary.get('n_prints', 0)} prints  ·  {_fmt_n(summary.get('total_n'))} total",
        f_foot, _DIM)
    txt(_W - 36, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_W, H), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


# ── data helpers ───────────────────────────────────────────────────────────
_daily_cache: dict = {}   # sym -> (iso_day, {"avg50", "close"}) — one Massive pull/name/day


def _daily_stats(ticker: str) -> dict:
    """From the Massive daily aggs (one pull, cached per name per day): the
    50-day avg daily SHARE volume (for % ADV) AND the latest daily CLOSE (the real
    current-price reference for PERF — the item's own `last` collapses to the
    dark-pool VWAP on a single day, which would make perf a flat 0%). The local
    bars_sqlite store is empty web-side under remote-bars, hence Massive REST."""
    from datetime import date, timedelta
    sym = (ticker or "").upper()
    if not sym:
        return {"avg50": 0.0, "close": 0.0}
    try:
        today = date.today().isoformat()
    except Exception:
        today = ""
    hit = _daily_cache.get(sym)
    if hit and hit[0] == today:
        return hit[1]
    out = {"avg50": 0.0, "close": 0.0}
    try:
        from api.services.massive import get_daily_agg
        to_d = date.today()
        from_d = to_d - timedelta(days=80)       # ~55 trading days of headroom
        bars = get_daily_agg(sym, from_d.isoformat(), to_d.isoformat()) or []
        vols = [b.get("v") for b in bars[-50:] if b.get("v")]
        if vols:
            out["avg50"] = sum(vols) / len(vols)
        if bars and bars[-1].get("c"):
            out["close"] = float(bars[-1]["c"])
    except Exception:
        pass
    _daily_cache[sym] = (today, out)
    return out


_meta_cache: dict = {}   # sym -> (iso_day, {"sector", "isEtf"})


def _ticker_meta(ticker: str) -> dict:
    """FMP company profile → {sector, isEtf}. One authoritative source for BOTH
    the sector column AND ETF detection (an ETF's reported market cap is its AUM,
    so the aggregator's hardcoded ETF lists miss names like VOO / IGV / IEFA —
    the profile's isEtf flag catches them). Cached per name per day; fail-soft."""
    from datetime import date
    sym = (ticker or "").upper()
    if not sym:
        return {"sector": None, "isEtf": None}
    try:
        today = date.today().isoformat()
    except Exception:
        today = ""
    hit = _meta_cache.get(sym)
    if hit and hit[0] == today:
        return hit[1]
    meta = {"sector": None, "isEtf": None}
    try:
        from api.services import earnings_estimates as ee
        data = ee._fmp_get("/stable/profile", {"symbol": sym}, timeout=8)
        row = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
        if row:
            meta["sector"] = (row.get("sector") or None)
            meta["isEtf"] = bool(row.get("isEtf") or row.get("isFund"))
    except Exception:
        pass
    _meta_cache[sym] = (today, meta)
    return meta


def _concentration_band(ticker: str, days: int) -> tuple:
    """The price band holding the central ~68% of the ticker's dark-pool notional
    over the window (notional-weighted 16th/84th percentiles by price) — a tighter
    'level of interest' than the full low-high range."""
    try:
        from api.darkpool_db import get_ticker_prints
        prints = get_ticker_prints(ticker, days=max(1, int(days)), limit=200) or []
    except Exception:
        return (None, None)
    pn = []
    for p in prints:
        try:
            px, n = float(p.get("price") or 0), float(p.get("notional") or 0)
        except (AttributeError, TypeError, ValueError):
            continue
        if px > 0 and n > 0:
            pn.append((px, n))
    if not pn:
        return (None, None)
    pn.sort(key=lambda x: x[0])
    tot = sum(n for _, n in pn)
    if tot <= 0:
        return (pn[0][0], pn[-1][0])
    lo_t, hi_t = 0.16 * tot, 0.84 * tot
    cum, lo, hi, set_lo = 0.0, pn[0][0], pn[-1][0], False
    for px, n in pn:
        cum += n
        if not set_lo and cum >= lo_t:
            lo, set_lo = px, True
        if cum >= hi_t:
            hi = px
            break
    return (lo, hi)


# Buffer above top_n when picking which stock-band names to meta-enrich, so that
# ETFs mis-sized into a stock band (small AUM → Mid-Small) get their isEtf checked
# and moved out, leaving enough real stocks to still fill the displayed rows.
_ENRICH_BUFFER = 18


# ── data: build market-cap sections from the aggregator + Schwab mkt-caps ──
def build_sections(days: int = 1, top_n: int = 10, min_notional: float = 5e6,
                   weekly: bool = False):
    """Pull aggregated dark-pool items, resolve sector + ETF flag + market cap for
    the display candidates, bucket (ETFs → their own section by isEtf; stocks by
    true market cap), and enrich displayed rows with % ADV + a concentration price
    band. ETF rows show their fund TYPE in the sector column.

    % ADV basis matches the window: the EOD card compares the day's dark pool to
    the 50-day avg DAILY volume; the weekly card compares the WEEK's dark pool to a
    10-week (≈50 trading day) avg WEEKLY volume (avg daily × 5), so a week doesn't
    read as ~5× a normal day."""
    from api.darkpool_aggregator import get_aggregated
    payload = get_aggregated(days=days)
    items = list((payload or {}).get("allItems") or [])
    items = [it for it in items if (it.get("n") or 0) >= min_notional]
    items.sort(key=lambda it: (it.get("n") or 0), reverse=True)

    caps: dict = {}
    try:
        import asyncio
        from api.schwab_service import get_mktcap_batch
        syms = sorted({(it.get("t") or "").upper() for it in items if it.get("t")})
        if syms:
            caps = asyncio.run(get_mktcap_batch(syms)) or {}
    except Exception as e:
        log.warning("[darkpool-eod] mkt-cap fetch failed: %s", e)

    def sym_of(it):
        return (it.get("t") or "").upper()

    def _rough(it) -> str:
        cat = (it.get("cat") or "").strip()
        if cat in _ETF_CATS or sym_of(it) in _ETF_OVERRIDE:
            return "ETF/Index"
        mc = float(caps.get(sym_of(it)) or it.get("mktcap") or 0)
        if mc > 0:
            return _cap_band(mc)
        return "Large" if cat == "Large Cap" else "Mid-Small"

    # Pass 1: rough bucket (no per-ticker calls). Unknown ETFs land in stock bands.
    rough: dict = {b: [] for b, _ in _BAND_ORDER}
    for it in items:                       # already notional-desc
        rough[_rough(it)].append(it)

    # Meta-enrich (sector + isEtf) the top (top_n + buffer) of each STOCK band —
    # the display candidates, incl. the small Mid-Small names an overall top-N
    # would miss. Cat-known ETFs need no profile (already ETF).
    metas: dict = {}
    for b in ("Mega", "Large", "Mid-Small"):
        for it in rough[b][: top_n + _ENRICH_BUFFER]:
            s = sym_of(it)
            if s and s not in metas:
                metas[s] = _ticker_meta(s)

    def _bucket(it) -> str:
        s = sym_of(it)
        cat = (it.get("cat") or "").strip()
        if cat in _ETF_CATS or s in _ETF_OVERRIDE or (metas.get(s) or {}).get("isEtf"):
            return "ETF/Index"
        mc = float(caps.get(s) or it.get("mktcap") or 0)
        if mc > 0:
            return _cap_band(mc)
        return "Large" if cat == "Large Cap" else "Mid-Small"

    # Pass 2: final bucket using isEtf for the candidates.
    band_totals: dict = {b: 0.0 for b, _ in _BAND_ORDER}
    by_band: dict = {b: [] for b, _ in _BAND_ORDER}
    for it in items:
        band = _bucket(it)
        band_totals[band] += (it.get("n") or 0)
        by_band[band].append(it)

    sections = []
    for band, label in _BAND_ORDER:
        rows = []
        for it in by_band[band][:top_n]:
            s = sym_of(it)
            n = it.get("n") or 0
            vwap = it.get("vwap") or 0
            _ds = _daily_stats(s)
            avg50, close = _ds["avg50"], _ds["close"]
            # Weekly: compare the week's DP to a normal WEEK (avg daily × 5 =
            # 10-week avg weekly). Daily: compare to a normal day (avg daily).
            _denom = (avg50 * 5.0) if weekly else avg50
            pct_adv = ((n / vwap) / _denom * 100.0) if (vwap > 0 and avg50 > 0) else None
            zlo, zhi = _concentration_band(s, days)
            if zlo is None:
                zlo, zhi = it.get("lo"), it.get("hi")
            # ETF rows: show the fund TYPE (no GICS sector); stocks: GICS sector.
            if band == "ETF/Index":
                sector = _etf_type(it.get("cat"))
            else:
                sector = (metas.get(s) or {}).get("sector") or it.get("sector")
            # Performance since the dark pool traded: the latest daily CLOSE vs the
            # window's dark-pool VWAP (using close, NOT the item's `last`, which
            # equals the VWAP on a single day → a flat 0%).
            perf = ((close - vwap) / vwap * 100.0) if (vwap > 0 and close > 0) else None
            rows.append({
                "t": s, "n": n, "c": it.get("c") or 0, "last": it.get("last"),
                "zoneLo": zlo, "zoneHi": zhi, "pctADV": pct_adv, "perf": perf,
                "bigN": it.get("bigPrintN"), "bigPx": it.get("bigPrint"),
                "sector": sector,
            })
        if rows:
            sections.append((label, rows))

    summary = {
        "total_n": sum((it.get("n") or 0) for it in items),
        "band_totals": band_totals,
        "n_prints": sum((it.get("c") or 0) for it in items),
        "n_tickers": len(items),
    }
    return sections, summary


# ── Discord post (hand-rolled multipart over stdlib urllib) ────────────────
def _post_discord_image(webhook: str, png: bytes, content: str,
                        filename: str = "dark_pool.png") -> tuple[bool, str]:
    boundary = "----uctDarkPool7f3b9c1e"
    payload_json = json.dumps({
        "content": content[:1900],
        "username": "UCT Intelligence · Dark Pool",
        "allowed_mentions": {"parse": []},
    })
    parts: list[bytes] = []

    def add(name, value, fname=None, ctype=None):
        head = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
        if fname:
            head += f'; filename="{fname}"'
        head += "\r\n"
        if ctype:
            head += f"Content-Type: {ctype}\r\n"
        head += "\r\n"
        parts.append(head.encode("utf-8"))
        parts.append(value if isinstance(value, bytes) else value.encode("utf-8"))
        parts.append(b"\r\n")

    add("payload_json", payload_json)
    add("files[0]", png, fname=filename, ctype="image/png")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)

    req = urllib.request.Request(
        webhook, data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                 "User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return (200 <= resp.getcode() < 300, f"discord {resp.getcode()}")
    except urllib.error.HTTPError as e:
        return (False, f"discord HTTP {e.code}: {e.read()[:200]!r}")
    except Exception as e:  # noqa: BLE001
        return (False, f"post error: {e}")


# ── orchestration ──────────────────────────────────────────────────────────
def run_eod_summary(*, force: bool = False, post: bool = True,
                    weekly: bool = False, today: str | None = None) -> dict:
    """Build + optionally post the EOD (or EOW) Dark Pool card. `force` bypasses
    the DARKPOOL_EOD_ENABLED gate (manual trigger). post=False returns PNG bytes
    under 'png' for preview. Never raises."""
    try:
        enabled = os.getenv("DARKPOOL_EOD_ENABLED", "0") == "1"
        if not enabled and not force:
            return {"ok": False, "reason": "disabled (DARKPOOL_EOD_ENABLED != 1)"}
        days = 5 if weekly else 1
        top_n = int(os.getenv("DARKPOOL_EOD_TOP_N", "10"))
        min_n = float(os.getenv("DARKPOOL_EOD_MIN_NOTIONAL", "5e6"))
        sections, summary = build_sections(days=days, top_n=top_n, min_notional=min_n,
                                           weekly=weekly)

        try:
            from api.darkpool_db import get_available_dates
            dates = get_available_dates() or []
        except Exception:
            dates = []
        subtitle = "Dark Pool · Week" if weekly else "Dark Pool"
        if weekly and len(dates) >= 2:
            date_text = f"{_date_text(_iso_to_mdyyyy(dates[-min(days, len(dates))]))} – {_date_text(_iso_to_mdyyyy(dates[-1]))}"
        else:
            date_text = _date_text(_iso_to_mdyyyy(dates[-1])) if dates else (today or "")

        png = render_card(sections, date_text, summary, subtitle=subtitle)
        res: dict = {"ok": True, "weekly": weekly, "tickers": summary["n_tickers"]}
        if not post:
            res["png"] = png
            return res
        if not any(rows for _, rows in sections):
            res.update(posted=False, reason="no notable dark pool activity")
            return res
        wh = _webhook()
        if not wh:
            res.update(posted=False, reason="no webhook (set DARKPOOL_EOD_WEBHOOK_URL)")
            return res
        ok, detail = _post_discord_image(wh, png, "")
        res.update(posted=ok, detail=detail)
        log.info("[darkpool-eod] weekly=%s tickers=%d posted=%s (%s)",
                 weekly, summary["n_tickers"], ok, detail)
        return res
    except Exception as e:  # noqa: BLE001
        log.exception("[darkpool-eod] run failed")
        return {"ok": False, "reason": f"error: {e}"}


def _iso_to_mdyyyy(iso: str) -> str:
    try:
        dt = datetime.strptime(str(iso), "%Y-%m-%d")
        return f"{dt.month}/{dt.day}/{dt.year}"
    except (ValueError, TypeError):
        return str(iso)
