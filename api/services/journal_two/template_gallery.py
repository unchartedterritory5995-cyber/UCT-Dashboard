"""Wave 12, lane 12A -- the COMMUNITY TEMPLATE GALLERY.

A member publishes a COPY of one of their own templates ("Your templates",
`note_templates.py`) to a gallery every member can browse, preview and copy from.
It is called the "community gallery" in code and copy, never just "the gallery":
wave 10 already made the BUILT-IN Templates dialog a browsable gallery
(`TemplatePicker.jsx`), and the two must not be confused.

The rules, each railed by tests/test_notebook_template_gallery.py:

  * GATED. `NOTEBOOK_TEMPLATE_GALLERY_ENABLED`, read per request through the one
    Notebook flag parse, default OFF -- the router answers 404 for every route while it
    is off, before any session is read (`notebook_template_gallery.py`).
  * REVIEWED BEFORE PUBLISHING (owner, WAVE-11-PLAN.md:20). Publishing creates a
    PENDING submission that only its author (and an admin) can see. An admin approves
    it before it is listed, or rejects it with a note the author reads. Editing an
    approved template sends it back to pending: what is listed is always what was
    reviewed.
  * ONE REDUCER. The published body goes through `public_note_payload.reduce` in its
    third mode, `gallery` -- never a second sanitiser. That mode drops every image and
    image-bearing attribute (a member template's images point at the author's own note,
    note_templates.py header), every Ask answer, writing-help block and citation, every
    attachment, and every link to the author's other notes; market-data nodes become
    the neutral line; in-app and email addresses are scrubbed; task items are unchecked.
    The title and description get the same text scrub (`scrub_gallery_text`).
  * DEFINITIONS, NEVER VALUES. A template's property VALUES never leave (a relation's
    value names the author's notes; a select's value is the author's own triage). What
    travels is each property's DEFINITION -- name, type and, for a select, its option
    labels and colours -- so "Use template" can give the member the same fields. A
    computed (formula / rollup) definition does not travel: its config names the
    author's own property ids.
  * THE AUTHOR'S DISPLAY NAME ONLY. Never an email, never an id. A display name that
    looks like an email address, or is blank, reads "A UCT member".
  * "USE TEMPLATE" IS A COPY. It writes a new row into the member's own
    `j2_note_templates`; later edits to (or the removal of) the gallery copy change
    nothing in theirs.
  * HIDE IS A VISIBILITY STATE, NEVER A DELETE (the kill-switch rule). Admin hide sets
    `hidden = 1`; unhide clears it; the member's content is untouched either way.
    UNPUBLISH is the author's own request about their own copy, so it deletes that copy
    (and the reports and use counts about it) -- the same reasoning as account deletion,
    which purges an author's listings through `account_purge.py`. Copies other members
    already made stay theirs.
  * FIRM TEMPLATES ("UCT picks") are rows with `kind = 'firm'` and no author, seeded
    once from `template_gallery_seed.json` (INSERT OR IGNORE by `seed_key`, so an
    admin's later hide or unfeature is never undone by a reboot). An admin can feature
    any approved template; featured ones are the "UCT picks" section.

⛔ Tables live in auth.db beside `j2_note_templates`, created from
`journal_two.db.ensure_schema` (so the account-purge manifest rail sees them), with the
`j2_` prefix. The Floor's reports + admin queue (`community.py`) is the SHAPE copied
here; its tables (community.db) are not used.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import public_note_payload as public
from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_TEMPLATE_GALLERY_ENABLED"

#: ⛔ ONE FACT IN TWO FILES with the client's GALLERY_CATEGORIES
#: (app/src/pages/journal-2-0/lib/templateGallery.js); tests/test_notebook_template_gallery.py
#: PARSES the client file and holds the two equal.
CATEGORIES = ("trade_plan", "journal", "research", "review")
SORTS = ("newest", "most_used")
SECTIONS = ("all", "picks", "mine")
#: ⛔ Same rule: pinned against the client's REPORT_REASONS by the same rail.
REPORT_REASONS = ("spam", "personal_info", "offensive", "broken", "other")
ADMIN_ACTIONS = ("approve", "reject", "hide", "unhide", "feature", "unfeature")
REPORT_ACTIONS = ("hide", "dismiss")

MAX_TITLE_CHARS = 80
MAX_DESCRIPTION_CHARS = 280
MAX_NOTE_CHARS = 500
MAX_QUERY_CHARS = 80
#: The serialised, already-reduced body. A note body may be 1 MB; a template that big
#: is not a scaffold and would make every gallery read heavy.
MAX_BODY_BYTES = 200_000
MAX_PROPERTY_DEFS = 20
LIST_LIMIT = 200
PREVIEW_LINES = 3
_PREVIEW_LINE_CHARS = 72

#: What an admin reads when the template they are approving is not the one they looked at.
APPROVE_STALE_SENTENCE = ("This template changed after you opened it. Nothing was listed. "
                          "Look at it again, then approve.")

FIRM_AUTHOR = "UCT"
ANONYMOUS_AUTHOR = "A UCT member"

SEED_FILE = Path(__file__).with_name("template_gallery_seed.json")


class GalleryError(ValueError):
    """A request the member can fix -- answered 400 with this sentence."""


class GalleryConflict(GalleryError):
    """A request that conflicts with the current state -- answered 409."""


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(FLAG, False)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── schema + firm seed ──────────────────────────────────────────────────────────────────

_DDL = (
    # One row per published template. `user_id` is the AUTHOR (NULL for a firm template);
    # `source_template_id` is the author's own j2_note_templates row it was copied from.
    """CREATE TABLE IF NOT EXISTS j2_template_gallery (
        id                  TEXT PRIMARY KEY,
        user_id             TEXT,
        source_template_id  TEXT,
        seed_key            TEXT,
        kind                TEXT NOT NULL DEFAULT 'member',
        title               TEXT NOT NULL,
        description         TEXT NOT NULL DEFAULT '',
        category            TEXT NOT NULL,
        body_json           TEXT NOT NULL,
        property_defs_json  TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        review_note         TEXT,
        reviewed_by         TEXT,
        reviewed_at         TEXT,
        hidden              INTEGER NOT NULL DEFAULT 0,
        hidden_by           TEXT,
        hidden_at           TEXT,
        featured            INTEGER NOT NULL DEFAULT 0,
        listed_at           TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
    )""",
    # One live gallery copy per (author, source template): publishing again UPDATES it.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_source"
    " ON j2_template_gallery(user_id, source_template_id)"
    " WHERE user_id IS NOT NULL AND source_template_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_seed"
    " ON j2_template_gallery(seed_key) WHERE seed_key IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_j2_template_gallery_listed"
    " ON j2_template_gallery(status, hidden, listed_at DESC)",
    # A member's report of a template. One per (template, member); `status` is the Floor's
    # shape: open -> hidden | dismissed.
    """CREATE TABLE IF NOT EXISTS j2_template_gallery_reports (
        id           TEXT PRIMARY KEY,
        gallery_id   TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        reason       TEXT NOT NULL,
        note         TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'open',
        created_at   TEXT NOT NULL,
        resolved_at  TEXT,
        resolved_by  TEXT
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_reports_once"
    " ON j2_template_gallery_reports(gallery_id, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_j2_template_gallery_reports_status"
    " ON j2_template_gallery_reports(status, created_at)",
    # Who has copied a template -- "most used" counts DISTINCT members, so one member
    # pressing Use ten times is one use.
    """CREATE TABLE IF NOT EXISTS j2_template_gallery_uses (
        gallery_id  TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        used_at     TEXT NOT NULL,
        PRIMARY KEY (gallery_id, user_id)
    )""",
)


