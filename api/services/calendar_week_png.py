"""The week ahead — two shareable PNG cards for Discord.

The earnings card follows the convention every trader already reads without a
legend: **the logo is the identifier**, the ticker is its caption, and the week
is five day columns split into before-open and after-close. Earnings Whispers,
Earnings Hub and every screenshot that circulates on fintwit share that shape;
matching it means nobody has to learn ours. The UCT layer is the dark ground and
gold rules — brand logos are full-colour on light plates, so they carry the
colour and the chrome stays quiet.

The economic card is its sibling, not a copy. Macro releases have no logos, so
the **time** is the identifier: set large in gold at the head of each row, with
the release name beneath and a coloured rail marking what actually moves a tape
(marquee release vs. Fed speaker vs. ordinary print).

Both are DUMB renderers: selection, ranking and truncation are the caller's job,
so these make zero network calls and are trivially testable. Deterministic —
same inputs always produce the same bytes.
"""
from __future__ import annotations

import io

from PIL import Image, ImageDraw

from api.services.calendar_png_common import (
    AMC, BMO, BOLD, DIM, FED, GOLD, INK, LINE, PANEL, REG,
    centered_message, draw_footer, draw_frame, draw_header, font,
    gradient_bg, logo_tile, truncate,
)

W = 1600

# 3×3 per session: the grid reads as a block at a glance, and a ragged last row
# would break the column rhythm that makes the card scannable.
GRID_COLS = 3
GRID_ROWS = 3
MAX_PER_SESSION = GRID_COLS * GRID_ROWS
MAX_ECON_PER_DAY = 7

_MARGIN = 44
_GUTTER = 22
_COLS = 5
_COL_W = (W - _MARGIN * 2 - _GUTTER * (_COLS - 1)) // _COLS
_GRID_TOP = 206
_FOOTER_H = 62
_MIN_H = 470

# Logo cell geometry
_LOGO = 62
_CELL_W = _COL_W // GRID_COLS
_CELL_H = _LOGO + 24          # logo + ticker caption
_SESSION_LABEL_H = 30
_ECON_ROW_H = 78


def _col_x(i: int) -> int:
    return _MARGIN + i * (_COL_W + _GUTTER)


def _day_header(img, dr, x: int, y: int, label: str, count: int | None) -> int:
    """Day band: weekday + date on the left, reporter count on the right."""
    dr.rounded_rectangle([x, y, x + _COL_W, y + 42], radius=10,
                         fill=PANEL + (255,), outline=LINE + (255,), width=1)
    parts = (label or "").split()
    day_s = parts[0] if parts else ""
    num_s = parts[1] if len(parts) > 1 else ""

    df = font(BOLD, 20)
    dr.text((x + 14, y + 11), day_s, font=df, fill=INK)
    if num_s:
        nx = x + 14 + dr.textlength(day_s + " ", font=df)
        dr.text((nx, y + 12), num_s, font=font(REG, 19), fill=GOLD)
    if count:
        cf = font(REG, 14)
        cw = dr.textlength(str(count), font=cf)
        dr.text((x + _COL_W - 14 - cw, y + 15), str(count), font=cf, fill=DIM)
    return y + 42


def _session_label(dr, x: int, y: int, text: str, color) -> int:
    """A session marker: colour dot, label, then a rule to the column edge."""
    cy = y + 11
    dr.ellipse([x + 3, cy - 3, x + 9, cy + 3], fill=color + (255,))
    sf = font(BOLD, 12)
    dr.text((x + 17, y + 4), text, font=sf, fill=color)
    tw = dr.textlength(text, font=sf)
    rule_x = x + 17 + tw + 10
    if rule_x < x + _COL_W - 2:
        dr.line([(rule_x, cy), (x + _COL_W - 2, cy)], fill=LINE + (200,), width=1)
    return y + _SESSION_LABEL_H


def _logo_cell(img, dr, x: int, y: int, entry: dict) -> None:
    """One company: logo plate with its ticker captioned underneath."""
    sym = (entry.get("sym") or "").upper()
    lx = x + (_CELL_W - _LOGO) // 2
    tile = logo_tile(sym, _LOGO, entry.get("logo_path"))
    img.paste(tile, (lx, y), tile)

    tf = font(BOLD, 13)
    label = truncate(dr, sym, tf, _CELL_W - 4)
    tw = dr.textlength(label, font=tf)
    dr.text((x + (_CELL_W - tw) / 2, y + _LOGO + 6), label, font=tf, fill=INK)


