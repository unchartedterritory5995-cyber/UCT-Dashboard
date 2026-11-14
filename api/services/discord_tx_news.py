"""`/news TICKER` — that stock's TradeXchange headlines, styled as UCT News.

Since 2026-10-28 the TradeXchange NewsDesk webhook posts its raw "TICKER(S) - headline"
lines into the private #tx-intake channel; the tx-recap worker turns them into the UCT
News image cards in #📡丨uct-news (the old #tradexchange). `/news` reads the RAW lines
in #tx-intake, not the cards: they are complete and searchable, the cards are
summaries. Discord is the store: this module reads the
channel with the bot token (already on web for the buzz poll), keeps a small
in-process cache of the last WINDOW_MAX_DAYS, and filters by ticker prefix.

⛔ #uct-news is a PAID channel (Exclusive VIP Access). The reply is
ephemeral and the handler checks the member's roles, so the command cannot
become a free side door into the feed.

Never raises out of `run_news_job`: the member is watching a deferred
"thinking…" that only this job can resolve.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import re
import threading
import time
from zoneinfo import ZoneInfo

from api.services import tx_headline_match as match

log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
DISCORD_API = "https://discord.com/api/v10"
DISCORD_EPOCH_MS = 1420070400000

NEWS_COMMAND = "news"
DEFAULT_CHANNEL_ID = "1564853978615775252"          # Uncharted Territory #tx-intake (raw TX lines)
#: Roles whose members can read #uct-news: Exclusive VIP Access, ADMIN, Contributor.
DEFAULT_ROLE_IDS = frozenset({"1001324657804325046", "1000761575910674432", "1112808703389872188"})
ADMINISTRATOR_BIT = 0x8
#: The recap worker's own posts in the channel (tx-recap repo); never news.
SKIP_AUTHORS = frozenset({"TradeXchange Recap", "TradeXchange Daily Wrap", "UCT News", "UCT News Recap",
                          "UCT News Daily Wrap"})

WINDOWS = {"today": "Today", "3d": "Last 3 days", "1w": "Last week"}
WINDOW_MAX_DAYS = 7
EMBED_LIMIT = 4000
GOLD = 0xDCBB5E          # UCT gold: the UCT News cards and recaps use the same
#: The UCT mark, served by the dashboard as a real PNG (the /UCT_logo_*.png paths return the SPA's HTML).
MARK_URL = "https://uctintelligence.com/live-trading-room/mark-256.png"
NOT_VIP_MESSAGE = "`/news` reads UCT News (the TradeXchange feed), which is part of Exclusive VIP Access."

_TICKER = re.compile(r"^[A-Z][A-Z0-9.]{0,6}$")


def channel_id() -> str:
    return (os.environ.get("TX_NEWS_CHANNEL_ID") or DEFAULT_CHANNEL_ID).strip()


def allowed_roles() -> frozenset:
    ids = {x.strip() for x in (os.environ.get("TX_NEWS_ROLE_IDS") or "").split(",") if x.strip()}
    return frozenset(ids) if ids else DEFAULT_ROLE_IDS


def member_allowed(interaction: dict) -> bool:
    """A role that can see #uct-news, or a server administrator."""
    member = interaction.get("member") or {}
    try:
        if int(str(member.get("permissions") or "0")) & ADMINISTRATOR_BIT:
            return True
    except ValueError:
        pass
    return bool(set(map(str, member.get("roles") or [])) & allowed_roles())


def build_news_command() -> dict:
    return {
        "name": NEWS_COMMAND, "type": 1,
        "description": "TradeXchange headlines for one stock (VIP)",
        "options": [
            {"name": "ticker", "type": 3, "required": True, "autocomplete": True,
             "description": "Ticker, e.g. NVDA"},
            {"name": "window", "type": 3, "required": False, "description": "How far back (default today)",
             "choices": [{"name": label, "value": value} for value, label in WINDOWS.items()]},
        ],
    }


def clean_ticker_option(raw) -> str | None:
    """The /news command's one `ticker` option: upper-case, a leading $ dropped, or None.

    Not a resolver: the member typed ONE symbol into a slash-command field, so there is no text to
    find tickers in. ⛔ It keeps the DOT form on purpose (BRK.B), unlike
    ticker_resolver.route_symbol's hyphen: TX writes class shares with a dot in its own headline
    tags, and headlines_for matches this value against that text."""
    # A hyphen is the dashboard's spelling of the same class share (BRK-B): the picker reads
    # the dashboard's symbol list, so its own suggestion has to be accepted here.
    t = str(raw or "").strip().upper().lstrip("$").replace("-", ".")
    return t if _TICKER.match(t) else None


