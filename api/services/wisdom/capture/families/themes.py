"""D12 family: theme members — the owner taxonomy is WIPED AND RE-INSERTED on every reseed.

``theme_db.get_all_themes()`` (owner rows merged with the engine overlay, each
holding tagged ``source``) plus the seed version and content hash the reseed
gate stores in ``user_preferences``. One short read a day on auth.db (the hot
database), at 06:13 ET. Hash-on-change: an unchanged payload writes no object.
"""
from __future__ import annotations

import sqlite3

from api.services.wisdom.capture.families._base import result, safe_reader, to_date, unavailable

FAMILY = "themes"
SOURCE = "api.services.theme_db.get_all_themes"
SEED_KEYS = ("theme_seed_version", "theme_seed_content_hash")


def _seed_marks() -> dict:
    from api.services import theme_db

    conn = theme_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT pref_key, pref_value FROM user_preferences WHERE user_id = 'system' AND pref_key IN (?, ?)",
            SEED_KEYS,
        ).fetchall()
        return {r[0]: r[1] for r in rows}
    finally:
        conn.close()


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services import theme_db

    day = to_date(as_of) or now_et.date()
    try:
        data = theme_db.get_all_themes()
    except sqlite3.OperationalError as exc:
        return unavailable(FAMILY, as_of=day, source=SOURCE, gap="theme_tables",
                           reason=f"theme tables unreadable in auth.db: {exc}"[:300])
    if not isinstance(data, dict) or not isinstance(data.get("themes"), list):
        return unavailable(FAMILY, as_of=day, source=SOURCE, gap="themes",
                           reason="get_all_themes() returned no themes list")
    gaps: dict = {}
    try:
        marks = _seed_marks()
    except Exception as exc:  # noqa: BLE001
        marks = {}
        gaps["seed_marks"] = f"{type(exc).__name__}: {exc}"[:300]
    holdings = sum(len(t.get("holdings") or []) for t in data["themes"])
    sources: dict = {}
    for theme in data["themes"]:
        for h in theme.get("holdings") or []:
            key = str(h.get("source") or "unknown")
            sources[key] = sources.get(key, 0) + 1
    meta = {"themes": len(data["themes"]), "sectors": len(data.get("sectors") or []),
            "holdings_by_source": dict(sorted(sources.items())),
            "taxonomy_version": marks.get("theme_seed_version"),
            "taxonomy_content_hash": marks.get("theme_seed_content_hash")}
    return result(FAMILY, as_of=day, source=SOURCE, rows=holdings, payload=data, gaps=gaps, meta=meta)
