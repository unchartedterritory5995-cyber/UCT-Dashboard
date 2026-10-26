"""Journal styles (Notebook P1, spec §P1).

A journal style is a full setup for a kind of note: an outline, the blocks switched on (with their
settings) and the property values a new note starts with. This module is the ONE authority over
styles: the store, versions, defaults, the composer that turns a style into a note body, and the
"update layout" planner. The router is api/routers/notebook_journal_styles.py.

⛔ Dark behind NOTEBOOK_JOURNAL_STYLES_ENABLED, read PER CALL through the one Notebook flag parse.
⛔ The switch gates CREATING, never RENDERING (docs/notebook/p1-verify-before-building.md §c).

Kinds of note live in note_kinds.py (Task 4). It is read through `_nk()`, a lazy import, so this
module imports cleanly on its own; nothing here restates a kind constant.
"""
from __future__ import annotations

import copy
import importlib
import json
import logging
import re
import sqlite3
import threading
import time
import uuid
from concurrent.futures import TimeoutError as _FutTimeout
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from api.services.auth_db import get_connection
from api.services.journal_two import sample_marker
from api.services.notebook_flags import flag_on

_log = logging.getLogger(__name__)

FLAG = "NOTEBOOK_JOURNAL_STYLES_ENABLED"


def enabled() -> bool:
    """The gate, read per call (default OFF)."""
    return flag_on(FLAG, False)


def _nk():
    """The kinds-of-note module (Task 4), imported at call time: the one authority over kinds and
    over the `builtin:note_kind` property id."""
    from api.services.journal_two import note_kinds
    return note_kinds


MAX_STYLES_PER_MEMBER = 200
MAX_STYLE_NAME_CHARS = 80
MAX_BLOCKS = 30
MAX_UNKNOWN_SETTINGS_BYTES = 4096
BLOCK_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,40}$")
BUILTIN_PREFIX = "builtin:"

# ⛔ ONE FACT IN TWO FILES with app/src/pages/journal-2-0/lib/journalBlocks.js (ids, settings keys,
# options, defaults). A block id IS a widget id, except `reminder` (Tier 2 part B), which builds an
# unticked task. P2 adds a row here, the client row, and a builder.
BLOCK_KINDS: tuple[dict, ...] = (
    {"id": "chart", "settings": ({"key": "tf", "options": ("D", "W", "60", "15", "5"), "default": "D"},)},
    # P2 Tier 1 (part a). `search` is the node's searchText, set by the builder and by the client insert.
    {"id": "preEntryChecklist", "search": "[pre-entry checklist]", "settings": (
        {"key": "includeRules", "options": ("yes", "no"), "default": "yes"},
        {"key": "requireAll", "options": ("no", "yes"), "default": "no"})},
    {"id": "priceStamps", "search": "[price stamps]", "settings": (
        {"key": "on", "options": ("no", "yes"), "default": "no"},)},
    {"id": "positionSizing", "search": "[position sizing]", "settings": (
        {"key": "grade", "options": ("A", "A+", "B"), "default": "A"},)},
    # P2 Tier 1 (part b).
    # R-PF-B1: which rules the block lists (the one real setting; the five others have none).
    {"id": "myRules", "search": "[my rules]", "settings": (
        {"key": "which", "options": ("active", "all"), "default": "active"},)},
    {"id": "prepWire", "search": "[morning wire and exposure]", "settings": ()},
    {"id": "prepEarnings", "search": "[earnings for my names]", "settings": ()},
    {"id": "prepMovers", "search": "[my movers]", "settings": ()},
    {"id": "prepLevels", "search": "[key levels from my plans]", "settings": ()},
    {"id": "tradeReview", "search": "[post-trade review]", "settings": ()},
    # P2 Tier 3 Task 3: the mood and focus check-in. No settings (R-T3-V1); its builder makes it unpicked.
    {"id": "moodCheckIn", "search": "[mood and focus check-in]", "settings": ()},
    # The market context stamp is the EXISTING marketcontext capture widget (IR-S6). No `search`.
    {"id": "marketcontext", "settings": (
        {"key": "fields", "options": ("all", "regime", "indexes"), "default": "all"},)},
    # Tier 2 part B (R-T2B-13): the Reminder, an unticked task "Follow up by <date>". NOT a widget, so
    # no `search`; built in create mode only (reminder_block.py).
    {"id": "reminder", "settings": ({"key": "days", "options": ("1", "2", "3", "5", "10"), "default": "5"},)},
)
#: Notebook widgets Task 15: the snapshot widget kinds a style may hold as a block, filled when the style
#: is applied (`_build_widget_slot`). A slot id IS the widget kind (notebook_widgets.KIND_WAVE), as a
#: block id is a widget id. ⛔ NOT in BLOCK_KINDS (the catalog the style editor's "Add a block" offers,
#: shared with journalBlocks.js): a kind's release wave gates its menu entry, so the editor never offers
#: one; a style gains a slot from a built-in outline or from "Save as style" on a note that holds one.
#: A built-in slot has no settings, so build() uses the kind's defaults (this week, the member's own lists).
#: Task 18 (R50): a member slot keeps the builder's request keys and nothing else (`_clean_blocks` reduces it
#: through notebook_widgets.settings_of, so no payload figure is ever stored in a style), and
#: `_build_widget_slot` passes them through to build() as params (it reads only the applier's own account).
#: Wave 11 (Task 11.3): the six wave 10 dedicated kinds a template may hold, after the six, in this order. Each
#: is gated by its own KIND_WAVE (10) in `_slot_wave_off`. `myPlanVsActual` is not a slot: it needs a trade pick.
SNAPSHOT_SLOT_KINDS: tuple[str, ...] = (
    "myWatchlistToday", "myNamesReporting", "myPnlStats", "myPositionsRisk", "myRulesCheck", "myMistakes",
    "myRiskLeftToday", "myGamePlan", "myTiltCheck", "myRevengeClean", "myPropFirm", "myAlertsFired")
#: Ruling W11-R20: a wave 10 kind used as a template SLOT is a wave 11 capability. While wave 11 is off these
#: six are exactly what they were before Task 11.3: not known blocks (`_KnownBlocks.__contains__` answers
#: False, so "Save as style" leaves them out and the gallery reader drops them) and hidden from every slot path
#: (`_slot_wave_off`: served, compose, update layout, kept on save). ⛔ The same flag-dependent membership holds
#: for EVERY `_KnownBlocks` instance, `CREATE_ONLY_BLOCKS` included: `'myGamePlan' in CREATE_ONLY_BLOCKS` is
#: False while wave 11 is off, so a membership test against it must come AFTER the `_slot_wave_off` skip.
WAVE11_SLOT_KINDS: tuple[str, ...] = SNAPSHOT_SLOT_KINDS[6:]
_WAVE11_SLOT_KIND_SET = frozenset(WAVE11_SLOT_KINDS)


def _wave11_on() -> bool:
    """Is notebook widgets wave 11 on, read NOW (imported at call time: this module imports notebook_widgets
    only further down)."""
    from api.services.journal_two import notebook_widgets
    return notebook_widgets.notebook_widgets_wave_on(11)

# ── Wave 11 (Task 11.3, rulings W11-R2 / W11-R3): template slot families ─────────────────────────
# A template slot is a block id the existing BLOCK_ID_RE and PLACEHOLDER_RE already accept:
# `built_<k>` (a built widget), `routine_<k>`, `tracker_<k>`, `<k>` 1-2 lowercase letters or digits.
# Its target lives in the block's settings, reduced on every write by `slot_settings_of`.
SLOT_FAMILIES: tuple[str, ...] = ("built", "routine", "tracker")
SLOT_ID_RE = re.compile(r"^(built|routine|tracker)_[a-z0-9]{1,2}$")
INLINE_KEY_RE = re.compile(r"^[a-z0-9]{1,8}$")


def slot_family(block_id: Any) -> str | None:
    """The slot family of a block id (`"built"`, `"routine"`, `"tracker"`), or None. Total."""
    if not isinstance(block_id, str):
        return None
    m = SLOT_ID_RE.fullmatch(block_id)        # fullmatch: `$` alone would accept a trailing newline
    return m.group(1) if m else None


class _KnownBlocks(frozenset):
    """W11-R3: the ONE authority over which block ids this server can place. Iteration, length and set
    algebra are the frozenset's (the catalogued ids); membership ALSO answers True for every slot family id
    (`SLOT_ID_RE`), so every `bid in KNOWN_BLOCKS` site accepts the families with no call-site change.
    Ruling W11-R20: a WAVE11_SLOT_KINDS member answers False while wave 11 is off (read per call). That holds
    for every instance of this class, `CREATE_ONLY_BLOCKS` as well as `KNOWN_BLOCKS` (11.3 re-review m-4).

    ⛔ ONLY `in` is prefix- and flag-aware. Set algebra (`|`, `&`, `<=`, ...) returns or compares plain
    frozensets of the catalogued ids, so a derived set (`KNOWN_BLOCKS | {...}`) silently loses both rules:
    always test membership against KNOWN_BLOCKS itself. A non-hashable value answers False, never raises."""
    __slots__ = ()

    def __contains__(self, x: object) -> bool:
        if isinstance(x, str):
            if x in _WAVE11_SLOT_KIND_SET and frozenset.__contains__(self, x):
                return _wave11_on()
            return frozenset.__contains__(self, x) or SLOT_ID_RE.fullmatch(x) is not None
        try:
            return frozenset.__contains__(self, x)
        except TypeError:                         # an unhashable value (a hand-edited row's list) is no block
            return False


KNOWN_BLOCKS = _KnownBlocks(frozenset(k["id"] for k in BLOCK_KINDS) | frozenset(SNAPSHOT_SLOT_KINDS))
#: Task 15 fix round 1: ONE wall-clock budget for every slot a create builds. Slots are built LAST, after
#: every other block and the prefill, so trader_blocks' create read budget is spent on the prep pack alone;
#: a slot not finished inside this budget becomes its "couldn't load" sentence.
SLOT_BUDGET_S = 4.0
_SLOT_MARK = "__uctSlot"            # a deferred slot's in-body marker key, never stored
_TOOL_MARK = "__uctTool"            # fix round 2: a routine / tracker slot left for the locked step, never stored
_BLOCK_BY_ID = {k["id"]: k for k in BLOCK_KINDS}


class StyleValidationError(ValueError):
    pass


# The slot settings' sentences (W11-R2). Member words only: Widget, Routine, Tracker.
S_SLOT_REF = "Pick a widget for this spot."
S_SLOT_REV = "This widget's version couldn't be read."
S_SLOT_RANGE = "That date range isn't available."
S_SLOT_TOOL = "Pick a routine or tracker for this spot."
S_SLOT_BIND = "Pick the day this block is for."
S_SLOT_DISPLAY = "That display isn't available."

_UUID4_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_TEMPLATE_KEY_RE = re.compile(r"^[a-z0-9_]{1,40}$")
#: Display options per tool family (W11-R2), the first is the default.
SLOT_DISPLAYS: dict[str, tuple[str, ...]] = {"routine": ("items", "pnl"), "tracker": ("chart", "pnl")}
#: The tracker refs that name no row: the mood and focus check-in.
SLOT_CHECKIN_REFS = ("checkin:mood", "checkin:focus")
#: Used only while Task 11.2's `tool_binding.BINDS` (the one authority) has not landed in this checkout.
_BINDS_BEFORE_TOOL_BINDING = ("note-day", "next-trading-day", "week")


def _slot_binds() -> tuple[str, ...]:
    """The day bindings a template slot may name: `tool_binding.BINDS`, read at call time."""
    name = "api.services.journal_two.tool_binding"
    try:
        tool_binding = importlib.import_module(name)
    except ModuleNotFoundError as e:
        if e.name != name:
            raise
        return _BINDS_BEFORE_TOOL_BINDING
    return tuple(tool_binding.BINDS)


def _template_key_ok(family: str, key: Any) -> bool:
    """A routine or tracker template key: the shape always; membership in `template_tools` once Task 11.6
    has landed it (read lazily, so this grammar never imports it at module load)."""
    if not isinstance(key, str) or not _TEMPLATE_KEY_RE.fullmatch(key):
        return False
    name = "api.services.journal_two.template_tools"
    try:
        template_tools = importlib.import_module(name)
    except ModuleNotFoundError as e:
        if e.name != name:
            raise
        return True
    table = template_tools.ROUTINE_TEMPLATES if family == "routine" else template_tools.TRACKER_TEMPLATES
    return key in table


def _is_rev(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= 1


def slot_settings_of(family: str, settings: Any) -> dict:
    """W11-R2: the ONE reduction of a template slot's settings, taken on every write (`_clean_blocks`).
    Answers a NEW dict holding only the keys of the family's shape (unknown keys are dropped; `bind` and
    `display` are written explicitly at their defaults); raises `StyleValidationError` with the slot
    sentence for anything else.

    built:   {"ref": "shelf:<slug>" | "def:<uuid4>" | "inline:<key>", "defRev": int >= 1 (shelf/def only),
              "range": {"token": <plan.RANGE_TOKENS>} (optional)}
    routine: exactly one of {"ref": "routine:<uuid4>"} / {"template": <key>} / {"inline": <key>},
              "bind" in BINDS (default "note-day"), "display" in ("items", "pnl") (default "items")
    tracker: the same with "ref" "tracker:<uuid4>" | "checkin:mood" | "checkin:focus" and
              "display" in ("chart", "pnl") (default "chart")"""
    s = settings if isinstance(settings, dict) else {}
    if family == "built":
        from api.services.journal_two.widget_engine import plan as wplan
        from api.services.journal_two.widget_engine import shelf
        ref = s.get("ref")
        if not isinstance(ref, str):
            raise StyleValidationError(S_SLOT_REF)
        if ref.startswith(shelf.ID_PREFIX):
            if not shelf.known(ref):              # the ids of shelf.examples() order (every id, once)
                raise StyleValidationError(S_SLOT_REF)
            if not _is_rev(s.get("defRev")) or shelf.revision(ref, s["defRev"]) is None:
                raise StyleValidationError(S_SLOT_REV)
            out: dict = {"ref": ref, "defRev": s["defRev"]}
        elif ref.startswith("def:"):
            if not _UUID4_RE.fullmatch(ref[len("def:"):]):
                raise StyleValidationError(S_SLOT_REF)
            if not _is_rev(s.get("defRev")):
                raise StyleValidationError(S_SLOT_REV)
            out = {"ref": ref, "defRev": s["defRev"]}
        elif ref.startswith("inline:"):
            if not INLINE_KEY_RE.fullmatch(ref[len("inline:"):]):
                raise StyleValidationError(S_SLOT_REF)
            if "defRev" in s:
                raise StyleValidationError(S_SLOT_REV)
            out = {"ref": ref}
        else:
            raise StyleValidationError(S_SLOT_REF)
        if "range" in s:
            rng = s["range"]
            if not (isinstance(rng, dict) and set(rng) == {"token"} and isinstance(rng["token"], str)
                    and rng["token"] in wplan.RANGE_TOKENS):
                raise StyleValidationError(S_SLOT_RANGE)
            out["range"] = {"token": rng["token"]}
        return out
    if family not in ("routine", "tracker"):
        raise StyleValidationError(S_SLOT_REF)
    given = [k for k in ("ref", "template", "inline") if s.get(k) is not None]
    if len(given) != 1:
        raise StyleValidationError(S_SLOT_TOOL)
    key, value = given[0], s[given[0]]
    if key == "ref":
        ok = isinstance(value, str) and (
            (value.startswith(f"{family}:") and _UUID4_RE.fullmatch(value[len(family) + 1:]) is not None)
            or (family == "tracker" and value in SLOT_CHECKIN_REFS))
    elif key == "template":
        ok = _template_key_ok(family, value)
    else:
        ok = isinstance(value, str) and INLINE_KEY_RE.fullmatch(value) is not None
    if not ok:
        raise StyleValidationError(S_SLOT_TOOL)
    binds = _slot_binds()
    bind = s.get("bind", binds[0])
    if not isinstance(bind, str) or bind not in binds:              # "today" (Follow today) included
        raise StyleValidationError(S_SLOT_BIND)
    displays = SLOT_DISPLAYS[family]
    display = s.get("display", displays[0])
    if not isinstance(display, str) or display not in displays:
        raise StyleValidationError(S_SLOT_DISPLAY)
    return {key: value, "bind": bind, "display": display}


def slot_key(i: int) -> str:
    """The `<k>` of the i-th slot of a family made from a note, in document order: `a`..`z`, then `a1`..`z1`,
    `a2`, ... (always 1-2 lowercase letters or digits, `SLOT_ID_RE`)."""
    letter = chr(ord("a") + i % 26)
    return letter if i < 26 else f"{letter}{i // 26}"


def _built_slots_on() -> bool:
    """May "Save as style" make built slots now? Wave 11 and wave 8 on (while either is off a placed built
    widget is left out exactly as before Task 11.5)."""
    from api.services.journal_two import notebook_widgets
    return notebook_widgets.notebook_widgets_wave_on(11) and notebook_widgets.notebook_widgets_wave_on(8)


def built_slot_settings_of_node(params: Any) -> dict | None:
    """A placed `builtWidget`'s params -> its slot settings (W11-R2), or None when it names no widget a template
    can hold. A `shelf:` id keeps its pinned `defRev` (1 when absent, W10-R5); a member widget's uuid becomes
    `def:<uuid>` at the placement's `defRev` (validated as the member's own at FILL time). `range` is kept only
    as a token; `accountId` and `filter` are the member's viewer values and never reach a template."""
    p = params if isinstance(params, dict) else {}
    def_id, rev = p.get("defId"), p.get("defRev")
    rev = rev if _is_rev(rev) else 1
    if not isinstance(def_id, str) or not def_id:
        return None
    s: dict = {"ref": def_id if def_id.startswith("shelf:") else f"def:{def_id}", "defRev": rev}
    rng = p.get("range")
    if isinstance(rng, dict) and isinstance(rng.get("token"), str):
        from api.services.journal_two.widget_engine import plan as wplan
        if rng["token"] in wplan.RANGE_TOKENS:
            s["range"] = {"token": rng["token"]}
    try:
        return slot_settings_of("built", s)
    except StyleValidationError:
        return None


def _tool_slots_on() -> bool:
    """May "Save as style" make routine and tracker slots now? Wave 11 and wave 9 on (while either is off a placed
    routine or tracker block is left out exactly as before Task 11.6)."""
    from api.services.journal_two import notebook_widgets
    return notebook_widgets.notebook_widgets_wave_on(11) and notebook_widgets.notebook_widgets_wave_on(9)


def tool_slot_settings_of_node(family: str, params: Any) -> dict | None:
    """A placed routine or tracker block's params -> its slot settings (W11-R2), or None when it names no tool a
    template can hold. The id becomes `routine:<id>` / `tracker:<id>` (a check-in as itself), validated as the
    member's own at FILL time. `bind` is kept when it is one a template may name, else the note's day: a block
    bound "today" (Follow today) saves as `note-day`, never a template default. `display` is kept when valid."""
    p = params if isinstance(params, dict) else {}
    tid = p.get(_sf.TOOL_ID_KEYS.get(family, ""))           # the params id key: slot_fill's one table
    if family not in SLOT_DISPLAYS or not isinstance(tid, str) or not tid:
        return None
    ref = tid if family == "tracker" and tid in SLOT_CHECKIN_REFS else f"{family}:{tid}"
    binds = _slot_binds()
    bind = p.get("bind") if isinstance(p.get("bind"), str) and p.get("bind") in binds else binds[0]
    displays = SLOT_DISPLAYS[family]
    display = p.get("display") if isinstance(p.get("display"), str) and p.get("display") in displays else displays[0]
    try:
        return slot_settings_of(family, {"ref": ref, "bind": bind, "display": display})
    except StyleValidationError:
        return None


class StyleNotFound(LookupError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _h(text: str) -> dict:
    return {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]}


def _p(text: str = "") -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]} if text else {"type": "paragraph"}


