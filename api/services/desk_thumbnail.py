"""Render a branded 1280x720 thumbnail for a Desk session video.

Pure Pillow (no network). Returns JPEG bytes ready for YouTube's thumbnails.set.
Assets (compass + fonts) are bundled in desk_assets/ and loaded by absolute path
so it renders identically on Railway.

Each session *type* gets its own colour THEME **and** its own LAYOUT so the cards
are unmistakably different in The Desk → Videos library — not the same template
recoloured:

  - "LIVE TRADING SESSION" -> classic: gold-on-black, the DATE is the hero.
  - "THOUGHTS ON THE MARKET" -> editorial: an asymmetric magazine-style card —
    left = kicker tab + serif metallic-gold headline (the TITLE is the hero) on a
    gold pull-quote spine + date; right = a glowing gold candlestick uptrend so it
    instantly reads as *markets*. Cinematic depth (radial light + vignette).

Theme/layout is picked from the eyebrow label (auto-derived from the Zoom webinar
name) so a new content type needs no code change here; pass `variant` to override.
"""
from __future__ import annotations

import io
import os
from typing import NamedTuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

_W, _H = 1280, 720
_SIZE = (_W, _H)
_ASSETS = os.path.join(os.path.dirname(__file__), "desk_assets")

_GOLD = (201, 168, 76)          # #c9a84c brand gold

_WORDMARK = "UNCHARTED TERRITORY"
_TAGLINE = "Navigate the market, effectively."


class Theme(NamedTuple):
    bg_top: tuple
    bg_bottom: tuple
    glow: tuple
    wordmark: tuple
    eyebrow: tuple
    date: tuple
    rule: tuple
    tagline: tuple
    layout: str = "classic"   # "classic" | "editorial"


_DEFAULT_THEME = Theme(
    bg_top=(13, 17, 23),
    bg_bottom=(5, 7, 11),
    glow=_GOLD,
    wordmark=(236, 240, 246),
    eyebrow=_GOLD,
    date=(236, 240, 246),
    rule=_GOLD,
    tagline=(138, 147, 163),
)

_EMERALD_GOLD = (228, 198, 112)
_EMERALD_THEME = Theme(
    bg_top=(19, 140, 101),
    bg_bottom=(5, 47, 34),
    glow=_EMERALD_GOLD,
    wordmark=(249, 245, 232),
    eyebrow=_EMERALD_GOLD,
    date=(249, 245, 232),
    rule=_EMERALD_GOLD,
    tagline=(190, 208, 188),
    layout="editorial",
)
_GOLD_HI = (252, 238, 186)
_GOLD_LO = (198, 158, 84)

_THEMES = {
    "default": _DEFAULT_THEME,
    "live": _DEFAULT_THEME,
    "thoughts": _EMERALD_THEME,
    "emerald": _EMERALD_THEME,
}


def _resolve_theme(variant: str | None, eyebrow_label: str) -> Theme:
    if variant:
        return _THEMES.get(variant.lower().strip(), _DEFAULT_THEME)
    if "thought" in (eyebrow_label or "").lower():
        return _EMERALD_THEME
    return _DEFAULT_THEME


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(_ASSETS, name), size)


def _gradient_bg(top: tuple, bottom: tuple) -> Image.Image:
    img = Image.new("RGB", _SIZE)
    dr = ImageDraw.Draw(img)
    for y in range(_H):
        t = y / _H
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        dr.line([(0, y), (_W, y)], fill=c)
    return img


def _draw_center(draw, cx, y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text((cx - w / 2, y), text, font=font, fill=fill)


def _draw_tracked(draw, x, y, text, font, fill, tracking):
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x


def _draw_tracked_center(draw, cx, y, text, font, fill, tracking):
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    _draw_tracked(draw, cx - total / 2, y, text, font, fill, tracking)


def _tracked_w(draw, text, font, tracking):
    return sum(draw.textlength(ch, font=font) for ch in text) + tracking * (len(text) - 1)


def _compass(size: int) -> Image.Image | None:
    try:
        mark = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        return mark.resize((size, size), Image.LANCZOS)
    except Exception:
        return None


def _balanced_two_lines(text: str) -> list[str]:
    words = text.split()
    if len(words) <= 1:
        return words or [""]
    best, best_diff = (words[0], " ".join(words[1:])), 10 ** 9
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        if abs(len(a) - len(b)) < best_diff:
            best, best_diff = (a, b), abs(len(a) - len(b))
    return [best[0], best[1]]


def _radial(cx, cy, r, color, max_alpha) -> Image.Image:
    layer = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r],
                                  fill=(*color, max_alpha))
    return layer.filter(ImageFilter.GaussianBlur(int(r * 0.55)))


