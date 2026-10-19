"""P4b: a page layout as a community-library item. PURE: constants and functions over a payload (and over the
member's stored preference TEXT, which the caller reads), no database, no import of template_gallery (which imports
THIS module).

⛔ LAYOUT_PANEL_IDS and LAYOUT_PHASES are ONE FACT IN TWO FILES with PANELS and PHASES in
app/src/pages/journal-2-0/lib/pageLayouts.js; tests/test_page_layout_share.py PARSES that file and holds them
equal, in order (R-P4b-5). The PREFERENCE validator (auth._validate_page_layout) stays shape-only (R-P4-7); only
a SHARED payload is held to these ids (R-P4b-6)."""
from __future__ import annotations

import json
from typing import Any

LAYOUT_ITEM = "page_layout"
#: The member's own preference key. ⛔ ONE FACT IN THREE PLACES: `LAYOUT_PREF` in pageLayouts.js and
#: `auth._PREFERENCE_KEYS`; tests/test_page_layout_share.py reads both and holds them equal to this.
LAYOUT_PREF = "journal_page_layout"
#: The preference model's version (`auth._PAGE_LAYOUT_VERSION`, `LAYOUT_VERSION` in pageLayouts.js).
LAYOUT_VERSION = 1
LAYOUT_PAGES = ("today", "trade")
LAYOUT_PHASES = ("premarket", "market", "postclose")
LAYOUT_PANEL_IDS = {
    "today": ("coachStrip", "weekStrip", "goalProgress", "quickActions", "checklistToday", "myRules", "regime",
              "todayNote", "notices"),
    "trade": ("linkedNotes", "entryContext", "planGrade", "outcome", "chart", "beforeAfter", "story",
              "executions", "review"),
}


class LayoutPayloadError(ValueError):
    """A payload that must never be stored. Raised by `layout_payload` with one of the three sentences below as
    its text, so a caller can hand that text to the member as it is."""


NOT_CUSTOMIZED_SENTENCE = "You haven't changed this page's layout yet, so there is nothing to share."
UNREADABLE_SENTENCE = "Your layout couldn't be read, so it can't be shared. Open Customize, press Save, and try again."
PAGE_SENTENCE = "Pick Today or the trade page."
#: The only texts a `LayoutPayloadError` may carry to a member. The door's own words ("unknown list", ...) are for
#: tests and logs; a caller maps any other text to UNREADABLE_SENTENCE.
LAYOUT_SENTENCES = (NOT_CUSTOMIZED_SENTENCE, UNREADABLE_SENTENCE, PAGE_SENTENCE)


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
            # P4b-R-T3-5: the id must be text BEFORE the set lookup below, or an unhashable one is a TypeError,
            # which a caller catching this class would surface as a 500.
            if (not isinstance(e, dict) or set(e) != {"id", "shown"} or not isinstance(e["id"], str)
                    or not isinstance(e["shown"], bool)):
                raise LayoutPayloadError("bad entry")
            if e["id"] not in known or e["id"] in seen:
                raise LayoutPayloadError("unknown or repeated panel")
            seen.add(e["id"])
    return p


def _refuse_constant(name: str):
    raise ValueError(name)          # NaN, Infinity, -Infinity: not JSON (`auth._validate_page_layout`'s rule)


