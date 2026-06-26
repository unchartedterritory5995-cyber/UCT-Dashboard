"""Render a branded 1280x720 thumbnail for a Desk session video.

Pure Pillow (no network). Returns JPEG bytes ready for YouTube's thumbnails.set.
Assets (compass + fonts) are bundled in desk_assets/ and loaded by absolute path
so it renders identically on Railway.

Each session *type* gets its own colour THEME **and** its own LAYOUT so the cards
are unmistakably different in The Desk → Videos library — not the same template
recoloured:

  - "LIVE TRADING SESSION" -> classic: gold-on-black, the DATE is the hero.
  - "THOUGHTS ON THE MARKET" -> editorial: a premium gold-on-emerald commentary
    card — serif metallic-gold headline (the TITLE is the hero), radial lighting +
    vignette for depth, gold corner brackets, oversized quote mark, and the date
    in a gold pill.

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
    """Per-session-type palette + layout. Compass stays for brand cohesion."""
    bg_top: tuple
    bg_bottom: tuple
    glow: tuple
    wordmark: tuple
    eyebrow: tuple
    date: tuple
    rule: tuple
    tagline: tuple
    layout: str = "classic"   # "classic" | "editorial"


# Default: the original gold-on-near-black Live Trading card (date is the hero).
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

# Thoughts on Market: premium gold-on-emerald editorial card (title is the hero).
_EMERALD_GOLD = (226, 196, 110)
_EMERALD_THEME = Theme(
    bg_top=(18, 138, 99),
    bg_bottom=(6, 52, 38),
    glow=_EMERALD_GOLD,
    wordmark=(249, 245, 232),
    eyebrow=_EMERALD_GOLD,
    date=(249, 245, 232),
    rule=_EMERALD_GOLD,
    tagline=(188, 206, 186),
    layout="editorial",
)
# Metallic gradient for the editorial hero headline (top -> bottom).
_GOLD_HI = (250, 236, 182)
_GOLD_LO = (196, 156, 82)

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
    words = text.split()
    if len(words) <= 1:
        return words or [""]
    best, best_diff = (words[0], " ".join(words[1:])), 10 ** 9
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        diff = abs(len(a) - len(b))
        if diff < best_diff:
            best, best_diff = (a, b), diff
    return [best[0], best[1]]


def _radial(cx, cy, r, color, max_alpha) -> Image.Image:
    layer = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r],
                                  fill=(*color, max_alpha))
    return layer.filter(ImageFilter.GaussianBlur(int(r * 0.55)))


def _vignette(strength: float) -> Image.Image:
    mask = Image.new("L", _SIZE, 0)
    ImageDraw.Draw(mask).ellipse([-_W * 0.25, -_H * 0.25, _W * 1.25, _H * 1.25],
                                 fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(190))
    dark = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    dark.putalpha(mask.point(lambda p: int((255 - p) * strength)))
    return dark


# ---------------------------------------------------------------------------
# Layouts
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


def _hero_line(base: Image.Image, cx: int, y: int, text: str,
               font: ImageFont.FreeTypeFont) -> None:
    """Draw one metallic-gold serif headline line with a soft drop shadow."""
    d = ImageDraw.Draw(base)
    w = int(d.textlength(text, font=font))
    asc, desc = font.getmetrics()
    h = asc + desc
    x = int(cx - w / 2)

    shadow = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x, y + 5), text, font=font, fill=(0, 28, 20, 165))
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(7)))

    grad = Image.new("RGB", (max(1, w), h))
    gd = ImageDraw.Draw(grad)
    for yy in range(h):
        t = yy / max(1, h - 1)
        gd.line([(0, yy), (w, yy)],
                fill=tuple(int(_GOLD_HI[i] + (_GOLD_LO[i] - _GOLD_HI[i]) * t) for i in range(3)))
    mask = Image.new("L", (max(1, w), h), 0)
    ImageDraw.Draw(mask).text((0, 0), text, font=font, fill=255)
    base.paste(grad, (x, int(y)), mask)


def _render_editorial(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    cx = _W // 2
    img = _gradient_bg(theme.bg_top, theme.bg_bottom).convert("RGBA")

    # Depth: warm radial highlight upper-centre + vignette to darken the corners.
    img = Image.alpha_composite(img, _radial(cx, 250, 520, (40, 190, 140), 70))
    img = Image.alpha_composite(img, _radial(cx, 300, 360, _EMERALD_GOLD, 26))
    img = Image.alpha_composite(img, _vignette(0.55))

    # Oversized translucent quote mark — the editorial signature.
    q = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(q).text((58, -118), "“", font=_font("DejaVuSerif-Bold.ttf", 460),
                           fill=(*theme.glow, 34))
    img = Image.alpha_composite(img, q)

    draw = ImageDraw.Draw(img)
    g = theme.rule

    # Hairline frame + gold corner brackets.
    draw.rectangle([44, 44, _W - 45, _H - 45], outline=(*g, 150), width=1)
    L, m = 54, 30           # bracket arm length, inset
    for (ox, oy, dx, dy) in [(m, m, 1, 1), (_W - m, m, -1, 1),
                             (m, _H - m, 1, -1), (_W - m, _H - m, -1, -1)]:
        draw.line([(ox, oy), (ox + dx * L, oy)], fill=g, width=4)
        draw.line([(ox, oy), (ox, oy + dy * L)], fill=g, width=4)

    # Compass with a soft halo, top-centre.
    img = Image.alpha_composite(img, _radial(cx, 92, 80, theme.glow, 55))
    draw = ImageDraw.Draw(img)
    mark = _compass(62)
    if mark is not None:
        img.paste(mark, (cx - 31, 60), mark)

    _draw_tracked_center(draw, cx, 138, _WORDMARK,
                         _font("DejaVuSerif-Bold.ttf", 22), theme.wordmark, 7)

    # HERO title — serif metallic gold, up to two balanced lines.
    lines = _balanced_two_lines(eyebrow_label)
    f_title = _font("DejaVuSerif-Bold.ttf", 92 if len(lines) > 1 else 100)
    ty = 214 if len(lines) > 1 else 256
    for ln in lines:
        _hero_line(img, cx, ty, ln, f_title)
        ty += 104
    draw = ImageDraw.Draw(img)

    # Date in a gold pill.
    f_date = _font("DejaVuSerif-Bold.ttf", 40)
    dtext = date_text.upper()
    dw = draw.textlength(dtext, font=f_date)
    pad_x, pad_y = 46, 16
    py = ty + 30
    box = [cx - dw / 2 - pad_x, py, cx + dw / 2 + pad_x, py + 40 + pad_y * 2]
    draw.rounded_rectangle(box, radius=14, outline=g, width=2)
    _draw_tracked_center(draw, cx, py + pad_y - 2, dtext, f_date, theme.date, 2)

    # Tagline at the foot.
    _draw_center(draw, cx, _H - 92, _TAGLINE, _font("DejaVuSerif.ttf", 26), theme.tagline)
    return img.convert("RGB")


def render_session_thumbnail(
    date_text: str,
    eyebrow_label: str = "LIVE TRADING SESSION",
    *,
    variant: str | None = None,
) -> bytes:
    """Render the branded card for `date_text` + an `eyebrow_label` (the session
    type) -> JPEG bytes. Colour theme AND layout are auto-selected from
    `eyebrow_label` (or forced via `variant`)."""
    theme = _resolve_theme(variant, eyebrow_label)
    if theme.layout == "editorial":
        img = _render_editorial(theme, date_text, eyebrow_label)
    else:
        img = _render_classic(theme, date_text, eyebrow_label)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()
