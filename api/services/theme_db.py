"""
Theme taxonomy DB — SQLite tables for themes, sectors, and stock memberships.
Seeded from themes_taxonomy.json on startup.
"""

import hashlib
import json
import os
import logging
import sqlite3
from api.services.auth_db import get_connection

_logger = logging.getLogger(__name__)


def _to_dot(s):
    """Normalize ticker input to taxonomy dot-form (BRK-B -> BRK.B)."""
    return (s or "").strip().upper().replace("-", ".")


# Merged owner+engine membership read — ONE statement, used by all three readers.
# Owner rows always win (NOT EXISTS); engine rows merge only when action='add'
# and their theme still exists (dangling overlay rows are filtered, not served).
_MERGED_MEMBERSHIP_SQL = """
SELECT tm.theme_id, tm.sym, tm.tier, tm.sub_theme_id, tm.rationale, 'owner' AS source
  FROM theme_memberships tm
UNION ALL
SELECT em.theme_id, em.sym, em.tier, em.sub_theme_id, em.rationale, 'engine' AS source
  FROM engine_memberships em
 WHERE em.action = 'add'
   AND em.theme_id IN (SELECT id FROM themes)
   AND NOT EXISTS (SELECT 1 FROM theme_memberships t2
                   WHERE t2.theme_id = em.theme_id AND t2.sym = em.sym)
"""

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
    # Content-hash fallback gate: an edited taxonomy whose version was NOT
    # bumped must still reseed. Skip only when BOTH version and hash match.
    content_hash = hashlib.sha256(json.dumps(
        {"sectors": data.get("sectors", []), "themes": data.get("themes", [])},
        sort_keys=True).encode()).hexdigest()
    conn = get_connection()
    try:
        # Check if already seeded with this version AND this exact content
        stored = {r["pref_key"]: r["pref_value"] for r in conn.execute(
            "SELECT pref_key, pref_value FROM user_preferences WHERE user_id = 'system' "
            "AND pref_key IN ('theme_seed_version', 'theme_seed_content_hash')"
        ).fetchall()}
        if (stored.get("theme_seed_version") == version
                and stored.get("theme_seed_content_hash") == content_hash):
            _logger.info("[themes] Already seeded v%s (content match) — skipping", version)
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

        # Overlay GC — same transaction as the reseed so the merged view can
        # never serve a window where owner rows changed but stale engine rows
        # survived. Guarded: pre-migration DBs have no engine_memberships yet.
        try:
            gc_orphans = conn.execute(
                "DELETE FROM engine_memberships WHERE theme_id NOT IN (SELECT id FROM themes)").rowcount
            gc_dups = conn.execute(
                "DELETE FROM engine_memberships WHERE action='add' AND EXISTS ("
                " SELECT 1 FROM theme_memberships t2 WHERE t2.theme_id = engine_memberships.theme_id"
                " AND t2.sym = engine_memberships.sym)").rowcount
            gc_accepted = conn.execute(
                "DELETE FROM engine_memberships WHERE action='suppress_proposal' AND status='accepted'").rowcount
            _logger.info("[themes] overlay GC: %d orphaned, %d owner-dup, %d accepted-suppress",
                         gc_orphans, gc_dups, gc_accepted)
        except sqlite3.OperationalError as e:
            _logger.info("[themes] overlay GC skipped (engine tables absent): %s", e)

        # Record seed version + content hash
        conn.execute(
            "INSERT OR REPLACE INTO user_preferences (id, user_id, pref_key, pref_value) VALUES ('theme_seed', 'system', 'theme_seed_version', ?)",
            (version,),
        )
        conn.execute(
            "INSERT OR REPLACE INTO user_preferences (id, user_id, pref_key, pref_value) VALUES ('theme_seed_hash', 'system', 'theme_seed_content_hash', ?)",
            (content_hash,),
        )
        conn.commit()

        theme_count = conn.execute("SELECT COUNT(*) FROM themes").fetchone()[0]
        membership_count = conn.execute("SELECT COUNT(*) FROM theme_memberships").fetchone()[0]
        _logger.info("[themes] Seeded v%s — %d themes, %d memberships", version, theme_count, membership_count)
        invalidate_caches()
        return True
    finally:
        conn.close()


def invalidate_caches():
    """Notify dependents that theme membership changed. Lazy + guarded:
    groups.invalidate_sizes() lands in a later task — its absence (or any
    failure) must never break a reseed."""
    try:
        from api.services import groups
        groups.invalidate_sizes()
    except Exception:
        pass


