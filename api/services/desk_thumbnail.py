"""Render a branded 1280x720 thumbnail for a Desk session video.

Pure Pillow (no network). Returns JPEG bytes ready for YouTube's thumbnails.set.
Assets (compass + fonts) are bundled in desk_assets/ and loaded by absolute path
so it renders identically on Railway.

Each session *type* gets its own colour THEME **and** its own LAYOUT so the cards
are unmistakably different in The Desk → Videos library — not the same template
recoloured:

  - "LIVE TRADING SESSION" -> classic: a candlestick skyline — a glowing gold
    uptrend across a storm-lit night sky, the DATE the metallic-gold hero above
    it. Rendered at 2x and downscaled (super-sampled) with a light film grain.
  - "THOUGHTS ON THE MARKET" -> editorial: a leather-bound journal cover — an
    emerald leather-textured base (theme bg tint + coarse/fine grain), a double
    gold frame with corner diamonds, a compass medallion, and a centered
    gold-foil-stamped title (derived from eyebrow_label) + kicker + date, all
    stamped into the cover. Rendered at 2x and downscaled (super-sampled) for
    crisp, clean edges.
  - "EVENING UPDATE FROM TSDR" -> evening: city lights on water — a dusk skyline
    silhouette rooted at a raised waterline, mirrored into a dim reflection in
    the bay below with window-light streaks and a sun-glitter cone, headline +
    date plaque floating over the sky/water, themed for the evening show.
  - "WORKSHOP WITH CHARTMASTER" -> plate: pre-made cinematic artwork with a
    stamped date plaque, for ChartMaster workshops.

Theme/layout is picked from the eyebrow label (auto-derived from the Zoom webinar
name) so a new content type needs no code change here; pass `variant` to override.
"""
from __future__ import annotations

import io
import os
import random
from typing import NamedTuple

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

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
    layout: str = "classic"   # "classic" | "editorial" | "evening" | "plate"


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
    # Deep emerald leather tint (not the brighter kelly-green of the raw brand
    # swatch) — this is the ONLY consumer of bg_top/bg_bottom (the editorial
    # leather-journal layout), so it's tuned for that cover, not as a general
    # brand color.
    bg_top=(15, 46, 34),
    bg_bottom=(5, 18, 13),
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

# "Evening Update from TSDR" — a twilight navy->dusk editorial card so the daily
# evening show reads as unmistakably *evening* and distinct from the daytime
# Live Trading Session card. Same gold + compass + tagline brand kit.
_EVENING_THEME = Theme(
    bg_top=(22, 32, 60),
    bg_bottom=(5, 7, 14),
    glow=_GOLD,
    wordmark=(228, 219, 236),
    eyebrow=_GOLD,
    date=(238, 230, 216),
    rule=_GOLD,
    tagline=(198, 190, 206),
    layout="evening",
)

# "Workshop with ChartMaster" — a pre-made cinematic artwork plate (stormy sea,
# ornate gold CHARTMASTER lettering baked into the art); only the date is
# stamped per episode. ChartMaster workshops only — not a general plate system.
_CHARTMASTER_THEME = Theme(
    bg_top=(10, 20, 34),
    bg_bottom=(3, 7, 14),
    glow=_GOLD,
    wordmark=(236, 240, 246),
    eyebrow=_GOLD,
    date=(251, 234, 202),
    rule=_GOLD,
    tagline=(138, 147, 163),
    layout="plate",
)

_THEMES = {
    "default": _DEFAULT_THEME,
    "live": _DEFAULT_THEME,
    "thoughts": _EMERALD_THEME,
    "emerald": _EMERALD_THEME,
    "evening": _EVENING_THEME,
    "chartmaster": _CHARTMASTER_THEME,
}


def _resolve_theme(variant: str | None, eyebrow_label: str) -> Theme:
    if variant:
        return _THEMES.get(variant.lower().strip(), _DEFAULT_THEME)
    low = (eyebrow_label or "").lower()
    if "chartmaster" in low:
        return _CHARTMASTER_THEME
    if "evening" in low:
        return _EVENING_THEME
    if "thought" in low:
        return _EMERALD_THEME
    return _DEFAULT_THEME


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(_ASSETS, name), int(size))


def _gradient_bg(top: tuple, bottom: tuple, size: tuple = _SIZE) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size)
    dr = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        dr.line([(0, y), (w, y)], fill=c)
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
    total = _tracked_w(draw, text, font, tracking)
    _draw_tracked(draw, cx - total / 2, y, text, font, fill, tracking)