def ensure_gallery_schema(conn: sqlite3.Connection) -> None:
    """Create the three tables (idempotent), then seed the firm templates. Called from
    `journal_two.db.ensure_schema`; a seed failure is logged, never raised -- a missing
    firm template must not take a boot down."""
    for stmt in _DDL:
        conn.execute(stmt)
    conn.commit()
    try:
        seed_firm_templates(conn)
    except Exception as e:  # noqa: BLE001 -- never crash startup over a seed
        print(f"[template-gallery] firm seed skipped: {type(e).__name__}: {e}")


def load_seed() -> list[dict[str, Any]]:
    data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    return list(data.get("templates") or [])


def seed_firm_templates(conn: sqlite3.Connection) -> int:
    """INSERT OR IGNORE each firm template by `seed_key`: approved, featured, no author.
    Returns how many rows were added (0 on every boot after the first)."""
    added = 0
    now = _now()
    for t in load_seed():
        body = sanitize_body(t["bodyJson"], "")
        cur = conn.execute(
            "INSERT OR IGNORE INTO j2_template_gallery (id, user_id, source_template_id, seed_key,"
            " kind, title, description, category, body_json, property_defs_json, status,"
            " featured, listed_at, created_at, updated_at)"
            " VALUES (?, NULL, NULL, ?, 'firm', ?, ?, ?, ?, NULL, 'approved', 1, ?, ?, ?)",
            (uuid.uuid4().hex, t["seedKey"], t["title"], t.get("description") or "",
             t["category"], json.dumps(body), now, now, now),
        )
        added += cur.rowcount or 0
    conn.commit()
    return added


