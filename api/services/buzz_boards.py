# api/services/buzz_boards.py
"""The two boards: most-talked-about (by people) and heating-up (vs baseline).

⛔ HEAT SCORE, TRAP 1 -- THE DENOMINATOR MUST MATCH. Comparing today-so-far
against a 30-day DAILY average is apples to oranges: at 09:45 every ticker
looks stone cold, and the board lies all morning. The baseline is the mean of
each prior session measured over THE SAME ELAPSED TIME from its own open.

⛔ HEAT SCORE, TRAP 2 -- A FLOOR, OR IT IS NOISE. A name mentioned once in 30
days and three times today is "3x normal" and completely meaningless. A ratio
without a base rate is not a signal.
"""
from __future__ import annotations

import datetime as dt
import os
from zoneinfo import ZoneInfo

from api.services import buzz_store

_ET = ZoneInfo("America/New_York")

OPEN_H, OPEN_M = 9, 30
CLOSE_H, CLOSE_M = 16, 0

MIN_CURRENT = int(os.environ.get("BUZZ_HEAT_MIN_CURRENT", "5"))
MIN_BASELINE = float(os.environ.get("BUZZ_HEAT_MIN_BASELINE", "1.0"))
# 26 fifteen-minute slices across a ~6.5h session. ⛔ NOT a smaller number:
# 7-8 bars across the board's ~190px sparkline box render as FAT BLOCKS that
# read as a second bar chart competing with the count beside them. Measured
# visually across two board iterations. The sparkline exists to show WHEN the
# chatter happened; at 8 buckets it shows nothing.
SPARK_BUCKETS = 26

WINDOW_LABEL = {
    "open": "since the open", "today": "today", "noon": "since noon",
    "week": "this week", "month": "this month",
}

GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "882293203485720596")


def _channels() -> list[str]:
    from api.services import buzz_ingest
    return buzz_ingest.channels()


def _et(ts: int) -> dt.datetime:
    return dt.datetime.fromtimestamp(ts, _ET)


def _session_open(d: dt.datetime) -> int:
    return int(d.replace(hour=OPEN_H, minute=OPEN_M, second=0, microsecond=0).timestamp())


def window_bounds(name: str, now: int) -> tuple[int, int]:
    d = _et(now)
    if name == "open":
        return _session_open(d), now
    if name == "noon":
        return int(d.replace(hour=12, minute=0, second=0, microsecond=0).timestamp()), now
    if name == "today":
        return int(d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()), now
    if name == "week":
        monday = d - dt.timedelta(days=d.weekday())
        return int(monday.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()), now
    if name == "month":
        return int(d.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()), now
    return _session_open(d), now


def top_board(window: str, now: int, limit: int = 5) -> list[dict]:
    start, end = window_bounds(window, now)
    chans = _channels()
    rows = buzz_store.board(start, end, chans, limit=limit)
    for r in rows:
        r["spark"] = buzz_store.series(r["ticker"], start, end, SPARK_BUCKETS, chans)
    return rows


def _prior_session_days(now: int, sessions: int) -> list[dt.datetime]:
    d = _et(now)
    out, day = [], d
    while len(out) < sessions:
        day = day - dt.timedelta(days=1)
        if day.weekday() < 5:                      # weekdays only
            out.append(day)
    return out


def heat_board(now: int, limit: int = 4, sessions: int = 30) -> list[dict]:
    chans = _channels()
    open_ts = _session_open(_et(now))
    elapsed = max(0, now - open_ts)
    # ⛔ NOT a top-N by popularity. This board exists to surface names that are
    # NOT already popular, so pre-filtering candidates by today's rank is a
    # contradiction. Measured: a ticker at 20x its normal chatter was invisible
    # because it ranked 51st by raw mentions, and the board rendered EMPTY while
    # that move was happening. MIN_CURRENT is the right gate and it is applied
    # immediately below.
    candidates = [r for r in buzz_store.board(open_ts, now, chans, limit=10_000)
                  if r["mentions"] >= MIN_CURRENT]

    out: list[dict] = []
    for row in candidates:
        cur = row["mentions"]
        if cur < MIN_CURRENT:
            continue
        prior = []
        for day in _prior_session_days(now, sessions):
            o = _session_open(day)
            prior.append(buzz_store.count(row["ticker"], o, o + elapsed, chans))
        base = (sum(prior) / len(prior)) if prior else 0.0
        if base < MIN_BASELINE:
            continue
        out.append({"ticker": row["ticker"], "mentions": cur, "ratio": round(cur / base, 1)})

    out.sort(key=lambda r: r["ratio"], reverse=True)
    return [r for r in out if r["ratio"] >= 1.5][:limit]


