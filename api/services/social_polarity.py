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

import bisect
import html
import os
import re
import time
import unicodedata
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
# Rendered after "Auto-labelled by", so it does not repeat those words.
METHOD = ("a word-and-emoji rule (bullish/bearish cue words, which side of a calls or puts "
          "trade, rockets and bears, with negation flipping a cue); not read by a person or "
          "an AI, so treat any single label as a guess")

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
#
# Review 2026-10-11 (pre-arm, scored on ~220 real posts from the curated X feed): the
# first cut could not read the feed's styled headlines (𝗕𝘂𝘆, 𝘂𝗽𝗴𝗿𝗮𝗱𝗲𝘀 are Unicode
# "mathematical bold", not ASCII), read the CASHTAG $BULL as a bullish word (so "TOP 10
# WEEKLY DOWNGRADES: ... $BULL" scored neutral), read "sold-out demand" as selling, and
# scored "buying puts" as a wash ("buying" +, "puts" -) and "selling puts" as doubly
# bearish. The fixes below are each one of those, not a model.

# Patterns are matched first (on the NFKC-folded, lowered text, cashtags and URLs
# removed) and then blanked, so their words do not count twice ("breaking out" is one
# bullish cue, not "breaking" + "out"; "sold puts" is one bullish cue, not two bearish).
_P = r"(?<![a-z0-9'])"   # left word edge (the text keeps apostrophes inside words)
_Q = r"(?![a-z0-9'])"    # right word edge


def _pat(words: str) -> str:
    return _P + "(?:" + words + ")" + _Q


