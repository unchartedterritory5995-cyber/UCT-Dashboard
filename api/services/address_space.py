"""TERM-038 (FB-S2-03) — a published address space: saved things become names.

Every saved object a member OWNS gets an address, ``<prefix>:<id>``, that is typeable
by its NAME in the command palette and resolvable anywhere to the page door that
already opens it. The address is keyed on the object's id, never its name, so a
rename keeps every address that was ever handed out working (FB-S2-04's alias
hazard, answered by construction rather than by an alias table).

⛔ THE ADDRESS SET IS NOT A ROSTER (DOC-1). ``saved_object_tables()`` derives the
candidate kinds from the schema — every ``CREATE TABLE`` in ``api/**`` whose columns
carry an owner (``user_id``/``owner_id``) and a human name (``name``/``title``/
``label``). ``tests/test_address_space.py`` fails BY NAME on a derived table that is
neither an address kind (``KINDS``) nor in ``EXEMPT`` with a one-line reason, and on
an exemption whose table no longer exists. Adding an owned, named table tomorrow
therefore forces a decision the day it lands.

Doors are the SHIPPED one-shot URL instructions, never new ones:
  layout    → /charts?openLayout=<id>          (ChartsWorkspace, own + prebuilt)
  watchlist → /charts?openWatchlist=user:<id>  (ChartsWorkspace, WATCH_KEY_RE)
  note      → /journal/notebook?note=<id>      (NotebookTab)

DARK behind ``ADDRESS_SPACE_ENABLED`` (read per call; unset = off): the routes 404
and the palette shows no address rows.
"""
from __future__ import annotations

import ast
import logging
import os
import pathlib
import re
from dataclasses import dataclass
from typing import Callable, Optional
from urllib.parse import quote

logger = logging.getLogger(__name__)

ENABLED_ENV = "ADDRESS_SPACE_ENABLED"
MAX_RESULTS = 20


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


@dataclass(frozen=True)
class Kind:
    prefix: str
    label: str
    table: str
    lister: Callable[[str], list[dict]]   # user_id -> [{id, name}]
    door: Callable[[str], str]            # id -> in-app URL


def _layouts(user_id: str) -> list[dict]:
    from api.services import charts_layout_service as svc
    out = svc.list_for_user(user_id)
    return [{"id": str(r["id"]), "name": r["name"], "scope": r["scope"]}
            for r in (out.get("mine") or []) + (out.get("global") or [])
            if (r.get("layout") or {}).get("kind") != "multichart"]


def _watchlists(user_id: str) -> list[dict]:
    from api.services import watchlist_service as svc
    rows = svc.list_user_watchlists(user_id, include_items=False, include_prebuilt=False)
    return [{"id": str(r["id"]), "name": r.get("name") or ""} for r in rows
            if not r.get("is_flagged_list")]


def _notes(user_id: str) -> list[dict]:
    from api.services.journal_two import notes as svc
    rows = svc.list_notes(user_id, limit=500, sort="updated", _quiet=True)
    rows = rows.get("notes", rows) if isinstance(rows, dict) else rows
    return [{"id": str(r["id"]), "name": (r.get("title") or "").strip() or "Untitled"} for r in rows]


def _screens(user_id: str) -> list[dict]:
    from api.services.screener import saved_screens as svc
    svc.init()
    return [{"id": str(r["id"]), "name": r["name"]} for r in svc.list_for(user_id)]


KINDS: dict[str, Kind] = {
    "layout": Kind("L", "Chart layout", "charts_layouts", _layouts,
                   lambda i: f"/charts?openLayout={quote(i)}"),
    "watchlist": Kind("W", "Watchlist", "watchlists", _watchlists,
                      lambda i: f"/charts?openWatchlist=user:{quote(i)}"),
    "note": Kind("N", "Note", "j2_notes", _notes,
                 lambda i: f"/journal/notebook?note={quote(i)}"),
    # 2026-09-30 (owner: build D). The door is `useScreenSpec`'s `savedScreen=`
    # arrival: it loads the member's OWN saved screen by id and applies its spec.
    "screen": Kind("S", "Saved screen", "screener_saved_screens", _screens,
                   lambda i: f"/screener?savedScreen={quote(i)}"),
}
_BY_PREFIX = {k.prefix: (name, k) for name, k in KINDS.items()}

