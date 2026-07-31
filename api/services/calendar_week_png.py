"""The week ahead — two shareable PNG cards for Discord.

These mirror the dashboard's own Calendar board, so the shared image and the
site read as one product: each weekday is a bordered panel, sessions carry a
labelled count, and companies are logo tiles with the ticker captioned beneath.
That is also the convention every weekly earnings screenshot already uses — the
logo is the identifier, not decoration — so nobody has to learn ours.

The economic card is its sibling, not a copy. Macro releases have no logos, so
the **time** is the identifier: set large in gold at the head of each row, with
the release beneath and a coloured rail marking what actually moves a tape
(marquee release vs. Fed speaker vs. ordinary print).

Both are DUMB renderers: selection, ranking and truncation are the caller's job,
so these make zero network calls and are trivially testable. Deterministic —
same inputs always produce the same bytes.
"""
from __future__ import annotations

import io

from PIL import ImageDraw

from api.services.calendar_png_common import (
    AMC, BMO, BOLD, DIM, FED, GOLD, INK, LINE, PANEL, REG, TBD,
    centered_message, draw_footer, draw_frame, draw_header, font,
    gradient_bg, logo_tile, truncate,
)

W = 1600

# 4 across matches the board's density — the tile stays large enough to read a
# mark at a glance while fitting a real day. 3 rows keeps the block square.
GRID_COLS = 4
GRID_ROWS = 3
MAX_PER_SESSION = GRID_COLS * GRID_ROWS
# Unconfirmed-session names get ONE row. They were invisible before — counted in
# `+N more` but never drawn — which hid 144 reporters in a single week and, on a
# light Friday, everything but 9 of 43. The board surfaces them the same way.
MAX_TBD = GRID_COLS
MAX_ECON_PER_DAY = 7

_MARGIN = 40
_GUTTER = 16
_COLS = 5
_PANEL_W = (W - _MARGIN * 2 - _GUTTER * (_COLS - 1)) // _COLS
_PAD = 13                       # panel inner padding
_GRID_TOP = 202
_FOOTER_H = 60
_MIN_H = 470

_TILE = 54
_CELL_W = (_PANEL_W - _PAD * 2) // GRID_COLS
_CELL_H = _TILE + 32            # tile + ticker caption (+ marquee ring outset)
_DAY_HEAD_H = 46
_SESSION_H = 30
_MORE_H = 34
_ECON_ROW_H = 76


def _panel_x(i: int) -> int:
    return _MARGIN + i * (_PANEL_W + _GUTTER)


def _draw_panel(dr, x: int, y: int, h: int) -> None:
    """The day container — the board renders each weekday as its own card."""
    dr.rounded_rectangle([x, y, x + _PANEL_W, y + h], radius=14,
                         fill=(22, 24, 32, 255), outline=LINE + (200,), width=1)


def _day_head(dr, x: int, y: int, label: str, count: int | None) -> int:
    """`MON 3` with the reporter count trailing, mirroring the board header."""
    parts = (label or "").split()
    day_s = parts[0] if parts else ""
    num_s = parts[1] if len(parts) > 1 else ""
    df = font(BOLD, 19)
    dr.text((x + _PAD, y + 14), day_s, font=df, fill=INK)
    if num_s:
        nx = x + _PAD + dr.textlength(day_s + " ", font=df)
        dr.text((nx, y + 15), num_s, font=font(REG, 18), fill=GOLD)
    if count:
        cf = font(REG, 14)
        cw = dr.textlength(str(count), font=cf)
        dr.text((x + _PANEL_W - _PAD - cw, y + 18), str(count), font=cf, fill=DIM)
    return y + _DAY_HEAD_H


def _session_head(dr, x: int, y: int, text: str, color, count: int) -> int:
    """Session marker + its own count, the way the board labels BMO / AMC."""
    cy = y + 12
    dr.ellipse([x + _PAD, cy - 3, x + _PAD + 6, cy + 3], fill=color + (255,))
    sf = font(BOLD, 12)
    tx = x + _PAD + 14
    dr.text((tx, y + 5), text, font=sf, fill=color)
    tw = dr.textlength(text, font=sf)

    if count:
        bf = font(BOLD, 11)
        bw = dr.textlength(str(count), font=bf)
        bx = tx + tw + 8
        dr.rounded_rectangle([bx, y + 3, bx + bw + 12, y + 21], radius=6,
                             fill=color + (30,), outline=color + (110,), width=1)
        dr.text((bx + 6, y + 6), str(count), font=bf, fill=color)
    return y + _SESSION_H


