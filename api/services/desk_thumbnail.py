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
  - "SUNDAY SCANS" -> sunday: a pre-dawn indigo->amber horizon (the week hasn't
    opened yet) over a dark ground carrying a scanner RESULTS STRIP of mini
    sparkline tiles, one picked out by a soft scan beam. Deliberately inverts
    the Live Trading card (light low instead of high, many small charts instead
    of one big uptrend) so the two never read alike in the library.

Theme/layout is picked from the eyebrow label (auto-derived from the Zoom webinar
name) so a new content type needs no code change here; pass `variant` to override.
"""
from __future__ import annotations

import io
import os
import random
import re
import zlib
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
    wordmark: tuple
    eyebrow: tuple
    date: tuple
    tagline: tuple
    layout: str = "classic"   # "classic" | "editorial" | "evening" | "plate"


_DEFAULT_THEME = Theme(
    bg_top=(13, 17, 23),
    bg_bottom=(5, 7, 11),
    wordmark=(236, 240, 246),
    eyebrow=_GOLD,
    date=(236, 240, 246),
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
    wordmark=(249, 245, 232),
    eyebrow=_EMERALD_GOLD,
    date=(249, 245, 232),
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
    wordmark=(228, 219, 236),
    eyebrow=_GOLD,
    date=(238, 230, 216),
    tagline=(198, 190, 206),
    layout="evening",
)

# "Workshop with ChartMaster" — a pre-made cinematic artwork plate (stormy sea,
# ornate gold CHARTMASTER lettering baked into the art); only the date is
# stamped per episode. ChartMaster workshops only — not a general plate system.
_CHARTMASTER_THEME = Theme(
    bg_top=(10, 20, 34),
    bg_bottom=(3, 7, 14),
    wordmark=(236, 240, 246),
    eyebrow=_GOLD,
    date=(251, 234, 202),
    tagline=(138, 147, 163),
    layout="plate",
)

# "Workshop with Zen" — a serene "balance" card built around Zen's own yin-yang
# bull/bear mark (his X avatar, bundled as zen-logo.png). Deep twilight-teal
# calm gradient; the mark is the glowing hero inside a gold moon-ring with zen
# water-ripples, UCT compass co-brand above, gold date plaque below. Zen
# workshops only — keyed off "zen" in the eyebrow, mirrors the ChartMaster
# plate idiom (a bespoke per-host card, not a general system).
_ZEN_THEME = Theme(
    bg_top=(16, 32, 42),
    bg_bottom=(5, 9, 13),
    wordmark=(224, 232, 236),
    eyebrow=_GOLD,
    date=(244, 238, 220),
    tagline=(150, 168, 176),
    layout="zen",
)

# "Sunday Scans" — the weekend prep read, so the card is DAWN: an indigo->amber
# pre-dawn horizon (the week hasn't opened yet) over a dark ground carrying a
# scanner RESULTS STRIP of mini sparkline tiles. Deliberately the inverse of the
# Live Trading card's night skyline: light at the bottom, many small charts
# instead of one big uptrend, so the two never read alike in the library.
_SUNDAY_THEME = Theme(
    bg_top=(11, 15, 38),
    bg_bottom=(4, 4, 8),
    wordmark=(238, 232, 244),
    eyebrow=_GOLD,
    date=(250, 240, 220),
    tagline=(176, 166, 186),
    layout="sunday",
)

_THEMES = {
    "default": _DEFAULT_THEME,
    "live": _DEFAULT_THEME,
    "thoughts": _EMERALD_THEME,
    "emerald": _EMERALD_THEME,
    "evening": _EVENING_THEME,
    "chartmaster": _CHARTMASTER_THEME,
    "zen": _ZEN_THEME,
    "sunday": _SUNDAY_THEME,
    "scans": _SUNDAY_THEME,
}


def _resolve_theme(variant: str | None, eyebrow_label: str) -> Theme:
    if variant:
        return _THEMES.get(variant.lower().strip(), _DEFAULT_THEME)
    low = (eyebrow_label or "").lower()
    if "chartmaster" in low.replace(" ", ""):
        return _CHARTMASTER_THEME
    # "zen" as a whole word (avoid citizen/zenith/frozen false matches) — the
    # Zen workshop card. Matches "WORKSHOP WITH ZEN" and any "… Zen …" name.
    if re.search(r"\bzen\b", low):
        return _ZEN_THEME
    if "evening" in low:
        return _EVENING_THEME
    if "thought" in low:
        return _EMERALD_THEME
    # "Sunday Scans" (and any "Sunday …" weekend show) — the dawn scanner card.
    if "sunday" in low:
        return _SUNDAY_THEME
    return _DEFAULT_THEME


def _episode_seed(date_text: str, eyebrow_label: str) -> int:
    """Deterministic per-episode seed derived from the episode's own inputs —
    same date+eyebrow always reproduces the same card; a different date or
    show name reliably produces a different (but still deterministic) card.
    Never touches the global `random` state — callers thread this int into
    their own `random.Random(seed)` / `np.random.default_rng(seed)` instances."""
    return zlib.crc32(f"{date_text}|{eyebrow_label}".encode())


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
    while size >= min_pt:
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


def _render_classic(theme: Theme, date_text: str, eyebrow_label: str, *,
                    seed: int = 7) -> Image.Image:
    """Candlestick skyline: a glowing gold uptrend across a storm-lit night sky,
    the date the metallic-gold hero above it. Rendered at 2x and downscaled
    (super-sampled) for crisp, clean edges, finished with a light film grain.
    `seed` (per-episode, from `_episode_seed`) drives the candlestick trend
    shape + the grain offset so every day's card is unique but reproducible."""
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
    trend = _gen_trend(seed)
    lay = Image.new("RGBA", size, (0, 0, 0, 0))
    lay = _draw_uptrend(lay, s(-70), s(304), s(1298), s(742), trend=trend)
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
    return _grain(out, alpha=6.0, seed=7 + seed)