_PATTERNS: tuple[tuple[re.Pattern, float], ...] = tuple((re.compile(p), w) for p, w in (
    # options: the side of the trade decides, not the word "puts"
    (_pat(r"(?:sold|sell|selling|sells|short|shorted|shorting|wrote|write|writing)\s+(?:some\s+|more\s+|the\s+)?(?:cash[- ]secured\s+)?puts"), 1.5),
    (_pat(r"(?:bought|buy|buying|buys|long|loaded|loading|load|grabbed|grabbing|added|adding|own|holding)\s+(?:up\s+on\s+|some\s+|more\s+|the\s+)?puts"), -2.0),
    (_pat(r"(?:sold|sell|selling|sells|wrote|writing)\s+(?:some\s+|more\s+|the\s+)?(?:covered\s+)?calls"), -0.5),
    (_pat(r"puts\s+(?:got\s+|are\s+|getting\s+)?(?:crushed|destroyed|worthless|burned|expired\s+worthless)"), 1.5),
    (_pat(r"calls\s+(?:got\s+|are\s+|getting\s+)?(?:crushed|destroyed|worthless|burned|expired\s+worthless)"), -1.5),
    # "puts"/"calls" as a VERB ("he puts it well", "calls out", "calls him") are not options
    (_pat(r"(?:puts|calls)\s+(?:it|this|that|out|him|her|them|us|me|you|together|forward)"), 0.0),
    # price targets and ratings
    (_pat(r"(?:raises|raised|raise|lifts|lifted|boosts|boosted|hikes|hiked)\s+(?:its\s+|the\s+)?(?:pt|price\s+target)"), 1.0),
    (_pat(r"(?:pt|price\s+target)\s+(?:raised|lifted|boosted|hiked|increased)"), 1.0),
    (_pat(r"(?:cuts|cut|lowers|lowered|trims|trimmed|slashes|slashed)\s+(?:its\s+|the\s+)?(?:pt|price\s+target)"), -1.0),
    (_pat(r"(?:pt|price\s+target)\s+(?:cut|lowered|trimmed|slashed|reduced)"), -1.0),
    (_pat(r"(?:raised|raises|raise|boosts|lifts)\s+(?:its\s+|fy\s*\S*\s+)?guidance"), 1.5),
    (_pat(r"(?:cut|cuts|lowered|lowers|slashes|slashed)\s+(?:its\s+|fy\s*\S*\s+)?guidance"), -1.5),
    # levels and moves
    (_pat(r"all[- ]time\s+highs?|record\s+highs?|new\s+highs?|aths?|ath's"), 1.0),
    (_pat(r"all[- ]time\s+lows?|record\s+lows?|new\s+lows?|52[- ]week\s+lows?"), -1.0),
    (_pat(r"breaking\s+out|broke\s+out"), 1.5), (_pat(r"higher\s+highs|higher\s+lows"), 1.0),
    (_pat(r"breaking\s+down|broke\s+down"), -1.5), (_pat(r"lower\s+highs|lower\s+lows"), -1.0),
    (_pat(r"support\s+held|holding\s+support|held\s+support"), 1.0),
    (_pat(r"lost\s+support|losing\s+support"), -1.0),
    (_pat(r"red\s+to\s+green"), 1.5), (_pat(r"green\s+to\s+red"), -1.5),
    (_pat(r"short\s+squeeze|covered\s+(?:my\s+|the\s+|all\s+)?shorts?"), 1.5),
    (_pat(r"bears\s+(?:are\s+|getting\s+|got\s+)?(?:wrecked|crushed|trapped|destroyed|squeezed)"), 1.5),
    (_pat(r"bulls\s+(?:are\s+|getting\s+|got\s+)?(?:wrecked|crushed|trapped|destroyed)"), -1.5),
    (_pat(r"buy\s+the\s+dip|bought\s+the\s+dip|btfd"), 1.5),
    (_pat(r"sold[- ]out|fully\s+booked"), 1.0),
    (_pat(r"sell[- ]off|selling\s+off|sellin\s+off|selloff"), -1.5),
    (_pat(r"up\s+\d+(?:\.\d+)?\s?%"), 1.0), (_pat(r"down\s+\d+(?:\.\d+)?\s?%"), -1.0),
    (r"(?<![\w.])\+\d+(?:\.\d+)?\s?%", 1.0), (r"(?<![\w.])-\d+(?:\.\d+)?\s?%", -1.0),
    (_pat(r"(?:let\s+it|about\s+to|gonna|going\s+to|ready\s+to)\s+rip"), 1.5),
    (_pat(r"rip\s+(?:to\s+)?(?:my\s+|the\s+|all\s+)?(?:calls|longs|account|port|portfolio|bulls)"), -1.5),
    (_pat(r"rip\s+(?:to\s+)?(?:my\s+|the\s+|all\s+)?(?:puts|shorts|bears)"), 1.0),
    (_pat(r"send\s+it"), 1.5), (_pat(r"to\s+the\s+moon"), 2.0),
    (_pat(r"taking\s+profits?|took\s+profits?"), -0.5),
    # Neutralisers: a time horizon, a figure of speech, not a direction.
    (_pat(r"short[- ]term|long[- ]term|in\s+short|short\s+of|short\s+week|short\s+list|shortlist"), 0.0),
    (_pat(r"how\s+long|as\s+long\s+as|long\s+time|so\s+long|too\s+long|for\s+long|long\s+way|"
          r"long\s+day|long\s+weekend|around\s+long|wait\s+long|before\s+long|long\s+story"), 0.0),
    (_pat(r"conference\s+calls?|earnings\s+calls?|margin\s+calls?|no[- ]brainer|missed\s+the\s+boat"), 0.0),
    # A negator that does not negate the cue after it ("can't believe it tanked").
    (_pat(r"(?:can'?t|cannot|can\s+not)\s+believe|(?:don'?t|do\s+not)\s+know|no\s+idea|not\s+gonna\s+lie|no\s+doubt"), 0.0),
))