def _logo_cell(img, dr, x: int, y: int, entry: dict) -> None:
    sym = (entry.get("sym") or "").upper()
    marquee = bool(entry.get("marquee"))
    lx = x + (_CELL_W - _TILE) // 2
    tile = logo_tile(sym, _TILE, entry.get("logo_path"))
    img.paste(tile, (lx, y), tile)
    r = int(_TILE * 0.24)

    if marquee:
        # The week's heavyweights get a gold ring so the eye finds them without
        # reading every ticker. Drawn OUTSET so it never crops the mark, with a
        # faint second ring for glow.
        dr.rounded_rectangle([lx - 3, y - 3, lx + _TILE + 2, y + _TILE + 2],
                             radius=r + 3, outline=GOLD + (70,), width=1)
        dr.rounded_rectangle([lx - 2, y - 2, lx + _TILE + 1, y + _TILE + 1],
                             radius=r + 2, outline=GOLD + (255,), width=2)
    else:
        # Hairline keeps a white-background mark from bleeding into the panel.
        dr.rounded_rectangle([lx, y, lx + _TILE - 1, y + _TILE - 1],
                             radius=r, outline=(255, 255, 255, 26), width=1)

    tf = font(BOLD, 12)
    label = truncate(dr, sym, tf, _CELL_W - 2)
    tw = dr.textlength(label, font=tf)
    dr.text((x + (_CELL_W - tw) / 2, y + _TILE + 7), label, font=tf,
            fill=GOLD if marquee else INK)


def _more_box(dr, x: int, y: int, n: int) -> None:
    """The board's own overflow control — a full-width box, not bare text."""
    dr.rounded_rectangle([x + _PAD, y, x + _PANEL_W - _PAD, y + 26], radius=8,
                         fill=(255, 255, 255, 8), outline=LINE + (190,), width=1)
    t = f"+{n} more"
    tf = font(REG, 13)
    tw = dr.textlength(t, font=tf)
    dr.text((x + (_PANEL_W - tw) / 2, y + 5), t, font=tf, fill=DIM)


