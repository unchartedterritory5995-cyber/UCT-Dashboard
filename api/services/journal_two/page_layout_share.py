"""P4b: a page layout as a community-library item. PURE: constants and functions over a payload, no database,
no import of template_gallery (which imports THIS module).

⛔ LAYOUT_PANEL_IDS and LAYOUT_PHASES are ONE FACT IN TWO FILES with PANELS and PHASES in
app/src/pages/journal-2-0/lib/pageLayouts.js; tests/test_page_layout_share.py PARSES that file and holds them
equal, in order (R-P4b-5). The PREFERENCE validator (auth._validate_page_layout) stays shape-only (R-P4-7); only
a SHARED payload is held to these ids (R-P4b-6)."""
from __future__ import annotations

from typing import Any

LAYOUT_ITEM = "page_layout"
LAYOUT_PAGES = ("today", "trade")
LAYOUT_PHASES = ("premarket", "market", "postclose")
LAYOUT_PANEL_IDS = {
    "today": ("coachStrip", "weekStrip", "goalProgress", "quickActions", "checklistToday", "myRules", "regime",
              "todayNote", "notices"),
    "trade": ("linkedNotes", "entryContext", "planGrade", "outcome", "chart", "beforeAfter", "story",
              "executions", "review"),
}


class LayoutPayloadError(ValueError):
    """A payload that must never be stored."""


def page_lists(page: str) -> tuple[str, ...]:
    return LAYOUT_PHASES if page == "today" else ("trade",)


def validate_layout_payload(p: Any) -> dict:
    """The WRITE door (R-P4b-6a): raise unless `p` is exactly {page, lists} with known lists of unique registry
    ids and boolean `shown`, and at least one list."""
    if not isinstance(p, dict) or set(p) != {"page", "lists"} or p["page"] not in LAYOUT_PAGES:
        raise LayoutPayloadError("not a layout payload")
    lists, known = p["lists"], set(LAYOUT_PANEL_IDS[p["page"]])
    if not isinstance(lists, dict) or not lists or not set(lists) <= set(page_lists(p["page"])):
        raise LayoutPayloadError("unknown list")
    for entries in lists.values():
        if not isinstance(entries, list):
            raise LayoutPayloadError("a list is not a list")
        seen: set[str] = set()
        for e in entries:
            if not isinstance(e, dict) or set(e) != {"id", "shown"} or not isinstance(e["shown"], bool):
                raise LayoutPayloadError("bad entry")
            if e["id"] not in known or e["id"] in seen:
                raise LayoutPayloadError("unknown or repeated panel")
            seen.add(e["id"])
    return p


def safe_layout(p: Any) -> dict | None:
    """The READ (R-P4b-6c): whatever is stored, registry ids only, first occurrence, known lists only."""
    if not isinstance(p, dict) or p.get("page") not in LAYOUT_PAGES:
        return None
    page, raw = p["page"], p.get("lists")
    known = set(LAYOUT_PANEL_IDS[page])
    lists: dict[str, list[dict]] = {}
    for name in page_lists(page):
        entries = raw.get(name) if isinstance(raw, dict) else None
        if not isinstance(entries, list):
            continue
        seen: set[str] = set()
        out = []
        for e in entries:
            if (isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"] in known
                    and e["id"] not in seen and isinstance(e.get("shown"), bool)):
                seen.add(e["id"])
                out.append({"id": e["id"], "shown": e["shown"]})
        lists[name] = out
    return {"page": page, "lists": lists}