_WORDS = {
    # bullish
    "bullish": 2.0, "bull": 1.5, "bulls": 1.0, "calls": 1.5, "long": 1.0, "longs": 1.0,
    "buy": 1.0, "buying": 1.0, "bought": 1.0, "breakout": 1.5, "moon": 1.5, "mooning": 1.5,
    "ripping": 1.5, "ripped": 1.0, "squeeze": 1.0, "upgrade": 1.5, "upgraded": 1.5, "upgrades": 1.5,
    "beat": 1.0, "beats": 1.0, "strong": 1.0, "strength": 1.0, "adding": 1.0, "added": 0.5,
    "loaded": 1.0, "rally": 1.0, "rallying": 1.0, "green": 1.0, "lfg": 1.5, "higher": 0.5,
    "surge": 1.0, "surging": 1.0, "surged": 1.0, "soaring": 1.0, "soars": 1.0, "soared": 1.0,
    "jumps": 1.0, "jumped": 1.0, "pumping": 0.5, "undervalued": 1.0,
    "outperform": 1.5, "overweight": 1.5, "bounce": 0.5, "bounced": 0.5, "bouncing": 0.5,
    # bearish
    "bearish": -2.0, "bear": -1.5, "bears": -1.0, "puts": -1.5, "short": -1.0, "shorts": -1.0,
    "shorting": -1.0, "shorted": -1.0, "sell": -1.0, "selling": -1.0, "sold": -1.0,
    "dump": -1.5, "dumping": -1.5, "crash": -1.5, "crashing": -1.5, "tank": -1.5,
    "tanking": -1.5, "tanked": -1.5, "breakdown": -1.5, "downgrade": -1.5, "downgraded": -1.5,
    "downgrades": -1.5, "miss": -1.0, "missed": -1.0, "misses": -1.0, "weak": -1.0,
    "weakness": -1.0, "red": -1.0, "fade": -1.0, "fading": -1.0, "trim": -0.5,
    "trimmed": -0.5, "overvalued": -1.0, "rug": -1.5, "rugged": -1.5, "bagholder": -1.0,
    "bagholding": -1.0, "rejected": -1.0, "rejection": -1.0, "plunge": -1.5,
    "plunging": -1.5, "plunges": -1.5, "lower": -0.5, "drop": -0.5, "dropping": -1.0,
    "falling": -1.0, "underperform": -1.5, "underweight": -1.5, "selloff": -1.5,
    # "rip" alone is "rest in peace" as often as "it'll rip": only the phrases above count.
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
    # skull (U+1F480) is NOT a cue: in chat it is laughter ("I'm dead") at least as often
}

_NEGATORS = {"not", "no", "never", "dont", "don't", "isnt", "isn't", "aint", "ain't",
             "wont", "won't", "cant", "can't", "didnt", "didn't", "doesnt", "doesn't",
             "wasnt", "wasn't", "without", "nothing"}
_NEGATION_REACH = 3
BULL_AT = 0.2
_TOKEN = re.compile(r"[a-z][a-z']*|[\U0001F300-\U0001FAFF]")
_URL = re.compile(r"https?://\S+|www\.\S+")
# A cashtag names the ticker, never the mood: $BULL (Webull), $BEAR, $RIP, $MOON are symbols.
_CASHTAG = re.compile(r"(?<![A-Za-z0-9])\$[A-Za-z]{1,6}(?:[.-][A-Za-z]{1,2})?\b")
# "/s" closes a sarcastic line: the words say the opposite of the meaning, so no label.
_SARCASM = re.compile(r"(?:^|\s)/s(?:\s|$|[.!?)])")