def _ph(block: str) -> dict:
    return _p("{{block:%s}}" % block)


def _chart(tf: str = "D") -> dict:
    return {"block": "chart", "enabled": True, "settings": {"tf": tf}}


def _blk(block: str) -> dict:
    """A P2 block with its catalog defaults (read from BLOCK_KINDS, never retyped)."""
    kind = _BLOCK_BY_ID[block]
    return {"block": block, "enabled": True, "settings": {s["key"]: s["default"] for s in kind["settings"]}}


def _slot(kind: str) -> dict:
    """A snapshot widget slot (Task 15): no settings, filled at apply time."""
    return {"block": kind, "enabled": True, "settings": {}}


def _doc(*nodes: dict) -> dict:
    return {"type": "doc", "content": list(nodes)}


def _never_empty(before: list, after: list) -> list:
    """A nested container's children after a removal. ⛔ Never empty when it had children: every
    container that can hold a block (blockquote, callout, column, toggleContent, a table cell:
    `block+`; listItem / taskItem: `paragraph block*`) accepts a lone empty paragraph, and an emptied
    one is a body the editor schema rejects (review I-1). Removals happen only among block children
    (a widgetEmbed, a placeholder paragraph), so an inline-content node never reaches this empty."""
    return after if (after or not before) else [{"type": "paragraph"}]


#: Tier 2 part B (R-T2B-8): the follow-up's three headings. ONE constant: the built-in outline below and
#: followup_prefill.py (which places the prep link and the numbers under the first two, by exact text)
#: both read it. Straight apostrophes everywhere (pre-flight F24).
FOLLOWUP_HEADINGS = ("What I expected", "What happened", "What I'll do differently")

# One built-in style per built-in kind. Versions are bumped BY HAND when an outline here changes,
# which is what offers "update layout" to notes made from the older one.
BUILTIN_STYLES: dict[str, dict] = {
    # v2 (Notebook P2a, Task 12): the trader blocks and the market context stamp. A note made from v1
    # gains them only through "Update layout", which ADDS them uncaptured (IR-S11, R-RC-1).
    "trade_plan": {"name": "Trade plan", "version": 2, "properties": {},
                   "blocks": [_chart("D"), _blk("preEntryChecklist"), _blk("positionSizing"), _blk("marketcontext")],
                   "outline": _doc(
        _h("The setup"), _ph("marketcontext"), _p("What is the pattern, and why now?"), _ph("chart"),
        _ph("preEntryChecklist"),
        _h("Entry, stop and target"), _p("Entry:"), _p("Stop:"), _p("Target:"),
        _h("Size and risk"), _ph("positionSizing"), _p("How much am I risking, and is it within my rules?"))},
    # v2 (Notebook P2b, Task 12): the prep pack, the stamp and My rules. A v1 note gains them only
    # through "Update layout", which ADDS them uncaptured (IR-S11, R-RC-1).
    # Notebook widgets Task 15: My watchlist today and My names reporting, the morning's two snapshot widgets,
    # at the top of "Names on my list". ⛔ NO version bump (fix round 1): slots are create-only, so Update
    # layout never offers them and a bump would only re-arm the update banner on a v2 note missing a block.
    "daily_prep": {"name": "Daily prep", "version": 2, "properties": {},
                   "blocks": [_blk("prepWire"), _blk("marketcontext"), _blk("prepEarnings"), _blk("prepMovers"),
                              _blk("prepLevels"), _blk("myRules"),
                              _slot("myWatchlistToday"), _slot("myNamesReporting")],
                   "outline": _doc(
        _h("The market"), _ph("prepWire"), _ph("marketcontext"), _p("What is the tape telling me today?"),
        _h("Names on my list"), _ph("myWatchlistToday"), _ph("myNamesReporting"),
        _ph("prepEarnings"), _ph("prepMovers"), _ph("prepLevels"),
        _p("Which setups are closest to a trigger?"),
        _h("My plan"), _ph("myRules"), _p("What will I do, and what will I not do?"))},
    "weekend_prep": {"name": "Weekend prep", "version": 1, "properties": {}, "blocks": [], "outline": _doc(
        _h("The week behind"), _p("What worked and what did not?"),
        _h("Leading groups"), _p("Where is the strength?"),
        _h("Next week's list"), _p("Which names, at which levels?"))},
    "earnings": {"name": "Earnings", "version": 1, "properties": {}, "blocks": [_chart("D")], "outline": _doc(
        _h("What the market expects"), _p("Consensus, and the move the options price in:"), _ph("chart"),
        _h("My view"), _p("What would surprise the market?"),
        _h("The plan around the report"), _p("Hold, trim, or wait?"))},
    # Tier 2 part B (R-T2B-8): the earnings follow-up. followup_prefill.py adds the prep-note link and the
    # quarter's numbers under the first two headings; the reminder lands at the end.
    "earnings_followup": {"name": "Earnings follow-up", "version": 1, "properties": {},
                          "blocks": [_blk("reminder")], "outline": _doc(
        _h(FOLLOWUP_HEADINGS[0]), _p("What did I expect going in, and why?"),
        _h(FOLLOWUP_HEADINGS[1]), _p("How did the numbers and the reaction compare?"),
        _h(FOLLOWUP_HEADINGS[2]), _p(), _ph("reminder"))},
    # v2 (Notebook P2b, Task 12): the review block, above the chart it explains.
    "post_trade_review": {"name": "Post-trade review", "version": 2, "properties": {},
                          "blocks": [_chart("D"), _blk("tradeReview")],
                          "outline": _doc(
        _h("What happened"), _ph("tradeReview"), _p("Entry, exit and result:"), _ph("chart"),
        _h("Did I follow my plan?"), _p("Where did I follow it, and where did I not?"),
        _h("What I'd do differently"), _p())},
    # Notebook widgets Task 15 (no version bump, as Daily prep above): the week's four account widgets. The numbers and open risk under "The
    # numbers"; rules kept and the recurring mistakes under "One thing to change", where they feed the
    # answer. Create-only, and each only while its kind's wave is on (1 for the first two, 2 for the rest).
    "weekly_review": {"name": "Weekly review", "version": 1, "properties": {},
                      "blocks": [_slot("myPnlStats"), _slot("myPositionsRisk"), _slot("myRulesCheck"),
                                 _slot("myMistakes")],
                      "outline": _doc(
        _h("The numbers"), _p("Trades, wins, losses and the result:"), _ph("myPnlStats"), _ph("myPositionsRisk"),
        _h("Best and worst trade"), _p(),
        _h("One thing to change"), _ph("myRulesCheck"), _ph("myMistakes"), _p())},
    "thesis": {"name": "Thesis", "version": 1, "properties": {}, "blocks": [_chart("W")], "outline": _doc(
        _h("The thesis"), _p("Why will this stock go up (or down)?"), _ph("chart"),
        _h("What would prove me wrong"), _p(), _h("Catalysts"), _p())},
    "watchlist_note": {"name": "Watchlist note", "version": 1, "properties": {}, "blocks": [_chart("D")],
                       "outline": _doc(_h("Why it is on my list"), _p(), _ph("chart"),
                                       _h("The level I am waiting for"), _p())},
}


def builtin_style_id(kind_id: str) -> str:
    return BUILTIN_PREFIX + kind_id


def _member_default(user_id: str, kind_id: str, conn: sqlite3.Connection) -> str | None:
    r = conn.execute("SELECT id FROM j2_journal_styles WHERE user_id = ? AND kind_id = ? AND is_default = 1"
                     " AND deleted_at IS NULL" + _archive_hidden_sql(), (user_id, kind_id)).fetchone()
    return r["id"] if r else None


def _builtin(user_id: str, kind_id: str, conn: sqlite3.Connection, *, full: bool) -> dict:
    s = BUILTIN_STYLES[kind_id]
    out = {"id": builtin_style_id(kind_id), "name": s["name"], "kindId": kind_id, "builtin": True,
           "isDefault": _member_default(user_id, kind_id, conn) is None, "version": s["version"],
           "outlineTemplateId": None, "hasOutline": True, "blocks": copy.deepcopy(s["blocks"]),
           "properties": dict(s["properties"]), "sourceGalleryId": None, "sourceVersion": None,
           "createdAt": None, "updatedAt": None, "deletedAt": None}
    if full:
        out["outlineBodyJson"] = copy.deepcopy(s["outline"])
    return out


def _row(r: sqlite3.Row, *, full: bool) -> dict:
    body = json.loads(r["outline_body_json"]) if r["outline_body_json"] else None
    out = {"id": r["id"], "name": r["name"], "kindId": r["kind_id"], "builtin": False,
           "isDefault": bool(r["is_default"]), "version": r["version"],
           "outlineTemplateId": r["outline_template_id"], "hasOutline": bool(body or r["outline_template_id"]),
           "blocks": json.loads(r["blocks_json"] or "[]"), "properties": json.loads(r["properties_json"] or "{}"),
           "sourceGalleryId": r["source_gallery_id"], "sourceVersion": r["source_version"],
           "createdAt": r["created_at"], "updatedAt": r["updated_at"], "deletedAt": r["deleted_at"]}
    if full:
        out["outlineBodyJson"] = body
    return out


