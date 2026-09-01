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
import threading
import time

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
# "4 ETFs that are important" - the owner asked for four and noticed the day one
# was missing. A core ETF that will not render is topped up from the next movers
# down the same ranked pool, so the message is four charts even when a ticker's
# feed is cold. The substitute is a REAL mover, named in the header like the
# others; it is never a filler chart.
TARGET_ETFS = 4
ETF_TOPUP_MAX = 3
# ⭐ PASSES, NOT PER-SYMBOL RETRIES. The failure this exists for is a COLD POD,
# where every symbol is failing for the same reason at the same moment: bars not
# yet warm. Retrying one symbol twice in 6 s re-asks the same cold cache; retrying
# the whole failed SET after a pause gives the seeder time to land, and the
# symbols that already succeeded warmed the page in the meantime. 2026-08-31: IGV
# returned no bars twice inside 6 s and was dropped, while JETS - which failed the
# same way - happened to succeed on its second look 23 s later.
RENDER_PASSES = 3
RENDER_RETRY_PAUSE_S = 20.0
# ⛔ NEVER RENDER ON A COLD POD. On 2026-08-31 a deploy created at 19:38:52 UTC
# finished booting at 19:42:59 and the 15:45 ET cron fired at 19:45:00 - 121 s of
# uptime, with the bars seeder, the ticker-name prewarm and the every-minute chart
# hot-warm all still fighting for the single pod. Three charts posted with no
# candles and a fourth never rendered. The owner's own manual recipe for this job
# has always been "wait for uptime > 180 s, dry-run, then post while warm"; it
# lived in scratchpad/fire.sh and was never railed into the scheduled path, which
# is the whole reason the scheduled path could do this. 300 s is that floor with
# room for the startup warms observed that day (they ran to ~90 s past boot).
# The wait needs no separate ceiling: uptime is never
# negative, so it can never exceed this value, and 5 minutes of the 15 before the
# close still posts "into the close". A second constant capping it would be a
# bound that can never bind - reassurance, not a guard.
WARM_MIN_UPTIME_S = 300.0
CHART_TF = "D"                      # "post daily charts"
# A mover has to actually have moved. Below this the "two notable ETFs" are just
# the two least-flat ones, which is a claim the post should not make.
MIN_NOTABLE_PCT = 0.75


# ⛔ ONE RUN AT A TIME, ACROSS EVERY CALLER. The 15:45 job, the 15:58 retry and
# the manual trigger all land here, and the marker that stops a double-post is only
# written AFTER a post succeeds - so two runs that overlap both read "not posted
# yet" and both post to a PUBLIC channel. The window is real and wide: the warm
# gate can hold a run for 5 minutes before it renders anything. A lock in the
# service is the one place that covers all three callers; a guard in the router
# would protect the manual path only, which is the path least likely to race.
_RUN_LOCK = threading.Lock()


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


def uptime_seconds() -> float | None:
    """Seconds since this process booted, or None if it cannot be established.

    Reads `api.main._APP_BOOT_TS` - the SAME clock `/api/health` reports uptime
    from, so "the pod is warm" means one thing here and in the health artifact.
    None is UNKNOWN and never blocks the post: a missing clock must not be able
    to silence a scheduled public message."""
    try:
        from api.main import _APP_BOOT_TS
        return max(0.0, time.time() - float(_APP_BOOT_TS))
    except Exception as e:  # noqa: BLE001
        log.warning("[index-close] uptime unavailable (%s); not waiting", e)
        return None


def wait_until_warm(sleep_fn=None, uptime_fn=None) -> float:
    """Block until the pod has been up WARM_MIN_UPTIME_S. Returns seconds waited.

    An unknown uptime waits NOTHING: a clock we cannot read must not be able to
    silence a scheduled public post."""
    sleep = sleep_fn or time.sleep
    up = (uptime_fn or uptime_seconds)()
    if up is None or up >= WARM_MIN_UPTIME_S:
        return 0.0
    wait = WARM_MIN_UPTIME_S - up
    log.info("[index-close] pod is %.0fs old; waiting %.0fs for it to warm before rendering", up, wait)
    sleep(wait)
    return wait


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


def bar_session(t) -> str | None:
    """The trading date a daily bar belongs to, YYYY-MM-DD, or None.

    Uses `discord_chart_render.to_datetime` - the ONE parser for a bar time in
    this family (it already handles "YYYY-MM-DD", YYYYMMDD, unix s and unix ms,
    and treats a unix DAILY time as a UTC date key). A second copy here would
    drift, and the thing it would drift on is which DAY a chart is about."""
    try:
        from api.services.discord_chart_render import to_datetime
        return to_datetime(t, "D").strftime("%Y-%m-%d")
    except Exception as e:  # noqa: BLE001
        log.warning("[index-close] unreadable bar time %r: %s", t, e)
        return None


