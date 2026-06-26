"""Render a branded 1280x720 thumbnail for a Desk session video.

Pure Pillow (no network). A UCT card with the compass mark, wordmark, a session
eyebrow, the date, and the locked tagline. Returns JPEG bytes ready for YouTube's
thumbnails.set. Assets (compass + fonts) are bundled in desk_assets/ and loaded by
absolute path so it renders identically on Railway.

Each session *type* gets its own colour THEME so the cards are visually distinct in
The Desk → Videos library. The theme is picked from the eyebrow label (auto-derived
from the Zoom webinar name) so a new content type needs no code change here:

  - "LIVE TRADING SESSION"  -> dark gold-on-black card (the default / back-compat)
  - "THOUGHTS ON MARKET"    -> rich gold-on-emerald card (stands apart at a glance)

Pass an explicit `variant` to override the auto-pick.
"""
from __future__ import annotations

import io
import os
from typing import NamedTuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

_W, _H = 1280, 720
_ASSETS = os.path.join(os.path.dirname(__file__), "desk_assets")

# Shared brand constants.
_GOLD = (201, 168, 76)          # #c9a84c brand gold

_WORDMARK = "UNCHARTED TERRITORY"
_TAGLINE = "Navigate the market, effectively."


class Theme(NamedTuple):
    """Per-session-type palette. Compass + gold glow stay for brand cohesion."""
    bg_top: tuple        # gradient start (top of card)
    bg_bottom: tuple     # gradient end (bottom of card)
    glow: tuple          # soft halo behind the compass
    wordmark: tuple      # "UNCHARTED TERRITORY"
    eyebrow: tuple       # the session-type eyebrow
    date: tuple          # the big date
    rule: tuple          # thin divider under the date
    tagline: tuple       # the locked tagline


# Default: the original gold-on-near-black Live Trading card.
_DEFAULT_THEME = Theme(
    bg_top=(13, 17, 23),        # #0d1117
    bg_bottom=(5, 7, 11),       # near-black
    glow=_GOLD,
    wordmark=(236, 240, 246),   # off-white
    eyebrow=_GOLD,
    date=(236, 240, 246),
    rule=_GOLD,
    tagline=(138, 147, 163),    # muted slate
)

# Thoughts on Market: rich gold-on-emerald — bright jewel-green so the card
# clearly pops against the dark Videos library page (not a near-black card).
_EMERALD_GOLD = (212, 178, 86)  # slightly richer gold that reads on bright green
_EMERALD_THEME = Theme(
    bg_top=(18, 140, 100),      # vivid jewel emerald
    bg_bottom=(9, 64, 46),      # deep emerald (stays clearly green, not black)
    glow=_EMERALD_GOLD,         # warm gold halo behind the compass
    wordmark=(248, 244, 230),   # warm ivory
    eyebrow=_EMERALD_GOLD,
    date=(248, 244, 230),
    rule=_EMERALD_GOLD,
    tagline=(170, 190, 168),    # soft sage
)

_THEMES = {
    "default": _DEFAULT_THEME,
    "live": _DEFAULT_THEME,
    "thoughts": _EMERALD_THEME,
    "emerald": _EMERALD_THEME,
}


def _resolve_theme(variant: str | None, eyebrow_label: str) -> Theme:
    """Explicit `variant` wins; otherwise auto-pick from the eyebrow text."""
    if variant:
        return _THEMES.get(variant.lower().strip(), _DEFAULT_THEME)
    low = (eyebrow_label or "").lower()
    if "thought" in low:        # "THOUGHTS ON MARKET" / "Thoughts on the Market"
        return _EMERALD_THEME
    return _DEFAULT_THEME


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(_ASSETS, name), size)


def _gradient_bg(top: tuple, bottom: tuple) -> Image.Image:
    img = Image.new("RGB", (_W, _H))
    dr = ImageDraw.Draw(img)
    for y in range(_H):
        t = y / _H
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
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


def render_session_thumbnail(
    date_text: str,
    eyebrow_label: str = "LIVE TRADING SESSION",
    *,
    variant: str | None = None,
) -> bytes:
    """Render the branded card for `date_text` (e.g. "June 24, 2026") + an
    `eyebrow_label` (the session type, e.g. "THOUGHTS ON MARKET") -> JPEG bytes.

    The colour theme is auto-selected from `eyebrow_label` (or forced via
    `variant`) so each session type looks distinct in the library."""
    theme = _resolve_theme(variant, eyebrow_label)
    eyebrow = f"— {eyebrow_label} —"
    img = _gradient_bg(theme.bg_top, theme.bg_bottom).convert("RGBA")
    cx = _W // 2

    # Soft glow behind the compass.
    glow = Image.new("RGBA", (_W, _H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - 150, 40, cx + 150, 340], fill=(*theme.glow, 60))
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

    _draw_tracked_center(draw, cx, 252, _WORDMARK, f_word, theme.wordmark, 10)
    _draw_tracked_center(draw, cx, 350, eyebrow, f_eye, theme.eyebrow, 5)
    _draw_center(draw, cx, 410, date_text, f_date, theme.date)
    # thin rule under the date
    draw.rectangle([cx - 90, 548, cx + 90, 552], fill=theme.rule)
    _draw_center(draw, cx, 600, _TAGLINE, f_tag, theme.tagline)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
