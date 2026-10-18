"""Archive calls -> the moment in a Desk session video where the team discussed that ticker.

So Ask AI and the setup pages can say "watch the explanation at 12:34" and link the exact second
(https://www.youtube.com/watch?v=ID&t=SECONDS).

INPUTS, both already in production, no external call:
  * edu_videos.ticker_moments  [{t: seconds, ticker}] written by desk_session_insights, plus the
    video's session date (media_started_at in ET, else the title's date, else its upload day) and,
    when known, its wall-clock start (media_started_at), which places every moment in time;
  * wisdom_archive_calls        (call_id, ticker, posted). `posted` is the ledger's CENTRAL time,
    'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM' (a 'T' separator and an explicit offset are accepted too).

THE RULE (candidate_dates is its one authority; match() and the estimate tool both use it):
  * a call links to a moment of the SAME ticker in a session held on the call's own posted day;
  * a call posted AFTER THE CLOSE (16:00 ET) links instead to the NEXT session, and to a same-day
    session only at a moment whose wall-clock time is at or after the post (an evening show) - a
    same-day moment with no known wall time cannot be proved to follow the post, so it is skipped;
  * a call posted on a day with no session at all (weekend, holiday, a day nothing was recorded)
    links to the next session too;
  * "next session" is the first session date after the posted day, and only within
    NEXT_SESSION_MAX_DAYS calendar days: a call never reaches past one session, and never back.
NO LOOKAHEAD: a link never points at a session dated before the call, and a link from any later
session (or an after-close same-day show) never points at a moment before the call was posted.

CONFIDENCE (0..1, label high >= 0.85, medium >= 0.65, else low): a same-day timed call scores by
how close the discussed moment is to the post (<= 30 min 0.95, <= 2 h 0.85, else 0.75; 0.7 when
the session has no wall-clock start); a same-day date-only call 0.6; a next-session link 0.6 from a
timed after-close post, 0.5 otherwise. When a ticker comes up several times in one video the link
keeps the moment closest to the post (the first eligible one when there is no clock), one link per
(call, video), at most MAX_LINKS_PER_CALL per call.

STORAGE: wisdom_archive_call_moments in wisdom.db (archive_010). Chosen over computing on read
because the join crosses two databases (education.db and wisdom.db) and the readers - Ask AI's
prompt build and the member archive routes - already hold a wisdom.db connection and need an
indexed lookup by call_id, not a scan of every session's moments per request. It is refreshed
after an insights pass that produced ticker moments (registered from THIS side on
desk_session_insights.on_moments_changed: that module must never import the archive) and after
each calls batch the archive import pushes (partial, for that batch's call ids). After the gate is
first armed, POST /api/internal/wisdom/archive/call-moments/refresh builds the table once.
⛔ Nothing here writes to education.db: the stored ticker moments feed public outputs
(YouTube descriptions, the public recap), and no archive data may ride into them (§0.4g).

THE GATE: WISDOM_CALL_MOMENTS_ENABLED AND WISDOM_ARCHIVE_ENABLED, read per call and FIRST. Off
means no refresh writes and no reader opens the table, so every payload and prompt is unchanged.
The readers are require_paid routes only (Ask AI, /api/wisdom/archive/*): the session videos are
member content and their links never reach a non-paid caller.
"""
from __future__ import annotations

import bisect
import datetime as dt
import json
import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

FLAG_ENV = "WISDOM_CALL_MOMENTS_ENABLED"
TABLE = "wisdom_archive_call_moments"
CENTRAL = ZoneInfo("America/Chicago")      # the ledger's `posted` clock
EASTERN = ZoneInfo("America/New_York")     # the session calendar and the close
CLOSE_ET = dt.time(16, 0)
NEXT_SESSION_MAX_DAYS = 4                  # Fri -> Tue over a holiday weekend, never further
MAX_LINKS_PER_CALL = 3
NEAR_S = 30 * 60
MID_S = 2 * 3600
HIGH, MEDIUM = 0.85, 0.65
SAME_DAY, SAME_DAY_AFTER_CLOSE, NEXT_SESSION = "same_day", "same_day_after_close", "next_session"
YOUTUBE_WATCH = "https://www.youtube.com/watch?v={yid}&t={t}"
_CHUNK = 400


def enabled() -> bool:
    """Both gates, archive first; reads only the environment."""
    return flags.archive_enabled() and flags.call_moments_enabled()


# ── parsing ──────────────────────────────────────────────────────────────────

