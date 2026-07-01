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
    Rendered at 2x and downscaled (super-sampled) for crisp, clean edges.

Theme/layout is picked from the eyebrow label (auto-derived from the Zoom webinar
name) so a new content type needs no code change here; pass `variant` to override.
"""
from __future__ import annotations

import io
import os
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

_THEMES = {
    "default": _DEFAULT_THEME,
    "live": _DEFAULT_THEME,
    "thoughts": _EMERALD_THEME,
    "emerald": _EMERALD_THEME,
    "evening": _EVENING_THEME,
}


def _resolve_theme(variant: str | None, eyebrow_label: str) -> Theme:
    if variant:
        return _THEMES.get(variant.lower().strip(), _DEFAULT_THEME)
    low = (eyebrow_label or "").lower()
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
# Editorial (Thoughts on the Market) — super-sampled
# ---------------------------------------------------------------------------

def _hero_line_left(base: Image.Image, x: int, y: int, text: str,
                    font: ImageFont.FreeTypeFont) -> None:
    """Left-anchored metallic-gold serif headline line with a soft drop shadow."""
    size = base.size
    w = int(ImageDraw.Draw(base).textlength(text, font=font))
    asc, desc = font.getmetrics()
    h = asc + desc
    off = max(2, h // 24)
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x, y + off), text, font=font, fill=(0, 24, 17, 180))
    base.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(max(4, h // 18))))
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


def _render_editorial(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    S = 2                                   # super-sample factor
    W, H = _W * S, _H * S
    size = (W, H)

    def s(v):
        return int(round(v * S))

    img = _gradient_bg(theme.bg_top, theme.bg_bottom, size).convert("RGBA")
    img = Image.alpha_composite(img, _radial(s(360), s(240), s(520), (44, 196, 144), 70, size))
    img = Image.alpha_composite(img, _vignette(0.6, size))

    # Right-side glowing candlestick uptrend (the "markets" hero graphic).
    img = _draw_uptrend(img, s(726), s(214), s(1196), s(556))

    draw = ImageDraw.Draw(img)
    g = theme.rule
    LX = s(96)

    mark = _compass(s(50))
    if mark is not None:
        img.paste(mark, (LX, s(56)), mark)
    draw = ImageDraw.Draw(img)
    _draw_tracked(draw, LX + s(66), s(70), _WORDMARK, _font("DejaVuSerif-Bold.ttf", 21 * S),
                  theme.wordmark, 6 * S)

    # Kicker tab — filled gold pill with dark text.
    kf = _font("DejaVuSerif-Bold.ttf", 21 * S)
    ktext = "MARKET COMMENTARY"
    kw = _tracked_w(draw, ktext, kf, 4 * S)
    draw.rounded_rectangle([LX, s(126), LX + kw + s(36), s(170)], radius=s(8), fill=g)
    _draw_tracked(draw, LX + s(18), s(135), ktext, kf, theme.bg_bottom, 4 * S)

    # Hero headline — auto-fit serif metallic gold, left-aligned.
    lines = _balanced_two_lines(eyebrow_label)
    avail = s(600)
    size_pt = 96
    while size_pt > 48:
        f = _font("DejaVuSerif-Bold.ttf", size_pt * S)
        if max(draw.textlength(ln, font=f) for ln in lines) <= avail:
            break
        size_pt -= 2
    f_title = _font("DejaVuSerif-Bold.ttf", size_pt * S)
    asc, desc = f_title.getmetrics()
    lh = int((asc + desc) * 0.98)
    ty = s(214)
    draw.rectangle([LX, ty + s(10), LX + s(7), ty + lh * len(lines) - s(8)], fill=g)
    for ln in lines:
        _hero_line_left(img, LX + s(30), ty, ln, f_title)
        ty += lh
    draw = ImageDraw.Draw(img)

    # Date + small gold underline.
    f_date = _font("DejaVuSerif-Bold.ttf", 40 * S)
    dy = ty + s(26)
    _draw_tracked(draw, LX + s(30), dy, date_text.upper(), f_date, theme.date, 2 * S)
    dw = _tracked_w(draw, date_text.upper(), f_date, 2 * S)
    draw.rectangle([LX + s(30), dy + s(56), LX + s(30) + min(dw, s(230)), dy + s(60)], fill=g)

    # Tagline, foot.
    _draw_center(draw, W // 2, H - s(70), _TAGLINE, _font("DejaVuSerif.ttf", 25 * S), theme.tagline)

    return img.convert("RGB").resize(_SIZE, Image.LANCZOS)


# ---------------------------------------------------------------------------
# Evening (Evening Update from TSDR) — cinematic dusk skyline
# ---------------------------------------------------------------------------

_SKY_STOPS = [
    (0.0, (24, 16, 52)), (0.32, (74, 30, 76)), (0.54, (170, 72, 72)),
    (0.65, (226, 130, 60)), (0.70, (252, 206, 124)), (0.715, (150, 80, 52)),
    (1.0, (16, 9, 14)),
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


def _skyline(img: Image.Image, horizon: int, color=(6, 5, 12)) -> list:
    """Dark city silhouette with scattered lit windows; returns rooftop points."""
    d = ImageDraw.Draw(img, "RGBA")
    tops = []
    xs = list(range(-20, _W + 60, 46))
    for i, x in enumerate(xs):
        wdt = 46
        hf = _SKY_SEEDH[i % len(_SKY_SEEDH)]
        top = horizon - int((_H - horizon) * hf * 0.9) - int(hf * 60)
        d.rectangle([x, top, x + wdt - 4, _H], fill=(*color, 255))
        tops.append((x + wdt // 2, top))
        for wy in range(top + 14, _H - 10, 22):
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


def _render_evening(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    cx = _W // 2
    img = _sky_gradient(_SKY_STOPS, _SIZE).convert("RGBA")
    horizon = int(_H * 0.70)
    img = Image.alpha_composite(img, _radial(cx, horizon, 380, (255, 198, 98), 150))  # sun
    tops = _skyline(img, horizon)

    # Subtle glowing gold uptrend tracing the rising rooftops (markets motif).
    pts = [p for p in tops if 60 < p[0] < _W - 60]
    rise = [(pts[i][0], min(p[1] for p in pts[max(0, i - 1):i + 2])) for i in range(len(pts))]
    line = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(line).line(rise, fill=(252, 226, 150, 150), width=4, joint="curve")
    img = Image.alpha_composite(img, line.filter(ImageFilter.GaussianBlur(6)))
    img = Image.alpha_composite(img, line)

    # Darken the top band so the headline reads cleanly over the sky.
    ov = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for y in range(0, 310):
        od.line([(0, y), (_W, y)], fill=(6, 4, 14, int(165 * (1 - y / 310))))
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
    _gold_center(img, cx, 140, head, _font("DejaVuSerif-Bold.ttf", size_pt))

    if sub:
        _shadow_center(img, cx, 298, sub, _font("DejaVuSerif-Bold.ttf", 40), (252, 232, 198), 14)

    draw = ImageDraw.Draw(img)
    df = _font("DejaVuSans-Bold.ttf", 30)
    dt = date_text.upper()
    dw = _tracked_w(draw, dt, df, 3)
    draw.rounded_rectangle([cx - dw / 2 - 22, 362, cx + dw / 2 + 22, 412],
                           radius=25, fill=(0, 0, 0, 130), outline=(250, 212, 132), width=2)
    _draw_tracked_center(draw, cx, 372, dt, df, (251, 234, 202), 3)

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
    else:
        img = _render_classic(theme, date_text, eyebrow_label)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95, subsampling=0)
    return buf.getvalue()