def ticker_choices(q: str, limit: int = 10) -> list[dict]:
    """/news's own picker: stocks only, each value in the form the command accepts.

    ⚰️ It used /chart's helper until 2026-11-13, which offers breadth chart series (not
    stocks), labels a miss "X - chart it", and hands back the dashboard's BRK-B. Never
    raises: no choices is a valid answer."""
    out, seen = [], set()
    try:
        from api.routers import ticker_search as ts
        rows = (ts.ticker_search(q=str(q or "").lstrip("$"), limit=limit, type="") or {}).get("results") or []
    except Exception as e:  # noqa: BLE001 - the picker is a convenience
        log.debug("[news] ticker search failed for the picker: %s", e)
        rows = []
    for row in rows:
        t = clean_ticker_option(row.get("ticker"))
        if not t or t in seen:
            continue
        seen.add(t)
        name = row.get("name")
        out.append({"name": (f"{t} - {name}" if name else t)[:100], "value": t})
    typed = clean_ticker_option(q)
    if not out and typed:
        # The symbol list is a suggestion list, not a gate: TX covers names it does not hold.
        out.append({"name": typed, "value": typed})
    return out


def _previous_close(now: dt.datetime) -> dt.datetime:
    """The close of the session BEFORE the one `now`'s news belongs to. The news day turns
    over at 4:00 AM ET; a weekend or a holiday belongs to the last session that traded."""
    from api.services import session_calendar as sc
    day = now.date() if now.hour >= 4 else now.date() - dt.timedelta(days=1)
    for _ in range(10):
        if sc.is_trading_day(day):
            break
        day -= dt.timedelta(days=1)
    prev = day - dt.timedelta(days=1)
    for _ in range(10):
        if sc.is_trading_day(prev):
            break
        prev -= dt.timedelta(days=1)
    close = sc.close_time(prev)          # 1:00 PM on a half-day
    if close is None:
        raise ValueError(f"no close for {prev}")
    return close.astimezone(ET)


def window_start(window: str, now: dt.datetime) -> dt.datetime:
    """`today` = since the previous session's close, so a morning reader gets last night's
    after-hours news and a weekend reader gets Friday's.

    ⚰️ It was "since 4:00 AM ET" until 2026-11-13, which hid exactly those. Falls back to
    that rule if the session calendar cannot answer."""
    now = now.astimezone(ET)
    if window == "3d":
        return now - dt.timedelta(days=3)
    if window == "1w":
        return now - dt.timedelta(days=WINDOW_MAX_DAYS)
    try:
        return _previous_close(now)
    except Exception as e:  # noqa: BLE001 - a calendar fault must not take /news down
        log.warning("[news] session calendar unavailable, using the 4 AM window: %s", e)
    start = now.replace(hour=4, minute=0, second=0, microsecond=0)
    return start if now >= start else start - dt.timedelta(days=1)


def window_label(window: str, now: dt.datetime) -> str:
    """What the reply calls its window. The default one is named by where it STARTS
    ("Since Mon 4:00 PM ET"): it reaches back to the previous close, so the picker's word
    "Today" would be wrong every morning and all weekend."""
    if window in ("3d", "1w"):
        return WINDOWS[window]
    s = window_start("today", now)
    return f"Since {s:%a} {s.hour % 12 or 12}:{s.minute:02d} {'AM' if s.hour < 12 else 'PM'} ET"


def snowflake(ts: dt.datetime) -> int:
    return (int(ts.timestamp() * 1000) - DISCORD_EPOCH_MS) << 22


def _clean(text: str) -> str:
    text = text.replace("&amp;", "&").replace("\xa0", " ").replace("�", "'")
    return re.sub(r"\s+", " ", text).strip()


# ── the channel cache ────────────────────────────────────────────────────────

class _Cache:
    """Feed items keyed by message id, covering [cover_start, newest]. One lock:
    two members asking at once fetch once."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items: dict[int, tuple[dt.datetime, str]] = {}
        self.cover_start: dt.datetime | None = None


_cache = _Cache()


def _reset_for_tests() -> None:
    global _cache
    _cache = _Cache()


def _get_page(client, after: int) -> list[dict]:
    """One page of messages after `after`, honouring a 429's retry_after."""
    url = f"{DISCORD_API}/channels/{channel_id()}/messages"
    for _ in range(4):
        r = client.get(url, params={"limit": 100, "after": str(after)})
        if r.status_code == 429:
            time.sleep(min(float((r.json() or {}).get("retry_after") or 1.0), 5.0))
            continue
        r.raise_for_status()
        return r.json() or []
    raise RuntimeError("discord rate limit")