def layout_payload(raw_pref: str | None, page: Any) -> tuple[dict, int]:
    """The shareable payload of one page of the member's OWN saved layout, and how many panels it left out.

    R-P4b-3/4: built from the stored preference TEXT, never from anything a client sends. ⛔ The PAGE is checked
    FIRST, before the text is parsed, so a bad page answers PAGE_SENTENCE whatever is stored. Then: no text is
    NOT_CUSTOMIZED_SENTENCE; text that does not parse (NaN refused, as the preference validator does), is not an
    object, or is not `version == 1` is UNREADABLE_SENTENCE, and so is a page section or list of the wrong shape.

    Taken: `today.<phase>` for each known phase present, in PHASES order (or `trade`), each entry rebuilt as
    `{id, shown}` when its id is a registry id not seen before in that list and `shown` is a boolean.
    `droppedPanels` (R-P4b-6) counts every entry of the shared page's lists that is LEFT OUT: an unknown id, a
    repeat, a non-boolean `shown`, a non-entry. Unknown fields on a kept entry are not shared and not counted.
    The other page's lists and unknown phases are not shared and not counted. A list that keeps nothing is left
    out of the payload; a page whose lists are absent or keep nothing is NOT_CUSTOMIZED_SENTENCE.

    The result goes through `validate_layout_payload`; a refusal there is UNREADABLE_SENTENCE."""
    if page not in LAYOUT_PAGES:
        raise LayoutPayloadError(PAGE_SENTENCE)
    if raw_pref is None or raw_pref == "":
        raise LayoutPayloadError(NOT_CUSTOMIZED_SENTENCE)
    if not isinstance(raw_pref, str):
        raise LayoutPayloadError(UNREADABLE_SENTENCE)
    try:
        blob = json.loads(raw_pref, parse_constant=_refuse_constant)
    except (ValueError, TypeError, RecursionError):
        raise LayoutPayloadError(UNREADABLE_SENTENCE) from None
    version = blob.get("version") if isinstance(blob, dict) else None
    if not isinstance(blob, dict) or isinstance(version, bool) or version != LAYOUT_VERSION:
        raise LayoutPayloadError(UNREADABLE_SENTENCE)
    if page == "today":
        if "today" not in blob:
            raise LayoutPayloadError(NOT_CUSTOMIZED_SENTENCE)
        section = blob["today"]
        if not isinstance(section, dict):
            raise LayoutPayloadError(UNREADABLE_SENTENCE)
        stored = [(phase, section[phase]) for phase in LAYOUT_PHASES if phase in section]
    else:
        stored = [("trade", blob["trade"])] if "trade" in blob else []
    known = set(LAYOUT_PANEL_IDS[page])
    lists: dict[str, list[dict]] = {}
    dropped = 0
    for name, entries in stored:
        if not isinstance(entries, list):
            raise LayoutPayloadError(UNREADABLE_SENTENCE)
        seen: set[str] = set()
        kept = []
        for e in entries:
            eid = e.get("id") if isinstance(e, dict) else None
            shown = e.get("shown") if isinstance(e, dict) else None
            if isinstance(eid, str) and eid in known and eid not in seen and isinstance(shown, bool):
                seen.add(eid)
                kept.append({"id": eid, "shown": shown})
            else:
                dropped += 1
        if kept:
            lists[name] = kept
    if not lists:
        raise LayoutPayloadError(NOT_CUSTOMIZED_SENTENCE)
    payload = {"page": page, "lists": lists}
    try:
        validate_layout_payload(payload)
    except LayoutPayloadError:
        raise LayoutPayloadError(UNREADABLE_SENTENCE) from None
    return payload, dropped


def safe_layout(p: Any) -> dict | None:
    """The READ (R-P4b-6c): whatever is stored, registry ids only, first occurrence, known lists only.

    ⛔ Readers call `usable_layout` (below), never this: the item read, the held revision and adopt all go through
    that one step, which also drops a list registry drift has emptied (P4b-T6-R1)."""
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


def usable_layout(p: Any) -> dict | None:
    """What a STORED layout leaves as, on every read and on adopt (P4b-T6-R1): `safe_layout`, then any list that
    registry drift has emptied (every panel it held has left the registry) is DROPPED, never served as an empty
    list. Publishing never stores an empty list (`layout_payload` leaves one out), so an empty list here is only ever
    drift. An empty list and an absent one mean different things to the client (X2: a missing panel is appended
    hidden), so the preview and the adopt must both drop it, through this one step. None when `safe_layout` cannot
    read the payload OR no list keeps a panel: nothing usable, the same answer either way (adopt refuses it with
    `LAYOUT_UNSUPPORTED_SENTENCE`; a read serves `payload: None`)."""
    layout = safe_layout(p)
    if layout is None:
        return None
    lists = {name: entries for name, entries in layout["lists"].items() if entries}
    return {"page": layout["page"], "lists": lists} if lists else None
