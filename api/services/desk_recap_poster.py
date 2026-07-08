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


def _wrap_clip(draw, text, font, max_w, max_lines):
    """Wrap to at most max_lines. When the text doesn't fit, the LAST kept line
    is ellipsized at a word boundary — never a bare mid-word cut (the old hard
    [:n] slice shipped posters ending "…what was said abou")."""
    lines = _wrap(draw, text, font, max_w)
    if len(lines) <= max_lines:
        return lines
    kept, last = lines[:max_lines], lines[max_lines - 1]
    while last and draw.textlength(last + "…", font=font) > max_w:
        cut = last.rsplit(" ", 1)
        if len(cut) == 1:          # single over-wide word — hard-trim chars
            last = last[:-1]
        else:
            last = cut[0]
    kept[-1] = (last.rstrip(" ,;:—-") + "…") if last else "…"
    return kept


def _pill_rows(draw, labels, font, max_w, gap=12, pad=32):
    """Number of rows the ticker pills will flow into (mirrors the draw loop —
    keep the two in sync) so the layout can RESERVE that height up front."""
    rows, px = 1, 0
    for tk in labels:
        pw = draw.textlength(tk, font=font) + pad
        if px and px + pw > max_w:
            rows += 1
            px = 0
        px += pw + gap
    return rows


def _fit_takeaways(draw, summary, max_w, avail_h):
    """Pick a bullet rendering (font size / line height / per-bullet line cap /
    bullet count) that fits avail_h. Preference order: keep every bullet's FULL
    text (shrink font before clipping), then drop trailing bullets, then clip
    to 2 lines as the floor — the poster must never overflow the canvas."""
    def _measure(bullets, fsize, line_h, max_lines):
        f = _font("DejaVuSans.ttf", fsize)
        wrapped = [_wrap_clip(draw, b, f, max_w, max_lines) for b in bullets]
        h = sum(len(w) * line_h + 10 for w in wrapped)
        return wrapped, f, h

    for fsize, line_h, max_lines in ((26, 36, 3), (24, 32, 3)):
        wrapped, f, h = _measure(summary, fsize, line_h, max_lines)
        if h <= avail_h:
            return f, line_h, wrapped
    for keep in range(len(summary) - 1, 2, -1):
        wrapped, f, h = _measure(summary[:keep], 24, 32, 3)
        if h <= avail_h:
            return f, 32, wrapped
    for keep in range(len(summary), 2, -1):
        wrapped, f, h = _measure(summary[:keep], 24, 32, 2)
        if h <= avail_h:
            return f, 32, wrapped
    wrapped, f, _ = _measure(summary[:3], 24, 32, 2)
    return f, 32, wrapped


def render_recap_poster(*, title: str, date_text: str, headline: str = "",
                        summary: list[str] | None = None,
                        tickers: list[str] | None = None) -> bytes:
    summary = [s for s in (summary or []) if (s or "").strip()][:5]
    # De-dup (defensive — revisited tickers repeat upstream), show 8 + a "+N"
    # overflow pill so the poster admits what it isn't showing.
    uniq = list(dict.fromkeys(t.strip() for t in (tickers or []) if (t or "").strip()))
    tickers = uniq[:8] + ([f"+{len(uniq) - 8}"] if len(uniq) > 8 else [])
    # Session titles end with the date ("… — July 7, 2026") and the card has its
    # own date line right under the title — drop the duplicate tail.
    title, dt = (title or "").strip(), (date_text or "").strip()
    if dt and title.endswith(dt):
        title = title[: -len(dt)].rstrip(" —–-").strip() or dt

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

    # Everything below is drawn against a hard vertical budget: content may
    # never cross FLOOR (the footer's clearance line). The old fixed layout
    # let long summaries push the ticker pills off the bottom edge.
    FLOOR = _H - 116

    y = 300
    # Title (serif gold, wrapped, up to 3 lines, auto-fit, ellipsized).
    size_pt = 60
    while size_pt > 34:
        ft = _font("DejaVuSerif-Bold.ttf", size_pt)
        lines = _wrap(draw, title, ft, _W - 2 * MX)
        if len(lines) <= 3:
            break
        size_pt -= 3
    ft = _font("DejaVuSerif-Bold.ttf", size_pt)
    for ln in _wrap_clip(draw, title, ft, _W - 2 * MX, 3):
        center(y, ln, ft, _GOLD_HI)
        y += int(size_pt * 1.22)

    center(y + 4, date_text.upper(), _font("DejaVuSans-Bold.ttf", 24), _DIM)
    y += 54
    draw.rectangle([cx - 60, y, cx + 60, y + 4], fill=_GOLD)
    y += 36

    # Headline (up to two wrapped lines, ellipsized).
    if headline:
        fh = _font("DejaVuSerif.ttf", 30)
        for ln in _wrap_clip(draw, headline, fh, _W - 2 * MX, 2):
            center(y, ln, fh, _INK)
            y += 40
        y += 18

    # Reserve the ticker block's height BEFORE laying out takeaways, so the
    # pills always land fully on the canvas.
    fp = _font("DejaVuSans-Bold.ttf", 24)
    tickers_h = 0
    if tickers:
        rows = _pill_rows(draw, tickers, fp, _W - 2 * MX)
        tickers_h = 8 + 44 + (rows - 1) * 56 + 44   # lead + label + rows

    # Key takeaways — fitted to the remaining space.
    if summary:
        draw.text((MX, y), "KEY TAKEAWAYS", font=_font("DejaVuSans-Bold.ttf", 22), fill=_GOLD)
        y += 44
        avail = FLOOR - y - tickers_h
        fb, line_h, wrapped = _fit_takeaways(draw, summary, _W - 2 * MX - 38, avail)
        for lines in wrapped:
            draw.ellipse([MX + 4, y + 12, MX + 14, y + 22], fill=_GOLD)
            for ln in lines:
                draw.text((MX + 34, y), ln, font=fb, fill=_INK)
                y += line_h
            y += 10

    # Tickers covered (gold pills).
    if tickers:
        y += 8
        draw.text((MX, y), "TICKERS COVERED", font=_font("DejaVuSans-Bold.ttf", 22), fill=_GOLD)
        y += 44
        px, py = MX, y
        for tk in tickers:
            w = draw.textlength(tk, font=fp)
            pw = w + 32
            if px > MX and px + pw > _W - MX:
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