def seed_from_json_safe() -> bool:
    """Boot-safe wrapper: never raises. A malformed taxonomy leaves the theme
    tables as-is (possibly empty) and logs, instead of crashing app startup."""
    try:
        return seed_from_json()
    except Exception as e:
        _logger.error("[themes] seed_from_json failed — themes not reseeded: %s",
                      e, exc_info=True)
        return False


def get_all_themes():
    """Return all themes with their holdings grouped by sector."""
    conn = get_connection()
    try:
        sectors = [dict(r) for r in conn.execute("SELECT * FROM theme_sectors ORDER BY display_order").fetchall()]
        themes = [dict(r) for r in conn.execute("SELECT * FROM themes ORDER BY display_order").fetchall()]
        try:
            memberships = [dict(r) for r in conn.execute(_MERGED_MEMBERSHIP_SQL).fetchall()]
        except sqlite3.OperationalError:
            # Pre-migration DB (no engine_memberships) — owner-only still serves
            memberships = [dict(r) for r in conn.execute(
                "SELECT theme_id, sym, tier, sub_theme_id, rationale, 'owner' AS source FROM theme_memberships"
            ).fetchall()]

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
    """Return all themes a ticker belongs to (owner + engine merged)."""
    sym = _to_dot(sym)
    conn = get_connection()
    try:
        try:
            rows = conn.execute("""
                SELECT m.theme_id, m.sym, m.tier, m.sub_theme_id, m.rationale, m.source,
                       t.name as theme_name, t.sector_id, ts.name as sector_name
                FROM (
                    SELECT tm.theme_id, tm.sym, tm.tier, tm.sub_theme_id, tm.rationale, 'owner' AS source
                      FROM theme_memberships tm
                     WHERE tm.sym = ?
                    UNION ALL
                    SELECT em.theme_id, em.sym, em.tier, em.sub_theme_id, em.rationale, 'engine' AS source
                      FROM engine_memberships em
                     WHERE em.sym = ?
                       AND em.action = 'add'
                       AND em.theme_id IN (SELECT id FROM themes)
                       AND NOT EXISTS (SELECT 1 FROM theme_memberships t2
                                       WHERE t2.theme_id = em.theme_id AND t2.sym = em.sym)
                ) m
                JOIN themes t ON m.theme_id = t.id
                JOIN theme_sectors ts ON t.sector_id = ts.id
            """, (sym, sym)).fetchall()
        except sqlite3.OperationalError:
            # Pre-migration DB (no engine_memberships) — owner-only still serves
            rows = conn.execute("""
                SELECT tm.*, 'owner' AS source, t.name as theme_name, t.sector_id, ts.name as sector_name
                FROM theme_memberships tm
                JOIN themes t ON tm.theme_id = t.id
                JOIN theme_sectors ts ON t.sector_id = ts.id
                WHERE tm.sym = ?
            """, (sym,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_theme_holdings(theme_id, tier_filter=None):
    """Return holdings for a theme (owner + engine merged), optionally filtered by tier."""
    conn = get_connection()
    try:
        tier_clause = ""
        tier_params = []
        if tier_filter:
            placeholders = ",".join("?" * len(tier_filter))
            tier_clause = f" WHERE m.tier IN ({placeholders})"
            tier_params = list(tier_filter)
        try:
            q = f"""
                SELECT m.* FROM (
                    SELECT tm.theme_id, tm.sym, tm.tier, tm.sub_theme_id, tm.rationale, 'owner' AS source
                      FROM theme_memberships tm
                     WHERE tm.theme_id = ?
                    UNION ALL
                    SELECT em.theme_id, em.sym, em.tier, em.sub_theme_id, em.rationale, 'engine' AS source
                      FROM engine_memberships em
                     WHERE em.theme_id = ?
                       AND em.action = 'add'
                       AND em.theme_id IN (SELECT id FROM themes)
                       AND NOT EXISTS (SELECT 1 FROM theme_memberships t2
                                       WHERE t2.theme_id = em.theme_id AND t2.sym = em.sym)
                ) m{tier_clause}
            """
            params = [theme_id, theme_id] + tier_params
            return [dict(r) for r in conn.execute(q, params).fetchall()]
        except sqlite3.OperationalError:
            # Pre-migration DB (no engine_memberships) — owner-only still serves
            q = "SELECT tm.*, 'owner' AS source FROM theme_memberships tm WHERE tm.theme_id = ?"
            params = [theme_id]
            if tier_filter:
                placeholders = ",".join("?" * len(tier_filter))
                q += f" AND tm.tier IN ({placeholders})"
                params.extend(tier_filter)
            return [dict(r) for r in conn.execute(q, params).fetchall()]
    finally:
        conn.close()
