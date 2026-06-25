"""Render a branded 1280x720 thumbnail for a Live Trading Session video.

Pure Pillow (no network). Dark UCT card with the compass mark, wordmark, a gold
"LIVE TRADING SESSION" eyebrow, the date, and the locked tagline. Returns JPEG
bytes ready for YouTube's thumbnails.set. Assets (compass + fonts) are bundled
in desk_assets/ and loaded by absolute path so it renders identically on Railway.
"""
from __future__ import annotations

import io
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

_W, _H = 1280, 720
_ASSETS = os.path.join(os.path.dirname(__file__), "desk_assets")
_GOLD = (201, 168, 76)          # #c9a84c brand gold
_WHITE = (236, 240, 246)
_MUTED = (138, 147, 163)
_BG_TOP = (13, 17, 23)          # #0d1117
_BG_BOTTOM = (5, 7, 11)         # near-black

_EYEBROW = "— LIVE TRADING SESSION —"
_WORDMARK = "UNCHARTED TERRITORY"
_TAGLINE = "Navigate the market, effectively."


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(_ASSETS, name), size)


def _gradient_bg() -> Image.Image:
    img = Image.new("RGB", (_W, _H))
    dr = ImageDraw.Draw(img)
    for y in range(_H):
        t = y / _H
        c = tuple(int(_BG_TOP[i] + (_BG_BOTTOM[i] - _BG_TOP[i]) * t) for i in range(3))
        dr.line([(0, y), (_W, y)], fill=c)
    return img


def _draw_center(draw, cx, y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text((cx - w / 2, y), text, font=font, fill=fill)


def _draw_tracked_center(draw, cx, y, text, font, fill, tracking):
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking


def render_session_thumbnail(date_text: str) -> bytes:
    """Render the branded card for `date_text` (e.g. "June 24, 2026") -> JPEG bytes."""
    img = _gradient_bg().convert("RGBA")
    cx = _W // 2

    # Soft gold glow behind the compass.
    glow = Image.new("RGBA", (_W, _H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - 150, 40, cx + 150, 340], fill=(*_GOLD, 60))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(70)))

    # Compass mark, centered near the top.
    try:
        mark = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        mark = mark.resize((150, 150), Image.LANCZOS)
        img.alpha_composite(mark, (cx - 75, 80))
    except Exception:
        pass

    img = img.convert("RGB")
    draw = ImageDraw.Draw(img)

    f_word = _font("DejaVuSans-Bold.ttf", 38)
    f_eye = _font("DejaVuSans-Bold.ttf", 30)
    f_date = _font("DejaVuSans-Bold.ttf", 96)
    f_tag = _font("DejaVuSans.ttf", 30)

    _draw_tracked_center(draw, cx, 252, _WORDMARK, f_word, _WHITE, 10)
    _draw_tracked_center(draw, cx, 350, _EYEBROW, f_eye, _GOLD, 5)
    _draw_center(draw, cx, 410, date_text, f_date, _WHITE)
    # thin gold rule under the date
    draw.rectangle([cx - 90, 548, cx + 90, 552], fill=_GOLD)
    _draw_center(draw, cx, 600, _TAGLINE, f_tag, _MUTED)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