def render_charts(symbols, *, bars_fn, house_fn, stats_fn, name_fn, options=None,
                  sleep_fn=None, session_date=None) -> list[tuple[str, bytes, str]]:
    """(symbol, png, filename) for each symbol that rendered, in the ORDER ASKED.

    The whole failed SET is retried together after a pause (see RENDER_PASSES). A
    symbol that still fails is DROPPED, not faked and not fatal - seven charts
    where one ticker's feed is late is still a good post, and a stand-in would
    put a chart in the community channel that does not match the one `/chart`
    serves.

    ⛔ `session_date` (YYYY-MM-DD) REFUSES A CHART FROM ANOTHER SESSION. The
    stats strip is computed from the last two daily bars with no notion of when
    they are; one session of lag turns it into a confident, internally
    consistent description of the wrong day, printed under a headline naming
    today. On 2026-08-31 SMH went out reading Day -3.5% (Friday) beside an AI
    read that correctly called it up on the Monday. A missing chart is a gap
    anyone can see; a chart captioned with the wrong day's numbers is not."""
    sleep = sleep_fn or time.sleep
    got = {}
    pending = list(symbols)
    for attempt in range(1, RENDER_PASSES + 1):
        if attempt > 1:
            # Escalating: a cold seeder needs longer the second time it has
            # already disappointed us.
            sleep(RENDER_RETRY_PAUSE_S * (attempt - 1))
        still = []
        for sym in pending:
            try:
                daily = bars_fn(sym, CHART_TF, 5000)
                if not daily:
                    log.warning("[index-close] no bars for %s (pass %d)", sym, attempt)
                    still.append(sym)
                    continue
                if session_date:
                    newest = bar_session(daily[-1].get("t"))
                    if newest != session_date:
                        log.warning("[index-close] STALE bars for %s: newest daily bar is %s, "
                                    "posting for %s (pass %d)", sym, newest, session_date, attempt)
                        still.append(sym)
                        continue
                png = house_fn(sym, CHART_TF, stats_fn(daily), dict(options or {}))
                if not png:
                    log.warning("[index-close] house render empty for %s (pass %d)", sym, attempt)
                    still.append(sym)
                    continue
                got[sym] = (sym, png, name_fn(sym, CHART_TF, daily[-1]["t"]))
            except Exception as e:  # noqa: BLE001
                log.warning("[index-close] %s failed (pass %d): %s", sym, attempt, e)
                still.append(sym)
        pending = still
        if not pending:
            break
    if pending:
        log.warning("[index-close] gave up on %s after %d passes", ", ".join(pending), RENDER_PASSES)
    return [got[s] for s in symbols if s in got]        # caller's order, not completion order


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


def build_messages(now_et: _dt.datetime, index_charts, etf_charts, notable, note: str = "") -> list[tuple[str, list]]:
    """The two messages, as (content, charts). Two rather than one: Discord
    shrinks every tile as the grid grows, and eight charts in a single message
    are a wall of thumbnails nobody can read. Four is a clean 2x2.

    `note` is the written read (see `discord_close_note`). It leads the first
    message because it is the part a member reads; an empty note simply leaves
    the post as charts, which is what it was before."""
    msgs = []
    if index_charts:
        head = f"**Into the close · {session_line(now_et)}**\n" + " · ".join(sym for sym, _, _ in index_charts)
        if note:
            head += "\n\n" + note
        msgs.append((head, index_charts))
    if etf_charts:
        line = "**ETFs into the close**\n" + " · ".join(sym for sym, _, _ in etf_charts)
        movers = [f"**{sym}** {pct:+.1f}%" for sym, pct in notable]
        if movers:
            line += "\nBiggest movers today: " + " · ".join(movers)
        msgs.append((line, etf_charts))
    return msgs


def session_moves(shown=(), notable=(), snapshot_fn=None) -> dict:
    """Percent change for the symbols ACTUALLY ON THE POST, as one dict. The
    movers already carry their number from `pick_notable`, so only the rest is
    quoted - one snapshot call, not two."""
    known = {s: p for s, p in (notable or ())}
    want = [s for s in shown if s not in known]
    fn = snapshot_fn
    if fn is None:
        try:
            from api.services.massive import get_etf_snapshots
            fn = get_etf_snapshots
        except Exception:  # noqa: BLE001
            return dict(known)
    try:
        quotes = fn(want) or {}
    except Exception as e:  # noqa: BLE001
        log.warning("[index-close] session quotes failed: %s", e)
        quotes = {}
    out = {}
    for sym in shown:
        v = known.get(sym, quotes.get(sym))
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if f == f:                       # not NaN
            out[sym] = f
    return out


def write_note(shown=(), notable=(), note_fn=None, snapshot_fn=None) -> str:
    """The written read for the symbols on the post, or "" - a note that cannot
    be written well is simply left out. Never raises: the charts are the
    product. `shown` is what RENDERED, never what was asked for."""
    try:
        moves = session_moves(shown, notable, snapshot_fn=snapshot_fn)
        if not moves:
            return ""
        if note_fn is not None:
            return note_fn(moves) or ""
        from api.services import discord_close_note as note_mod
        return note_mod.compose(moves) or ""
    except Exception as e:  # noqa: BLE001
        log.warning("[index-close] note failed: %s", e)
        return ""