# ---------------------------------------------------------------------------
# Editorial (Thoughts on the Market) — leather-bound journal cover, super-sampled
# ---------------------------------------------------------------------------

_TREND = [0.10, 0.20, 0.16, 0.32, 0.45, 0.39, 0.55, 0.49, 0.67, 0.81, 0.96]

_TREND_STEP_LO, _TREND_STEP_HI = -0.12, 0.22   # every consecutive delta, no exceptions
_TREND_TAIL_STEPS = 4                          # last N transitions: clean rise + tail-blend
_TREND_MAX_ATTEMPTS = 40                       # bounded regeneration for a rare unlanded draw


def _gen_trend(seed: int, n: int = len(_TREND)) -> list:
    """Deterministic per-episode candlestick trend: a random walk of `n`
    points (matches `_TREND`'s length by default) that starts low, ends high,
    and rises with 2-4 bounded pullbacks along the way — decorative variation
    only, never the global random state.

    Contract (regression-tested over 10k seeds —
    ``test_gen_trend_bounds_over_many_seeds``):
      1. every point in [0, 1]
      2. final point in [0.90, 1.0]
      3. every consecutive delta in [-0.12, +0.22]
      4. 2-4 down-steps (pullbacks) present
      5. deterministic per rng seed

    - start in [0.05, 0.20], end (target close) in [0.90, 1.0]
    - the last `_TREND_TAIL_STEPS` transitions are never eligible to be
      picked as a pullback (they always rise) and are where the walk closes
      the gap to `end` — no single step is ever force-anchored past the
      bound, so there is no oversized "tower" candle. The gap is spread
      across those tail steps with growing weight toward the very last one,
      and every individual step (interior AND tail) is clamped to
      [-0.12, +0.22] BEFORE being applied — never overwritten after.
    - if a rare draw still can't land the final point in [0.90, 1.0] with
      2-4 pullbacks present (e.g. pullbacks left more ground to cover than
      the tail's bounded steps can close), the whole walk is regenerated by
      drawing again from the SAME `rng` instance — bounded retries, still
      fully deterministic per seed.
    - every point clamped to [0, 1]
    """
    rng = random.Random(seed)
    steps = n - 1
    tail_n = min(_TREND_TAIL_STEPS, max(steps - 1, 0))
    interior_steps = steps - tail_n
    pullback_ceiling = max(1, interior_steps)
    eligible = list(range(1, pullback_ceiling)) if pullback_ceiling > 1 else []

    candidate = None
    for _attempt in range(_TREND_MAX_ATTEMPTS):
        start = rng.uniform(0.05, 0.20)
        end = rng.uniform(0.90, 1.0)
        n_pullbacks = min(rng.randint(2, 4), len(eligible))
        pullback_steps = set(rng.sample(eligible, n_pullbacks)) if eligible and n_pullbacks else set()

        values = [start]
        cur = start
        for i in range(interior_steps):
            remaining = steps - i
            if i in pullback_steps:
                step = rng.uniform(-0.12, -0.03)
            else:
                target_step = (end - cur) / remaining
                step = target_step + rng.uniform(-0.03, 0.05)
            step = max(_TREND_STEP_LO, min(_TREND_STEP_HI, step))
            cur = max(0.0, min(1.0, cur + step))
            values.append(cur)

        # Tail-blend: close the gap to `end` over `tail_n` clean-rise steps,
        # weighted toward the last one, each clamped to the same bounds as
        # every other step (replaces the old unconditional final-point anchor).
        if tail_n:
            gap = end - cur
            wsum = tail_n * (tail_n + 1) / 2
            for w in range(1, tail_n + 1):
                step = max(_TREND_STEP_LO, min(_TREND_STEP_HI, gap * w / wsum))
                cur = max(0.0, min(1.0, cur + step))
                values.append(cur)

        deltas = [b - a for a, b in zip(values, values[1:])]
        landed = 0.90 <= values[-1] <= 1.0
        n_down = sum(1 for d in deltas if d < 0)
        candidate = values
        if landed and 2 <= n_down <= 4:
            return values

    return candidate  # pragma: no cover — exhausted retries on a pathological draw