# Owned + named tables that are deliberately NOT addressable yet. Shrink-only in spirit:
# each line is a reason, with its kind first. `no-door` means a real saved object that
# has no URL instruction to open it yet -- the next thing to build, not a wontfix.
EXEMPT: dict[str, str] = {
    "theme_sets": "no-door: a theme set has no URL instruction that opens it yet",
    "playbooks": "no-door: Journal 1.0 playbooks, a retired surface with no route that opens one",
    "journal_resources": "no-door: Journal 1.0 resources, a retired surface",
    "upb_entries": "no-door: user playbook entries have no URL instruction yet",
    "upb_sections": "not-a-saved-object: a section groups playbook entries; the entry is the object",
    "ais_threads": "no-door: an AI Search thread has no URL instruction that reopens it yet",
    "j2_note_saved_views": "no-door: a saved notebook view has no URL instruction yet",
    "j2_note_templates": "no-door: a note template is applied from the editor, never opened by URL",
    "j2_note_folders": "no-door: a folder has no URL instruction that opens it yet",
    "j2_note_documents": "not-a-saved-object: an attached document belongs to its note",
    "j2_note_versions": "not-a-saved-object: a note version is history of the note, reached from the note",
    "j2_note_properties": "not-a-saved-object: a property definition, not a thing a member opens",
    "j2_accounts": "not-a-saved-object: a trading account is a setting, chosen inside the Journal",
    "trading_accounts": "not-a-saved-object: Journal 1.0 trading account setting",
    "j2_journal_rules": "not-a-saved-object: a rule is a checklist line inside the Journal",
    "j2_capture_tokens": "not-a-saved-object: a credential; its label must never become an address",
    "j2_obsidian_devices": "not-a-saved-object: a paired device credential",
    "j2_trade_attachments": "not-a-saved-object: an attachment belongs to its trade",
    "j2_verdicts": "not-a-saved-object: a generated verdict record, not member-named work",
    "journal_screenshots": "not-a-saved-object: a screenshot belongs to its trade",
    "screen_alert_subs": "not-a-saved-object: an alert subscription, managed from its screen",
    "user_alerts": "not-a-saved-object: a delivered alert (bell row), not saved work",
    "voice_documents": "not-a-saved-object: a voice-assistant document, not opened by URL",
    "floor_attachments": "not-a-saved-object: an attachment belongs to its Floor post",
    "client_errors": "not-a-saved-object: an error report, not member work",
    "threads": "deferred: a Floor thread has a door (/community/<id>) but is PUBLIC; its address "
               "needs the community's visibility rule, not an owner filter (FB-S2-04 territory)",
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def address_of(kind: str, obj_id: str) -> str:
    return f"{KINDS[kind].prefix}:{obj_id}"


def parse(address: str) -> Optional[tuple[str, str]]:
    """``"L:12"`` → ``("layout", "12")``; anything else → None."""
    m = re.fullmatch(r"\s*([A-Z]):([A-Za-z0-9_\-]{1,80})\s*", address or "")
    if not m or m.group(1) not in _BY_PREFIX:
        return None
    return _BY_PREFIX[m.group(1)][0], m.group(2)


def _row(kind: str, obj: dict) -> dict:
    k = KINDS[kind]
    return {"address": address_of(kind, obj["id"]), "kind": kind, "kind_label": k.label,
            "name": obj["name"], "to": k.door(obj["id"])}


def search(user_id: str, q: str, limit: int = MAX_RESULTS) -> dict:
    """Name search across every address kind the member owns (plus prebuilt layouts).

    Prefix matches rank above substring matches. A kind whose store cannot be read is
    reported in ``unavailable`` and contributes nothing -- never an empty answer
    passed off as "you have no such thing"."""
    needle = _norm(q)
    hits, unavailable = [], []
    if not needle:
        return {"results": [], "unavailable": []}
    exact = parse(q)
    for kind, k in KINDS.items():
        try:
            objs = k.lister(user_id)
        except Exception as e:  # noqa: BLE001 -- one store must not sink the rest
            logger.warning("[address-space] %s lister failed: %s", kind, e)
            unavailable.append(kind)
            continue
        for o in objs:
            name = _norm(o["name"])
            if exact and exact == (kind, o["id"]):
                hits.append((-1, name, _row(kind, o)))
            elif name.startswith(needle):
                hits.append((0, name, _row(kind, o)))
            elif needle in name:
                hits.append((1, name, _row(kind, o)))
    hits.sort(key=lambda h: (h[0], h[1]))
    return {"results": [h[2] for h in hits[:limit]], "unavailable": unavailable}


def resolve(user_id: str, address: str) -> Optional[dict]:
    """The object at ``address`` IF this member can see it, else None. Resolution goes
    through the same lister the search uses, so an address can never open something
    the member could not have found by name."""
    parsed = parse(address)
    if not parsed:
        return None
    kind, obj_id = parsed
    for o in KINDS[kind].lister(user_id):
        if o["id"] == obj_id:
            return _row(kind, o)
    return None


# ── TERM-056: addresses written in PUBLIC text (the Floor) ──────────────────────────
# Owner ruling 2026-09-29: on the Floor an address links ONLY when the object is shared.
# Resolution is against the AUTHOR's objects, never the reader's: "L:12" in a post means the
# poster's layout 12. Outcomes per address:
#   shared  -> {address, kind, kind_label, name, to, shared: True}   (a door every reader can use)
#   private -> {address, kind, kind_label, shared: False}            (NO name: a private title is
#                                                                      not the Floor's to publish)
#   not the author's / unknown -> omitted, so ordinary text ("W:3 in a row") never gets a chip.
_TEXT_ADDRESS_RE = re.compile(r"(?<![A-Za-z0-9])([LWNS]):([A-Za-z0-9_\-]{1,40})(?![A-Za-z0-9_\-])")
MAX_TEXT_ADDRESSES = 8


def addresses_in_text(text: str) -> list[str]:
    seen, out = set(), []
    for m in _TEXT_ADDRESS_RE.finditer(text or ""):
        a = f"{m.group(1)}:{m.group(2)}"
        if a not in seen:
            seen.add(a)
            out.append(a)
    return out[:MAX_TEXT_ADDRESSES]


def _shared_layout(author_id: str, obj_id: str) -> Optional[dict]:
    from api.services import charts_layout_service as svc
    if not obj_id.isdigit():
        return None
    row = svc.get(int(obj_id))
    if not row:
        return None
    if row["scope"] == "global":                       # prebuilt: every member can open it
        return {"name": row["name"], "to": f"/charts?openLayout={row['id']}", "shared": True}
    if str(row["user_id"]) != str(author_id):
        return None
    st = svc.share_status(author_id, row["id"])
    if st and st.get("token"):
        return {"name": row["name"], "to": f"/charts?openShared={quote(st['token'])}", "shared": True}
    return {"shared": False}


def _shared_watchlist(author_id: str, obj_id: str) -> Optional[dict]:
    from api.services import watchlist_service as svc
    conn = svc.get_connection()
    try:
        r = conn.execute("SELECT id, user_id, name, is_public, is_flagged_list FROM watchlists WHERE id = ?",
                         (obj_id,)).fetchone()
    finally:
        conn.close()
    if not r or str(r["user_id"]) != str(author_id):
        return None
    if r["is_public"]:
        return {"name": r["name"], "to": f"/charts?openWatchlist=community:{quote(str(r['id']))}", "shared": True}
    return {"shared": False}


def _shared_note(author_id: str, obj_id: str) -> Optional[dict]:
    # A note has no Floor-visible share in this slice: the author's own note is "private".
    try:
        from api.services.journal_two import notes as svc
        note = svc.get_note(author_id, obj_id)
    except Exception:  # noqa: BLE001 -- not theirs, or unreadable: no chip, never an error
        return None
    return {"shared": False} if note else None


def _shared_screen(author_id: str, obj_id: str) -> Optional[dict]:
    from api.services.screener import saved_screens as svc
    if not obj_id.isdigit():
        return None
    rec = svc.get(int(obj_id), author_id)               # the AUTHOR's screen, or nothing
    if not rec:
        return None
    if rec.get("is_public") and rec.get("share_token"):
        return {"name": rec["name"], "to": f"/screener?screen={quote(rec['share_token'])}",
                "shared": True}
    return {"shared": False}


_SHARED_RESOLVERS = {"layout": _shared_layout, "watchlist": _shared_watchlist,
                     "note": _shared_note, "screen": _shared_screen}


def shared_links(author_id: Optional[str], text: str) -> list[dict]:
    """The chips for one piece of public text written by `author_id` (see the block above)."""
    if not author_id:
        return []
    out = []
    for addr in addresses_in_text(text):
        kind, obj_id = parse(addr)
        try:
            hit = _SHARED_RESOLVERS[kind](str(author_id), obj_id)
        except Exception as e:  # noqa: BLE001 -- one store must not break a feed
            logger.warning("[address-space] shared resolve %s failed: %s", addr, e)
            continue
        if hit is None:
            continue
        row = {"address": addr, "kind": kind, "kind_label": KINDS[kind].label, "shared": hit["shared"]}
        if hit["shared"]:
            row.update(name=hit["name"], to=hit["to"])
        out.append(row)
    return out


def text_of_body(body) -> str:
    """Plain text of a Floor body (TipTap JSON string, or already plain)."""
    import json
    if not body:
        return ""
    try:
        doc = json.loads(body) if isinstance(body, str) else body
    except (TypeError, ValueError):
        return str(body)
    parts: list[str] = []

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("text"), str):
                parts.append(n["text"])
            for ch in n.get("content") or []:
                walk(ch)
        elif isinstance(n, list):
            for ch in n:
                walk(ch)
    walk(doc)
    return " ".join(parts)