def render_earnings_week_png(week_label: str, days: list[dict]) -> bytes:
    """days: the weekdays to render, each
    {label: 'MON 3', total: int|None, bmo: [entry], amc: [entry], overflow: int}
    entry: {sym, mc_b (float|None), logo_path (str|None)}.
    Only the first MAX_PER_SESSION of each session are drawn — the caller ranks
    them and computes `overflow` for the rest.
    """
    shown = days[:_COLS]

    def _rows(key: str) -> int:
        n = max((min(len(d.get(key) or []), MAX_PER_SESSION) for d in shown), default=0)
        return max((n + GRID_COLS - 1) // GRID_COLS, 1)
    r_bmo, r_amc = _rows("bmo"), _rows("amc")
    has_tbd = any(d.get("tbd") for d in shown)
    has_more = any(int(d.get("overflow") or 0) > 0 for d in shown)

    panel_h = (_DAY_HEAD_H
               + _SESSION_H + r_bmo * _CELL_H
               + 8 + _SESSION_H + r_amc * _CELL_H
               + (8 + _SESSION_H + _CELL_H if has_tbd else 0)
               + (_MORE_H if has_more else 0) + 10)
    H = max(_MIN_H, _GRID_TOP + panel_h + _FOOTER_H)

    img = gradient_bg(W, H)
    dr = ImageDraw.Draw(img, "RGBA")
    draw_frame(dr, W, H)
    draw_header(img, dr, W, "THE WEEK AHEAD — EARNINGS", week_label)

    if not any((d.get("bmo") or d.get("amc") or d.get("tbd")) for d in shown):
        centered_message(dr, W, H, "No scheduled reporters for this week.")
        draw_footer(img, dr, W, H)
        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()

    for i, day in enumerate(shown):
        x = _panel_x(i)
        _draw_panel(dr, x, _GRID_TOP, panel_h)
        y = _day_head(dr, x, _GRID_TOP, day.get("label", ""), day.get("total"))

        for key, color, label, rows in (("bmo", BMO, "BMO", r_bmo),
                                        ("amc", AMC, "AMC", r_amc)):
            entries = (day.get(key) or [])[:MAX_PER_SESSION]
            if key == "amc":
                y += 8
            # Badge the TRUE reporter count, not the length of the filtered
            # draw list, so header total = session badges + `+N more`.
            n_true = day.get(f"{key}_n")
            if n_true is None:
                n_true = len(day.get(key) or [])
            y = _session_head(dr, x, y, label, color, n_true)
            if not entries:
                dr.text((x + _PAD, y + 4), "—", font=font(REG, 15), fill=DIM)
            for idx, e in enumerate(entries):
                cx = x + _PAD + (idx % GRID_COLS) * _CELL_W
                cy = y + (idx // GRID_COLS) * _CELL_H
                _logo_cell(img, dr, cx, cy, e)
            y += rows * _CELL_H

        if has_tbd:
            tbd = (day.get("tbd") or [])[:MAX_TBD]
            y += 8
            n_tbd = day.get("tbd_n")
            if n_tbd is None:
                n_tbd = len(day.get("tbd") or [])
            y = _session_head(dr, x, y, "TIME TBD", TBD, n_tbd)
            if not tbd:
                dr.text((x + _PAD, y + 4), "—", font=font(REG, 15), fill=DIM)
            for idx, e in enumerate(tbd):
                _logo_cell(img, dr, x + _PAD + idx * _CELL_W, y, e)
            y += _CELL_H

        overflow = int(day.get("overflow") or 0)
        if overflow > 0:
            _more_box(dr, x, y, overflow)

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
    has_more = any(len(d.get("events") or []) > MAX_ECON_PER_DAY for d in shown)

    panel_h = (_DAY_HEAD_H + 6 + max(n_ev, 1) * _ECON_ROW_H
               + (_MORE_H if has_more else 0) + 8)
    H = max(_MIN_H, _GRID_TOP + panel_h + _FOOTER_H)

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
        x = _panel_x(i)
        _draw_panel(dr, x, _GRID_TOP, panel_h)
        events = (day.get("events") or [])[:MAX_ECON_PER_DAY]
        y = _day_head(dr, x, _GRID_TOP, day.get("label", ""),
                      len(day.get("events") or []) or None)
        y += 6

        if not events:
            dr.text((x + _PAD, y + 4), "—", font=font(REG, 15), fill=DIM)
            continue

        for n, ev in enumerate(events):
            is_fed = bool(ev.get("is_fed"))
            is_key = bool(ev.get("is_key"))
            hot = is_fed or is_key
            accent = FED if is_fed else GOLD if is_key else DIM

            # Left rail marks what moves a tape; an ordinary print stays quiet.
            dr.rounded_rectangle([x + _PAD, y + 2, x + _PAD + 3, y + _ECON_ROW_H - 20],
                                 radius=2, fill=accent + (255 if hot else 80,))
            tx = x + _PAD + 13

            # TIME is the identifier for a macro release, so it leads.
            dr.text((tx, y), ev.get("time") or "", font=font(BOLD, 16),
                    fill=accent if hot else INK)

            nf = font(BOLD, 14) if hot else font(REG, 14)
            dr.text((tx, y + 24),
                    truncate(dr, ev.get("event") or "", nf, _PANEL_W - _PAD - 20),
                    font=nf, fill=INK if hot else DIM)

            est, prior = ev.get("estimate"), ev.get("prior")
            bits = []
            if est not in (None, ""):
                bits.append(f"est {est}")
            if prior not in (None, ""):
                bits.append(f"prior {prior}")
            if bits:
                mf = font(REG, 12)
                dr.text((tx, y + 44),
                        truncate(dr, "   ".join(bits), mf, _PANEL_W - _PAD - 20),
                        font=mf, fill=DIM)

            y += _ECON_ROW_H
            if n < len(events) - 1:
                dr.line([(x + _PAD, y - 14), (x + _PANEL_W - _PAD, y - 14)],
                        fill=LINE + (110,), width=1)

        extra = len(day.get("events") or []) - len(events)
        if extra > 0:
            _more_box(dr, x, y - 8, extra)

    draw_footer(img, dr, W, H)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()
