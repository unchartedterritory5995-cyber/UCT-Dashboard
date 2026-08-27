"""Into-the-close index + ETF charts, posted to the community #TSDR channel.

Owner, 2026-08-27: *"Lets do scheduled posts in #TSDR channel of a look at the
Indexes into the close and post daily charts of QQQ SPY IWM DIA. Also do 4 ETFs
that are important like SMH IGV and whatever two you think from the day or week
are notable and important. Do those 15 minutes before market close."*

So: 15:45 ET on trading days, two messages - the four indexes, then four ETFs
(SMH and IGV, plus the two biggest movers of the session from a roster of liquid
sector and industry funds). The charts are the SAME house image `/chart` serves,
so a chart in the community channel and a chart a member asked for agree.

⛔ #TSDR IS THE PUBLIC COMMUNITY CHANNEL. Everything here fails CLOSED, three
ways, and each one on its own is enough to post nothing: the flag is off unless
deliberately armed, a blank webhook posts nowhere, and a non-trading day is
skipped. The failure direction is silence - never an unintended public post.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import pathlib
import tempfile

log = logging.getLogger(__name__)

_ET = _dt.timezone(_dt.timedelta(hours=-5))     # display only; the scheduler owns the real ET

# The four the owner named. Order is the order they appear in the message.
INDEXES = ("QQQ", "SPY", "IWM", "DIA")
# "4 ETFs that are important like SMH IGV" - these two are fixed; the other two
# are chosen from the session (see pick_notable).
CORE_ETFS = ("SMH", "IGV")
# The pool the two movers are drawn from: liquid, widely-watched, and each one
# says something about WHERE the money went - the eleven sector SPDRs plus the
# industry and macro funds a desk actually reads. Deliberately NOT the whole
# ETF universe: the answer has to be a fund a member recognises, not the day's
# most violent micro-cap thematic.
CANDIDATE_ETFS = (
    "XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
    "XBI", "IBB", "KRE", "ITB", "XRT", "XOP", "XME", "GDX", "JETS", "ARKK", "TAN",
    "TLT", "HYG", "GLD",
)
NOTABLE_N = 2
CHART_TF = "D"                      # "post daily charts"
# A mover has to actually have moved. Below this the "two notable ETFs" are just
# the two least-flat ones, which is a claim the post should not make.
MIN_NOTABLE_PCT = 0.75


def enabled() -> bool:
    """Armed? Default OFF: this posts to a PUBLIC channel on a timer, so it
    starts only when someone sets the variable on purpose. Turning it off again
    is an env change, not a deploy."""
    return os.environ.get("DISCORD_INDEX_CLOSE_ENABLED", "0").strip().lower() in ("1", "true", "on", "yes")


def webhook_url() -> str:
    """The community channel. Blank posts NOTHING - same contract as
    `desk_session_announce`: an unset webhook is silence, never a fallback to
    some other channel."""
    return os.environ.get("DISCORD_TSDR_WEBHOOK_URL", "").strip()


def _state_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("DATA_DIR", "/data")) / "discord_index_close.json"


def last_posted() -> str:
    try:
        return str(json.loads(_state_path().read_text(encoding="utf-8")).get("last_posted") or "")
    except Exception:  # noqa: BLE001
        return ""


def mark_posted(day: str) -> None:
    """Record the session we posted for. ⛔ Encode, write a temp file, then
    replace - `open(w)` truncates before a failing write can be caught, and a
    half-written marker reads as "never posted" and double-posts to a public
    channel."""
    p = _state_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        body = json.dumps({"last_posted": day})
        fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".idxclose", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(body)
            os.replace(tmp, p)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    except Exception as e:  # noqa: BLE001
        log.warning("[index-close] could not record the post marker: %s", e)


def is_trading_day(now_et: _dt.datetime | None = None) -> bool:
    """Weekday and not an NYSE full closure. Uses the SAME holiday table the
    bars layer uses - a second list would drift and post charts of a session
    that never happened."""
    now = now_et or _dt.datetime.now(_dt.timezone.utc).astimezone(_ET)
    if now.weekday() >= 5:
        return False
    try:
        from api.services.bars_fetch import _is_nyse_holiday
        return not _is_nyse_holiday(int(now.strftime("%Y%m%d")))
    except Exception as e:  # noqa: BLE001
        log.warning("[index-close] holiday check unavailable (%s); treating as a trading day", e)
        return True


def pick_notable(exclude=(), n: int = NOTABLE_N, snapshot_fn=None) -> list[tuple[str, float]]:
    """The session's biggest movers out of CANDIDATE_ETFS, largest absolute move
    first, as (symbol, pct). Never raises and never invents: no quotes, or
    nothing that actually moved, returns [] and the post simply carries fewer
    charts. ⭐ The move is returned WITH the symbol because the message names it
    - "why these two" is the whole justification for choosing them, and a pick
    presented without its number reads as arbitrary."""
    skip = {s.upper() for s in exclude}
    pool = [s for s in CANDIDATE_ETFS if s not in skip]
    if not pool:
        return []
    fn = snapshot_fn
    if fn is None:
        try:
            from api.services.massive import get_etf_snapshots
            fn = get_etf_snapshots
        except Exception as e:  # noqa: BLE001
            log.warning("[index-close] no quote source for the movers: %s", e)
            return []
    try:
        quotes = fn(pool) or {}
    except Exception as e:  # noqa: BLE001
        log.warning("[index-close] mover quotes failed: %s", e)
        return []
    moves = []
    for sym in pool:                         # iterate the roster, not the dict: stable order
        try:
            pct = float(quotes.get(sym))
        except (TypeError, ValueError):
            continue
        if pct == pct and abs(pct) >= MIN_NOTABLE_PCT:      # pct == pct rejects NaN
            moves.append((sym, pct))
    moves.sort(key=lambda sp: (-abs(sp[1]), sp[0]))
    return moves[:max(0, n)]


def render_charts(symbols, *, bars_fn, house_fn, stats_fn, name_fn, options=None) -> list[tuple[str, bytes, str]]:
    """(symbol, png, filename) for each symbol that rendered. A symbol that
    fails is DROPPED, not faked and not fatal - eight charts where one ticker's
    feed is late is still a good post, and a stand-in would put a chart in the
    community channel that does not match the one `/chart` serves."""
    out = []
    for sym in symbols:
        try:
            daily = bars_fn(sym, CHART_TF, 5000)
            if not daily:
                log.warning("[index-close] no bars for %s", sym)
                continue
            png = house_fn(sym, CHART_TF, stats_fn(daily), dict(options or {}))
            if not png:
                log.warning("[index-close] house render empty for %s", sym)
                continue
            out.append((sym, png, name_fn(sym, CHART_TF, daily[-1]["t"])))
        except Exception as e:  # noqa: BLE001
            log.warning("[index-close] %s failed: %s", sym, e)
    return out


def post_charts(url: str, content: str, charts, *, post_fn=None) -> bool:
    """One message: the text plus up to ten images. Returns whether it landed."""
    if not url or not charts:
        return False
    payload = {
        "username": "UCT Intelligence",
        "content": content[:1900],
        "allowed_mentions": {"parse": []},
        "attachments": [{"id": i, "filename": fn} for i, (_, _, fn) in enumerate(charts[:10])],
    }
    files = {f"files[{i}]": (fn, png, "image/png") for i, (_, png, fn) in enumerate(charts[:10])}
    try:
        if post_fn is not None:
            return bool(post_fn(url, payload, files))
        import requests
        r = requests.post(url, data={"payload_json": json.dumps(payload)}, files=files, timeout=60)
        if not r.ok:
            log.warning("[index-close] post failed HTTP %s: %s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("[index-close] post raised: %s", e)
        return False


def session_line(now_et: _dt.datetime) -> str:
    return now_et.strftime("%A, %B ") + str(now_et.day)


def build_messages(now_et: _dt.datetime, index_charts, etf_charts, notable) -> list[tuple[str, list]]:
    """The two messages, as (content, charts). Two rather than one: Discord
    shrinks every tile as the grid grows, and eight charts in a single message
    are a wall of thumbnails nobody can read. Four is a clean 2x2."""
    msgs = []
    if index_charts:
        msgs.append((f"**Into the close · {session_line(now_et)}**\n"
                     + " · ".join(sym for sym, _, _ in index_charts), index_charts))
    if etf_charts:
        line = "**ETFs into the close**\n" + " · ".join(sym for sym, _, _ in etf_charts)
        movers = [f"**{sym}** {pct:+.1f}%" for sym, pct in notable]
        if movers:
            line += "\nBiggest movers today: " + " · ".join(movers)
        msgs.append((line, etf_charts))
    return msgs


def run_close_post(*, bars_fn, house_fn, stats_fn, name_fn, options=None, now_et=None,
                   post_fn=None, force: bool = False, dry_run: bool = False) -> dict:
    """The 15:45 ET job. Returns a report dict - `posted` is what actually went
    out. Never raises: a scheduled public post that throws is a stack trace in a
    log nobody reads, so every failure is a reported reason instead."""
    now = now_et or _dt.datetime.now(_dt.timezone.utc).astimezone(_ET)
    day = now.strftime("%Y-%m-%d")
    report = {"day": day, "posted": 0, "dry_run": dry_run, "symbols": [], "notable": []}
    if not force and not enabled():
        report["skipped"] = "not enabled"
        return report
    if not force and not is_trading_day(now):
        report["skipped"] = "not a trading day"
        return report
    if not force and last_posted() == day:
        report["skipped"] = "already posted today"
        return report
    url = webhook_url()
    if not url and not dry_run:
        report["skipped"] = "no webhook configured"
        return report

    notable = pick_notable(exclude=list(INDEXES) + list(CORE_ETFS))
    etf_syms = list(CORE_ETFS) + [s for s, _ in notable]
    report["notable"] = [[s, round(p, 2)] for s, p in notable]

    index_charts = render_charts(INDEXES, bars_fn=bars_fn, house_fn=house_fn,
                                 stats_fn=stats_fn, name_fn=name_fn, options=options)
    etf_charts = render_charts(etf_syms, bars_fn=bars_fn, house_fn=house_fn,
                               stats_fn=stats_fn, name_fn=name_fn, options=options)
    report["symbols"] = [s for s, _, _ in index_charts] + [s for s, _, _ in etf_charts]
    messages = build_messages(now, index_charts, etf_charts, notable)
    report["messages"] = [c for c, _ in messages]
    if dry_run:
        report["bytes"] = [len(png) for _, png, _ in index_charts + etf_charts]
        return report
    for content, charts in messages:
        if post_charts(url, content, charts, post_fn=post_fn):
            report["posted"] += 1
    if report["posted"]:
        mark_posted(day)
    return report
