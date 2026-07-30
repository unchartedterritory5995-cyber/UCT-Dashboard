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

from api.services.calendar_png_common import (
    ASSETS as _ASSETS,
    BG_TOP as _BG_TOP, BG_BOT as _BG_BOT, GOLD as _GOLD, INK as _INK, DIM as _DIM,
    PANEL as _PANEL, LINE as _LINE, BMO as _BMO, AMC as _AMC, TBD as _TBD,
    font as _font, compass as _compass, round_mask as _round_mask,
    logo_tile as _logo_tile, fmt_cap as _fmt_cap, truncate as _truncate,
    gradient_bg as _gradient_bg_wh,
)

_W, _H = 1200, 630


def _gradient_bg() -> Image.Image:
    return _gradient_bg_wh(_W, _H)


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