def _clean_name(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise StyleValidationError("A journal style needs a name.")
    name = " ".join(raw.split())
    if len(name) > MAX_STYLE_NAME_CHARS:
        raise StyleValidationError(f"A style's name can be at most {MAX_STYLE_NAME_CHARS} characters.")
    return name


def _clean_kind(user_id: str, raw: Any, conn: sqlite3.Connection) -> str:
    if _nk().get_kind(user_id, raw, conn) is None:
        raise StyleValidationError("Choose a kind of note for this style.")
    return raw


def _live_template(user_id: str, tid: Any, conn: sqlite3.Connection) -> str | None:
    """`tid` when it is one of the member's templates now, else None."""
    if not isinstance(tid, str) or not tid:
        return None
    hit = conn.execute("SELECT 1 FROM j2_note_templates WHERE id = ? AND user_id = ?", (tid, user_id)).fetchone()
    return tid if hit else None


def _clean_template(user_id: str, raw: Any, conn: sqlite3.Connection) -> str | None:
    """⛔ Final review I-1: a linked template that no longer exists is NO template (compose's own fallback,
    `_outline_doc`), never a refusal: a refusal locked the style for good, because Duplicate and the editor's
    preview send the stored link back. Only an id that is not text is malformed."""
    if raw in (None, ""):
        return None
    if not isinstance(raw, str):
        raise StyleValidationError("That outline is not one of your templates.")
    return _live_template(user_id, raw, conn)


def _clean_outline(raw: Any) -> dict | None:
    if raw is None:
        return None
    from api.services.journal_two import notes as notes_service
    try:
        body = notes_service._validate_body_json(raw)
        # The same build check note creation runs (review M-8): an outline the editor could not
        # build is refused here, not at the later styled create that would compose it.
        notes_service._refuse_unbuildable(body)
        return body
    except notes_service.NoteValidationError as e:
        raise StyleValidationError(f"The outline could not be saved: {e}") from e


def _legacy_key(bid: Any, settings: Any) -> tuple[str, str] | None:
    try:
        return (bid, json.dumps(settings, sort_keys=True))
    except (TypeError, ValueError):
        return None


def _legacy_blocks(blocks_json: Any) -> set:
    """The legacy-keep set of one STORED `blocks_json`: (block id, canonical settings) of each stored block the
    Task 11.3 grammar may now refuse, i.e. a family id (its settings can fail `slot_settings_of`) or an id that
    `BLOCK_ID_RE.fullmatch` refuses (`chart\\n`: `.match` with `$` let it through before 11.3, as an unknown
    block kept verbatim; 11.3 re-review m-1). Keyed on the EXACT stored id and settings."""
    try:
        stored = json.loads(blocks_json or "[]")
    except (TypeError, ValueError):
        return set()
    out = set()
    for sb in stored if isinstance(stored, list) else []:
        if not isinstance(sb, dict) or not isinstance(sb.get("block"), str):
            continue
        if slot_family(sb["block"]) or not BLOCK_ID_RE.fullmatch(sb["block"]):
            k = _legacy_key(sb["block"], sb.get("settings") if sb.get("settings") is not None else {})
            if k is not None:
                out.add(k)
    return out


def _member_legacy_blocks(user_id: str, conn: sqlite3.Connection) -> set:
    """The legacy-keep set over every one of the member's live styles (the style editor's draft preview names no
    row, so a block kept there must match one the member has stored; 11.3 re-review m-2)."""
    out: set = set()
    for r in conn.execute("SELECT blocks_json FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL",
                          (user_id,)).fetchall():
        out |= _legacy_blocks(r["blocks_json"])
    return out


def _clean_blocks(raw: Any, legacy: Any = None) -> list[dict]:
    """`legacy` (`_legacy_blocks` of the stored row(s): update_style, duplicate and the draft preview): a block
    that fails the grammar but was stored exactly so (a hand-made row from before Task 11.3, when the id was an
    unknown block kept verbatim) is kept verbatim, so the member can still save, duplicate and preview the style.
    That covers a family block whose settings fail `slot_settings_of` and an id `BLOCK_ID_RE.fullmatch` refuses.
    `legacy` may be a callable answering the set: it is called once, only when a block would otherwise be
    refused (fix round 1, m-5: the draft preview parses the member's styles only then)."""
    held: list = []

    def in_legacy(bid: Any, settings: Any) -> bool:
        if legacy is None:
            return False
        if not held:
            held.append(legacy() if callable(legacy) else legacy)
        return _legacy_key(bid, settings) in held[0]

    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_BLOCKS:
        raise StyleValidationError(f"A style can hold up to {MAX_BLOCKS} blocks.")
    out, seen = [], set()
    for b in raw:
        if not isinstance(b, dict) or not isinstance(b.get("block"), str):
            raise StyleValidationError("Each block needs a valid block id.")
        bid = b["block"]
        settings = b.get("settings") if b.get("settings") is not None else {}
        if not BLOCK_ID_RE.fullmatch(bid):                    # fullmatch: no `built_a<newline>` id
            if not in_legacy(bid, settings):
                raise StyleValidationError("Each block needs a valid block id.")
            if bid in seen:
                raise StyleValidationError("A style can hold each block once.")
            if len(json.dumps(settings)) > MAX_UNKNOWN_SETTINGS_BYTES:
                raise StyleValidationError("That block's settings are too large.")
            seen.add(bid)
            out.append({"block": bid, "enabled": bool(b.get("enabled", True)), "settings": settings})
            continue                                          # stored before the grammar: kept verbatim
        if bid in seen:
            raise StyleValidationError("A style can hold each block once.")
        seen.add(bid)
        if not isinstance(settings, dict):
            raise StyleValidationError("A block's settings must be an object.")
        kind = _BLOCK_BY_ID.get(bid)
        family = slot_family(bid)
        if family is not None:
            # Wave 11 (W11-R2): a template slot keeps its family's shape only, reduced by the ONE function
            # every write takes. Not `_nw.settings_of`, which keeps only short SETTING_KEYS strings.
            try:
                clean = slot_settings_of(family, settings)
            except StyleValidationError:
                if not in_legacy(bid, settings):
                    raise
                if len(json.dumps(settings)) > MAX_UNKNOWN_SETTINGS_BYTES:
                    raise StyleValidationError("That block's settings are too large.")
                clean = settings                                 # stored before the grammar: kept verbatim
        elif bid in SNAPSHOT_SLOT_KINDS:
            # Task 18 (R50): a snapshot slot keeps the builder's request keys only; anything else (a frozen
            # payload's figures, rows, the share switch) is dropped here, the ONE reduction every write takes.
            clean = _nw.settings_of(settings)
        elif kind is None:
            if len(json.dumps(settings)) > MAX_UNKNOWN_SETTINGS_BYTES:
                raise StyleValidationError("That block's settings are too large.")
            clean = settings                                     # a newer version's block: kept verbatim
        else:
            allowed = {s["key"]: s for s in kind["settings"]}
            clean = {}
            for k, v in settings.items():
                spec = allowed.get(k)
                if spec is None or v not in spec["options"]:
                    raise StyleValidationError(f"{k} is not a setting this block accepts.")
                clean[k] = v
        out.append({"block": bid, "enabled": bool(b.get("enabled", True)), "settings": clean})
    return out


def _stale_option(d: dict, value: Any) -> bool:
    """A select value of the right SHAPE whose option the member has since removed: stale, not malformed."""
    if d.get("type") == "select":
        return isinstance(value, str)
    if d.get("type") == "multi_select":
        return isinstance(value, list) and all(isinstance(x, str) for x in value)
    return False


def _clean_properties(user_id: str, raw: Any, conn: sqlite3.Connection) -> dict:
    """⛔ Final review I-1: a STALE reference (a property the member has deleted, an option they removed) is
    DROPPED from what is stored, the rule compose already applies (`_valid_defaults`), never a refusal: the
    editor re-sends every stored default on each Save, Duplicate and draft preview, so a refusal here locked
    the style for good. A MALFORMED value (a wrong type for a property that exists) still answers 400.
    Dropped on save, not on read: every door that sends a style back comes through here, and serving the
    stored value keeps the list a plain read (no property lookups per style)."""
    from api.services.journal_two import note_properties as np
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise StyleValidationError("properties must be an object")
    out = {}
    for pid, value in raw.items():
        if pid == _nk().NOTE_KIND_PROPERTY:
            raise StyleValidationError("A style's kind of note is set by the kind you choose.")
        if np.is_builtin_property_id(pid) and pid not in np.BUILTIN_USER_SET_IDS:
            raise StyleValidationError(f"{pid} is not a property a style can fill.")
        d = np.get_property_def(user_id, pid, conn=conn)
        if d is None or d.get("computed"):
            continue                                            # deleted (or not settable): stale, dropped
        try:
            v = np.validate_property_value(d, value)
        except np.PropertyValidationError as e:
            if _stale_option(d, value):
                continue                                        # its option was removed: stale, dropped
            raise StyleValidationError(str(e)) from e
        if v is not None:
            out[pid] = v
    return out


def _valid_defaults(user_id: str, raw: Any, conn: sqlite3.Connection) -> dict:
    """The property values that still fit a property the member has (note_templates' rule): a
    deleted or changed property, or the kind (which a style sets from its kindId), is left out,
    never a failed write. Used for a style's defaults at compose time and for a note's values
    when its setup is saved as a style."""
    from api.services.journal_two import note_properties as np
    kind_prop = _nk().NOTE_KIND_PROPERTY
    out = {}
    for pid, value in (raw if isinstance(raw, dict) else {}).items():
        if pid == kind_prop:
            continue
        if np.is_builtin_property_id(pid) and pid not in np.BUILTIN_USER_SET_IDS:
            continue
        d = np.get_property_def(user_id, pid, conn=conn)
        if d is None or d.get("computed"):
            continue
        try:
            v = np.validate_property_value(d, value)
        except np.PropertyValidationError:
            continue
        if v is not None:
            out[pid] = v
    return out


def _load_row(user_id: str, style_id: str, conn: sqlite3.Connection, *, include_deleted=False):
    sql = "SELECT * FROM j2_journal_styles WHERE id = ? AND user_id = ?"
    if not include_deleted:
        sql += " AND deleted_at IS NULL"
    return conn.execute(sql, (style_id, user_id)).fetchone()


def get_style(user_id: str, style_id: Any, conn: sqlite3.Connection | None = None, *,
              full: bool = True, include_deleted: bool = False) -> dict | None:
    if not isinstance(style_id, str):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        if style_id.startswith(BUILTIN_PREFIX):
            kind = style_id[len(BUILTIN_PREFIX):]
            return _builtin(user_id, kind, conn, full=full) if kind in BUILTIN_STYLES else None
        r = _load_row(user_id, style_id, conn, include_deleted=include_deleted)
        return _row(r, full=full) if r else None
    finally:
        if owned:
            conn.close()


#: Task 11.13 (W11-R10): the views of `list_styles`. "picker" is every existing caller's answer.
STYLE_VIEWS = ("picker", "live", "archived", "deleted")
#: Recently deleted lists a template this many days after its delete, and restore refuses it after that. Rows are
#: never hard-deleted here: a note's style stamp and Update layout read them.
RECENTLY_DELETED_DAYS = 30
#: At most this many notes in a template's "Used in" list.
USED_IN_LIMIT = 100
S_BUILTIN_ARCHIVE = "Built-in templates can't be archived."
S_BUILTIN_DELETE = "Built-in templates can't be deleted."
S_ARCHIVE_FIRST = "Archive this template before deleting it."
S_TYPE_NAME = "Type the template's name exactly to delete it."
S_RESTORE_EXPIRED = "This template was deleted more than 30 days ago."
S_RESTORE_KIND_GONE = "This template's kind of note was deleted, so it can't be restored."
S_UNARCHIVE_FIRST = "Unarchive this template before making it the default."
S_CAP = f"You can keep up to {MAX_STYLES_PER_MEMBER} styles. Delete one first."
_VIEW_WHERE = {"live": "deleted_at IS NULL AND archived_at IS NULL",
               "archived": "deleted_at IS NULL AND archived_at IS NOT NULL",
               "deleted": "deleted_at IS NOT NULL AND deleted_at >= ?"}


def _archive_hidden_sql() -> str:
    """Ruling W11-R38: an archived template is hidden from the picker, the kind section and the default choice ONLY
    while wave 11 is on. With wave 11 off it is an ordinary template again, exactly as before wave 11 (the archive
    data is kept and applies again on re-arm). Read per call."""
    return " AND archived_at IS NULL" if _wave11_on() else ""


def _deleted_cutoff() -> str:
    """The oldest `deleted_at` Recently deleted still lists (same ISO UTC form as `_now`, so text order is time
    order)."""
    return (datetime.now(timezone.utc) - timedelta(days=RECENTLY_DELETED_DAYS)).isoformat()


def _view_row(r: sqlite3.Row, *, full: bool = False) -> dict:
    """A My tools row: `_row` plus `archivedAt`. Only the Templates tab's views and its own doors carry the key
    (M-1): the picker and every pre-wave-11 answer stay exactly what they were."""
    return {**_row(r, full=full), "archivedAt": r["archived_at"]}


def _view_style(user_id: str, style_id: str, conn: sqlite3.Connection, *, include_deleted: bool = False) -> dict | None:
    r = _load_row(user_id, style_id, conn, include_deleted=include_deleted)
    return _view_row(r, full=True) if r is not None else None


def list_styles(user_id: str, conn: sqlite3.Connection | None = None, *, view: str = "picker") -> list[dict]:
    """`view="picker"` (every existing caller): built-in styles (in built-in kind order), then the member's live
    styles, oldest first. While wave 11 is on, archived ones are LEFT OUT (W11-R10: hidden from TemplatePicker, the
    kind section and the default choice); with it off the answer is byte-for-byte the pre-wave-11 one (W11-R38, M-1).

    My tools' Templates tab (Task 11.13) reads the member's OWN rows only (no built-ins), each with `archivedAt`,
    `usedIn` (live notes made from it, sample notes excluded: one grouped count), `credit`, `fromLibrary` and
    `updateAvailable`, in a constant number of statements however many rows there are (I-1):
      * "live"     the rows the picker shows while wave 11 is on;
      * "archived" archived rows, newest archive first;
      * "deleted"  rows deleted within RECENTLY_DELETED_DAYS, newest delete first (each keeps its `archivedAt`, so
                   a restore lands where it was)."""
    if view not in STYLE_VIEWS:
        raise StyleValidationError("Choose live, archived or deleted.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        if view == "picker":
            rows = conn.execute("SELECT * FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL"
                                + _archive_hidden_sql() + " ORDER BY created_at, rowid", (user_id,)).fetchall()
            return [_builtin(user_id, k["id"], conn, full=False) for k in _nk().BUILTIN_NOTE_KINDS
                    if k["id"] in BUILTIN_STYLES] + [_row(r, full=False) for r in rows]
        order = {"archived": "archived_at DESC, rowid DESC", "deleted": "deleted_at DESC, rowid DESC"}.get(
            view, "created_at, rowid")
        params: tuple = (user_id, _deleted_cutoff()) if view == "deleted" else (user_id,)
        rows = conn.execute(f"SELECT * FROM j2_journal_styles WHERE user_id = ? AND {_VIEW_WHERE[view]}"
                            f" ORDER BY {order}", params).fetchall()
        return _with_library_facts(user_id, [_view_row(r) for r in rows], conn)
    finally:
        if owned:
            conn.close()


def _used_in_counts(user_id: str, conn: sqlite3.Connection) -> dict[str, int]:
    """{style id: live notes made from it} for every style of the member, in ONE grouped count. A note in the trash
    and a sample note (sample_marker) are not uses."""
    return {r["style_id"]: r["n"] for r in conn.execute(
        "SELECT style_id, COUNT(*) AS n FROM j2_notes WHERE user_id = ? AND style_id IS NOT NULL"
        " AND deleted_at IS NULL AND " + sample_marker.not_sample_sql() + " GROUP BY style_id", (user_id,))}


def _marks(n: int) -> str:
    return ", ".join("?" for _ in range(n))


def _with_library_facts(user_id: str, styles: list[dict], conn: sqlite3.Connection) -> list[dict]:
    """Each of the member's styles with `usedIn`, `credit`, `fromLibrary` and `updateAvailable`, in a CONSTANT number
    of statements (I-1): one grouped count, one `library_facts` call over every id (batched by template_gallery),
    one `IN (...)` read of the source gallery rows, and one batched gallery read for the pre-wave-11 credits.

    `credit` and `updateAvailable` are `library_facts` (the copy's snapshot, W11-R7; {} while the library or wave 11
    is off). A copy adopted before wave 11 wrote snapshots is credited from the gallery row it came from
    (`_row_credit`, as adopting words it). `fromLibrary` is `_from_library`'s rule (P3a-T10-R5) applied to the
    batched read: it came from ANOTHER member's listing, or from one that is gone (fail closed), so the member's own
    listing is never credited."""
    from api.services.journal_two import template_gallery as tg
    counts = _used_in_counts(user_id, conn)
    facts = tg.library_facts(user_id, "template", [s["id"] for s in styles], conn=conn) if styles else {}
    gids = list(dict.fromkeys(s["sourceGalleryId"] for s in styles if s.get("sourceGalleryId")))
    # Task 11.12 (carry 15): THE `_from_library` rule (P3a-T10-R5) is template_gallery's, batched in one statement;
    # this module keeps no copy of it.
    lib = tg.from_library_many(user_id, gids, conn=conn) if gids else {}
    present: set = set()
    if gids:
        present = {r[0] for r in conn.execute(
            f"SELECT id FROM j2_template_gallery WHERE id IN ({_marks(len(gids))})", gids)}

    def from_lib(gid: Any) -> bool:
        return bool(gid) and bool(lib.get(gid))

    need = [g for g in gids if from_lib(g) and g in present
            and any(s.get("sourceGalleryId") == g and (facts.get(s["id"]) or {}).get("credit") is None
                    for s in styles)]
    fallback: dict = {}
    if need and tg._wave11_library_on():
        fallback = {r["id"]: tg._row_credit(r) for r in tg._read(conn, None, f"g.id IN ({_marks(len(need))})", need)}
    out = []
    for s in styles:
        gid = s.get("sourceGalleryId")
        fact = facts.get(s["id"]) or {}
        credit = fact.get("credit")
        if credit is None and from_lib(gid):
            credit = fallback.get(gid)
        out.append({**s, "usedIn": counts.get(s["id"], 0), "credit": credit, "fromLibrary": from_lib(gid),
                    "updateAvailable": bool(fact.get("updateAvailable"))})
    return out


def _refuse_builtin_archive(style_id: Any) -> None:
    if isinstance(style_id, str) and style_id.startswith(BUILTIN_PREFIX):
        raise StyleValidationError(S_BUILTIN_ARCHIVE)


def archive_style(user_id: str, style_id: str, *, conn: sqlite3.Connection | None = None) -> dict | None:
    """Archive one of the member's live styles (W11-R10): hidden from the picker, the kind section and the default
    choice; still readable by `get_style`, so every note keeps its style stamp and Update layout. Archiving the
    kind's default clears `is_default` (the kind falls back to the built-in). ONE UPDATE, so no lock is held; an
    already archived style keeps its first `archived_at`. None when it is not the member's live style."""
    _refuse_builtin_archive(style_id)
    owned = conn is None
    conn = conn or get_connection()
    caller_tx = conn.in_transaction          # fix round 2: a caller's open transaction is the caller's to commit
    try:
        conn.execute("UPDATE j2_journal_styles SET archived_at = COALESCE(archived_at, ?), is_default = 0"
                     " WHERE id = ? AND user_id = ? AND deleted_at IS NULL", (_now(), style_id, user_id))
        if not caller_tx:
            conn.commit()
        return _view_style(user_id, style_id, conn)
    finally:
        if owned:
            conn.close()


def unarchive_style(user_id: str, style_id: str, *, conn: sqlite3.Connection | None = None) -> dict | None:
    """Back to the picker. It does not become the default again (the member chooses that). ONE UPDATE."""
    _refuse_builtin_archive(style_id)
    owned = conn is None
    conn = conn or get_connection()
    caller_tx = conn.in_transaction          # fix round 2: a caller's open transaction is the caller's to commit
    try:
        conn.execute("UPDATE j2_journal_styles SET archived_at = NULL WHERE id = ? AND user_id = ?"
                     " AND deleted_at IS NULL", (style_id, user_id))
        if not caller_tx:
            conn.commit()
        return _view_style(user_id, style_id, conn)
    finally:
        if owned:
            conn.close()


def _copy_name(name: str) -> str:
    """"<name> copy", the name cut so the whole fits MAX_STYLE_NAME_CHARS."""
    suffix = " copy"
    return name[:MAX_STYLE_NAME_CHARS - len(suffix)].rstrip() + suffix


def duplicate_style(user_id: str, style_id: str, *, conn: sqlite3.Connection | None = None) -> dict | None:
    """My tools' Duplicate (Task 11.13): a new live style named "<name> copy" with the source's kind, outline,
    blocks and properties copied AS STORED (a family slot's ref -- a remembered routine, tracker or widget -- is
    copied as it is, never re-asked), not the default, version 1. W11-R36 c4 (P3a-T10-R6): a duplicate of a LIBRARY
    copy keeps its provenance (the source_* columns, `_provenance_of`, as `create_style`'s `duplicateOf` does) and
    its credit snapshot; only the member's own originals duplicate clean. The source may be archived; a built-in is
    copied from its definition. Refused at MAX_STYLES_PER_MEMBER with the cap's sentence.

    The count and the insert are one short write lock (nothing slow inside it), the same lock `create_style` takes,
    so neither can pass the cap past the other. A connection with the CALLER's transaction already open is written
    on and left open: never committed here (M-2). None when the source is not the member's."""
    owned = conn is None
    conn = conn or get_connection()
    caller_tx = conn.in_transaction
    began = False
    try:
        prov = None
        if isinstance(style_id, str) and style_id.startswith(BUILTIN_PREFIX):
            src = get_style(user_id, style_id, conn)
            if src is None:
                return None
            fields = (src["name"], src["kindId"], None, json.dumps(src["outlineBodyJson"]),
                      json.dumps(src["blocks"]), json.dumps(src["properties"]))
        else:
            r = _load_row(user_id, style_id, conn) if isinstance(style_id, str) else None
            if r is None:
                return None
            fields = (r["name"], r["kind_id"], r["outline_template_id"], r["outline_body_json"],
                      r["blocks_json"], r["properties_json"])
            prov = _provenance_of(user_id, style_id, conn)
        name, kind, tpl, outline, blocks, props = fields
        if not caller_tx:
            _lock_for_style(conn)
            began = True
        n = conn.execute("SELECT COUNT(*) AS c FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL",
                         (user_id,)).fetchone()["c"]
        if n >= MAX_STYLES_PER_MEMBER:
            raise StyleValidationError(S_CAP)
        sid, now = uuid.uuid4().hex, _now()
        conn.execute(
            "INSERT INTO j2_journal_styles (id, user_id, name, kind_id, outline_template_id, outline_body_json,"
            " blocks_json, properties_json, is_default, source_gallery_id, source_version, version,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 1, ?, ?)",
            (sid, user_id, _copy_name(name), kind, tpl, outline, blocks, props, now, now))
        if prov:
            conn.execute("UPDATE j2_journal_styles SET " + ", ".join(f"{c} = ?" for c in _PROVENANCE_COLS)
                         + " WHERE id = ? AND user_id = ?", (*prov, sid, user_id))
            # W11-R36 c4, Task 11.12 (carry 15): the ONE credit copier is template_gallery's.
            from api.services.journal_two import template_gallery as tg
            tg.copy_credit(conn, style_id, sid, user_id=user_id)
        if began:
            conn.commit()
        return _view_style(user_id, sid, conn)
    except BaseException:
        if began and conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def style_used_in(user_id: str, style_id: Any, *, conn: sqlite3.Connection | None = None) -> list[dict] | None:
    """The member's live notes made from one of their styles (archived or recently deleted included), newest edit
    first, at most USED_IN_LIMIT: `[{id, title, updatedAt}]`. Sample notes and notes in the trash are left out.
    None when the style is not the member's (a built-in has no "Used in" here)."""
    if not isinstance(style_id, str) or not style_id or style_id.startswith(BUILTIN_PREFIX):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        if _load_row(user_id, style_id, conn, include_deleted=True) is None:
            return None
        rows = conn.execute(
            "SELECT id, title, updated_at FROM j2_notes WHERE user_id = ? AND style_id = ? AND deleted_at IS NULL"
            " AND " + sample_marker.not_sample_sql() + " ORDER BY updated_at DESC, rowid DESC LIMIT ?",
            (user_id, style_id, USED_IN_LIMIT)).fetchall()
        return [{"id": r["id"], "title": r["title"], "updatedAt": r["updated_at"]} for r in rows]
    finally:
        if owned:
            conn.close()


def delete_style_typed(user_id: str, style_id: str, typed_name: Any, *,
                       conn: sqlite3.Connection | None = None) -> dict | None:
    """My tools' "Delete permanently" (W11-R10): only from Archived, only with the template's name typed exactly,
    then the existing SOFT `delete_style` (Recently deleted lists it for RECENTLY_DELETED_DAYS; the row is never
    hard-deleted). M-5: the archived and name checks and the delete are ONE short write lock and one transaction,
    so an unarchive or a rename from another tab in between cannot let a live or renamed template through. None
    when it is not the member's live style."""
    if isinstance(style_id, str) and style_id.startswith(BUILTIN_PREFIX):
        raise StyleValidationError(S_BUILTIN_DELETE)
    owned = conn is None
    conn = conn or get_connection()
    began = False
    try:
        if not conn.in_transaction:
            _lock_for_style(conn)
            began = True
        r = _load_row(user_id, style_id, conn) if isinstance(style_id, str) else None
        if r is None:
            if began:
                conn.rollback()
            return None
        if r["archived_at"] is None:
            raise StyleValidationError(S_ARCHIVE_FIRST)
        if not isinstance(typed_name, str) or typed_name != r["name"]:
            raise StyleValidationError(S_TYPE_NAME)
        # commits the one transaction only when this call began it (fix round 2: never the caller's)
        if delete_style(user_id, style_id, conn, commit=began) is None:
            return None
        return _view_style(user_id, style_id, conn, include_deleted=True)
    except BaseException:
        if began and conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


_PROVENANCE_COLS = ("source_gallery_id", "source_version", "source_block_ids", "source_outline_hash")


def _provenance_of(user_id: str, style_id: Any, conn: sqlite3.Connection) -> tuple | None:
    """The library provenance of one of the member's own styles (a deleted one too: the note it shaped still came
    from the library), or None when it has none. Ruling P3a-T10-R6: a style made FROM a style that came from the
    community library keeps where it came from, so it cannot be shared as the member's own (template_gallery's
    R3/R5 refusal reads `source_gallery_id`)."""
    if not isinstance(style_id, str) or not style_id or style_id.startswith(BUILTIN_PREFIX):
        return None
    r = conn.execute("SELECT " + ", ".join(_PROVENANCE_COLS) + " FROM j2_journal_styles WHERE id = ? AND user_id = ?",
                     (style_id, user_id)).fetchone()
    if r is None or not r["source_gallery_id"]:
        return None
    return tuple(r[c] for c in _PROVENANCE_COLS)


def create_style(user_id: str, payload: Any, conn: sqlite3.Connection | None = None, *,
                 provenance: tuple | None = None, commit: bool = True) -> dict:
    """A new style. `payload.duplicateOf` (P3a-T10-R6) names the member's own style this one duplicates: its
    library provenance, if it has any, is carried to the copy. `provenance` is the internal form of the same (the
    note path, create_style_from_note; the library's adopt).

    `commit=False` (ruling P3a-FIN-R1) leaves the write open on the CALLER's connection, so a caller that has more
    to write (adopt: the use count, the watch) commits once and a failure leaves nothing behind. Ignored when this
    function opened the connection itself."""
    if not isinstance(payload, dict):
        raise StyleValidationError("Send a style object.")
    owned = conn is None
    conn = conn or get_connection()
    began = False
    try:
        dup = payload.get("duplicateOf")
        legacy = None
        if dup is not None:
            if not isinstance(dup, str) or not dup.strip():
                raise StyleValidationError("duplicateOf must be text")
            if not dup.startswith(BUILTIN_PREFIX):
                src = _load_row(user_id, dup, conn, include_deleted=True)
                if src is None:
                    raise StyleValidationError("You can only duplicate one of your own styles.")
                legacy = _legacy_blocks(src["blocks_json"])      # 11.3 re-review m-2: the copy keeps them too
            provenance = provenance or _provenance_of(user_id, dup, conn)
        name = _clean_name(payload.get("name"))
        kind = _clean_kind(user_id, payload.get("kindId"), conn)
        tpl = _clean_template(user_id, payload.get("outlineTemplateId"), conn)
        outline = _clean_outline(payload.get("outlineBodyJson"))
        blocks = _clean_blocks(payload.get("blocks"), legacy=legacy)
        props = _clean_properties(user_id, payload.get("properties"), conn)
        if not conn.in_transaction and (commit or owned):
            # Fix round 1 (M-3): the cap's count and the insert are ONE short write lock, the same one duplicate takes,
            # so a create and a duplicate at once cannot both pass the count at the cap. Everything slow (the cleaning
            # above) is done before it. A caller's own transaction (adopt, commit=False) is the caller's lock.
            _lock_for_style(conn)
            began = True
        n = conn.execute("SELECT COUNT(*) AS c FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL",
                         (user_id,)).fetchone()["c"]
        if n >= MAX_STYLES_PER_MEMBER:
            raise StyleValidationError(f"You can keep up to {MAX_STYLES_PER_MEMBER} styles. Delete one first.")
        sid, now = uuid.uuid4().hex, _now()
        conn.execute(
            "INSERT INTO j2_journal_styles (id, user_id, name, kind_id, outline_template_id, outline_body_json,"
            " blocks_json, properties_json, is_default, source_gallery_id, source_version, version,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 1, ?, ?)",
            (sid, user_id, name, kind, tpl, json.dumps(outline) if outline else None,
             json.dumps(blocks), json.dumps(props), now, now))
        if provenance:
            conn.execute("UPDATE j2_journal_styles SET " + ", ".join(f"{c} = ?" for c in _PROVENANCE_COLS)
                         + " WHERE id = ? AND user_id = ?", (*provenance, sid, user_id))
        if commit or owned or began:
            conn.commit()
        return get_style(user_id, sid, conn)
    except BaseException:
        if began and conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


_CONTENT_KEYS = {"kindId": "kind_id", "outlineTemplateId": "outline_template_id",
                 "outlineBodyJson": "outline_body_json", "blocks": "blocks_json", "properties": "properties_json"}


def _keep_remembered(sent: list[dict], stored_json: Any) -> list[dict]:
    """Ruling W11-R32: a save never silently undoes a remembered choice. For each family slot the save sends in its
    unanswered form (`template` / `inline`) while the STORED slot of that id is a remembered ref (`routine:`,
    `tracker:`, a check-in, or `def:`), the save is a stale copy of that slot: the stored ref is kept, with the
    save's own `bind` / `display` (`range` for a built slot), which ARE the member's edits. Only sending a
    different ref (an explicit change of the slot) replaces it. Remembering moves no version, so the version the
    editor loaded cannot tell a stale copy apart; the per-slot rule can."""
    try:
        stored = json.loads(stored_json or "[]")
    except (TypeError, ValueError):
        return sent
    refs = {b["block"]: b.get("settings") for b in stored if isinstance(b, dict) and isinstance(b.get("block"), str)
            and isinstance(b.get("settings"), dict) and isinstance(b["settings"].get("ref"), str)}
    out = []
    for b in sent:
        family = slot_family(b.get("block"))
        old = refs.get(b.get("block"))
        s = b.get("settings") if isinstance(b.get("settings"), dict) else {}
        if family is None or old is None or "ref" in s and not str(s.get("ref", "")).startswith("inline:"):
            out.append(b)
            continue
        if family in ("routine", "tracker") and ("template" in s or "inline" in s):
            keep = {"ref": old["ref"], "bind": s.get("bind", old.get("bind")),
                    "display": s.get("display", old.get("display"))}
        elif family == "built" and str(s.get("ref", "")).startswith("inline:") and str(old["ref"]).startswith("def:"):
            keep = {k: old[k] for k in ("ref", "defRev") if k in old}
            if "range" in s:
                keep["range"] = s["range"]
        else:
            out.append(b)
            continue
        try:
            out.append({**b, "settings": slot_settings_of(family, keep)})
        except StyleValidationError:
            out.append(b)
    return out


def update_style(user_id: str, style_id: str, patch: Any, conn: sqlite3.Connection | None = None, *,
                 commit: bool = True) -> dict | None:
    """Patch one of the member's styles. `commit=False` (ruling P3a-FIN-R1) leaves the write open on the caller's
    connection, so the library's apply commits the patch and its `source_*` record as ONE transaction under its
    `BEGIN IMMEDIATE`. Ignored when this function opened the connection itself."""
    if isinstance(style_id, str) and style_id.startswith(BUILTIN_PREFIX):
        raise StyleValidationError("Built-in styles can't be changed. Duplicate it to make your own.")
    if not isinstance(patch, dict):
        raise StyleValidationError("Send a style object.")
    owned = conn is None
    conn = conn or get_connection()
    began = False
    try:
        if "blocks" in patch and not conn.in_transaction:
            # Fix round 3 (W11-R32): read and write the blocks under ONE short write lock, so a choice remembered by
            # a create between this save's read and its write is seen by `_keep_remembered`, never overwritten.
            _lock_for_style(conn)
            began = True
        r = _load_row(user_id, style_id, conn)
        if r is None:
            if began:
                conn.rollback()
            return None
        sets, params, content_changed = [], [], False
        if "name" in patch:
            sets.append("name = ?"); params.append(_clean_name(patch["name"]))
        cleaned = {}
        if "kindId" in patch:
            cleaned["kindId"] = _clean_kind(user_id, patch["kindId"], conn)
        if "outlineTemplateId" in patch:
            cleaned["outlineTemplateId"] = _clean_template(user_id, patch["outlineTemplateId"], conn)
        if "outlineBodyJson" in patch:
            o = _clean_outline(patch["outlineBodyJson"])
            cleaned["outlineBodyJson"] = json.dumps(o) if o else None
        if "blocks" in patch:
            sent = _clean_blocks(patch["blocks"], legacy=_legacy_blocks(r["blocks_json"]))
            sent = _keep_remembered(sent, r["blocks_json"])
            # Final review I-1: a slot hidden from the client (its wave is off) is kept, not dropped, and
            # at the index it was STORED at (cleanup queue: it used to be appended, so a save while a wave
            # was off moved the slot to the end of the style for good).
            have = {b["block"] for b in sent}
            try:
                stored_blocks = json.loads(r["blocks_json"] or "[]")
            except (TypeError, ValueError):
                stored_blocks = []
            hide_ctx = _slot_ctx(user_id, conn, stored_blocks)     # the decision served_style made for them
            for i, b in _hidden_slots_at(r["blocks_json"], hide_ctx):
                if b["block"] not in have:
                    sent.insert(min(i, len(sent)), b)
            cleaned["blocks"] = json.dumps(sent)
        if "properties" in patch:
            cleaned["properties"] = json.dumps(_clean_properties(user_id, patch["properties"], conn))
        def effective(col: str) -> Any:
            # What compose reads from the stored value: a stale default or a gone template was already
            # ignored there, so dropping it on this save is not an edit and bumps no version (I-1).
            if col == "properties_json":
                try:
                    return json.dumps(_valid_defaults(user_id, json.loads(r[col] or "{}"), conn))
                except (TypeError, ValueError):
                    return r[col]
            if col == "outline_template_id":
                return _live_template(user_id, r[col], conn)
            return r[col]

        for key, value in cleaned.items():
            col = _CONTENT_KEYS[key]
            if effective(col) != value:
                content_changed = True
            sets.append(f"{col} = ?"); params.append(value)
        if "kindId" in cleaned and cleaned["kindId"] != r["kind_id"]:
            sets.append("is_default = 0")                       # a default belongs to its old kind
        if content_changed:
            sets.append("version = version + 1")
        if not sets:
            if began:
                conn.rollback()
            return _row(r, full=True)
        sets.append("updated_at = ?"); params.append(_now())
        conn.execute(f"UPDATE j2_journal_styles SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
                     (*params, style_id, user_id))
        if commit or owned or began:
            conn.commit()
        return get_style(user_id, style_id, conn)
    except BaseException:
        if began and conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def set_default(user_id: str, style_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        s = get_style(user_id, style_id, conn, full=False)
        if s is None:
            return None
        if not s["builtin"] and _wave11_on() and conn.execute(
                "SELECT archived_at FROM j2_journal_styles WHERE id = ? AND user_id = ?",
                (style_id, user_id)).fetchone()["archived_at"]:
            # W11-R10: an archived template is hidden from the default choice, so it cannot become the default.
            # W11-R38: only while wave 11 is on; with it off an archived template is an ordinary one.
            raise StyleValidationError(S_UNARCHIVE_FIRST)
        conn.execute("UPDATE j2_journal_styles SET is_default = 0 WHERE user_id = ? AND kind_id = ?"
                     " AND is_default = 1", (user_id, s["kindId"]))
        # The member has now CHOSEN this kind's default (the built-in included, which is otherwise
        # only the absence of a member default): a deleted style's remembered default is forgotten,
        # so Undo restores it as a non-default rather than taking the choice back (review M-3).
        conn.execute("UPDATE j2_journal_styles SET default_before_delete = 0 WHERE user_id = ? AND kind_id = ?"
                     " AND deleted_at IS NOT NULL AND default_before_delete = 1", (user_id, s["kindId"]))
        if not s["builtin"]:
            conn.execute("UPDATE j2_journal_styles SET is_default = 1 WHERE id = ? AND user_id = ?",
                         (style_id, user_id))
        conn.commit()
        return get_style(user_id, style_id, conn)
    finally:
        if owned:
            conn.close()


def delete_style(user_id: str, style_id: str, conn: sqlite3.Connection | None = None, *,
                 commit: bool = True) -> dict | None:
    """Soft delete (spec P1.4: with undo). Remembers whether it was the default, for restore. `commit=False`
    (Task 11.13 fix round 2) leaves the write in the CALLER's open transaction; ignored when this function opened
    the connection itself."""
    if isinstance(style_id, str) and style_id.startswith(BUILTIN_PREFIX):
        raise StyleValidationError("Built-in styles can't be deleted.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = _load_row(user_id, style_id, conn)
        if r is None:
            return None
        now = _now()
        conn.execute("UPDATE j2_journal_styles SET deleted_at = ?, default_before_delete = is_default,"
                     " is_default = 0, updated_at = ? WHERE id = ? AND user_id = ?", (now, now, style_id, user_id))
        if commit or owned:
            conn.commit()
        return get_style(user_id, style_id, conn, include_deleted=True)
    finally:
        if owned:
            conn.close()


def restore_style(user_id: str, style_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """Undo a delete. The default comes back only when the member has not chosen another default for
    that kind meanwhile (set_default forgets the remembered one) and none is set now.

    ⛔ The check and the write are ONE locked unit (BEGIN IMMEDIATE, the notes idiom), and the
    partial unique index's refusal is still caught: a default another writer set in between makes
    this a non-default restore, never a 500 that leaves the style deleted (review M-3). A restore is
    refused, not admitted past the cap, when the member is already at MAX_STYLES_PER_MEMBER."""
    from api.services.journal_two import notes as notes_service
    owned = conn is None
    conn = conn or get_connection()
    began = False
    try:
        if not conn.in_transaction:
            notes_service._begin_immediate(conn)
            began = True
        r = _load_row(user_id, style_id, conn, include_deleted=True)
        if r is None or r["deleted_at"] is None:
            if began:
                conn.rollback()
            return get_style(user_id, style_id, conn) if r else None
        if r["deleted_at"] < _deleted_cutoff():
            # W11-R10: Recently deleted keeps a template RECENTLY_DELETED_DAYS; after that it cannot come back (the row
            # stays, for the notes' style stamps).
            raise StyleValidationError(S_RESTORE_EXPIRED)
        if _nk().get_kind(user_id, r["kind_id"], conn) is None:
            # c3: deleting a kind keeps its deleted styles (never a hard delete); one of them cannot come back
            # holding a kind that no longer exists.
            raise StyleValidationError(S_RESTORE_KIND_GONE)
        n = conn.execute("SELECT COUNT(*) AS c FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL",
                         (user_id,)).fetchone()["c"]
        if n >= MAX_STYLES_PER_MEMBER:
            raise StyleValidationError(f"You can keep up to {MAX_STYLES_PER_MEMBER} styles. Delete one first.")
        # A restored row keeps its `archived_at` (Task 11.13): an archived template lands back in Archived, and,
        # while wave 11 is on (W11-R38), an archived one is never a kind's default.
        wave11 = _wave11_on()
        again = (bool(r["default_before_delete"]) and (r["archived_at"] is None or not wave11)
                 and _member_default(user_id, r["kind_id"], conn) is None)
        sql = ("UPDATE j2_journal_styles SET deleted_at = NULL, is_default = ?, default_before_delete = 0,"
               " updated_at = ? WHERE id = ? AND user_id = ?")
        try:
            conn.execute(sql, (1 if again else 0, _now(), style_id, user_id))
        except sqlite3.IntegrityError:
            conn.execute(sql, (0, _now(), style_id, user_id))
        conn.commit()
        # With wave 11 on, My tools reads where it landed (`archivedAt`); with it off the answer is today's (M-1).
        return _view_style(user_id, style_id, conn) if wave11 else get_style(user_id, style_id, conn)
    except BaseException:
        if began and conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def default_style_for_kind(user_id: str, kind_id: str, conn: sqlite3.Connection | None) -> dict:
    """The member's default for the kind, else the built-in style, else a BLANK style (a member's
    own kind with no style): no outline, no blocks, and `id` None, so a note records only its kind."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        mine = _member_default(user_id, kind_id, conn)
        if mine:
            return get_style(user_id, mine, conn)
        if kind_id in BUILTIN_STYLES:
            return _builtin(user_id, kind_id, conn, full=True)
        return {"id": None, "name": "", "kindId": kind_id, "builtin": False, "isDefault": False, "version": None,
                "outlineTemplateId": None, "hasOutline": False, "blocks": [], "properties": {},
                "outlineBodyJson": None}
    finally:
        if owned:
            conn.close()


def create_style_from_note(user_id: str, note_id: str, name: Any, kind_id: Any = None,
                           conn: sqlite3.Connection | None = None, left_out: list | None = None) -> dict | None:
    """"Save this note's setup as a style" (spec P1.4). The SERVER reads the note: the first node of
    each known block becomes a block (with its settings); the rest of the body is the outline; the
    note's user-set property values (not its kind) are the defaults.

    A TOP-LEVEL block leaves a {{block:id}} placeholder where it stood. A NESTED one (in a column, a
    callout, a list) leaves no placeholder -- the composer would only turn it into an empty paragraph
    and put the block after the first heading -- and every embed leaves the outline; a container a
    removal would empty keeps an empty paragraph (review I-1: two charts side by side must not
    save an empty column).

    `left_out` (review M-4), when given, receives each embed that did NOT become a block, once per
    (widgetId, reason) in the order met: {"widgetId", "reason": "not-a-style-block" | "repeat"} (a
    widget that is not a style block yet; a second copy of a block the style already holds)."""
    from api.services.journal_two import notes as notes_service
    owned = conn is None
    conn = conn or get_connection()
    try:
        note = notes_service.get_note(user_id, note_id, conn=conn)
        if note is None:
            return None
        blocks, seen = [], set()
        built_slots_on = _built_slots_on()
        tool_slots_on = _tool_slots_on()
        n_built = [0]
        n_tools = {"routine": 0, "tracker": 0}

        def leave_out(bid: Any, reason: str) -> None:
            entry = {"widgetId": bid if isinstance(bid, str) else None, "reason": reason}
            if left_out is not None and entry not in left_out:
                left_out.append(entry)

        def strip(content: list, top: bool) -> list:
            out = []
            for node in content:
                if (isinstance(node, dict) and node.get("type") == "widgetEmbed" and built_slots_on
                        and (node.get("attrs") or {}).get("widgetId") == _nw.BUILT_KIND):
                    # Wave 11 (Task 11.5): a placed built widget becomes a `built_<k>` slot pinned to its
                    # revision, in document order. Its viewer values (account, filter) stay in the note.
                    settings = built_slot_settings_of_node((node.get("attrs") or {}).get("params"))
                    if settings is None:
                        leave_out(_nw.BUILT_KIND, "not-a-style-block")
                    else:
                        sid = f"built_{slot_key(n_built[0])}"
                        n_built[0] += 1
                        blocks.append({"block": sid, "enabled": True, "settings": settings})
                        if top:
                            out.append(_ph(sid))
                    continue                                    # every embed leaves the outline
                if (isinstance(node, dict) and node.get("type") == "widgetEmbed" and tool_slots_on
                        and (node.get("attrs") or {}).get("widgetId") in _sf.TOOL_ID_KEYS):
                    # Task 11.6: a placed routine or tracker block becomes a `routine_<k>` / `tracker_<k>` slot naming
                    # the member's own tool, keeping its bind (Follow today saves as the note's day) and display.
                    family = node["attrs"]["widgetId"]
                    settings = tool_slot_settings_of_node(family, node["attrs"].get("params"))
                    if settings is None:
                        leave_out(family, "not-a-style-block")
                    else:
                        sid = f"{family}_{slot_key(n_tools[family])}"
                        n_tools[family] += 1
                        blocks.append({"block": sid, "enabled": True, "settings": settings})
                        if top:
                            out.append(_ph(sid))
                    continue                                    # every embed leaves the outline
                if isinstance(node, dict) and node.get("type") == "widgetEmbed":
                    bid = (node.get("attrs") or {}).get("widgetId")
                    # Wave 11: a slot family id is never a widget a note holds; such an embed stays left out.
                    if (isinstance(bid, str) and BLOCK_ID_RE.fullmatch(bid) and bid not in seen and bid in KNOWN_BLOCKS
                            and slot_family(bid) is None):
                        seen.add(bid)
                        params = (node.get("attrs") or {}).get("params") or {}
                        if bid in SNAPSHOT_SLOT_KINDS:
                            # Task 18 (R50): a snapshot slot's params ARE its frozen payload, the member's own
                            # data. It leaves the outline; `_clean_blocks` (via create_style) keeps only the
                            # builder's request keys from it as the slot's settings.
                            settings = params if isinstance(params, dict) else {}
                        else:
                            spec = {s["key"]: s for s in (_BLOCK_BY_ID.get(bid) or {}).get("settings", ())}
                            settings = {k: params[k] for k in spec if params.get(k) in spec[k]["options"]}
                        blocks.append({"block": bid, "enabled": True, "settings": settings})
                        if top:
                            out.append(_ph(bid))
                    else:
                        leave_out(bid, "repeat" if isinstance(bid, str) and bid in seen else "not-a-style-block")
                    continue                                    # every embed leaves the outline
                if isinstance(node, dict) and isinstance(node.get("content"), list):
                    node = {**node, "content": _never_empty(node["content"], strip(node["content"], False))}
                out.append(node)
            return out

        kind_prop = _nk().NOTE_KIND_PROPERTY
        outline = {"type": "doc", "content": strip((note.get("bodyJson") or {}).get("content") or [], True)}
        props = _valid_defaults(user_id, note.get("propertiesJson") or {}, conn)
        kind = kind_id or (note.get("propertiesJson") or {}).get(kind_prop) or note.get("kindId")
        # P3a-T10-R6: a note records the style it was made from (`j2_notes.style_id`, the style stamp). When that
        # style came from the community library, the style saved from the note keeps its provenance.
        return create_style(user_id, {"name": name if name else (note.get("title") or "My style"),
                                      "kindId": kind, "outlineBodyJson": outline, "blocks": blocks,
                                      "properties": props}, conn,
                            provenance=_provenance_of(user_id, note.get("styleId"), conn))
    finally:
        if owned:
            conn.close()


# ── The one composer (spec P1.3) ─────────────────────────────────────────────────────────────
# Used by styled create (Task 9), preview (Task 8) and update layout (Task 10). Outline body ->
# block nodes where the outline marks them (a paragraph that is exactly {{block:<id>}}), the rest
# after the first heading -> property defaults that still fit -> the kind.

PLACEHOLDER_RE = re.compile(r"^\{\{block:([a-zA-Z][a-zA-Z0-9_]{0,40})\}\}$")
SKIP_SENTENCES = {
    "needs-ticker": "Add a ticker to this note, then type /chart to add the chart.",
}


def _build_chart(block: dict, ctx: dict) -> tuple[dict | None, str | None]:
    """A chart of the note's ticker, frozen at `now` (the frozen-means-anchored rule of
    widgetEmbedCore.buildWidgetEmbedAttrs). No searchText, like sample_examples._chart_embed:
    the client never re-derives it and search does not need it for a fresh chart. Every attribute
    here is one widgetEmbedNode.jsx already declares (zero schema change)."""
    ticker = ctx.get("ticker")
    if not ticker:
        return None, "needs-ticker"
    now = ctx["now"]
    tf = (block.get("settings") or {}).get("tf") or "D"
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "chart", "embedId": uuid.uuid4().hex, "mode": "snapshot",
        "params": {"symbol": ticker, "tf": tf, "to": int(now.timestamp())},
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "annotations": [], "caption": None, "layout": {"width": "full", "height": None}, "fallback": None,
    }}, None


from api.services.journal_two import notebook_widgets as _nw  # noqa: E402 -- reads no journal_styles name

#: Task 15: a slot's skip reasons, one per kind, so the sentence can name the widget. "widget-failed:<kind>"
#: is a build that raised; "widget-preview:<kind>" is a preview (the style editor's, the community
#: library's), which never reads anyone's account: it names the widget instead.
for _kind in SNAPSHOT_SLOT_KINDS:
    SKIP_SENTENCES[f"widget-failed:{_kind}"] = f"{_nw.KIND_TITLE[_kind]} couldn't load. Type / to add it again."
    SKIP_SENTENCES[f"widget-preview:{_kind}"] = (
        f"{_nw.KIND_TITLE[_kind]} fills in with your own data when you make a note.")
del _kind


def _slot_wave_off(block_id: str, settings: Any = None, ctx: dict | None = None) -> bool:
    """Task 15: is this a slot whose release wave is off? Read per call. Such a slot is DROPPED (no node,
    no skip line, never offered), exactly as the slash menu hides the kind. ONE function decides, on every
    path: served_style, slotNames, preview, compose, update layout and kept-on-save (`_hidden_slots_at`).

    A snapshot slot: its kind's KIND_WAVE. Wave 11 (Task 11.3): a slot family id is hidden while wave 11 is
    off; a routine or tracker family also while wave 9 is off; a built family also while wave 8 is off and while
    its PINNED plan needs a dark wave (`uses_tools` and wave 9 off, `uses_wave10` and wave 10 off). A `shelf:`
    plan is read here; a `def:` / `inline:` plan needs the session member, so it is judged only when a slot ctx
    is given (`_slot_ctx`: the member's batched owned read, the inline definitions) through
    `slot_fill.plan_dark` (Task 11.5 fix round 1, I-2). Without a ctx it is shown (a reader with no member)."""
    family = slot_family(block_id)
    if family is not None:
        on = _nw.notebook_widgets_wave_on
        if not on(11):
            return True
        if family in ("routine", "tracker"):
            return not on(9)
        if not on(8):
            return True
        ref = settings.get("ref") if isinstance(settings, dict) else None
        if isinstance(ref, str) and ref.startswith("shelf:"):
            from api.services.journal_two.widget_engine import plan as wplan
            from api.services.journal_two.widget_engine import shelf
            pinned = shelf.revision(ref, settings.get("defRev"))
            plan = pinned.get("plan") if pinned else None
            if plan is not None:
                if wplan.uses_tools(plan) and not on(9):
                    return True
                if wplan.uses_wave10(plan) and not on(10):
                    return True
        elif ctx is not None and isinstance(ref, str) and family == "built":
            return _sf.plan_dark({"block": block_id, "settings": settings}, ctx)
        return False
    if block_id not in SNAPSHOT_SLOT_KINDS:
        return False
    if block_id in _WAVE11_SLOT_KIND_SET and not _nw.notebook_widgets_wave_on(11):
        return True                                       # W11-R20: as a template slot it is wave 11's
    return not _nw.notebook_widgets_wave_on(_nw.KIND_WAVE[block_id])


def slot_wave_off(block_id: str, settings: Any = None, ctx: dict | None = None) -> bool:
    """The public name of THE one visibility decider (Task 11.6, the 11.9 carry: other modules read this, never the
    private name). It calls `_slot_wave_off`, looked up at call time, so there is still exactly one implementation
    and a patch of the private name reaches every caller of either. ⛔ Never a second check."""
    return _slot_wave_off(block_id, settings, ctx)


def _slot_ctx(user_id: Any, conn: sqlite3.Connection | None, blocks: Any = None,
              definitions: dict | None = None) -> dict:
    """A slot ctx for the session member: their inline definitions, and every `def:` ref in `blocks` read in
    ONE owned statement (`slot_fill.prefetch`, I-3; Task 11.6: every `routine:` / `tracker:` ref too, one statement
    per family). `conn` is the caller's (this thread's) connection."""
    ctx = {"user_id": user_id, "conn": conn, "definitions": dict(definitions or {}), "defs": {}, "tools": {}}
    if user_id is not None:
        _sf.prefetch(blocks, ctx)
    return ctx


def _block_settings_by_id(blocks: Any) -> dict[str, Any]:
    """{block id: settings} for a style's block list (the first of each id), so a placeholder can be judged
    by the settings of the block it names."""
    out: dict[str, Any] = {}
    for b in blocks if isinstance(blocks, list) else []:
        if isinstance(b, dict) and isinstance(b.get("block"), str):
            out.setdefault(b["block"], b.get("settings"))
    return out


def _served(style: dict, ctx: dict | None) -> dict:
    out = dict(style)
    blocks = style.get("blocks")
    if isinstance(blocks, list):
        out["blocks"] = [b for b in blocks
                         if not (isinstance(b, dict) and isinstance(b.get("block"), str)
                                 and _slot_wave_off(b["block"], b.get("settings"), ctx))]
    by_id = _block_settings_by_id(blocks)

    def strip(content: list) -> list:
        kept = []
        for node in content:
            kind = _placeholder_kind(node)
            if kind is not None and _slot_wave_off(kind, by_id.get(kind), ctx):
                continue
            if isinstance(node, dict) and isinstance(node.get("content"), list):
                node = {**node, "content": _never_empty(node["content"], strip(node["content"]))}
            kept.append(node)
        return kept

    body = style.get("outlineBodyJson")
    if isinstance(body, dict) and isinstance(body.get("content"), list):
        out["outlineBodyJson"] = {**body, "content": strip(body["content"])}
    if ctx is not None:
        names = slot_names(out.get("blocks"), ctx["user_id"], ctx=ctx)
        if names:
            out["slotNames"] = names
    return out


def served_style(style: Any, user_id: Any = None, conn: sqlite3.Connection | None = None, *,
                 ctx: dict | None = None) -> Any:
    """Final review I-1: a style as the CLIENT is shown it. Every snapshot slot block whose wave is off
    is dropped, and so is its `{{block:<kind>}}` outline placeholder (at any depth), so the live style
    editor never names a dark widget: a dark surface is indistinguishable from none. Read per call.
    The STORED style is untouched (a copy is returned); `update_style` keeps a hidden slot on save.
    Wave 11 (W11-R21): given the session member's `user_id`, a slot whose member plan needs a dark wave is
    hidden too, and a style showing a family slot carries `slotNames` (each target resolved for that member
    only, in one batched read); a style showing none carries no key, so a dark wave 11 serves exactly what it
    did before. `ctx` is a `_slot_ctx` shared across styles (`served_styles`)."""
    if not isinstance(style, dict):
        return style
    if user_id is None and ctx is None:
        return _served(style, None)
    return _served(style, ctx if ctx is not None else _slot_ctx(user_id, conn, style.get("blocks")))


def served_styles(styles: list, user_id: Any, conn: sqlite3.Connection | None = None) -> list:
    """`served_style` over a list, with ONE batched read of every `def:` slot of every style (I-3)."""
    owned = conn is None and user_id is not None
    conn = conn or (get_connection() if owned else None)
    try:
        every = [b for s in styles if isinstance(s, dict) for b in (s.get("blocks") or [])]
        ctx = _slot_ctx(user_id, conn, every)
        return [served_style(s, user_id, ctx=ctx) for s in styles]
    finally:
        if owned:
            conn.close()


def _hidden_slots_at(blocks_json: Any, ctx: dict | None = None) -> list[tuple[int, dict]]:
    """(stored index, block) for each stored slot block `served_style` hides right now (its wave is off):
    a client never saw them, so a save cannot have meant to remove or move them. In stored order. `ctx` is the
    member's slot ctx (the same decision `served_style` made for them)."""
    try:
        stored = json.loads(blocks_json or "[]")
    except (TypeError, ValueError):
        return []
    return [(i, b) for i, b in enumerate(stored if isinstance(stored, list) else [])
            if isinstance(b, dict) and isinstance(b.get("block"), str)
            and _slot_wave_off(b["block"], b.get("settings"), ctx)]



def _build_widget_slot(block: dict, ctx: dict) -> tuple[dict | None, str | None]:
    """Task 15: a snapshot widget filled with the member's own payload at apply time, through the ONE
    builder the endpoint uses (notebook_widgets.build, looked up at call time so a test's patch reaches
    it). The node is the shape the client's widgetEmbedNode makes: params = the payload, capturedAt = its
    asOf. A build that raises (WidgetRequestError or anything else) leaves one sentence, never an empty
    embed. A preview (ctx["fill_widgets"] False) reads nothing and names the widget."""
    kind = block["block"]
    if not ctx.get("fill_widgets", True):
        return None, f"widget-preview:{kind}"
    settings = block.get("settings")
    try:
        payload = _nw.build(kind, ctx["user_id"], dict(settings) if isinstance(settings, dict) else {},
                            now=ctx["now"])
    except Exception as e:  # noqa: BLE001 -- a slot that cannot load is a sentence, never a failed note
        _log.warning("widget slot %s not built: %s", kind, type(e).__name__)
        return None, f"widget-failed:{kind}"
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": kind, "embedId": uuid.uuid4().hex, "mode": "snapshot",
        "params": payload, "capturedAt": payload.get("asOf") if isinstance(payload, dict) else None,
        "annotations": [], "caption": None, "layout": {"width": "full", "height": None}, "fallback": None,
    }}, None


#: Final review I-4: the slot builder's OWN bounded pool (never notebook_widgets' shared one: a slot task
#: waits on builder tasks there, so one shared full pool could deadlock). Created on first use, looked up
#: at call time; a saturated pool answers each slot's sentence at once instead of queueing.
SLOT_POOL_WORKERS = 8
_SLOT_POOL = None
#: How often a fill whose member's share is held by their other fills looks again.
_MEMBER_POLL_S = 0.02


def _slot_pool():
    global _SLOT_POOL
    if _SLOT_POOL is None:
        _SLOT_POOL = _nw.BoundedPool(SLOT_POOL_WORKERS, "nb-style-slot")
    return _SLOT_POOL


def _family_in_flight() -> int:
    """How many of ONE MEMBER's family slots may hold a pool permit at once, across every fill they have running:
    the engine's per-member gate (`run.MEMBER_MAX`), read at call time. More would only bounce off that gate."""
    from api.services.journal_two.widget_engine import run
    return max(1, int(run.MEMBER_MAX))


#: Fix round 2 (re-review m-1): the per-MEMBER count of family slot tasks holding a slot pool permit, process-wide
#: (⚠️ per-process state, like the pool itself). Taken by the dispatcher before a task is submitted; given back in
#: the task's own `finally`, or by the dispatcher when the task never ran (refused or cancelled).
_MEMBER_LOCK = threading.Lock()
_MEMBER_IN_FLIGHT: dict[Any, int] = {}


def _member_take(user_id: Any) -> bool:
    with _MEMBER_LOCK:
        n = _MEMBER_IN_FLIGHT.get(user_id, 0)
        if n >= _family_in_flight():
            return False
        _MEMBER_IN_FLIGHT[user_id] = n + 1
        return True


def _member_give(user_id: Any) -> None:
    with _MEMBER_LOCK:
        n = _MEMBER_IN_FLIGHT.get(user_id, 1) - 1
        if n > 0:
            _MEMBER_IN_FLIGHT[user_id] = n
        else:
            _MEMBER_IN_FLIGHT.pop(user_id, None)


def _member_task(fn: Callable, user_id: Any) -> Callable:
    def task(block: dict, ctx: dict):
        try:
            return fn(block, ctx)
        finally:
            _member_give(user_id)
    return task


def _build_slots_bounded(blocks: list[dict], ctx: dict) -> list[tuple[dict | None, str | None]]:
    """Task 15 fix round 1: every slot as a future under ONE total SLOT_BUDGET_S (the `_implied_moves`
    shape in notebook_widgets). A slot not finished when the budget runs out answers its
    "widget-failed:<kind>" reason. Nothing blocks past the budget: an unstarted future is cancelled and a
    straggler is never waited for. Final review I-4: the slots share this module's bounded pool, and a slot
    that finds it saturated answers its sentence at once.

    Task 11.5 fix round 1 (I-1) and round 2: a family slot is dispatched from THIS (the request) thread with at
    most `_family_in_flight()` of the MEMBER's family slots (every fill of theirs, `_member_take`) holding a pool
    permit; the rest queue here, never in the pool. A task that finds the engine busy answers `engine-busy` at once (no task ever sleeps holding a
    permit) and is re-dispatched after `slot_fill.BUSY_RETRY_S`, inside the same budget."""
    from collections import deque
    from concurrent.futures import FIRST_COMPLETED, wait
    results: list[tuple[dict | None, str | None] | None] = [None] * len(blocks)
    pool = _slot_pool()
    deadline = time.monotonic() + SLOT_BUDGET_S
    task_ctx = {**ctx, "conn": None}                  # a pool task never shares the caller's connection
    futs: dict = {}                                   # future -> block index
    queue: deque = deque()                            # family block indexes waiting to be dispatched
    ready_at: dict[int, float] = {}
    uid = ctx.get("user_id")

    def failed(i: int, why: str) -> None:
        _log.warning("widget slot %s not built: %s", blocks[i]["block"], why)
        results[i] = (None, f"widget-failed:{blocks[i]['block']}")

    for i, b in enumerate(blocks):
        if b["block"] in SNAPSHOT_SLOT_KINDS:
            fut = pool.try_submit(_build_widget_slot, b, task_ctx)
            if fut is None:
                failed(i, "the slot pool is saturated")
            else:
                futs[fut] = i
        else:
            queue.append(i)
    try:
        while True:
            now = time.monotonic()
            blocked = False
            while queue and ready_at.get(queue[0], 0.0) <= now:
                if not _member_take(uid):
                    blocked = True                    # the member's other slots hold the share: wait here
                    break
                i = queue.popleft()
                fut = pool.try_submit(_member_task(BLOCK_BUILDERS.get(blocks[i]["block"]), uid), blocks[i], task_ctx)
                if fut is None:
                    _member_give(uid)
                    failed(i, "the slot pool is saturated")
                    continue
                futs[fut] = i
            if not futs and not queue:
                break
            left = deadline - now
            if left <= 0:
                break
            nap = _MEMBER_POLL_S if blocked else max(0.0, ready_at.get(queue[0], now) - now) if queue else left
            if not futs:                              # only queued slots: busy, or the member's share is taken
                time.sleep(max(0.0, min(left, nap)))
                continue
            wait_s = min(left, nap) if queue else left
            done, _ = wait(list(futs), timeout=wait_s, return_when=FIRST_COMPLETED)
            for fut in done:
                i = futs.pop(fut)
                family = blocks[i]["block"] not in SNAPSHOT_SLOT_KINDS
                try:
                    got = fut.result()
                except Exception as e:  # noqa: BLE001 -- the builders catch their own; belt for the pool
                    failed(i, type(e).__name__)
                    continue
                reason = got[1] if isinstance(got, tuple) and len(got) == 2 else None
                if family and isinstance(reason, str) and reason.startswith(_sf.BUSY + ":"):
                    ready_at[i] = time.monotonic() + _sf.BUSY_RETRY_S
                    queue.append(i)
                else:
                    results[i] = got
    finally:
        for fut, i in futs.items():
            if fut.cancel() and blocks[i]["block"] not in SNAPSHOT_SLOT_KINDS:
                _member_give(uid)                     # never ran, so its own finally never gives it back
    for i, r in enumerate(results):
        if r is None:
            failed(i, f"over the {SLOT_BUDGET_S:.1f}s slot budget")
    return results


#: block id -> builder. ⛔ Every CATALOGUED id (iterating KNOWN_BLOCKS) has a builder (railed); P2 adds both
#: together. A slot family id is answered by its FAMILY's builder (`FAMILY_BUILDERS`, Task 11.5 adds `built`;
#: Task 11.6 adds `routine` and `tracker`), through `_Builders`' family-aware lookup.
from api.services.journal_two import trader_blocks as _tb  # noqa: E402 -- after BLOCK_KINDS, no cycle
from api.services.journal_two import reminder_block as _rb  # noqa: E402 -- reads no journal_styles name
from api.services.journal_two import slot_fill as _sf  # noqa: E402 -- imports journal_styles at call time only

#: Wave 11: one builder per slot family, `(block, ctx) -> (node | None, reason | None)`. A `(None, None)` answer
#: drops the slot with no node and no line (its plan needs a dark wave, as `_slot_wave_off` drops one).
FAMILY_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "built": _sf.build_built_slot, "routine": _sf.build_tool_slot, "tracker": _sf.build_tool_slot}
#: Wave 11 (R21): one name resolver per slot family, `(block, ctx) -> (name | None, reason | None)`, reason one of
#: `slot-missing` / `slot-unreadable` when the target does not resolve for the session member. Task 11.6: routine and
#: tracker names come from ONE batched owned read per family per request (`slot_fill.prefetch_tools`).
FAMILY_NAMERS: dict[str, Callable[[dict, dict], tuple[str | None, str | None]]] = {
    "built": _sf.slot_name, "routine": _sf.tool_name, "tracker": _sf.tool_name}
#: Wave 11: the widget's name for a sentence, per family (a family without one reads its family word).
FAMILY_TITLES: dict[str, Callable[[dict, dict], str]] = {
    "built": _sf.slot_title, "routine": _sf.tool_title, "tracker": _sf.tool_title}
#: Task 11.6: a routine or tracker slot in a preview (it reads nothing), by the slot's bind.
TOOL_PREVIEW_SENTENCES = {"note-day": "{name} goes here, for the day of your note.",
                          "next-trading-day": "{name} goes here, for the next trading day.",
                          "week": "{name} goes here, for the trading week."}
#: Task 11.6: the slot families built in the slot pool (they run the widget engine). Routine and tracker slots never
#: use the engine, so `compose` builds them on the request thread and they take no share of the member's engine slots.
POOLED_FAMILIES = frozenset({"built"})
_FAMILY_WORDS = {"built": "Widget", "routine": "Routine", "tracker": "Tracker"}


class _Builders(dict):
    """`BLOCK_BUILDERS`: iteration, length and keys are the catalogued ids (railed: `set(BLOCK_BUILDERS) ==
    KNOWN_BLOCKS`); `get`, `[]` and `in` ALSO answer a slot family id with its family's builder, so
    `BLOCK_BUILDERS.get(bid)` is the one lookup every caller (compose, update layout) makes."""
    __slots__ = ()

    @staticmethod
    def _family(key: object):
        fam = slot_family(key)
        return FAMILY_BUILDERS.get(fam) if fam else None

    def get(self, key, default=None):
        try:
            if dict.__contains__(self, key):
                return dict.__getitem__(self, key)
        except TypeError:
            return default
        found = self._family(key)
        return found if found is not None else default

    def __getitem__(self, key):
        found = self.get(key)
        if found is None:
            raise KeyError(key)
        return found

    def __contains__(self, key: object) -> bool:
        return self.get(key) is not None


BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = _Builders({
    "chart": _build_chart, _rb.BLOCK_ID: _rb.build_reminder, **_tb.BUILDERS,
    **{k: _build_widget_slot for k in SNAPSHOT_SLOT_KINDS}})
#: Blocks built only when a note is made (R-T2B-13). Update layout neither offers nor lists them.
#: Task 15: a snapshot slot too -- IR-S11, never today's data in an older note (an EMPTY note switched to
#: a style is a create, and fills).
#: Wave 11 (Task 11.3): every slot family id too (the `_KnownBlocks` prefix test), IR-S11: slots fill only when
#: a note is made. ⛔ 11.3 re-review m-4: membership here is flag-dependent like KNOWN_BLOCKS' (a
#: WAVE11_SLOT_KINDS id answers False while wave 11 is off), so test it only after the `_slot_wave_off` skip.
CREATE_ONLY_BLOCKS = _KnownBlocks({_rb.BLOCK_ID, *SNAPSHOT_SLOT_KINDS})

#: Wave 11 (Task 11.5): a family slot's sentences, by reason prefix. Member words only.
SLOT_MISSING_SENTENCES = {"built": "This widget is not in your account.",
                          "routine": "This routine is not in your account.",
                          "tracker": "This tracker is not in your account."}
#: Fix round 1 (m-1): a plan made with a newer app (`plan.S_TOO_NEW`, restated: plan is imported lazily here).
#: Fix round 1 (I3, W11-R30): a template slot that could not be asked here (switching a note to a style).
SLOT_UNANSWERED_SENTENCES = {"built": "Make a new note from this template to choose its widget.",
                             "routine": "Make a new note from this template to choose its routine.",
                             "tracker": "Make a new note from this template to choose its tracker."}
SLOT_TOO_NEW_SENTENCE = "This widget was made with a newer version of the app. Reload to use it."
SLOT_UNREADABLE_SENTENCES = {"built": "This widget couldn't be read.",
                             "routine": "This routine couldn't be read.",
                             "tracker": "This tracker couldn't be read."}


def _family_title(block: dict, ctx: dict) -> str:
    fam = slot_family(block.get("block") if isinstance(block, dict) else None)
    titler = FAMILY_TITLES.get(fam)
    return titler(block, ctx) if titler else _FAMILY_WORDS.get(fam, "Widget")


def slot_skip_sentence(block: dict, reason: Any, ctx: dict) -> str | None:
    """The one line a family slot leaves when it is not filled, or None (no line). `slot-missing:*` and
    `slot-unreadable:*` read per family; `widget-failed:*` and `widget-preview:*` name the widget (the snapshot
    kinds' wording). Not a family slot -> None (`compose` reads SKIP_SENTENCES for the rest)."""
    fam = slot_family(block.get("block") if isinstance(block, dict) else None)
    if fam is None or not isinstance(reason, str):
        return None
    prefix = reason.split(":", 1)[0]
    if prefix == _sf.MISSING:
        return SLOT_MISSING_SENTENCES[fam]
    if prefix == _sf.UNREADABLE:
        return SLOT_UNREADABLE_SENTENCES[fam]
    if prefix == _sf.TOO_NEW:
        return SLOT_TOO_NEW_SENTENCE
    if prefix in (_sf.FAILED, _sf.BUSY):
        return f"{_family_title(block, ctx)} couldn't load. Type / to add it again."
    if prefix == _sf.PREVIEW:
        return f"{_family_title(block, ctx)} fills in with your own data when you make a note."
    if prefix == _sf.UNANSWERED:
        return SLOT_UNANSWERED_SENTENCES[fam]
    if prefix == _sf.TOOL_PREVIEW:
        s = _sf.tool_settings(block)
        words = TOOL_PREVIEW_SENTENCES.get(s["bind"] if s else "note-day", TOOL_PREVIEW_SENTENCES["note-day"])
        return words.format(name=_family_title(block, ctx))
    return None


def slot_names(blocks: Any, user_id: Any, conn: sqlite3.Connection | None = None,
               definitions: dict | None = None, *, ctx: dict | None = None) -> dict[str, str]:
    """Ruling W11-R21: `{block id: display name}` for each family slot shown (its wave on): the member's own
    target's name (resolved `WHERE id = ? AND user_id = ?`), else the slot's unresolved sentence. Family-generic:
    a family with no resolver in `FAMILY_NAMERS` (yet) is left out. Served as `slotNames` (served_style, compose,
    preview) and read by the client's `slotLabel(b, names)` by block id. Every `def:` name comes from ONE batched
    owned read per request (`ctx`, `_slot_ctx`); a name past the read budget is the family word."""
    out: dict[str, str] = {}
    if ctx is None:
        ctx = _slot_ctx(user_id, conn, blocks, definitions)
    for b in blocks if isinstance(blocks, list) else []:
        if not isinstance(b, dict):
            continue
        bid = b.get("block")
        fam = slot_family(bid)
        if fam is None or bid in out or _slot_wave_off(bid, b.get("settings"), ctx):
            continue
        namer = FAMILY_NAMERS.get(fam)
        if namer is None:
            continue
        name, reason = namer(b, ctx)
        out[bid] = name if name else (slot_skip_sentence(b, f"{reason}:{bid}", ctx) or _FAMILY_WORDS[fam])
    return out


def _switched_off(block_id: str) -> bool:
    """P2 Tier 3 final fix M1: is this a Tier 3 block while JOURNAL_TIER3_ENABLED is off? Such a block is
    DROPPED from a build (no node, no skip line), exactly as the slash menu and the style editor hide it,
    so a style made while the switch was on creates nothing once it is off. Read per call."""
    if block_id not in _tb.TIER3_BLOCK_IDS:
        return False
    from api.services.journal_two import checklist_suggestions   # the module that declares the switch
    return not checklist_suggestions.enabled()

#: A builder's `ctx["mode"]` (IR-S11, integrator ruling R-RC-1): "create" when it serves a NEW note
#: (a market context captures), "update" when it offers a block to a note already written (it
#: arrives uncaptured). An EMPTY note switched to a style is create-equivalent. Every caller of
#: `compose` passes the mode it means, and the update dry run reports the mode the write will use.
BUILD_MODES = ("create", "update")


def _plain(node: Any) -> str:
    return "".join(c.get("text", "") for c in (node.get("content") or [])
                   if isinstance(c, dict) and c.get("type") == "text") if isinstance(node, dict) else ""


def _placeholder_kind(node: Any) -> str | None:
    if not isinstance(node, dict) or node.get("type") != "paragraph":
        return None
    m = PLACEHOLDER_RE.match(_plain(node).strip())
    return m.group(1) if m else None


def _after_first_heading(content: list) -> int:
    for i, n in enumerate(content):
        if isinstance(n, dict) and n.get("type") == "heading":
            return i + 1
    return 0


def _outline_doc(user_id: str, style: dict, conn: sqlite3.Connection) -> dict:
    """A COPY of the outline to compose into: the linked member template when it still exists,
    else the style's inline outline, else an empty doc (never a failed create).
    P2 Tier 3 final fix I1: a member's outline is copied into a new note, so its check-ins start
    unpicked (`_tb.unpick_checkins`, which copies). A built-in outline holds none."""
    if style.get("builtin"):
        return copy.deepcopy(BUILTIN_STYLES[style["kindId"]]["outline"])
    tid = style.get("outlineTemplateId")
    if tid:
        r = conn.execute("SELECT body_json FROM j2_note_templates WHERE id = ? AND user_id = ?",
                         (tid, user_id)).fetchone()
        if r and r["body_json"]:
            try:
                body = json.loads(r["body_json"])
                if isinstance(body, dict) and body.get("type") == "doc":
                    return _tb.unpick_checkins(body)
            except (TypeError, ValueError):
                pass
    body = style.get("outlineBodyJson")
    if isinstance(body, dict) and body.get("type") == "doc":
        return _tb.unpick_checkins(body)
    return {"type": "doc", "content": []}


def _enabled_blocks(blocks: Any) -> tuple[dict[str, dict], set[str]]:
    """({block id: its first ENABLED block}, {ids listed disabled}), in the style's block order."""
    enabled: dict[str, dict] = {}
    disabled: set[str] = set()
    for b in blocks if isinstance(blocks, list) else []:
        if not isinstance(b, dict) or not isinstance(b.get("block"), str):
            continue
        if b.get("enabled"):
            enabled.setdefault(b["block"], b)
        else:
            disabled.add(b["block"])
    return enabled, disabled


def _rest_after_heading(enabled: dict[str, dict], placed: set[str]) -> list[str]:
    """The enabled blocks no top-level placeholder placed, in block order: compose puts them after the first heading."""
    return [bid for bid in enabled if bid not in placed]


def placement_order(content: Any, blocks: Any) -> list[str]:
    """Ruling W11-R28: the block ids in the order a note made from them shows them: `compose`'s placement (an enabled
    block at its TOP-LEVEL placeholder; the rest, `_rest_after_heading`, right after the first heading, or first when
    there is none; a nested placeholder places nothing). Each id once, at its first place. Both `compose` and
    `slot_fill.tool_questions` read the same two helpers, so the questions follow the note."""
    enabled, _disabled = _enabled_blocks(blocks)
    seq: list[str] = []
    heading_at: int | None = None
    for node in content if isinstance(content, list) else []:
        if heading_at is None and isinstance(node, dict) and node.get("type") == "heading":
            heading_at = len(seq)
        bid = _placeholder_kind(node)
        if bid is not None and bid in enabled:
            seq.append(bid)
    placed = set(seq)
    i = heading_at if heading_at is not None else 0
    out = seq[:i] + _rest_after_heading(enabled, placed) + seq[i:]
    return list(dict.fromkeys(out))


def compose(user_id: str, style: dict, *, ticker: str | None, conn: sqlite3.Connection | None,
            now: datetime | None = None, mode: str = "create",
            after_build: Callable[[dict, dict], dict] | None = None, fill_widgets: bool = True,
            definitions: dict | None = None, note_day: str | None = None, answers: dict | None = None,
            choices: dict | None = None, inline_routines: dict | None = None,
            inline_trackers: dict | None = None, gallery_id: str | None = None,
            template_title: str | None = None, tool_answers: bool = True, tools_later: bool = False) -> dict:
    """`after_build(doc, ctx) -> doc` is called in create mode only, once every block is placed (Tier 2
    part A, /plan: one more step on the SAME body, inside the same read budget).
    `fill_widgets=False` (the preview, Task 15): a snapshot slot reads nobody's account and is named.
    Wave 11: `definitions` is `{key: definition}` for a template's `inline:` refs (the caller of a use or an
    adoption sets it), `note_day` the new note's day (default: the ET day of `now`). The answer carries
    `slotNames` (W11-R21) when the style shows a family slot.
    Task 11.6: `choices` answers each `template` / `inline` routine and tracker slot (`{block id: {"use": id} |
    {"create": True}}`, `slot_fill.build_tool_slot`), `inline_routines` / `inline_trackers` are a shared payload's
    tools by inline key, `gallery_id` the gallery item it came from (default: the style's `sourceGalleryId`) and
    `template_title` the title a created tool records (default: the style's name). A tool this compose created is
    listed as `toolsCreated` (`{block id: tool id}`), and every template slot this compose answered (created or a
    VERIFIED `{"use"}`) as `toolsChosen` (`{block id: tool id}`, what `slot_fill.remember_choices` may remember).
    `tool_answers=False` (fix round 1, I3 / ruling W11-R30): there is no surface to answer on (switching a note to a
    style), so an unanswered template slot is skipped with its line, exactly as the update dry run plans it.
    `tools_later=True` (fix round 2, W11-R31): routine and tracker slots are left as in-place markers for
    `_finish_tools`, so the slow part of a create (the built slots) runs before the style's write lock is taken."""
    if mode not in BUILD_MODES:
        raise ValueError(f"unknown build mode {mode!r}")
    owned = conn is None
    conn = conn or get_connection()
    try:
        now = now or datetime.now(timezone.utc)
        if note_day is None:
            from api.services.journal_two import trading_days
            note_day = trading_days.et_day_of(now.isoformat())
        ctx = {"ticker": ticker, "now": now, "memo": {}, "mode": mode,
               "user_id": user_id, "fill_widgets": fill_widgets, "definitions": dict(definitions or {}),
               "note_day": note_day, "answers": dict(answers or {}), "choices": dict(choices or {}), "conn": conn,
               "defs": {}, "tools": {}, "inline_routines": dict(inline_routines or {}),
               "inline_trackers": dict(inline_trackers or {}),
               "gallery_id": gallery_id if gallery_id is not None else style.get("sourceGalleryId"),
               "template_title": template_title if template_title is not None else style.get("name"),
               "tool_answers": tool_answers}
        _sf.prefetch(style.get("blocks"), ctx)            # ONE owned read of every def: slot (I-3)
        if mode == "create":
            # R-T12-C: ONE read budget for every block this create builds (trader_blocks owns the number).
            # A block still to read when it runs out lands uncaptured; an update reads nothing anyway.
            _tb.start_budget(ctx["memo"])
        doc = _outline_doc(user_id, style, conn)
        enabled, disabled = _enabled_blocks(style.get("blocks"))
        skipped: list[dict] = []
        placed: set[str] = set()

        def note_skip(bid: str, reason: str) -> None:
            if {"block": bid, "reason": reason} not in skipped:
                skipped.append({"block": bid, "reason": reason})

        deferred: list[tuple[dict, dict]] = []              # (marker node, block): slots, built last

        def build(b: dict) -> list[dict]:
            if _switched_off(b["block"]) or _slot_wave_off(b["block"], b.get("settings"), ctx):
                return []                                   # M1: hidden, as the insert menu hides it
            if b["block"] in SNAPSHOT_SLOT_KINDS or (slot_family(b["block"]) in POOLED_FAMILIES
                                                     and b["block"] in BLOCK_BUILDERS):
                # Wave 11 (Task 11.5): a built slot is deferred like a snapshot slot (built last, in the slot pool,
                # under SLOT_BUDGET_S). Task 11.6: a routine or tracker slot is not (POOLED_FAMILIES): it is built
                # here, in place, on this thread and connection, and never takes a share of the engine.
                # Keeps the slot's PLACE. Matched below by its key, not by identity, so a prefill that copies the
                # doc cannot strand one; every marker is replaced before the body is returned.
                marker = {"type": "paragraph", _SLOT_MARK: len(deferred)}
                deferred.append((marker, b))
                return [marker]
            if tools_later and slot_family(b["block"]) in _sf.TOOL_ID_KEYS:
                # Fix round 2 (W11-R31): the slot keeps its PLACE and is filled in the short locked step
                # (`_finish_tools`), from the style as it stands under the lock.
                return [{"type": "paragraph", _TOOL_MARK: b["block"]}]
            builder = BLOCK_BUILDERS.get(b["block"])
            if builder is None:
                note_skip(b["block"], "unknown-block")
                return []
            node, reason = builder(b, ctx)
            if node is None and slot_family(b["block"]):
                # Task 11.6: a routine or tracker slot built in place answers like a deferred slot: (None, None) is
                # dropped with no line, else its one family sentence.
                if reason is None:
                    return []
                note_skip(b["block"], reason)
                line = slot_skip_sentence(b, reason, ctx)
                return [_p(line)] if line else []
            if node is None:
                note_skip(b["block"], reason)
                return [_p(SKIP_SENTENCES[reason])] if reason in SKIP_SENTENCES else []
            return [node]

        def walk(content: list, top: bool) -> list:
            out = []
            for node in content:
                if (isinstance(node, dict) and node.get("type") == "widgetEmbed"
                        and _switched_off((node.get("attrs") or {}).get("widgetId"))):
                    continue                                # R-T3-FIN-4: an outline's own Tier 3 node, dropped like a built one
                bid = _placeholder_kind(node)
                if bid is not None and bid not in enabled and bid not in disabled:
                    # Review M-5: a placeholder for a block the style does not list is the member's
                    # own text (an old template, a typed note): kept, and named, never removed.
                    note_skip(bid, "not-in-style")
                    out.append(node)
                    continue
                if bid is not None:
                    if not top:
                        # ⛔ Review I-1: a block is placed in place ONLY at the doc's top level. A
                        # widgetEmbed is not valid as a list item's first child, and a drop could
                        # empty a container; a nested placeholder becomes an empty paragraph (valid
                        # in every container) and its block falls through to after the first heading.
                        out.append({"type": "paragraph"})
                    elif bid in enabled:
                        out.extend(build(enabled[bid]))
                        placed.add(bid)
                    continue                                # a disabled block's top-level placeholder vanishes
                if isinstance(node, dict) and isinstance(node.get("content"), list):
                    node = {**node, "content": _never_empty(node["content"], walk(node["content"], False))}
                out.append(node)
            return out

        doc["content"] = walk(doc.get("content") or [], True)
        rest: list[dict] = []
        for bid in _rest_after_heading(enabled, placed):
            rest.extend(build(enabled[bid]))
        if rest:
            i = _after_first_heading(doc["content"])
            doc["content"][i:i] = rest
        if not doc["content"]:
            doc["content"] = [{"type": "paragraph"}]
        if mode == "create" and after_build is not None:
            # Tier 2 part A (/plan): one more step on the SAME body, inside the same read budget.
            doc = after_build(doc, ctx)
        if deferred:
            # Task 15 fix round 1: the slots, LAST (after the prep pack and the prefill spent their budget),
            # each a bounded future under ONE shared SLOT_BUDGET_S. Late or failed -> the sentence.
            built_slots = _build_slots_bounded([b for _, b in deferred], ctx)
            by_index = {i: (b, built_slots[i]) for i, (_, b) in enumerate(deferred)}

            def place(content: list) -> list:
                out = []
                for n in content:
                    hit = by_index.get(n.get(_SLOT_MARK)) if isinstance(n, dict) and _SLOT_MARK in n else None
                    if hit is None:
                        out.append(n)
                        continue
                    b, (node, reason) = hit
                    if node is not None:
                        out.append(node)
                    elif reason is not None:                # (None, None): dropped, no node and no line
                        note_skip(b["block"], reason)
                        line = (slot_skip_sentence(b, reason, ctx) if slot_family(b["block"])
                                else SKIP_SENTENCES.get(reason))
                        if line:
                            out.append(_p(line))
                return out

            doc["content"] = place(doc["content"]) or [{"type": "paragraph"}]
        props = _valid_defaults(user_id, style.get("properties") or {}, conn)
        props[_nk().NOTE_KIND_PROPERTY] = style["kindId"]
        if mode == "create":
            # R-P2-6 / R-RC-1: only a create (or its equivalent) records the regime it was written
            # in, and only from the reading its own builder froze on ctx (never a scan of the body).
            from api.services.journal_two import note_properties as np_
            reg = _captured_regime(ctx)
            if reg:
                props[np_.REGIME_AT_WRITE] = reg
        out = {"bodyJson": doc, "properties": props, "skipped": skipped,
               "styleId": style.get("id"), "styleVersion": style.get("version"), "kindId": style["kindId"]}
        names = slot_names(style.get("blocks"), user_id, ctx=ctx)
        if names:
            out["slotNames"] = names
        if ctx.get("created"):
            out["toolsCreated"] = dict(ctx["created"])
        if ctx.get("chosen"):
            out["toolsChosen"] = dict(ctx["chosen"])
        return out
    finally:
        if owned:
            conn.close()


#: Task 11.6: `answers` / `choices` on a styled create that are not objects.
S_BAD_ANSWERS = "These template answers couldn't be read."


def _asks_tools(style: dict) -> bool:
    """Task 11.6 fix round 1 (I1): does this member's own style hold a `template` / `inline` routine or tracker slot
    that is enabled and shown now (the one decider)? Only then does a styled create take the style's write lock:
    that slot's answer will be remembered on the style, and two creates must not answer it differently."""
    if style.get("builtin"):
        return False
    for b in style.get("blocks") or []:
        if (isinstance(b, dict) and b.get("enabled") and slot_family(b.get("block")) in _sf.TOOL_ID_KEYS
                and not slot_wave_off(b["block"], b.get("settings"))):
            s = _sf.tool_settings(b)
            if s is not None and "ref" not in s:
                return True
    return False


#: Task 11.6 fix round 1 (I1): how long a styled create waits for another create of the same member's style to
#: finish before it gives up (the other holds the write lock only while it composes and inserts one note).
STYLE_LOCK_WAIT_S = 8.0


def _lock_for_style(conn: sqlite3.Connection) -> None:
    """`BEGIN IMMEDIATE` on the caller's connection, retried until STYLE_LOCK_WAIT_S has passed."""
    from api.services.journal_two.widget_definitions import _begin_immediate
    deadline = time.monotonic() + STYLE_LOCK_WAIT_S
    while True:
        try:
            _begin_immediate(conn)
            return
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower() or time.monotonic() >= deadline:
                raise
            time.sleep(0.05)


def _finish_tools(doc: dict, style: dict, ctx: dict, skipped: list) -> dict:
    """Fix round 2 (W11-R31): fill the routine and tracker markers `compose(tools_later=True)` left, from the style AS
    IT STANDS NOW (read under the lock): a slot another create already remembered is a ref, and this note adopts it
    (I1). A marker whose block is gone, disabled or hidden now is dropped with no line. Runs inside the caller's short
    write transaction; creating a tool joins it."""
    current = {b["block"]: b for b in style.get("blocks") or []
               if isinstance(b, dict) and isinstance(b.get("block"), str) and b.get("enabled")}

    def fill(content: list) -> list:
        out = []
        for n in content:
            if isinstance(n, dict) and _TOOL_MARK in n:
                b = current.get(n[_TOOL_MARK])
                if b is None or _slot_wave_off(b["block"], b.get("settings"), ctx):
                    continue
                node, reason = _sf.build_tool_slot(b, ctx)
                if node is not None:
                    out.append(node)
                elif reason is not None:
                    if {"block": b["block"], "reason": reason} not in skipped:
                        skipped.append({"block": b["block"], "reason": reason})
                    line = slot_skip_sentence(b, reason, ctx)
                    if line:
                        out.append(_p(line))
                continue
            if isinstance(n, dict) and isinstance(n.get("content"), list):
                n = {**n, "content": fill(n["content"])}
            out.append(n)
        return out
    return {**doc, "content": fill(doc.get("content") or []) or [{"type": "paragraph"}]}


#: Fix round 2 (W11-R31): how many unlocked composes a styled create tries before it settles for the last one.
STYLE_COMPOSE_TRIES = 2


def create_styled_note(user_id: str, payload: dict, conn: sqlite3.Connection | None = None) -> tuple[dict, list]:
    """A note made from a style (`styleId`, which wins) or from a kind's default style (`kindId`),
    composed here and written in ONE insert: body, property values and the style stamp, so there is
    no follow-up write and no second revision. Returns `(note, skipped)`. Behind journal_two's
    `POST /api/j2/notes` (spec P1.3: never a second way to make a note); the caller has already
    checked the switch and the plan.

    Raises StyleNotFound (no such live style for this member), StyleValidationError (a bad
    styleId, an unknown kind) and notes.NoteValidationError (the title, ticker, folder...)."""
    from api.services.journal_two import notes as notes_service, plan_prefill
    owned = conn is None
    conn = conn or get_connection()
    try:
        style_id, kind_id = payload.get("styleId"), payload.get("kindId")
        if style_id is not None:
            if not isinstance(style_id, str) or not style_id.strip():
                raise StyleValidationError("styleId must be text")
            style = get_style(user_id, style_id.strip(), conn)
            if style is None:
                raise StyleNotFound(style_id)
        else:
            if _nk().get_kind(user_id, kind_id, conn) is None:
                raise StyleValidationError("Choose a kind of note.")
            style = default_style_for_kind(user_id, kind_id, conn)
        ticker = notes_service._validate_ticker(payload.get("ticker"))
        prefill = None
        if payload.get("planPrefill") is True:
            # Tier 2 part A (/plan): the member's own levels, a dated price and a source link, added to
            # the SAME body in this create's one insert. Only a Trade plan with a ticker can take them.
            if style.get("kindId") != plan_prefill.PLAN_KIND or not ticker:
                raise StyleValidationError("A trade plan needs a ticker.")
            prefill = lambda doc, ctx: plan_prefill.apply(doc, ctx, conn)  # noqa: E731
        followup = payload.get("earningsFollowup")
        if followup is not None:
            # Tier 2 part B (R-T2B-9): the prep-note link and the quarter's numbers, added to the SAME body
            # in this create's one insert. One prefill per create.
            # Imported HERE and not at the top: a create that is not a follow-up never loads followup_prefill
            # (and through it earnings_prep and sample_examples).
            from api.services.journal_two import followup_prefill
            if prefill is not None:
                raise StyleValidationError("Choose one: a trade plan or an earnings follow-up.")
            report_date = followup_prefill.clean_request(followup, kind_id=style.get("kindId"), ticker=ticker)
            prefill = lambda doc, ctx: followup_prefill.apply(doc, ctx, conn, report_date)  # noqa: E731
        answers, choices = payload.get("answers"), payload.get("choices")
        if answers is not None and not isinstance(answers, dict):
            raise StyleValidationError(S_BAD_ANSWERS)
        if choices is not None and not isinstance(choices, dict):
            raise StyleValidationError(S_BAD_ANSWERS)
        # Task 11.6 (W11-R14): the new note's day is the ET day it is made (a styled note has no daily date); every
        # routine and tracker slot binds from it.
        from api.services.journal_two import tool_binding
        now = datetime.now(timezone.utc)
        note_day = tool_binding.note_day(daily_date=None, created_at=now.isoformat(), now=now)
        began = False
        if _asks_tools(style):
            # Fix round 3 (m-2): a create that will be refused fails here, before any compose or engine run.
            _sf.prevalidate_answers(style, choices, user_id=user_id, conn=conn)
        if _asks_tools(style) and not conn.in_transaction:
            # Fix round 1 (I1) and round 2 (ruling W11-R31): the slow part (the built slots, the prep pack) is
            # composed WITHOUT any lock, routine and tracker slots left as markers. Then ONE short IMMEDIATE
            # transaction: re-read the style, fill the tool slots from it (validated as the member's own, a slot
            # another create already remembered adopted as its ref), create or restore the tool, remember, insert.
            # A style whose version moved while composing is composed again, once; past that the last body is used
            # and only its tool slots, cheap, are taken from the style under the lock. The lock is never held
            # across a built-slot run or any engine call (the 2026-07-01 auth.db outage class).
            composed_from = style
            current = style
            for attempt in range(STYLE_COMPOSE_TRIES):
                composed = compose(user_id, composed_from, ticker=ticker, conn=conn, mode="create",
                                   after_build=prefill, now=now, note_day=note_day, answers=answers,
                                   choices=choices, tools_later=True)
                _lock_for_style(conn)
                began = True
                current = get_style(user_id, style["id"], conn)
                if current is None:
                    conn.rollback()
                    raise StyleNotFound(style_id)
                if current["version"] == composed_from["version"] or attempt == STYLE_COMPOSE_TRIES - 1:
                    break
                conn.rollback()                              # never compose while holding the lock
                began = False
                composed_from = current
            try:
                ctx = {"user_id": user_id, "conn": conn, "now": now, "note_day": note_day, "fill_widgets": True,
                       "choices": dict(choices or {}), "answers": dict(answers or {}), "tool_answers": True,
                       "inline_routines": {}, "inline_trackers": {}, "definitions": {}, "defs": {}, "tools": {},
                       "gallery_id": current.get("sourceGalleryId"), "template_title": current.get("name")}
                body = _finish_tools(composed["bodyJson"], current, ctx, composed["skipped"])
                base = {k: payload[k] for k in ("title", "subtitle", "tags", "ticker", "folderId") if k in payload}
                base["bodyJson"] = body
                if ctx.get("chosen"):
                    # Only the answers verified as the member's own, for slots filled now (I2). No version moves.
                    _sf.remember_choices(user_id, current["id"], {}, ctx["chosen"], conn=conn)
                note = notes_service.create_note(
                    user_id, base, conn, properties=composed["properties"], captured_properties="keep",
                    style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))
            except BaseException:
                if conn.in_transaction:
                    conn.rollback()
                raise
            return note, composed["skipped"]
        try:
            composed = compose(user_id, style, ticker=ticker, conn=conn, mode="create", after_build=prefill,
                               now=now, note_day=note_day, answers=answers, choices=choices)
            base = {k: payload[k] for k in ("title", "subtitle", "tags", "ticker", "folderId") if k in payload}
            base["bodyJson"] = composed["bodyJson"]
            if composed.get("toolsChosen") and not style.get("builtin"):
                # A caller's own transaction (or no unanswered tool slot): remember in that same transaction.
                _sf.remember_choices(user_id, style["id"], {}, composed["toolsChosen"], conn=conn)
            note = notes_service.create_note(
                user_id, base, conn, properties=composed["properties"], captured_properties="keep",
                style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))
        except BaseException:
            if began and conn.in_transaction:
                conn.rollback()
            raise
        return note, composed["skipped"]
    finally:
        if owned:
            conn.close()