def _tracked_w(draw, text, font, tracking):
    return sum(draw.textlength(ch, font=font) for ch in text) + tracking * (len(text) - 1)


def _fit_tracked(draw, text, font_name, max_pt, min_pt, max_w, tracking):
    """Largest font size in [min_pt, max_pt] whose tracked width fits max_w;
    if even min_pt overflows, ellipsis-truncate the text to fit. Returns
    (font, text)."""
    size = max_pt
    while size > min_pt:
        f = _font(font_name, size)
        if _tracked_w(draw, text, f, tracking) <= max_w:
            return f, text
        size -= 2
    f = _font(font_name, min_pt)
    t = text
    while t and _tracked_w(draw, t + "…", f, tracking) > max_w:
        t = t[:-1]
    return f, (t + "…") if t != text else text


def _compass(size: int) -> Image.Image | None:
    try:
        mark = Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA")
        return mark.resize((int(size), int(size)), Image.LANCZOS)
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


def _radial(cx, cy, r, color, max_alpha, size: tuple = _SIZE) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*color, max_alpha))
    return layer.filter(ImageFilter.GaussianBlur(int(r * 0.55)))


def _vignette(strength: float, size: tuple = _SIZE) -> Image.Image:
    w, h = size
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse([-w * 0.25, -h * 0.25, w * 1.25, h * 1.25], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(int(h * 0.26)))
    dark = Image.new("RGBA", size, (0, 0, 0, 0))
    dark.putalpha(mask.point(lambda p: int((255 - p) * strength)))
    return dark


# ---------------------------------------------------------------------------
# Classic (Live Trading) — candlestick skyline
# ---------------------------------------------------------------------------

def _band_scrim(size: tuple, y_from: int, y_to: int, max_alpha: int,
                top_down: bool = True) -> Image.Image:
    """Dark gradient band (for text legibility / grounding over busy art)."""
    ov = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    span = max(1, y_to - y_from)
    for y in range(y_from, y_to):
        t = (y - y_from) / span
        a = int(max_alpha * (1 - t)) if top_down else int(max_alpha * t)
        d.line([(0, y), (size[0], y)], fill=(3, 4, 8, a))
    return ov


def _grain(img: Image.Image, alpha: float, seed: int = 7) -> Image.Image:
    """Subtle film grain: additive per-pixel Gaussian noise (monochrome, so it
    reads as grain rather than color speckle). `alpha` is the noise strength
    (stddev). Deterministic (fixed default seed) so renders stay reproducible."""
    import numpy as np
    rng = np.random.default_rng(seed)
    arr = np.asarray(img).astype(np.int16)
    noise = rng.normal(0.0, alpha, arr.shape[:2])[:, :, None]
    return Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8))