def _draw_uptrend(img: Image.Image, x0, y0, x1, y1, trend: list | None = None) -> Image.Image:
    """Glowing gold candlestick uptrend: filled up-candles, hollow down-candles,
    a bright close-line, and a gradient area glow that fades to nothing.
    `trend` defaults to the fixed `_TREND` list so other callers are unaffected;
    pass a per-episode series (see `_gen_trend`) for date-seeded variation."""
    trend = _TREND if trend is None else trend
    size = img.size
    chart = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(chart)
    n = len(trend)
    span = (x1 - x0) / n
    bw = span * 0.44
    wick_w = max(2, int(span * 0.05))
    edge_w = max(2, int(span * 0.05))
    line_w = max(3, int(span * 0.075))
    g = (236, 206, 120, 240)

    def yof(v):
        return y1 - max(0.0, min(1.0, v)) * (y1 - y0)

    pts, prev = [], 0.03
    for i, c in enumerate(trend):
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


def _render_editorial(theme: Theme, date_text: str, eyebrow_label: str, *,
                      seed: int = 7) -> Image.Image:
    """Leather-bound journal cover: a leather-textured base tint (from theme,
    so "thoughts"/"emerald" share this exact layout), a double gold frame with
    corner diamonds, a compass medallion, and a centered gold-foil-stamped
    headline (derived from eyebrow_label) + kicker + date. Rendered at 2x and
    downscaled (super-sampled) for crisp, clean edges. `seed` (per-episode)
    only SUBTLY varies the leather grain + lighting-center jitter — this is
    a formal design, so no structural variation."""
    S = 2                                   # super-sample factor
    W, H = _W * S, _H * S
    size = (W, H)

    def s(v):
        return int(round(v * S))

    GOLD = (214, 180, 98)       # frame + foil-stamp gold — literal, not theme-driven
    GOLD_DIM = (168, 138, 70)   # secondary frame/rule gold

    # Leather base: theme gradient (shared bg tint) + coarse mottling + fine grain.
    base = _gradient_bg(theme.bg_top, theme.bg_bottom, size).convert("RGB")
    # Seeded coarse grain (deterministic leather texture), subtly jittered per
    # episode by offsetting the base grain seed.
    import numpy as np
    rng = np.random.default_rng(7 + seed)
    coarse_arr = rng.normal(128.0, 58.0, (H // 6, W // 6))
    coarse = Image.fromarray(np.clip(coarse_arr, 0, 255).astype(np.uint8), mode='L')
    coarse = coarse.resize(size, Image.BILINEAR)
    coarse = coarse.filter(ImageFilter.GaussianBlur(2))
    base = Image.blend(base, ImageChops.overlay(base, Image.merge("RGB", (coarse,) * 3)), 0.22)
    # Seeded fine grain (deterministic leather texture overlay)
    fine_arr = rng.normal(128.0, 34.0, (H, W))
    fine = Image.fromarray(np.clip(fine_arr, 0, 255).astype(np.uint8), mode='L')
    base = Image.blend(base, ImageChops.overlay(base, Image.merge("RGB", (fine,) * 3)), 0.16)

    img = base.convert("RGBA")
    # Radial lighting center jittered a few tens of pixels per episode — subtle,
    # not structural (formal design).
    jrng = random.Random(seed)
    jx = s(jrng.uniform(-30, 30))
    jy = s(jrng.uniform(-30, 30))
    img = Image.alpha_composite(
        img, _radial(W // 2 + jx, s(230) + jy, s(620), (255, 238, 200), 22, size))
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
             color=(6, 5, 12), seed: int = 7) -> list:
    """Dark city silhouette rooted at `bottom` (buildings rise upward from
    there, e.g. a waterline) with scattered lit windows; returns rooftop
    points. `min_h`/`hspan` set the shortest building height and the extra
    height range layered on top of it. `seed` (per-episode) drives both the
    building heights and lit-window placement — same visual ranges/density
    as the old fixed pattern, just seeded per day instead of hardcoded."""
    d = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(seed)
    tops = []
    xs = list(range(-20, _W + 60, 46))
    for i, x in enumerate(xs):
        wdt = 46
        hf = rng.uniform(0.42, 0.96)
        top = bottom - min_h - int(hf * hspan)
        d.rectangle([x, top, x + wdt - 4, bottom], fill=(*color, 255))
        tops.append((x + wdt // 2, top))
        for wy in range(top + 14, bottom - 10, 22):
            for wx in range(x + 8, x + wdt - 10, 14):
                if rng.random() < 0.2:
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


def _render_evening(theme: Theme, date_text: str, eyebrow_label: str, *,
                    seed: int = 7) -> Image.Image:
    """City lights on water: a dusk skyline silhouette rooted at a raised
    waterline, mirrored into a dim reflection in the bay below with
    window-light streaks and a sun-glitter cone, headline + date plaque
    floating over the sky/water band. `seed` (per-episode, from
    `_episode_seed`) drives the skyline heights/window placement and the
    water reflections/glitter so each day's card is unique but deterministic."""
    cx = _W // 2
    waterline = 518
    img = _sky_gradient(_SKY_STOPS, _SIZE).convert("RGBA")

    # Sun glow low on the waterline (design elements, not theme-driven).
    img = Image.alpha_composite(img, _radial(cx, waterline, 430, (255, 194, 96), 175))
    img = Image.alpha_composite(img, _radial(cx, waterline - 60, 150, (255, 228, 164), 195))

    tops = _skyline(img, waterline, 30, 160, seed=seed)

    # Subtle glowing gold uptrend tracing the rising rooftops (markets motif).
    pts = [p for p in tops if 60 < p[0] < _W - 60]
    rise = [(pts[i][0], min(p[1] for p in pts[max(0, i - 1):i + 2])) for i in range(len(pts))]
    line = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(line).line(rise, fill=(252, 226, 150, 150), width=4, joint="curve")
    img = Image.alpha_composite(img, line.filter(ImageFilter.GaussianBlur(6)))
    img = Image.alpha_composite(img, line)

    _water_base(img, waterline)
    _water_reflections(img, waterline)
    _water_glitter(img, waterline, cx, seed=seed + 1)

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
        # Never break a publish over a missing/corrupt plate asset. Handles both
        # missing files and corrupt-but-openable assets (PIL lazy evaluation).
        # Seed derived the same way `render_session_thumbnail` would for this
        # exact (date_text, eyebrow_label) pair, so the fallback stays byte-
        # identical to an explicit variant="default" classic render.
        seed = _episode_seed(date_text, eyebrow_label)
        return _render_classic(_DEFAULT_THEME, date_text, eyebrow_label, seed=seed)

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


# ---------------------------------------------------------------------------
# Zen (Workshop with Zen) — serene balance card built on Zen's yin-yang mark
# ---------------------------------------------------------------------------

_ZEN_LOGO = os.path.join(_ASSETS, "zen-logo.png")
_ZEN_DESCRIPTOR = "THEMATIC SWING TRADER"   # Zen's Desk role — baked in (Zen-only card)
_ZEN_RIPPLE = (206, 176, 100)               # faint water-ripple gold


def _zen_logo_disc(d: int) -> Image.Image:
    """Zen's yin-yang bull/bear mark as a clean circular 'moon': resize the
    square avatar to d×d, mask it to a disc (trims the black corners), and
    duotone it so BOTH halves read on a dark card — the bear (dark) half lifts
    to a cool slate, the bull (light) half to warm ivory. Falls back to the raw
    masked avatar if anything about the asset is off (never breaks a publish)."""
    src = Image.open(_ZEN_LOGO).convert("RGBA").resize((d, d), Image.LANCZOS)
    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse([1, 1, d - 2, d - 2], fill=255)
    try:
        import numpy as np
        lum = np.asarray(src.convert("L")).astype(np.float32) / 255.0
        dark = np.array((58, 72, 92), np.float32)      # bear half -> cool slate
        light = np.array((248, 242, 226), np.float32)   # bull half -> warm ivory
        rgb = (dark + (light - dark) * lum[:, :, None]).clip(0, 255).astype("uint8")
        disc = Image.fromarray(rgb, "RGB").convert("RGBA")
    except Exception:
        disc = src
    disc.putalpha(mask)
    return disc


def _render_zen(theme: Theme, date_text: str, eyebrow_label: str, *,
                seed: int = 7) -> Image.Image:
    """Serene, symmetric 'balance' card: Zen's yin-yang mark glowing at center
    inside a gold moon-ring with concentric water-ripples over a twilight-teal
    calm gradient; UCT compass + wordmark co-brand above, the show name as a
    gold serif hero, his role, and a gold date plaque below. Rendered at 2x and
    downscaled (super-sampled) for crisp edges, finished with a whisper of grain.
    `seed` only nudges the grain — this is a formal, still design (no structural
    per-episode variation, matching the editorial card's restraint)."""
    S = 2
    W, H = _W * S, _H * S
    size = (W, H)

    def s(v):
        return int(round(v * S))

    # Build the mark FIRST — if the asset is missing/corrupt, never break a
    # publish: fall back to the classic branded card (mirrors _render_plate).
    # Seed matches what render_session_thumbnail derives, so the fallback is a
    # deterministic classic render for this exact (date, name) pair.
    d = s(298)
    try:
        disc = _zen_logo_disc(d)
    except Exception:
        return _render_classic(_DEFAULT_THEME, date_text, eyebrow_label, seed=seed)

    img = _gradient_bg(theme.bg_top, theme.bg_bottom, size).convert("RGBA")
    cx = W // 2
    logo_cy = s(296)

    # Backlight — a cool wash + a warm gold core behind the mark (depth).
    img = Image.alpha_composite(img, _radial(cx, logo_cy, s(320), (66, 118, 148), 46, size))
    img = Image.alpha_composite(img, _radial(cx, logo_cy, s(200), _GOLD, 44, size))

    # Zen water-ripples — faint concentric gold rings emanating from the mark
    # (a stone dropped in still water; also markets rippling outward).
    ripple = Image.new("RGBA", size, (0, 0, 0, 0))
    rd = ImageDraw.Draw(ripple)
    for i, r in enumerate((s(184), s(232), s(282), s(334))):
        a = max(0, 44 - i * 9)
        rd.ellipse([cx - r, logo_cy - r, cx + r, logo_cy + r],
                   outline=(*_ZEN_RIPPLE, a), width=max(1, s(1)))
    img = Image.alpha_composite(img, ripple.filter(ImageFilter.GaussianBlur(s(0.6))))

    # The mark + its soft outer glow.
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    glow.paste(disc, (cx - d // 2, logo_cy - d // 2), disc)
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(s(15))))

    # Gold moon-ring hugging the disc (double stroke), then the crisp mark.
    ring = ImageDraw.Draw(img)
    rr = d // 2 + s(7)
    ring.ellipse([cx - rr, logo_cy - rr, cx + rr, logo_cy + rr],
                 outline=(*_GOLD_HI, 255), width=s(3))
    rr2 = rr + s(7)
    ring.ellipse([cx - rr2, logo_cy - rr2, cx + rr2, logo_cy + rr2],
                 outline=(*_ZEN_RIPPLE, 150), width=s(1))
    img.paste(disc, (cx - d // 2, logo_cy - d // 2), disc)

    # Brand kit — compass + wordmark, centered above the mark.
    mark = _compass(s(56))
    if mark is not None:
        img.alpha_composite(mark, (cx - s(28), s(40)))
    _shadow_center(img, cx, s(106), _WORDMARK,
                   _font("DejaVuSans-Bold.ttf", 23 * S), theme.wordmark, 7 * S)

    # Hero — the show name (eyebrow_label), metallic-gold serif, auto-fit.
    draw = ImageDraw.Draw(img)
    head = (eyebrow_label or "WORKSHOP WITH ZEN").strip(" -—·")
    hf, head = _fit_tracked(draw, head, "DejaVuSerif-Bold.ttf",
                            58 * S, 34 * S, s(_W - 180), 0)
    _gold_center(img, cx, s(466), head, hf)

    # His role, small gold tracked eyebrow beneath the hero.
    _shadow_center(img, cx, s(540), _ZEN_DESCRIPTOR,
                   _font("DejaVuSans-Bold.ttf", 18 * S), theme.eyebrow, 6 * S)

    # Date plaque — the Evening/plate pill idiom, on its own layer so the
    # translucent fill blends over the glow beneath it.
    df = _font("DejaVuSans-Bold.ttf", 29 * S)
    dt = date_text.upper()
    dw = _tracked_w(draw, dt, df, 3 * S)
    pill_cy = s(600)
    pill = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle(
        [cx - dw / 2 - s(22), pill_cy - s(26), cx + dw / 2 + s(22), pill_cy + s(26)],
        radius=s(26), fill=(0, 0, 0, 140), outline=(*_GOLD_HI, 255), width=s(2))
    img.alpha_composite(pill)
    _draw_tracked_center(ImageDraw.Draw(img), cx, pill_cy - s(16), dt, df, theme.date, 3 * S)

    # Tagline, foot.
    _shadow_center(img, cx, s(668), _TAGLINE,
                   _font("DejaVuSans.ttf", 20 * S), theme.tagline, 0)

    img = Image.alpha_composite(img, _vignette(0.5, size))
    out = img.convert("RGB").resize(_SIZE, Image.LANCZOS)
    return _grain(out, alpha=4.0, seed=7 + seed)


# ---------------------------------------------------------------------------
# Sunday (Sunday Scans) — pre-dawn horizon + scanner results strip, super-sampled
# ---------------------------------------------------------------------------

def _scan_tiles(size: tuple, x0: int, y0: int, x1: int, y1: int,
                n: int, seed: int, S: int) -> tuple:
    """Row of `n` mini sparkline tiles — the scanner's results strip. Returns
    `(layer, (hot_centre_x, hot_width))`; the caller alpha_composites the layer
    and aims the scan beam at the hot tile. Drawn on its own transparent layer
    because writing translucent ink DIRECTLY onto an RGBA image sets the pixel
    alpha instead of blending (it would come out solid gold after convert("RGB")).
    Seeded, so a given episode always renders the same strip."""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = random.Random(seed)
    gap = (x1 - x0) * 0.018
    tw = ((x1 - x0) - gap * (n - 1)) / n
    th = y1 - y0
    # Never the end tiles — a beam hard against the canvas edge reads as a light
    # leak rather than a deliberate scan.
    hot = rng.randrange(1, n - 1) if n >= 3 else 0
    boxes = []
    for i in range(n):
        tx = x0 + i * (tw + gap)
        bright = i == hot
        d.rounded_rectangle(
            [tx, y0, tx + tw, y1], radius=int(7 * S),
            fill=(*_GOLD, 34 if bright else 14),
            outline=(*_GOLD, 190 if bright else 92),
            width=max(1, int(1.6 * S)),
        )
        # Mini sparkline: mostly-constructive walks (this is a scan for setups),
        # every step bounded so a tile can never blow out of its own box.
        pts = []
        k = 9
        v = rng.uniform(0.25, 0.60)
        up = rng.random() < 0.72
        for j in range(k):
            v += rng.uniform(-0.15, 0.26 if up else 0.11)
            v = min(0.92, max(0.08, v))
            pts.append((tx + tw * 0.12 + tw * 0.76 * (j / (k - 1)),
                        y1 - th * 0.18 - th * 0.60 * v))
        col = (*_GOLD_HI, 255) if bright else (*_GOLD_HI, 205)
        d.line(pts, fill=col, width=max(1, int(2.4 * S)), joint="curve")
        r = 3.0 * S
        d.ellipse([pts[-1][0] - r, pts[-1][1] - r, pts[-1][0] + r, pts[-1][1] + r], fill=col)
        boxes.append((tx + tw / 2, tw))
    return img, boxes[hot]


def _render_sunday(theme: Theme, date_text: str, eyebrow_label: str, *,
                   seed: int = 7) -> Image.Image:
    """Sunday Scans: a pre-dawn indigo->amber horizon (the week hasn't opened
    yet) with a scanner results strip of mini sparkline tiles on the dark ground
    below, a soft scan beam picking one out. Rendered at 2x and downscaled
    (super-sampled). `seed` drives the strip + beam + grain, so every week's
    card differs but reproduces exactly."""
    S = 2
    size = (_W * S, _H * S)

    def s(v):
        return int(round(v * S))

    horizon = 0.722
    stops = [
        (0.00, (11, 15, 38)),
        (0.26, (34, 30, 68)),
        (0.50, (92, 56, 84)),
        (0.66, (176, 94, 72)),
        (horizon, (238, 158, 76)),           # first light, right at the horizon
        (horizon + 0.0008, (9, 8, 15)),      # hard cut to the dark ground
        (1.00, (4, 4, 8)),
    ]
    img = _sky_gradient(stops, size).convert("RGBA")
    cx = size[0] // 2
    hy = int(size[1] * horizon)

    # The rising sun: a tight core at the horizon plus a wide low wash.
    img = Image.alpha_composite(img, _radial(cx, hy, s(210), (255, 205, 130), 120, size))
    img = Image.alpha_composite(img, _radial(cx, hy, s(520), _GOLD, 66, size))

    # Horizon hairline (own layer — translucent ink must be composited, not
    # written straight onto the RGBA base).
    rule = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(rule).line(
        [(0, hy), (size[0], hy)], fill=(*_GOLD_HI, 120), width=max(1, int(1.4 * S)))
    img = Image.alpha_composite(img, rule)

    # Scanner results strip on the ground below the horizon.
    strip_top, strip_bot = s(556), s(648)
    tiles, (beam_cx, beam_w) = _scan_tiles(
        size, s(74), strip_top, s(_W - 74), strip_bot, 7, seed, S)
    img = Image.alpha_composite(img, tiles)

    # The scan beam: a soft vertical column of light over the tile it landed on.
    beam = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(beam).rectangle(
        [beam_cx - beam_w * 0.62, hy, beam_cx + beam_w * 0.62, size[1]],
        fill=(*_GOLD_HI, 46))
    img = Image.alpha_composite(img, beam.filter(ImageFilter.GaussianBlur(s(14))))

    # Darken the upper sky so the type block reads cleanly over it.
    img = Image.alpha_composite(img, _band_scrim(size, 0, s(360), 150, top_down=True))

    # Brand kit + type, centered in the upper sky.
    mark = _compass(s(78))
    if mark is not None:
        img.alpha_composite(mark, (cx - s(39), s(36)))
    _shadow_center(img, cx, s(126), _WORDMARK,
                   _font("DejaVuSans-Bold.ttf", 28 * S), theme.wordmark, 8 * S)

    draw = ImageDraw.Draw(img)
    eyebrow_text = f"— {eyebrow_label} —"
    eb_tracking = 5 * S
    eb_font, eyebrow_text = _fit_tracked(draw, eyebrow_text, "DejaVuSans-Bold.ttf",
                                         20 * S, 10 * S, s(_W - 120), eb_tracking)
    _shadow_center(img, cx, s(174), eyebrow_text, eb_font, theme.eyebrow, eb_tracking)

    date_up = date_text.upper()
    dt_font, date_up = _fit_tracked(draw, date_up, "DejaVuSerif-Bold.ttf",
                                    84 * S, 46 * S, s(_W - 160), 0)
    _gold_center(img, cx, s(214), date_up, dt_font)

    _shadow_center(img, cx, s(680), _TAGLINE,
                   _font("DejaVuSans.ttf", 20 * S), theme.tagline, 0)

    img = Image.alpha_composite(img, _vignette(0.5, size))
    out = img.convert("RGB").resize(_SIZE, Image.LANCZOS)
    return _grain(out, alpha=5.0, seed=7 + seed)


def render_session_thumbnail(
    date_text: str,
    eyebrow_label: str = "LIVE TRADING SESSION",
    *,
    variant: str | None = None,
) -> bytes:
    theme = _resolve_theme(variant, eyebrow_label)
    seed = _episode_seed(date_text, eyebrow_label)
    if theme.layout == "evening":
        img = _render_evening(theme, date_text, eyebrow_label, seed=seed)
    elif theme.layout == "editorial":
        img = _render_editorial(theme, date_text, eyebrow_label, seed=seed)
    elif theme.layout == "plate":
        img = _render_plate(theme, date_text, eyebrow_label)
    elif theme.layout == "zen":
        img = _render_zen(theme, date_text, eyebrow_label, seed=seed)
    elif theme.layout == "sunday":
        img = _render_sunday(theme, date_text, eyebrow_label, seed=seed)
    else:
        img = _render_classic(theme, date_text, eyebrow_label, seed=seed)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95, subsampling=0)
    return buf.getvalue()
