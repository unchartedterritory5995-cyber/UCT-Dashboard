"""Tier 2 part A, item 9: what `/plan TICKER` adds to a Trade plan note, in the create's ONE insert.

THREE things, each optional, none invented (R-T2A-1..3):
  * the member's OWN entry / stop / target for the ticker, from their newest live, non-sample note
    about it that names any -- read by plan_extract, the ONE reader of plan levels -- drawn on the
    chart (plan lines) and set as the sizing block's entry and stop;
  * a dated price line, read once inside the create's read budget (a slow or failed read leaves
    it out, never a zero);
  * a line saying where the levels came from, linking that note.
Automatic levels are deliberately NOT served anywhere (grade_ticker Seam 28); this never computes one.

The member's style is honoured as it is (R-T2A-3): a style with no chart and no sizing block has
nowhere to put a level, so nothing is placed and no source line is written.
"""
from __future__ import annotations

import copy
import math
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from api.services.journal_two import journal_styles as _js
from api.services.journal_two import plan_extract, sample_marker
from api.services.journal_two import trader_blocks as _tb

PLAN_KIND = "trade_plan"
#: Newest notes about the ticker read, at most, looking for one that names a level.
SOURCE_SCAN = 20
_ET = ZoneInfo("America/New_York")
#: The three PRICE roles. ⛔ Not plan_extract's `names_any_level`: that also counts `shares`, so a note
#: naming only a share count would end the scan with nothing to copy (V6b).
_ROLES = ("entry", "stop", "target")
#: The only two source words price_stamp_quote writes (trader_blocks._index_field), and plain English.
#: Anything else (a vendor's own label) is never printed to a member.
_SOURCE_WORDS = frozenset({"live price", "last close"})


def _property_defs(user_id: str, conn) -> list[dict]:
    """The member's property definitions, so a level kept as a property ("Stop", "Entry") is read.
    Loaded once per member_levels call. An unreadable store reads as no definitions."""
    from api.services.journal_two import note_properties
    try:
        return note_properties.list_property_defs(user_id, conn=conn)
    except Exception:  # noqa: BLE001 -- property levels are skipped, the text and chart levels still read
        return []


def member_levels(user_id: str, symbol: str, conn) -> dict | None:
    """The newest live, non-sample note about `symbol` that names an entry, stop or target, as
    `{"noteId", "title", "levels": {role: price}}`, or None. Scans at most SOURCE_SCAN notes."""
    rows = conn.execute(
        "SELECT id, title, body_json, properties_json FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
        " AND ticker IS NOT NULL AND ticker != '' AND UPPER(ticker) = ? AND " + sample_marker.not_sample_sql()
        + " ORDER BY updated_at DESC, rowid DESC LIMIT ?",
        (user_id, symbol.upper(), SOURCE_SCAN)).fetchall()
    if not rows:
        return None
    prop_defs = _property_defs(user_id, conn)
    for r in rows:
        plan = plan_extract.read_note_plan(r["body_json"], r["properties_json"], prop_defs, symbol)
        levels = {role: plan.value(role) for role in _ROLES if plan.value(role) is not None}
        if levels:
            return {"noteId": r["id"], "title": (r["title"] or "").strip(), "levels": levels}
    return None


def _para(*inline: dict) -> dict:
    return {"type": "paragraph", "content": [n for n in inline if n]}


def _text(s: str) -> dict:
    return {"type": "text", "text": s}


def _as_of_et(iso: Any) -> str | None:
    """"Oct 14, 10:31 AM ET" from the quote's UTC `asOf`, or None when it is not a dated instant."""
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if t.tzinfo is None:
            return None
        t = t.astimezone(_ET)
    except (TypeError, ValueError):
        return None
    return f"{t.strftime('%b')} {t.day}, {t.strftime('%I:%M %p').lstrip('0')} ET"


