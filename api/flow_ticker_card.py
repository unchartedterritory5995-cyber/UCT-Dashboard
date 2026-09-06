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

_W = 1000
_ROWH = 40
_TOP = 156          # header band + net bar + column headers
_MIXED = (201, 168, 76)   # gold for two-sided / unclear leans

# (header, x, align) — one row per CONTRACT (no ticker column; it's one ticker)
_COLS = [
    ("STRIKE", 150, "r"), ("C/P", 168, "l"), ("EXP · DTE", 250, "l"),
    ("PREMIUM", 520, "r"), ("VOL", 660, "r"), ("OI", 770, "r"),
    ("V/OI", 858, "r"), ("DIR", 900, "l"),
]


def _dir_color(d: str):
    d = (d or "").lower()
    if d == "bull":
        return _BULL
    if d == "bear":
        return _BEAR
    return _MIXED   # mixed / unclear


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
    bull = float(net.get("bull") or 0); bear = float(net.get("bear") or 0)
    tot = (bull + bear) or 1.0
    x0, x1 = 36, _W - 36
    bh = 20; by = 100; ly = by - 18
    txt(x0, ly, f"▲ {_fmt_prem(bull)} Bull", f_hdr, _BULL)
    net_d = bull - bear
    ctext = f"NET {'+' if net_d >= 0 else '−'}{_fmt_prem(abs(net_d))}  ·  {net.get('dir', '')}"
    txt((x0 + x1) / 2 - tw(ctext, f_hdr) / 2, ly, ctext, f_hdr, _GOLD)
    txt(x1, ly, f"{_fmt_prem(bear)} Bear ▼", f_hdr, _BEAR, "r")
    bx = x0 + int((x1 - x0) * (bull / tot))
    d.rounded_rectangle([s(x0), s(by), s(max(bx - 1, x0)), s(by + bh)], radius=s(4), fill=_BULL)
    d.rounded_rectangle([s(min(bx + 1, x1)), s(by), s(x1), s(by + bh)], radius=s(4), fill=_BEAR)

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
        txt(150, y, _strike(c.get("strike")), f_rowb, _TXT, "r")
        txt(168, y, cp or "—", f_rowb, _BULL if cp == "C" else _BEAR)
        _exp = c.get("exp") or ""
        if c.get("dte") is not None:
            _exp = f"{_exp} · {_num(c, 'dte')}d"
        txt(250, y, _exp, f_row, _DIM)
        txt(520, y, _fmt_prem(c.get("premium")), f_rowb, _GOLD, "r")
        v = _num(c, "volume"); txt(660, y, f"{v:,}" if v is not None else "—", f_row, _TXT, "r")
        o = _num(c, "oi"); txt(770, y, f"{o:,}" if o is not None else "—", f_row, _DIM, "r")
        voi = c.get("voi")
        txt(858, y, _fmt_voi(voi), f_row,
            _BULL if (voi is not None and float(voi) >= 3) else _DIM, "r")
        dr = (c.get("direction") or "").upper()
        txt(900, y, dr or "—", f_rowb, _dir_color(c.get("direction")))
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