def parse_posted(posted) -> tuple[Optional[dt.datetime], Optional[dt.date]]:
    """(aware datetime or None when only a date was given, the posted day in Central) or
    (None, None) when unreadable."""
    s = str(posted or "").strip()
    if len(s) < 10:
        return None, None
    try:
        day = dt.date.fromisoformat(s[:10])
    except ValueError:
        return None, None
    if len(s) == 10:
        return None, day
    try:
        when = dt.datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None, day
    when = when.replace(tzinfo=CENTRAL) if when.tzinfo is None else when
    return when, when.astimezone(CENTRAL).date()


def _parse_started(raw) -> Optional[dt.datetime]:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        when = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.replace(tzinfo=dt.timezone.utc) if when.tzinfo is None else when


def _ticker(raw) -> str:
    return str(raw or "").strip().lstrip("$").upper()


@dataclass(frozen=True)
class Session:
    video_id: int
    youtube_id: str
    session_date: dt.date
    started_at: Optional[dt.datetime]          # wall clock of t = 0, when known
    moments: tuple = field(default=())          # ((t_seconds, TICKER), ...)


def session_from_video(row: dict) -> Optional[Session]:
    """A Session from an edu_videos row, or None when it has no youtube id, no moments or no date."""
    from api.services.wisdom.archive.desk_links import session_date

    yid = str(row.get("youtube_id") or "").strip()
    raw = row.get("ticker_moments")
    try:
        items = json.loads(raw) if isinstance(raw, str) else (raw or [])
    except ValueError:
        items = []
    moments = []
    for m in items if isinstance(items, list) else []:
        if not isinstance(m, dict):
            continue
        tk = _ticker(m.get("ticker"))
        try:
            t = int(float(m.get("t")))
        except (TypeError, ValueError):
            continue
        if tk and t >= 0:
            moments.append((t, tk))
    if not yid or not moments:
        return None
    started = _parse_started(row.get("media_started_at"))
    day = started.astimezone(EASTERN).date() if started else session_date(row)[0]
    if day is None:
        return None
    return Session(int(row["id"]), yid, day, started, tuple(sorted(moments)))


def sessions_from_videos(rows: Iterable[dict]) -> list[Session]:
    return [s for s in (session_from_video(r) for r in rows or ()) if s is not None]


# ── the rule ─────────────────────────────────────────────────────────────────

def after_close(when: Optional[dt.datetime]) -> bool:
    return when is not None and when.astimezone(EASTERN).time() >= CLOSE_ET


def candidate_dates(when: Optional[dt.datetime], day: dt.date,
                    session_dates: list) -> list[tuple[dt.date, str]]:
    """[(session date, relation)] a call posted at `when` (None = date only) on `day` may link to.
    `session_dates` is SORTED and unique. The single authority for which sessions are eligible."""
    out: list = []
    has_same_day = _contains(session_dates, day)
    late = after_close(when)
    if has_same_day:
        out.append((day, SAME_DAY_AFTER_CLOSE if late else SAME_DAY))
    if late or not has_same_day:
        i = bisect.bisect_right(session_dates, day)
        if i < len(session_dates) and (session_dates[i] - day).days <= NEXT_SESSION_MAX_DAYS:
            out.append((session_dates[i], NEXT_SESSION))
    return out


def _contains(sorted_dates: list, d: dt.date) -> bool:
    i = bisect.bisect_left(sorted_dates, d)
    return i < len(sorted_dates) and sorted_dates[i] == d


def _proximity_score(delta_s: float) -> float:
    if delta_s <= NEAR_S:
        return 0.95
    if delta_s <= MID_S:
        return 0.85
    return 0.75


def label(confidence: float) -> str:
    return "high" if confidence >= HIGH else "medium" if confidence >= MEDIUM else "low"


@dataclass(frozen=True)
class Link:
    call_id: str
    video_id: int
    youtube_id: str
    t: int
    ticker: str
    session_date: str
    relation: str
    confidence: float


def _best_in_session(s: Session, tk: str, when: Optional[dt.datetime], relation: str):
    """(t, confidence) of the moment this call links to in one session, or None."""
    ts = [t for t, mt in s.moments if mt == tk]
    if not ts:
        return None
    if relation == NEXT_SESSION:
        return ts[0], (0.6 if when is not None else 0.5)
    if relation == SAME_DAY_AFTER_CLOSE:
        if s.started_at is None:
            return None                       # cannot prove the moment follows the post
        ok = [t for t in ts if s.started_at + dt.timedelta(seconds=t) >= when]
        if not ok:
            return None
        t = min(ok, key=lambda x: (s.started_at + dt.timedelta(seconds=x) - when).total_seconds())
        return t, _proximity_score((s.started_at + dt.timedelta(seconds=t) - when).total_seconds())
    if when is None:
        return ts[0], 0.6
    if s.started_at is None:
        return ts[0], 0.7
    t = min(ts, key=lambda x: abs((s.started_at + dt.timedelta(seconds=x) - when).total_seconds()))
    return t, _proximity_score(abs((s.started_at + dt.timedelta(seconds=t) - when).total_seconds()))


