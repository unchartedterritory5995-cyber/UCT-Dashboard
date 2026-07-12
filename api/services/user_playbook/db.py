"""
My Playbook — SQLite schema + migrations.

All tables use the `upb_` prefix (user playbook — the member-built mirror
of Model Book). Invoked additively from api.services.auth_db.init_db()
immediately after the j2 hook, so no other auth.db tables are touched.

Cascades are DECLARED inside the upb_ family only (PRAGMA foreign_keys=ON
is already set on every auth.db connection). upb_note_links.note_id is a
SOFT reference into j2_notes — deliberately NO foreign key, because a
Notebook delete doesn't know about playbook links; dead links surface as
`live: false` tombstone chips via the LEFT JOIN in the service layer.

Spec: docs/superpowers/specs/2026-07-12-my-playbook-builder-design.md
"""

import sqlite3


_UPB_SCHEMA = """
CREATE TABLE IF NOT EXISTS upb_sections (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    blurb       TEXT NOT NULL DEFAULT '',
    accent      TEXT NOT NULL DEFAULT 'gold',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER,
    updated_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_upb_sections_user
    ON upb_sections(user_id);

CREATE TABLE IF NOT EXISTS upb_entries (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    section_id  TEXT NOT NULL REFERENCES upb_sections(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    body_json   TEXT NOT NULL DEFAULT '',
    body_plain  TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER,
    updated_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_upb_entries_user_section
    ON upb_entries(user_id, section_id);

CREATE TABLE IF NOT EXISTS upb_charts (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL,
    entry_id              TEXT NOT NULL REFERENCES upb_entries(id) ON DELETE CASCADE,
    symbol                TEXT NOT NULL,
    timeframe             TEXT NOT NULL DEFAULT 'D',
    year                  INTEGER,
    label_date            TEXT,
    frame_start_date      TEXT,
    result_start_date     TEXT,
    result_end_date       TEXT,
    entry_price           REAL,
    stop_price            REAL,
    target_price          REAL,
    grade                 TEXT,
    notes                 TEXT,
    scale_mode            TEXT NOT NULL DEFAULT 'arith',
    drawings_json         TEXT,
    result_drawings_json  TEXT,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            INTEGER,
    updated_at            INTEGER
);

CREATE INDEX IF NOT EXISTS idx_upb_charts_user_entry
    ON upb_charts(user_id, entry_id);

CREATE TABLE IF NOT EXISTS upb_note_links (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    entry_id        TEXT NOT NULL REFERENCES upb_entries(id) ON DELETE CASCADE,
    note_id         TEXT NOT NULL,
    title_snapshot  TEXT NOT NULL DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER,
    UNIQUE(entry_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_upb_note_links_user_entry
    ON upb_note_links(user_id, entry_id);
"""


# Future column additions go here (e.g. v2 sharing = share token/slug
# columns) — applied idempotently by ensure_schema, mirroring the
# _PHASE_2_ALTERS pattern in journal_two/db.py.
_UPB_ALTERS: list[str] = []


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Create My Playbook tables if missing. Safe to call repeatedly.
    Never touches any non-upb_ table."""
    conn.executescript(_UPB_SCHEMA)

    # ALTER additions: idempotent via try/except since SQLite doesn't
    # have IF NOT EXISTS for ADD COLUMN.
    for stmt in _UPB_ALTERS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError as e:
            # Already exists (duplicate column / index) — ignore.
            msg = str(e).lower()
            if "duplicate column" not in msg and "already exists" not in msg:
                raise
    conn.commit()
