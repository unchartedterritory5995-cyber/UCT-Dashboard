# api/services/community_badges.py
"""Auto-badges for The Floor — earned from real journal performance, so credibility in
the room is DATA, not talk. Privacy-first: badges are computed ONLY for users who opted
into shareJournalData (the same gate as shared trades), and only use scale-independent
fields (result / r_multiple) — never dollars or size.

Badges v1:
  green_week — net R across trades closed in the last 7 days > 0 (min 2 trades)
  hot_hand   — last 3 closed trades were all Wins

Cheap: one batched query per cache window (10 min TTL), defensive everywhere.
"""
import logging
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone

_logger = logging.getLogger(__name__)

_cache = {"at": 0.0, "by_user": {}}
_TTL = 600  # 10 min


def _compute():
    from api.services.auth_db import get_connection
    by_user = {}
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    with closing(get_connection()) as conn:
        # Only opted-in sharers (same gate as list_shared_trades).
        opted = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM j2_settings "
            "WHERE json_extract(data, '$.shareJournalData') = 1").fetchall()]
        if not opted:
            return by_user
        q = ",".join("?" * len(opted))
        # green_week: net R over the last 7 days (min 2 closed trades)
        for r in conn.execute(
                f"""SELECT user_id, COUNT(*) AS n, SUM(COALESCE(r_multiple, 0)) AS net_r
                      FROM j2_trades WHERE user_id IN ({q}) AND exit_date >= ?
                     GROUP BY user_id""", opted + [week_ago]).fetchall():
            if r["n"] >= 2 and (r["net_r"] or 0) > 0:
                by_user.setdefault(r["user_id"], []).append("green_week")
        # hot_hand: last 3 closed trades all Wins
        for uid in opted:
            rows = conn.execute(
                "SELECT result FROM j2_trades WHERE user_id=? "
                "ORDER BY exit_date DESC, created_at DESC LIMIT 3", (uid,)).fetchall()
            if len(rows) == 3 and all(x["result"] == "Win" for x in rows):
                by_user.setdefault(uid, []).append("hot_hand")
    return by_user


def badges_for(user_ids):
    """{user_id: [badge, ...]} for the given ids — cached, never raises."""
    now = time.time()
    if now - _cache["at"] > _TTL:
        try:
            _cache["by_user"] = _compute()
            _cache["at"] = now
        except Exception as e:
            _logger.debug("[floor-badges] compute failed: %s", e)
            _cache["at"] = now   # don't hammer a broken path
    m = _cache["by_user"]
    return {uid: m[uid] for uid in user_ids if uid in m}