# ── The census the rail derives the kinds from ───────────────────────────────────
_OWNER_COLS = {"user_id", "owner_id", "owner_user_id", "author_id"}
_NAME_COLS = {"name", "title", "label"}
_CREATE_RE = re.compile(r"CREATE TABLE(?: IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.I)


def _columns(body: str) -> list[str]:
    body = re.sub(r"--[^\n]*", "", body)  # SQL comments: a column line may carry one
    parts, depth, cur = [], 0, []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    cols = []
    for p in parts:
        tok = p.strip().split()
        if tok and tok[0].upper() not in ("UNIQUE", "PRIMARY", "FOREIGN", "CHECK", "CONSTRAINT"):
            cols.append(tok[0].strip('"`[]').lower())
    return cols


def saved_object_tables(root: str | pathlib.Path = "api") -> dict[str, str]:
    """``{table: first defining file}`` for every owned + named table declared in a
    string constant under ``root`` (tests and ``*_v1`` fixtures excluded)."""
    found: dict[str, str] = {}
    for p in sorted(pathlib.Path(root).rglob("*.py")):
        if p.name.startswith("test_"):
            continue
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
                continue
            s = node.value
            for m in _CREATE_RE.finditer(s):
                i, depth = m.end(), 1
                while i < len(s) and depth:
                    depth += {"(": 1, ")": -1}.get(s[i], 0)
                    i += 1
                cols = set(_columns(s[m.end():i - 1]))
                if cols & _OWNER_COLS and cols & _NAME_COLS:
                    found.setdefault(m.group(1), p.as_posix())
    return found
