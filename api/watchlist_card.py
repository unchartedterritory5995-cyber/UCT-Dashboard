"""Watchlist card renderer — desktop + mobile PNGs in the Top Flow design system.

Renders the OptionsFlow Discord watchlist (curated Bull/Bear picks) as branded PNGs,
reusing the exact palette / fonts / compass logo as alpha_gold_eod.py for brand
consistency. Runs on WEB — the data is POSTed from the OptionsFlow frontend, so this
needs no flow.db (unlike the alpha-gold EOD card, which runs on the flow-worker).

Each render is ONE image with a BULL section then a BEAR section. `mobile=True` yields
the narrow, one-line-per-contract layout; `mobile=False` the wide desktop table.

Item dict keys (all optional except sym): sym, exp, strike, cp ("C"/"P"), prem (float),
vol, oi, voi (float), grade ("A+"/"A"/…), er (bool), heavy (bool). Rows are sorted by
premium descending. Reuses no external state; safe to call from a request handler.
"""
import io
import os

_ASSETS = os.path.join(os.path.dirname(__file__), "services", "desk_assets")

# ── palette (verbatim from alpha_gold_eod.py) ──────────────────────────────
_BG = (12, 14, 17); _BAND = (18, 21, 25); _ROWALT = (16, 19, 23)
_GOLD = (201, 168, 76); _GOLD_DIM = (150, 128, 66)
_TXT = (223, 227, 231); _DIM = (132, 139, 148); _DIV = (36, 40, 46)
_BULL = (74, 200, 120); _BEAR = (232, 96, 96)
_ER_BG = (42, 28, 10); _ER_FG = (255, 140, 40); _HV_BG = (16, 34, 22)
_SS = 2  # supersample then downscale for crisp text


# ── formatting ─────────────────────────────────────────────────────────────
def _fmt_prem(v) -> str:
    v = float(v or 0)
    if v >= 1e9:
        return f"${v / 1e9:.2f}B"
    if v >= 1e6:
        m = v / 1e6
        return f"${m:.2f}M" if m < 10 else f"${m:.1f}M"
    return f"${v / 1e3:.0f}K"


def _fmt_voi(r) -> str:
    if r is None:
        return "—"
    try:
        r = float(r)
    except (TypeError, ValueError):
        return "—"
    return f"{r:.0f}x" if r >= 10 else f"{r:.1f}x"


def _strike(v) -> str:
    try:
        return f"${float(v):g}"
    except (TypeError, ValueError):
        return "—"


def _flags(it) -> list:
    f = []
    if it.get("er"):
        f.append("ER")
    if it.get("heavy"):
        f.append("HEAVY")
    return f


def _num(it, key):
    try:
        return int(float(it.get(key)))
    except (TypeError, ValueError):
        return None


def _by_premium(items) -> list:
    return sorted(items or [], key=lambda it: float(it.get("prem") or 0), reverse=True)


# ── shared draw primitives ──────────────────────────────────────────────────
def _mk(ImageDraw, d):
    """Return (txt, chip, tw) helpers bound to draw `d`. All coords are LOGICAL
    (multiplied by _SS internally, mirroring alpha_gold_eod's txt())."""
    def tw(t, fnt):
        return d.textlength(str(t), font=fnt) / _SS

    def txt(x, y, t, fnt, fill, align="l"):
        t = str(t)
        w = d.textlength(t, font=fnt)
        d.text((x * _SS - w if align == "r" else int(x * _SS), int(y * _SS)),
               t, font=fnt, fill=fill)
        return w / _SS

    def chip(x, y, t, fnt, fg, bg):
        w = tw(t, fnt)
        d.rounded_rectangle([int(x * _SS), int(y * _SS),
                             int((x + w + 8) * _SS), int((y + 12.5) * _SS)],
                            radius=int(2 * _SS), fill=bg)
        d.text((int((x + 4) * _SS), int((y + 1.2) * _SS)), t, font=fnt, fill=fg)
        return w + 8

    return txt, chip, tw


def _logo(Image, img, x, y, size):
    try:
        lg = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        # white-backed asset → knock near-white to transparent
        lg.putdata([(r, g, b, 0 if (r > 242 and g > 242 and b > 242) else a)
                    for (r, g, b, a) in lg.getdata()])
        lg = lg.resize((int(size * _SS), int(size * _SS)), Image.LANCZOS)
        img.paste(lg, (int(x * _SS), int(y * _SS)), lg)
    except Exception:
        pass


