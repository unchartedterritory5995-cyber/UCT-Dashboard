"""MD-1 kind `catalysts.board` (Phase 2 market-data intelligence, owner: agent-md).

UCT's CATALYST BOARD for the Agent: the stocks UCT's catalyst engine flagged on a market date (the Morning Wire
catalyst table / Catalysts History page), each with its catalyst type, tag, grade, opening gap, whether it is new or
continuing, when the catalyst news first appeared, the engine's own write-up and the stored headlines the engine
recorded beside it. Answers "what's moving the market today", "why is NVDA up" (only when NVDA is on the board),
"any catalysts for my watchlist this week", "what hit semis" (by the board's own stored sector).

READ-ONLY, SIDE-EFFECT-FREE. It never calls `catalyst.store._connect` (whose `PRAGMA journal_mode=WAL` writes the
header) or `_init_db` (which creates the file and every table), never `engine.run_refresh` (the route's self-heal,
a provider + model spend) and never a provider: it opens the catalyst database READ-ONLY (sqlite `mode=ro`) at the
store's own path. `provider_calls` is always 0. Two different empty answers, never confused:
  * ABSENT     — no database file or no `catalysts` table: status ok, `state: "absent"`, no rows (nothing stored here);
  * UNREADABLE — the file exists but SQLite would not open / read it read-only: status unavailable.
There is no lock-ignoring fallback (`immutable=1` / `nolock=1` could read a file mid-write).

DATA RULES.
  * Rows are the board's DISPLAYED rows only (`rank IS NOT NULL`, as /api/catalysts/today and by-date serve them).
  * Headlines are quoted only as stored (`raw_signals.rss[].title`, with its own source and publish time). Items whose
    source is an AI search answer (the engine's Perplexity context) are NOT headlines and are never returned; tweets
    are counted, never quoted. Rows older than 7 days have had their headline text redacted by the store's own sweep:
    they say so (`headlines_redacted`), nothing is reconstructed.
  * `writeup` is the catalyst engine's AI-generated summary, verbatim (clipped), with its generation time and status.
    It is the ENGINE's account, never established causation; the browser labels it so.
  * Per row `as_of` = when the catalyst news first appeared (`catalyst_at`), else when the row was last refreshed.
    The envelope `as_of` = the newest board's last refresh (the honest "updated" moment, as the tile shows).
  * freshness: `periodic` (the engine refreshes the board on a schedule) for today's board; `historical` for a past
    date. `stale` when the newest board served is today's and its last refresh is older than STALE_AFTER_S during the
    engine's weekday window, or when today's board was asked for on a trading day after the open and is not stored.

MODEL-ISOLATED (ADR-005): headlines are third-party text and the grade / write-up are UCT-derived AI output; neither
may reach a model (the model could turn a co-occurring headline into a stated cause). The browser capability that
reads it (news.movers) is local-only (turn.LOCAL_ONLY_ACTIONS).
"""
from __future__ import annotations

import contextlib
import json
import os
import pathlib
import re
import sqlite3
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "catalysts.board"
SOURCE = "uct-catalyst-engine"
_ET = ZoneInfo("America/New_York")

MAX_SYMBOLS = 50
MAX_DAYS = 5
DEFAULT_LIMIT = 10
MAX_LIMIT = 25
MAX_HEADLINES = 3
WRITEUP_MAX = 400
HEADLINE_MAX = 300
#: the Morning Wire tile flags its board "stale" after 2 hours; the same threshold here
STALE_AFTER_S = 2 * 3600
#: the engine's weekday refresh window (catalysts router `_self_heal_due`: 6 AM - 8 PM ET)
WINDOW_START_H, WINDOW_END_H = 6, 20
#: today's board is EXPECTED once the session has opened (the premarket refresh runs well before)
EXPECT_TODAY_AFTER = dtime(9, 30)

