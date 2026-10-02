"""Wave 11 lane 11D -- the trade-plan canvas, as the SERVER reads it.

A canvas is an ordinary note whose body is one `tradeCanvas` block atom (plus the
empty paragraph TipTap's TrailingNode keeps after it). The board lives in the node's
`board` attribute; the client owns every edit (lib/tradeCanvas.js) and the note's own
write path carries it -- autosave, the compare-and-set on `updated_at`, the offline
outbox, version history, trash, account deletion. Nothing here writes.

What the server does with a board is READ it for people:

  * export (Markdown, and through Markdown the web page; Word through
    `notes_export_formats`) -- a readable summary: the levels, the charts with their
    symbols, timeframes and as-of dates, the cards' text, the arrows;
  * search -- NOT here: `body_plain` reads the node's `searchText` attribute, which the
    client derives from the board at every commit (the widgetEmbed precedent,
    note_citation_text._ATOM_TEXT), so this file never re-owns the search line.

⛔ NEVER RAISES. A board is member data written by a client this server did not
build; any shape -- a list where a dict belongs, a string price, a missing id -- reads
as "less", never as a 500 on export.
"""
from __future__ import annotations

import math
from typing import Any

CANVAS_NODE = "tradeCanvas"
BOARD_VERSION = 1

TF_LABELS: dict[str, str] = {
    "1": "1 min", "5": "5 min", "15": "15 min", "30": "30 min", "60": "1 hour",
    "65": "65 min", "D": "Daily", "W": "Weekly", "M": "Monthly",
}
ROLE_LABELS: dict[str, str] = {
    "entry": "Entry", "stop": "Stop", "target": "Target", "custom": "Level",
}
# How much of one card's text a summary line carries (the full text is in the note).
CARD_TEXT_CAP = 400


def _str(v: Any, cap: int = 2000) -> str:
    return v[:cap] if isinstance(v, str) else ""


def _one_line(text: str) -> str:
    return " ".join(text.split())


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and math.isfinite(float(v)):
        return float(v)
    return None


def fmt_price(price: float) -> str:
    """Two decimals at a dollar and up, four under one (a penny stock's level)."""
    return f"{price:,.2f}" if abs(price) >= 1 else f"{price:.4f}"


def board_of(attrs: Any) -> dict[str, list[dict[str, Any]]]:
    """The board in `attrs`, normalised: only dict items that carry a string id and a
    known kind, edges between ids that exist, levels with a finite price."""
    board = attrs.get("board") if isinstance(attrs, dict) else None
    if not isinstance(board, dict):
        board = {}
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for it in board.get("items") if isinstance(board.get("items"), list) else []:
        if not isinstance(it, dict):
            continue
        iid = it.get("id")
        if not isinstance(iid, str) or not iid or iid in seen:
            continue
        if it.get("kind") not in ("text", "sticky", "chart"):
            continue
        seen.add(iid)
        items.append(it)
    edges = [e for e in (board.get("edges") if isinstance(board.get("edges"), list) else [])
             if isinstance(e, dict) and e.get("from") in seen and e.get("to") in seen
             and e.get("from") != e.get("to")]
    levels = [lv for lv in (board.get("levels") if isinstance(board.get("levels"), list) else [])
              if isinstance(lv, dict) and _num(lv.get("price")) is not None]
    return {"items": items, "edges": edges, "levels": levels}


def chart_label(item: dict[str, Any]) -> str:
    """`NVDA · Daily · live` / `NVDA · 65 min · frozen as of 2026-09-24`."""
    sym = _one_line(_str(item.get("symbol"), 16)).upper() or "Chart"
    tf = TF_LABELS.get(str(item.get("tf") or "D"), str(item.get("tf") or "D"))
    as_of = _str(item.get("asOf"), 10)
    if item.get("mode") == "frozen" and as_of:
        return f"{sym} · {tf} · frozen as of {as_of}"
    return f"{sym} · {tf} · live"


def item_label(item: dict[str, Any]) -> str:
    """How an arrow names its ends: a chart by its symbol line, a card by its text."""
    if item.get("kind") == "chart":
        return chart_label(item)
    text = _one_line(_str(item.get("text")))
    if not text:
        return "Sticky note" if item.get("kind") == "sticky" else "Text card"
    return text if len(text) <= 60 else text[:59].rstrip() + "…"


def level_line(level: dict[str, Any], charts: dict[str, dict[str, Any]]) -> str:
    role = level.get("role") if level.get("role") in ROLE_LABELS else "custom"
    label = _one_line(_str(level.get("label"), 60)) or ROLE_LABELS[role]
    line = f"{label}: {fmt_price(_num(level.get('price')) or 0.0)}"
    chart = charts.get(level.get("chartId")) if isinstance(level.get("chartId"), str) else None
    if chart is not None:
        line += f" (on {chart_label(chart)})"
    return line


def summary_sections(attrs: Any) -> list[tuple[str, list[str]]]:
    """The canvas as `(section heading, lines)` -- the ONE reading every exporter
    formats. Empty sections are left out; an empty board reads as one line."""
    b = board_of(attrs)
    items, edges, levels = b["items"], b["edges"], b["levels"]
    charts = {it["id"]: it for it in items if it.get("kind") == "chart"}
    by_id = {it["id"]: it for it in items}
    order = {"entry": 0, "stop": 1, "target": 2, "custom": 3}
    sections: list[tuple[str, list[str]]] = []
    if levels:
        ranked = sorted(levels, key=lambda lv: order.get(lv.get("role"), 3))
        sections.append(("Levels", [level_line(lv, charts) for lv in ranked]))
    if charts:
        sections.append(("Charts", [chart_label(c) for c in charts.values()]))
    cards = []
    for it in items:
        if it.get("kind") not in ("text", "sticky"):
            continue
        text = _one_line(_str(it.get("text")))
        if not text:
            continue
        if len(text) > CARD_TEXT_CAP:
            text = text[:CARD_TEXT_CAP - 1].rstrip() + "…"
        cards.append(("Sticky: " if it.get("kind") == "sticky" else "") + text)
    if cards:
        sections.append(("Notes on the board", cards))
    arrows = []
    for e in edges:
        line = f"{item_label(by_id[e['from']])} → {item_label(by_id[e['to']])}"
        label = _one_line(_str(e.get("label"), 60))
        arrows.append(f"{line} ({label})" if label else line)
    if arrows:
        sections.append(("Arrows", arrows))
    return sections


def summary_title(attrs: Any) -> str:
    b = board_of(attrs)
    n_items, n_levels = len(b["items"]), len(b["levels"])
    if not n_items and not n_levels:
        return "Trade-plan canvas (empty)"
    parts = [f"{n_items} item{'s' if n_items != 1 else ''}"]
    if n_levels:
        parts.append(f"{n_levels} level{'s' if n_levels != 1 else ''}")
    if b["edges"]:
        parts.append(f"{len(b['edges'])} arrow{'s' if len(b['edges']) != 1 else ''}")
    return "Trade-plan canvas — " + ", ".join(parts)
