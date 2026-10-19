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

import hashlib
import json
import os
import re
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import example_sanitize
from api.services.journal_two import public_note_payload as public
from api.services.journal_two import page_layout_share as pls
from api.services.journal_two import sample_marker
from api.services.journal_two import starter_packs
from api.services.journal_two.page_layout_share import LAYOUT_ITEM, LAYOUT_PAGES
from api.services.notebook_flags import TRUTHY, flag_on

FLAG = "NOTEBOOK_TEMPLATE_GALLERY_ENABLED"

#: ⛔ ONE FACT IN TWO FILES with the client's GALLERY_CATEGORIES
#: (app/src/pages/journal-2-0/lib/templateGallery.js); tests/test_notebook_template_gallery.py
#: PARSES the client file and holds the two equal.
CATEGORIES = ("trade_plan", "journal", "research", "review")
LIBRARY_FLAG = "NOTEBOOK_STYLE_LIBRARY_ENABLED"
#: P3b (R-P3b-6): the example-note switch. SERVER-ONLY -- it is not in `auth.NOTEBOOK_FLAGS` and has no
#: client fallback row; the lazy library list reports it as `capabilities.exampleNotes`. Read per call by
#: `example_enabled`, with a plain `os.environ.get` so the feature-flag index sees it (a `flag_on` call is
#: for payload flags only, `notebook_flags.py`'s rule) and the ledger declares it.
EXAMPLE_FLAG = "NOTEBOOK_EXAMPLE_NOTES_ENABLED"
#: The item type of an example note (P3b). An example belongs to a style (R-P3b-2) and is NEVER listed on its
#: own: no list, section, filter, author page or feed returns one, and the library's type chips skip it.
EXAMPLE_ITEM = "example_note"
#: ⛔ ONE FACT IN TWO FILES with ITEM_TYPES / TRADING_STYLES / LIBRARY_SORTS in
#: app/src/pages/journal-2-0/lib/styleLibrary.js; tests/test_style_library.py PARSES that file.
ITEM_TYPES = ("outline", "style", EXAMPLE_ITEM, LAYOUT_ITEM)
#: The item types a member can list or filter by: every type but the example note (R-P3b-2). It includes
#: `page_layout` (P4b); whether a layout row is SHOWN is the switch's business (`_hidden_item_types`).
LISTED_ITEM_TYPES = tuple(t for t in ITEM_TYPES if t != EXAMPLE_ITEM)
TRADING_STYLES = ("swing", "day", "prop", "options", "earnings", "long_term")
SORTS = ("newest", "most_used", "trending")
TRENDING_DAYS = 7
SECTIONS = ("all", "picks", "mine")
#: ⛔ Same rule: pinned against the client's REPORT_REASONS by the same rail.
REPORT_REASONS = ("spam", "personal_info", "offensive", "broken", "other")
ADMIN_ACTIONS = ("approve", "reject", "hide", "unhide", "feature", "unfeature")
REPORT_ACTIONS = ("hide", "dismiss")

#: P3a Task 7: the bell rows the library writes. One string is both the alert `type` and `data.source`,
#: and the client's Notices box matches it (app/src/pages/journal-2-0/lib/notices.js LIBRARY, pinned there
#: by notices.test.js reading this file). An update notice links into the member's own copy; the plan's
#: Task 10 makes `StylesManager` open the update sheet from that link (nothing reads it before then). A
#: withdraw notice has no link: there is nothing left to open.
LIBRARY_NOTICE_SOURCE = "notebook_style_library"
LIBRARY_UPDATE_PATH = "/journal/notebook?styles=1&libraryUpdate="
UPDATE_NOTICE = "{title} has a new version from its author. Open it to see what changed."
WITHDRAW_NOTICE = "{title} was taken down by its author. Your copy is yours and has not changed."
#: A review action that can leave a watcher behind the listed version gets a retry pass afterwards. Hide
#: does not ring (a hidden item is not news), and neither does reject (the listing did not change).
_RING_ACTIONS = ("approve", "unhide", "feature", "unfeature")

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
#: The same sentence for a page layout row: a layout is not a template (P4b final, item 5).
LAYOUT_APPROVE_STALE_SENTENCE = ("This layout changed after you opened it. Nothing was listed. "
                                 "Look at it again, then approve.")
#: ...and when the template they are rejecting is not the one they looked at (P3b-F-R4), or the tab names no version
#: at all -- a tab still on a bundle from before reject was pinned (P3b-F2-R3): reloading the queue is the fix either way.
REJECT_STALE_SENTENCE = "This item changed since you opened it. Reload the review queue to see the current version."

FIRM_AUTHOR = "UCT"
ANONYMOUS_AUTHOR = "A UCT member"

SEED_FILE = Path(__file__).with_name("template_gallery_seed.json")


class GalleryError(ValueError):
    """A request the member can fix -- answered 400 with this sentence."""


class GalleryConflict(GalleryError):
    """A request that conflicts with the current state -- answered 409."""


class GalleryServerError(Exception):
    """A failure the member cannot fix (P3b Task 4: an example's image copy) -- answered 500 with this sentence.
    Deliberately NOT a `GalleryError`: that one is a 400, a request the member can change."""


def enabled() -> bool:
    """The gate, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(FLAG, False)


def library_enabled() -> bool:
    """P3a's gate, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(LIBRARY_FLAG, False)


#: P4b (R-P4b-10): the layout-sharing switch. SERVER-ONLY: it is not in `auth.NOTEBOOK_FLAGS` and has no client
#: fallback row (a payload key would cost first-open bytes); the lazy library list reports it as
#: `capabilities.layoutSharing` and `GET /layouts/status` answers 404 while it is off. Read per call with a plain
#: `os.environ.get` (a `flag_on` call is for payload flags), and it needs the library AND page layouts too.
LAYOUT_SHARING_FLAG = "NOTEBOOK_LAYOUT_SHARING_ENABLED"
PAGE_LAYOUTS_FLAG = "JOURNAL_PAGE_LAYOUTS_ENABLED"


def _layout_switches_on() -> bool:
    """The two switches that are layout sharing's OWN (page layouts and the sharing env), read PER CALL and
    WITHOUT the library switch, so a list that has already read `library_enabled` once can combine the two
    without reading it again (P5's one-read rule, `test_one_list_request_reads_the_switches_once`)."""
    return (flag_on(PAGE_LAYOUTS_FLAG, False)
            and (os.environ.get(LAYOUT_SHARING_FLAG) or "").strip().lower() in TRUTHY)


def layout_sharing_enabled() -> bool:
    """P4b's gate: all three switches on, read PER CALL. Default OFF; an unrecognised value is OFF.

    The fourth switch, the gallery's own (`FLAG`), is the router's dependency, not part of this function,
    exactly as `library_enabled` leaves it to the router: every route that calls this is behind it."""
    return library_enabled() and _layout_switches_on()


def example_enabled() -> bool:
    """P3b's gate (R-P3b-6): `NOTEBOOK_EXAMPLE_NOTES_ENABLED` AND the library switch, read PER CALL.

    Default OFF, and an unrecognised value is OFF: for a default-off gate that is exactly `flag_on`'s
    truth table, so the one TRUTHY set decides (`notebook_flags.TRUTHY`)."""
    return library_enabled() and _example_switch_on()


def _example_switch_on() -> bool:
    """The example switch alone, without the library switch (the same split as `_layout_switches_on`), so a list
    that has already read `library_enabled` can combine them without reading it again."""
    return (os.environ.get(EXAMPLE_FLAG) or "").strip().lower() in TRUTHY


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
        updated_at          TEXT NOT NULL,
        preview_json        TEXT
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
    # P3a Task 5: "tell me when the author updates this" -- one row per (item, member), the copy it watches
    # and the version they were last told about. A member who adopts WITHOUT notify has no row; their
    # copy still shows in `list_updates`, because that reads the copy's own `source_version`.
    """CREATE TABLE IF NOT EXISTS j2_gallery_watches (
        gallery_id        TEXT NOT NULL,
        user_id           TEXT NOT NULL,
        style_id          TEXT NOT NULL,
        notified_version  INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        PRIMARY KEY (gallery_id, user_id)
    )""",
    # P3a Task 6: "Helpful" -- one vote per (item, member), and never on your own item (the service refuses).
    """CREATE TABLE IF NOT EXISTS j2_gallery_helpful (
        item_id     TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (item_id, user_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_j2_gallery_helpful_user ON j2_gallery_helpful(user_id)",
    # P3a Task 6 (R-P3-2): the OPAQUE per-author handle, the only author key that leaves the server. `user_id`
    # stays in this table and in nothing a response carries. Minted on first need (`author_handle`).
    """CREATE TABLE IF NOT EXISTS j2_gallery_authors (
        user_id     TEXT PRIMARY KEY,
        handle      TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL
    )""",
    # P3a Task 6: who follows whom. Both columns are member ids (the author side is the author's `user_id`,
    # never the handle), so account deletion clears a row from either side (`account_purge`).
    """CREATE TABLE IF NOT EXISTS j2_gallery_follows (
        follower_id  TEXT NOT NULL,
        author_id    TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        PRIMARY KEY (follower_id, author_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_j2_gallery_follows_author ON j2_gallery_follows(author_id)",
)


def ensure_gallery_schema(conn: sqlite3.Connection) -> None:
    """Create the three tables (idempotent), then seed the firm templates. Called from
    `journal_two.db.ensure_schema`; a seed failure is logged, never raised -- a missing
    firm template must not take a boot down."""
    for stmt in _DDL:
        conn.execute(stmt)
    # `preview_json` (security review M-6): the three preview lines, stored when a template is
    # published or seeded so the list never parses a body. Added here for a database whose
    # table predates it (SQLite has no ADD COLUMN IF NOT EXISTS, so the columns are read).
    columns = {r[1] for r in conn.execute("PRAGMA table_info(j2_template_gallery)")}
    for name, ddl in (
        ("preview_json", "TEXT"),
        ("item_type", "TEXT NOT NULL DEFAULT 'outline'"),
        ("payload_json", "TEXT"),
        ("version", "INTEGER NOT NULL DEFAULT 1"),
        ("trading_style", "TEXT"),
        ("source_style_id", "TEXT"),
        ("pending_json", "TEXT"),
        ("pending_at", "TEXT"),
        # P3b: the author's own note an example note was reduced from (a snapshot: the row never reads it again).
        ("source_note_id", "TEXT"),
        ("source_page", "TEXT"),
    ):
        if name not in columns:
            conn.execute(f"ALTER TABLE j2_template_gallery ADD COLUMN {name} {ddl}")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_style_source"
                 " ON j2_template_gallery(user_id, source_style_id)"
                 " WHERE user_id IS NOT NULL AND source_style_id IS NOT NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_j2_template_gallery_note_source"
                 " ON j2_template_gallery(user_id, source_note_id) WHERE source_note_id IS NOT NULL")
    # P4b: one live gallery copy per (author, page) -- sharing a page's layout again UPDATES it.
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_template_gallery_layout_source"
                 " ON j2_template_gallery(user_id, source_page)"
                 " WHERE user_id IS NOT NULL AND source_page IS NOT NULL")
    conn.commit()
    try:
        seed_firm_templates(conn)
        seed_firm_styles(conn)          # P5: the starter packs' firm styles, same never-crash rule
    except Exception as e:  # noqa: BLE001 -- never crash startup over a seed
        print(f"[template-gallery] firm seed skipped: {type(e).__name__}: {e}")
    try:
        fill_missing_previews(conn)
    except Exception as e:  # noqa: BLE001 -- a preview is a courtesy, never a failed boot
        print(f"[template-gallery] preview fill skipped: {type(e).__name__}: {e}")


def fill_missing_previews(conn: sqlite3.Connection) -> int:
    """Give every row with no stored preview one, from its own body. A steady-state database
    has none, and then this is one read and no write. Returns how many rows were filled."""
    rows = conn.execute(
        "SELECT id, body_json FROM j2_template_gallery WHERE preview_json IS NULL").fetchall()
    for r in rows:
        try:
            body = json.loads(r[1] or "{}")
        except (TypeError, ValueError, RecursionError):
            body = {}
        conn.execute("UPDATE j2_template_gallery SET preview_json = ? WHERE id = ? AND preview_json IS NULL",
                     (json.dumps(preview_lines(body)), r[0]))
    if rows:
        conn.commit()
    return len(rows)


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
            " featured, listed_at, created_at, updated_at, preview_json)"
            " VALUES (?, NULL, NULL, ?, 'firm', ?, ?, ?, ?, NULL, 'approved', 1, ?, ?, ?, ?)",
            (uuid.uuid4().hex, t["seedKey"], t["title"], t.get("description") or "",
             t["category"], json.dumps(body), now, now, now, json.dumps(preview_lines(body))),
        )
        added += cur.rowcount or 0
    conn.commit()
    return added


# ── P5: the firm styles of the starter packs ────────────────────────────────────────────

#: The fifteen firm STYLE rows, three per starter pack (R-P5-3). A file of its own, never rows in
#: `template_gallery_seed.json`: `load_seed` is the OUTLINE seed, and its 4-6 rail counts it.
STYLE_SEED_FILE = Path(__file__).with_name("template_gallery_style_seed.json")


def load_style_seed() -> list[dict[str, Any]]:
    """The firm style rows, in file order. Like `load_seed`, the file's `v` is never read."""
    data = json.loads(STYLE_SEED_FILE.read_text(encoding="utf-8"))
    return list(data.get("styles") or [])


def _outline_from_headings(headings: list[str]) -> list[dict]:
    """A firm style's outline: one level-2 heading, then one empty paragraph, per heading.

    The seed file holds the heading words and never TipTap JSON, so this is the one place that shape
    is written. The result passes the gallery reducer unchanged (tests/test_firm_style_seed.py)."""
    out: list[dict] = []
    for text in headings:
        out.append({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]})
        out.append({"type": "paragraph"})
    return out


def firm_style_id(seed_key: str) -> str:
    """A firm style's row id: a pure function of its seed key, the same on every database.

    ⛔ Not `uuid.uuid4()` (which `seed_firm_templates` uses): this seed runs inside every
    `ensure_schema`, and `tools/notebook_contract_fixtures.py` makes uuid4 a deterministic COUNTER, so
    fifteen extra draws at boot would shift every id the fixtures record after it."""
    return uuid.uuid5(uuid.NAMESPACE_URL, "uctintelligence.com/firm-style/" + seed_key).hex