def _render_classic(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    """Candlestick skyline: a glowing gold uptrend across a storm-lit night sky,
    the date the metallic-gold hero above it. Rendered at 2x and downscaled
    (super-sampled) for crisp, clean edges, finished with a light film grain."""
    S = 2
    size = (_W * S, _H * S)

    def s(v):
        return int(round(v * S))

    stops = [(0.0, (15, 19, 33)), (0.35, (35, 41, 64)), (0.62, (18, 20, 34)), (1.0, (5, 6, 10))]
    img = _sky_gradient(stops, size).convert("RGBA")
    cx = size[0] // 2

    # Storm light: cold break in the clouds upper-left, warm glow where the
    # trend peaks. Design elements, not theme-driven — stay literal.
    img = Image.alpha_composite(img, _radial(s(300), s(120), s(360), (150, 170, 214), 60, size))
    img = Image.alpha_composite(img, _radial(s(1020), s(600), s(540), _GOLD, 50, size))

    # The skyline: one huge glowing candlestick uptrend across the lower half,
    # softly blurred so it reads like lit towers in the rain.
    lay = Image.new("RGBA", size, (0, 0, 0, 0))
    lay = _draw_uptrend(lay, s(-70), s(304), s(1298), s(742))
    soft = lay.filter(ImageFilter.GaussianBlur(s(3)))
    img = Image.alpha_composite(img, soft)
    crisp = lay.copy()
    crisp.putalpha(crisp.split()[3].point(lambda p: int(p * 0.38)))
    img = Image.alpha_composite(img, crisp)

    # Ground the base + clear the sky band for text.
    img = Image.alpha_composite(img, _band_scrim(size, s(580), size[1], 135, top_down=False))
    img = Image.alpha_composite(img, _band_scrim(size, 0, s(300), 150, top_down=True))

    # Brand kit, centered above the skyline.
    mark = _compass(s(80))
    if mark is not None:
        img.alpha_composite(mark, (cx - s(40), s(34)))
    _shadow_center(img, cx, s(126), _WORDMARK,
                   _font("DejaVuSans-Bold.ttf", 29 * S), theme.wordmark, 8 * S)

    # Eyebrow — dynamic show label, auto-fit (tracked) so an arbitrarily long
    # label shrinks to fit rather than clipping or overflowing the canvas; if
    # even the floor size overflows (very long Zoom webinar names), ellipsis-
    # truncate rather than clip both edges.
    draw = ImageDraw.Draw(img)
    eyebrow_text = f"— {eyebrow_label} —"
    eb_tracking = 5 * S
    eb_font, eyebrow_text = _fit_tracked(draw, eyebrow_text, "DejaVuSans-Bold.ttf",
                                         20 * S, 10 * S, s(_W - 120), eb_tracking)
    _shadow_center(img, cx, s(176), eyebrow_text, eb_font, theme.eyebrow, eb_tracking)

    # Date — metallic gold hero, auto-fit (mirrors the _render_evening idiom).
    date_up = date_text.upper()
    dt_font, date_up = _fit_tracked(draw, date_up, "DejaVuSerif-Bold.ttf",
                                    86 * S, 48 * S, s(_W - 160), 0)
    _gold_center(img, cx, s(216), date_up, dt_font)

    _shadow_center(img, cx, s(346), _TAGLINE, _font("DejaVuSans.ttf", 22 * S), theme.tagline, 0)

    img = Image.alpha_composite(img, _vignette(0.5, size))
    out = img.convert("RGB").resize(_SIZE, Image.LANCZOS)
    return _grain(out, alpha=6.0)


# ---------------------------------------------------------------------------
# Editorial (Thoughts on the Market) — leather-bound journal cover, super-sampled
# ---------------------------------------------------------------------------

_TREND = [0.10, 0.20, 0.16, 0.32, 0.45, 0.39, 0.55, 0.49, 0.67, 0.81, 0.96]


def _draw_uptrend(img: Image.Image, x0, y0, x1, y1) -> Image.Image:
    """Glowing gold candlestick uptrend: filled up-candles, hollow down-candles,
    a bright close-line, and a gradient area glow that fades to nothing."""
    size = img.size
    chart = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(chart)
    n = len(_TREND)
    span = (x1 - x0) / n
    bw = span * 0.44
    wick_w = max(2, int(span * 0.05))
    edge_w = max(2, int(span * 0.05))
    line_w = max(3, int(span * 0.075))
    g = (236, 206, 120, 240)

    def yof(v):
        return y1 - max(0.0, min(1.0, v)) * (y1 - y0)

    pts, prev = [], 0.03
    for i, c in enumerate(_TREND):
        o = prev
        hi = max(o, c) + 0.05
        lo = min(o, c) - 0.05
        cxp = x0 + span * (i + 0.5)
        d.line([(cxp, yof(lo)), (cxp, yof(hi))], fill=g, width=wick_w)
        yb0, yb1 = sorted((yof(o), yof(c)))
        rect = [cxp - bw / 2, yb0, cxp + bw / 2, max(yb1, yb0 + edge_w * 2)]
        if c >= o:
            d.rectangle(rect, fill=g)
        else:
            d.rectangle(rect, outline=g, width=edge_w)
        pts.append((cxp, yof(c)))
        prev = c

    # Gradient area fill under the close-line (bright near the line, fades to 0).
    poly = pts + [(pts[-1][0], y1), (pts[0][0], y1)]
    pmask = Image.new("L", size, 0)
    ImageDraw.Draw(pmask).polygon(poly, fill=255)
    vgrad = Image.new("L", size, 0)
    vg = ImageDraw.Draw(vgrad)
    for yy in range(int(y0), int(y1)):
        t = (yy - y0) / (y1 - y0)
        vg.line([(0, yy), (size[0], yy)], fill=int(70 * (1 - t)))
    amask = ImageChops.multiply(pmask, vgrad)
    area = Image.new("RGBA", size, (*_EMERALD_GOLD, 0))
    area.putalpha(amask)
    chart = Image.alpha_composite(chart, area.filter(ImageFilter.GaussianBlur(max(2, int(span * 0.06)))))

    d = ImageDraw.Draw(chart)
    d.line(pts, fill=(250, 232, 170, 235), width=line_w, joint="curve")
    ex, ey = pts[-1]
    rr = span * 0.14
    d.ellipse([ex - rr, ey - rr, ex + rr, ey + rr], fill=(252, 240, 190, 255))

    glow = chart.filter(ImageFilter.GaussianBlur(max(8, int(span * 0.14))))
    img = Image.alpha_composite(img, glow)
    return Image.alpha_composite(img, chart)


def _journal_gold_grad(w: int, h: int) -> Image.Image:
    """Vertical metallic-gold gradient block — the fill used behind stamped
    (foil-pressed) text on the leather journal cover."""
    grad = Image.new("RGB", (max(1, w), max(1, h)))
    gd = ImageDraw.Draw(grad)
    for yy in range(h):
        t = yy / max(1, h - 1)
        gd.line([(0, yy), (w, yy)],
                fill=tuple(int(_GOLD_HI[i] + (_GOLD_LO[i] - _GOLD_HI[i]) * t) for i in range(3)))
    return grad


def _journal_stamp_center(base: Image.Image, cx: int, y: int, text: str,
                          font: ImageFont.FreeTypeFont, tracking: int = 0) -> None:
    """Gold-foil stamp: a pressed dark halo + metallic gold gradient face, so
    text reads as embossed/stamped into the leather cover rather than printed."""
    d = ImageDraw.Draw(base)
    w = int(_tracked_w(d, text, font, tracking) if tracking else d.textlength(text, font=font))
    asc, desc = font.getmetrics()
    h = asc + desc
    x = int(cx - w / 2)
    off = max(1, h // 36)
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    if tracking:
        _draw_tracked(sd, x - off, y - off, text, font, (0, 0, 0, 200), tracking)
    else:
        sd.text((x - off, y - off), text, font=font, fill=(0, 0, 0, 200))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(max(2, h // 20))))
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    if tracking:
        _draw_tracked(md, 0, 0, text, font, 255, tracking)
    else:
        md.text((0, 0), text, font=font, fill=255)
    base.paste(_journal_gold_grad(w, h), (x, int(y)), mask)


def _journal_diamond(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, fill) -> None:
    """Small gold diamond accent — frame corners + kicker rule end-caps."""
    d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=fill)


def _render_editorial(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    """Leather-bound journal cover: a leather-textured base tint (from theme,
    so "thoughts"/"emerald" share this exact layout), a double gold frame with
    corner diamonds, a compass medallion, and a centered gold-foil-stamped
    headline (derived from eyebrow_label) + kicker + date. Rendered at 2x and
    downscaled (super-sampled) for crisp, clean edges."""
    S = 2                                   # super-sample factor
    W, H = _W * S, _H * S
    size = (W, H)

    def s(v):
        return int(round(v * S))

    GOLD = (214, 180, 98)       # frame + foil-stamp gold — literal, not theme-driven
    GOLD_DIM = (168, 138, 70)   # secondary frame/rule gold

    # Leather base: theme gradient (shared bg tint) + coarse mottling + fine grain.
    base = _gradient_bg(theme.bg_top, theme.bg_bottom, size).convert("RGB")
    coarse = Image.effect_noise((W // 6, H // 6), 58).resize(size, Image.BILINEAR)
    coarse = coarse.filter(ImageFilter.GaussianBlur(2)).convert("L")
    base = Image.blend(base, ImageChops.overlay(base, Image.merge("RGB", (coarse,) * 3)), 0.22)
    fine = Image.effect_noise(size, 34).convert("L")
    base = Image.blend(base, ImageChops.overlay(base, Image.merge("RGB", (fine,) * 3)), 0.16)

    img = base.convert("RGBA")
    img = Image.alpha_composite(img, _radial(W // 2, s(230), s(620), (255, 238, 200), 22, size))
    img = Image.alpha_composite(img, _vignette(0.62, size))

    draw = ImageDraw.Draw(img)
    cx = W // 2

    # Double gold frame + corner diamonds.
    o1, o2 = s(40), s(54)
    draw.rectangle([o1, o1, W - o1, H - o1], outline=GOLD, width=s(3))
    draw.rectangle([o2, o2, W - o2, H - o2], outline=GOLD_DIM, width=s(1))
    for px in (o2, W - o2):
        for py in (o2, H - o2):
            _journal_diamond(draw, px, py, s(9), GOLD)

    # Compass medallion.
    my = s(150)
    draw.ellipse([cx - s(62), my - s(62), cx + s(62), my + s(62)], outline=GOLD, width=s(3))
    draw.ellipse([cx - s(53), my - s(53), cx + s(53), my + s(53)], outline=GOLD_DIM, width=s(1))
    mark = _compass(s(78))
    if mark is not None:
        img.alpha_composite(mark, (cx - s(39), my - s(39)))
    draw = ImageDraw.Draw(img)

    # Wordmark — gold-foil stamp.
    _journal_stamp_center(img, cx, s(236), _WORDMARK, _font("DejaVuSerif-Bold.ttf", 22 * S), 8 * S)
    draw = ImageDraw.Draw(img)

    # Hero headline — eyebrow_label balanced across two lines, auto-fit so the
    # widest line fits inside the gold frame (_W - 260, super-sampled): step
    # the font size down while EITHER line overflows, then — if the floor
    # size still overflows — ellipsis-truncate via the shared _fit_tracked
    # helper (forced to that exact floor size so both lines stay uniform).
    lines = _balanced_two_lines(eyebrow_label)
    max_w = s(_W - 260)
    max_pt, min_pt = 76 * S, 44 * S
    size_pt = max_pt
    while size_pt > min_pt:
        f = _font("DejaVuSerif-Bold.ttf", size_pt)
        if max(draw.textlength(ln, font=f) for ln in lines) <= max_w:
            break
        size_pt -= 2
    f_title = _font("DejaVuSerif-Bold.ttf", size_pt)
    lines = [
        ln if draw.textlength(ln, font=f_title) <= max_w
        else _fit_tracked(draw, ln, "DejaVuSerif-Bold.ttf", size_pt, size_pt, max_w, 0)[1]
        for ln in lines
    ]
    asc, desc = f_title.getmetrics()
    lh = int((asc + desc) * 0.96)
    ty = s(300)
    for ln in lines:
        _journal_stamp_center(img, cx, ty, ln, f_title)
        ty += lh
    draw = ImageDraw.Draw(img)

    # Kicker with flanking rules + diamonds — stays the literal show label.
    ktext = "MARKET COMMENTARY"
    kf = _font("DejaVuSerif-Bold.ttf", 19 * S)
    ky = ty + s(36)
    kw = _tracked_w(draw, ktext, kf, 6 * S)
    kmid = ky + s(13)
    lx0, lx1 = cx - kw / 2 - s(110), cx - kw / 2 - s(24)
    rx0, rx1 = cx + kw / 2 + s(24), cx + kw / 2 + s(110)
    draw.line([lx0, kmid, lx1, kmid], fill=GOLD_DIM, width=s(2))
    draw.line([rx0, kmid, rx1, kmid], fill=GOLD_DIM, width=s(2))
    _journal_diamond(draw, lx0 - s(8), kmid, s(6), GOLD)
    _journal_diamond(draw, rx1 + s(8), kmid, s(6), GOLD)
    _draw_tracked_center(draw, cx, ky, ktext, kf, GOLD, 6 * S)

    # Date — gold-foil stamp.
    f_date = _font("DejaVuSerif-Bold.ttf", 40 * S)
    dy = ky + s(64)
    _journal_stamp_center(img, cx, dy, date_text.upper(), f_date, 5 * S)
    draw = ImageDraw.Draw(img)

    # Tagline, foot.
    _draw_center(draw, cx, H - s(88), _TAGLINE, _font("DejaVuSerif.ttf", 22 * S), theme.tagline)

    return img.convert("RGB").resize(_SIZE, Image.LANCZOS)


# ---------------------------------------------------------------------------
# Evening (Evening Update from TSDR) — cinematic dusk skyline
# ---------------------------------------------------------------------------

_SKY_STOPS = [
    (0.0, (20, 14, 50)), (0.30, (70, 30, 74)), (0.50, (160, 70, 72)),
    (0.62, (224, 126, 60)), (0.695, (252, 204, 120)), (0.72, (120, 60, 50)),
    (1.0, (10, 7, 14)),
]
_SKY_SEEDH = [0.55, 0.80, 0.42, 0.92, 0.6, 0.5, 0.86, 0.46, 0.72, 0.96, 0.58,
              0.66, 0.82, 0.43, 0.76, 0.5, 0.9, 0.6, 0.7, 0.46, 0.84, 0.54,
              0.92, 0.62, 0.5, 0.78, 0.44, 0.86, 0.66, 0.58]


def _sky_gradient(stops: list, size: tuple) -> Image.Image:
    """Multi-stop vertical gradient (the dusk sunset sky)."""
    img = Image.new("RGB", size)
    dr = ImageDraw.Draw(img)
    w, h = size

    def col(t):
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                f = (t - p0) / max(1e-6, (p1 - p0))
                return tuple(int(c0[k] + (c1[k] - c0[k]) * f) for k in range(3))
        return stops[-1][1]

    for y in range(h):
        dr.line([(0, y), (w, y)], fill=col(y / h))
    return img


def _skyline(img: Image.Image, bottom: int, min_h: int, hspan: int,
             color=(6, 5, 12)) -> list:
    """Dark city silhouette rooted at `bottom` (buildings rise upward from
    there, e.g. a waterline) with scattered lit windows; returns rooftop
    points. `min_h`/`hspan` set the shortest building height and the extra
    height range layered on top of it."""
    d = ImageDraw.Draw(img, "RGBA")
    tops = []
    xs = list(range(-20, _W + 60, 46))
    for i, x in enumerate(xs):
        wdt = 46
        hf = _SKY_SEEDH[i % len(_SKY_SEEDH)]
        top = bottom - min_h - int(hf * hspan)
        d.rectangle([x, top, x + wdt - 4, bottom], fill=(*color, 255))
        tops.append((x + wdt // 2, top))
        for wy in range(top + 14, bottom - 10, 22):
            for wx in range(x + 8, x + wdt - 10, 14):
                if ((i * 7 + wy * 3 + wx) % 5) == 0:
                    d.rectangle([wx, wy, wx + 4, wy + 6], fill=(245, 205, 120, 170))
    return tops


def _gold_center(base: Image.Image, cx: int, y: int, text: str,
                 font: ImageFont.FreeTypeFont) -> None:
    """Centered metallic-gold headline with a soft drop shadow."""
    d = ImageDraw.Draw(base)
    w = int(d.textlength(text, font=font))
    asc, desc = font.getmetrics()
    h = asc + desc
    x = int(cx - w / 2)
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((x, y + max(3, h // 18)), text, font=font, fill=(0, 0, 0, 210))
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(max(4, h // 12))))
    grad = Image.new("RGB", (max(1, w), h))
    gd = ImageDraw.Draw(grad)
    for yy in range(h):
        t = yy / max(1, h - 1)
        gd.line([(0, yy), (w, yy)],
                fill=tuple(int(_GOLD_HI[k] + (_GOLD_LO[k] - _GOLD_HI[k]) * t) for k in range(3)))
    mask = Image.new("L", (max(1, w), h), 0)
    ImageDraw.Draw(mask).text((0, 0), text, font=font, fill=255)
    base.paste(grad, (x, int(y)), mask)


def _shadow_center(base: Image.Image, cx: int, y: int, text: str,
                   font: ImageFont.FreeTypeFont, fill: tuple, tracking: int) -> None:
    """Centered tracked text with a soft shadow so it reads over the skyline."""
    sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
    _draw_tracked_center(ImageDraw.Draw(sh), cx, y + 3, text, font, (0, 0, 0, 200), tracking)
    base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(5)))
    _draw_tracked_center(ImageDraw.Draw(base), cx, y, text, font, fill, tracking)


def _water_base(img: Image.Image, waterline: int) -> None:
    """Opaque dark-bay gradient filling below the waterline — the base fill
    the reflection + glitter layers composite onto."""
    w, h = _SIZE
    d = ImageDraw.Draw(img)
    span = max(1, h - waterline)
    for y in range(waterline, h):
        t = (y - waterline) / span
        d.line([(0, y), (w, y)],
               fill=(int(18 - 11 * t), int(16 - 10 * t), int(34 - 22 * t), 255))


def _water_reflections(img: Image.Image, waterline: int, ref_h: int = 200) -> None:
    """Mirror the sky/skyline band just above the waterline into a dim,
    vertically-compressed reflection composited into the bay below — the
    glimmer on dark water that sells the raised horizon as a waterfront."""
    w, h = _SIZE
    region = img.crop((0, waterline - ref_h, w, waterline)).convert("RGB")
    ref = region.transpose(Image.FLIP_TOP_BOTTOM)
    ref = ref.point(lambda p: int(p * 0.52))
    ref = ref.resize((w, max(1, ref_h // 3))).resize((w, h - waterline))
    ref = ref.filter(ImageFilter.GaussianBlur(2))

    mask = Image.new("L", (w, h - waterline), 0)
    md = ImageDraw.Draw(mask)
    for y in range(h - waterline):
        md.line([(0, y), (w, y)], fill=int(200 * (1 - y / (h - waterline)) ** 0.8))
    ref_rgba = ref.convert("RGBA")
    ref_rgba.putalpha(mask)
    layer = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    layer.paste(ref_rgba, (0, waterline))
    img.alpha_composite(layer)


def _water_glitter(img: Image.Image, waterline: int, cx: int, seed: int = 7) -> None:
    """Vertical window-light streaks bleeding down from the skyline, a
    sun-glitter cone widening down the bay, and a bright waterline seam — the
    sparkle that reads as moving water rather than a flat mirror."""
    rnd = random.Random(seed)

    streaks = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    sd = ImageDraw.Draw(streaks)
    for _ in range(54):
        x = rnd.uniform(30, _W - 30)
        ln = rnd.uniform(35, 160)
        a = rnd.randint(45, 125)
        sd.line([(x, waterline + 3), (x, waterline + 3 + ln)], fill=(250, 214, 138, a),
                width=rnd.choice((2, 2, 3)))
    img.alpha_composite(streaks.filter(ImageFilter.GaussianBlur(1)))

    glitter = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glitter)
    for _ in range(150):
        y = waterline + rnd.uniform(4, 190)
        spread = 30 + (y - waterline) * 0.55
        x = cx + rnd.gauss(0, spread * 0.5)
        w = rnd.uniform(3, 11)
        a = rnd.randint(60, 205)
        gd.rectangle([x - w / 2, y, x + w / 2, y + 2], fill=(255, 226, 152, a))
    img.alpha_composite(glitter.filter(ImageFilter.GaussianBlur(1)))

    seam = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(seam).line([(0, waterline), (_W, waterline)], fill=(255, 212, 140, 150), width=2)
    img.alpha_composite(seam.filter(ImageFilter.GaussianBlur(1)))


def _render_evening(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    """City lights on water: a dusk skyline silhouette rooted at a raised
    waterline, mirrored into a dim reflection in the bay below with
    window-light streaks and a sun-glitter cone, headline + date plaque
    floating over the sky/water band."""
    cx = _W // 2
    waterline = 518
    img = _sky_gradient(_SKY_STOPS, _SIZE).convert("RGBA")

    # Sun glow low on the waterline (design elements, not theme-driven).
    img = Image.alpha_composite(img, _radial(cx, waterline, 430, (255, 194, 96), 175))
    img = Image.alpha_composite(img, _radial(cx, waterline - 60, 150, (255, 228, 164), 195))

    tops = _skyline(img, waterline, 30, 160)

    # Subtle glowing gold uptrend tracing the rising rooftops (markets motif).
    pts = [p for p in tops if 60 < p[0] < _W - 60]
    rise = [(pts[i][0], min(p[1] for p in pts[max(0, i - 1):i + 2])) for i in range(len(pts))]
    line = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(line).line(rise, fill=(252, 226, 150, 150), width=4, joint="curve")
    img = Image.alpha_composite(img, line.filter(ImageFilter.GaussianBlur(6)))
    img = Image.alpha_composite(img, line)

    _water_base(img, waterline)
    _water_reflections(img, waterline)
    _water_glitter(img, waterline, cx)

    # Darken the top band so the headline reads cleanly over the sky.
    ov = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for y in range(0, 290):
        od.line([(0, y), (_W, y)], fill=(6, 4, 14, int(165 * (1 - y / 290))))
    img = Image.alpha_composite(img, ov)

    mark = _compass(64)
    if mark is not None:
        img.alpha_composite(mark, (70, 42))
    draw = ImageDraw.Draw(img)
    _draw_tracked(draw, 150, 64, _WORDMARK, _font("DejaVuSans-Bold.ttf", 26), (246, 238, 230), 7)

    # Host-aware: split "<headline> FROM <host>" so the same template serves any
    # host (TSDR, Bracco, …). Headline is the hero; "FROM <host>" is the subline.
    eb = (eyebrow_label or "").upper()
    if " FROM " in eb:
        head, host = eb.split(" FROM ", 1)
        head = head.strip(" -—·") or "EVENING UPDATE"
        sub = "FROM " + host.strip(" -—·")
    else:
        head = eb.strip(" -—·") or "EVENING UPDATE"
        sub = ""
    size_pt = 116
    while size_pt > 60:
        f = _font("DejaVuSerif-Bold.ttf", size_pt)
        if draw.textlength(head, font=f) <= _W - 80:
            break
        size_pt -= 2
    _gold_center(img, cx, 118, head, _font("DejaVuSerif-Bold.ttf", size_pt))

    if sub:
        _shadow_center(img, cx, 262, sub, _font("DejaVuSerif-Bold.ttf", 40), (252, 232, 198), 14)

    # Date pill — floats on the water band. Drawn on its own RGBA layer +
    # alpha_composite (mirrors _render_plate's pill) so the translucent fill
    # actually blends over the busy reflections/glitter beneath it, unlike a
    # direct draw onto the RGBA image.
    draw = ImageDraw.Draw(img)
    df = _font("DejaVuSans-Bold.ttf", 30)
    dt = date_text.upper()
    dw = _tracked_w(draw, dt, df, 3)
    pill_cy = 636
    pill = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle(
        [cx - dw / 2 - 22, pill_cy - 25, cx + dw / 2 + 22, pill_cy + 25],
        radius=25, fill=(0, 0, 0, 150), outline=(250, 212, 132, 255), width=2)
    img.alpha_composite(pill)
    _draw_tracked_center(ImageDraw.Draw(img), cx, pill_cy - 15, dt, df, (251, 234, 202), 3)

    img = Image.alpha_composite(img, _vignette(0.22))
    return img.convert("RGB")


# ---------------------------------------------------------------------------
# Plate (Workshop with ChartMaster) — pre-made artwork + stamped date plaque
# ---------------------------------------------------------------------------

_PLATE_CHARTMASTER = os.path.join(_ASSETS, "chartmaster-workshop.png")

# Plaque center-y: inside the calm-water band the artwork reserves in its
# bottom 15%. Tuned visually against the real plate; keep in sync with the
# authoring brief in the design spec.
_PLATE_DATE_CY = 645


def _cover_fit(src: Image.Image, size: tuple = _SIZE) -> Image.Image:
    """Scale to cover `size`, center-crop the overflow (safety net — the
    plate is authored at 16:9, so normally this is a pure resize)."""
    w, h = src.size
    W, H = size
    scale = max(W / w, H / h)
    nw, nh = max(W, int(round(w * scale))), max(H, int(round(h * scale)))
    src = src.resize((nw, nh), Image.LANCZOS)
    x, y = (nw - W) // 2, (nh - H) // 2
    return src.crop((x, y, x + W, y + H))


def _render_plate(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    try:
        plate = Image.open(_PLATE_CHARTMASTER).convert("RGBA")
        img = _cover_fit(plate)
    except Exception:
        # Never break a publish over a missing/corrupt plate asset.
        # Handles both missing files and corrupt-but-openable assets (PIL lazy evaluation).
        return _render_classic(_DEFAULT_THEME, date_text, eyebrow_label)

    cx = _W // 2

    # Date plaque — same treatment as the Evening Update pill. Drawn on its
    # own RGBA layer + alpha_composite so the translucent fill actually
    # blends over the artwork.
    df = _font("DejaVuSans-Bold.ttf", 30)
    dt = date_text.upper()
    measure = ImageDraw.Draw(img)
    dw = _tracked_w(measure, dt, df, 3)
    pill = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle(
        [cx - dw / 2 - 22, _PLATE_DATE_CY - 25, cx + dw / 2 + 22, _PLATE_DATE_CY + 25],
        radius=25, fill=(0, 0, 0, 130), outline=(250, 212, 132, 255), width=2)
    img = Image.alpha_composite(img, pill)
    _draw_tracked_center(ImageDraw.Draw(img), cx, _PLATE_DATE_CY - 15, dt, df,
                         theme.date, 3)
    return img.convert("RGB")


def render_session_thumbnail(
    date_text: str,
    eyebrow_label: str = "LIVE TRADING SESSION",
    *,
    variant: str | None = None,
) -> bytes:
    theme = _resolve_theme(variant, eyebrow_label)
    if theme.layout == "evening":
        img = _render_evening(theme, date_text, eyebrow_label)
    elif theme.layout == "editorial":
        img = _render_editorial(theme, date_text, eyebrow_label)
    elif theme.layout == "plate":
        img = _render_plate(theme, date_text, eyebrow_label)
    else:
        img = _render_classic(theme, date_text, eyebrow_label)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95, subsampling=0)
    return buf.getvalue()