def classify(text: str, tickers=None) -> tuple[str, float]:
    """(label, score) with score in (-1, 1). Deterministic and never raises.

    `tickers`: the symbols the post was counted for. A bare symbol that is also a cue
    word (BULL, LONG, RIP ...) is removed in its exact case, as a cashtag always is."""
    try:
        raw = unicodedata.normalize("NFKC", text or "")
        raw = _URL.sub(" ", raw)
        raw = _CASHTAG.sub(" ", raw)
        for t in tickers or ():
            t = str(t or "").strip()
            if t and t.isupper():
                raw = re.sub(r"(?<![A-Za-z0-9$])" + re.escape(t) + r"(?![A-Za-z0-9])", " ", raw)
        s = raw.lower().replace("’", "'")
        if _SARCASM.search(s):
            return "neutral", 0.0
        bull = bear = 0.0
        for rx, w in _PATTERNS:
            n = len(rx.findall(s))
            if not n:
                continue
            if w > 0:
                bull += w * n
            elif w < 0:
                bear += -w * n
            s = rx.sub(" ", s)
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
    tickers = list(dict.fromkeys(tickers))
    label, score = classify(content, tickers)
    return [(SOURCE_ROOM, str(message_id), t, str(channel_id), str(author_id or ""), int(ts),
             content, label, score) for t in tickers]


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
    tid = str(tweet.get("id") or "")
    ts = int(tweet.get("created_at") or 0)
    if not tid or not ts:
        return 0
    keep = [t for t in dict.fromkeys(tickers or []) if primary is None or primary.get(t, True)]
    if not keep:
        return 0
    label, score = classify(tweet.get("text", ""), keep)
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

    # The split needs every row in the window but only the page needs its text, so the
    # text is read back for the page alone (a hot ticker's 3M window is ~10k rows).
    sql = ("SELECT source, post_id, channel_id, author, ts, label, score FROM social_posts "
           "WHERE ticker=? AND ts >= ? AND ts < ?")
    params: list = [sym, lo, end_ts]
    if source != "all":
        sql += " AND source=?"
        params.append(source)
    rows = [dict(r) for r in c.execute(sql, params)]

    # ET day per row by bisecting the window's own ET midnights (DST-correct, and one
    # zoneinfo conversion per DAY instead of per row).
    day_list = [start_day + timedelta(days=i) for i in range((end_day - start_day).days + 1)]
    starts = [int(datetime(x.year, x.month, x.day, tzinfo=_ET).timestamp()) for x in day_list]
    by_day: dict[str, dict] = {}
    for r in rows:
        i = bisect.bisect_right(starts, r["ts"]) - 1
        iso = day_list[i].isoformat() if i >= 0 else _et_day(r["ts"])
        slot = by_day.setdefault(iso, {"bullish": 0, "bearish": 0, "neutral": 0})
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
    room_ids = [r["post_id"] for r in page if r["source"] == SOURCE_ROOM]
    room_text: dict[str, str] = {}
    if room_ids:
        room_text = {r["post_id"]: r["text"] for r in c.execute(
            "SELECT post_id, text FROM social_posts WHERE source=? AND ticker=? AND post_id IN (%s)"
            % ",".join("?" * len(room_ids)), [SOURCE_ROOM, sym, *room_ids])}
    xt = _x_texts([r["post_id"] for r in page if r["source"] == SOURCE_X])
    posts = []
    for r in page:
        p = {"source": r["source"], "id": r["post_id"], "ts": r["ts"], "date": _et_day(r["ts"]),
             "label": r["label"], "score": r["score"]}
        if r["source"] == SOURCE_ROOM:
            p.update(text=room_text.get(r["post_id"]), text_state="kept", link=_room_link(r["channel_id"], r["post_id"]),
                     author=None)
        else:
            t = xt.get(r["post_id"])
            url = (t or {}).get("url") or ""
            # tweets.db keeps X's HTML-escaped body ("AT&amp;T"); the panel renders text,
            # never markup, so unescape here and let React escape it once. A link that is
            # not https is dropped rather than rendered as an href.
            p.update(text=html.unescape(t["text"]) if t and t.get("text") is not None else None,
                     text_state="kept" if t else "x_window_passed",
                     link=url if url.startswith("https://") else None,
                     author=(t or {}).get("author_handle") or r["author"] or None)
        posts.append(p)

    return {**base, "state": "ok",
            "window": {"from": start_day.isoformat(), "through": end_day.isoformat(),
                       "covered_from": covered_from, "timezone": "America/New_York"},
            "days": days, "totals": totals, "posts": posts, "posts_matching": len(picked),
            "x_text_note": ("X posts keep only their label here; the text shows while the X feed "
                            "store still holds the post (about 7 days)")}