def ticker_detail(ticker: str, window: str, now: int) -> dict:
    start, end = window_bounds(window, now)
    chans = _channels()
    sym = ticker.upper()
    c = buzz_store.connect()
    cl = (" AND channel_id IN (%s)" % ",".join("?" * len(chans))) if chans else ""
    # ⛔ Direct query, NOT a scan of a capped board. The sparkline and link below
    # are uncapped, so a capped lookup here produced "0 mentions" beside a
    # non-empty sparkline and a working link -- a payload contradicting itself.
    row = c.execute(
        "SELECT COUNT(*) AS n, COUNT(DISTINCT author_id) AS p FROM mentions "
        "WHERE ticker=? AND ts >= ? AND ts < ?" + cl,
        [sym, start, end, *chans],
    ).fetchone()
    mentions, people = row["n"], row["p"]
    last = c.execute(
        "SELECT message_id, channel_id FROM mentions WHERE ticker=? AND ts>=? AND ts<?" + cl +
        " ORDER BY ts DESC LIMIT 1", [sym, start, end, *chans]
    ).fetchone()
    link = ""
    if last:
        link = f"https://discord.com/channels/{GUILD_ID}/{last['channel_id']}/{last['message_id']}"
    return {
        "ticker": sym, "window": window,
        "mentions": mentions, "people": people,
        "spark": buzz_store.series(sym, start, end, SPARK_BUCKETS, chans),
        "link": link,
    }


def full_board(window: str, now: int, spark_top: int = 14) -> list[dict]:
    """EVERY ticker in the window, ranked — the board shows all of them.
    `top_board` stays for the TEXT reply, which cannot.

    Sparklines only for the first `spark_top`: the tail renders as plain text,
    and a sparkline nobody draws is one `series()` scan per ticker wasted."""
    start, end = window_bounds(window, now)
    chans = _channels()
    rows = buzz_store.board(start, end, chans, limit=10_000)
    for r in rows[:spark_top]:
        r["spark"] = buzz_store.series(r["ticker"], start, end, SPARK_BUCKETS, chans)
    return rows


def split_tail(rows: list[dict]) -> tuple[list[dict], list[str]]:
    """Split the post-headline tail into (2+ mentions, mentioned-exactly-once).
    The once-each names collapse to bare symbols on the board — they are the
    least informative third of any day and must not occupy a third of the image."""
    multi = [r for r in rows if r["mentions"] >= 2]
    singles = [r["ticker"] for r in rows if r["mentions"] < 2]
    return multi, singles


def totals(window: str, now: int) -> dict:
    """Header counts: `{"messages", "members", "tickers"}`.

    ⛔ `messages` is MESSAGES THAT MENTIONED A TICKER, not every message in the
    channel — the store only ever holds ticker-bearing rows, so a channel total
    is not derivable from it. The board must label it accordingly ("318 messages
    with tickers"), or the number silently answers a question nobody asked. Same
    class as every denominator bug in this repo's history."""
    start, end = window_bounds(window, now)
    chans = _channels()
    cl = (" AND channel_id IN (%s)" % ",".join("?" * len(chans))) if chans else ""
    r = buzz_store.connect().execute(
        "SELECT COUNT(DISTINCT message_id) AS m, COUNT(DISTINCT author_id) AS a, "
        "COUNT(DISTINCT ticker) AS t FROM mentions WHERE ts >= ? AND ts < ?" + cl,
        [start, end, *chans],
    ).fetchone()
    return {"messages": r["m"], "members": r["a"], "tickers": r["t"]}


def coverage(now: int) -> str:
    t = buzz_store.latest_ts(_channels())
    if not t:
        return "no messages counted yet"
    d = _et(t)
    # ⛔ NOT strftime("%-I") -- that is glibc-only and raises on Windows, where
    # these tests also run. Build the 12-hour clock explicitly.
    hour = d.hour % 12 or 12
    return f"counted through {hour}:{d.minute:02d}{'a' if d.hour < 12 else 'p'}"