# ── DESKTOP ─────────────────────────────────────────────────────────────────
_D_W, _D_ROWH, _D_TOP, _D_SECH = 1150, 40, 112, 40
_D_COLS = [("TICKER", 36, "l"), ("EXP", 350, "l"), ("STRIKE", 500, "r"),
           ("C/P", 512, "l"), ("PREMIUM", 645, "r"), ("VOL", 830, "r"),
           ("OI", 920, "r"), ("V/OI", 1000, "r"), ("GRADE", 1068, "l")]


def _render_desktop(Image, ImageDraw, ImageFont, bull, bear, date_text) -> bytes:
    def font(n, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, n), int(pt * _SS))

    def s(v):
        return int(v * _SS)

    sections = [("BULL WATCHLIST", bull, _BULL), ("BEAR WATCHLIST", bear, _BEAR)]
    body_h = sum(_D_SECH + max(1, len(rows)) * _D_ROWH for _, rows, _ in sections)
    H = _D_TOP + body_h + 54
    img = Image.new("RGB", (s(_D_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    txt, chip, tw = _mk(ImageDraw, d)
    f_title = font("DejaVuSans-Bold.ttf", 30); f_date = font("DejaVuSans.ttf", 19)
    f_hdr = font("DejaVuSans-Bold.ttf", 12); f_sec = font("DejaVuSans-Bold.ttf", 15)
    f_row = font("DejaVuSans.ttf", 15); f_rowb = font("DejaVuSans-Bold.ttf", 15)
    f_chip = font("DejaVuSans-Bold.ttf", 9); f_foot = font("DejaVuSans.ttf", 12)

    d.rectangle([0, 0, s(_D_W), s(_D_TOP - 26)], fill=_BAND)
    _logo(Image, img, 32, 18, 48)
    tx = 94
    tx += txt(tx, 24, "UCT Intelligence", f_title, _GOLD) + 12
    tx += txt(tx, 24, "· Watchlist", f_title, _GOLD_DIM) + 12
    txt(tx, 32, "— " + date_text, f_date, _DIM)
    for hdr, x, al in _D_COLS:
        txt(x, _D_TOP - 30, hdr, f_hdr, _DIM, al)
    d.rectangle([s(36), s(_D_TOP - 10), s(_D_W - 36), s(_D_TOP - 10) + 1], fill=_DIV)

    y = _D_TOP + 4
    for label, rows, accent in sections:
        d.rectangle([0, s(y - 4), s(_D_W), s(y - 4) + s(_D_SECH - 8)], fill=_BAND)
        arrow = "▲" if accent is _BULL else "▼"
        lx = txt(40, y, f"{arrow} {label}", f_sec, accent)
        tot = sum(float(r.get("prem") or 0) for r in rows) / 1e6
        txt(40 + lx + 12, y + 2, f"·  {len(rows)} tickers  ·  ${tot:.1f}M", f_hdr, _DIM)
        y += _D_SECH
        for i, it in enumerate(rows):
            if i % 2 == 1:
                d.rectangle([0, s(y - 6), s(_D_W), s(y - 6) + s(_D_ROWH)], fill=_ROWALT)
            cp = (it.get("cp") or "").upper()
            cx = 36 + txt(36, y, it.get("sym") or "", f_rowb, _GOLD) + 8
            for fl in _flags(it):
                cx += chip(cx, y + 1.5, fl, f_chip, _ER_FG if fl == "ER" else _BULL,
                           _ER_BG if fl == "ER" else _HV_BG) + 4
            txt(350, y, it.get("exp") or "", f_row, _DIM)
            txt(500, y, _strike(it.get("strike")), f_row, _TXT, "r")
            txt(512, y, cp or "—", f_rowb, _BULL if cp == "C" else _BEAR)
            txt(645, y, _fmt_prem(it.get("prem")), f_rowb, _GOLD, "r")
            v = _num(it, "vol"); txt(830, y, f"{v:,}" if v is not None else "—", f_row, _TXT, "r")
            o = _num(it, "oi"); txt(920, y, f"{o:,}" if o is not None else "—", f_row, _DIM, "r")
            voi = it.get("voi")
            txt(1000, y, _fmt_voi(voi), f_row,
                _BULL if (voi is not None and float(voi) >= 3) else _DIM, "r")
            txt(1068, y, it.get("grade") or "", f_rowb, _GOLD)
            y += _D_ROWH
        y += 6

    d.rectangle([s(36), s(H - 40), s(_D_W - 36), s(H - 40) + 1], fill=_DIV)
    txt(36, H - 32, "UCT Intelligence", f_foot, _DIM)
    txt(_D_W - 36, H - 32, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_D_W, H), Image.LANCZOS)
    buf = io.BytesIO(); out.save(buf, format="PNG")
    return buf.getvalue()


# ── MOBILE ──────────────────────────────────────────────────────────────────
_M_W, _M_ROWH, _M_TOP, _M_SECH, _M_L, _M_R = 560, 34, 90, 30, 20, 540


def _render_mobile(Image, ImageDraw, ImageFont, bull, bear, date_text) -> bytes:
    def font(n, pt):
        return ImageFont.truetype(os.path.join(_ASSETS, n), int(pt * _SS))

    def s(v):
        return int(v * _SS)

    sections = [("BULL WATCHLIST", bull, _BULL), ("BEAR WATCHLIST", bear, _BEAR)]
    body_h = sum(_M_SECH + max(1, len(rows)) * _M_ROWH for _, rows, _ in sections)
    H = _M_TOP + body_h + 44
    img = Image.new("RGB", (s(_M_W), s(H)), _BG)
    d = ImageDraw.Draw(img)
    txt, chip, tw = _mk(ImageDraw, d)
    f_title = font("DejaVuSans-Bold.ttf", 22); f_sub = font("DejaVuSans.ttf", 14)
    f_sec = font("DejaVuSans-Bold.ttf", 14); f_sym = font("DejaVuSans-Bold.ttf", 17)
    f_prem = font("DejaVuSans-Bold.ttf", 16); f_det = font("DejaVuSans.ttf", 13)
    f_detb = font("DejaVuSans-Bold.ttf", 13); f_chip = font("DejaVuSans-Bold.ttf", 9)
    f_foot = font("DejaVuSans.ttf", 11)

    d.rectangle([0, 0, s(_M_W), s(_M_TOP - 22)], fill=_BAND)
    _logo(Image, img, 20, 16, 40)
    hx = 70
    hx += txt(hx, 20, "UCT Intelligence", f_title, _GOLD) + 8
    txt(hx, 25, "· Watchlist", f_title, _GOLD_DIM)
    txt(70, 48, date_text, f_sub, _DIM)
    d.rectangle([s(20), s(_M_TOP - 14), s(_M_W - 20), s(_M_TOP - 14) + 1], fill=_DIV)

    y = _M_TOP + 2
    for label, rows, accent in sections:
        d.rectangle([0, s(y - 4), s(_M_W), s(y - 4) + s(_M_SECH - 8)], fill=_BAND)
        arrow = "▲" if accent is _BULL else "▼"
        txt(20, y, f"{arrow} {label}", f_sec, accent)
        y += _M_SECH
        for i, it in enumerate(rows):
            if i % 2 == 1:
                d.rectangle([0, s(y - 4), s(_M_W), s(y - 4) + s(_M_ROWH)], fill=_ROWALT)
            cp = (it.get("cp") or "").upper()
            cx = _M_L + txt(_M_L, y + 6, it.get("sym") or "", f_sym, _GOLD) + 8
            for fl in _flags(it):
                cx += chip(cx, y + 8, fl, f_chip, _ER_FG if fl == "ER" else _BULL,
                           _ER_BG if fl == "ER" else _HV_BG) + 4
            cx += 6
            cx += txt(cx, y + 8, it.get("exp") or "", f_det, _DIM) + 6
            cx += txt(cx, y + 8, _strike(it.get("strike")), f_det, _TXT) + 5
            txt(cx, y + 8, cp, f_detb, _BULL if cp == "C" else _BEAR)
            pw = tw(_fmt_prem(it.get("prem")), f_prem)
            txt(_M_R, y + 6, _fmt_prem(it.get("prem")), f_prem, _GOLD, "r")
            txt(_M_R - pw - 14, y + 8, it.get("grade") or "", f_detb, _GOLD, "r")
            y += _M_ROWH
        y += 7

    d.rectangle([s(20), s(H - 34), s(_M_W - 20), s(H - 34) + 1], fill=_DIV)
    txt(20, H - 26, "UCT Intelligence", f_foot, _DIM)
    txt(_M_W - 20, H - 26, "uctintelligence.com", f_foot, _GOLD_DIM, "r")

    out = img.resize((_M_W, H), Image.LANCZOS)
    buf = io.BytesIO(); out.save(buf, format="PNG")
    return buf.getvalue()


# ── public entry ────────────────────────────────────────────────────────────
def render_watchlist_card(bull, bear, date_text, mobile: bool = False) -> bytes:
    """Render one PNG (Bull section + Bear section). mobile=True → narrow one-line
    layout; else the wide desktop table. Rows sorted by premium descending."""
    from PIL import Image, ImageDraw, ImageFont
    bull, bear = _by_premium(bull), _by_premium(bear)
    if mobile:
        return _render_mobile(Image, ImageDraw, ImageFont, bull, bear, date_text)
    return _render_desktop(Image, ImageDraw, ImageFont, bull, bear, date_text)