# ── what leaves the author's account ────────────────────────────────────────────────────

def sanitize_body(body: Any, owner_id: str) -> dict:
    """The gallery copy of a template body: the ONE public reducer, in `gallery` mode.

    `note_id=""` and `attachment_base=""`: a template is not a note and has no public
    image proxy, so no attachment address is ever rewritten -- and gallery mode drops
    every image whatever its address."""
    return public.reduce(body, mode="gallery", owner_id=owner_id or "", note_id="",
                         attachment_base="", facts={}, note_links={})


def _stored_body(row: sqlite3.Row) -> dict:
    """A stored gallery body, put through the gallery reducer AGAIN on its way out (security
    review I-4, defence in depth). The body was reduced when it was published; a row written
    before a rule existed, or by anything other than `publish`, is still cleaned before a
    member previews it or copies it into their own templates. The reducer is stable on its
    own output, so a clean row is unchanged. A body that does not parse reads as empty."""
    try:
        body = json.loads(row["body_json"] or "{}")
    except (TypeError, ValueError):
        body = {}
    return sanitize_body(body, "")


def property_definitions(user_id: str, raw: str | None, conn: sqlite3.Connection) -> list[dict]:
    """The DEFINITIONS of the properties a template carries values for -- never a value.

    A built-in user-set property travels as its id (every member has it); a member's own
    property travels as {name, type, options?} with fresh option ids left to the copier.
    Computed definitions, deleted properties and unknown types are left out."""
    from api.services.journal_two import note_properties as np

    out: list[dict] = []
    for property_id in np._parse_properties_json(raw):
        if len(out) >= MAX_PROPERTY_DEFS:
            break
        if np.is_builtin_property_id(property_id):
            if property_id in np.BUILTIN_USER_SET_IDS:
                d = np._BUILTIN_BY_ID[property_id]
                out.append({"builtinId": property_id, "name": d["name"], "type": d["type"]})
            continue
        d = np.get_property_def(user_id, property_id, conn=conn)
        if d is None or d.get("computed") or d.get("type") not in np._VALID_TYPES:
            continue
        item: dict[str, Any] = {"name": public.scrub_gallery_text(d["name"])[:80], "type": d["type"]}
        if d["type"] in ("select", "multi_select"):
            item["options"] = [
                {"label": public.scrub_gallery_text(o.get("label") or "")[:60], "color": o.get("color") or "gray"}
                for o in (d.get("options") or []) if isinstance(o, dict) and (o.get("label") or "").strip()
            ][:50]
        out.append(item)
    return out


def _clean_text(raw: Any, *, field: str, limit: int, required: bool) -> str:
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise GalleryError(f"{field} must be text.")
    text = " ".join(public.scrub_gallery_text(raw).split())
    if required and not text:
        raise GalleryError(f"A gallery template needs a {field}.")
    if len(text) > limit:
        raise GalleryError(f"The {field} can be at most {limit} characters.")
    return text