def seed_firm_styles(conn: sqlite3.Connection) -> int:
    """INSERT OR IGNORE each firm style by `seed_key` (F9): approved, featured, no author,
    `item_type = 'style'`, `trading_style` = its pack. Returns how many rows were added (0 on every boot
    after the first), so an admin's later hide or unfeature is never undone by a reboot.

    The payload is P3a's own shape (`{kindId, outlineBodyJson, blocks, properties}`, what `style_payload`
    produces and `_safe_listed` reads), at version 1; `body_json` is the outline and `preview_json` its
    preview, exactly as `publish_style` stores them. To change a shipped row, add a `-v2` row and retire
    the `-v1` one (R-P5-4); there is no in-place upsert.

    ⛔ Visibility is NOT decided here. A firm style row is listed, in every gallery read and in UCT picks, only
    while BOTH the library switch and the starter-packs switch are on (P5-AUD-1, superseding P5-R-C3), by the one
    rule `_hidden_styles`; either switch alone shows nothing. Task 4's install reads these rows directly, so it
    does not need them listed."""
    added = 0
    now = _now()
    for s in load_style_seed():
        outline = sanitize_body({"type": "doc", "content": _outline_from_headings(s["outlineHeadings"])}, "")
        payload = {"kindId": s["kindId"], "outlineBodyJson": outline,
                   "blocks": s["blocks"], "properties": s.get("properties") or {}}
        cur = conn.execute(
            "INSERT OR IGNORE INTO j2_template_gallery (id, user_id, source_template_id, seed_key,"
            " kind, title, description, category, body_json, property_defs_json, status,"
            " featured, listed_at, created_at, updated_at, preview_json, item_type, payload_json,"
            " version, trading_style)"
            " VALUES (?, NULL, NULL, ?, 'firm', ?, ?, ?, ?, NULL, 'approved', 1, ?, ?, ?, ?, 'style', ?, 1, ?)",
            (firm_style_id(s["seedKey"]), s["seedKey"], s["title"], s.get("description") or "", s["category"],
             json.dumps(outline), now, now, now, json.dumps(preview_lines(outline)), json.dumps(payload),
             s["pack"]),
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
    from api.services.journal_two.note_kinds import NOTE_KIND_PROPERTY

    out: list[dict] = []
    for property_id in np._parse_properties_json(raw):
        if len(out) >= MAX_PROPERTY_DEFS:
            break
        if np.is_builtin_property_id(property_id):
            # Kind of note carries no value into a gallery entry (never a value) and its name would
            # surface a feature that may still be dark, so it is left out of the listing.
            if property_id in np.BUILTIN_USER_SET_IDS and property_id != NOTE_KIND_PROPERTY:
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


def _clean_text(raw: Any, *, field: str, limit: int, required: bool, noun: str = "template") -> str:
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise GalleryError(f"{field} must be text.")
    text = " ".join(public.scrub_gallery_text(raw).split())
    if required and not text:
        raise GalleryError(f"A gallery {noun} needs a {field}.")
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


#: An author handle is `secrets.token_urlsafe(9)`: 12 characters. Anything longer than this is not one.
MAX_HANDLE_CHARS = 64


def author_handle(user_id: str, conn: sqlite3.Connection) -> str:
    """The author's OPAQUE handle (R-P3-2), minted on first need and never changed.

    It is the only author key that leaves the server: random, so it says nothing about the account, and
    unique, so it names exactly one author. Commits the one insert it makes."""
    row = conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = ?", (user_id,)).fetchone()
    if row:
        return row["handle"]
    for _ in range(5):
        handle = secrets.token_urlsafe(9)
        try:
            conn.execute("INSERT INTO j2_gallery_authors (user_id, handle, created_at) VALUES (?, ?, ?)",
                         (user_id, handle, _now()))
            conn.commit()
            return handle
        except sqlite3.IntegrityError:
            # Either the handle is taken (draw again) or another request minted this author's handle first
            # (use theirs: one author, one handle). P3b-T3-R3: the failed insert left the implicit transaction
            # open; end it here, as the success path's commit does, so no caller inherits it.
            conn.rollback()
            row = conn.execute("SELECT handle FROM j2_gallery_authors WHERE user_id = ?", (user_id,)).fetchone()
            if row:
                return row["handle"]
    raise RuntimeError("could not mint an author handle")


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


def _revision_title(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        title = json.loads(raw).get("title")
    except (TypeError, ValueError, AttributeError):
        return None
    return title if isinstance(title, str) else None


def _summary(row: sqlite3.Row, *, viewer_id: str | None, is_admin: bool) -> dict[str, Any]:
    mine = bool(viewer_id) and row["user_id"] == viewer_id
    keys = row.keys()
    defs = json.loads(row["property_defs_json"]) if row["property_defs_json"] else []
    # ⛔ THE STORED PREVIEW, NEVER A PARSE OF THE BODY (security review M-6). The list used to
    # parse every row's full body (200 rows of up to 200 KB) on every request to build three
    # lines. A row from before the column has none until the next schema pass fills it; a
    # single-template read (which has the body anyway) builds it on the spot.
    preview: list[dict] = []
    stored = row["preview_json"] if "preview_json" in keys else None
    if stored:
        try:
            loaded = json.loads(stored)
            preview = loaded if isinstance(loaded, list) else []
        except (TypeError, ValueError):
            preview = []
    elif "body_json" in keys:
        try:
            preview = preview_lines(json.loads(row["body_json"] or "{}"))
        except (TypeError, ValueError, RecursionError):
            preview = []
    out: dict[str, Any] = {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"] or "",
        "category": row["category"],
        "author": _author_label(row),
        "firm": row["kind"] == "firm",
        "featured": bool(row["featured"]),
        "usedBy": int(row["used_by"] or 0) if "used_by" in row.keys() else 0,
        "itemType": row["item_type"] if "item_type" in keys else "outline",
        "version": int(row["version"] or 1) if "version" in keys else 1,
        "tradingStyle": row["trading_style"] if "trading_style" in keys else None,
        # P4b: which page a shared layout is for ('today' | 'trade'); None for every other type. CLAMPED to
        # LAYOUT_PAGES (P4b-R-T3-5): `source_page` is free TEXT, and the label stays a closed enum whatever is stored.
        "layoutPage": (row["source_page"] if "source_page" in keys and "item_type" in keys
                       and row["item_type"] == LAYOUT_ITEM and row["source_page"] in LAYOUT_PAGES else None),
        "trendingCount": int(row["trending_count"] or 0) if "trending_count" in keys else 0,
        # P3a Task 6. The count is everyone's; `helpedByMe` is THIS viewer's (the select binds them).
        "helpfulCount": int(row["helpful_count"] or 0) if "helpful_count" in keys else 0,
        "helpedByMe": bool(row["helped_by_me"]) if "helped_by_me" in keys else False,
        # R-P3-2: the opaque handle is the only author key that leaves the server. A firm item has none; a
        # member item whose author is anonymous still has one, because the LABEL is what is anonymous.
        # None for a member item whose author has no handle row yet.
        "authorHandle": (row["author_handle"] if "author_handle" in keys else None) if row["kind"] != "firm" else None,
        "listedAt": row["listed_at"],
        "updatedAt": row["updated_at"],
        "mine": mine,
        "preview": preview,
        "propertyCount": len(defs),
    }
    if mine or is_admin:
        # What the author and the reviewers need; a member browsing never sees any of it.
        out["status"] = row["status"]
        out["hidden"] = bool(row["hidden"])
        out["reviewNote"] = row["review_note"] or ""
        out["createdAt"] = row["created_at"]
        out["sourceStyleId"] = row["source_style_id"] if "source_style_id" in keys else None
        out["hasRevision"] = bool(row["pending_at"]) if "pending_at" in keys else False
        # The held revision's title, for the reviewer. The queue's pending rows carry it as the narrow
        # `revision_title` column (`_select(queue=True)`); a single-template read (`_select()`) has `pending_json`.
        # The member list's columns have neither, so it reads None there.
        if "revision_title" in keys:
            out["revisionTitle"] = row["revision_title"]
        else:
            out["revisionTitle"] = _revision_title(row["pending_json"]) if "pending_json" in keys else None
    if is_admin:
        out["openReports"] = int(row["open_reports"] or 0) if "open_reports" in row.keys() else 0
    return out


# ── the select, one function (P3a Task 6) ──────────────────────────────────────────────────
#
# The select is viewer-PARAMETERISED: `helped_by_me` is "did THIS member mark it", so the text carries ONE `?`,
# in the select list, ahead of every WHERE parameter. That makes the argument order a fact about the SQL, not a
# convention each caller remembers, and is why every read goes through `_read`, which puts the viewer first.
#
#   _select()                          the single-template read: `g.*` (a body, for preview and use)
#   _select(list_only=True)            the list's own query: every column `_summary` reads, NOT `body_json` (M-6)
#   _select(list_only=True, queue=True)  the reviewer queue's PENDING rows: the narrow columns plus ONE expression,
#                                      the held revision's title, read inside SQLite so `pending_json` never leaves
#                                      it. `json_valid` first: json_extract raises on malformed JSON, and one
#                                      unreadable revision must not take the whole queue down.
_LIST_COLUMNS = ("g.id, g.user_id, g.kind, g.title, g.description, g.category, g.property_defs_json,"
                 " g.status, g.review_note, g.hidden, g.featured, g.listed_at, g.created_at, g.updated_at,"
                 " g.preview_json, g.item_type, g.version, g.trading_style, g.pending_at, g.source_style_id,"
                 " g.source_page,")
#: ⛔ P3b-T5-R7 (review I-1): `source_style_id` is READ by every list, and `_summary` still EMITS it only for the
#: author and admins (`sourceStyleId`). Without it the author's Your submissions row could not say which of their
#: styles it is, so the Share form's "Add an example note" door never found its item. `source_page` (P4b) is read
#: the same way: `_summary` turns it into `layoutPage`.
_REVISION_TITLE = ("CASE WHEN json_valid(g.pending_json)"
                   " THEN json_extract(g.pending_json, '$.title') END AS revision_title,")
_COMPUTED = (
    " u.display_name AS author_display, a.handle AS author_handle,"
    " (SELECT COUNT(*) FROM j2_template_gallery_uses x WHERE x.gallery_id = g.id) AS used_by,"
    " (SELECT COUNT(*) FROM j2_template_gallery_uses x WHERE x.gallery_id = g.id"
    f"    AND x.used_at >= strftime('%Y-%m-%dT%H:%M:%S', 'now', '-{TRENDING_DAYS} days')) AS trending_count,"
    " (SELECT COUNT(*) FROM j2_template_gallery_reports r"
    "    WHERE r.gallery_id = g.id AND r.status = 'open') AS open_reports,"
    " (SELECT COUNT(*) FROM j2_gallery_helpful hc WHERE hc.item_id = g.id) AS helpful_count,"
    " EXISTS (SELECT 1 FROM j2_gallery_helpful hm WHERE hm.item_id = g.id AND hm.user_id = ?) AS helped_by_me"
    " FROM j2_template_gallery g LEFT JOIN users u ON u.id = g.user_id"
    " LEFT JOIN j2_gallery_authors a ON a.user_id = g.user_id"
)


def _select(list_only: bool = False, queue: bool = False) -> str:
    """The gallery select (see the block comment above). Binds exactly one `?`: the viewer, first."""
    if queue and not list_only:
        raise ValueError("the queue's select is a narrow one")
    head = "g.*," if not list_only else (_LIST_COLUMNS + (" " + _REVISION_TITLE if queue else ""))
    return f"SELECT {head}{_COMPUTED}"


def _check_select_shapes() -> None:
    """The M-6 guarantees, asserted at import on whatever the three shapes come to (Task 6 made them a
    function; the guarantees did not change): the list and the queue never read a body, a payload or `g.*`, the
    list never names `pending_json`, the queue names it only inside the one `json_extract`, and each binds
    exactly the one viewer."""
    full, narrow, queue = _select(), _select(list_only=True), _select(list_only=True, queue=True)
    assert "g.*" in full
    assert ("g.*" not in narrow and "body_json" not in narrow
            and "payload_json" not in narrow and "pending_json" not in narrow)
    assert (queue != narrow and "g.*" not in queue and "body_json" not in queue and "payload_json" not in queue
            and queue.replace("json_valid(g.pending_json)", "").replace("json_extract(g.pending_json,", "")
            .count("pending_json") == 0)
    assert full.count("?") == narrow.count("?") == queue.count("?") == 1


_check_select_shapes()
_VISIBLE = "g.status = 'approved' AND g.hidden = 0"
#: R-P3b-2: an example note belongs to a style and is never a list row of its own. Every list read (the gallery's
#: `all` and `picks` sections, an author's page and its count, the feed) carries this; the author's own `mine`
#: carries it only while the example switch is off (ruling P3b-R12).
_NEVER_LISTED = f"g.item_type != '{EXAMPLE_ITEM}'"


def _read(conn: sqlite3.Connection, viewer_id: str | None, where: str, args: Any = (), *,
          list_only: bool = False, queue: bool = False, tail: str = ""):
    """Run the gallery select with the viewer bound FIRST, then the WHERE's own arguments. Every caller of
    `_select` goes through here; a viewer-less read (the review queue) binds "", which no member id equals."""
    return conn.execute(f"{_select(list_only, queue)} WHERE {where}{tail}", (viewer_id or "", *args))


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def list_gallery(
    viewer_id: str, *, q: Any = "", category: Any = None, sort: Any = "newest",
    section: Any = "all", item_type: Any = None, trading_style: Any = None,
    is_admin: bool = False, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """The gallery as one member sees it.

    section `all` -- every approved, visible template (firm and member);
    section `picks` -- the featured subset ("UCT picks");
    section `mine` -- the viewer's OWN submissions in every state (pending, rejected,
    hidden), so an author always knows where their template stands."""
    if section not in SECTIONS:
        raise GalleryError("Unknown gallery section.")
    # With the library off the gallery must look exactly like today's: "trending" is a P3a sort,
    # so it answers what any unknown sort answered before it existed (same 400, same sentence).
    # The switches are read ONCE per request (P5-T5b-R1): `library_on` and the WHERE term below both derive
    # from this one answer, so a switch flip mid-request cannot pair a library-off branch with a style row.
    hidden = _hidden_styles()
    library_on = hidden != "all"
    if sort not in SORTS or (sort == "trending" and not library_on):
        raise GalleryError("Sort by newest, most adopted or trending." if library_on
                           else "Sort by newest or most used.")
    if category not in (None, "", *CATEGORIES):
        raise GalleryError("Unknown category.")
    if item_type not in (None, "", *LISTED_ITEM_TYPES):
        raise GalleryError("Unknown item type.")         # an example note is never listed on its own (R-P3b-2)
    if trading_style not in (None, "", *TRADING_STYLES):
        raise GalleryError("Unknown trading style.")
    query = q.strip()[:MAX_QUERY_CHARS] if isinstance(q, str) else ""
    where: list[str] = []
    args: list[Any] = []
    # Ruling P3b-R12: an author's OWN Your submissions lists their example notes too, with the status and any
    # reviewer's note, while the switch is on (R-P3b-2's "never listed on its own" governs the library, where
    # other members browse). With the switch off an example reads as absent everywhere, here included.
    if section != "mine" or not (library_on and _example_switch_on()):    # `example_enabled`, library read once
        where.append(_NEVER_LISTED)
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
    # A library type (a style, a layout) or a trading-style filter asked for while the library is off is unknown:
    # the same 400 as before either existed. Then the ONE type rule for the non-style types (`_hidden_item_types`,
    # given this request's `library_on` so `library_enabled` is read once): a hidden type asked for by name is
    # unknown, and every row of one is kept out of the WHERE. Style rows are `_hidden_styles_sql`'s, below.
    if not library_on and (item_type in ("style", LAYOUT_ITEM) or trading_style):
        raise GalleryError("Unknown item type.")
    if item_type in _hidden_item_types(library_on):
        raise GalleryError("Unknown item type.")
    where.append(_type_visible_clause(library_on))
    if item_type:
        where.append("g.item_type = ?")
        args.append(item_type)
    where.append(_hidden_styles_sql(hidden))    # every style row the switches hide (P5-AUD-1), picks included
    if trading_style:
        where.append("g.trading_style = ?")
        args.append(trading_style)
    if query:
        where.append("(g.title LIKE ? ESCAPE '\\' OR g.description LIKE ? ESCAPE '\\')")
        args.extend([_like(query), _like(query)])
    if sort == "most_used":
        order = "used_by DESC, COALESCE(g.listed_at, g.created_at) DESC"
    elif sort == "trending":
        order = "trending_count DESC, used_by DESC, COALESCE(g.listed_at, g.created_at) DESC"
    else:
        order = "COALESCE(g.listed_at, g.created_at) DESC"
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = _read(conn, viewer_id, " AND ".join(where), args, list_only=True,
                     tail=f" ORDER BY {order}, g.rowid DESC LIMIT {LIST_LIMIT}")
        return [_summary(r, viewer_id=viewer_id, is_admin=is_admin) for r in rows]
    finally:
        if owned:
            conn.close()


def _row(conn: sqlite3.Connection, gallery_id: str, viewer_id: str | None = None) -> sqlite3.Row | None:
    """One gallery row, whole. `viewer_id` is whose `helpedByMe` it reads (None: nobody's)."""
    return _read(conn, viewer_id, "g.id = ?", (gallery_id,)).fetchone()


def _hidden_item_types(library_on: bool | None = None) -> tuple[str, ...]:
    """⛔ THE ONE RULE for which NON-STYLE item types are absent right now (R-P3b-6, R-P4b-10): an example note
    while its switch is off, a page layout while layout sharing is off. Style rows are NOT this function's:
    `_hidden_styles` owns them (P5-AUD-1), so there is one decision over style visibility, not two.

    A caller that already read `library_enabled` for this request passes it as `library_on`, so a list reads the
    library switch once (P5-T5b-R1); every other caller lets this read it."""
    if library_on is None:
        library_on = library_enabled()
    hidden = []
    if not (library_on and _example_switch_on()):
        hidden.append(EXAMPLE_ITEM)
    if not (library_on and _layout_switches_on()):
        hidden.append(LAYOUT_ITEM)
    return tuple(hidden)


def _type_visible_clause(library_on: bool | None = None) -> str:
    """`_hidden_item_types` as a WHERE term over the alias `g`, always non-empty, so a caller ANDs it in."""
    hidden = _hidden_item_types(library_on)
    return "1 = 1" if not hidden else "g.item_type NOT IN (" + ", ".join(f"'{t}'" for t in hidden) + ")"


# ── which STYLE rows the gallery hides: ONE rule, two renderings (P5-AUD-1) ─────────────────────
#
# `_hidden_styles()` is the only place the decision is made. `_library_hides` renders it for one row (the
# single-item reads and the write doors) and `_hidden_styles_sql` renders it as a WHERE term (every list read),
# so the two cannot disagree about a switch state: they branch on the same answer, and
# tests/test_firm_style_seed.py holds them equal over every switch state and every kind of row.

def _hidden_styles() -> str:
    """What the gallery hides of its style rows right now, read PER CALL.

    `"all"`  -- the library switch is off: every style row reads as absent (R-P3-10, R-T3-w1).
    `"firm"` -- the library is on and the starter-packs switch is off: the firm style rows (`kind = 'firm'`, the
               starter packs' fifteen seeded picks) read as absent (P5-AUD-1). So a firm style row is listed, in
               every read and in UCT picks, ONLY while BOTH switches are on, and NOTEBOOK_STARTER_PACKS_ENABLED=0
               hides them again. The pack install does not go through this: it reads its rows directly
               (`starter_packs.install`, behind its own switches)."""
    if not library_enabled():
        return "all"
    if not starter_packs.enabled():
        return "firm"
    return ""


def _library_hides(row: sqlite3.Row) -> bool:
    """`_hidden_styles()` for one row. A hidden row reads exactly like one that does not exist: for its author
    and an admin as much as for a browsing member. `row` must carry `item_type` and `kind`.

    P3b (R-P3b-6): an example-note row reads the same way while ITS switch is off (which the library switch
    being off implies). Stored, never deleted: arming the switch again brings it back as it was. This branch
    comes FIRST (P5-FIN-R1): the style rule below answers False for every non-style row.

    P4b (R-P4b-10): a page-layout row reads the same way while layout sharing is off (all three of its switches),
    so `GET /{id}`, Helpful, report, the admin routes and adopt all 404 a layout without a route gate of their own.
    ⛔ ONE ORDER (P4b final T1): the example branch, then the layout branch, then P5's style rule. The two
    non-style branches ask `_hidden_item_types`, the same answer the list WHERE renders (`_type_visible_clause`).

    ⛔ C1 (P5 landing review M-1, P4b final): BOTH columns are read here for EVERY row, before any branch. A narrow
    SELECT that leaves `kind` out then fails in every test of every switch state, never only for a style row in
    the one state (library on, starter packs off) that reads `kind`, which is how C1 hid."""
    item_type, kind = row["item_type"], row["kind"]
    if item_type == EXAMPLE_ITEM:
        return EXAMPLE_ITEM in _hidden_item_types()
    if item_type == LAYOUT_ITEM:
        return LAYOUT_ITEM in _hidden_item_types()
    if item_type != "style":
        return False
    hidden = _hidden_styles()
    return hidden == "all" or (hidden == "firm" and kind == "firm")


def _hidden_styles_sql(hidden: str | None = None) -> str:
    """`_hidden_styles()` as a WHERE term over the alias `g`, always non-empty, so a caller ANDs it in.
    A caller that already holds this request's `_hidden_styles()` answer passes it, so the switches are read once."""
    if hidden is None:
        hidden = _hidden_styles()
    if hidden == "all":
        return "g.item_type = 'outline'"
    if hidden == "firm":
        return "NOT (g.item_type = 'style' AND g.kind = 'firm')"
    return "1 = 1"


def _can_see(row: sqlite3.Row | None, viewer_id: str, is_admin: bool, conn: sqlite3.Connection) -> bool:
    """THE visibility rule for one gallery row: the author and an admin always; anyone else only when it is approved
    and not hidden. `conn` is required because of the clause below: no caller can skip it by omission.

    P3b-T6-R6: an EXAMPLE note is also only shown to anyone else while the style it shows is shown (approved, not
    hidden, its own author's). A moderator who hides a style hides what shows it in use: the example's read and its
    image route answer their one 404, while its author and an admin still see it. Stored, never touched: unhiding the
    style brings it back."""
    if row is None or _library_hides(row):
        return False
    if is_admin or (viewer_id and row["user_id"] == viewer_id):
        return True
    if not (row["status"] == "approved" and not row["hidden"]):
        return False
    return row["item_type"] != EXAMPLE_ITEM or _example_style_shown(conn, row)


def _example_style_shown(conn: sqlite3.Connection, row: sqlite3.Row) -> bool:
    """Is the style an example row shows visible to every member (approved, not hidden, the example's own author's)?"""
    link = _safe_example(_listed_payload(row))["linkedItemId"]
    if not link:
        return False
    style = conn.execute("SELECT id, user_id, item_type, kind, status, hidden FROM j2_template_gallery"
                         " WHERE id = ? AND item_type = 'style'", (link,)).fetchone()
    return style is not None and style["user_id"] == row["user_id"] and _can_see(style, "", False, conn)


def get_item(viewer_id: str, gallery_id: str, *, is_admin: bool = False,
             conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """One template in full (`bodyJson`, `propertyDefs`), or None when the viewer may not
    see it -- a pending or hidden template reads exactly like one that does not exist."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _row(conn, gallery_id, viewer_id)
        if not _can_see(row, viewer_id, is_admin, conn):
            return None
        out = _summary(row, viewer_id=viewer_id, is_admin=is_admin)
        if row["item_type"] == LAYOUT_ITEM:
            return _layout_item(out, row, is_admin)
        out["bodyJson"] = _stored_body(row)
        out["propertyDefs"] = json.loads(row["property_defs_json"]) if row["property_defs_json"] else []
        if row["item_type"] == "style":
            # P3a Task 9: the library's Preview composes this through the journal styles preview door.
            # `payload_json` (the LISTED version), read through the same safe readers adopt uses, so a
            # malformed row reads as an empty style instead of a 500.
            out["payload"] = _safe_listed(_listed_payload(row))
            # P3a Task 10 fix round 1 (ruling P3a-T10-R1): a reviewer must see a held REVISION before approving
            # it. ADMINS ONLY, and only on this single-row read (the list and the queue never name pending_json,
            # the M-6 / R-T4-1 rails); a member, the author included, never receives the field.
            if is_admin:
                rev = _pending_revision(row)
                if rev is not None:
                    out["pendingRevision"] = rev
            # P3b Task 6: the style's own examples ("In use"), only while the example switch is on (absent, not
            # empty, while it is off: the key itself is the switch's answer, as everywhere an example is absent).
            if example_enabled():
                out["examples"] = _style_examples(conn, row)
        elif row["item_type"] == EXAMPLE_ITEM:
            # P3b: an example's LISTED snapshot (`payload_json`, never `pending_json`) and, for a reviewer only, its
            # held revision -- the same rule as a style's, so a revision is seen before it is approved.
            out["payload"] = _safe_example(_listed_payload(row))
            if is_admin:
                rev = _pending_revision(row)
                if rev is not None:
                    out["pendingRevision"] = rev
            # P3b Task 6: the style it shows, by title, for whoever may see THAT style (the reviewer's "linked
            # style's title"); None when the reader may not see it (a pending one, say), never a hint it exists.
            out["linkedStyle"] = _linked_style(conn, out["payload"]["linkedItemId"], viewer_id, is_admin)
            # P3b-T6-R7: the style's id travels under the SAME gate as its title -- a reader who may not see the style
            # (it is gone, say) gets neither, never the id one key away from a carefully withheld title.
            if out["linkedStyle"] is None:
                out["payload"].pop("linkedItemId", None)
        return out
    finally:
        if owned:
            conn.close()


#: P3b Task 6: how many examples a style shows ("In use").
STYLE_EXAMPLES_SHOWN = 3


def _style_examples(conn: sqlite3.Connection, style: sqlite3.Row) -> list[dict[str, Any]]:
    """A style's examples as every member sees them: up to `STYLE_EXAMPLES_SHOWN` APPROVED, non-hidden example items
    linked to it by ITS OWN author, newest listed first, each exactly `{id, title, bodyJson, updatedAt}`.

    ⛔ The columns are NAMED, and `pending_json` is not among them: a held revision (an author's next version, not yet
    reviewed) never leaves this read. ⛔ `bodyJson` is the stored LISTED example reduction (`payload.bodyJson`, ruling
    P3b-R13), read through `_safe_example`; it is never re-reduced (gallery mode drops every image)."""
    rows = conn.execute(
        "SELECT id, title, payload_json, updated_at FROM j2_template_gallery g"
        f" WHERE g.item_type = ? AND {_VISIBLE} AND g.user_id = ?"
        " AND CASE WHEN json_valid(g.payload_json) THEN json_extract(g.payload_json, '$.linkedItemId') END = ?"
        f" ORDER BY COALESCE(g.listed_at, g.created_at) DESC, g.rowid DESC LIMIT {STYLE_EXAMPLES_SHOWN}",
        (EXAMPLE_ITEM, style["user_id"], style["id"])).fetchall()
    return [{"id": r["id"], "title": r["title"], "bodyJson": _safe_example(_listed_payload(r))["bodyJson"],
             "updatedAt": r["updated_at"]} for r in rows]


def _linked_style(conn: sqlite3.Connection, style_id: Any, viewer_id: str, is_admin: bool) -> dict | None:
    """The style an example shows, `{id, title}`, or None when there is none the viewer may see (`_can_see`)."""
    if not isinstance(style_id, str) or not style_id:
        return None
    row = conn.execute("SELECT id, user_id, title, item_type, kind, status, hidden FROM j2_template_gallery"
                       " WHERE id = ? AND item_type = 'style'", (style_id,)).fetchone()
    if not _can_see(row, viewer_id, is_admin, conn):
        return None
    return {"id": row["id"], "title": row["title"]}


def _pending_revision(row: sqlite3.Row) -> dict | None:
    """A held revision as a reviewer sees it, or None when there is none (or it cannot be read).

    `version` is the one members will see once it is approved (`admin_act` bumps the listed version by one).
    The payload goes through the same safe reader as the listed one, so a malformed revision reads as an
    empty style instead of a 500."""
    keys = row.keys()
    raw = row["pending_json"] if "pending_json" in keys else None
    if not raw:
        return None
    try:
        rev = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(rev, dict):
        return None
    text = lambda k: rev.get(k) if isinstance(rev.get(k), str) else None  # noqa: E731
    # P4b (P4b-R-X5): a held LAYOUT revision is read through `usable_layout` (`safe_layout`, then drift-emptied
    # lists dropped: P4b-T6-R1), never the style reader, so a reviewer sees what adopting it would apply.
    item_type = row["item_type"] if "item_type" in keys else None
    payload = (_safe_example(rev.get("payload")) if item_type == EXAMPLE_ITEM
               else pls.usable_layout(rev.get("payload")) if item_type == LAYOUT_ITEM
               else _safe_listed(rev.get("payload")))
    return {"version": int(row["version"] or 1) + 1, "title": text("title") or "",
            "description": text("description") or "", "category": text("category"),
            "tradingStyle": text("tradingStyle"), "payload": payload}


def _layout_item(out: dict[str, Any], row: sqlite3.Row, is_admin: bool) -> dict[str, Any]:
    """P4b (P4b-R-X5): what a `page_layout` row's single read serves. The LISTED payload (`payload_json`, never
    `pending_json`), read through `usable_layout` so whatever is stored leaves as registry ids in `{id, shown}`
    entries with drift-emptied lists dropped, exactly what `adopt_layout` applies (P4b-T6-R1). None when it cannot
    be read or no list keeps a panel: not usable, never an empty layout, and never a 500. NEVER `bodyJson` or
    `propertyDefs`: a layout has no body and no properties, and its row's `body_json` is an empty document kept
    only for the outline-shaped columns. A reviewer also gets the held revision, admins only, the same rule as a style's."""
    out["payload"] = pls.usable_layout(_listed_payload(row))
    if is_admin:
        rev = _pending_revision(row)
        if rev is not None:
            out["pendingRevision"] = rev
    return out


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
        preview_json = json.dumps(preview_lines(body))      # stored once, read by the list (M-6)
        defs = property_definitions(user_id, src["properties_json"], conn)
        defs_json = json.dumps(defs) if defs else None
        author_handle(user_id, conn)     # R-P3-2: a new or resubmitted item always has an author handle
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
                " updated_at = ?, preview_json = ? WHERE id = ?",
                (clean_title, clean_desc, clean_cat, body_json, defs_json, now, preview_json, gid),
            )
        else:
            gid = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO j2_template_gallery (id, user_id, source_template_id, kind, title,"
                " description, category, body_json, property_defs_json, status, created_at,"
                " updated_at, preview_json) VALUES (?, ?, ?, 'member', ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
                (gid, user_id, src["id"], clean_title, clean_desc, clean_cat, body_json,
                 defs_json, now, now, preview_json),
            )
        conn.commit()
        return _summary(_row(conn, gid, user_id), viewer_id=user_id, is_admin=False)
    finally:
        if owned:
            conn.close()


CUSTOM_KIND_SENTENCE = "Only styles for a built-in kind of note can be shared yet."
ADOPTED_SHARE_SENTENCE = "This style came from the library, so it can't be shared again."


def style_payload(user_id: str, style_id: Any, conn: sqlite3.Connection) -> dict | None:
    """The portable copy of one of the member's own styles, or None when it is not theirs.

    ⛔ A built-in kind only (R-P3-9). The outline is inlined (from the style, else its
    template) and reduced in gallery mode. Blocks travel verbatim: their settings are enum
    values the server's own catalogue validated on save. Only BUILT-IN user-set property
    defaults travel; the member's own are counted in `droppedProperties` and left out.

    ⛔ R-T1a, two traps in the style layer this must not inherit. (1) `BUILTIN_USER_SET_IDS`
    includes `builtin:note_kind`, which `_clean_properties` REFUSES on save (a style's kind is its
    `kindId`), so it is left out of the defaults, and not counted as a drop. (2) `_clean_blocks`
    keeps an UNKNOWN block id verbatim (a newer version's block), so only ids in `KNOWN_BLOCKS`
    travel: the gallery never publishes a block this server cannot place."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two import note_kinds as nk
    from api.services.journal_two import note_properties as np

    if not isinstance(style_id, str) or style_id.startswith(js.BUILTIN_PREFIX):
        return None
    style = js.get_style(user_id, style_id, conn, full=True)
    if style is None:
        return None
    if style.get("sourceGalleryId"):
        # Ruling P3a-T10-R3: a copy adopted from another author's listing is not the adopter's to share.
        # Ruling P3a-T10-R5: FAIL CLOSED. Only a source row that still exists AND is this member's own lets it
        # through; a withdrawn listing (unpublish deletes the row) or a purged author's leaves the provenance
        # pointing at nothing, and that is refused with the same sentence, never read as "no source".
        src = conn.execute("SELECT user_id FROM j2_template_gallery WHERE id = ?",
                           (style["sourceGalleryId"],)).fetchone()
        if src is None or src["user_id"] != user_id:
            raise GalleryError(ADOPTED_SHARE_SENTENCE)
    if style["kindId"] not in nk.BUILTIN_KIND_IDS:
        raise GalleryError(CUSTOM_KIND_SENTENCE)
    outline = style.get("outlineBodyJson")
    if not outline and style.get("outlineTemplateId"):
        row = conn.execute("SELECT body_json FROM j2_note_templates WHERE id = ? AND user_id = ?",
                           (style["outlineTemplateId"], user_id)).fetchone()
        try:
            outline = json.loads(row["body_json"]) if row else None
        except (TypeError, ValueError):
            outline = None
    props, dropped = {}, 0
    for pid, value in (style.get("properties") or {}).items():
        if pid == nk.NOTE_KIND_PROPERTY:
            continue
        if np.is_builtin_property_id(pid) and pid in np.BUILTIN_USER_SET_IDS:
            props[pid] = value
        else:
            dropped += 1
    return {
        "kindId": style["kindId"],
        "outlineBodyJson": sanitize_body(outline, user_id) if outline else None,
        "blocks": [b for b in (style.get("blocks") or [])
                   if isinstance(b, dict) and b.get("block") in js.KNOWN_BLOCKS],
        "properties": props,
        "droppedProperties": dropped,
    }


def _clean_trading_style(raw: Any) -> str | None:
    if raw in (None, ""):
        return None
    if raw not in TRADING_STYLES:
        raise GalleryError("Pick a trading style, or leave it blank.")
    return raw


_HELD_KEY_COLUMNS = ("source_style_id", "source_page")


def _write_held_or_replaced(conn: sqlite3.Connection, *, user_id: str, key_column: str, key: Any,
                            item_type: str, title: str, description: str, category: str,
                            trading_style: str | None, body: dict, preview: list, payload: dict) -> str:
    """R-P3-3's (re)submission write for a style and a layout, shared by `publish_style` and `publish_layout`.
    ⛔ NOT the only one (P4b final m-3): P3b's `publish_example` still carries its own held / replaced / insert
    block, keyed on the source note AND the linked style with an id it assigns before the reduction. Folding it
    in here (an `existing` predicate and a preset id) is a follow-up; until then the two must change together.
    Keyed on (author, `key_column` = `key`, `item_type`): the first publish INSERTs a PENDING
    item; again while pending or rejected it is replaced in place, back to pending; again while APPROVED the new
    version is HELD in `pending_json` and the approved one stays listed. Returns the item id; the caller commits.
    `key_column` is interpolated, so it is held to a closed set."""
    if key_column not in _HELD_KEY_COLUMNS:
        raise ValueError(f"not a gallery key column: {key_column!r}")
    now = _now()
    payload_json = json.dumps(payload)
    body_json = json.dumps(body)
    preview_json = json.dumps(preview)
    existing = conn.execute(
        f"SELECT id, status FROM j2_template_gallery WHERE user_id = ? AND {key_column} = ? AND item_type = ?",
        (user_id, key, item_type)).fetchone()
    if existing and existing["status"] == "approved":
        revision = {"title": title, "description": description, "category": category,
                    "tradingStyle": trading_style, "payload": payload, "preview": preview}
        conn.execute(
            "UPDATE j2_template_gallery SET pending_json = ?, pending_at = ?, review_note = NULL,"
            " updated_at = ? WHERE id = ?",
            (json.dumps(revision), now, now, existing["id"]))
        return existing["id"]
    if existing:
        conn.execute(
            "UPDATE j2_template_gallery SET title = ?, description = ?, category = ?, trading_style = ?,"
            " body_json = ?, payload_json = ?, status = 'pending', review_note = NULL, reviewed_by = NULL,"
            " reviewed_at = NULL, featured = 0, listed_at = NULL, updated_at = ?, preview_json = ?,"
            " pending_json = NULL, pending_at = NULL WHERE id = ?",
            (title, description, category, trading_style, body_json, payload_json, now,
             preview_json, existing["id"]))
        return existing["id"]
    gid = uuid.uuid4().hex
    conn.execute(
        f"INSERT INTO j2_template_gallery (id, user_id, {key_column}, kind, title, description,"
        " category, body_json, status, created_at, updated_at, preview_json, item_type,"
        " payload_json, version, trading_style)"
        " VALUES (?, ?, ?, 'member', ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1, ?)",
        (gid, user_id, key, title, description, category, body_json, now, now,
         preview_json, item_type, payload_json, trading_style))
    return gid


def publish_style(user_id: str, style_id: Any, *, title: Any, description: Any, category: Any,
                  trading_style: Any, conn: sqlite3.Connection | None = None) -> dict | None:
    """Submit (or resubmit) one of the member's own styles. None when the library is off
    or the style is not theirs.

    First publish: a PENDING style item. Again while pending or rejected: replaces it in
    place, back to pending (today's outline rule). Again while APPROVED: the new version is
    HELD in `pending_json` and the approved one stays listed (R-P3-3)."""
    if not library_enabled():
        return None
    clean_title = _clean_text(title, field="title", limit=MAX_TITLE_CHARS, required=True)
    clean_desc = _clean_text(description, field="description", limit=MAX_DESCRIPTION_CHARS, required=False)
    clean_cat = _clean_category(category)
    clean_ts = _clean_trading_style(trading_style)
    owned = conn is None
    conn = conn or get_connection()
    try:
        payload = style_payload(user_id, style_id, conn)
        if payload is None:
            return None
        dropped = payload.pop("droppedProperties")
        payload_json = json.dumps(payload)
        if len(payload_json.encode("utf-8")) > MAX_BODY_BYTES:
            raise GalleryError("That style is too long for the gallery. Trim its outline and try again.")
        body = payload["outlineBodyJson"] or {"type": "doc", "content": []}
        preview_json = json.dumps(preview_lines(body))
        author_handle(user_id, conn)     # R-P3-2: a new or resubmitted item always has an author handle
        gid = _write_held_or_replaced(
            conn, user_id=user_id, key_column="source_style_id", key=style_id, item_type="style",
            title=clean_title, description=clean_desc, category=clean_cat, trading_style=clean_ts,
            body=body, preview=json.loads(preview_json), payload=payload)
        conn.commit()
        out = _summary(_row(conn, gid, user_id), viewer_id=user_id, is_admin=False)
        out["droppedProperties"] = dropped
        return out
    finally:
        if owned:
            conn.close()


# ── sharing a page layout (P4b Task 4) ─────────────────────────────────────────────────────────

_LAYOUT_EMPTY_BODY = {"type": "doc", "content": []}


def publish_layout(user_id: str, page: Any, *, title: Any, description: Any, category: Any,
                   trading_style: Any, conn: sqlite3.Connection | None = None) -> dict | None:
    """Share (or share again) one page of the member's OWN saved layout. None while layout sharing is off.

    ⛔ R-P4b-3/4: the payload is built from the member's own `journal_page_layout` preference, read here through
    `conn` (V3, P4b-R-X1: `user_preferences.pref_value`), never from anything the client sends; the client names
    only the page. `pls.layout_payload` keeps registry panels and counts the rest (`droppedPanels`, R-P4b-6), and
    `validate_layout_payload`, the write door, runs on that payload immediately before the write (R-P4b-6a). A
    refusal is a `GalleryError` carrying one of the three sentences (the door's own words never reach a member).

    The item is written by `_write_held_or_replaced`, the one write `publish_style` uses too, keyed on (author, page): the first share is a
    PENDING item; again while pending or rejected it is replaced in place, back to pending; again while APPROVED
    the new version is HELD in `pending_json` and the approved one stays listed. The body is an empty document
    and the preview is empty: a layout has neither. Returns the author's summary plus `droppedPanels`."""
    if not layout_sharing_enabled():
        return None
    if page not in LAYOUT_PAGES:        # the page first, before any field is cleaned (review Minor 2)
        raise GalleryError(pls.PAGE_SENTENCE)
    clean_title = _clean_text(title, field="title", limit=MAX_TITLE_CHARS, required=True, noun="layout")
    clean_desc = _clean_text(description, field="description", limit=MAX_DESCRIPTION_CHARS, required=False)
    clean_cat = _clean_category(category)
    clean_ts = _clean_trading_style(trading_style)
    owned = conn is None
    conn = conn or get_connection()
    try:
        pref = conn.execute("SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = ?",
                            (user_id, pls.LAYOUT_PREF)).fetchone()
        payload, dropped = pls.layout_payload(pref["pref_value"] if pref else None, page)
        author_handle(user_id, conn)     # R-P3-2: a new or resubmitted item always has an author handle
        pls.validate_layout_payload(payload)      # ⛔ THE WRITE DOOR, immediately before the write (R-P4b-6a)
        gid = _write_held_or_replaced(
            conn, user_id=user_id, key_column="source_page", key=page, item_type=LAYOUT_ITEM,
            title=clean_title, description=clean_desc, category=clean_cat, trading_style=clean_ts,
            body=_LAYOUT_EMPTY_BODY, preview=[], payload=payload)
        conn.commit()
        out = _summary(_row(conn, gid, user_id), viewer_id=user_id, is_admin=False)
        out["droppedPanels"] = dropped
        return out
    except pls.LayoutPayloadError as e:
        raise GalleryError(str(e) if str(e) in pls.LAYOUT_SENTENCES else pls.UNREADABLE_SENTENCE) from None
    finally:
        if owned:
            conn.close()


def layout_status(user_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """`{"shared": {"today": summary-or-None, "trade": summary-or-None}}`: the member's OWN layout items, one per
    page, in every state (the author's summary carries `status`, `version` and `hasRevision`). None while layout
    sharing is off."""
    if not layout_sharing_enabled():
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        shared: dict[str, Any] = {p: None for p in LAYOUT_PAGES}
        for r in _read(conn, user_id, "g.user_id = ? AND g.item_type = ?", (user_id, LAYOUT_ITEM), list_only=True):
            if r["source_page"] in shared:
                shared[r["source_page"]] = _summary(r, viewer_id=user_id, is_admin=False)
        return {"shared": shared}
    finally:
        if owned:
            conn.close()


def _ring(user_id: str, title: str, message: str, data: dict) -> bool:
    """One private bell row (a user_id never reaches Discord). False when it was not delivered: a notice
    never fails the approval or the unpublish that caused it, and the caller only records a delivery that
    happened."""
    from api.services import alerts
    try:
        alerts.add_alert(LIBRARY_NOTICE_SOURCE, title, message, severity="info",
                         data={"source": LIBRARY_NOTICE_SOURCE, **data}, user_id=user_id)
        return True
    except Exception as e:  # noqa: BLE001 -- a notice never fails an approval or an unpublish
        print(f"[template-gallery] notice to {user_id} not delivered: {type(e).__name__}: {e}")
        return False


def _ring_update_watchers(conn: sqlite3.Connection, gallery_id: str) -> int:
    """Tell each watcher still behind a listed style's current version that a new one is out, once.

    ⛔ `notified_version < version` is the whole once-only rule: a delivered notice advances the watch to
    the version it announced, a failed one leaves it behind so the next review action retries it. Only a
    watch whose copy still exists is rung (the link opens that copy), and never the author's own."""
    item = conn.execute(
        "SELECT title, version, user_id FROM j2_template_gallery WHERE id = ? AND item_type = 'style'"
        " AND status = 'approved' AND hidden = 0", (gallery_id,)).fetchone()
    if item is None:
        return 0
    version = int(item["version"] or 1)
    behind = conn.execute(
        "SELECT w.user_id, w.style_id FROM j2_gallery_watches w JOIN j2_journal_styles s"
        " ON s.id = w.style_id AND s.user_id = w.user_id AND s.deleted_at IS NULL"
        " WHERE w.gallery_id = ? AND w.notified_version < ? AND w.user_id != ?",
        (gallery_id, version, item["user_id"])).fetchall()
    rung = 0
    for w in behind:
        if _ring(w["user_id"], item["title"], UPDATE_NOTICE.format(title=item["title"]),
                 {"research_url": f"{LIBRARY_UPDATE_PATH}{w['style_id']}", "styleId": w["style_id"],
                  "galleryId": gallery_id, "version": version}):
            conn.execute("UPDATE j2_gallery_watches SET notified_version = ? WHERE gallery_id = ? AND user_id = ?",
                         (version, gallery_id, w["user_id"]))
            # ⛔ Committed per watcher, BEFORE the next add_alert: its durable copy is written through a SECOND
            # connection to this same auth.db, and an open write transaction here would make that insert wait
            # out its busy timeout, fail silently, and leave the next member's notice recorded as delivered
            # while it lives only in the in-memory cache (Task 7 review C1). It also never holds the
            # app-wide write lock across a delivery.
            conn.commit()
            rung += 1
    return rung


def unpublish(user_id: str, gallery_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """The author takes their copy down. Always possible, in every state. Deletes the
    gallery copy and the reports, use counts, watches and helpful votes about it -- the author's own request
    about their own content; copies others already made are theirs and stay.

    P3a Task 7: each member watching a STYLE is told once that it was taken down, after the delete has
    committed, so a failed notice can never keep a listing up. The watches are read before the delete."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        item = conn.execute(
            "SELECT item_type, title FROM j2_template_gallery WHERE id = ? AND user_id = ? AND kind = 'member'",
            (gallery_id, user_id)).fetchone()
        # The same rule as the update ring: only a watcher whose copy still exists is told ("your copy is
        # yours" is a sentence about that copy). While the library is off the delete still happens (taking
        # your own content down is always possible) but nobody is rung: a withdraw notice is a library effect,
        # and a library-off pod must look exactly like today (R-P3-10; final review M-8).
        watchers = [] if (item is None or item["item_type"] != "style" or not library_enabled()) else [
            r["user_id"] for r in conn.execute(
                "SELECT w.user_id FROM j2_gallery_watches w JOIN j2_journal_styles s"
                " ON s.id = w.style_id AND s.user_id = w.user_id AND s.deleted_at IS NULL"
                " WHERE w.gallery_id = ? AND w.user_id != ?", (gallery_id, user_id)).fetchall()]
        cur = conn.execute(
            "DELETE FROM j2_template_gallery WHERE id = ? AND user_id = ? AND kind = 'member'",
            (gallery_id, user_id),
        )
        # P3b Task 4: withdrawing a STYLE withdraws its example notes the same way (they show that style, R-P3b-2,
        # and nothing else may list them), and withdrawing anything removes its image copies. The examples are
        # the author's own (a style links only its author's examples), read whatever the switches say: taking your
        # own content down is always possible. Read AFTER the delete above, which holds the write lock, so an
        # example published at the same moment is either committed and found here, or refused by its own in-lock
        # re-check of the style (P3b-T3-R6).
        examples = [] if not cur.rowcount or item is None or item["item_type"] != "style" else [
            r["id"] for r in conn.execute(
                "SELECT id FROM j2_template_gallery WHERE user_id = ? AND kind = 'member' AND item_type = ?"
                " AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.linkedItemId') END = ?",
                (user_id, EXAMPLE_ITEM, gallery_id)).fetchall()]
        removed = [gallery_id] + examples if cur.rowcount else []
        for gid in removed:
            if gid != gallery_id:
                conn.execute("DELETE FROM j2_template_gallery WHERE id = ? AND user_id = ?", (gid, user_id))
            conn.execute("DELETE FROM j2_template_gallery_reports WHERE gallery_id = ?", (gid,))
            conn.execute("DELETE FROM j2_template_gallery_uses WHERE gallery_id = ?", (gid,))
            conn.execute("DELETE FROM j2_gallery_watches WHERE gallery_id = ?", (gid,))
            conn.execute("DELETE FROM j2_gallery_helpful WHERE item_id = ?", (gid,))
        conn.commit()
        remove_example_images(removed)                # after the commit: a copy is never gone while its row is not
        if cur.rowcount:
            for watcher in watchers:
                _ring(watcher, item["title"], WITHDRAW_NOTICE.format(title=item["title"]), {"galleryId": gallery_id})
        return bool(cur.rowcount)
    finally:
        if owned:
            conn.close()


# ── example notes: the preview, the publish, held revisions (P3b Task 3) ──────────────────────
#
# An EXAMPLE NOTE is a reduced SNAPSHOT of one of the author's own notes, shown on one of their shared styles
# so browsers see the style in use (R-P3b-1, R-P3b-2). It is reduced by the ONE reducer in its `example` mode
# (`public_note_payload.reduce`), on the server, from the note as the DATABASE holds it: a request never
# carries a body, and anything one sends is ignored. `payload_json` holds
# `{"bodyJson", "linkedItemId", "noteKind"}`; a later edit to the note never reaches it.
#
# ⛔ A change entry's `before` is the author's own text (R-P3b-4). The preview hands it to the AUTHOR and
# nowhere else; publish asks the reducer for no report at all, so there is nothing of it to store or log.

EXAMPLE_STYLE_SENTENCE = "Pick one of your own shared styles."
EXAMPLE_KIND_SENTENCE = "This note is a different kind from the style."
EXAMPLE_TOO_LONG_SENTENCE = "That note is too long to share as an example. Trim it and try again."
#: The gallery image route an example's switched-on image is rewritten to (Task 4 serves it); `n` is the
#: image's place in the reduced body, from 0. It must match `public.EXAMPLE_IMAGE_ROUTE`.
EXAMPLE_IMAGE_PATH = "/api/j2/template-gallery/{item_id}/images/"
#: The preview's stand-in item id. The reducer keeps an image only on the gallery route, so the preview
#: reduces against this one and then points each kept image back at the author's own address: a preview is
#: the author's own view of their own images.
_PREVIEW_ITEM_ID = "preview"
#: The OCR states an image is listed with (R-P3b-5).
OCR_STATES = ("ready", "no_text", "processing", "unavailable")


def _example_note(conn: sqlite3.Connection, user_id: str, note_id: Any) -> dict | None:
    """The note an example is made from, or None when it may not be one: not this member's, trashed,
    archived, unreadable, or written by the sample notebook (ruling P3b-R11 -- a sample is never shown to
    other members as a member's own example). A PLAIN SELECT: reading a note to reduce it writes nothing."""
    from api.services.journal_two.note_kinds import NOTE_KIND_PROPERTY
    if not isinstance(note_id, str) or not note_id.strip():
        return None
    row = conn.execute(
        "SELECT id, title, body_json, properties_json, import_source FROM j2_notes"
        " WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND archived_at IS NULL",
        (note_id, user_id)).fetchone()
    if row is None or sample_marker.is_sample(row["import_source"]):
        return None
    # ⛔ P3b-T3-R1 (review I-1): BOUNDED BEFORE ANY REDUCTION. A note body may be 1 MB and a reduction of one is
    # seconds of CPU on the one web process; an example's stored body may be at most MAX_BODY_BYTES, so a note
    # whose stored body is already larger is refused here, measured on the stored text, before it is parsed.
    # Only after the ownership check: the size of a note that is not yours is never an answer.
    if len((row["body_json"] or "").encode("utf-8")) > MAX_BODY_BYTES:
        raise GalleryError(EXAMPLE_TOO_LONG_SENTENCE)
    try:
        body = json.loads(row["body_json"] or '{"type": "doc", "content": []}')
    except (TypeError, ValueError, RecursionError):
        return None
    try:
        props = json.loads(row["properties_json"] or "{}")
    except (TypeError, ValueError, RecursionError):
        props = {}
    kind = props.get(NOTE_KIND_PROPERTY) if isinstance(props, dict) else None
    return {"id": row["id"], "title": row["title"] or "", "body": body,
            "kind": kind if isinstance(kind, str) and kind else None}


def _author_brokers(conn: sqlite3.Connection, user_id: str) -> tuple[str, ...]:
    """The author's own brokerage institution names (V6: `j2_broker_accounts.brokerage_name`), for the
    reducer's broker pass. The house `BROKER_NAMES` always apply on top (example_sanitize, fail closed), so
    a member with no connected broker still gets them."""
    try:
        rows = conn.execute("SELECT DISTINCT brokerage_name FROM j2_broker_accounts"
                            " WHERE user_id = ? AND brokerage_name IS NOT NULL", (user_id,)).fetchall()
    except sqlite3.OperationalError:
        return ()
    return tuple(sorted({r[0].strip() for r in rows if isinstance(r[0], str) and r[0].strip()}))


def _image_nodes(doc: Any):
    """Every image node in a document, in body order."""
    if isinstance(doc, dict):
        if doc.get("type") == "image" and isinstance(doc.get("attrs"), dict):
            yield doc
        for c in doc.get("content") or []:
            yield from _image_nodes(c)


def _reduce_example(body: Any, *, user_id: str, note_id: str, images_on: Any, brokers: tuple[str, ...],
                    item_id: str, report: list | None, offered: list | None = None) -> tuple[dict, list[str]]:
    """The example copy of a note's body, and the ORIGINAL address of each image it keeps, by its `n`.

    Each switched-on image the reducer keeps is rewritten to `EXAMPLE_IMAGE_PATH` with its `n`: its place
    among the kept images in BODY order, from 0 (the same image twice is one `n`). The numbers are assigned
    on the reduced body, so an image the reducer called for and then dropped leaves no gap."""
    prefix = EXAMPLE_IMAGE_PATH.format(item_id=item_id)
    called: list[str] = []

    def src_for(src: str) -> str:
        if src not in called:
            called.append(src)
        return f"{prefix}{called.index(src)}"

    reduced = public.reduce(body, mode="example", owner_id=user_id, note_id=note_id, attachment_base="",
                            images_on=frozenset(s for s in images_on or () if isinstance(s, str)),
                            brokers=brokers, image_src_for=src_for, report=report, offered=offered)
    kept: list[str] = []
    for node in _image_nodes(reduced):
        src = node["attrs"].get("src")
        tail = src[len(prefix):] if isinstance(src, str) and src.startswith(prefix) else ""
        # OI-P3b-10: ASCII digits only -- `str.isdigit` admits "²", which `int` refuses (a 500), as review M-1 found
        if not (tail.isascii() and tail.isdigit()) or int(tail) >= len(called):
            continue                     # the reducer only keeps an image it rewrote; anything else is left as is
        original = called[int(tail)]
        if original not in kept:
            kept.append(original)
        node["attrs"] = {**node["attrs"], "src": f"{prefix}{kept.index(original)}"}
    return reduced, kept


#: `_example_title` caps by truncation after the scrubs, so gallery's `_clean_text` is asked for no cap of its own.
_NO_TITLE_LIMIT = 10 ** 9
#: ⛔ Ruling P3b-F2-R1 (final re-review N-1): a typed title is scrubbed WHOLE -- the scrub is linear -- and a raw
#: title longer than this is refused. A window over a longer one failed OPEN: a value whose deciding words sat past
#: the cut ("3.2R ... loss", a card number after a long address) was shown. Only a hand-built request reaches the
#: refusal: the sheet's field holds 80 characters and a note's title 300.
MAX_RAW_TITLE_CHARS = 2_000
RAW_TITLE_TOO_LONG_SENTENCE = "A title can be at most 2,000 characters."


def _example_text(raw: Any, brokers: tuple[str, ...]) -> Any:
    """A line of the author's text (the title) through the SAME example text pass the body takes: one
    paragraph reduced in `example` mode. Anything that is not text is returned as it is, for `_clean_text`
    to refuse."""
    if not isinstance(raw, str):
        return raw
    doc = public.reduce({"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": raw}]}]},
                        mode="example", owner_id="", note_id="", attachment_base="", brokers=brokers)
    return _node_text(doc)


def _example_title(raw: Any, brokers: tuple[str, ...], *, required: bool = True) -> str:
    """The title other members see (P3b-T3-R5). SCRUBBED FIRST -- gallery's text scrub (`_clean_text`, which also
    refuses anything but text, and an empty title when one is required), then the example text pass -- and only
    then capped at `MAX_TITLE_CHARS` by shortening it with an ellipsis. A scrub grows text ("$1" becomes "your
    value here", an email "email address"), so the SHOWN length is never a reason to refuse. The preview, with or
    without a typed title, shows this same title; the preview, the publish and a held revision all come here.

    P3b-F2-R1: the WHOLE raw title is scrubbed, never a window of it, and a raw title over `MAX_RAW_TITLE_CHARS`
    is refused (`RAW_TITLE_TOO_LONG_SENTENCE`), so the scrub's cost is bounded by what it reads."""
    if isinstance(raw, str) and len(raw) > MAX_RAW_TITLE_CHARS:
        raise GalleryError(RAW_TITLE_TOO_LONG_SENTENCE)
    cleaned = _clean_text(raw, field="title", limit=_NO_TITLE_LIMIT, required=required)
    scrubbed = " ".join(str(_example_text(cleaned, brokers)).split())
    if len(scrubbed) > MAX_TITLE_CHARS:
        scrubbed = scrubbed[: MAX_TITLE_CHARS - 1].rstrip() + "…"
    return scrubbed


def _image_ocr(conn: sqlite3.Connection, user_id: str, note_id: str, src: str,
               brokers: tuple[str, ...]) -> tuple[str, list[dict]]:
    """An image's OCR state and its warnings (R-P3b-5), read from the document pipeline that already runs on
    pasted images. Looked up by (note_id, attachment_url) through the existing document lookup (ruling
    P3b-R8); no document row -- the image documents switch off, or never made -- is `unavailable`.

    `ready` (the page holds text) warns about amounts, digit runs of 6+ and broker names; `no_text` has none;
    `processing` (still being read) and `unavailable` (failed, or nothing will read it) carry none either,
    and the client asks its second question for them. A warning never blocks: the author decides.

    ⛔ FAIL-CLOSED (ruling P3b-T8-R1). `no_text` is a claim that the image WAS READ and holds nothing, and the
    client lets it skip the second question. A document row's own `no_text` status does not say that: with no
    OCR engine wired, extraction gives an image one empty native page, planning claims nothing, and the row
    lands `no_text` without any read (document_extraction: "no engine means the row lands `no_text`"). So
    `no_text` is answered only when an OCR job for the image actually COMPLETED; an image no engine read is
    `unavailable`, never `no_text`. (The walk of record p3b-walk-20261018T121236Z found this, step 4.)"""
    from api.services.journal_two import document_extraction as dx
    from api.services.journal_two import document_ocr as docr
    try:
        doc = dx.get_document_by_attachment(user_id, note_id, src, conn=conn)
        if not doc or not doc.get("id"):
            return "unavailable", []
        state = docr.document_text_state(conn, user_id, doc["id"])
        if not state.get("exists"):
            return "unavailable", []
        if state.get("pages_with_text"):
            page = docr.page_transcript(user_id, doc["id"], 1, conn=conn)
            text = page.get("text") if isinstance(page, dict) else ""
            return "ready", example_sanitize.ocr_warnings(text if isinstance(text, str) else "", brokers)
        if state.get("ocr_unavailable") or state.get("status") == dx.STATUS_FAILED:
            return "unavailable", []
        if state.get("pages_awaiting_ocr") or state.get("status") == dx.STATUS_PENDING:
            return "processing", []
        jobs = state.get("ocr_jobs") if isinstance(state.get("ocr_jobs"), dict) else {}
        if not jobs.get(docr.OCR_COMPLETE):
            return "unavailable", []                 # never read: no OCR job finished for it
        return "no_text", []
    except Exception as e:  # noqa: BLE001 -- an unreadable state is "we couldn't read it", never a failed preview
        print(f"[template-gallery] example OCR state unread: {type(e).__name__}")
        return "unavailable", []


def preview_example_title(conn: sqlite3.Connection | None, user_id: str, note_id: Any, title: Any) -> dict | None:
    """P3b-F2-R2: the title alone, as other members would see it: `{"title": str}`. It scrubs the typed title (at most
    `MAX_RAW_TITLE_CHARS`) and reduces NOTHING of the note, so a member typing a title never re-reduces the body.
    The note must still be one that may be an example (None, the route's 404, otherwise); its body is not read
    beyond `_example_note`'s own checks. Writes nothing."""
    if not example_enabled():
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        note = _example_note(conn, user_id, note_id)
        if note is None:
            return None
        brokers = _author_brokers(conn, user_id)
        return {"title": _example_title(note["title"] if title is None else title, brokers, required=False)}
    finally:
        if owned:
            conn.close()


def preview_example(conn: sqlite3.Connection | None, user_id: str, note_id: Any, images_on: Any,
                    title: Any = None) -> dict | None:
    """Exactly what other members would see of this note, for its author (R-P3b-4). None when the switch is
    off or the note may not be an example (the route answers 404); `GalleryError` for a note too long to be one
    or a title that is not text. Writes nothing.

    `{"bodyJson": reduced, "changes": [{kind, before, after, path}], "counts": {kind: n},
      "images": [{src, name, ocr, warnings}], "title": str}` -- `images` lists every image of this note the
    author may switch on, in body order, at the author's own address; a switched-on one appears in `bodyJson`
    at that address too. `title` is the scrubbed form of `title` (or of the note's own title when none is
    given). `before` is the author's own text and goes to the author only."""
    if not example_enabled():
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        note = _example_note(conn, user_id, note_id)
        if note is None:
            return None
        brokers = _author_brokers(conn, user_id)
        shown_title = _example_title(note["title"] if title is None else title, brokers, required=False)
        changes: list[dict] = []
        # The images the author may switch on are the ones THIS reduction's walk reaches (P3b-T3-R4): the reducer
        # records each of this note's own images it meets, switched on or not, so one inside a node the policy
        # drops is never offered. One reduction, one walk, never a second copy of the own-attachment check.
        offered: list[str] = []
        body, kept = _reduce_example(note["body"], user_id=user_id, note_id=note["id"], images_on=images_on,
                                     brokers=brokers, item_id=_PREVIEW_ITEM_ID, report=changes, offered=offered)
        prefix = EXAMPLE_IMAGE_PATH.format(item_id=_PREVIEW_ITEM_ID)
        for node in _image_nodes(body):
            tail = str(node["attrs"].get("src") or "")[len(prefix):]
            if tail.isascii() and tail.isdigit() and int(tail) < len(kept):    # OI-P3b-10: ASCII digits only
                node["attrs"] = {**node["attrs"], "src": kept[int(tail)]}
        images = []
        for src in offered:
            state, warnings = _image_ocr(conn, user_id, note["id"], src, brokers)
            images.append({"src": src, "name": src.rsplit("/", 1)[-1], "ocr": state, "warnings": warnings})
        counts: dict[str, int] = {}
        for c in changes:
            counts[c["kind"]] = counts.get(c["kind"], 0) + 1
        return {"bodyJson": body, "changes": changes, "counts": counts, "images": images, "title": shown_title}
    finally:
        if owned:
            conn.close()


def _linkable_style(conn: sqlite3.Connection, user_id: str, style_item_id: Any) -> sqlite3.Row:
    """The style an example is linked to (R-P3b-2): the author's OWN style item, listed or pending, not
    withdrawn. Anything else -- someone else's, an outline, rejected, hidden, withdrawn (unpublish deletes
    the row) or not an id -- is `EXAMPLE_STYLE_SENTENCE`."""
    if not isinstance(style_item_id, str) or not style_item_id:
        raise GalleryError(EXAMPLE_STYLE_SENTENCE)
    row = conn.execute(
        "SELECT * FROM j2_template_gallery WHERE id = ? AND user_id = ? AND kind = 'member'"
        " AND item_type = 'style' AND status IN ('approved', 'pending') AND hidden = 0",
        (style_item_id, user_id)).fetchone()
    if row is None:
        raise GalleryError(EXAMPLE_STYLE_SENTENCE)
    return row


def _safe_example(payload: Any) -> dict:
    """An example's payload in its one shape, whatever is stored: a body document, the linked style's id and
    the note's kind (None when unreadable)."""
    raw = payload if isinstance(payload, dict) else {}
    body, link, kind = raw.get("bodyJson"), raw.get("linkedItemId"), raw.get("noteKind")
    return {"bodyJson": body if isinstance(body, dict) else {"type": "doc", "content": []},
            "linkedItemId": link if isinstance(link, str) else None,
            "noteKind": kind if isinstance(kind, str) else None}


def _bind_images(body: dict, draft_id: str, item_id: str) -> dict:
    """Point the image addresses of a body reduced against `draft_id` at the row it is written to (P3b-T3-R1:
    the reduction runs before the lock, so before the row is known). Runs INSIDE the short write transaction,
    between the lookup and the write. `EXAMPLE_IMAGE_ROUTE` fixes the address's shape, so only the id moves."""
    if draft_id != item_id:
        old, new = EXAMPLE_IMAGE_PATH.format(item_id=draft_id), EXAMPLE_IMAGE_PATH.format(item_id=item_id)
        for node in _image_nodes(body):
            src = node["attrs"].get("src")
            if isinstance(src, str) and src.startswith(old):
                node["attrs"] = {**node["attrs"], "src": new + src[len(old):]}
    return body


# ── example notes: the image copies (P3b Task 4) ───────────────────────────────────────────────
#
# Ruling P3b-R14. An example never points at the author's own attachment: each switched-on image the reduction
# keeps is COPIED at publish, so a later edit or delete of the note's image never reaches the example, and the
# copy is served by the gallery's own route to whoever may see the item.
#   * approved (or pending, never approved) copies: `<attachment_root>/gallery/<item_id>/<n>.<ext>`;
#   * a HELD revision's copies:                     `<attachment_root>/gallery/<item_id>/v<version>/<n>.<ext>`,
#     `version` being the one members will see once it is approved (the listed version + 1);
#   * the stored src stays `/api/j2/template-gallery/<item_id>/images/<n>` (no version): `?rev=pending` asks for
#     the held copy, and only the author or an admin gets it.
# Approval moves the held copies into place and deletes the old; rejection deletes the held ones; withdrawing an
# example (or the style it shows) and the author's account deletion delete the item's whole directory.
#
# ⛔ ALL OR NOTHING. The copies are made into a STAGING directory before the write lock is taken (a copy is disk
# I/O, never held under auth.db's lock); under the lock the staged directory is RENAMED into place (cheap) and the
# row written; a failure anywhere undoes the renames and removes the staging directory, so no row ever names a
# copy that is not there and no copy outlives a write that failed. The old copies are deleted only after commit.

EXAMPLE_MAX_IMAGES = 6
EXAMPLE_MAX_IMAGE_BYTES = 2 * 1024 * 1024
#: The stored extensions an example may show (R-P3b-7, the extension the attachment root records), and the one
#: each copy is stored under. A GIF, or anything else, is refused.
EXAMPLE_IMAGE_EXTENSIONS = {".png": ".png", ".jpg": ".jpg", ".jpeg": ".jpg", ".webp": ".webp"}
_COPY_EXTENSIONS = tuple(sorted(set(EXAMPLE_IMAGE_EXTENSIONS.values())))
EXAMPLE_IMAGE_COUNT_SENTENCE = "An example can show up to 6 images."
EXAMPLE_IMAGE_TYPE_SENTENCE = "Only PNG, JPEG or WebP images can be shared."
EXAMPLE_IMAGE_SIZE_SENTENCE = "An image in an example can be at most 2 MB."
EXAMPLE_COPY_SENTENCE = "Couldn't copy an image. Nothing was shared."
EXAMPLE_MOVE_SENTENCE = "Couldn't move the example's images into place. Nothing was listed."
#: The directory under the attachment root the copies live in (R-P3b-7). A member's own tree is
#: `<root>/<user_id>/...`; this one is shared by every author and is never one member's.
GALLERY_IMAGE_DIR = "gallery"
#: The `rev` the image route accepts besides none: the held revision's copy (author or admin only).
REV_PENDING = "pending"


def _gallery_root() -> Path:
    """Where the copies live, read PER CALL through the one attachment-root authority."""
    from api.services.journal_two.attachment_root import attachment_root
    return attachment_root() / GALLERY_IMAGE_DIR


_ITEM_ID_SEGMENT = re.compile(r"[A-Za-z0-9_-]{1,64}")        # the id shape `public.EXAMPLE_IMAGE_ROUTE` admits
#: An image number on the route: 1 to 3 ASCII digits, nothing else (review M-1: `str.isdigit` admits Unicode digits).
_IMAGE_NUMBER = re.compile(r"[0-9]{1,3}")


def _item_dir(item_id: str, version: int | None = None) -> Path:
    """An item's copy directory. The id is always a database row's, and must still be ONE plain path segment: a
    value that could climb, or name the gallery root itself, raises instead of resolving."""
    if not isinstance(item_id, str) or not _ITEM_ID_SEGMENT.fullmatch(item_id):
        raise ValueError("not an item id")
    base = _gallery_root() / item_id
    return base / f"v{int(version)}" if version is not None else base


def _rename(src: Path, dst: Path) -> None:
    """The one rename every move here goes through (a seam the tests fail on purpose)."""
    os.replace(src, dst)


def _copy_image(src: Path, dest: Path) -> None:
    """One copy, written to a temp file beside `dest` and then renamed onto it: `dest` is never opened for writing."""
    import shutil
    tmp = dest.with_name(f".{dest.name}.{uuid.uuid4().hex}.tmp")
    try:
        shutil.copyfile(src, tmp)
        os.replace(tmp, dest)
    finally:
        if tmp.exists():
            tmp.unlink()


def _remove_dir(path: Path) -> bool:
    """Delete a copy directory, best-effort (an old copy left behind is served by nothing). True when one was there."""
    import shutil
    if not path.is_dir():
        return False
    shutil.rmtree(path, ignore_errors=True)
    if path.exists():
        print(f"[template-gallery] could not remove {path.name} under the gallery image directory")
    return True


def _example_sources(kept: list[str], user_id: str, note_id: str) -> list[tuple[Path, str]]:
    """`(file, stored extension)` for each image the reduction kept, in its `n` order, through the ONE attachment
    resolver (ruling P3b-R8: `notes.serve_note_image_path`, root-anchored, after the URL shape `notes_export`
    owns). `GalleryError` for too many, a GIF (or any type but PNG, JPEG, WebP) and a file over 2 MB;
    `GalleryServerError` for one the attachment root does not hold (a copy cannot be made of it)."""
    if len(kept) > EXAMPLE_MAX_IMAGES:
        raise GalleryError(EXAMPLE_IMAGE_COUNT_SENTENCE)
    from api.services.journal_two import notes as notes_service
    from api.services.journal_two.notes_export import _ATTACHMENT_URL_RE
    matched = []
    for src in kept:
        m = _ATTACHMENT_URL_RE.match(src) if isinstance(src, str) else None
        if not m or m.group(1) != user_id or m.group(2) != note_id:
            raise GalleryServerError(EXAMPLE_COPY_SENTENCE)     # the reducer keeps only this note's own; fail closed
        matched.append(m)
    # OI-P3b-9 (review M-3): the TYPE of every image first, then files and sizes. Checked image by image, a missing
    # first image answered the 500 copy sentence before a later GIF's 400 -- the one the member can act on.
    exts = [EXAMPLE_IMAGE_EXTENSIONS.get(Path(m.group(4)).suffix.lower()) for m in matched]
    if None in exts:
        raise GalleryError(EXAMPLE_IMAGE_TYPE_SENTENCE)
    out: list[tuple[Path, str]] = []
    for m, ext in zip(matched, exts):
        path = notes_service.serve_note_image_path(m.group(1), m.group(2), m.group(3), m.group(4))
        if path is None:
            raise GalleryServerError(EXAMPLE_COPY_SENTENCE)
        try:
            size = path.stat().st_size
        except OSError as e:
            raise GalleryServerError(EXAMPLE_COPY_SENTENCE) from e
        if size > EXAMPLE_MAX_IMAGE_BYTES:
            raise GalleryError(EXAMPLE_IMAGE_SIZE_SENTENCE)
        out.append((path, ext))
    return out


def _assert_copy_headroom(sources: list[tuple[Path, str]]) -> None:
    """P3b-F-R7 (final review M-6): the copies ask the volume the question every upload and import asks first --
    `notes_quota.assert_import_headroom`, with the sources' summed size -- and a refusal is that check's own
    sentence (a 400, as an upload's is), before anything is copied. Up to 12 MB a publish, 10 a day a member,
    would otherwise be written past the reserve the uploads keep."""
    if not sources:
        return
    from api.services.journal_two import notes_quota
    try:
        wanted = sum(path.stat().st_size for path, _ in sources)
    except OSError as e:
        raise GalleryServerError(EXAMPLE_COPY_SENTENCE) from e
    try:
        notes_quota.assert_import_headroom(wanted)
    except notes_quota.NoteQuotaExceeded as e:
        raise GalleryError(str(e)) from e


def _stage_images(sources: list[tuple[Path, str]]) -> Path | None:
    """Copy every source into a fresh staging directory as `<n>.<ext>`. None when there is nothing to copy. On any
    failure the staging directory is removed and `GalleryServerError(EXAMPLE_COPY_SENTENCE)` raised."""
    if not sources:
        return None
    stage = _gallery_root() / f".stage-{uuid.uuid4().hex}"
    try:
        stage.mkdir(parents=True)
        for n, (path, ext) in enumerate(sources):
            _copy_image(path, stage / f"{n}{ext}")
    except Exception as e:  # noqa: BLE001 -- any failed copy is the one sentence, and nothing is left behind
        _remove_dir(stage)
        print(f"[template-gallery] example image copy failed: {type(e).__name__}")
        raise GalleryServerError(EXAMPLE_COPY_SENTENCE) from e
    return stage


class _DirMoves:
    """The directory renames made inside one write transaction: `undo()` reverses them (the transaction failed),
    `finish()` deletes what they set aside (it committed). Every rename goes through `_rename`."""

    def __init__(self, sentence: str):
        self._sentence = sentence
        self._done: list[tuple[Path, Path]] = []
        self._trash: list[Path] = []

    @property
    def active(self) -> bool:
        """True while a move has been made and neither undone nor finished."""
        return bool(self._done)

    def _move(self, src: Path, dst: Path) -> None:
        try:
            _rename(src, dst)
        except OSError as e:
            print(f"[template-gallery] example image move failed: {type(e).__name__}")
            raise GalleryServerError(self._sentence) from e
        self._done.append((src, dst))

    def _set_aside(self, path: Path) -> Path:
        trash = _gallery_root() / f".trash-{uuid.uuid4().hex}"
        self._move(path, trash)
        self._trash.append(trash)
        return trash

    def set_aside(self, path: Path) -> None:
        """Move `path` out of the way (deleted by `finish()`, put back by `undo()`); nothing when it is not there."""
        if path.exists():
            self._set_aside(path)

    def put(self, stage: Path | None, dest: Path) -> None:
        """Make `dest` hold exactly the staged copies (none when `stage` is None); its old copies are set aside."""
        if dest.exists():
            self._set_aside(dest)
        if stage is not None:
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
            except OSError as e:
                raise GalleryServerError(self._sentence) from e
            self._move(stage, dest)

    def promote(self, item_id: str, version: int) -> None:
        """Approval of a held revision: the item's directory becomes what `v<version>` held, and the old copies
        (with the rest of the old directory) are set aside."""
        base = _item_dir(item_id)
        if not base.exists():
            return
        trash = self._set_aside(base)
        held = trash / f"v{int(version)}"
        if held.is_dir():
            self._move(held, base)

    def undo(self) -> None:
        for src, dst in reversed(self._done):
            try:
                _rename(dst, src)
            except OSError as e:
                print(f"[template-gallery] example image move could not be undone: {type(e).__name__}")
        self._done.clear()
        self._trash.clear()

    def finish(self) -> None:
        for trash in self._trash:
            _remove_dir(trash)
        self._done.clear()
        self._trash.clear()


def example_image_path(viewer_id: str, item_id: Any, n: Any, *, is_admin: bool = False, rev: Any = None,
                       conn: sqlite3.Connection | None = None) -> Path | None:
    """The file `GET /{item_id}/images/{n}` serves, or None (the route's one 404).

    The item must be an example note the viewer may see -- approved and not hidden, or the viewer is its author or
    an admin (`_can_see`, the one visibility rule, which also hides it while the switch is off). `rev` "pending" asks
    for the HELD revision's copy: only the author or an admin, and only while a revision is held. Any other `rev`,
    or a number that is not a plain small integer, is None."""
    if rev not in (None, "", REV_PENDING):
        return None
    if not isinstance(item_id, str) or not item_id or not isinstance(n, str) or not _IMAGE_NUMBER.fullmatch(n):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute("SELECT id, user_id, item_type, kind, status, hidden, version, pending_json, payload_json"
                           " FROM j2_template_gallery WHERE id = ?", (item_id,)).fetchone()
        visible = row is not None and row["item_type"] == EXAMPLE_ITEM and _can_see(row, viewer_id, is_admin, conn)
    finally:
        if owned:
            conn.close()
    if not visible or not _ITEM_ID_SEGMENT.fullmatch(str(row["id"])):
        return None
    if rev == REV_PENDING:
        if not (is_admin or (viewer_id and row["user_id"] == viewer_id)) or not row["pending_json"]:
            return None
        folder = _item_dir(row["id"], int(row["version"] or 1) + 1)
    else:
        folder = _item_dir(row["id"])
    for ext in _COPY_EXTENSIONS:
        path = folder / f"{int(n)}{ext}"   # `n` is digits and `folder` an id-checked directory: nothing can climb
        if path.is_file():
            return path
    return None


def example_image_ids(conn: sqlite3.Connection, user_id: str) -> list[str]:
    """The ids of a member's example notes, for the account purge to remove their copy directories (read BEFORE the
    rows are deleted). Empty when the table does not exist yet."""
    try:
        return [r[0] for r in conn.execute("SELECT id FROM j2_template_gallery WHERE user_id = ? AND item_type = ?",
                                           (user_id, EXAMPLE_ITEM)).fetchall()]
    except sqlite3.OperationalError:
        return []


def remove_example_images(item_ids: Any) -> int:
    """Delete each item's copy directory (best-effort); returns how many there were."""
    return sum(1 for gid in item_ids or ()
               if isinstance(gid, str) and _ITEM_ID_SEGMENT.fullmatch(gid) and _remove_dir(_item_dir(gid)))


def publish_example(conn: sqlite3.Connection | None, user_id: str, note_id: Any, style_item_id: Any,
                    images_on: Any, title: Any) -> dict | None:
    """Submit (or resubmit) one of the member's own notes as an example of one of their shared styles.

    None when the switch is off or the note may not be an example (the route answers 404).
    `GalleryError` for a style that is not theirs to link (`EXAMPLE_STYLE_SENTENCE`), a note of another
    kind (`EXAMPLE_KIND_SENTENCE`), a note too long to be one (`EXAMPLE_TOO_LONG_SENTENCE`), or a bad title.
    `ValueError` for a caller's connection that already holds a transaction (review M-8): this function owns
    its transaction and must never roll back a caller's work.

    The server reads the note and reduces it ITSELF; nothing a client sends is a body. First publish: a
    PENDING `example_note` item. Again (same author, note and style) while pending or rejected: replaced in
    place, back to pending. Again while APPROVED: the new version is HELD in `pending_json` and the approved
    one stays listed, as a style's does (R-P3-3). That write is this function's own, not `_write_held_or_replaced`
    (P4b final m-3): its key is the note and the style together, and its id is assigned before the reduction.

    ⛔ P3b-T3-R1 (review I-1): the note is bounded before it is reduced (`_example_note`), and the reduction
    runs BEFORE `BEGIN IMMEDIATE`, against a fresh id. Only the lookup, the image rebinding and the write sit
    inside the write lock, so a publish never holds auth.db's lock for the length of a reduction."""
    if not example_enabled():
        return None
    if conn is not None and conn.in_transaction:
        raise ValueError("publish_example needs a connection with no open transaction")
    owned = conn is None
    conn = conn or get_connection()
    moves, stage = _DirMoves(EXAMPLE_COPY_SENTENCE), None
    try:
        note = _example_note(conn, user_id, note_id)
        if note is None:
            return None
        style = _linkable_style(conn, user_id, style_item_id)
        kind = _safe_listed(_listed_payload(style))["kindId"]
        if not note["kind"] or note["kind"] != kind:
            raise GalleryError(EXAMPLE_KIND_SENTENCE)
        brokers = _author_brokers(conn, user_id)
        clean_title = _example_title(title, brokers)
        draft_id = uuid.uuid4().hex                  # the new row's id, if the lookup below finds none
        body, kept = _reduce_example(note["body"], user_id=user_id, note_id=note["id"], images_on=images_on,
                                     brokers=brokers, item_id=draft_id, report=None)
        sources = _example_sources(kept, user_id, note["id"])   # R-P3b-7: at most 6, PNG/JPEG/WebP, 2 MB each
        stored = json.dumps({"bodyJson": body, "linkedItemId": style["id"], "noteKind": kind})
        if len(stored.encode("utf-8")) > MAX_BODY_BYTES:
            raise GalleryError(EXAMPLE_TOO_LONG_SENTENCE)
        preview = json.dumps(preview_lines(body))
        author_handle(user_id, conn)     # R-P3-2: a new or resubmitted item always has an author handle (commits)
        # P3b Task 4: the copies are made HERE, before the write lock, into a staging directory. A failed copy is
        # 500 `EXAMPLE_COPY_SENTENCE` with nothing left behind; under the lock the staged directory is renamed in.
        _assert_copy_headroom(sources)               # P3b-F-R7: room on the volume first, as an upload asks
        stage = _stage_images(sources)
        if not conn.in_transaction:                  # P3b-T3-R3 (M-8 refuses a caller's open transaction above)
            conn.execute("BEGIN IMMEDIATE")          # the lookup and the write cannot interleave with a twin
        # P3b-T3-R6: the style is linkable AGAIN, under the lock, just before the write -- one withdrawn, hidden
        # or rejected while the note was being reduced is the same sentence, and nothing is written.
        style = _linkable_style(conn, user_id, style["id"])
        # OI-P3b-5: and its kind is read AGAIN from that row -- a style resubmitted as another kind in the gap would
        # otherwise store the stale `noteKind`. A note no longer of the style's kind is the same sentence as above.
        kind = _safe_listed(_listed_payload(style))["kindId"]
        if note["kind"] != kind:
            raise GalleryError(EXAMPLE_KIND_SENTENCE)
        existing = conn.execute(
            "SELECT id, status, version FROM j2_template_gallery WHERE user_id = ? AND source_note_id = ?"
            " AND item_type = ?"
            " AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.linkedItemId') END = ?",
            (user_id, note["id"], EXAMPLE_ITEM, style["id"])).fetchone()
        gid = existing["id"] if existing else draft_id
        body = _bind_images(body, draft_id, gid)
        # P3b-R14: a held revision's copies go beside the listed ones, under the version members will see once it
        # is approved; anything else (a new row, a pending or rejected one replaced in place) owns the item's
        # directory. What was there before is set aside, and deleted only after the commit.
        held = bool(existing) and existing["status"] == "approved"
        moves.put(stage, _item_dir(gid, int(existing["version"] or 1) + 1 if held else None))
        payload = {"bodyJson": body, "linkedItemId": style["id"], "noteKind": kind}
        payload_json = json.dumps(payload)
        now = _now()
        if held:
            revision = {"title": clean_title, "description": "", "category": style["category"],
                        "tradingStyle": style["trading_style"], "payload": payload, "preview": json.loads(preview)}
            conn.execute(
                "UPDATE j2_template_gallery SET pending_json = ?, pending_at = ?, review_note = NULL,"
                " updated_at = ? WHERE id = ?", (json.dumps(revision), now, now, gid))
        elif existing:
            conn.execute(
                "UPDATE j2_template_gallery SET title = ?, description = '', category = ?, trading_style = ?,"
                " body_json = ?, payload_json = ?, status = 'pending', review_note = NULL, reviewed_by = NULL,"
                " reviewed_at = NULL, featured = 0, listed_at = NULL, updated_at = ?, preview_json = ?,"
                " pending_json = NULL, pending_at = NULL WHERE id = ?",
                (clean_title, style["category"], style["trading_style"], json.dumps(body), payload_json, now,
                 preview, gid))
        else:
            conn.execute(
                "INSERT INTO j2_template_gallery (id, user_id, source_note_id, kind, title, description,"
                " category, body_json, status, created_at, updated_at, preview_json, item_type,"
                " payload_json, version, trading_style)"
                " VALUES (?, ?, ?, 'member', ?, '', ?, ?, 'pending', ?, ?, ?, ?, ?, 1, ?)",
                (gid, user_id, note["id"], clean_title, style["category"], json.dumps(body), now, now,
                 preview, EXAMPLE_ITEM, payload_json, style["trading_style"]))
        conn.commit()
        moves.finish()                               # committed: the set-aside copies go, and nothing can undo it
        return _summary(_row(conn, gid, user_id), viewer_id=user_id, is_admin=False)
    except Exception:
        # ⛔ P3b-T4-R6(b): the directories are put back WHILE THE WRITE LOCK IS STILL HELD, and only then is the
        # transaction rolled back (which releases it). The other order lets a waiting publish take the lock and own
        # the destination before this undo renames it away (review I-1).
        # OI-P3b-12: an undo that raises must not skip the rollback, or the connection stays inside BEGIN IMMEDIATE.
        try:
            moves.undo()                             # the old copies back where they were (a no-op once finished)
            if stage is not None:
                _remove_dir(stage)                   # the staged copies, renamed back by undo (or never moved)
        finally:
            if conn.in_transaction:
                conn.rollback()                      # only ever this function's own transaction (M-8)
        raise
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
        row = _row(conn, gallery_id, user_id)
        # An example note is a snapshot of another member's note shown on their style, never a template to copy.
        # P4b-R-X8: nor is a layout. Copying one would write an empty note template under its title and count a
        # use; either reads exactly like an item `/use` cannot see.
        if not _can_see(row, user_id, False, conn) or row["item_type"] in (EXAMPLE_ITEM, LAYOUT_ITEM):
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
        _record_use(conn, row, user_id, now)
        conn.commit()
        result: dict[str, list[str]] = {"added": [], "existing": [], "skipped": []}
        for d in json.loads(row["property_defs_json"]) if row["property_defs_json"] else []:
            result[_ensure_property(user_id, d, conn)].append(d.get("name") or "")
        template = conn.execute("SELECT * FROM j2_note_templates WHERE id = ?", (new_id,)).fetchone()
        return {"template": nt._summary(template), "properties": result}
    finally:
        if owned:
            conn.close()


# ── adopting a community style, and the previewed update (P3a Task 5) ──────────────────────

ADOPT_NEEDS_STYLES_SENTENCE = "Journal styles are not on for you yet, so a style can't be adopted."
UPDATE_STALE_SENTENCE = "This style changed since you opened the update. Nothing was changed. Look again."
UPDATE_MOVED_SENTENCE = ("The author listed a newer version since you opened the update. Nothing was changed. "
                         "Look again.")


def _listed_row(conn: sqlite3.Connection, gallery_id: Any, item_type: str, *,
                hides: bool = True) -> sqlite3.Row | None:
    """The row of an item a member may adopt: one of `item_type`, approved and not hidden, and (with `hides`, the
    default) of a type that is not absent right now (`_library_hides`, the one rule). Shared by adopting a style
    and adopting a layout, so "listed" means one thing for both."""
    if not isinstance(gallery_id, str) or not gallery_id:
        return None
    row = _row(conn, gallery_id)             # no viewer: adopt and update read the item, not the member's vote
    if (row is None or (hides and _library_hides(row)) or row["item_type"] != item_type
            or row["status"] != "approved" or row["hidden"]):
        return None
    return row


def _listed_style_row(conn: sqlite3.Connection, gallery_id: Any) -> sqlite3.Row | None:
    """The row of a style a member may adopt: a style item that is approved and not hidden.

    ⛔ WITHOUT `_library_hides` (P4b final, merge): P5's starter-pack install reads its firm rows through this
    behind its OWN two switches, and the library switch has no effect on an install
    (tests/test_starter_packs.py::test_the_library_switch_has_no_effect_on_install). Every member-facing caller
    (`adopt_style`, `_plan`) applies `_library_hides` itself, as it did before P4b."""
    return _listed_row(conn, gallery_id, "style", hides=False)


def _record_use(conn: sqlite3.Connection, row: sqlite3.Row, user_id: str, now: str) -> None:
    """Count one member's use of an item, once ever (the primary key), and never the author's own. Uncommitted:
    the caller commits it with the rest of its transaction. ONE copy for use, adopt-a-style and adopt-a-layout."""
    if row["user_id"] != user_id:
        conn.execute("INSERT OR IGNORE INTO j2_template_gallery_uses (gallery_id, user_id, used_at)"
                     " VALUES (?, ?, ?)", (row["id"], user_id, now))


def _listed_payload(row: sqlite3.Row) -> dict | None:
    """The LISTED version's payload, or None when it cannot be read.

    ⛔ `payload_json`, NEVER `pending_json` (the Task 4 review's warning): an approved item's held
    revision is a version no reviewer has approved yet, and adopting or updating from it would hand a
    member unreviewed content. `version` and `payload_json` move together, in the one conditional UPDATE
    that approves a revision (`admin_act`)."""
    try:
        payload = json.loads(row["payload_json"] or "{}")
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


ADOPT_UNSUPPORTED_SENTENCE = "This style can't be adopted yet."


def _safe_listed(payload: Any) -> dict:
    """The listed payload in the shape the style layer expects, whatever is stored (review I1).

    ⛔ `publish_style` filters blocks to the ones this server can place, but a row written before that
    filter, or edited by hand, can hold anything, and `journal_styles._clean_blocks` keeps an UNKNOWN block id
    verbatim. So adopt, the block-id record, the plan and the apply all read the payload through this one
    function: `blocks` is a list of dicts naming a known block, `properties` a dict, `outlineBodyJson` a dict
    or None, `kindId` text or None. A truthy non-list `blocks` or a list `properties` can no longer reach an
    iteration."""
    from api.services.journal_two import journal_styles as js
    raw = payload if isinstance(payload, dict) else {}
    blocks = raw.get("blocks")
    props = raw.get("properties")
    outline = raw.get("outlineBodyJson")
    kind = raw.get("kindId")
    return {
        "kindId": kind if isinstance(kind, str) else None,
        "blocks": [b for b in (blocks if isinstance(blocks, list) else [])
                   if isinstance(b, dict) and isinstance(b.get("block"), str) and b["block"] in js.KNOWN_BLOCKS],
        "properties": dict(props) if isinstance(props, dict) else {},
        "outlineBodyJson": outline if isinstance(outline, dict) else None,
    }


def _block_ids(payload: Any) -> list[str]:
    return [b["block"] for b in _safe_listed(payload)["blocks"]]


def _outline_hash(outline: Any) -> str | None:
    """A stable fingerprint of an outline document, or None when there is none."""
    if not isinstance(outline, dict):
        return None
    return hashlib.sha256(json.dumps(outline, sort_keys=True).encode("utf-8")).hexdigest()


def _adopt_listed_row(conn: sqlite3.Connection, user_id: str, row: sqlite3.Row, *, notify: bool,
                      commit: bool) -> dict:
    """The body of an adopt, for a row `_listed_style_row` returned (rulings P5-R-C1 / P5-R-C2).

    ONE body, called by `adopt_style` (behind the library and Journal styles switches, `commit=True`) and by
    the starter-pack install (`starter_packs.install`, behind its own two switches, `commit=False`), so every
    rule an adopt obeys holds for both. With `commit=False` nothing here commits or rolls back: the caller
    owns the transaction (the install wraps each row in a SAVEPOINT and commits once). Raises `GalleryError`
    for a row that cannot be adopted: an unreadable payload, a kind that is not built in, or a style the
    member's account refuses (the style cap among them)."""
    from api.services.journal_two import journal_styles as js
    raw_payload = _listed_payload(row)
    if raw_payload is None:
        raise GalleryError("That style could not be read, so it cannot be adopted.")
    payload = _safe_listed(raw_payload)
    from api.services.journal_two import note_kinds as nk
    if payload["kindId"] not in nk.BUILTIN_KIND_IDS:
        # Only a built-in kind travels (R-P3-9). A stored row naming anything else would resolve against
        # the ADOPTER's own custom kinds, or fail with a message about a choice they never made.
        raise GalleryError(ADOPT_UNSUPPORTED_SENTENCE)
    version = int(row["version"] or 1)
    now = _now()
    # ⛔ ONE transaction (ruling P3a-FIN-R1): the copy is written WITH its provenance and left uncommitted,
    # so the use count and the watch below commit with it. A failure anywhere rolls the copy back too: a
    # copy with no `source_gallery_id` would read as the member's own work and could be shared under their
    # handle (R3/R5), and "Nothing was changed" would be false.
    try:
        style = js.create_style(user_id, {
            "name": (row["title"] or "Community style")[: js.MAX_STYLE_NAME_CHARS],
            "kindId": payload["kindId"], "blocks": payload["blocks"],
            "outlineBodyJson": payload["outlineBodyJson"],
            "properties": payload["properties"]}, conn,
            provenance=(row["id"], version, json.dumps(_block_ids(payload)),
                        _outline_hash(payload["outlineBodyJson"])),
            commit=False)
    except js.StyleValidationError as e:
        if commit and conn.in_transaction:
            conn.rollback()
        raise GalleryError(str(e)) from e
    _record_use(conn, row, user_id, now)   # the ONE use-count copy, for an adopt and a pack install alike (AUD-5)
    if notify:
        conn.execute(
            "INSERT INTO j2_gallery_watches (gallery_id, user_id, style_id, notified_version, created_at)"
            " VALUES (?, ?, ?, ?, ?) ON CONFLICT(gallery_id, user_id) DO UPDATE SET"
            " style_id = excluded.style_id, notified_version = excluded.notified_version",
            (row["id"], user_id, style["id"], version, now))
    if commit:
        conn.commit()
    return {"style": js.get_style(user_id, style["id"], conn),
            "notify": bool(notify),
            "credit": f"Based on {_author_label(row)}'s {row['title']}"}


def adopt_style(user_id: str, gallery_id: Any, *, notify: bool = False,
                conn: sqlite3.Connection | None = None) -> dict | None:
    """The member's own copy of a listed style (R-P3-10).

    A new `j2_journal_styles` row through `journal_styles.create_style` (so every rule a style obeys on
    save is applied to it), written WITH its `source_gallery_id`, `source_version`, `source_block_ids` and
    `source_outline_hash`, in the one transaction that also records the use and the watch. None when the library is off or the item is not a listed style; `GalleryConflict` when the member's
    Journal styles switch is off. A repeat adopt makes another copy (the member's choice) and never counts
    as a second use. `notify` records a watch row so a later task can tell them about an update.
    The body is `_adopt_listed_row`, shared with the starter-pack install (P5-R-C1)."""
    from api.services.journal_two import journal_styles as js
    if not library_enabled():
        return None
    if not js.enabled():
        raise GalleryConflict(ADOPT_NEEDS_STYLES_SENTENCE)
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _listed_style_row(conn, gallery_id)
        if row is None or _library_hides(row):         # a firm style while starter packs are off (P5-AUD-1)
            return None
        return _adopt_listed_row(conn, user_id, row, notify=notify, commit=True)
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


# ── adopting a shared page layout (P4b Task 5) ─────────────────────────────────────────────

LAYOUT_MOVED_SENTENCE = "The author listed a newer version since you opened it. Nothing was changed. Look again."
LAYOUT_UNSUPPORTED_SENTENCE = "This layout can't be used yet."


def adopt_layout(user_id: str, gallery_id: Any, *, version: Any,
                 conn: sqlite3.Connection | None = None) -> dict | None:
    """The LISTED layout of a shared page, for the member's own client to apply (R-P4b-8).

    None while layout sharing is off or when the item is not a listed `page_layout` (`_listed_row`: the one rule,
    approved, not hidden). `version` must be the whole number the member previewed and equal the listed version,
    else `GalleryConflict(LAYOUT_MOVED_SENTENCE)` and nothing is written. The stored payload is read through
    `usable_layout`, the one step the item read and the reviewer's held revision use too (P4b-T6-R1): a payload it
    cannot read, or one that keeps no panel in any list, is `GalleryError(LAYOUT_UNSUPPORTED_SENTENCE)`, and a list
    that keeps no panel is dropped from the answer.

    Otherwise the one write is the use record (`_record_use`: once per member, never the author), committed, and
    the answer is `{layout, version, credit}`. ⛔ It writes NO preference: the member's `journal_page_layout` is
    theirs, saved by their own client through the preference door, so withdrawing or hiding the item later
    changes nothing they adopted."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _listed_row(conn, gallery_id, LAYOUT_ITEM)
        if row is None:
            return None
        listed = int(row["version"] or 1)
        if isinstance(version, bool) or not isinstance(version, int) or version != listed:
            raise GalleryConflict(LAYOUT_MOVED_SENTENCE)
        # ⛔ `payload_json` through `_listed_payload` (never `pending_json`), then `usable_layout`: whatever is
        # stored leaves as registry ids in `{id, shown}` entries, so an unknown panel never reaches an adopter,
        # and a list registry drift has emptied is dropped (P4b-T5-R1) by the SAME step the item read uses
        # (P4b-T6-R1), so the preview is exactly what adopt applies. Nothing usable is the refusal.
        layout = pls.usable_layout(_listed_payload(row))
        if layout is None:
            raise GalleryError(LAYOUT_UNSUPPORTED_SENTENCE)
        _record_use(conn, row, user_id, _now())
        conn.commit()
        return {"layout": layout, "version": listed,
                "credit": f"Based on {_author_label(row)}'s {row['title']}"}
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def list_updates(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict]:
    """The member's adopted styles whose item is now listed at a higher version, newest first.

    Read from the COPY's own `source_version`, so a style adopted without "notify me" is here too: that
    choice is about being told, not about being offered."""
    if not library_enabled():
        return []
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT s.id AS style_id, s.name AS style_name, s.source_version, g.id AS gallery_id,"
            " g.title, g.version FROM j2_journal_styles s JOIN j2_template_gallery g"
            " ON g.id = s.source_gallery_id WHERE s.user_id = ? AND s.deleted_at IS NULL"
            " AND g.item_type = 'style' AND g.status = 'approved' AND g.hidden = 0"
            f" AND {_hidden_styles_sql()}"
            " AND g.version > COALESCE(s.source_version, 0) ORDER BY g.updated_at DESC",
            (user_id,)).fetchall()
        return [{"galleryId": r["gallery_id"], "title": r["title"], "styleId": r["style_id"],
                 "styleName": r["style_name"], "fromVersion": int(r["source_version"] or 0),
                 "toVersion": int(r["version"])} for r in rows]
    finally:
        if owned:
            conn.close()


def _plan(conn: sqlite3.Connection, user_id: str, style_id: Any):
    """(mine, row, plan); `plan` is None when there is nothing newer to offer, `mine` None when the style is
    not the member's own adopted copy.

    ⛔ "A removed block is never re-added" needs the block ids of the version the member ADOPTED: without
    them, a block they removed looks exactly like one they never had. They live on the copy
    (`source_block_ids`), not on `j2_gallery_watches`, because a member can adopt without notify."""
    from api.services.journal_two import journal_styles as js
    if not library_enabled():
        return None, None, None
    mine = js.get_style(user_id, style_id, conn, full=True)
    if mine is None or mine.get("builtin") or not mine.get("sourceGalleryId"):
        return None, None, None
    row = _listed_style_row(conn, mine["sourceGalleryId"])
    if row is not None and _library_hides(row):        # a firm style while starter packs are off (P5-AUD-1)
        row = None
    if row is None or int(row["version"] or 1) <= int(mine.get("sourceVersion") or 0):
        return mine, row, None
    raw_theirs = _listed_payload(row)
    if raw_theirs is None:
        return mine, row, None
    theirs = _safe_listed(raw_theirs)
    have = {b["block"] for b in mine.get("blocks") or [] if isinstance(b, dict) and "block" in b}
    src = conn.execute("SELECT source_block_ids, source_outline_hash FROM j2_journal_styles"
                       " WHERE id = ? AND user_id = ?", (style_id, user_id)).fetchone()
    try:
        adopted = set(json.loads((src and src["source_block_ids"]) or "[]"))
    except (TypeError, ValueError):
        adopted = set()
    add_blocks = [b for b in _block_ids(theirs) if b not in have and b not in adopted]
    mine_props = mine.get("properties") or {}
    add_props = [p for p in theirs["properties"] if p not in mine_props]
    # "The author's new outline" means the author changed it since this copy was made or last updated, so
    # it is compared with the fingerprint of the outline the copy CAME FROM, not with the member's current
    # text (their own edits are not the author's change). A copy made before `source_outline_hash` existed
    # has none, and falls back to the old reading: the listed outline against the copy's current one.
    # An author with no outline has nothing to take.
    their_hash = _outline_hash(theirs["outlineBodyJson"])
    if their_hash is None:
        outline_changed = False
    else:
        came_from = (src and src["source_outline_hash"]) or _outline_hash(mine.get("outlineBodyJson"))
        outline_changed = their_hash != came_from
    plan = {"galleryId": row["id"], "fromVersion": int(mine.get("sourceVersion") or 0),
            "toVersion": int(row["version"] or 1), "addBlocks": add_blocks, "addProperties": add_props,
            "outlineChanged": outline_changed,
            "newOutline": theirs["outlineBodyJson"] if outline_changed else None}
    return mine, row, plan


def plan_update(user_id: str, style_id: Any, conn: sqlite3.Connection | None = None) -> dict | None:
    """What "Update my copy" would do, as a preview that changes nothing. None when the style is not an
    adopted copy of the member's, or nothing newer is listed (the route answers 404)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        return _plan(conn, user_id, style_id)[2]
    finally:
        if owned:
            conn.close()


def apply_update(user_id: str, style_id: Any, *, take_outline: bool, base_updated_at: Any,
                 to_version: Any = None, conn: sqlite3.Connection | None = None) -> dict | None:
    """Apply the additive update (R-P3-8) and return the updated style, or None when there is no plan.

    ADDS the blocks and built-in property defaults the member does not have, and records the version they
    are now on. It never changes a block they already have, never changes a value they set, and never
    removes anything. The outline is replaced only when `take_outline` is true.

    `GalleryConflict` when the copy changed since `base_updated_at` (the version the member previewed). The
    comparison is made under the write lock (`BEGIN IMMEDIATE`), so a save that lands between the check
    and the write cannot be overwritten by an update planned against the older copy.

    `to_version` (P3a Task 10 fix round 1, M-8) is the listed version the member PREVIEWED. When it is given
    and another revision has been approved since, the merge would add blocks they never saw, so it is a
    `GalleryConflict` (UPDATE_MOVED_SENTENCE) and nothing is written."""
    from api.services.journal_two import journal_styles as js
    owned = conn is None
    conn = conn or get_connection()
    try:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        mine, row, plan = _plan(conn, user_id, style_id)
        if plan is None:
            conn.rollback()
            return None
        if to_version is not None and plan["toVersion"] != to_version:
            conn.rollback()
            raise GalleryConflict(UPDATE_MOVED_SENTENCE)
        if not isinstance(base_updated_at, str) or not base_updated_at or mine["updatedAt"] != base_updated_at:
            conn.rollback()
            raise GalleryConflict(UPDATE_STALE_SENTENCE)
        theirs = _safe_listed(_listed_payload(row))
        by_id = {b["block"]: b for b in theirs["blocks"]}
        patch: dict[str, Any] = {}
        if plan["addBlocks"]:
            patch["blocks"] = list(mine.get("blocks") or []) + [by_id[i] for i in plan["addBlocks"]]
        if plan["addProperties"]:
            patch["properties"] = {**(mine.get("properties") or {}),
                                   **{p: theirs["properties"][p] for p in plan["addProperties"]}}
        if take_outline and plan["outlineChanged"] and theirs["outlineBodyJson"]:
            # The author's outline replaces the member's, and a template link (which compose reads FIRST)
            # is let go so the outline they chose to take is the one that is used.
            patch["outlineBodyJson"] = theirs["outlineBodyJson"]
            patch["outlineTemplateId"] = None
        # ⛔ ONE transaction (ruling P3a-FIN-R1): the patch is left uncommitted (`commit=False`) so it and the
        # `source_*` record below commit together under the BEGIN IMMEDIATE above. Before this, update_style's
        # own commit ended the lock, and a failed second write left the blocks added while the member read
        # "Nothing was changed" and was offered the same update again. The watch moves too (ruling P3a-T5-R2,
        # "and on apply"): a member who applied this version is never rung about it later.
        try:
            if patch:
                js.update_style(user_id, style_id, patch, conn, commit=False)
        except js.StyleValidationError as e:
            conn.rollback()
            raise GalleryError(str(e)) from e
        conn.execute(
            "UPDATE j2_journal_styles SET source_version = ?, source_block_ids = ?, source_outline_hash = ?"
            " WHERE id = ? AND user_id = ?",
            (plan["toVersion"], json.dumps(_block_ids(theirs)), _outline_hash(theirs["outlineBodyJson"]),
             style_id, user_id))
        conn.execute(
            "UPDATE j2_gallery_watches SET notified_version = MAX(notified_version, ?)"
            " WHERE user_id = ? AND style_id = ?", (plan["toVersion"], user_id, style_id))
        conn.commit()
        return js.get_style(user_id, style_id, conn)
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def report(user_id: str, gallery_id: str, *, reason: Any, note: Any = "",
           conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Report a listed template. None when the member cannot see it. One report per
    member per template: a second one answers `already: true` and changes nothing.

    P3b-F-R2 (final review M-1): "cannot see it" is THE visibility rule, `_can_see` -- the same gate Helpful
    takes -- so an approved example whose style is pending, rejected or hidden is absent here too, never an
    accepted report that tells the reporter the example exists."""
    if reason not in REPORT_REASONS:
        raise GalleryError("Pick a reason for the report.")
    clean_note = _clean_text(note, field="note", limit=MAX_NOTE_CHARS, required=False)
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _row(conn, gallery_id, user_id)
        if not _can_see(row, user_id, False, conn) or row["status"] != "approved" or row["hidden"]:
            return None
        if row["user_id"] == user_id:
            noun = "layout" if row["item_type"] == LAYOUT_ITEM else "template"
            raise GalleryError(f"You can't report your own {noun}. Unpublish it instead.")
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


# ── Helpful, author pages, follows and the feed (P3a Task 6) ───────────────────────────────

_NEWEST_FIRST = " ORDER BY COALESCE(g.listed_at, g.created_at) DESC, g.rowid DESC LIMIT " + str(LIST_LIMIT)


def set_helpful(user_id: str, gallery_id: Any, on: bool,
                conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Mark a listed item helpful, or take the mark back. `{"helpful": bool, "count": int}`.

    None when the library is off, or the member may not vote on it: the item is not theirs to see, is not
    listed (pending, rejected, hidden), or is their OWN. One vote per member per item (the primary key), so
    marking it twice is the same as once, and unmarking what was never marked changes nothing."""
    if not library_enabled() or not isinstance(gallery_id, str) or not gallery_id:
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _row(conn, gallery_id, user_id)
        if (not _can_see(row, user_id, False, conn) or row["status"] != "approved" or row["hidden"]
                or row["user_id"] == user_id):
            return None
        if on:
            conn.execute("INSERT OR IGNORE INTO j2_gallery_helpful (item_id, user_id, created_at) VALUES (?, ?, ?)",
                         (gallery_id, user_id, _now()))
        else:
            conn.execute("DELETE FROM j2_gallery_helpful WHERE item_id = ? AND user_id = ?", (gallery_id, user_id))
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM j2_gallery_helpful WHERE item_id = ?", (gallery_id,)).fetchone()[0]
        return {"helpful": bool(on), "count": int(count)}
    finally:
        if owned:
            conn.close()


def _author_of(conn: sqlite3.Connection, handle: Any) -> str | None:
    """The author's `user_id` for a handle, or None for anything that is not one. The id is for the caller's
    next query and goes no further: it is never put in a response (R-P3-2)."""
    if not isinstance(handle, str) or not handle.strip() or len(handle) > MAX_HANDLE_CHARS:
        return None
    row = conn.execute("SELECT user_id FROM j2_gallery_authors WHERE handle = ?", (handle,)).fetchone()
    return row["user_id"] if row else None


def author_page(viewer_id: str, handle: Any, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """An author's page: who they are as the gallery already shows them, and what of theirs is listed.

    `{"author": {handle, label, itemCount, following, mine}, "items": [...]}`, or None when the library is off
    or the handle is not one. ⛔ R-P3-2: only approved, listed, non-hidden items, under the display name the
    gallery already shows (`_author_label`), and no user id or email anywhere in it. An author with nothing
    listed reads as `ANONYMOUS_AUTHOR`: there is no row to take their display name from."""
    if not library_enabled():
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        author_id = _author_of(conn, handle)
        if author_id is None:
            return None
        where = (f"{_VISIBLE} AND {_NEVER_LISTED} AND {_hidden_styles_sql()} AND {_type_visible_clause()}"
                 " AND g.user_id = ?")
        rows = _read(conn, viewer_id, where, (author_id,), list_only=True, tail=_NEWEST_FIRST).fetchall()
        count = conn.execute(f"SELECT COUNT(*) FROM j2_template_gallery g WHERE {where}", (author_id,)).fetchone()[0]
        following = conn.execute("SELECT 1 FROM j2_gallery_follows WHERE follower_id = ? AND author_id = ?",
                                 (viewer_id, author_id)).fetchone() is not None
        return {
            "author": {"handle": handle, "label": _author_label(rows[0]) if rows else ANONYMOUS_AUTHOR,
                       "itemCount": int(count), "following": following,
                       "mine": bool(viewer_id) and viewer_id == author_id},
            "items": [_summary(r, viewer_id=viewer_id, is_admin=False) for r in rows],
        }
    finally:
        if owned:
            conn.close()


def set_follow(viewer_id: str, handle: Any, on: bool,
               conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Follow an author by their handle, or stop. `{"following": bool}`; None when the library is off, the
    handle is not one, or it is the viewer's own (nobody follows themselves)."""
    if not library_enabled():
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        author_id = _author_of(conn, handle)
        if author_id is None or author_id == viewer_id:
            return None
        if on:
            conn.execute("INSERT OR IGNORE INTO j2_gallery_follows (follower_id, author_id, created_at)"
                         " VALUES (?, ?, ?)", (viewer_id, author_id, _now()))
        else:
            conn.execute("DELETE FROM j2_gallery_follows WHERE follower_id = ? AND author_id = ?",
                         (viewer_id, author_id))
        conn.commit()
        return {"following": bool(on)}
    finally:
        if owned:
            conn.close()


def feed(viewer_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """What the authors the viewer follows have listed, newest first (`LIST_LIMIT`). Empty while the library
    is off. The same listed rule as every other read: approved and not hidden."""
    if not library_enabled():
        return []
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = _read(conn, viewer_id,
                     f"{_VISIBLE} AND {_NEVER_LISTED} AND {_hidden_styles_sql()} AND {_type_visible_clause()}"
                     " AND g.user_id IN (SELECT author_id FROM j2_gallery_follows WHERE follower_id = ?)",
                     (viewer_id,), list_only=True, tail=_NEWEST_FIRST)
        return [_summary(r, viewer_id=viewer_id, is_admin=False) for r in rows]
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
        # R-T3-R2: with the library off the queue is today's -- outline rows only. A style row (and its
        # held revision) is reviewable only while the library is on, and a firm style row only while the
        # starter-packs switch is on too (P5-AUD-1): `_hidden_styles_sql`, the one rule.
        # P3b: an example note is reviewable only while ITS switch is on, the same rule one level down.
        # P4b (R-P4b-10): a layout row only while layout sharing is on: `_type_visible_clause`, the type rule.
        visible_terms = f" AND {_hidden_styles_sql()} AND {_type_visible_clause()}"
        if not example_enabled():
            visible_terms += f" AND {_NEVER_LISTED}"

        def rows(where: str, order: str, queue: bool = False) -> list[dict]:
            # A reviewer's queue is nobody's vote: no viewer is bound (`_read` binds "").
            return [_summary(r, viewer_id=None, is_admin=True)
                    for r in _read(conn, None, f"({where}){visible_terms}", (), list_only=True, queue=queue,
                                   tail=f" ORDER BY {order} LIMIT {LIST_LIMIT}")]

        # The pending rows add the held revision's title (`_select(queue=True)`): still narrow columns, never
        # the body (R-T4-1; the M-6 rail traces this).
        pending = rows("g.status = 'pending' OR g.pending_at IS NOT NULL", "g.updated_at ASC", queue=True)
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
    version is refused the same way -- nothing may be listed unseen.

    ⛔ A REJECTION NAMES IT TOO (P3b-F-R4, final review M-3), for a style and an example alike: the same
    `reviewed_updated_at`, the same conditional UPDATE. Unpinned, an author re-publishing while the reviewer
    read would have the NEW revision declined -- its copies set aside -- and a note about a version nobody saw."""
    if action not in ADMIN_ACTIONS:
        raise GalleryError("Unknown review action.")
    clean_note = _clean_text(note, field="note", limit=MAX_NOTE_CHARS, required=False)
    owned = conn is None
    conn = conn or get_connection()
    # P3b Task 4 (ruling P3b-R14): approving an example's held revision moves its copies into place inside the same
    # transaction; a failure to move them undoes the move AND the listing (`EXAMPLE_MOVE_SENTENCE`, nothing listed).
    moves = _DirMoves(EXAMPLE_MOVE_SENTENCE)
    try:
        row = conn.execute("SELECT * FROM j2_template_gallery WHERE id = ?", (gallery_id,)).fetchone()
        # R-T4-3 (R-P3-10): a style row is absent while the library is off, for a reviewer who knows its id
        # as much as for a member. The queue and `get_item` already hide it; this is the write door.
        if row is None or _library_hides(row):
            return None
        is_example = row["item_type"] == EXAMPLE_ITEM
        held_version = int(row["version"] or 1) + 1     # the version a held revision becomes, and its copies' folder
        now = _now()
        stale = LAYOUT_APPROVE_STALE_SENTENCE if row["item_type"] == LAYOUT_ITEM else APPROVE_STALE_SENTENCE
        if action == "approve":
            if not isinstance(reviewed_updated_at, str) or not reviewed_updated_at:
                raise GalleryConflict(stale)
            if row["pending_json"]:
                # An approved style's HELD revision (R-P3-3): swap it in, in the same conditional
                # statement as a first approval, and bump the version members see.
                try:
                    rev = json.loads(row["pending_json"])
                    if row["item_type"] == LAYOUT_ITEM:
                        # P4b (R-P4b-6a): a held layout revision passes the write door before it is listed. Its
                        # refusal is a LayoutPayloadError, a ValueError, so it lands on the sentence below.
                        pls.validate_layout_payload(rev["payload"])
                    # A style's listed body is its outline; an example note's is its reduced snapshot (P3b).
                    body_key = "bodyJson" if row["item_type"] == EXAMPLE_ITEM else "outlineBodyJson"
                    new_body = rev["payload"].get(body_key) or {"type": "doc", "content": []}
                    args = (rev["title"], rev["description"], rev["category"], rev.get("tradingStyle"),
                            json.dumps(rev["payload"]), json.dumps(new_body),
                            json.dumps(rev.get("preview") or preview_lines(new_body)),
                            admin_id, now, now, gallery_id, reviewed_updated_at)
                except (TypeError, ValueError, KeyError, AttributeError):
                    raise GalleryConflict("That revision could not be read, so nothing was listed. "
                                          "Ask the author to submit it again.")
                cur = conn.execute(
                    "UPDATE j2_template_gallery SET title = ?, description = ?, category = ?, trading_style = ?,"
                    " payload_json = ?, body_json = ?, preview_json = ?, version = version + 1,"
                    " pending_json = NULL, pending_at = NULL, review_note = NULL, reviewed_by = ?,"
                    " reviewed_at = ?, updated_at = ? WHERE id = ? AND updated_at = ?", args)
            else:
                cur = conn.execute(
                    "UPDATE j2_template_gallery SET status = 'approved', review_note = NULL, reviewed_by = ?,"
                    " reviewed_at = ?, listed_at = COALESCE(listed_at, ?), updated_at = ?"
                    " WHERE id = ? AND updated_at = ?",
                    (admin_id, now, now, now, gallery_id, reviewed_updated_at))
            if cur.rowcount != 1:
                conn.rollback()
                raise GalleryConflict(stale)
            if row["pending_json"] and is_example:
                moves.promote(gallery_id, held_version)  # the held copies become the listed ones; the old set aside
        elif action == "reject":
            if not clean_note:
                raise GalleryError("Say why, so the author can fix it.")
            if not isinstance(reviewed_updated_at, str) or not reviewed_updated_at:
                raise GalleryConflict(REJECT_STALE_SENTENCE)
            if row["pending_json"]:
                # A held revision is declined; the APPROVED listing stays exactly as it was (status,
                # listed_at, featured). The author reads the note; the revision is cleared.
                cur = conn.execute(
                    "UPDATE j2_template_gallery SET pending_json = NULL, pending_at = NULL, review_note = ?,"
                    " reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
                    (clean_note, admin_id, now, now, gallery_id, reviewed_updated_at))
            else:
                cur = conn.execute(
                    "UPDATE j2_template_gallery SET status = 'rejected', review_note = ?, reviewed_by = ?,"
                    " reviewed_at = ?, featured = 0, listed_at = NULL, updated_at = ? WHERE id = ? AND updated_at = ?",
                    (clean_note, admin_id, now, now, gallery_id, reviewed_updated_at))
            if cur.rowcount != 1:
                conn.rollback()
                raise GalleryConflict(REJECT_STALE_SENTENCE)
            if is_example:
                # P3b-R14 + P3b-T4-R6(a): the declined copies are moved aside UNDER THE LOCK, before the commit,
                # and deleted after it (`moves.finish()` below). Deleting after the commit could hit copies a
                # republish wrote the moment the lock was released (review I-1). A held revision's are its
                # `v<N>` folder; a first submission's (P3b-F-R6, final review M-5) are the item's whole folder --
                # an example declined for what an image shows must not keep that image on the volume. The
                # author's next publish writes a fresh set.
                moves.set_aside(_item_dir(gallery_id, held_version) if row["pending_json"] else _item_dir(gallery_id))
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
        moves.finish()                                  # committed: the old copies go, and nothing can undo it
        # P3a Task 7: AFTER the review has committed, so a notice can never undo it. An approved revision
        # bumps the version, so its watchers are behind; any later review action retries a failed delivery.
        if action in _RING_ACTIONS and row["item_type"] == "style":
            try:
                _ring_update_watchers(conn, gallery_id)
            except Exception as e:  # noqa: BLE001 -- the review has committed; a notice never fails it (review I1)
                conn.rollback()      # only the current watcher's uncommitted mark; earlier ones are committed
                print(f"[template-gallery] update notices for {gallery_id} stopped: {type(e).__name__}: {e}")
        return _summary(_row(conn, gallery_id, admin_id), viewer_id=admin_id, is_admin=True)
    except Exception as e:
        # Only a failure that touched the copies rolls back here (the listing must not stand without them); every
        # other refusal keeps today's behaviour, so a caller's own transaction is never rolled back for a 400.
        if isinstance(e, GalleryServerError) or moves.active:
            try:
                moves.undo()                            # P3b-T4-R6(b): under the lock, BEFORE the rollback releases it
            finally:
                if conn.in_transaction:
                    conn.rollback()                     # OI-P3b-12: even when the undo itself raises
        raise
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
        target = conn.execute("SELECT item_type, kind FROM j2_template_gallery WHERE id = ?",
                              (r["gallery_id"],)).fetchone()
        if target is not None and _library_hides(target):      # R-T4-3: a style's report is as absent as the style
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
