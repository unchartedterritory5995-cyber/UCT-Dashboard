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
import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from api.services.auth_db import get_connection
from api.services.journal_two import sample_marker
from api.services.notebook_flags import flag_on

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
    # The market context stamp is the EXISTING marketcontext capture widget (IR-S6). No `search`.
    {"id": "marketcontext", "settings": (
        {"key": "fields", "options": ("all", "regime", "indexes"), "default": "all"},)},
    # Tier 2 part B (R-T2B-13): the Reminder, an unticked task "Follow up by <date>". NOT a widget, so
    # no `search`; built in create mode only (reminder_block.py).
    {"id": "reminder", "settings": ({"key": "days", "options": ("1", "2", "3", "5", "10"), "default": "5"},)},
)
KNOWN_BLOCKS = frozenset(k["id"] for k in BLOCK_KINDS)
_BLOCK_BY_ID = {k["id"]: k for k in BLOCK_KINDS}


class StyleValidationError(ValueError):
    pass


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
    "daily_prep": {"name": "Daily prep", "version": 2, "properties": {},
                   "blocks": [_blk("prepWire"), _blk("marketcontext"), _blk("prepEarnings"), _blk("prepMovers"),
                              _blk("prepLevels"), _blk("myRules")],
                   "outline": _doc(
        _h("The market"), _ph("prepWire"), _ph("marketcontext"), _p("What is the tape telling me today?"),
        _h("Names on my list"), _ph("prepEarnings"), _ph("prepMovers"), _ph("prepLevels"),
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
    "weekly_review": {"name": "Weekly review", "version": 1, "properties": {}, "blocks": [], "outline": _doc(
        _h("The numbers"), _p("Trades, wins, losses and the result:"),
        _h("Best and worst trade"), _p(), _h("One thing to change"), _p())},
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
                     " AND deleted_at IS NULL", (user_id, kind_id)).fetchone()
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


def _clean_blocks(raw: Any) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_BLOCKS:
        raise StyleValidationError(f"A style can hold up to {MAX_BLOCKS} blocks.")
    out, seen = [], set()
    for b in raw:
        if not isinstance(b, dict) or not isinstance(b.get("block"), str) or not BLOCK_ID_RE.match(b["block"]):
            raise StyleValidationError("Each block needs a valid block id.")
        bid = b["block"]
        if bid in seen:
            raise StyleValidationError("A style can hold each block once.")
        seen.add(bid)
        settings = b.get("settings") if b.get("settings") is not None else {}
        if not isinstance(settings, dict):
            raise StyleValidationError("A block's settings must be an object.")
        kind = _BLOCK_BY_ID.get(bid)
        if kind is None:
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


def list_styles(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict]:
    """Built-in styles (in built-in kind order), then the member's live styles, oldest first."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        out = [_builtin(user_id, k["id"], conn, full=False) for k in _nk().BUILTIN_NOTE_KINDS
               if k["id"] in BUILTIN_STYLES]
        rows = conn.execute("SELECT * FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL"
                            " ORDER BY created_at, rowid", (user_id,)).fetchall()
        return out + [_row(r, full=False) for r in rows]
    finally:
        if owned:
            conn.close()


def create_style(user_id: str, payload: Any, conn: sqlite3.Connection | None = None) -> dict:
    if not isinstance(payload, dict):
        raise StyleValidationError("Send a style object.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        name = _clean_name(payload.get("name"))
        kind = _clean_kind(user_id, payload.get("kindId"), conn)
        tpl = _clean_template(user_id, payload.get("outlineTemplateId"), conn)
        outline = _clean_outline(payload.get("outlineBodyJson"))
        blocks = _clean_blocks(payload.get("blocks"))
        props = _clean_properties(user_id, payload.get("properties"), conn)
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
        conn.commit()
        return get_style(user_id, sid, conn)
    finally:
        if owned:
            conn.close()


_CONTENT_KEYS = {"kindId": "kind_id", "outlineTemplateId": "outline_template_id",
                 "outlineBodyJson": "outline_body_json", "blocks": "blocks_json", "properties": "properties_json"}


def update_style(user_id: str, style_id: str, patch: Any, conn: sqlite3.Connection | None = None) -> dict | None:
    if isinstance(style_id, str) and style_id.startswith(BUILTIN_PREFIX):
        raise StyleValidationError("Built-in styles can't be changed. Duplicate it to make your own.")
    if not isinstance(patch, dict):
        raise StyleValidationError("Send a style object.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = _load_row(user_id, style_id, conn)
        if r is None:
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
            cleaned["blocks"] = json.dumps(_clean_blocks(patch["blocks"]))
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
            return _row(r, full=True)
        sets.append("updated_at = ?"); params.append(_now())
        conn.execute(f"UPDATE j2_journal_styles SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
                     (*params, style_id, user_id))
        conn.commit()
        return get_style(user_id, style_id, conn)
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


def delete_style(user_id: str, style_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """Soft delete (spec P1.4: with undo). Remembers whether it was the default, for restore."""
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
        n = conn.execute("SELECT COUNT(*) AS c FROM j2_journal_styles WHERE user_id = ? AND deleted_at IS NULL",
                         (user_id,)).fetchone()["c"]
        if n >= MAX_STYLES_PER_MEMBER:
            raise StyleValidationError(f"You can keep up to {MAX_STYLES_PER_MEMBER} styles. Delete one first.")
        again = bool(r["default_before_delete"]) and _member_default(user_id, r["kind_id"], conn) is None
        sql = ("UPDATE j2_journal_styles SET deleted_at = NULL, is_default = ?, default_before_delete = 0,"
               " updated_at = ? WHERE id = ? AND user_id = ?")
        try:
            conn.execute(sql, (1 if again else 0, _now(), style_id, user_id))
        except sqlite3.IntegrityError:
            conn.execute(sql, (0, _now(), style_id, user_id))
        conn.commit()
        return get_style(user_id, style_id, conn)
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

        def leave_out(bid: Any, reason: str) -> None:
            entry = {"widgetId": bid if isinstance(bid, str) else None, "reason": reason}
            if left_out is not None and entry not in left_out:
                left_out.append(entry)

        def strip(content: list, top: bool) -> list:
            out = []
            for node in content:
                if isinstance(node, dict) and node.get("type") == "widgetEmbed":
                    bid = (node.get("attrs") or {}).get("widgetId")
                    if isinstance(bid, str) and BLOCK_ID_RE.match(bid) and bid not in seen and bid in KNOWN_BLOCKS:
                        seen.add(bid)
                        params = (node.get("attrs") or {}).get("params") or {}
                        spec = {s["key"]: s for s in _BLOCK_BY_ID[bid]["settings"]}
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
        return create_style(user_id, {"name": name if name else (note.get("title") or "My style"),
                                      "kindId": kind, "outlineBodyJson": outline, "blocks": blocks,
                                      "properties": props}, conn)
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


#: block id -> builder. ⛔ Every id in BLOCK_KINDS has a builder (railed); P2 adds both together.
from api.services.journal_two import trader_blocks as _tb  # noqa: E402 -- after BLOCK_KINDS, no cycle
from api.services.journal_two import reminder_block as _rb  # noqa: E402 -- reads no journal_styles name
BLOCK_BUILDERS: dict[str, Callable[[dict, dict], tuple[dict | None, str | None]]] = {
    "chart": _build_chart, _rb.BLOCK_ID: _rb.build_reminder, **_tb.BUILDERS}
#: Blocks built only when a note is made (R-T2B-13). Update layout neither offers nor lists them.
CREATE_ONLY_BLOCKS = frozenset({_rb.BLOCK_ID})

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
    else the style's inline outline, else an empty doc (never a failed create)."""
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
                    return body
            except (TypeError, ValueError):
                pass
    body = style.get("outlineBodyJson")
    if isinstance(body, dict) and body.get("type") == "doc":
        return copy.deepcopy(body)
    return {"type": "doc", "content": []}


def compose(user_id: str, style: dict, *, ticker: str | None, conn: sqlite3.Connection | None,
            now: datetime | None = None, mode: str = "create",
            after_build: Callable[[dict, dict], dict] | None = None) -> dict:
    """`after_build(doc, ctx) -> doc` is called in create mode only, once every block is placed (Tier 2
    part A, /plan: one more step on the SAME body, inside the same read budget)."""
    if mode not in BUILD_MODES:
        raise ValueError(f"unknown build mode {mode!r}")
    owned = conn is None
    conn = conn or get_connection()
    try:
        ctx = {"ticker": ticker, "now": now or datetime.now(timezone.utc), "memo": {}, "mode": mode,
               "user_id": user_id}
        if mode == "create":
            # R-T12-C: ONE read budget for every block this create builds (trader_blocks owns the number).
            # A block still to read when it runs out lands uncaptured; an update reads nothing anyway.
            _tb.start_budget(ctx["memo"])
        doc = _outline_doc(user_id, style, conn)
        enabled: dict[str, dict] = {}
        disabled: set[str] = set()
        for b in style.get("blocks") or []:
            if b.get("enabled"):
                enabled.setdefault(b["block"], b)
            else:
                disabled.add(b["block"])
        skipped: list[dict] = []
        placed: set[str] = set()

        def note_skip(bid: str, reason: str) -> None:
            if {"block": bid, "reason": reason} not in skipped:
                skipped.append({"block": bid, "reason": reason})

        def build(b: dict) -> list[dict]:
            builder = BLOCK_BUILDERS.get(b["block"])
            if builder is None:
                note_skip(b["block"], "unknown-block")
                return []
            node, reason = builder(b, ctx)
            if node is None:
                note_skip(b["block"], reason)
                return [_p(SKIP_SENTENCES[reason])] if reason in SKIP_SENTENCES else []
            return [node]

        def walk(content: list, top: bool) -> list:
            out = []
            for node in content:
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
        for bid, b in enabled.items():
            if bid not in placed:
                rest.extend(build(b))
        if rest:
            i = _after_first_heading(doc["content"])
            doc["content"][i:i] = rest
        if not doc["content"]:
            doc["content"] = [{"type": "paragraph"}]
        if mode == "create" and after_build is not None:
            # Tier 2 part A (/plan): one more step on the SAME body, inside the same read budget.
            doc = after_build(doc, ctx)
        props = _valid_defaults(user_id, style.get("properties") or {}, conn)
        props[_nk().NOTE_KIND_PROPERTY] = style["kindId"]
        if mode == "create":
            # R-P2-6 / R-RC-1: only a create (or its equivalent) records the regime it was written
            # in, and only from the reading its own builder froze on ctx (never a scan of the body).
            from api.services.journal_two import note_properties as np_
            reg = _captured_regime(ctx)
            if reg:
                props[np_.REGIME_AT_WRITE] = reg
        return {"bodyJson": doc, "properties": props, "skipped": skipped,
                "styleId": style.get("id"), "styleVersion": style.get("version"), "kindId": style["kindId"]}
    finally:
        if owned:
            conn.close()


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
        composed = compose(user_id, style, ticker=ticker, conn=conn, mode="create", after_build=prefill)
        base = {k: payload[k] for k in ("title", "subtitle", "tags", "ticker", "folderId") if k in payload}
        base["bodyJson"] = composed["bodyJson"]
        note = notes_service.create_note(
            user_id, base, conn, properties=composed["properties"], captured_properties="keep",
            style_stamp=(composed["styleId"], composed["styleVersion"], composed["kindId"]))
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
                     "blocks": _clean_blocks(draft.get("blocks")),
                     "properties": _clean_properties(user_id, draft.get("properties"), conn)}
        try:
            asked = notes_service._validate_ticker(payload.get("ticker")) if payload.get("ticker") else None
        except notes_service.NoteValidationError as e:
            raise StyleValidationError(str(e)) from e
        ticker = asked or latest_ticker(user_id, conn)
        # The live preview shows a NEW note made from the style, so it composes as a create does.
        out = compose(user_id, style, ticker=ticker, conn=conn, mode="create")
        return {"bodyJson": out["bodyJson"], "properties": out["properties"], "skipped": out["skipped"],
                "ticker": ticker, "tickerSource": "asked" if asked else ("latest-note" if ticker else None),
                "mode": "create"}
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
           "user_id": user_id}
    built, skipped = [], []
    for b in style["blocks"]:
        if not b.get("enabled") or b["block"] in have:
            continue
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
        if inserts_outline and b["block"] in _tb.READS_ON_CREATE:
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
            "add": [{"block": b["block"], "label": None} for b, _ in built], "skipped": skipped,
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
            composed = compose(user_id, style, ticker=row["ticker"], conn=conn, mode=plan["mode"])
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