def _fetch_range(client, after: int, stop_before: int | None) -> dict[int, tuple[dt.datetime, str]]:
    """Every feed message with id > after (and < stop_before when given)."""
    out: dict[int, tuple[dt.datetime, str]] = {}
    while True:
        batch = sorted(_get_page(client, after), key=lambda m: int(m["id"]))
        if not batch:
            return out
        for m in batch:
            mid = int(m["id"])
            if stop_before is not None and mid >= stop_before:
                return out
            text = (m.get("content") or "").strip()
            if text and (m.get("author") or {}).get("username") not in SKIP_AUTHORS:
                out[mid] = (dt.datetime.fromisoformat(m["timestamp"]), _clean(text))
        after = int(batch[-1]["id"])
        if len(batch) < 100:
            return out


def _make_client():
    import httpx
    token = (os.environ.get("DISCORD_BOT_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("DISCORD_BOT_TOKEN is not set")
    return httpx.Client(timeout=15.0, headers={"Authorization": f"Bot {token}",
                                               "User-Agent": "DiscordBot (uctintelligence.com, 1)"})


def feed_since(start: dt.datetime, *, client=None) -> list[tuple[dt.datetime, str]]:
    """Feed items since `start`, oldest first. Backfills older history once, then only
    asks Discord for what arrived after the newest cached message."""
    own = client is None
    c = client or _make_client()
    try:
        with _cache.lock:
            if _cache.cover_start is None or start < _cache.cover_start:
                oldest = min(_cache.items) if _cache.items else None
                _cache.items.update(_fetch_range(c, snowflake(start), oldest))
                _cache.cover_start = start
            # ⛔ With nothing cached, resume from where the cache CLAIMS to start, not from
            # this request's own start: a later start would skip whatever arrived in
            # between while cover_start went on saying it was covered.
            newest = max(_cache.items) if _cache.items else snowflake(_cache.cover_start)
            _cache.items.update(_fetch_range(c, newest, None))
            floor = snowflake(dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=WINDOW_MAX_DAYS + 1))
            for mid in [k for k in _cache.items if k < floor]:
                del _cache.items[mid]
            if _cache.cover_start < dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=WINDOW_MAX_DAYS + 1):
                _cache.cover_start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=WINDOW_MAX_DAYS + 1)
            lo = snowflake(start)
            return [v for k, v in sorted(_cache.items.items()) if k >= lo]
    finally:
        if own:
            c.close()


# ── the reply ────────────────────────────────────────────────────────────────

def company_name(ticker: str) -> str | None:
    """The dashboard's own name for `ticker` (ticker search over cap_universe + the meta
    cache), so "ROBINHOOD TO INTEGRATE…" is found for HOOD. None when unknown."""
    try:
        from api.routers import ticker_search as ts
        for row in (ts.ticker_search(q=ticker, limit=5, type="") or {}).get("results") or []:
            if str(row.get("ticker") or "").upper() == ticker and row.get("name"):
                return row["name"]
        # Not in the search cache yet: the same meta path the search backfills from.
        from api.services import ticker_meta
        return ticker_meta._base_meta(ticker).get("name") or None
    except Exception as e:  # noqa: BLE001 - a name only widens the match
        log.debug("[news] name lookup failed %s: %s", ticker, e)
    return None


# TX's own tag, read when the shared matcher declines the ticker: "ADP ADP - ..." (ADP is a macro
# word to tx_headline_match) and the glued earnings wire "ADPreported Q1 ..." / "ADPEarnings Release".
_TX_TAG = re.compile(r"^((?:[A-Z0-9.]{1,7} ){0,5}[A-Z0-9.]{1,7}) - (.+)$")


def _tx_tagged(text: str, ticker: str) -> str | None:
    """The headline body when TX itself tagged `ticker`, else None."""
    m = _TX_TAG.match(text)
    if m and ticker in m.group(1).split():
        return m.group(2)
    g = re.match(rf"^{re.escape(ticker)}(reported\b|Earnings Release|Q[1-4]\b)(.*)$", text)
    if g:
        rest = (g.group(1) + g.group(2)).lstrip(" :")
        return rest[:1].upper() + rest[1:]
    return None


