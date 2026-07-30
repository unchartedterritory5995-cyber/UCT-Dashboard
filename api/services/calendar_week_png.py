"""The week ahead — two shareable PNG cards for Discord.

`render_earnings_week_png` is the Mon–Fri earnings grid (five day columns, BMO
and AMC sections, ranked by market cap). `render_econ_week_png` is the matching
economic-events grid (five day columns, events in time order with forecast and
prior).

Both are DUMB renderers: selection, ranking and truncation are the caller's job,
so these make zero network calls and are trivially testable. Deterministic —
same inputs always produce the same bytes.

Shared brand chrome lives in `calendar_png_common`.
"""
from __future__ import annotations

import io

from PIL import ImageDraw

from api.services.calendar_png_common import (
    AMC, BMO, BOLD, DIM, FED, GOLD, INK, LINE, PANEL, REG,
    centered_message, draw_footer, draw_frame, draw_header, fmt_cap, font,
    gradient_bg, logo_tile, truncate,
)

W = 1600

MAX_PER_SESSION = 8      # names shown per BMO/AMC section, per day
MAX_ECON_PER_DAY = 8     # events shown per day

_MARGIN = 44
_GUTTER = 16
_COLS = 5
_COL_W = (W - _MARGIN * 2 - _GUTTER * (_COLS - 1)) // _COLS
_GRID_TOP = 200
_FOOTER_H = 60
_ROW_H = 36              # one ticker row
_EVENT_H = 74            # one economic-event block
_MIN_H = 470             # a thin week still reads as a card, not a letterbox


def _col_x(i: int) -> int:
    return _MARGIN + i * (_COL_W + _GUTTER)


def _day_header(img, dr, x: int, y: int, label: str, count: int | None) -> int:
    """Rounded day-header band. Returns the y below it."""
    dr.rounded_rectangle([x, y, x + _COL_W, y + 40], radius=10,
                         fill=PANEL + (255,), outline=LINE + (255,), width=1)
    lf = font(BOLD, 19)
    lw = dr.textlength(label, font=lf)
    dr.text((x + 14, y + 10), label, font=lf, fill=INK)
    if count is not None:
        cf = font(REG, 15)
        cw = dr.textlength(str(count), font=cf)
        dr.text((x + _COL_W - 14 - cw, y + 13), str(count), font=cf, fill=DIM)
    _ = lw
    return y + 40


def _section_label(dr, x: int, y: int, text: str, color) -> int:
    """Small session label with a hairline rule. Returns the y below it."""
    sf = font(BOLD, 13)
    dr.text((x + 2, y + 5), text, font=sf, fill=color)
    tw = dr.textlength(text, font=sf)
    dr.line([(x + 2 + tw + 10, y + 12), (x + _COL_W - 2, y + 12)],
            fill=LINE + (255,), width=1)
    return y + 24