def render_earnings_week_png(week_label: str, days: list[dict]) -> bytes:
    """days: the weekdays to render, each
    {label: 'MON 3', total: int|None, bmo: [entry], amc: [entry], overflow: int}
    entry: {sym, mc_b (float|None), logo_path (str|None)}.
    Only the first MAX_PER_SESSION of each session are drawn — the caller ranks
    them and computes `overflow` for the rest.
    """
    shown = days[:_COLS]

    # Height follows content: a quiet week shouldn't render as an empty canvas.
    def _rows(key: str) -> int:
        n = max((min(len(d.get(key) or []), MAX_PER_SESSION) for d in shown), default=0)
        return (n + GRID_COLS - 1) // GRID_COLS
    r_bmo, r_amc = max(_rows("bmo"), 1), max(_rows("amc"), 1)
    has_overflow = any(int(d.get("overflow") or 0) > 0 for d in shown)
    H = max(_MIN_H,
            _GRID_TOP + 42
            + 14 + _SESSION_LABEL_H + r_bmo * _CELL_H
            + 16 + _SESSION_LABEL_H + r_amc * _CELL_H
            + (32 if has_overflow else 10) + _FOOTER_H)

    img = gradient_bg(W, H)
    dr = ImageDraw.Draw(img, "RGBA")
    draw_frame(dr, W, H)
    draw_header(img, dr, W, "THE WEEK AHEAD — EARNINGS", week_label)

    if not any((d.get("bmo") or d.get("amc")) for d in shown):
        centered_message(dr, W, H, "No scheduled reporters for this week.")
        draw_footer(img, dr, W, H)
        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()

    # Hairline rules between day columns — the card IS a calendar, so let the
    # days read as columns rather than as five floating lists.
    for i in range(1, min(len(shown), _COLS)):
        rx = _col_x(i) - _GUTTER // 2
        dr.line([(rx, _GRID_TOP + 8), (rx, H - _FOOTER_H - 6)],
                fill=LINE + (110,), width=1)

    for i, day in enumerate(shown):
        x = _col_x(i)
        y = _day_header(img, dr, x, _GRID_TOP, day.get("label", ""), day.get("total"))

        for key, color, label, rows in (("bmo", BMO, "BEFORE OPEN", r_bmo),
                                        ("amc", AMC, "AFTER CLOSE", r_amc)):
            entries = (day.get(key) or [])[:MAX_PER_SESSION]
            y += 14 if key == "bmo" else 16
            y = _session_label(dr, x, y, label, color)
            if not entries:
                dr.text((x + 4, y + 4), "—", font=font(REG, 16), fill=DIM)
            for idx, e in enumerate(entries):
                cx = x + (idx % GRID_COLS) * _CELL_W
                cy = y + (idx // GRID_COLS) * _CELL_H
                _logo_cell(img, dr, cx, cy, e)
            y += rows * _CELL_H

        overflow = int(day.get("overflow") or 0)
        if overflow > 0:
            dr.text((x + 4, y + 8), f"+{overflow} more", font=font(REG, 14), fill=GOLD)

    draw_footer(img, dr, W, H)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def render_econ_week_png(week_label: str, days: list[dict]) -> bytes:
    """days: [{label: 'MON 3', events: [{time, event, estimate, prior, is_fed,
    is_key}]}]. Events are drawn in the order given — the caller sorts by time.
    """
    shown = days[:_COLS]
    n_ev = max((min(len(d.get("events") or []), MAX_ECON_PER_DAY) for d in shown),
               default=0)
    has_overflow = any(len(d.get("events") or []) > MAX_ECON_PER_DAY for d in shown)
    H = max(_MIN_H,
            _GRID_TOP + 42 + 16 + max(n_ev, 1) * _ECON_ROW_H
            + (30 if has_overflow else 10) + _FOOTER_H)

    img = gradient_bg(W, H)
    dr = ImageDraw.Draw(img, "RGBA")
    draw_frame(dr, W, H)
    draw_header(img, dr, W, "THE WEEK AHEAD — ECONOMIC EVENTS", week_label)

    if not any(d.get("events") for d in shown):
        centered_message(dr, W, H, "No major economic events scheduled this week.")
        draw_footer(img, dr, W, H)
        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()

    for i in range(1, min(len(shown), _COLS)):
        rx = _col_x(i) - _GUTTER // 2
        dr.line([(rx, _GRID_TOP + 8), (rx, H - _FOOTER_H - 6)],
                fill=LINE + (110,), width=1)

    for i, day in enumerate(shown):
        x = _col_x(i)
        events = (day.get("events") or [])[:MAX_ECON_PER_DAY]
        y = _day_header(img, dr, x, _GRID_TOP, day.get("label", ""),
                        len(day.get("events") or []) or None)
        y += 16

        if not events:
            dr.text((x + 4, y + 4), "—", font=font(REG, 16), fill=DIM)
            continue

        for ev in events:
            is_fed = bool(ev.get("is_fed"))
            is_key = bool(ev.get("is_key"))
            accent = FED if is_fed else GOLD if is_key else DIM

            # Left rail marks what moves a tape: a marquee print and a Fed
            # speaker get a solid accent, an ordinary release stays quiet.
            rail_a = 255 if (is_fed or is_key) else 90
            dr.rounded_rectangle([x, y + 2, x + 3, y + _ECON_ROW_H - 16],
                                 radius=2, fill=accent + (rail_a,))

            # TIME is the identifier for a macro release, so it leads.
            dr.text((x + 14, y), ev.get("time") or "", font=font(BOLD, 17),
                    fill=accent if (is_fed or is_key) else INK)

            nf = font(BOLD, 14) if (is_fed or is_key) else font(REG, 14)
            dr.text((x + 14, y + 25),
                    truncate(dr, ev.get("event") or "", nf, _COL_W - 20),
                    font=nf, fill=INK if (is_fed or is_key) else DIM)

            est, prior = ev.get("estimate"), ev.get("prior")
            bits = []
            if est not in (None, ""):
                bits.append(f"est {est}")
            if prior not in (None, ""):
                bits.append(f"prior {prior}")
            if bits:
                mf = font(REG, 13)
                dr.text((x + 14, y + 45),
                        truncate(dr, "   ".join(bits), mf, _COL_W - 20),
                        font=mf, fill=DIM)

            y += _ECON_ROW_H
            dr.line([(x, y - 14), (x + _COL_W - 6, y - 14)],
                    fill=LINE + (90,), width=1)

        extra = len(day.get("events") or []) - len(events)
        if extra > 0:
            dr.text((x + 14, y - 2), f"+{extra} more", font=font(REG, 14), fill=GOLD)

    draw_footer(img, dr, W, H)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()