def headlines_for(ticker: str, items, name: str | None = None) -> list[tuple[dt.datetime, str]]:
    """(ts, line) newest first, for every headline about `ticker` however TX wrote it
    (tx_headline_match: its tag, $AMD, "AMDpartners", "STX EPS of…", the company name).
    A line TX tagged with only this ticker drops the tag; other tagged tickers are kept
    so the member sees who else it is about; anything else is shown as written."""
    out = []
    for ts, text in items:
        if not match.mentions(text, ticker, name):
            own = _tx_tagged(text, ticker)
            if own:
                out.append((ts, own))
            continue
        p = match.parse(text)
        if ticker in p.prefix:
            others = [t for t in p.prefix if t != ticker]
            line = f"{p.body} ({', '.join(others)})" if others else p.body
        else:
            line = text
        out.append((ts, line))
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def _clock(ts: dt.datetime) -> str:
    t = ts.astimezone(ET)
    return t.strftime("%I:%M").lstrip("0") + ("a" if t.hour < 12 else "p")


def build_embed(ticker: str, window: str, rows, now: dt.datetime, *, known: bool = True) -> dict:
    """`known` = the dashboard has a company for this symbol. It only changes the EMPTY
    reply: a typo and a quiet stock must not read the same."""
    label = window_label(window, now)
    if not rows:
        default = window not in ("3d", "1w")
        desc = (f"No UCT News headlines on **${ticker}** {label[0].lower()}{label[1:]}." if default
                else f"No UCT News headlines on **${ticker}** ({label.lower()}).")
        if not known:
            desc += " I could not find a company for that symbol, so check the spelling."
        elif default:
            desc += f" Try `window: {WINDOWS['3d']}` for older ones."
    else:
        lines, day, used, shown = [], None, 0, 0
        multi_day = len({r[0].astimezone(ET).date() for r in rows}) > 1
        for ts, line in rows:
            d = ts.astimezone(ET).date()
            block = []
            if multi_day and d != day:
                block.append(f"**{ts.astimezone(ET).strftime('%a %b')} {d.day}**")
                day = d
            block.append(f"`{_clock(ts):>6}` {line}")
            text = "\n".join(block)
            if used + len(text) + 60 > EMBED_LIMIT:
                break
            lines.append(text)
            used += len(text) + 1
            shown += 1
        if shown < len(rows):
            lines.append(f"*+{len(rows) - shown} older headline(s) not shown*")
        desc = "\n".join(lines)
    n = len(rows)
    # Same brand as the UCT News cards: the UCT mark + "UCT INTELLIGENCE · NEWS" header, UCT gold.
    return {
        "author": {"name": "UCT INTELLIGENCE · NEWS", "icon_url": MARK_URL},
        "title": f"${ticker} · UCT News · {label}",
        "description": desc,
        "color": GOLD,
        "footer": {"text": f"{n} headline{'s' if n != 1 else ''} · times ET · source TradeXchange · uctintelligence.com",
                   "icon_url": MARK_URL},
        "timestamp": now.astimezone(dt.timezone.utc).isoformat(),
    }


def _edit(app_id: str, token: str, payload: dict, client=None) -> bool:
    import httpx
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original"
    try:
        c = client or httpx.Client(timeout=15.0)
        try:
            r = c.patch(url, json=payload)
        finally:
            if client is None:
                c.close()
        if not r.is_success:
            log.warning("[news] edit_original HTTP %s %s", r.status_code, r.text[:300])
        return r.is_success
    except Exception as e:  # noqa: BLE001
        log.warning("[news] edit_original failed: %s", e)
        return False


def run_news_job(app_id: str, token: str, ticker: str, window: str, *,
                 feed_fn=None, edit_fn=None, name_fn=None, now: dt.datetime | None = None) -> None:
    """Background half of `/news`: read the feed, filter, edit the deferred reply."""
    edit = edit_fn or _edit
    now = now or dt.datetime.now(dt.timezone.utc)
    try:
        items = (feed_fn or feed_since)(window_start(window, now))
        name = (name_fn or company_name)(ticker)
        embed = build_embed(ticker, window, headlines_for(ticker, items, name), now, known=bool(name))
        edit(app_id, token, {"content": "", "embeds": [embed]})
    except Exception as e:  # noqa: BLE001 — a background job must never raise
        log.warning("[news] %s failed: %s", ticker, e)
        edit(app_id, token, {"content": "Could not read UCT News right now. Try again in a minute."})
