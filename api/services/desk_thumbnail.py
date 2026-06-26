"""Render a branded 1280x720 thumbnail for a Desk session video.

Pure Pillow (no network). Returns JPEG bytes ready for YouTube's thumbnails.set.
Assets (compass + fonts) are bundled in desk_assets/ and loaded by absolute path
so it renders identically on Railway.

Each session *type* gets its own colour THEME **and** its own LAYOUT so the cards
are unmistakably different in The Desk → Videos library — not the same template
recoloured:

  - "LIVE TRADING SESSION" -> classic: gold-on-black, the DATE is the hero.
  - "THOUGHTS ON THE MARKET" -> editorial: gold-on-emerald, framed, oversized
    quote mark + the TITLE is the hero with the date as a secondary gold line.

Theme/layout is picked from the eyebrow label (auto-derived from the Zoom webinar
name) so a new content type needs no code change here; pass `variant` to override.
"""
from __future__ import annotations

import io
import os
from typing import NamedTuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

_W, _H = 1280, 720
_ASSETS = os.path.join(os.path.dirname(__file__), "desk_assets")

_GOLD = (201, 168, 76)          # #c9a84c brand gold

_WORDMARK = "UNCHARTED TERRITORY"
_TAGLINE = "Navigate the market, effectively."


class Theme(NamedTuple):
    """Per-session-type palette + layout. Compass stays for brand cohesion."""
    bg_top: tuple        # gradient start (top of card)
    bg_bottom: tuple     # gradient end (bottom of card)
    glow: tuple          # soft halo behind the compass
    wordmark: tuple      # "UNCHARTED TERRITORY"
    eyebrow: tuple       # the session-type accent colour
    date: tuple          # the date
    rule: tuple          # thin divider / frame
    tagline: tuple       # the locked tagline
    layout: str = "classic"   # "classic" | "editorial"


# Default: the original gold-on-near-black Live Trading card (date is the hero).
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

# Thoughts on Market: bright jewel-emerald, editorial layout (title is the hero).
_EMERALD_GOLD = (224, 192, 104)
_EMERALD_THEME = Theme(
    bg_top=(18, 140, 100),      # vivid jewel emerald
    bg_bottom=(7, 58, 42),      # deep emerald (stays clearly green, not black)
    glow=_EMERALD_GOLD,
    wordmark=(248, 244, 230),   # warm ivory
    eyebrow=_EMERALD_GOLD,
    date=_EMERALD_GOLD,
    rule=_EMERALD_GOLD,
    tagline=(186, 204, 184),    # soft sage
    layout="editorial",
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
    if "thought" in (eyebrow_label or "").lower():
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


def _compass(size: int) -> Image.Image | None:
    try:
        mark = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        return mark.resize((size, size), Image.LANCZOS)
    except Exception:
        return None


def _balanced_two_lines(text: str) -> list[str]:
    """Split a label into up to two visually-balanced lines (by word)."""
    words = text.split()
    if len(words) <= 1:
        return words or [""]
    best, best_diff = (words[0], " ".join(words[1:])), 10**9
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        diff = abs(len(a) - len(b))
        if diff < best_diff:
            best, best_diff = (a, b), diff
    return [best[0], best[1]]


# ---------------------------------------------------------------------------
# Layouts
# ---------------------------------------------------------------------------

def _render_classic(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    """Compass + wordmark + small eyebrow + HUGE date (the Live Trading card)."""
    img = _gradient_bg(theme.bg_top, theme.bg_bottom).convert("RGBA")
    cx = _W // 2

    glow = Image.new("RGBA", (_W, _H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - 150, 40, cx + 150, 340], fill=(*theme.glow, 60))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(70)))

    mark = _compass(150)
    if mark is not None:
        img.alpha_composite(mark, (cx - 75, 80))

    img = img.convert("RGB")
    draw = ImageDraw.Draw(img)
    f_word = _font("DejaVuSans-Bold.ttf", 38)
    f_eye = _font("DejaVuSans-Bold.ttf", 30)
    f_date = _font("DejaVuSans-Bold.ttf", 96)
    f_tag = _font("DejaVuSans.ttf", 30)

    _draw_tracked_center(draw, cx, 252, _WORDMARK, f_word, theme.wordmark, 10)
    _draw_tracked_center(draw, cx, 350, f"— {eyebrow_label} —", f_eye, theme.eyebrow, 5)
    _draw_center(draw, cx, 410, date_text, f_date, theme.date)
    draw.rectangle([cx - 90, 548, cx + 90, 552], fill=theme.rule)
    _draw_center(draw, cx, 600, _TAGLINE, f_tag, theme.tagline)
    return img


def _render_editorial(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    """Framed 'commentary' card: oversized quote mark + the TITLE is the hero,
    date demoted to a secondary gold line. A deliberately different silhouette."""
    img = _gradient_bg(theme.bg_top, theme.bg_bottom).convert("RGBA")
    cx = _W // 2

    # Oversized translucent gold quotation mark — the editorial signature.
    q = Image.new("RGBA", (_W, _H), (0, 0, 0, 0))
    qd = ImageDraw.Draw(q)
    qd.text((44, -120), "“", font=_font("DejaVuSans-Bold.ttf", 460),
            fill=(*theme.glow, 40))
    img = Image.alpha_composite(img, q)

    img = img.convert("RGB")
    draw = ImageDraw.Draw(img)

    # Gold double frame.
    g = theme.rule
    draw.rectangle([34, 34, _W - 35, _H - 35], outline=g, width=3)
    draw.rectangle([46, 46, _W - 47, _H - 47], outline=g, width=1)

    # Top row: small compass + wordmark.
    mark = _compass(58)
    if mark is not None:
        img.paste(mark, (cx - 29, 84), mark)
    _draw_tracked_center(draw, cx, 158, _WORDMARK, _font("DejaVuSans-Bold.ttf", 24),
                         theme.wordmark, 8)

    # HERO title (the eyebrow label) — big, up to two balanced lines.
    lines = _balanced_two_lines(eyebrow_label)
    f_title = _font("DejaVuSans-Bold.ttf", 88 if len(lines) > 1 else 96)
    ty = 240 if len(lines) > 1 else 280
    for ln in lines:
        _draw_center(draw, cx, ty, ln, f_title, theme.wordmark)
        ty += 98

    # Gold rule + secondary date line.
    rule_y = ty + 18
    draw.rectangle([cx - 80, rule_y, cx + 80, rule_y + 3], fill=g)
    _draw_tracked_center(draw, cx, rule_y + 28, date_text.upper(),
                         _font("DejaVuSans-Bold.ttf", 48), theme.date, 2)

    # Tagline, bottom inside the frame.
    _draw_center(draw, cx, _H - 98, _TAGLINE, _font("DejaVuSans.ttf", 26), theme.tagline)
    return img


def render_session_thumbnail(
    date_text: str,
    eyebrow_label: str = "LIVE TRADING SESSION",
    *,
    variant: str | None = None,
) -> bytes:
    """Render the branded card for `date_text` (e.g. "June 24, 2026") + an
    `eyebrow_label` (the session type) -> JPEG bytes. Colour theme AND layout are
    auto-selected from `eyebrow_label` (or forced via `variant`)."""
    theme = _resolve_theme(variant, eyebrow_label)
    if theme.layout == "editorial":
        img = _render_editorial(theme, date_text, eyebrow_label)
    else:
        img = _render_classic(theme, date_text, eyebrow_label)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