def run_close_post(*, bars_fn, house_fn, stats_fn, name_fn, options=None, now_et=None,
                   post_fn=None, note_fn=None, sleep_fn=None, force: bool = False,
                   dry_run: bool = False) -> dict:
    """The 15:45 ET job. Returns a report dict - `posted` is what actually went
    out. Never raises: a scheduled public post that throws is a stack trace in a
    log nobody reads, so every failure is a reported reason instead."""
    now = now_et or _dt.datetime.now(_dt.timezone.utc).astimezone(_ET)
    day = now.strftime("%Y-%m-%d")
    report = {"day": day, "posted": 0, "dry_run": dry_run, "symbols": [], "notable": []}
    if not _RUN_LOCK.acquire(blocking=False):
        report["skipped"] = "a run is already in flight"
        return report
    try:
        return _run_close_post_locked(report, now, day, bars_fn=bars_fn, house_fn=house_fn,
                                      stats_fn=stats_fn, name_fn=name_fn, options=options,
                                      post_fn=post_fn, note_fn=note_fn, sleep_fn=sleep_fn,
                                      force=force, dry_run=dry_run)
    finally:
        _RUN_LOCK.release()


def _run_close_post_locked(report, now, day, *, bars_fn, house_fn, stats_fn, name_fn, options,
                           post_fn, note_fn, sleep_fn, force, dry_run) -> dict:
    """The body of `run_close_post`, holding `_RUN_LOCK`. Split out so the lock is
    released on EVERY path, including the early skips."""
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

    # ⛔ Warm FIRST, before a single render. Everything below judges charts; this
    # is the one step that stops us judging charts nobody should have asked for yet.
    report["warm_waited_s"] = round(wait_until_warm(sleep_fn=sleep_fn), 1)

    # One ranked pool, deeper than we name: the top NOTABLE_N are the movers the
    # header calls out, the rest stand by in case a core ETF cannot render.
    pool = pick_notable(exclude=list(INDEXES) + list(CORE_ETFS), n=NOTABLE_N + ETF_TOPUP_MAX)
    notable = pool[:NOTABLE_N]
    etf_syms = list(CORE_ETFS) + [s for s, _ in notable]

    render = dict(bars_fn=bars_fn, house_fn=house_fn, stats_fn=stats_fn,
                  name_fn=name_fn, options=options, sleep_fn=sleep_fn,
                  # ⛔ Scheduled path only. On the 15:45 cron we KNOW it is a
                  # trading day and that today's bar should exist, so a bar from
                  # another session is a defect. `force` is the owner firing by
                  # hand - after the window, on a weekend, whenever - where
                  # "today" is not the session the bars should be from and
                  # refusing would just make the override useless. force has
                  # always meant "post anyway"; it keeps meaning that.
                  session_date=None if force else day)
    index_charts = render_charts(INDEXES, **render)
    etf_charts = render_charts(etf_syms, **render)
    # Top up to four. Each reserve is drawn from the SAME ranked pool, so a
    # substitute is the next most notable fund of the session - and because the
    # header and the note both read the filtered `shown` list, it is named like
    # any other mover rather than appearing unexplained.
    for sym, _ in pool[NOTABLE_N:]:
        if len(etf_charts) >= TARGET_ETFS:
            break
        etf_charts += render_charts([sym], **render)
    if len(etf_charts) < TARGET_ETFS:
        log.warning("[index-close] only %d of %d ETF charts rendered", len(etf_charts), TARGET_ETFS)
    if len(index_charts) < len(INDEXES):
        log.warning("[index-close] only %d of %d index charts rendered", len(index_charts), len(INDEXES))
    report["short"] = {"indexes": len(INDEXES) - len(index_charts),
                       "etfs": max(0, TARGET_ETFS - len(etf_charts))}
    shown = [s for s, _, _ in index_charts] + [s for s, _, _ in etf_charts]
    report["symbols"] = shown
    # ⭐ THE NOTE IS WRITTEN AFTER THE CHARTS, ABOUT THE CHARTS. Composing it
    # from the roster we INTENDED produced a post whose prose discussed QQQ, IWM
    # and XME while none of the three had a chart in the message (2026-08-27 dry
    # run, on a pod seconds out of a deploy). Prose describing something the
    # member cannot see reads as broken, and it is the kind of wrong nobody
    # notices until it is public.
    # ONE filtered list, used by both the note and the header: a mover named in
    # the text with no chart beside it is the same defect in a different place.
    # The POOL, not the two we first named: a topped-up substitute is a mover that
    # is on the post, and a chart on the post with its move unstated is the same
    # defect as a move stated with no chart beside it.
    posted_movers = [sp for sp in pool if sp[0] in shown]
    report["notable"] = [[sym, round(pct, 2)] for sym, pct in posted_movers]
    note = write_note(shown, posted_movers, note_fn=note_fn)
    report["note"] = note
    messages = build_messages(now, index_charts, etf_charts, posted_movers, note)
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