def _vignette(strength: float) -> Image.Image:
    mask = Image.new("L", _SIZE, 0)
    ImageDraw.Draw(mask).ellipse([-_W * 0.25, -_H * 0.25, _W * 1.25, _H * 1.25], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(190))
    dark = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    dark.putalpha(mask.point(lambda p: int((255 - p) * strength)))
    return dark


# ---------------------------------------------------------------------------
# Classic (Live Trading)
# ---------------------------------------------------------------------------

def _render_classic(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    img = _gradient_bg(theme.bg_top, theme.bg_bottom).convert("RGBA")
    cx = _W // 2
    glow = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - 150, 40, cx + 150, 340], fill=(*theme.glow, 60))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(70)))
    mark = _compass(150)
    if mark is not None:
        img.alpha_composite(mark, (cx - 75, 80))
    img = img.convert("RGB")
    draw = ImageDraw.Draw(img)
    _draw_tracked_center(draw, cx, 252, _WORDMARK, _font("DejaVuSans-Bold.ttf", 38), theme.wordmark, 10)
    _draw_tracked_center(draw, cx, 350, f"— {eyebrow_label} —", _font("DejaVuSans-Bold.ttf", 30), theme.eyebrow, 5)
    _draw_center(draw, cx, 410, date_text, _font("DejaVuSans-Bold.ttf", 96), theme.date)
    draw.rectangle([cx - 90, 548, cx + 90, 552], fill=theme.rule)
    _draw_center(draw, cx, 600, _TAGLINE, _font("DejaVuSans.ttf", 30), theme.tagline)
    return img


# ---------------------------------------------------------------------------
# Editorial (Thoughts on the Market)
# ---------------------------------------------------------------------------

def _hero_line_left(base: Image.Image, x: int, y: int, text: str,
                    font: ImageFont.FreeTypeFont) -> None:
    """Left-anchored metallic-gold serif headline line with a soft drop shadow."""
    w = int(ImageDraw.Draw(base).textlength(text, font=font))
    asc, desc = font.getmetrics()
    h = asc + desc
    shadow = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x, y + 5), text, font=font, fill=(0, 24, 17, 175))
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(7)))
    grad = Image.new("RGB", (max(1, w), h))
    gd = ImageDraw.Draw(grad)
    for yy in range(h):
        t = yy / max(1, h - 1)
        gd.line([(0, yy), (w, yy)],
                fill=tuple(int(_GOLD_HI[i] + (_GOLD_LO[i] - _GOLD_HI[i]) * t) for i in range(3)))
    mask = Image.new("L", (max(1, w), h), 0)
    ImageDraw.Draw(mask).text((0, 0), text, font=font, fill=255)
    base.paste(grad, (int(x), int(y)), mask)


_TREND = [0.10, 0.20, 0.16, 0.32, 0.45, 0.39, 0.55, 0.49, 0.67, 0.81, 0.96]


