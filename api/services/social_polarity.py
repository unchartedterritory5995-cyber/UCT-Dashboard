"""FT-080 social sentiment: an AUTO-LABELLED bullish / bearish / neutral split for a
ticker's room and X posts, over a member-chosen window (1W / 1M / 3M), with the
posts themselves sortable by time or polarity.

Owner ruling 2026-10-11 (Patrick, in chat), reversing the "no message text kept"
rule for this purpose: "store text but allow sorting, one week, one month etc."

WHAT IS STORED (buzz.db `social_posts`, see buzz_store's docstring):
  * #main-chat: the text of each message the mention series already counts, one row
    per (message x ticker), with its label and score;
  * X (the curated feed in tweets.db): the label and score ONLY. The text is read
    back from tweets.db while that store still holds it (its own 7-day window and
    X deletion-sync), and is never copied here: a second, longer-lived copy of a
    tweet body is the "back door around the tweet retention window" the licensing
    register names (X-05). So an X post older than tweets.db's window still counts
    in the split but shows without its text, and the payload says so.

RETENTION. SOCIAL_TEXT_RETENTION_DAYS (default 90). `prune` deletes older rows; it
rides the buzz poll (`maybe_prune`, at most every PRUNE_EVERY_S) and runs whether or
not the flag is on, so disarming the flag never leaves text behind indefinitely.
A window longer than retention covers only what retention kept; the payload's
`window.covered_from` names the first day actually covered.

THE CLASSIFIER is deterministic and free: cue words and phrases (bullish/bearish,
calls/puts, breakout/breakdown, upgrade/downgrade...), emojis (rocket, bear, charts),
and a negation flip ("not bullish" counts bearish). No paid model is called, per
message or otherwise. Every surface labels it as an automatic heuristic.

DARK behind SOCIAL_POLARITY_ENABLED, read per call: unset, nothing is written,
the route 404s and the panel shows the old "unavailable" sentence.
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

ENABLED_ENV = "SOCIAL_POLARITY_ENABLED"
RETENTION_ENV = "SOCIAL_TEXT_RETENTION_DAYS"
DEFAULT_RETENTION_DAYS = 90
PRUNE_EVERY_S = 6 * 3600

WINDOWS = {"1w": 7, "1m": 30, "3m": 90}
DEFAULT_WINDOW = "1m"
SORTS = ("newest", "oldest", "most_bullish", "most_bearish")
SOURCES = ("all", "room", "x")
LABELS = ("all", "bullish", "bearish", "neutral")
MAX_LIMIT = 200

SOURCE_ROOM = "room"
SOURCE_X = "x"
METHOD = ("auto-labelled by a word-and-emoji rule (bullish/bearish cue words, calls/puts, "
          "rockets and bears, with negation flipping a cue); not read by a person or an AI, "
          "so treat any single label as a guess")

_ET = ZoneInfo("America/New_York")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def retention_days() -> int:
    raw = os.environ.get(RETENTION_ENV, "").strip()
    try:
        n = int(raw) if raw else DEFAULT_RETENTION_DAYS
    except ValueError:
        n = DEFAULT_RETENTION_DAYS
    return max(1, n)


# ── the classifier ──────────────────────────────────────────────────────────

# Phrases are matched first on the lowered text and then removed, so their words do
# not count twice ("breaking out" is one bullish cue, not "breaking" + "out").
_PHRASES = (
    ("all time high", 1.0), ("all-time high", 1.0), ("breaking out", 1.5), ("higher highs", 1.0),
    ("higher lows", 1.0), ("raised guidance", 1.5), ("raises guidance", 1.5), ("price target raised", 1.5),
    ("send it", 1.5), ("to the moon", 2.0), ("support held", 1.0), ("holding support", 1.0),
    ("breaking down", -1.5), ("lower highs", -1.0), ("lower lows", -1.0), ("cut guidance", -1.5),
    ("cuts guidance", -1.5), ("lowered guidance", -1.5), ("price target cut", -1.5),
    ("lost support", -1.0), ("losing support", -1.0), ("taking profits", -0.5),
    # Neutralisers: a time horizon, not a direction.
    ("short term", 0.0), ("short-term", 0.0), ("long term", 0.0), ("long-term", 0.0),
    ("conference call", 0.0), ("earnings call", 0.0),
)

_WORDS = {
    # bullish
    "bullish": 2.0, "bull": 1.5, "bulls": 1.0, "calls": 1.5, "long": 1.0, "longs": 1.0,
    "buy": 1.0, "buying": 1.0, "bought": 1.0, "breakout": 1.5, "moon": 1.5, "mooning": 1.5,
    "rip": 1.0, "ripping": 1.5, "squeeze": 1.0, "upgrade": 1.5, "upgraded": 1.5, "upgrades": 1.5,
    "beat": 1.0, "beats": 1.0, "strong": 1.0, "strength": 1.0, "adding": 1.0, "added": 0.5,
    "loaded": 1.0, "rally": 1.0, "rallying": 1.0, "green": 1.0, "lfg": 1.5, "higher": 0.5,
    "surge": 1.0, "surging": 1.0, "soaring": 1.0, "pumping": 0.5, "undervalued": 1.0,
    # bearish
    "bearish": -2.0, "bear": -1.5, "bears": -1.0, "puts": -1.5, "short": -1.0, "shorts": -1.0,
    "shorting": -1.0, "shorted": -1.0, "sell": -1.0, "selling": -1.0, "sold": -1.0,
    "dump": -1.5, "dumping": -1.5, "crash": -1.5, "crashing": -1.5, "tank": -1.5,
    "tanking": -1.5, "breakdown": -1.5, "downgrade": -1.5, "downgraded": -1.5,
    "downgrades": -1.5, "miss": -1.0, "missed": -1.0, "misses": -1.0, "weak": -1.0,
    "weakness": -1.0, "red": -1.0, "fade": -1.0, "fading": -1.0, "trim": -0.5,
    "trimmed": -0.5, "overvalued": -1.0, "rug": -1.5, "rugged": -1.5, "bagholder": -1.0,
    "bagholding": -1.0, "rejected": -1.0, "rejection": -1.0, "plunge": -1.5,
    "plunging": -1.5, "lower": -0.5, "drop": -0.5, "dropping": -1.0,
}

_EMOJI = {
    "\U0001F680": 2.0,   # rocket
    "\U0001F4C8": 1.5,   # chart increasing
    "\U0001F402": 1.5,   # ox
    "\U0001F403": 1.5,   # water buffalo
    "\U0001F7E2": 1.0,   # green circle
    "\U0001F48E": 0.5,   # gem
    "\U0001F43B": -2.0,  # bear
    "\U0001F4C9": -1.5,  # chart decreasing
    "\U0001F53B": -1.0,  # red triangle down
    "\U0001FA78": -1.0,  # drop of blood
    "\U0001F534": -1.0,  # red circle
    "\U0001F480": -1.0,  # skull
}

_NEGATORS = {"not", "no", "never", "dont", "don't", "isnt", "isn't", "aint", "ain't",
             "wont", "won't", "cant", "can't", "didnt", "didn't", "doesnt", "doesn't",
             "wasnt", "wasn't", "without", "nothing"}
_NEGATION_REACH = 3
BULL_AT = 0.2
_TOKEN = re.compile(r"[a-z][a-z']*|[\U0001F300-\U0001FAFF]")


def classify(text: str) -> tuple[str, float]:
    """(label, score) with score in (-1, 1). Deterministic and never raises."""
    try:
        s = (text or "").lower()
        bull = bear = 0.0
        for phrase, w in _PHRASES:
            if phrase in s:
                n = s.count(phrase)
                if w > 0:
                    bull += w * n
                elif w < 0:
                    bear += -w * n
                s = s.replace(phrase, " ")
        toks = _TOKEN.findall(s)
        for i, t in enumerate(toks):
            w = _WORDS.get(t, 0.0) or _EMOJI.get(t, 0.0)
            if not w:
                continue
            if t in _WORDS and any(p in _NEGATORS for p in toks[max(0, i - _NEGATION_REACH):i]):
                w = -w
            if w > 0:
                bull += w
            else:
                bear += -w
        score = round((bull - bear) / (bull + bear + 1.0), 3)
        if score >= BULL_AT:
            return "bullish", score
        if score <= -BULL_AT:
            return "bearish", score
        return "neutral", score
    except Exception:  # noqa: BLE001 -- a label is an annotation, never a reason to drop a row
        return "neutral", 0.0


# ── writes (each a no-op while the flag is off) ─────────────────────────────

def room_rows(channel_id: str, message_id: str, author_id: str, ts: int, content: str, tickers) -> list[tuple]:
    label, score = classify(content)
    return [(SOURCE_ROOM, str(message_id), t, str(channel_id), str(author_id or ""), int(ts),
             content, label, score) for t in dict.fromkeys(tickers)]


def record_room(rows) -> int:
    if not is_enabled():
        return 0
    from api.services import buzz_store
    return buzz_store.record_posts(rows)


def record_tweet(tweet: dict, tickers, primary=None) -> int:
    """Label one stored tweet for each ticker it is ABOUT (a mention-only link, per
    the A8 resolver, is skipped). Text is NOT copied (see the module docstring)."""
    if not is_enabled():
        return 0
    from api.services import buzz_store
    label, score = classify(tweet.get("text", ""))
    tid = str(tweet.get("id") or "")
    ts = int(tweet.get("created_at") or 0)
    if not tid or not ts:
        return 0
    keep = [t for t in dict.fromkeys(tickers or []) if primary is None or primary.get(t, True)]
    if not keep:
        return 0
    buzz_store.init_db()
    return buzz_store.record_posts(
        [(SOURCE_X, tid, t, "", str(tweet.get("author_handle") or ""), ts, None, label, score)
         for t in keep])


def prune(now: Optional[float] = None) -> int:
    from api.services import buzz_store
    if not os.path.exists(buzz_store.db_path()):
        return 0
    cutoff = int(now if now is not None else time.time()) - retention_days() * 86400
    return buzz_store.prune_posts(cutoff)


_last_prune = 0.0


def maybe_prune() -> int:
    """Called from the buzz poll every minute; actually prunes at most every PRUNE_EVERY_S.
    Flag-independent on purpose. Never raises."""
    global _last_prune
    now_m = time.monotonic()
    if _last_prune and now_m - _last_prune < PRUNE_EVERY_S:
        return 0
    _last_prune = now_m
    try:
        return prune()
    except Exception:  # noqa: BLE001
        return 0


# ── the read ────────────────────────────────────────────────────────────────

def _et_day(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(_ET).date().isoformat()


def _x_texts(ids: list[str]) -> dict[str, dict]:
    """tweets.db's own copy of each id still inside its window. Read-only; a missing
    store or a read error returns {} (the posts then show without text)."""
    if not ids:
        return {}
    try:
        import contextlib
        import sqlite3
        from api.services import tweet_store
        path = tweet_store._DB_PATH
        if not os.path.exists(path):
            return {}
        uri = "file:" + path.replace("\\", "/") + "?mode=ro"
        with contextlib.closing(sqlite3.connect(uri, uri=True, timeout=5.0)) as c:
            c.row_factory = sqlite3.Row
            rows = c.execute("SELECT id, text, url, author_handle FROM tweets WHERE id IN (%s)"
                             % ",".join("?" * len(ids)), ids).fetchall()
        return {r["id"]: dict(r) for r in rows}
    except Exception:  # noqa: BLE001
        return {}


def _room_link(channel_id: str, message_id: str) -> Optional[str]:
    try:
        from api.services.buzz_boards import GUILD_ID
    except Exception:  # noqa: BLE001
        return None
    return f"https://discord.com/channels/{GUILD_ID}/{channel_id}/{message_id}"


def view(sym: str, window: str = DEFAULT_WINDOW, sort: str = "newest", source: str = "all",
         label: str = "all", limit: int = 50, now: Optional[datetime] = None) -> dict:
    from api.services import buzz_store
    sym = (sym or "").upper().strip()
    window = window if window in WINDOWS else DEFAULT_WINDOW
    sort = sort if sort in SORTS else "newest"
    source = source if source in SOURCES else "all"
    label = label if label in LABELS else "all"
    limit = max(1, min(int(limit or 50), MAX_LIMIT))
    base = {"ticker": sym, "method": METHOD, "auto_labelled": True, "window_key": window,
            "sort": sort, "source_filter": source, "label_filter": label,
            "retention_days": retention_days(), "windows": list(WINDOWS)}
    if not os.path.exists(buzz_store.db_path()):
        return {**base, "state": "no_store", "reason": "the post store has not been created on this server"}
    now = now or datetime.now(timezone.utc)
    end_day = now.astimezone(_ET).date()
    start_day = end_day - timedelta(days=WINDOWS[window] - 1)
    start_ts = int(datetime(start_day.year, start_day.month, start_day.day, tzinfo=_ET).timestamp())
    end_ts = int(now.timestamp()) + 1
    retained_from = int(now.timestamp()) - retention_days() * 86400
    c = buzz_store.connect()
    first = c.execute("SELECT MIN(ts) AS t FROM social_posts").fetchone()["t"]
    if first is None:
        return {**base, "state": "no_store",
                "reason": "no posts have been labelled yet; labelling starts when the feature is switched on"}
    lo = max(start_ts, retained_from, int(first))
    covered_from = _et_day(lo)

    sql = ("SELECT source, post_id, channel_id, author, ts, text, label, score FROM social_posts "
           "WHERE ticker=? AND ts >= ? AND ts < ?")
    params: list = [sym, lo, end_ts]
    if source != "all":
        sql += " AND source=?"
        params.append(source)
    rows = [dict(r) for r in c.execute(sql, params)]

    by_day: dict[str, dict] = {}
    for r in rows:
        slot = by_day.setdefault(_et_day(r["ts"]), {"bullish": 0, "bearish": 0, "neutral": 0})
        slot[r["label"]] = slot.get(r["label"], 0) + 1
    days, d = [], start_day
    while d <= end_day:
        iso = d.isoformat()
        if iso < covered_from:
            days.append({"date": iso, "state": "not_covered", "bullish": None, "bearish": None, "neutral": None})
        else:
            days.append({"date": iso, "state": "ok", **by_day.get(iso, {"bullish": 0, "bearish": 0, "neutral": 0})})
        d += timedelta(days=1)

    totals = {k: sum(1 for r in rows if r["label"] == k) for k in ("bullish", "bearish", "neutral")}
    totals["posts"] = len(rows)
    directional = totals["bullish"] + totals["bearish"]
    totals["bull_share_pct"] = round(100 * totals["bullish"] / directional, 1) if directional else None
    totals["by_source"] = {s: sum(1 for r in rows if r["source"] == s) for s in (SOURCE_ROOM, SOURCE_X)}

    picked = rows if label == "all" else [r for r in rows if r["label"] == label]
    if sort == "newest":
        picked.sort(key=lambda r: (-r["ts"], r["post_id"]))
    elif sort == "oldest":
        picked.sort(key=lambda r: (r["ts"], r["post_id"]))
    elif sort == "most_bullish":
        picked.sort(key=lambda r: (-r["score"], -r["ts"], r["post_id"]))
    else:
        picked.sort(key=lambda r: (r["score"], -r["ts"], r["post_id"]))
    page = picked[:limit]
    xt = _x_texts([r["post_id"] for r in page if r["source"] == SOURCE_X])
    posts = []
    for r in page:
        p = {"source": r["source"], "id": r["post_id"], "ts": r["ts"], "date": _et_day(r["ts"]),
             "label": r["label"], "score": r["score"]}
        if r["source"] == SOURCE_ROOM:
            p.update(text=r["text"], text_state="kept", link=_room_link(r["channel_id"], r["post_id"]),
                     author=None)
        else:
            t = xt.get(r["post_id"])
            p.update(text=t["text"] if t else None,
                     text_state="kept" if t else "x_window_passed",
                     link=(t or {}).get("url") or None,
                     author=(t or {}).get("author_handle") or r["author"] or None)
        posts.append(p)

    return {**base, "state": "ok",
            "window": {"from": start_day.isoformat(), "through": end_day.isoformat(),
                       "covered_from": covered_from, "timezone": "America/New_York"},
            "days": days, "totals": totals, "posts": posts, "posts_matching": len(picked),
            "x_text_note": ("X posts keep only their label here; the text shows while the X feed "
                            "store still holds the post (about 7 days)")}
