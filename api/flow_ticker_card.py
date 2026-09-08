"""Single-ticker flow card — the image the Discord /flow command posts.

Renders one ticker's options-flow read (net bull/bear + top contracts) as a branded
PNG in the Top Flow design system, reusing watchlist_card's palette / fonts / compass
logo / formatters so it matches the EOD Top Flow card exactly.

Input is the dict returned by live_massive_router.ticker_flow (GET /api/live/massive/
ticker-flow): {symbol, spot, net:{bull,bear,dir}, window:{start,end,active_days,
days_requested}, contracts:[{strike,cp,exp,dte,premium,volume,oi,voi,direction,grade,
moneynessPct}], contract_count}. Pure render; no flow.db, no external state.
"""
import io

from api.watchlist_card import (
    _mk, _logo, _fmt_prem, _fmt_voi, _strike, _num, _ASSETS,
    _BG, _BAND, _ROWALT, _GOLD, _GOLD_DIM, _TXT, _DIM, _DIV, _BULL, _BEAR, _SS,
)

_W = 1180
_ROWH = 40
_TOP = 156          # header band + net bar + column headers
_MIXED = (201, 168, 76)   # gold for two-sided / unclear leans

# (header, x, align) — one row per CONTRACT (no ticker column; it's one ticker)
_COLS = [
    ("STRIKE", 120, "r"), ("C/P", 138, "l"), ("EXP · DTE", 200, "l"),
    ("ITM/OTM", 360, "l"), ("PREMIUM", 560, "r"), ("VOL", 735, "r"),
    ("LATEST OI", 835, "r"), ("OI TREND", 858, "l"), ("PERF", 1012, "r"), ("DIR", 1032, "l"),
]


def _dir_color(d: str):
    d = (d or "").lower()
    if d == "bull":
        return _BULL
    if d == "bear":
        return _BEAR
    return _MIXED   # mixed / unclear


def _md_compact(s) -> str:
    """'8/27/2026' → '8/27' for the WHEN column."""
    s = str(s or "").strip()
    if not s:
        return "—"
    p = s.split("/")
    return f"{p[0]}/{p[1]}" if len(p) >= 2 else s


def _fmt_money(pct):
    """(text, color) for the ITM/OTM column. `pct` is signed moneyness from
    _moneyness(): positive = ITM, negative = OTM, |pct|<1 = ATM."""
    try:
        p = float(pct)
    except (TypeError, ValueError):
        return ("—", _DIM)
    if abs(p) < 1.0:
        return ("ATM", _DIM)
    return (f"{abs(p):.0f}% {'ITM' if p > 0 else 'OTM'}", _DIM)


def _fmt_doi(v):
    """(text, color) for the OI Δ column — open interest the flow built (or shed)
    since it hit: latest OI − OI at flow-start. + = OI grew (opened/held, green),
    − = OI fell (closing, red)."""
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return ("—", _DIM)
    if n == 0:
        return ("0", _DIM)
    return (f"{'+' if n > 0 else '−'}{abs(n):,}", _BULL if n > 0 else _BEAR)


def _fmt_perf(p):
    """(text, color) for the PERF column — the option's entry→now return."""
    try:
        p = float(p)
    except (TypeError, ValueError):
        return ("—", _DIM)
    col = _BULL if p > 0 else (_BEAR if p < 0 else _DIM)
    return (f"{'+' if p >= 0 else '−'}{abs(p):.0f}%", col)


def _window_label(w: dict) -> str:
    w = w or {}
    req = str(w.get("days_requested") or "").lower()
    start, end = w.get("start"), w.get("end")
    active = w.get("active_days")
    span = f"{start} – {end}" if start and end and start != end else (start or end or "")
    head = "all history" if req == "all" else (f"last {req} trading days" if req else "")
    bits = [b for b in (head, span) if b]
    tail = f"{active} active day{'s' if active != 1 else ''}" if active else ""
    if tail:
        bits.append(tail)
    return "  ·  ".join(bits)


