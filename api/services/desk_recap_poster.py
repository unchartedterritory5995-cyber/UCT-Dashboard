"""Render a branded 1080x1350 "session recap" poster from the AI summary.

Pure Pillow (no network), mirrors api/services/desk_thumbnail.py's brand language
(dark gradient, metallic gold, compass mark, DejaVu fonts bundled in desk_assets/).
A portrait card built for both the in-app recap panel and social sharing:

  compass + UNCHARTED TERRITORY · SESSION RECAP kicker
  → session title (serif gold) + date
  → headline (one line)
  → KEY TAKEAWAYS bullets
  → TICKERS COVERED pills
  → tagline footer
"""
from __future__ import annotations

import io
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

_W, _H = 1080, 1350
_SIZE = (_W, _H)
_ASSETS = os.path.join(os.path.dirname(__file__), "desk_assets")

_GOLD = (201, 168, 76)
_GOLD_HI = (252, 238, 186)
_INK = (236, 240, 246)
_DIM = (150, 160, 176)
_WORDMARK = "UNCHARTED TERRITORY"
_TAGLINE = "Navigate the market, effectively."


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(_ASSETS, name), int(size))


def _gradient_bg() -> Image.Image:
    top, bottom = (15, 19, 26), (5, 7, 11)
    img = Image.new("RGB", _SIZE)
    dr = ImageDraw.Draw(img)
    for y in range(_H):
        t = y / _H
        dr.line([(0, y), (_W, y)],
                fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def _compass(size: int):
    try:
        return Image.open(os.path.join(_ASSETS, "compass-mark.png")).convert("RGBA").resize(
            (int(size), int(size)), Image.LANCZOS)
    except Exception:
        return None


def _wrap(draw, text, font, max_w):
    words, lines, cur = (text or "").split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_recap_poster(*, title: str, date_text: str, headline: str = "",
                        summary: list[str] | None = None,
                        tickers: list[str] | None = None) -> bytes:
    summary = [s for s in (summary or []) if (s or "").strip()][:5]
    tickers = [t for t in (tickers or []) if (t or "").strip()][:8]

    img = _gradient_bg().convert("RGBA")

    # Big faint compass watermark, bottom-right.
    wm = _compass(560)
    if wm is not None:
        faded = wm.copy()
        faded.putalpha(faded.getchannel("A").point(lambda p: int(p * 0.06)))
        img.alpha_composite(faded, (_W - 420, _H - 430))

    # Gold glow behind the header mark.
    glow = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([_W // 2 - 120, 60, _W // 2 + 120, 300], fill=(*_GOLD, 55))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(60)))

    mark = _compass(96)
    if mark is not None:
        img.alpha_composite(mark, (_W // 2 - 48, 84))

    draw = ImageDraw.Draw(img)
    MX = 88                       # left/right margin
    cx = _W // 2

    def center(y, text, font, fill):
        draw.text((cx - draw.textlength(text, font=font) / 2, y), text, font=font, fill=fill)

    # Wordmark + kicker.
    center(200, _WORDMARK, _font("DejaVuSans-Bold.ttf", 26), _INK)
    center(238, "S E S S I O N   R E C A P", _font("DejaVuSans-Bold.ttf", 22), _GOLD)

    y = 300
    # Title (serif gold, wrapped, up to 3 lines, auto-fit).
    size_pt = 60
    while size_pt > 34:
        ft = _font("DejaVuSerif-Bold.ttf", size_pt)
        lines = _wrap(draw, title, ft, _W - 2 * MX)
        if len(lines) <= 3:
            break
        size_pt -= 3
    ft = _font("DejaVuSerif-Bold.ttf", size_pt)
    for ln in _wrap(draw, title, ft, _W - 2 * MX)[:3]:
        center(y, ln, ft, _GOLD_HI)
        y += int(size_pt * 1.22)

    center(y + 4, date_text.upper(), _font("DejaVuSans-Bold.ttf", 24), _DIM)
    y += 54
    draw.rectangle([cx - 60, y, cx + 60, y + 4], fill=_GOLD)
    y += 36

    # Headline (one or two wrapped lines).
    if headline:
        fh = _font("DejaVuSerif.ttf", 30)
        for ln in _wrap(draw, headline, fh, _W - 2 * MX)[:2]:
            center(y, ln, fh, _INK)
            y += 40
        y += 18

    # Key takeaways.
    if summary:
        draw.text((MX, y), "KEY TAKEAWAYS", font=_font("DejaVuSans-Bold.ttf", 22), fill=_GOLD)
        y += 44
        fb = _font("DejaVuSans.ttf", 26)
        for b in summary:
            draw.ellipse([MX + 4, y + 12, MX + 14, y + 22], fill=_GOLD)
            for i, ln in enumerate(_wrap(draw, b, fb, _W - 2 * MX - 38)[:3]):
                draw.text((MX + 34, y), ln, font=fb, fill=_INK)
                y += 36
            y += 10

    # Tickers covered (gold pills).
    if tickers:
        y += 8
        draw.text((MX, y), "TICKERS COVERED", font=_font("DejaVuSans-Bold.ttf", 22), fill=_GOLD)
        y += 44
        fp = _font("DejaVuSans-Bold.ttf", 24)
        px, py = MX, y
        for tk in tickers:
            w = draw.textlength(tk, font=fp)
            pw = w + 32
            if px + pw > _W - MX:
                px = MX
                py += 56
            draw.rounded_rectangle([px, py, px + pw, py + 44], radius=22,
                                   fill=(201, 168, 76, 28), outline=_GOLD, width=2)
            draw.text((px + 16, py + 8), tk, font=fp, fill=_GOLD_HI)
            px += pw + 12

    # Footer tagline.
    center(_H - 70, _TAGLINE, _font("DejaVuSerif.ttf", 26), _DIM)

    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


# ── Storage ──────────────────────────────────────────────────────────────────

def _dir() -> str:
    d = os.environ.get("DESK_RECAP_DIR", "/data/desk_recaps")
    os.makedirs(d, exist_ok=True)
    return d


def poster_path(video_id: int) -> str:
    return os.path.join(_dir(), f"{int(video_id)}.png")


def save_recap_poster(video_id: int, **kwargs) -> str:
    """Render + write the poster PNG for a video; returns its path."""
    path = poster_path(video_id)
    with open(path, "wb") as f:
        f.write(render_recap_poster(**kwargs))
    return path