def latest_ticker(user_id: str, conn: sqlite3.Connection) -> str | None:
    """The ticker on the member's newest note: the preview's "your latest note's" ticker.
    ⛔ Never a sample note's (sample_marker): an example ticker is not one the member wrote about."""
    r = conn.execute("SELECT ticker FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL AND ticker IS NOT NULL"
                     " AND ticker != '' AND " + sample_marker.not_sample_sql()
                     + " ORDER BY updated_at DESC, rowid DESC LIMIT 1", (user_id,)).fetchone()
    return r["ticker"] if r else None


def preview(user_id: str, payload: Any, conn: sqlite3.Connection | None = None) -> dict:
    """A read-only compose for the live preview (spec P1.4), with the member's OWN data: their ticker
    (asked for, else their latest note's) and their property definitions. Writes nothing.
    `payload` is {"styleId"} for a saved style, or {"style": {...}} for an unsaved draft."""
    from api.services.journal_two import notes as notes_service
    if not isinstance(payload, dict):
        raise StyleValidationError("Send a style to preview.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        if payload.get("styleId") is not None:
            style = get_style(user_id, payload["styleId"], conn)
            if style is None:
                raise StyleNotFound(payload["styleId"])
        else:
            draft = payload.get("style")
            if not isinstance(draft, dict):
                raise StyleValidationError("Send a style to preview.")
            style = {"id": None, "builtin": False, "version": None, "name": _clean_name(draft.get("name") or "Draft"),
                     "kindId": _clean_kind(user_id, draft.get("kindId"), conn),
                     "outlineTemplateId": _clean_template(user_id, draft.get("outlineTemplateId"), conn),
                     "outlineBodyJson": _clean_outline(draft.get("outlineBodyJson")),
                     # 11.3 re-review m-2: a block the member has STORED exactly so is kept, as a save keeps it.
                     "blocks": _clean_blocks(draft.get("blocks"), legacy=lambda: _member_legacy_blocks(user_id, conn)),
                     "properties": _clean_properties(user_id, draft.get("properties"), conn)}
        try:
            asked = notes_service._validate_ticker(payload.get("ticker")) if payload.get("ticker") else None
        except notes_service.NoteValidationError as e:
            raise StyleValidationError(str(e)) from e
        ticker = asked or latest_ticker(user_id, conn)
        # The live preview shows a NEW note made from the style, so it composes as a create does.
        # Task 15: but it never fills a snapshot widget -- this door also serves the community library's
        # Preview of another member's style, and a preview writes nothing and reads no account.
        out = compose(user_id, style, ticker=ticker, conn=conn, mode="create", fill_widgets=False)
        answer = {"bodyJson": out["bodyJson"], "properties": out["properties"], "skipped": out["skipped"],
                  "ticker": ticker, "tickerSource": "asked" if asked else ("latest-note" if ticker else None),
                  "mode": "create"}
        if "slotNames" in out:
            answer["slotNames"] = out["slotNames"]                 # W11-R21: the editor names each slot
        return answer
    finally:
        if owned:
            conn.close()


# ── "Update layout to vN" (spec P1.3) ───────────────────────────────────────────────────────
# Snapshot semantics: editing a style never rewrites a note. Updating one is an explicit,
# previewed action that only ADDS the target style's enabled blocks the note lacks (after the first
# heading), never removes or reorders the member's text, and is ONE compare-and-set write that
# carries the style stamp. A block is "present" when a widgetEmbed with its widgetId is anywhere in
# the body (docs/notebook/p1-verify-before-building.md §a).

CONFLICT_SENTENCE = "This note changed since you opened it. Nothing was added."


def _present(content: list) -> set[str]:
    found, stack = set(), list(content or [])
    while stack:
        n = stack.pop()
        if not isinstance(n, dict):
            continue
        if n.get("type") == "widgetEmbed" and isinstance((n.get("attrs") or {}).get("widgetId"), str):
            found.add(n["attrs"]["widgetId"])
        if isinstance(n.get("content"), list):
            stack.extend(n["content"])
    return found


def _captured_regime(ctx: dict) -> str | None:
    """The regime id the market context builder froze in THIS compose (R-P2-6, R-T4-1 I-1), or None.

    ⛔ It never scans the composed body: that body starts from a member-authored style outline or a
    linked template, which can carry a pasted or week-old stamp. The value is the reading
    trader_blocks.build_market_context recorded on `ctx["captured"]["regime"]` when it built a stamp
    in create mode (a real create, or an empty note switched to a style). That reading is
    trader_blocks' held-only read (R-W0-1, R-T3-1), dated as entry_context._regime_fields dates it
    (R-W0-2: `asOf` is the regime's own wire date, never the capture time). Stored only when it is a
    known regime id AND carries its own date; no market context block built this compose, nothing
    held, an undated or unknown reading: None, so nothing is stored rather than a fabricated value.
    ⛔ The caller (compose) asks only in create mode: that guard, not this function, keeps an update
    out."""
    from api.services.journal_two import note_properties as np_
    ids = {o["id"] for o in np_._BUILTIN_BY_ID[np_.REGIME_AT_WRITE]["options"]}
    r = ((ctx.get("captured") or {}).get("regime")) or {}
    if not isinstance(r, dict):
        return None
    dated = isinstance(r.get("asOf"), str) and bool(r["asOf"].strip())
    return r.get("value") if r.get("value") in ids and dated and not r.get("missing") else None


def _is_empty(content: list) -> bool:
    return all(isinstance(n, dict) and n.get("type") == "paragraph" and not _plain(n).strip()
               and not n.get("content") for n in content or [])


UNREADABLE_BODY_SENTENCE = "This note can't be updated: its saved text could not be read. Nothing was changed."


def _raw_note(user_id: str, note_id: str, conn: sqlite3.Connection) -> tuple[sqlite3.Row, dict] | None:
    """The note row and its STORED body. Never the served body (`notes._served_body`), which can be
    a withheld placeholder or an in-memory upgrade, and must never be written back as the note.

    ⛔ An absent body (empty) is an empty doc, as the serving path reads it. A body that cannot be
    parsed, is not a doc, or has a non-list `content` is REFUSED (review M-1): reading it as empty
    would let an update write a fresh outline over the stored bytes, the one path where "never removes
    member text" could break; a non-list `content` would otherwise reach a slice and answer 500."""
    r = conn.execute("SELECT * FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                     (note_id, user_id)).fetchone()
    if r is None:
        return None
    raw = r["body_json"]
    if not raw:
        return r, {"type": "doc", "content": []}
    try:
        body = json.loads(raw)
    except (TypeError, ValueError):
        raise StyleValidationError(UNREADABLE_BODY_SENTENCE)
    if not isinstance(body, dict) or body.get("type") != "doc":
        raise StyleValidationError(UNREADABLE_BODY_SENTENCE)
    if body.get("content") is None:
        body["content"] = []
    elif not isinstance(body["content"], list):
        raise StyleValidationError(UNREADABLE_BODY_SENTENCE)
    return r, body


def _note_day_of(row: sqlite3.Row, now: datetime) -> str:
    """A stored note's own day (W11-R14): its daily date, else the ET day it was created."""
    from api.services.journal_two import tool_binding
    keys = row.keys()
    return tool_binding.note_day(daily_date=row["daily_date"] if "daily_date" in keys else None,
                                 created_at=row["created_at"], now=now)


def _plan(user_id: str, row: sqlite3.Row, body: dict, style_id: str | None, conn: sqlite3.Connection):
    """(style, built, plan). `built` is [(block, node)] -- the nodes the write inserts. ⛔ Each block is
    asked of ITS BUILDER (review M-6): a block whose builder cannot build it is skipped with the reason
    the builder gives, so the plan and the write can never disagree about what lands."""
    target_id = style_id or row["style_id"]
    if not target_id:
        raise StyleValidationError("This note was not made from a style.")
    style = get_style(user_id, target_id, conn)
    if style is None:
        raise StyleNotFound(target_id)
    switching = target_id != row["style_id"]
    content = body.get("content") or []
    have = _present(content)
    inserts_outline = switching and _is_empty(content)
    # R-RC-1: an empty note switched to a style is written as a create (its outline is composed
    # fresh, and a market context captures); anything else is an update (blocks arrive uncaptured).
    # The plan's builders run in the mode the write will use, and the plan says which.
    mode = "create" if inserts_outline else "update"
    ctx = {"ticker": row["ticker"], "now": datetime.now(timezone.utc), "memo": {}, "mode": mode,
           "user_id": user_id, "conn": conn, "definitions": {}, "defs": {}}
    _sf.prefetch(style["blocks"], ctx)
    built, skipped = [], []
    for b in style["blocks"]:
        if (not b.get("enabled") or b["block"] in have or _switched_off(b["block"])
                or _slot_wave_off(b["block"], b.get("settings"), ctx)):
            continue                                        # M1: a switched-off block is never offered
        if b["block"] in CREATE_ONLY_BLOCKS and not inserts_outline:
            # R-T2B-13 / F8: "N trading days after creation" means something only when the note is made,
            # and _present cannot see a task. Update layout neither offers nor lists it -- but an EMPTY
            # note switched to a style IS a create (mode "create"), where compose places it, so the plan
            # lists it there and the dry run and the write agree.
            continue
        builder = BLOCK_BUILDERS.get(b["block"])
        if builder is None:
            skipped.append({"block": b["block"], "reason": "unknown-block"})
            continue
        if inserts_outline and slot_family(b["block"]) in _sf.TOOL_ID_KEYS:
            # Fix round 1 (I3, ruling W11-R30): a routine or tracker slot is asked of its builder exactly as the
            # write's compose asks it (no answers on this surface, the note's own day). Reading a ref is an owned
            # read and writes nothing; an unanswered template slot is skipped with its reason, here and in the write.
            node, reason = _sf.build_tool_slot(b, {**ctx, "tool_answers": False, "fill_widgets": True,
                                                   "note_day": _note_day_of(row, ctx["now"])})
            if node is None:
                skipped.append({"block": b["block"], "reason": reason or "cannot-build"})
            else:
                built.append((b, None))
            continue
        if inserts_outline and (b["block"] in _tb.READS_ON_CREATE or b["block"] in SNAPSHOT_SLOT_KINDS
                                or slot_family(b["block"])):
            # Review I-2: on the empty-note switch the write composes the body itself (compose, one
            # budget), so these nodes would be thrown away; a reading builder always builds, so the
            # plan lists it WITHOUT running it. The dry run (GET .../style-update-plan) and the write's
            # plan make no market or prep read at all, and the write has ONE clock, compose's.
            built.append((b, None))
            continue
        node, reason = builder(b, ctx)
        if node is None:
            skipped.append({"block": b["block"], "reason": reason or "cannot-build"})
        else:
            built.append((b, node))
    version_current = not switching and row["style_version"] == style["version"]
    plan = {"styleId": style["id"], "styleName": style["name"],
            "fromVersion": None if switching else row["style_version"], "toVersion": style["version"],
            "switching": switching, "insertsOutline": inserts_outline, "mode": mode,
            # Task 15: a snapshot slot has no client catalog row, so the plan names it (the sheet reads `label`).
            # Wave 11: a family slot is named the way its sentence names it (the member's own target, owned read).
            "add": [{"block": b["block"], "label": _nw.KIND_TITLE.get(b["block"]) if b["block"] in SNAPSHOT_SLOT_KINDS
                     else (_family_title(b, ctx)
                           if slot_family(b["block"]) else None)} for b, _ in built], "skipped": skipped,
            # Review M-4: two separate facts. `versionCurrent` = the note records the style's current
            # version; `missingBlocks` = the update would add at least one block. `upToDate` is both.
            "versionCurrent": version_current, "missingBlocks": bool(built),
            "upToDate": version_current and not built,
            # Review I-2: a locked note is never written; the client hides or disables the offer.
            "locked": bool(row["locked"]) if "locked" in row.keys() else False}
    return style, built, plan


def plan_style_update(user_id: str, note_id: str, *, style_id: str | None = None,
                      conn: sqlite3.Connection | None = None) -> dict:
    """The preview (the dry run, served by Task 8 at GET /api/j2/notes/{id}/style-update-plan): what an
    update would add, from which version to which. Writes nothing. Raises StyleNotFound (no such live
    note for this member, or the style is gone, deleted included) and StyleValidationError (the note
    was not made from a style and none was named, or its stored body cannot be read)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        got = _raw_note(user_id, note_id, conn)
        if got is None:
            raise StyleNotFound(note_id)
        return _plan(user_id, got[0], got[1], style_id, conn)[2]
    finally:
        if owned:
            conn.close()


def apply_style_update(user_id: str, note_id: str, *, style_id: str | None = None,
                       expected_updated_at: str | None = None,
                       conn: sqlite3.Connection | None = None) -> tuple[dict, dict]:
    """The one write: missing blocks after the first heading (or, when switching an EMPTY note to a
    style, that style's composed outline), the kind when switching, and the style stamp, in ONE
    compare-and-set `notes.update_note`. Returns `(note, plan)`.

    ⛔ A locked note is refused (`notes._refuse_if_locked` -> NoteLockedError, 423; ruling 149).
    ⛔ The compare-and-set is ALWAYS against the revision this call read the body at (the body the
    blocks are inserted into), and a client `expected_updated_at` that is not that revision is a
    conflict at once (review M-2): the body is read before update_note takes its write lock, so a
    second writer landing in between is a 409, never overwritten. notes.NoteConflictError writes
    nothing (the route answers CONFLICT_SENTENCE).
    ⛔ Nothing to add and not switching = NO write (review M-4): a stamp-only revision would make
    every other tab rebase for nothing. The note is returned as it stands."""
    from api.services.journal_two import notes as notes_service
    owned = conn is None
    conn = conn or get_connection()
    try:
        got = _raw_note(user_id, note_id, conn)
        if got is None:
            raise StyleNotFound(note_id)
        row, body = got
        notes_service._refuse_if_locked(row)
        if expected_updated_at is not None and expected_updated_at != row["updated_at"]:
            raise notes_service.NoteConflictError("note changed since the client's baseline")
        style, built, plan = _plan(user_id, row, body, style_id, conn)
        if not plan["switching"] and not built:
            return notes_service.get_note(user_id, note_id, conn=conn), plan
        patch: dict[str, Any] = {}
        captured: dict[str, Any] = {}
        if plan["insertsOutline"]:
            # Task 11.6 (W11-R14): an empty note switched to a style binds its routine and tracker slots to the
            # note's OWN day (its daily date, else the ET day it was created), never today's.
            now = datetime.now(timezone.utc)
            composed = compose(user_id, style, ticker=row["ticker"], conn=conn, mode=plan["mode"], now=now,
                               note_day=_note_day_of(row, now), tool_answers=False)
            patch["bodyJson"] = composed["bodyJson"]
            # R-RC-1: an empty note switched to a style is create-equivalent (`plan["mode"]` is
            # "create" on this branch alone), so the regime its fresh stamp froze is recorded with it.
            from api.services.journal_two import note_properties as np_
            if np_.REGIME_AT_WRITE in composed["properties"]:
                captured[np_.REGIME_AT_WRITE] = composed["properties"][np_.REGIME_AT_WRITE]
        elif built:
            new = copy.deepcopy(body)
            i = _after_first_heading(new["content"])
            new["content"][i:i] = [node for _, node in built]
            patch["bodyJson"] = new
        if plan["switching"]:
            patch["properties"] = {_nk().NOTE_KIND_PROPERTY: style["kindId"]}
        if captured:
            patch["properties"] = {**patch.get("properties", {}), **captured}
        try:
            note = notes_service.update_note(user_id, note_id, patch, conn=conn,
                                             expected_updated_at=row["updated_at"], client_schema=None,
                                             style_stamp=(style["id"], style["version"]),
                                             captured_properties="keep" if captured else "drop")
        except notes_service.NoteValidationError as e:
            raise StyleValidationError(str(e)) from e
        if note is None:
            raise StyleNotFound(note_id)
        return note, plan
    finally:
        if owned:
            conn.close()
