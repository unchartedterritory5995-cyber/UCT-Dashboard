"""Most Anticipated Earnings — a shareable weekly PNG.

Server-side Pillow render of the week's biggest earnings reporters, ranked by
market cap, on a branded UCT card (1200×630 OG size). Zero LLM, zero external
calls at render time: logos come from the on-disk logo cache (monogram fallback
for misses), everything else is passed in by the caller.

The card is a top-of-funnel virality asset — a trader screenshots "the week
ahead" and it carries the UCT mark. Deterministic: same inputs → same bytes.
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

_ASSETS = os.path.join(os.path.dirname(__file__), "desk_assets")

_W, _H = 1200, 630

# Brand palette (mirrors the calendar dark theme + gold accent)
_BG_TOP = (20, 22, 30)
_BG_BOT = (9, 10, 14)
_GOLD = (201, 168, 76)
_INK = (233, 235, 240)
_DIM = (150, 156, 168)
_PANEL = (28, 31, 40)
_LINE = (52, 56, 68)
_BMO = (201, 168, 76)     # gold — before open
_AMC = (110, 150, 220)    # blue — after close
_TBD = (140, 146, 158)    # grey — session TBD


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(_ASSETS, name), int(size))


def _gradient_bg() -> Image.Image:
    img = Image.new("RGB", (_W, _H))
    dr = ImageDraw.Draw(img)
    for y in range(_H):
        t = y / _H
        c = tuple(int(_BG_TOP[i] + (_BG_BOT[i] - _BG_TOP[i]) * t) for i in range(3))
        dr.line([(0, y), (_W, y)], fill=c)
    return img


def _compass(size: int):
    try:
        mark = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        return mark.resize((int(size), int(size)), Image.LANCZOS)
    except Exception:
        return None


def _round_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def _logo_tile(sym: str, size: int, logo_path: str | None) -> Image.Image:
    """A rounded logo tile, or a gold-ringed monogram when the logo is a miss."""
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if logo_path and os.path.exists(logo_path):
        try:
            logo = Image.open(logo_path).convert("RGBA")
            # Fit-contain onto a white rounded plate so transparent logos read
            plate = Image.new("RGBA", (size, size), (245, 246, 248, 255))
            pad = int(size * 0.14)
            inner = size - pad * 2
            logo.thumbnail((inner, inner), Image.LANCZOS)
            ox = (size - logo.width) // 2
            oy = (size - logo.height) // 2
            plate.paste(logo, (ox, oy), logo)
            plate.putalpha(_round_mask(size, int(size * 0.22)))
            return plate
        except Exception:
            pass
    # Monogram fallback
    dr = ImageDraw.Draw(tile)
    dr.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22),
                         fill=(38, 41, 52, 255), outline=_GOLD + (255,), width=2)
    letter = (sym or "?")[:1].upper()
    f = _font("DejaVuSans-Bold.ttf", int(size * 0.5))
    w = dr.textlength(letter, font=f)
    # textbbox for vertical centering
    bb = dr.textbbox((0, 0), letter, font=f)
    dr.text(((size - w) / 2, (size - (bb[3] - bb[1])) / 2 - bb[1]), letter,
            font=f, fill=_GOLD + (255,))
    return tile


def _fmt_cap(mc_b) -> str | None:
    if mc_b is None or mc_b <= 0:
        return None
    if mc_b >= 1000:
        return f"${mc_b / 1000:.1f}T"
    if mc_b >= 1:
        return f"${round(mc_b)}B"
    return f"${round(mc_b * 1000)}M"


def _truncate(draw, text, font, max_w) -> str:
    if draw.textlength(text, font=font) <= max_w:
        return text
    t = text
    while t and draw.textlength(t + "…", font=font) > max_w:
        t = t[:-1]
    return (t + "…") if t else ""


def render_anticipated_png(week_label: str, entries: list[dict]) -> bytes:
    """entries: ranked list of dicts with sym, name, timing ('bmo'|'amc'|'tbd'),
    weekday (e.g. 'TUE'), mc_b (float|None), logo_path (str|None). Renders the
    top 8. Returns PNG bytes."""
    import io

    img = _gradient_bg()
    dr = ImageDraw.Draw(img, "RGBA")

    # Gold hairline frame
    dr.rectangle([12, 12, _W - 13, _H - 13], outline=_GOLD + (90,), width=1)

    # ── Header ────────────────────────────────────────────────────────────────
    mark = _compass(40)
    if mark is not None:
        img.paste(mark, (44, 40), mark)
    dr.text((94, 46), "UCT INTELLIGENCE", font=_font("DejaVuSans-Bold.ttf", 19),
            fill=_INK)

    title_f = _font("DejaVuSans-Bold.ttf", 40)
    dr.text((44, 92), "MOST ANTICIPATED EARNINGS", font=title_f, fill=_GOLD)
    dr.text((46, 144), week_label, font=_font("DejaVuSans.ttf", 22), fill=_DIM)

    # ── Grid: 2 columns × 4 rows ────────────────────────────────────────────────
    top = 196
    row_h = 92
    col_w = (_W - 88 - 28) // 2      # 44px side margins, 28px gutter
    cols_x = [44, 44 + col_w + 28]
    logo_sz = 58

    if not entries:
        msg = "No major reporters scheduled this week."
        mf = _font("DejaVuSans.ttf", 24)
        mw = dr.textlength(msg, font=mf)
        dr.text(((_W - mw) / 2, _H / 2 - 20), msg, font=mf, fill=_DIM)

    for i, e in enumerate(entries[:8]):
        col = i % 2
        row = i // 2
        x = cols_x[col]
        y = top + row * row_h

        # Row panel
        dr.rounded_rectangle([x, y, x + col_w, y + row_h - 14], radius=12,
                             fill=_PANEL + (255,), outline=_LINE + (255,), width=1)

        # Rank number
        rank_f = _font("DejaVuSans-Bold.ttf", 20)
        dr.text((x + 16, y + (row_h - 14) / 2 - 13), str(i + 1), font=rank_f, fill=_GOLD)

        # Logo
        lx = x + 46
        ly = y + (row_h - 14 - logo_sz) // 2
        tile = _logo_tile(e.get("sym", ""), logo_sz, e.get("logo_path"))
        img.paste(tile, (lx, ly), tile)

        # Text block
        tx = lx + logo_sz + 14
        sym = (e.get("sym") or "").upper()
        dr.text((tx, y + 14), sym, font=_font("DejaVuSans-Bold.ttf", 24), fill=_INK)
        name = e.get("name") or ""
        if name:
            nf = _font("DejaVuSans.ttf", 14)
            name = _truncate(dr, name, nf, col_w - (tx - x) - 92)
            dr.text((tx, y + 46), name, font=nf, fill=_DIM)

        # Right-aligned meta: weekday · session · cap
        timing = (e.get("timing") or "tbd").lower()
        sess_c = _BMO if timing == "bmo" else _AMC if timing == "amc" else _TBD
        sess_l = "BMO" if timing == "bmo" else "AMC" if timing == "amc" else "TBD"
        cap = _fmt_cap(e.get("mc_b"))
        meta_right = x + col_w - 16

        # cap (top-right, bold)
        if cap:
            cf = _font("DejaVuSans-Bold.ttf", 20)
            cw = dr.textlength(cap, font=cf)
            dr.text((meta_right - cw, y + 16), cap, font=cf, fill=_INK)

        # weekday · session pill (bottom-right)
        wd = (e.get("weekday") or "").upper()
        sf = _font("DejaVuSans-Bold.ttf", 13)
        sess_w = dr.textlength(sess_l, font=sf)
        pill_w = sess_w + 16
        pill_x = meta_right - pill_w
        dr.rounded_rectangle([pill_x, y + 48, meta_right, y + 70], radius=8,
                             fill=sess_c + (38,), outline=sess_c + (180,), width=1)
        dr.text((pill_x + 8, y + 51), sess_l, font=sf, fill=sess_c)
        if wd:
            wf = _font("DejaVuSans.ttf", 13)
            ww = dr.textlength(wd, font=wf)
            dr.text((pill_x - ww - 8, y + 51), wd, font=wf, fill=_DIM)

    # ── Footer ──────────────────────────────────────────────────────────────────
    ff = _font("DejaVuSans.ttf", 15)
    dr.text((44, _H - 40), "uctintelligence.com", font=_font("DejaVuSans-Bold.ttf", 15),
            fill=_GOLD)
    tag = "Navigate the market, effectively."
    tw = dr.textlength(tag, font=ff)
    dr.text((_W - 44 - tw, _H - 40), tag, font=ff, fill=_DIM)

    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()