def match(calls: Iterable[dict], sessions: Iterable[Session]) -> list[Link]:
    """PURE. Every (call, session) link under the rule above, best first per call, capped.
    `calls` are dicts with call_id, ticker, posted."""
    by_date: dict = {}
    for s in sessions or ():
        by_date.setdefault(s.session_date, []).append(s)
    dates = sorted(by_date)
    out: list = []
    for c in calls or ():
        cid = str(c.get("call_id") or "")
        tk = _ticker(c.get("ticker"))
        when, day = parse_posted(c.get("posted"))
        if not cid or not tk or day is None:
            continue
        links = []
        for sday, relation in candidate_dates(when, day, dates):
            for s in by_date[sday]:
                got = _best_in_session(s, tk, when, relation)
                if got is not None:
                    links.append(Link(cid, s.video_id, s.youtube_id, int(got[0]), tk, sday.isoformat(),
                                      relation, round(got[1], 3)))
        links.sort(key=lambda lk: (-lk.confidence, lk.session_date, lk.t, lk.video_id))
        out.extend(links[:MAX_LINKS_PER_CALL])
    return out


# ── display ──────────────────────────────────────────────────────────────────

def at(t: int) -> str:
    t = max(0, int(t))
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def watch_url(youtube_id: str, t: int) -> str:
    return YOUTUBE_WATCH.format(yid=youtube_id, t=max(0, int(t)))


def _watch(row) -> dict:
    conf = float(row["confidence"])
    return {"video_id": row["video_id"], "youtube_id": row["youtube_id"], "t": row["t"], "at": at(row["t"]),
            "url": watch_url(row["youtube_id"], row["t"]), "session_date": row["session_date"],
            "relation": row["relation"], "confidence": conf, "confidence_label": label(conf),
            "label": f"watch at {at(row['t'])}"}


# ── storage ──────────────────────────────────────────────────────────────────

def _chunks(items: list):
    for i in range(0, len(items), _CHUNK):
        yield items[i:i + _CHUNK]


def refresh(conn: sqlite3.Connection, sessions: list, *, call_ids: Optional[Iterable[str]] = None) -> dict:
    """Rewrite the stored links inside the caller's wisdom.db WRITE transaction. Full when
    `call_ids` is None (every row replaced), else only those calls' rows."""
    tickers = sorted({tk for s in sessions for _, tk in s.moments})
    calls: list = []
    if call_ids is None:
        for part in _chunks(tickers):
            calls += [dict(r) for r in conn.execute(
                "SELECT call_id, ticker, posted FROM wisdom_archive_calls "
                f"WHERE ticker IN ({','.join('?' * len(part))})", part)]
        conn.execute(f"DELETE FROM {TABLE}")
    else:
        ids = sorted({str(c) for c in call_ids if c})
        for part in _chunks(ids):
            marks = ",".join("?" * len(part))
            calls += [dict(r) for r in conn.execute(
                f"SELECT call_id, ticker, posted FROM wisdom_archive_calls WHERE call_id IN ({marks})", part)]
            conn.execute(f"DELETE FROM {TABLE} WHERE call_id IN ({marks})", part)
    links = match(calls, sessions)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    conn.executemany(
        f"INSERT OR REPLACE INTO {TABLE} (call_id, video_id, youtube_id, t, ticker, session_date, relation, "
        "confidence, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(lk.call_id, lk.video_id, lk.youtube_id, lk.t, lk.ticker, lk.session_date, lk.relation,
          lk.confidence, now) for lk in links])
    return {"sessions": len(sessions), "calls_considered": len(calls), "links": len(links),
            "calls_linked": len({lk.call_id for lk in links}), "full": call_ids is None}


def load_sessions() -> list[Session]:
    from api.services import education_service

    return sessions_from_videos(education_service.session_moment_rows())


