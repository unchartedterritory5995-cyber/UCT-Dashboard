"""Shared chrome for the branded calendar PNG cards.

Extracted from `calendar_anticipated_png.py` so the Most-Anticipated card and the
weekly earnings / economic-events cards are visually ONE family and the brand
lives in exactly one place.

Everything here is deterministic and makes ZERO network calls — logos come from
the on-disk cache, and a miss falls back to a gold-ringed monogram. Same inputs
always produce the same pixels.
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join(os.path.dirname(__file__), "desk_assets")

# Brand palette (mirrors the calendar dark theme + gold accent)
BG_TOP = (20, 22, 30)
BG_BOT = (9, 10, 14)
GOLD = (201, 168, 76)
INK = (233, 235, 240)
DIM = (150, 156, 168)
PANEL = (28, 31, 40)
LINE = (52, 56, 68)
BMO = (201, 168, 76)     # gold — before open
AMC = (110, 150, 220)    # blue — after close
TBD = (140, 146, 158)    # grey — session unconfirmed
FED = (196, 124, 220)    # violet — Fed speaker, distinct from a data release

BOLD = "DejaVuSans-Bold.ttf"
REG = "DejaVuSans.ttf"

TAGLINE = "Navigate the market, effectively."
SITE = "uctintelligence.com"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(ASSETS, name), int(size))


def gradient_bg(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h))
    dr = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        dr.line([(0, y), (w, y)], fill=c)
    return img


def compass(size: int):
    try:
        mark = Image.open(os.path.join(ASSETS, "compass-mark.png")).convert("RGBA")
        return mark.resize((int(size), int(size)), Image.LANCZOS)
    except Exception:
        return None


def round_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def _has_own_background(logo: Image.Image) -> bool:
    """True when the artwork already carries its own opaque background.

    84 of 93 cached logos do (white, brand colour, or black) — logo.dev and
    friends ship square, pre-composited marks. Those must render EDGE-TO-EDGE:
    forcing Honeywell's red or Coca-Cola's white onto another white plate throws
    away the colour that makes the tile identifiable at 54px. The transparent
    minority (Apple's black glyph, etc.) still needs a light plate, or a dark
    mark would vanish against the dark card.
    """
    try:
        return logo.getchannel("A").getextrema()[0] > 250
    except (ValueError, OSError):
        return False


def logo_tile(sym: str, size: int, logo_path: str | None) -> Image.Image:
    """A rounded logo tile; gold-ringed monogram when the logo is a miss."""
    radius = int(size * 0.24)
    if logo_path and os.path.exists(logo_path):
        try:
            logo = Image.open(logo_path).convert("RGBA")
            if _has_own_background(logo):
                # Cover-fit so the mark's own background fills the tile.
                scale = size / min(logo.width, logo.height)
                new = (max(size, int(round(logo.width * scale))),
                       max(size, int(round(logo.height * scale))))
                logo = logo.resize(new, Image.LANCZOS)
                left = (logo.width - size) // 2
                top = (logo.height - size) // 2
                plate = logo.crop((left, top, left + size, top + size))
            else:
                # Contain on a light plate — a transparent dark glyph needs it.
                plate = Image.new("RGBA", (size, size), (245, 246, 248, 255))
                pad = int(size * 0.14)
                inner = size - pad * 2
                logo.thumbnail((inner, inner), Image.LANCZOS)
                plate.paste(logo, ((size - logo.width) // 2,
                                   (size - logo.height) // 2), logo)
            plate.putalpha(round_mask(size, radius))
            return plate
        except Exception:
            pass
    # Monogram fallback
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dr = ImageDraw.Draw(tile)
    dr.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius,
                         fill=(38, 41, 52, 255), outline=GOLD + (255,), width=2)
    letter = (sym or "?")[:1].upper()
    f = font(BOLD, int(size * 0.5))
    w = dr.textlength(letter, font=f)
    bb = dr.textbbox((0, 0), letter, font=f)
    dr.text(((size - w) / 2, (size - (bb[3] - bb[1])) / 2 - bb[1]), letter,
            font=f, fill=GOLD + (255,))
    return tile


def fmt_cap(mc_b) -> str | None:
    if mc_b is None or mc_b <= 0:
        return None
    if mc_b >= 1000:
        return f"${mc_b / 1000:.1f}T"
    if mc_b >= 1:
        return f"${round(mc_b)}B"
    return f"${round(mc_b * 1000)}M"


def truncate(draw, text, font_, max_w) -> str:
    if draw.textlength(text, font=font_) <= max_w:
        return text
    t = text
    while t and draw.textlength(t + "…", font=font_) > max_w:
        t = t[:-1]
    return (t + "…") if t else ""


def draw_header(img, dr, w: int, title: str, subtitle: str) -> None:
    """Compass + wordmark, gold title, dim subtitle — identical across cards."""
    mark = compass(40)
    if mark is not None:
        img.paste(mark, (44, 40), mark)
    dr.text((94, 46), "UCT INTELLIGENCE", font=font(BOLD, 19), fill=INK)
    dr.text((44, 92), title, font=font(BOLD, 40), fill=GOLD)
    dr.text((46, 144), subtitle, font=font(REG, 22), fill=DIM)


def draw_footer(img, dr, w: int, h: int) -> None:
    dr.text((44, h - 40), SITE, font=font(BOLD, 15), fill=GOLD)
    ff = font(REG, 15)
    tw = dr.textlength(TAGLINE, font=ff)
    dr.text((w - 44 - tw, h - 40), TAGLINE, font=ff, fill=DIM)


def draw_frame(dr, w: int, h: int) -> None:
    dr.rectangle([12, 12, w - 13, h - 13], outline=GOLD + (90,), width=1)


def centered_message(dr, w: int, h: int, msg: str) -> None:
    mf = font(REG, 24)
    mw = dr.textlength(msg, font=mf)
    dr.text(((w - mw) / 2, h / 2 - 20), msg, font=mf, fill=DIM)