def _clean_category(raw: Any) -> str:
    if raw not in CATEGORIES:
        raise GalleryError("Pick a category: trade plan, journal, research or review.")
    return raw


# ── reading ─────────────────────────────────────────────────────────────────────────────

def _author_label(row: sqlite3.Row) -> str:
    if row["kind"] == "firm":
        return FIRM_AUTHOR
    name = (row["author_display"] or "").strip() if "author_display" in row.keys() else ""
    if not name or "@" in name:
        return ANONYMOUS_AUTHOR
    return name[:60]


def _node_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return str(node.get("text") or "")
    return "".join(_node_text(c) for c in node.get("content") or [])


def preview_lines(body: Any, limit: int = PREVIEW_LINES) -> list[dict]:
    """The first lines of a template, `{kind: heading|text|bullet, text}` -- the same
    shape the built-in cards preview (`templatePreview` in lib/notebookTemplates.js)."""
    lines: list[dict] = []

    def push(kind: str, text: str) -> None:
        t = " ".join(text.split())
        if t and len(lines) < limit:
            if len(t) > _PREVIEW_LINE_CHARS:
                t = t[: _PREVIEW_LINE_CHARS - 1].rstrip() + "…"
            lines.append({"kind": kind, "text": t})

    for node in (body or {}).get("content") or [] if isinstance(body, dict) else []:
        if len(lines) >= limit:
            break
        t = node.get("type") if isinstance(node, dict) else None
        if t == "heading":
            push("heading", _node_text(node))
        elif t in ("bulletList", "orderedList", "taskList"):
            for item in node.get("content") or []:
                push("bullet", _node_text(item))
        elif t and t != "horizontalRule":
            push("text", _node_text(node))
    return lines


def _summary(row: sqlite3.Row, *, viewer_id: str | None, is_admin: bool) -> dict[str, Any]:
    mine = bool(viewer_id) and row["user_id"] == viewer_id
    try:
        body = json.loads(row["body_json"] or "{}")
    except (TypeError, ValueError):
        body = {}
    defs = json.loads(row["property_defs_json"]) if row["property_defs_json"] else []
    out: dict[str, Any] = {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"] or "",
        "category": row["category"],
        "author": _author_label(row),
        "firm": row["kind"] == "firm",
        "featured": bool(row["featured"]),
        "usedBy": int(row["used_by"] or 0) if "used_by" in row.keys() else 0,
        "listedAt": row["listed_at"],
        "updatedAt": row["updated_at"],
        "mine": mine,
        "preview": preview_lines(body),
        "propertyCount": len(defs),
    }
    if mine or is_admin:
        # What the author and the reviewers need; a member browsing never sees any of it.
        out["status"] = row["status"]
        out["hidden"] = bool(row["hidden"])
        out["reviewNote"] = row["review_note"] or ""
        out["createdAt"] = row["created_at"]
    if is_admin:
        out["openReports"] = int(row["open_reports"] or 0) if "open_reports" in row.keys() else 0
    return out