def refresh_all() -> Optional[dict]:
    """Full refresh from education.db into wisdom.db, or None when gated off. Raises on a store
    error (callers that must never fail wrap it)."""
    if not enabled():
        return None
    from api.services.wisdom.core import store

    sessions = load_sessions()
    with store.write() as conn:
        return refresh(conn, sessions)


def refresh_calls(call_ids: Iterable[str]) -> Optional[dict]:
    """Partial refresh for the given calls (an import batch), or None when gated off."""
    if not enabled():
        return None
    ids = [c for c in call_ids or () if c]
    if not ids:
        return None
    from api.services.wisdom.core import store

    sessions = load_sessions()
    with store.write() as conn:
        return refresh(conn, sessions, call_ids=ids)


def lookup(conn, call_ids: Iterable[str]) -> dict:
    """{call_id: [watch, ...]} best first; {} when the table is not there yet. Callers gate first."""
    ids = sorted({str(c) for c in call_ids or () if c})
    out: dict = {}
    if not ids:
        return out
    try:
        for part in _chunks(ids):
            for r in conn.execute(
                    f"SELECT call_id, video_id, youtube_id, t, session_date, relation, confidence FROM {TABLE} "
                    f"WHERE call_id IN ({','.join('?' * len(part))}) "
                    "ORDER BY confidence DESC, session_date ASC, t ASC, video_id ASC", part):
                row = {k: r[i] for i, k in enumerate(
                    ("call_id", "video_id", "youtube_id", "t", "session_date", "relation", "confidence"))}
                out.setdefault(row["call_id"], []).append(_watch(row))
    except sqlite3.OperationalError:
        return {}
    return out


def lookup_by_record(conn, record_ids: Iterable[str]) -> dict:
    """{(record_id, TICKER, posted): [watch, ...]} for the calls of these records. Ask AI's
    retrieval hits carry a call's ticker and posted time but not its id, and are left unchanged
    on purpose (Compass reads them too), so its lines are keyed this way. {} when absent."""
    ids = sorted({str(r) for r in record_ids or () if r})
    out: dict = {}
    if not ids:
        return out
    try:
        for part in _chunks(ids):
            marks = ",".join("?" * len(part))
            pairs = {r[0]: (r[1], _ticker(r[2]), r[3]) for r in conn.execute(
                f"SELECT call_id, record_id, ticker, posted FROM wisdom_archive_calls WHERE record_id IN ({marks})",
                part)}
            for cid, watches in lookup(conn, list(pairs)).items():
                out[pairs[cid]] = watches
    except sqlite3.OperationalError:
        return {}
    return out


#: The sentence Ask AI's archive blocks gain, once, when at least one line carries a link.
WATCH_NOTE = (" A call marked 'watch m:ss <url>' was also discussed in the team's live Desk session; when you "
              "cite that call, give the member the time and the link so they can watch the explanation.")


def watch_text(watches: list) -> str:
    """' watch m:ss <url>' for the best link of a call, '' when there is none."""
    if not watches:
        return ""
    w = watches[0]
    return f" watch {w['at']} {w['url']}"


#: Payload keys whose rows are calls (each with a call_id) across the member archive routes.
CALL_KEYS = ("calls", "best", "worst", "winners", "failures")


def attach(payload: dict) -> dict:
    """Adds `watch` [{url, at, ...}] to every call row in a member payload that has a session
    moment. Unchanged when gated off (no store opened). Never raises."""
    if not isinstance(payload, dict) or not enabled():
        return payload
    rows = [r for k in CALL_KEYS for r in (payload.get(k) or []) if isinstance(r, dict) and r.get("call_id")]
    if not rows:
        return payload
    try:
        from api.services.wisdom.core import store

        with store.read(for_request=True) as conn:
            found = lookup(conn, [r["call_id"] for r in rows])
    except Exception:  # noqa: BLE001 - decoration only
        log.exception("[wisdom] call moments lookup failed; payload served without them")
        return payload
    for r in rows:
        if r["call_id"] in found:
            r["watch"] = found[r["call_id"]]
    return payload


# ── the insights-pass hook ───────────────────────────────────────────────────

def refresh_after_insights() -> Optional[dict]:
    """Run by desk_session_insights after a pass that wrote ticker moments (registered below,
    since that module must never import the archive). None when gated off."""
    return refresh_all()


def _register() -> None:
    try:
        from api.services import desk_session_insights

        desk_session_insights.on_moments_changed(refresh_after_insights)
    except Exception:  # noqa: BLE001 - the links are derived; the refresh route rebuilds them
        log.exception("[wisdom] could not register the call-moments refresh on the insights pass")


_register()
