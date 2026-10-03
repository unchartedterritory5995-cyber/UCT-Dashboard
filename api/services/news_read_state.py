"""D-8 -- read / unread on company news, per member, server-side (Lane R).

One store, not a second one: the rows live in `calendar_seen` (auth.db), the
per-member read-state table the calendar hub already uses, under their own
item_type `company_news` keyed by the company-news store's story id (an
AUTOINCREMENT id, never reused). Owner-scoped by construction: every read and
write is `WHERE user_id = <the caller>`; there is no route that names another
member.

Idempotent both ways: marking a read story read keeps its first read time;
marking an unread story unread is a no-op. A story id the store does not hold
is refused, never silently recorded.

DARK behind NEWS_READ_STATE_ENABLED (read per call).
"""
from __future__ import annotations

import contextlib
import os
from datetime import datetime, timezone

from api.services import calendar_seen

ENABLED_ENV = "NEWS_READ_STATE_ENABLED"
ITEM_TYPE = "company_news"
MAX_IDS = 200


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _conn():
    calendar_seen._ensure_init()  # noqa: SLF001
    return contextlib.closing(calendar_seen._get_connection())  # noqa: SLF001


def read_among(user_id, news_ids: list[int]) -> dict[int, str]:
    """{story id: read_at} for the ids this member has read."""
    ids = [int(i) for i in news_ids]
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    with _conn() as c:
        rows = c.execute(
            f"SELECT item_key, seen_at FROM calendar_seen WHERE user_id=? AND item_type=? "
            f"AND item_key IN ({marks})", [str(user_id), ITEM_TYPE, *[str(i) for i in ids]]).fetchall()
    return {int(r["item_key"]): str(r["seen_at"]) for r in rows}


def set_read(user_id, news_ids: list[int], read: bool) -> dict[int, str]:
    """Mark these stories read (or unread) for this member; returns the
    member's read map for the same ids afterwards."""
    ids = sorted({int(i) for i in news_ids})
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        for i in ids:
            if read:
                c.execute(
                    "INSERT INTO calendar_seen (user_id, item_type, item_key, seen_at) "
                    "VALUES (?,?,?,?) ON CONFLICT(user_id, item_type, item_key) DO NOTHING",
                    (str(user_id), ITEM_TYPE, str(i), now))
            else:
                c.execute(
                    "DELETE FROM calendar_seen WHERE user_id=? AND item_type=? AND item_key=?",
                    (str(user_id), ITEM_TYPE, str(i)))
        c.commit()
    return read_among(user_id, ids)


def existing_story_ids(news_ids: list[int]) -> set[int]:
    """The ids the company-news store actually holds."""
    ids = sorted({int(i) for i in news_ids})
    if not ids:
        return set()
    from api.services.news import store
    store._ensure_init()  # noqa: SLF001
    marks = ",".join("?" for _ in ids)
    with contextlib.closing(store._connect()) as c:  # noqa: SLF001
        rows = c.execute(f"SELECT id FROM news_items WHERE id IN ({marks})", ids).fetchall()
    return {int(r[0]) for r in rows}