ABSENT = "absent"
UNREADABLE = "unreadable"
_AI_SOURCE = re.compile(r"perplexity", re.I)
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTE_ABSENT = "UCT's catalyst board is not stored on this server (no catalyst database), so there is nothing to report"
NOTE_UNREADABLE = "UCT's catalyst database could not be read"
NOTE_NO_BOARD = "no catalyst board is stored for {d} or the {n} days before it"
NOTE_TODAY_MISSING = "today's catalyst board ({d}) is not stored yet; the newest stored board is {latest}"
NOTE_STALE = "the board was last refreshed over 2 hours ago, so newer catalysts may be missing"
NOTE_COOCCUR = ("headlines are the ones UCT's catalyst engine recorded beside each move; they co-occur with it and "
                "do not establish its cause")
NOTE_WRITEUP = "each writeup is the catalyst engine's AI-generated summary at its generation time, not verified"
NOTE_ROW_ASOF = "each row's as_of is when its catalyst news first appeared (else its last refresh)"


class BoardUnavailable(Exception):
    def __init__(self, state: str):
        super().__init__(state)
        self.state = state


def now_et() -> datetime:
    return datetime.now(_ET)


def db_path() -> str:
    """The catalyst store's own path (its module constant), read without importing anything that writes."""
    from api.services.catalyst import store
    return store._DB_PATH


# ── validation (pure) ──────────────────────────────────────────────────────────────────────────────────────────────
def _symbols(params: dict) -> Optional[list]:
    raw = params.get("symbols")
    if raw is None:
        return []
    if not isinstance(raw, list):
        return None
    out = []
    for s in raw:
        t = str(s or "").strip().upper().lstrip("$")
        if not _SYMBOL_RE.match(t):
            return None
        if t not in out:
            out.append(t)
    return out


def _int(params: dict, key: str, default: int) -> Any:
    v = params.get(key, default)
    if v is None:
        return default
    if not isinstance(v, int) or isinstance(v, bool):
        return None
    return v


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    syms = _symbols(params)
    if syms is None:
        return "`symbols` must be a list of ticker symbols"
    if len(syms) > MAX_SYMBOLS:
        return f"at most {MAX_SYMBOLS} symbols per read"
    d = params.get("date")
    if d is not None:
        if not isinstance(d, str) or not _DATE_RE.match(d):
            return "`date` must be YYYY-MM-DD"
        try:
            date.fromisoformat(d)
        except ValueError:
            return "`date` must be a real calendar date"
    days = _int(params, "days", 1)
    if days is None or not 1 <= days <= MAX_DAYS:
        return f"`days` must be a whole number from 1 to {MAX_DAYS}"
    limit = _int(params, "limit", DEFAULT_LIMIT)
    if limit is None or not 1 <= limit <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    sector = params.get("sector")
    if sector is not None and (not isinstance(sector, str) or not sector.strip() or len(sector) > 60):
        return "`sector` must be a short sector name"
    return None


# ── the read-only store peek ───────────────────────────────────────────────────────────────────────────────────────
def _ro_query(path: str, fn):
    """Run fn(conn) on a READ-ONLY connection; raises BoardUnavailable(ABSENT | UNREADABLE)."""
    if not path or not os.path.isfile(path):
        raise BoardUnavailable(ABSENT)
    try:
        uri = pathlib.Path(path).resolve().as_uri() + "?mode=ro"
        with contextlib.closing(sqlite3.connect(uri, uri=True, timeout=5.0)) as c:
            c.row_factory = sqlite3.Row
            if c.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalysts'").fetchone() is None:
                raise BoardUnavailable(ABSENT)
            return fn(c)
    except sqlite3.Error:
        raise BoardUnavailable(UNREADABLE) from None


def _board(c, end: str, days: int) -> tuple[list[str], dict[str, list[dict]]]:
    dates = [r["market_date"] for r in c.execute(
        "SELECT DISTINCT market_date FROM catalysts WHERE rank IS NOT NULL AND market_date <= ? "
        "ORDER BY market_date DESC LIMIT ?", (end, days)).fetchall()]
    rows: dict[str, list[dict]] = {}
    for d in dates:
        rows[d] = [dict(r) for r in c.execute(
            "SELECT * FROM catalysts WHERE market_date = ? AND rank IS NOT NULL ORDER BY rank ASC", (d,)).fetchall()]
    return dates, rows