def price_line(symbol: str, ctx: dict) -> dict | None:
    """"Price when planned: $182.40 (live price, Oct 14, 10:31 AM ET)" as a plain paragraph, or None.
    One read, started only while the create's budget has time (R-T12-C); a spent budget, a failed read
    and a price that is not a real number all leave the line out."""
    try:
        _tb._spend(ctx.setdefault("memo", {}))
        q = _tb.price_stamp_quote(symbol, ctx["now"])
    except Exception:  # noqa: BLE001 -- a spent budget or a failed read is a missing line, never a failed note
        return None
    price = (q or {}).get("price")
    # ⛔ Below one cent is no line (M1): `f"{0.004:,.2f}"` prints "$0.00", and R-T2A-2 is "never a blank or a zero".
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price < 0.01:
        return None
    when = _as_of_et(q.get("asOf"))
    source = q.get("source") if q.get("source") in _SOURCE_WORDS else None
    parts = [p for p in (source, when) if p]
    tail = f" ({', '.join(parts)})" if parts else ""
    return _para(_text(f"Price when planned: ${price:,.2f}{tail}"))


def _top_widgets(doc: dict, widget_id: str) -> list[dict]:
    return [n for n in doc.get("content") or []
            if isinstance(n, dict) and n.get("type") == "widgetEmbed"
            and (n.get("attrs") or {}).get("widgetId") == widget_id]


def _place_levels(doc: dict, symbol: str, levels: dict) -> bool:
    """Draw the levels on the note's chart(s) of this ticker and set the sizer's entry and stop.
    True when at least one block took them."""
    placed = False
    for chart in _top_widgets(doc, "chart"):
        if ((chart["attrs"].get("params") or {}).get("symbol") or "").upper() == symbol.upper():
            chart["attrs"]["annotations"] = [plan_extract.plan_annotation(role, price)
                                             for role, price in levels.items()]
            placed = True
    for sizing in _top_widgets(doc, "positionSizing"):
        params = dict(sizing["attrs"].get("params") or {})
        for role in ("entry", "stop"):
            if role in levels:
                params[role] = levels[role]
                placed = True
        sizing["attrs"]["params"] = params
    return placed


def _placed_copy(doc: dict, symbol: str, levels: dict) -> dict | None:
    """The levels placed onto a COPY of `doc`, or None when no block took them or the outline could not take them.
    ⛔ I4: the member's own outline can hold an embed of any shape (a chart whose symbol is a number, a sizer whose
    params is a list, attrs that are not an object); `_place_levels` raising there used to fail the whole `/plan`
    create. On any error nothing is placed and no source line is written (T4-2), and because the work is done on a
    copy, a level placed before the error never ships without the line that says where it came from."""
    try:
        trial = copy.deepcopy(doc)
        return trial if _place_levels(trial, symbol, levels) else None
    except Exception:  # noqa: BLE001 -- a malformed outline is "nowhere to put a level", never a failed note
        return None


def apply(doc: dict, ctx: dict, conn) -> dict:
    """compose's `after_build` for a planPrefill create: the member's levels, the dated price, the
    source link. Mutates and returns `doc`; never raises for a missing level or price, or for an
    outline that cannot take a level."""
    symbol = ctx.get("ticker")
    if not symbol:
        return doc
    try:
        found = member_levels(ctx["user_id"], symbol, conn)
    except Exception:  # noqa: BLE001 -- an unreadable notebook is "no earlier plan", never a failed note
        found = None
    lines: list[dict] = []
    price = price_line(symbol, ctx)
    if price:
        lines.append(price)
    placed = _placed_copy(doc, symbol, found["levels"]) if found else None
    if placed is not None:
        doc.clear()
        doc.update(placed)  # in place: the caller's `doc` IS the note being built
        # ⛔ No title in the text: the chip resolves the note's CURRENT title (noteLinkNode.jsx), and a
        # title typed into this line could carry a colon and a number, which plan_extract's text reader
        # would take for a level the member never planned (V6: keep this line prose, no `label: number`).
        lines.append(_para(_text("Levels from your note: "), {"type": "noteLink", "attrs": {"noteId": found["noteId"]}}))
    if lines:
        content = doc.setdefault("content", [])
        i = _js._after_first_heading(content)
        content[i:i] = lines
    return doc
