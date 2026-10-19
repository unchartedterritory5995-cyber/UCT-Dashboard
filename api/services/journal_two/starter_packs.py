"""Starter packs (Notebook P5): "How do you trade?" installs three firm styles in one go.

A pack is the firm style rows Task 3 seeds (`template_gallery.seed_firm_styles`: `kind = 'firm'`,
`item_type = 'style'`, `trading_style` = the pack), installed by SERVICE, never by asking the gallery
(R-P5-2). Each row goes through P3a's one adopt body, `template_gallery._adopt_listed_row` (ruling P5-R-C1),
so a copy carries `source_gallery_id` / `source_version` and obeys every rule an adopt obeys. Route:
`POST /api/j2/journal-styles/starter-packs/{pack}` (api/routers/notebook_journal_styles.py).

  * THE SWITCHES: `NOTEBOOK_STARTER_PACKS_ENABLED` and `NOTEBOOK_JOURNAL_STYLES_ENABLED`, and NOT the library
    switch (R-P5-2: firm picks are the team's, so they do not wait on the community library).
    `enabled()` is the starter switch alone, because it is the server's half of the payload key
    `notebook_starter_packs_enabled` (tests/test_notebook_flag_parse.py compares the two); the Journal
    styles half is the router's own gate, and `install` asks both. The install never needs the rows
    LISTED; in the gallery itself a firm style row is listed only while this switch AND the library
    switch are on (P5-AUD-1, `template_gallery._hidden_styles`), so `enabled()` going false hides them too.
  * ONE TRANSACTION (ruling P5-R-C2): a SAVEPOINT per row and one commit. A row whose adopt raises a
    `GalleryError` (a kind a later release removed, the member's style cap) is rolled back to its savepoint
    and named in `skipped` with that error's sentence as its `reason` (ruling P5-R-T4-5: the offer says why);
    the rows before and after it stay. Anything else rolls the whole pack back.
  * IDEMPOTENT: a row the member already has a live copy of (`source_gallery_id` match) is named in
    `alreadyHad`, never copied twice. A copy the member deleted is not "had": installing again brings it back.
  * SEED ORDER is rowid order, which is the seed file's order (ruling P5-R-T3-6: every firm row shares one
    `listed_at`). A hidden row (an admin hide, or a retired `-v1`, R-P5-4) is not part of its pack.
  * Notify is off: no watch row is written.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_STARTER_PACKS_ENABLED"

#: ⛔ ONE FACT IN TWO FILES with `PACKS` in app/src/pages/journal-2-0/lib/starterPacks.js (an array of
#: `{key, label}`). tests/test_starter_packs.py parses the client's keys and holds them equal to these, and
#: holds these equal to the seed file's packs in order.
PACKS = ("swing", "day", "prop", "options", "earnings")


def enabled() -> bool:
    """The starter-packs switch, read PER CALL through the one Notebook flag parse (default OFF)."""
    return flag_on(FLAG, False)


def _pack_ids(conn: sqlite3.Connection, pack: str) -> list[str]:
    return [r[0] for r in conn.execute(
        "SELECT id FROM j2_template_gallery WHERE kind = 'firm' AND item_type = 'style' AND trading_style = ?"
        " ORDER BY rowid", (pack,)).fetchall()]


def _already_has(conn: sqlite3.Connection, user_id: str, gallery_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM j2_journal_styles WHERE user_id = ? AND source_gallery_id = ? AND deleted_at IS NULL"
        " LIMIT 1", (user_id, gallery_id)).fetchone() is not None


def install(conn: sqlite3.Connection | None, user_id: str, pack: str) -> dict[str, Any] | None:
    """`{"installed": [{"styleId", "title"}], "alreadyHad": [title], "skipped": [{"title", "reason"}]}`, each list in seed
    order, or None when the pack is unknown or either switch is off (the route answers its one 404).

    `conn` may be None (the route), and then this opens and closes its own connection. A connection
    already inside a transaction keeps it: the rows are written inside it and the one commit commits it."""
    from api.services.journal_two import journal_styles as js
    from api.services.journal_two import template_gallery as gallery
    if pack not in PACKS or not enabled() or not js.enabled():
        return None
    owned = conn is None
    conn = conn or get_connection()
    out: dict[str, Any] = {"installed": [], "alreadyHad": [], "skipped": []}
    try:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        for gid in _pack_ids(conn, pack):
            row = gallery._listed_style_row(conn, gid)       # approved and not hidden, the adopt rule
            if row is None:
                continue
            title = row["title"]
            if _already_has(conn, user_id, gid):
                out["alreadyHad"].append(title)
                continue
            conn.execute("SAVEPOINT starter_pack_row")
            try:
                done = gallery._adopt_listed_row(conn, user_id, row, notify=False, commit=False)
            except gallery.GalleryError as e:
                conn.execute("ROLLBACK TO starter_pack_row")
                conn.execute("RELEASE starter_pack_row")
                out["skipped"].append({"title": title, "reason": str(e)})
                continue
            conn.execute("RELEASE starter_pack_row")
            out["installed"].append({"styleId": done["style"]["id"], "title": title})
        conn.commit()
        return out
    except Exception:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