def _draw_uptrend(img: Image.Image, x0, y0, x1, y1) -> Image.Image:
    """A glowing gold candlestick uptrend with a close-line + area glow."""
    chart = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    d = ImageDraw.Draw(chart)
    n = len(_TREND)
    span = (x1 - x0) / n
    bw = span * 0.46

    def yof(v):
        return y1 - max(0.0, min(1.0, v)) * (y1 - y0)

    pts, prev = [], 0.04
    for i, c in enumerate(_TREND):
        o = prev
        hi = max(o, c) + 0.05
        lo = min(o, c) - 0.05
        cxp = x0 + span * (i + 0.5)
        up = c >= o
        body = (236, 206, 120, 235) if up else (150, 120, 60, 205)
        wick = (236, 206, 120, 235) if up else (150, 120, 60, 205)
        d.line([(cxp, yof(lo)), (cxp, yof(hi))], fill=wick, width=3)
        yb0, yb1 = sorted((yof(o), yof(c)))
        d.rectangle([cxp - bw / 2, yb0, cxp + bw / 2, max(yb1, yb0 + 4)], fill=body)
        pts.append((cxp, yof(c)))
        prev = c

    # Soft area fill under the close-line.
    area = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(area).polygon(pts + [(pts[-1][0], y1), (pts[0][0], y1)],
                                 fill=(*_EMERALD_GOLD, 30))
    chart = Image.alpha_composite(chart, area.filter(ImageFilter.GaussianBlur(6)))
    d = ImageDraw.Draw(chart)
    d.line(pts, fill=(250, 232, 170, 230), width=4, joint="curve")
    ex, ey = pts[-1]
    d.ellipse([ex - 9, ey - 9, ex + 9, ey + 9], fill=(252, 240, 190, 255))

    glow = chart.filter(ImageFilter.GaussianBlur(16))
    img = Image.alpha_composite(img, glow)
    return Image.alpha_composite(img, chart)


def _render_editorial(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    img = _gradient_bg(theme.bg_top, theme.bg_bottom).convert("RGBA")

    # Depth: warm highlight upper-left + vignette.
    img = Image.alpha_composite(img, _radial(360, 240, 520, (44, 196, 144), 75))
    img = Image.alpha_composite(img, _vignette(0.6))

    # Right-side glowing candlestick uptrend (the "markets" hero graphic).
    img = _draw_uptrend(img, 726, 214, 1196, 556)

    draw = ImageDraw.Draw(img)
    g = theme.rule
    LX = 96   # left content margin

    # Header: compass + serif wordmark.
    mark = _compass(50)
    if mark is not None:
        img.paste(mark, (LX, 56), mark)
    draw = ImageDraw.Draw(img)
    _draw_tracked(draw, LX + 66, 70, _WORDMARK, _font("DejaVuSerif-Bold.ttf", 21), theme.wordmark, 6)

    # Kicker tab — filled gold pill with dark text.
    kf = _font("DejaVuSerif-Bold.ttf", 21)
    ktext = "MARKET COMMENTARY"
    kw = _tracked_w(draw, ktext, kf, 4)
    draw.rounded_rectangle([LX, 126, LX + kw + 36, 170], radius=8, fill=g)
    _draw_tracked(draw, LX + 18, 134, ktext, kf, theme.bg_bottom, 4)

    # Hero headline — left-aligned serif metallic gold, auto-fit to the text column.
    lines = _balanced_two_lines(eyebrow_label)
    avail = 600
    size = 96
    while size > 48:
        f = _font("DejaVuSerif-Bold.ttf", size)
        if max(draw.textlength(ln, font=f) for ln in lines) <= avail:
            break
        size -= 2
    f_title = _font("DejaVuSerif-Bold.ttf", size)
    asc, desc = f_title.getmetrics()
    lh = int((asc + desc) * 0.98)
    ty = 214
    # Gold pull-quote spine beside the headline.
    draw.rectangle([LX, ty + 10, LX + 7, ty + lh * len(lines) - 8], fill=g)
    for ln in lines:
        _hero_line_left(img, LX + 30, ty, ln, f_title)
        ty += lh
    draw = ImageDraw.Draw(img)

    # Date + small gold underline, left-aligned.
    f_date = _font("DejaVuSerif-Bold.ttf", 40)
    dy = ty + 26
    _draw_tracked(draw, LX + 30, dy, date_text.upper(), f_date, theme.date, 2)
    dw = _tracked_w(draw, date_text.upper(), f_date, 2)
    draw.rectangle([LX + 30, dy + 56, LX + 30 + min(dw, 230), dy + 59], fill=g)

    # Tagline, foot.
    _draw_center(draw, _W // 2, _H - 70, _TAGLINE, _font("DejaVuSerif.ttf", 25), theme.tagline)
    return img.convert("RGB")


def render_session_thumbnail(
    date_text: str,
    eyebrow_label: str = "LIVE TRADING SESSION",
    *,
    variant: str | None = None,
) -> bytes:
    theme = _resolve_theme(variant, eyebrow_label)
    if theme.layout == "editorial":
        img = _render_editorial(theme, date_text, eyebrow_label)
    else:
        img = _render_classic(theme, date_text, eyebrow_label)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()