def render_earnings_week_png(week_label: str, days: list[dict]) -> bytes:
    """days: exactly the weekdays to render, each
    {label: 'MON 3', total: int|None, bmo: [entry], amc: [entry], overflow: int}
    entry: {sym, mc_b (float|None), logo_path (str|None)}.
    Only the first MAX_PER_SESSION of each session are drawn — the caller is
    expected to have ranked them and computed `overflow` for everything else.
    """
    # Height follows the content: padding every week out to 8+8 rows left a
    # thin week (holiday shortened, or a quiet August) as a mostly-empty card.
    shown = days[:_COLS]
    n_bmo = min(MAX_PER_SESSION, max((len(d.get("bmo") or []) for d in shown), default=0))
    n_amc = min(MAX_PER_SESSION, max((len(d.get("amc") or []) for d in shown), default=0))
    has_overflow = any(int(d.get("overflow") or 0) > 0 for d in shown)
    h = (_GRID_TOP + 40                      # day header band
         + 10 + 24 + max(n_bmo, 1) * _ROW_H  # BEFORE OPEN
         + 10 + 24 + max(n_amc, 1) * _ROW_H  # AFTER CLOSE
         + (30 if has_overflow else 8)
         + _FOOTER_H)
    H = max(_MIN_H, h)

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

    row_h = _ROW_H
    logo_sz = 28

    for i, day in enumerate(shown):
        x = _col_x(i)
        y = _day_header(img, dr, x, _GRID_TOP, day.get("label", ""), day.get("total"))

        for key, color, label, slots in (("bmo", BMO, "BEFORE OPEN", n_bmo),
                                         ("amc", AMC, "AFTER CLOSE", n_amc)):
            entries = (day.get(key) or [])[:MAX_PER_SESSION]
            y += 10
            y = _section_label(dr, x, y, label, color)
            if not entries:
                dr.text((x + 6, y + 6), "—", font=font(REG, 15), fill=DIM)
                y += row_h * max(slots, 1)
                continue
            for e in entries:
                tile = logo_tile(e.get("sym", ""), logo_sz, e.get("logo_path"))
                img.paste(tile, (x + 4, y + (row_h - logo_sz) // 2), tile)
                sym = (e.get("sym") or "").upper()
                tf = font(BOLD, 16)
                dr.text((x + 4 + logo_sz + 10, y + 8), sym, font=tf, fill=INK)
                cap = fmt_cap(e.get("mc_b"))
                if cap:
                    cf = font(REG, 13)
                    cw = dr.textlength(cap, font=cf)
                    dr.text((x + _COL_W - 6 - cw, y + 11), cap, font=cf, fill=DIM)
                y += row_h
            # Pad an under-full section so every column's AFTER CLOSE block
            # starts on the same baseline.
            y += row_h * max(0, slots - len(entries))

        overflow = int(day.get("overflow") or 0)
        if overflow > 0:
            of = font(REG, 14)
            dr.text((x + 4, y + 6), f"+{overflow} more", font=of, fill=GOLD)

    draw_footer(img, dr, W, H)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def render_econ_week_png(week_label: str, days: list[dict]) -> bytes:
    """days: [{label: 'MON 3', events: [{time, event, estimate, prior, is_fed}]}].
    Events are drawn in the order given — the caller sorts by time."""
    # A normal week has 3-5 events on its busiest day, not 8 — a fixed height
    # left the card two-thirds empty. Size to the busiest column.
    shown = days[:_COLS]
    n_ev = min(MAX_ECON_PER_DAY, max((len(d.get("events") or []) for d in shown), default=0))
    has_overflow = any(len(d.get("events") or []) > MAX_ECON_PER_DAY for d in shown)
    H = max(_MIN_H,
            _GRID_TOP + 40 + 12 + max(n_ev, 1) * _EVENT_H
            + (28 if has_overflow else 8) + _FOOTER_H)

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

    for i, day in enumerate(shown):
        x = _col_x(i)
        events = (day.get("events") or [])[:MAX_ECON_PER_DAY]
        y = _day_header(img, dr, x, _GRID_TOP, day.get("label", ""),
                        len(day.get("events") or []) or None)
        y += 12

        if not events:
            dr.text((x + 6, y + 4), "—", font=font(REG, 15), fill=DIM)
            continue

        for ev in events:
            is_fed = bool(ev.get("is_fed"))
            accent = FED if is_fed else GOLD

            tf = font(BOLD, 13)
            time_s = ev.get("time") or ""
            dr.text((x + 4, y), time_s, font=tf, fill=accent)

            nf = font(BOLD, 15)
            title = truncate(dr, ev.get("event") or "", nf, _COL_W - 10)
            dr.text((x + 4, y + 20), title, font=nf, fill=INK)

            est, prior = ev.get("estimate"), ev.get("prior")
            bits = []
            if est not in (None, ""):
                bits.append(f"est {est}")
            if prior not in (None, ""):
                bits.append(f"prior {prior}")
            if bits:
                mf = font(REG, 13)
                dr.text((x + 4, y + 42), truncate(dr, "  ·  ".join(bits), mf, _COL_W - 10),
                        font=mf, fill=DIM)

            y += 74
            dr.line([(x + 2, y - 12), (x + _COL_W - 2, y - 12)],
                    fill=LINE + (120,), width=1)

        extra = len(day.get("events") or []) - len(events)
        if extra > 0:
            dr.text((x + 4, y), f"+{extra} more", font=font(REG, 14), fill=GOLD)

    draw_footer(img, dr, W, H)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()
