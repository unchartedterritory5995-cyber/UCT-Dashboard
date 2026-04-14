"""
Theme taxonomy DB — SQLite tables for themes, sectors, and stock memberships.
Seeded from themes_taxonomy.json on startup.
"""

import json
import os
import logging
from api.services.auth_db import get_connection

_logger = logging.getLogger(__name__)

# Look for taxonomy JSON in multiple locations
_TAXONOMY_PATHS = [
    os.path.join(os.path.dirname(__file__), "..", "..", "themes_taxonomy.json"),  # repo root
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "morning-wire", "themes_taxonomy.json"),
    "/app/themes_taxonomy.json",  # Railway
]


def _find_taxonomy_file():
    for p in _TAXONOMY_PATHS:
        resolved = os.path.abspath(p)
        if os.path.exists(resolved):
            return resolved
    return None


def init_theme_tables():
    """Create theme tables if they don't exist."""
    conn = get_connection()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS theme_sectors (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                display_order INTEGER DEFAULT 0,
                updated_at   TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS themes (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                sector_id     TEXT NOT NULL REFERENCES theme_sectors(id),
                etf_ticker    TEXT,
                etf_name      TEXT,
                display_order INTEGER DEFAULT 0,
                sub_themes    TEXT,
                updated_at    TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS theme_memberships (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                theme_id      TEXT NOT NULL REFERENCES themes(id),
                sym           TEXT NOT NULL,
                tier          TEXT NOT NULL DEFAULT 'relevant',
                sub_theme_id  TEXT,
                rationale     TEXT,
                updated_at    TEXT DEFAULT (datetime('now')),
                UNIQUE(theme_id, sym)
            );

            CREATE INDEX IF NOT EXISTS idx_tm_theme ON theme_memberships(theme_id);
            CREATE INDEX IF NOT EXISTS idx_tm_sym ON theme_memberships(sym);
        """)
        conn.commit()
    finally:
        conn.close()


def seed_from_json():
    """Seed the DB from themes_taxonomy.json. Idempotent — clears and re-inserts."""
    path = _find_taxonomy_file()
    if not path:
        _logger.warning("[themes] No themes_taxonomy.json found — skipping seed")
        return False

    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    version = data.get("version", "0.0.0")
    conn = get_connection()
    try:
        # Check if already seeded with this version
        existing = conn.execute(
            "SELECT pref_value FROM user_preferences WHERE user_id = 'system' AND pref_key = 'theme_seed_version'"
        ).fetchone()
        if existing and existing["pref_value"] == version:
            _logger.info("[themes] Already seeded v%s — skipping", version)
            return True

        # Clear and re-seed
        conn.execute("DELETE FROM theme_memberships")
        conn.execute("DELETE FROM themes")
        conn.execute("DELETE FROM theme_sectors")

        # Insert sectors
        for s in data.get("sectors", []):
            conn.execute(
                "INSERT INTO theme_sectors (id, name, display_order) VALUES (?, ?, ?)",
                (s["id"], s["name"], s.get("display_order", 0)),
            )

        # Insert themes + memberships
        for t in data.get("themes", []):
            conn.execute(
                "INSERT INTO themes (id, name, sector_id, etf_ticker, etf_name, display_order, sub_themes) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (t["id"], t["name"], t["sector_id"], t.get("etf_ticker"),
                 t.get("etf_name"), t.get("display_order", 0),
                 json.dumps(t.get("sub_themes", []))),
            )
            for h in t.get("holdings", []):
                conn.execute(
                    "INSERT OR IGNORE INTO theme_memberships (theme_id, sym, tier, sub_theme_id, rationale) VALUES (?, ?, ?, ?, ?)",
                    (t["id"], h["sym"], h.get("tier", "relevant"),
                     h.get("sub_theme_id"), h.get("rationale", "")),
                )

        # Record seed version
        conn.execute(
            "INSERT OR REPLACE INTO user_preferences (id, user_id, pref_key, pref_value) VALUES ('theme_seed', 'system', 'theme_seed_version', ?)",
            (version,),
        )
        conn.commit()

        theme_count = conn.execute("SELECT COUNT(*) FROM themes").fetchone()[0]
        membership_count = conn.execute("SELECT COUNT(*) FROM theme_memberships").fetchone()[0]
        _logger.info("[themes] Seeded v%s — %d themes, %d memberships", version, theme_count, membership_count)
        return True
    finally:
        conn.close()


def get_all_themes():
    """Return all themes with their holdings grouped by sector."""
    conn = get_connection()
    try:
        sectors = [dict(r) for r in conn.execute("SELECT * FROM theme_sectors ORDER BY display_order").fetchall()]
        themes = [dict(r) for r in conn.execute("SELECT * FROM themes ORDER BY display_order").fetchall()]
        memberships = [dict(r) for r in conn.execute("SELECT * FROM theme_memberships").fetchall()]

        # Group memberships by theme_id
        by_theme = {}
        for m in memberships:
            by_theme.setdefault(m["theme_id"], []).append(m)

        # Attach holdings to themes
        for t in themes:
            t["holdings"] = by_theme.get(t["id"], [])
            t["sub_themes"] = json.loads(t["sub_themes"]) if t.get("sub_themes") else []

        return {"sectors": sectors, "themes": themes}
    finally:
        conn.close()


def get_themes_for_ticker(sym):
    """Return all themes a ticker belongs to."""
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT tm.*, t.name as theme_name, t.sector_id, ts.name as sector_name
            FROM theme_memberships tm
            JOIN themes t ON tm.theme_id = t.id
            JOIN theme_sectors ts ON t.sector_id = ts.id
            WHERE tm.sym = ?
        """, (sym.upper(),)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_theme_holdings(theme_id, tier_filter=None):
    """Return holdings for a theme, optionally filtered by tier."""
    conn = get_connection()
    try:
        q = "SELECT * FROM theme_memberships WHERE theme_id = ?"
        params = [theme_id]
        if tier_filter:
            placeholders = ",".join("?" * len(tier_filter))
            q += f" AND tier IN ({placeholders})"
            params.extend(tier_filter)
        return [dict(r) for r in conn.execute(q, params).fetchall()]
    finally:
        conn.close()