# ── shaping (pure) ─────────────────────────────────────────────────────────────────────────────────────────────────
def _iso(ts: Any) -> Optional[str]:
    if isinstance(ts, bool) or not isinstance(ts, (int, float)) or ts <= 0:
        return None
    try:
        return env.utc_iso(datetime.fromtimestamp(float(ts), tz=timezone.utc))
    except (OverflowError, OSError, ValueError):
        return None


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return None
    return float(v)


def _clip(s: Any, n: int) -> Optional[str]:
    t = re.sub(r"\s+", " ", str(s or "")).strip()
    if not t:
        return None
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def _domain(u: Any) -> Optional[str]:
    try:
        host = urlparse(str(u or "")).hostname or ""
    except ValueError:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else (host or None)


def _signals(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        v = json.loads(raw) if isinstance(raw, str) and raw else {}
    except (TypeError, ValueError):
        return {}
    return v if isinstance(v, dict) else {}


def _headlines(sig: dict) -> tuple[list[dict], int, bool]:
    """(headlines as stored, newest first; how many stored items were headlines; whether text was redacted)."""
    out, count, redacted = [], 0, False
    for r in sig.get("rss") or []:
        if not isinstance(r, dict):
            continue
        src = str(r.get("source") or "").strip()
        if _AI_SOURCE.search(src):
            continue                                          # an AI search answer, never a headline
        count += 1
        title = _clip(r.get("title"), HEADLINE_MAX)
        if not title:
            redacted = redacted or "title" not in r
            continue
        out.append({"title": title, "source": src or None, "url": str(r.get("url") or "") or None,
                    "published_at": _iso(r.get("time_published"))})
    out.sort(key=lambda h: h["published_at"] or "", reverse=True)
    return out[:MAX_HEADLINES], count, redacted


def shape_row(r: dict) -> dict:
    """One stored catalyst row -> the Agent's fields (pure; exported for tests)."""
    sig = _signals(r.get("raw_signals"))
    heads, n_heads, redacted = _headlines(sig)
    try:
        srcs = json.loads(r.get("thesis_sources") or "[]")
    except (TypeError, ValueError):
        srcs = []
    domains = []
    for u in srcs if isinstance(srcs, list) else []:
        d = _domain(u)
        if d and d not in domains:
            domains.append(d)
    writeup = r.get("thesis_text")
    if isinstance(writeup, str) and re.match(r"^\s*Synthesis (temporarily unavailable|returned malformed output|paused)\b",
                                             writeup, re.I):
        writeup = None                                        # the engine's own failure sentence (store._LEGACY_FAILURE)
    catalyst_at = _iso(r.get("catalyst_at"))
    refreshed_at = _iso(r.get("refreshed_at"))
    return {
        "symbol": str(r.get("ticker") or "").upper(), "market_date": r.get("market_date"), "rank": r.get("rank"),
        "catalyst_type": r.get("catalyst_type") or None, "tag": r.get("tag") or None, "grade": r.get("grade") or None,
        "gap_pct": _num(r.get("gap_pct")), "sector": r.get("sector") or None,
        "is_new": bool(r.get("is_new")), "pre_move": bool(r.get("pre_move")),
        "catalyst_at": catalyst_at, "refreshed_at": refreshed_at, "as_of": catalyst_at or refreshed_at,
        "writeup": _clip(writeup, WRITEUP_MAX), "writeup_at": _iso(r.get("thesis_at")),
        "writeup_status": r.get("thesis_status") or None, "writeup_sources": domains[:5],
        "headlines": heads, "headline_count": n_heads, "headlines_redacted": redacted and not heads,
        "social_posts": len([t for t in (sig.get("tweets") or []) if isinstance(t, dict)]),
    }


def _alt(sym: str) -> str:
    return sym.replace("-", ".") if "-" in sym else sym.replace(".", "-")


def read_catalysts_board(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    now = now_et()
    today = now.date().isoformat()
    asked_date = params.get("date")
    end = asked_date or today
    days = _int(params, "days", 1)
    limit = _int(params, "limit", DEFAULT_LIMIT)
    syms = _symbols(params)
    sector = (params.get("sector") or "").strip() or None

    try:
        dates, by_date = _ro_query(db_path(), lambda c: _board(c, end, days))
    except BoardUnavailable as e:
        if e.state == UNREADABLE:
            return env.unavailable(KIND, params, SOURCE, NOTE_UNREADABLE)
        data = {"state": ABSENT, "requested_date": end, "dates": [], "rows": [], "not_on_board": syms,
                "sectors": [], "sector": sector, "boards": []}
        return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=None, source=SOURCE,
                                 data=data, notes=[NOTE_ABSENT], provider_calls=0)

    notes: list[str] = []
    boards, rows, sectors = [], [], set()
    wanted = set(syms) | {_alt(s) for s in syms}
    found: set[str] = set()
    for d in dates:
        shaped = [shape_row(r) for r in by_date.get(d) or []]
        refreshed = max((r["refreshed_at"] for r in shaped if r["refreshed_at"]), default=None)
        boards.append({"market_date": d, "flagged": len(shaped), "refreshed_at": refreshed})
        for r in shaped:
            if r["sector"]:
                sectors.add(r["sector"])
        keep = shaped
        if sector:
            keep = [r for r in keep if (r["sector"] or "").strip().lower() == sector.lower()]
        if syms:
            keep = [r for r in keep if r["symbol"] in wanted]
            found |= {r["symbol"] for r in keep} | {_alt(r["symbol"]) for r in keep}
        else:
            keep = keep[:limit]
        rows.extend(keep)

    newest = dates[0] if dates else None
    asked_today = end == today
    today_missing = asked_today and newest != today
    stale = False
    if newest is None:
        notes.append(NOTE_NO_BOARD.format(d=end, n=days - 1))
    elif today_missing:
        notes.append(NOTE_TODAY_MISSING.format(d=today, latest=newest))
    trading_today = _trading_day(now.date())
    in_window = trading_today and WINDOW_START_H <= now.hour < WINDOW_END_H
    if newest == today and in_window:
        last = boards[0]["refreshed_at"]
        age = (now.astimezone(timezone.utc) - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds() if last else None
        if age is None or age > STALE_AFTER_S:
            stale = True
            notes.append(NOTE_STALE)
    if today_missing and trading_today and now.time() >= EXPECT_TODAY_AFTER:
        stale = True
    if rows:
        notes += [NOTE_COOCCUR, NOTE_WRITEUP, NOTE_ROW_ASOF]
    as_of = boards[0]["refreshed_at"] if boards else None
    if as_of is None:
        notes.append("the board carries no refresh time")
    freshness = "periodic" if newest == today else "historical"
    data = {
        "state": "ok", "requested_date": end, "requested_missing": bool(newest != end), "today": today,
        "dates": dates, "boards": boards, "rows": rows, "sector": sector, "sectors": sorted(sectors),
        "not_on_board": [s for s in syms if s not in found],
    }
    cov = {"requested": len(syms), "answered": len(syms) - len(data["not_on_board"])} if syms else None
    return env.make_envelope(KIND, params, status="ok", freshness=freshness, as_of=as_of, source=SOURCE, data=data,
                             stale=stale, coverage=cov, notes=notes, provider_calls=0)


def _trading_day(d: date) -> bool:
    try:
        from api.services import session_calendar
        return session_calendar.is_trading_day(d)
    except Exception:  # noqa: BLE001 — an unknown calendar falls back to weekdays
        return d.weekday() < 5