def render_ticker_flow_card(data: dict) -> bytes:
    from PIL import Image, ImageDraw, ImageFont
    import os

    def font(n, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, n), int(pt * _SS))

    def s(v):
        return int(v * _SS)

    sym = (data.get("symbol") or "").upper()
    net = data.get("net") or {}
    contracts = data.get("contracts") or []
    spot = data.get("spot")
    n = max(1, len(contracts))
    H = _TOP + n * _ROWH + 54
    img = Image.new("RGB", (s(_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    txt, chip, tw = _mk(ImageDraw, d)
    f_title = font("DejaVuSans-Bold.ttf", 30); f_sub = font("DejaVuSans.ttf", 17)
    f_hdr = font("DejaVuSans-Bold.ttf", 12); f_row = font("DejaVuSans.ttf", 15)
    f_rowb = font("DejaVuSans-Bold.ttf", 15); f_foot = font("DejaVuSans.ttf", 12)

    # ── header band ──────────────────────────────────────────────────────────
    d.rectangle([0, 0, s(_W), s(64)], fill=_BAND)
    _logo(Image, img, 32, 18, 48)
    tx = 94
    tx += txt(tx, 22, "UCT Intelligence", f_title, _GOLD) + 12
    txt(tx, 22, f"· {sym} Flow", f_title, _GOLD_DIM)
    sub = _window_label(data.get("window"))
    if spot:
        sub = f"${float(spot):,.2f}  ·  {sub}" if sub else f"${float(spot):,.2f}"
    txt(94, 58, sub, f_sub, _DIM)

    # ── net-flow bar ─────────────────────────────────────────────────────────
    # Three segments: Bull (green) · Unclassified (gold) · Bear (red). Unclassified
    # = real premium with no clean aggressor side (negotiated blocks, blank-side
    # prints). It is NEVER folded into bull/bear — a call block is not a bull bet —
    # so a card that is all blocks reads "no clean side · $X unclassified" instead
    # of a misleading "$0 · NEUTRAL" (owner call 2026-09-07).
    bull = float(net.get("bull") or 0); bear = float(net.get("bear") or 0)
    uncl = float(net.get("unclassified") or 0)
    tot = (bull + bear + uncl) or 1.0
    x0, x1 = 36, _W - 36
    bh = 20; by = 100; ly = by - 18
    txt(x0, ly, f"▲ {_fmt_prem(bull)} Bull", f_hdr, _BULL)
    net_d = bull - bear
    _ndir = (net.get("dir") or "").upper()
    if bull == 0 and bear == 0 and uncl > 0:
        ctext = f"NO CLEAN SIDE · {_fmt_prem(uncl)} unclassified"
        ccol = _MIXED
    else:
        _base = f"NET {'+' if net_d >= 0 else '−'}{_fmt_prem(abs(net_d))} · {_ndir}"
        ctext = f"{_base}  ·  {_fmt_prem(uncl)} uncl" if uncl > 0 else _base
        ccol = _BULL if _ndir == "BULL" else (_BEAR if _ndir == "BEAR" else _MIXED)
    txt((x0 + x1) / 2 - tw(ctext, f_hdr) / 2, ly, ctext, f_hdr, ccol)
    txt(x1, ly, f"{_fmt_prem(bear)} Bear ▼", f_hdr, _BEAR, "r")
    span = x1 - x0
    xa = x0 + int(span * (bull / tot))          # end of bull segment
    xb = xa + int(span * (uncl / tot))          # end of unclassified segment
    if xa > x0:
        d.rounded_rectangle([s(x0), s(by), s(max(xa - 1, x0)), s(by + bh)], radius=s(4), fill=_BULL)
    if xb > xa:
        d.rectangle([s(xa + (1 if xa > x0 else 0)), s(by), s(min(xb, x1)), s(by + bh)], fill=_MIXED)
    if xb < x1:
        d.rounded_rectangle([s(min(xb + 1, x1)), s(by), s(x1), s(by + bh)], radius=s(4), fill=_BEAR)

    # ── column headers ───────────────────────────────────────────────────────
    for hdr, x, al in _COLS:
        txt(x, _TOP - 28, hdr, f_hdr, _DIM, al)
    d.rectangle([s(36), s(_TOP - 10), s(_W - 36), s(_TOP - 10) + 1], fill=_DIV)

    # ── rows: top contracts by premium ───────────────────────────────────────
    y = _TOP + 4
    if not contracts:
        txt(_W / 2 - 120, y + 8, "No significant flow in this window.", f_row, _DIM)
    for i, c in enumerate(contracts):
        if i % 2 == 1:
            d.rectangle([0, s(y - 6), s(_W), s(y - 6) + s(_ROWH)], fill=_ROWALT)
        cp = (c.get("cp") or "").upper()
        txt(120, y, _strike(c.get("strike")), f_rowb, _TXT, "r")
        txt(138, y, cp or "—", f_rowb, _BULL if cp == "C" else _BEAR)
        _exp = c.get("exp") or ""
        if c.get("dte") is not None:
            _exp = f"{_exp} · {_num(c, 'dte')}d"
        txt(200, y, _exp, f_row, _DIM)
        _mtext, _mcol = _fmt_money(c.get("moneynessPct"))
        txt(360, y, _mtext, f_row, _mcol)
        txt(560, y, _fmt_prem(c.get("premium")), f_rowb, _GOLD, "r")
        # FLOW VOL carries the flow's date inline ("5,282 · 8/4") so the volume is
        # unmistakably tied to when it traded (not a today's-tape number). The date
        # is the first flow day; dim, right after the count.
        v = _num(c, "volume")
        _vstr = f"{v:,}" if v is not None else "—"
        _wday = _md_compact(c.get("first_seen"))
        if _wday and _wday != "—":
            _dsuf = f"  ({_wday})"
            txt(735, y, _dsuf, f_row, _DIM, "r")                 # dim date in parens, right edge
            txt(735 - tw(_dsuf, f_row), y, _vstr, f_row, _TXT, "r")  # count left of it
        else:
            txt(735, y, _vstr, f_row, _TXT, "r")
        o = _num(c, "oi"); txt(835, y, f"{o:,}" if o is not None else "—", f_row, _DIM, "r")
        # OI TREND sparkline: daily OI over the window. Green rising / red falling
        # (position grew vs shed — NOT bull/bear); endpoint dot marks the latest.
        _series = [float(x) for x in (c.get("oiSeries") or []) if x is not None]
        if len(_series) >= 2:
            sx0, sx1, sy0, sh = 858, 948, y + 2, 14
            lo, hi = min(_series), max(_series); rng = (hi - lo) or 1.0
            npts = len(_series)
            _scol = _BULL if _series[-1] > _series[0] else (_BEAR if _series[-1] < _series[0] else _DIM)
            _pts = [(s(sx0 + (sx1 - sx0) * (i / (npts - 1))),
                     s(sy0 + sh - (val - lo) / rng * sh)) for i, val in enumerate(_series)]
            d.line(_pts, fill=_scol, width=s(1.5))
            _ex, _ey = _pts[-1]; _rr = s(2.2)
            d.ellipse([_ex - _rr, _ey - _rr, _ex + _rr, _ey + _rr], fill=_scol)
        else:
            txt(900, y, "—", f_row, _DIM)
        _pt, _pc = _fmt_perf(c.get("perf"))
        txt(1012, y, _pt, f_rowb, _pc, "r")
        dr = (c.get("direction") or "").upper()
        txt(1032, y, dr or "—", f_rowb, _dir_color(c.get("direction")))
        y += _ROWH

    # ── footer ───────────────────────────────────────────────────────────────
    d.rectangle([s(36), s(H - 40), s(_W - 36), s(H - 40) + 1], fill=_DIV)
    cc = data.get("contract_count")
    foot_l = f"UCT Intelligence · {cc} contracts" if cc else "UCT Intelligence"
    txt(36, H - 32, foot_l, f_foot, _DIM)
    txt(_W - 36, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_W, H), Image.LANCZOS)
    buf = io.BytesIO(); out.save(buf, format="PNG")
    return buf.getvalue()
