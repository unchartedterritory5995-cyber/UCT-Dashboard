"""D12 family: X posts from the official accounts — tweets.db DELETES them after 7 days.

``tweet_store.feed(official_only=True)`` (the accounts flagged ``is_official``:
TSDR_Trading, Braczyy, 1ChartMaster), filtered to one ET calendar day. The hourly
slot captures the ET day of (slot − 1 h), so the 00:29 run completes yesterday.

⛔ Never writes tweets.db and never calls TwitterAPI.io: a second poller would
move the shared since_id cursor and steal tweets from the live tape. The paid
historical backfill is a separate reader (capture/x_backfill.py).
"""
from __future__ import annotations

import datetime as dt
import math
import os
import time

from api.services.wisdom.capture.families._base import (
    et_day_start_epoch, result, safe_reader, to_date, unavailable,
)

FAMILY = "tweets"
SOURCE = "api.services.tweet_store.feed(official_only=True)"
RETENTION_DAYS = 7
FEED_LIMIT = 5000


def default_day(now_et: dt.datetime) -> dt.date:
    return (now_et - dt.timedelta(hours=1)).date()


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services import tweet_store

    day = to_date(as_of) or default_day(now_et)
    path = tweet_store._DB_PATH
    if not os.path.exists(path):
        return unavailable(FAMILY, as_of=day, source=SOURCE, gap="tweets_db",
                           reason=f"tweet store not found at {path}")
    start = et_day_start_epoch(day)
    end = et_day_start_epoch(day + dt.timedelta(days=1))
    now = time.time()
    gaps: dict = {}
    if now - start > RETENTION_DAYS * 86400:
        gaps["retention"] = (f"{day} is past the {RETENTION_DAYS}-day tweets.db retention; "
                             "anything already deleted is not recoverable here (see capture/x_backfill.py)")
    hours = max(1, math.ceil((now - start) / 3600) + 1)
    feed = tweet_store.feed(hours=hours, limit=FEED_LIMIT, official_only=True)
    if len(feed) >= FEED_LIMIT:
        gaps["feed_limit"] = f"feed returned its {FEED_LIMIT}-row limit; the day may be truncated"
    posts = sorted((t for t in feed if start <= int(t.get("created_at") or 0) < end),
                   key=lambda t: (int(t.get("created_at") or 0), str(t.get("id"))))
    handles: dict = {}
    for t in posts:
        handles[t.get("author_handle")] = handles.get(t.get("author_handle"), 0) + 1
    meta = {"per_handle": dict(sorted(handles.items())),
            "official_accounts": [h for h, _ in getattr(tweet_store, "OFFICIAL_ACCOUNTS", [])]}
    return result(FAMILY, as_of=day, source=SOURCE, rows=len(posts), payload=posts, gaps=gaps, meta=meta)