_SELECT = (
    "SELECT g.*, u.display_name AS author_display,"
    " (SELECT COUNT(*) FROM j2_template_gallery_uses x WHERE x.gallery_id = g.id) AS used_by,"
    " (SELECT COUNT(*) FROM j2_template_gallery_reports r"
    "    WHERE r.gallery_id = g.id AND r.status = 'open') AS open_reports"
    " FROM j2_template_gallery g LEFT JOIN users u ON u.id = g.user_id"
)
_VISIBLE = "g.status = 'approved' AND g.hidden = 0"


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def list_gallery(
    viewer_id: str, *, q: Any = "", category: Any = None, sort: Any = "newest",
    section: Any = "all", is_admin: bool = False, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """The gallery as one member sees it.

    section `all` -- every approved, visible template (firm and member);
    section `picks` -- the featured subset ("UCT picks");
    section `mine` -- the viewer's OWN submissions in every state (pending, rejected,
    hidden), so an author always knows where their template stands."""
    if section not in SECTIONS:
        raise GalleryError("Unknown gallery section.")
    if sort not in SORTS:
        raise GalleryError("Sort by newest or most used.")
    if category not in (None, "", *CATEGORIES):
        raise GalleryError("Unknown category.")
    query = q.strip()[:MAX_QUERY_CHARS] if isinstance(q, str) else ""
    where: list[str] = []
    args: list[Any] = []
    if section == "mine":
        where.append("g.user_id = ?")
        args.append(viewer_id)
    else:
        where.append(_VISIBLE)
        if section == "picks":
            where.append("g.featured = 1")
    if category:
        where.append("g.category = ?")
        args.append(category)
    if query:
        where.append("(g.title LIKE ? ESCAPE '\\' OR g.description LIKE ? ESCAPE '\\')")
        args.extend([_like(query), _like(query)])
    order = ("used_by DESC, COALESCE(g.listed_at, g.created_at) DESC" if sort == "most_used"
             else "COALESCE(g.listed_at, g.created_at) DESC")
    sql = f"{_SELECT} WHERE {' AND '.join(where)} ORDER BY {order}, g.rowid DESC LIMIT {LIST_LIMIT}"
    owned = conn is None
    conn = conn or get_connection()
    try:
        return [_summary(r, viewer_id=viewer_id, is_admin=is_admin) for r in conn.execute(sql, args)]
    finally:
        if owned:
            conn.close()


def _row(conn: sqlite3.Connection, gallery_id: str) -> sqlite3.Row | None:
    return conn.execute(f"{_SELECT} WHERE g.id = ?", (gallery_id,)).fetchone()


def _can_see(row: sqlite3.Row | None, viewer_id: str, is_admin: bool) -> bool:
    if row is None:
        return False
    if is_admin or (viewer_id and row["user_id"] == viewer_id):
        return True
    return row["status"] == "approved" and not row["hidden"]


def get_item(viewer_id: str, gallery_id: str, *, is_admin: bool = False,
             conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """One template in full (`bodyJson`, `propertyDefs`), or None when the viewer may not
    see it -- a pending or hidden template reads exactly like one that does not exist."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _row(conn, gallery_id)
        if not _can_see(row, viewer_id, is_admin):
            return None
        out = _summary(row, viewer_id=viewer_id, is_admin=is_admin)
        out["bodyJson"] = _stored_body(row)
        out["propertyDefs"] = json.loads(row["property_defs_json"]) if row["property_defs_json"] else []
        return out
    finally:
        if owned:
            conn.close()


# ── the author ──────────────────────────────────────────────────────────────────────────

def publish(user_id: str, template_id: Any, *, title: Any, description: Any, category: Any,
            conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Submit (or resubmit) one of the member's own templates for review.

    None when the template is not theirs or does not exist. Publishing a template that
    already has a gallery copy UPDATES that copy and sends it back to PENDING -- the
    listing is always what an admin reviewed."""
    if not isinstance(template_id, str) or not template_id.strip():
        raise GalleryError("Pick one of your templates to publish.")
    clean_title = _clean_text(title, field="title", limit=MAX_TITLE_CHARS, required=True)
    clean_desc = _clean_text(description, field="description", limit=MAX_DESCRIPTION_CHARS, required=False)
    clean_cat = _clean_category(category)
    owned = conn is None
    conn = conn or get_connection()
    try:
        src = conn.execute(
            "SELECT * FROM j2_note_templates WHERE id = ? AND user_id = ?",
            (template_id.strip(), user_id),
        ).fetchone()
        if src is None:
            return None
        try:
            raw_body = json.loads(src["body_json"] or "{}")
        except (TypeError, ValueError):
            raise GalleryError("That template could not be read, so it cannot be published.")
        body = sanitize_body(raw_body, user_id)
        body_json = json.dumps(body)
        if len(body_json.encode("utf-8")) > MAX_BODY_BYTES:
            raise GalleryError("That template is too long for the gallery. Trim it and try again.")
        defs = property_definitions(user_id, src["properties_json"], conn)
        defs_json = json.dumps(defs) if defs else None
        now = _now()
        existing = conn.execute(
            "SELECT id FROM j2_template_gallery WHERE user_id = ? AND source_template_id = ?",
            (user_id, src["id"]),
        ).fetchone()
        if existing:
            gid = existing["id"]
            conn.execute(
                "UPDATE j2_template_gallery SET title = ?, description = ?, category = ?,"
                " body_json = ?, property_defs_json = ?, status = 'pending', review_note = NULL,"
                " reviewed_by = NULL, reviewed_at = NULL, featured = 0, listed_at = NULL,"
                " updated_at = ? WHERE id = ?",
                (clean_title, clean_desc, clean_cat, body_json, defs_json, now, gid),
            )
        else:
            gid = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO j2_template_gallery (id, user_id, source_template_id, kind, title,"
                " description, category, body_json, property_defs_json, status, created_at,"
                " updated_at) VALUES (?, ?, ?, 'member', ?, ?, ?, ?, ?, 'pending', ?, ?)",
                (gid, user_id, src["id"], clean_title, clean_desc, clean_cat, body_json,
                 defs_json, now, now),
            )
        conn.commit()
        return _summary(_row(conn, gid), viewer_id=user_id, is_admin=False)
    finally:
        if owned:
            conn.close()


def unpublish(user_id: str, gallery_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """The author takes their copy down. Always possible, in every state. Deletes the
    gallery copy and the reports and use counts about it -- the author's own request
    about their own content; copies others already made are theirs and stay."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_template_gallery WHERE id = ? AND user_id = ? AND kind = 'member'",
            (gallery_id, user_id),
        )
        if cur.rowcount:
            conn.execute("DELETE FROM j2_template_gallery_reports WHERE gallery_id = ?", (gallery_id,))
            conn.execute("DELETE FROM j2_template_gallery_uses WHERE gallery_id = ?", (gallery_id,))
        conn.commit()
        return bool(cur.rowcount)
    finally:
        if owned:
            conn.close()


# ── every member ────────────────────────────────────────────────────────────────────────

def _ensure_property(user_id: str, d: dict, conn: sqlite3.Connection) -> str:
    """Give the member a property matching a travelled definition: 'existing' (they have
    one of that name and type), 'added', or 'skipped' (a same-named one of another type
    -- never a second property with a name they already use)."""
    from api.services.journal_two import note_properties as np

    if d.get("builtinId"):
        return "existing" if d["builtinId"] in np.BUILTIN_USER_SET_IDS else "skipped"
    name = (d.get("name") or "").strip()
    ptype = d.get("type")
    if not name or ptype not in np._VALID_TYPES:
        return "skipped"
    rows = conn.execute(
        "SELECT type FROM j2_note_properties WHERE user_id = ? AND deleted_at IS NULL"
        " AND lower(name) = lower(?)",
        (user_id, name),
    ).fetchall()
    if rows:
        return "existing" if any(r["type"] == ptype for r in rows) else "skipped"
    options = d.get("options") if ptype in ("select", "multi_select") else None
    try:
        np.create_property_def(user_id, name, ptype, options, conn=conn)
    except np.PropertyValidationError:
        return "skipped"
    return "added"


def use_template(user_id: str, gallery_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Copy a listed template into the member's own "Your templates". None when they may
    not see it. The copy carries the title and body; each property definition becomes a
    property they have (existing, added, or skipped, reported by name)."""
    from api.services.journal_two import note_templates as nt

    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _row(conn, gallery_id)
        if not _can_see(row, user_id, False):
            return None
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM j2_note_templates WHERE user_id = ?", (user_id,),
        ).fetchone()["c"]
        if count >= nt.MAX_TEMPLATES_PER_MEMBER:
            raise GalleryError(
                f"You can keep up to {nt.MAX_TEMPLATES_PER_MEMBER} templates. Delete one to add another.")
        now = _now()
        new_id = uuid.uuid4().hex
        name = (row["title"] or nt.UNTITLED_TEMPLATE_NAME)[: nt.MAX_TEMPLATE_NAME_CHARS]
        conn.execute(
            "INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
            (new_id, user_id, name, row["title"] or "", json.dumps(_stored_body(row)), now, now),
        )
        if row["user_id"] != user_id:
            conn.execute(
                "INSERT OR IGNORE INTO j2_template_gallery_uses (gallery_id, user_id, used_at)"
                " VALUES (?, ?, ?)", (gallery_id, user_id, now),
            )
        conn.commit()
        result: dict[str, list[str]] = {"added": [], "existing": [], "skipped": []}
        for d in json.loads(row["property_defs_json"]) if row["property_defs_json"] else []:
            result[_ensure_property(user_id, d, conn)].append(d.get("name") or "")
        template = conn.execute("SELECT * FROM j2_note_templates WHERE id = ?", (new_id,)).fetchone()
        return {"template": nt._summary(template), "properties": result}
    finally:
        if owned:
            conn.close()


def report(user_id: str, gallery_id: str, *, reason: Any, note: Any = "",
           conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Report a listed template. None when the member cannot see it. One report per
    member per template: a second one answers `already: true` and changes nothing."""
    if reason not in REPORT_REASONS:
        raise GalleryError("Pick a reason for the report.")
    clean_note = _clean_text(note, field="note", limit=MAX_NOTE_CHARS, required=False)
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _row(conn, gallery_id)
        if row is None or row["status"] != "approved" or row["hidden"]:
            return None
        if row["user_id"] == user_id:
            raise GalleryError("You can't report your own template. Unpublish it instead.")
        try:
            conn.execute(
                "INSERT INTO j2_template_gallery_reports (id, gallery_id, user_id, reason, note,"
                " status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)",
                (uuid.uuid4().hex, gallery_id, user_id, reason, clean_note, _now()),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            return {"reported": True, "already": True}
        return {"reported": True, "already": False}
    finally:
        if owned:
            conn.close()


# ── the review queue (admin) ────────────────────────────────────────────────────────────

def admin_queue(conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """What waits on a reviewer: pending submissions (oldest first), open reports
    grouped under their template, and hidden templates (so an unhide is one click)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        def rows(where: str, order: str) -> list[dict]:
            return [_summary(r, viewer_id=None, is_admin=True)
                    for r in conn.execute(f"{_SELECT} WHERE {where} ORDER BY {order} LIMIT {LIST_LIMIT}")]

        pending = rows("g.status = 'pending'", "g.updated_at ASC")
        hidden = rows("g.hidden = 1", "g.hidden_at DESC")
        reported = rows("EXISTS (SELECT 1 FROM j2_template_gallery_reports r"
                        " WHERE r.gallery_id = g.id AND r.status = 'open')", "open_reports DESC")
        ids = [r["id"] for r in reported]
        by_gallery: dict[str, list[dict]] = {i: [] for i in ids}
        if ids:
            marks = ",".join("?" for _ in ids)
            for r in conn.execute(
                f"SELECT id, gallery_id, reason, note, created_at FROM j2_template_gallery_reports"
                f" WHERE status = 'open' AND gallery_id IN ({marks}) ORDER BY created_at", ids,
            ):
                # The reporter's id never reaches the queue -- a reviewer judges the
                # template, not who reported it.
                by_gallery[r["gallery_id"]].append(
                    {"id": r["id"], "reason": r["reason"], "note": r["note"], "createdAt": r["created_at"]})
        for item in reported:
            item["reports"] = by_gallery.get(item["id"], [])
        return {"pending": pending, "reported": reported, "hidden": hidden}
    finally:
        if owned:
            conn.close()


def admin_act(admin_id: str, gallery_id: str, action: Any, *, note: Any = "",
              reviewed_updated_at: Any = None,
              conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """approve | reject | hide | unhide | feature | unfeature. None when no such template.

    ⛔ hide and unhide flip a VISIBILITY column; nothing is deleted (the kill-switch rule).
    Hiding also closes the template's open reports as `hidden`, the Floor's shape.

    ⛔ AN APPROVAL NAMES THE VERSION THAT WAS REVIEWED (security review I-6).
    `reviewed_updated_at` is the `updatedAt` of the template as the reviewer saw it (the
    review queue row and the preview both carry it). The UPDATE is conditional on it, in
    its own WHERE clause, so there is no gap between the check and the write: publishing
    again replaces the body and moves `updated_at`, and an approval of the earlier version
    then changes nothing and raises `GalleryConflict` (409). An approval that names no
    version is refused the same way -- nothing may be listed unseen."""
    if action not in ADMIN_ACTIONS:
        raise GalleryError("Unknown review action.")
    clean_note = _clean_text(note, field="note", limit=MAX_NOTE_CHARS, required=False)
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute("SELECT * FROM j2_template_gallery WHERE id = ?", (gallery_id,)).fetchone()
        if row is None:
            return None
        now = _now()
        if action == "approve":
            if not isinstance(reviewed_updated_at, str) or not reviewed_updated_at:
                raise GalleryConflict(APPROVE_STALE_SENTENCE)
            cur = conn.execute(
                "UPDATE j2_template_gallery SET status = 'approved', review_note = NULL, reviewed_by = ?,"
                " reviewed_at = ?, listed_at = COALESCE(listed_at, ?), updated_at = ?"
                " WHERE id = ? AND updated_at = ?",
                (admin_id, now, now, now, gallery_id, reviewed_updated_at))
            if cur.rowcount != 1:
                conn.rollback()
                raise GalleryConflict(APPROVE_STALE_SENTENCE)
        elif action == "reject":
            if not clean_note:
                raise GalleryError("Say why, so the author can fix it.")
            conn.execute(
                "UPDATE j2_template_gallery SET status = 'rejected', review_note = ?, reviewed_by = ?,"
                " reviewed_at = ?, featured = 0, listed_at = NULL, updated_at = ? WHERE id = ?",
                (clean_note, admin_id, now, now, gallery_id))
        elif action == "hide":
            conn.execute("UPDATE j2_template_gallery SET hidden = 1, hidden_by = ?, hidden_at = ?"
                         " WHERE id = ?", (admin_id, now, gallery_id))
            conn.execute("UPDATE j2_template_gallery_reports SET status = 'hidden', resolved_at = ?,"
                         " resolved_by = ? WHERE gallery_id = ? AND status = 'open'",
                         (now, admin_id, gallery_id))
        elif action == "unhide":
            conn.execute("UPDATE j2_template_gallery SET hidden = 0, hidden_by = NULL, hidden_at = NULL"
                         " WHERE id = ?", (gallery_id,))
        elif action in ("feature", "unfeature"):
            if action == "feature" and row["status"] != "approved":
                raise GalleryConflict("Approve a template before featuring it.")
            conn.execute("UPDATE j2_template_gallery SET featured = ? WHERE id = ?",
                         (1 if action == "feature" else 0, gallery_id))
        conn.commit()
        return _summary(_row(conn, gallery_id), viewer_id=admin_id, is_admin=True)
    finally:
        if owned:
            conn.close()


def admin_report_act(admin_id: str, report_id: str, action: Any,
                     conn: sqlite3.Connection | None = None) -> bool:
    """One open report: `hide` hides its template (a visibility state) and closes every
    open report on it; `dismiss` closes this one report. False when no open report."""
    if action not in REPORT_ACTIONS:
        raise GalleryError("Report actions are hide or dismiss.")
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = conn.execute("SELECT * FROM j2_template_gallery_reports WHERE id = ? AND status = 'open'",
                         (report_id,)).fetchone()
        if r is None:
            return False
        if action == "hide":
            admin_act(admin_id, r["gallery_id"], "hide", conn=conn)
        else:
            conn.execute("UPDATE j2_template_gallery_reports SET status = 'dismissed', resolved_at = ?,"
                         " resolved_by = ? WHERE id = ?", (_now(), admin_id, report_id))
            conn.commit()
        return True
    finally:
        if owned:
            conn.close()
