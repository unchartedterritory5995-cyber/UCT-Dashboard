"""TERM-049 (FB-A13-01) — the per-ticker history join, first slice: one ticker, one timeline.

FB-A13-01: *"One ticker, one timeline: what the wire said, what the setup did, what the book did,
what flow did, what the member said — each row keyed by entity and carrying its own
provenance."* Its acceptance line: *"If a lane cannot be cited, it does not render."*

THIS SLICE joins the lanes the web process can read and cite today, each row carrying its own
`source` (the store), `as_of` (the row's own date) and `ref` (the record key a reader can follow):

  * ``wire``      — the Morning Wire archive (`wire_archive`): a dated rundown that NAMES the
                    ticker. The row cites the archived issue by date; it states presence, not a
                    paraphrase.
  * ``book``      — the UCT 20 ledger (`uct20_nav`'s compositions): the dates the ticker ENTERED
                    and LEFT the published list, derived from consecutive compositions.
  * ``catalysts`` — the catalyst store: each market date the ticker made the list, with rank,
                    tag and the thesis as stored.
  * ``room``      — the ticker-mention store (`/buzz`): mentions per ET day, as COUNTS ONLY.
                    ⛔ Owner ruling 2026-09-29 (OI-15): never message text, never who said it.

NOT IN THIS SLICE, and why (the spec's own rule — a lane that cannot be cited does not render):
  * ``flow`` — the tape lives on flow-worker; this process cannot read it, only proxy it.
  * the setup/lift ledger and the member's own journal — no per-ticker citable read yet.
  * entity ids — rows are keyed by ticker (TERM-023's entity master is dark); the ticker is kept
    as the row key and every row says so.

⛔ NO COMPOSITE. Lanes are never blended into a score (FB-A13-01's PROD-C5/C6 warning): each lane
is a list of dated facts from one store.

Dark behind ``TICKER_HISTORY_ENABLED`` (read per call; unset = off).
"""
from __future__ import annotations

import contextlib
import logging
import os
import re
import sqlite3
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
ET = ZoneInfo("America/New_York")
ENABLED_ENV = "TICKER_HISTORY_ENABLED"
DEFAULT_DAYS = 90
MAX_DAYS = 365
LANES = ("wire", "book", "catalysts", "room")


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


def _norm(sym: str) -> str:
    return (sym or "").strip().upper()


def _since(days: int) -> date:
    return datetime.now(ET).date() - timedelta(days=days)


def _mention_regex(sym: str) -> re.Pattern:
    # A whole-word ticker, optionally cashtagged; never inside another word or ticker.
    return re.compile(r"(?<![A-Za-z0-9.$-])\$?" + re.escape(sym) + r"(?![A-Za-z0-9])")


# ── lanes ────────────────────────────────────────────────────────────────────

def wire_lane(sym: str, since: date) -> list[dict]:
    from api.services import wire_archive

    pat = _mention_regex(sym)
    rows = []
    for ymd in wire_archive.held_dates():
        try:
            d = date.fromisoformat(wire_archive.parse_date(ymd))
        except (ValueError, TypeError):
            continue
        if d < since:
            continue
        entry = wire_archive.read(ymd)
        if not entry:
            continue
        text = re.sub(r"<[^>]+>", " ", entry.get("rundown_html") or "")
        hits = len(pat.findall(text))
        if hits:
            rows.append({"date": d.isoformat(), "lane": "wire", "mentions": hits,
                         "text": f"Named in the Morning Wire ({hits} mention{'s' if hits != 1 else ''})",
                         "source": "wire_archive", "as_of": d.isoformat(),
                         "ref": f"/morning-wire?date={d.isoformat()}"})
    return rows


def book_lane(sym: str, since: date) -> list[dict]:
    from api.services import uct20_nav

    comps = sorted((c for c in uct20_nav._load_compositions() if c.get("date")),
                   key=lambda c: c["date"])
    rows, held = [], False
    for c in comps:
        now = sym in {_norm(h) for h in (c.get("holdings") or [])}
        if now != held:
            d = c["date"]
            if d >= since.isoformat():
                rows.append({"date": d, "lane": "book",
                             "event": "entered" if now else "left",
                             "text": "Entered the UCT 20" if now else "Left the UCT 20",
                             "source": "uct20_compositions", "as_of": d,
                             "ref": f"uct20_compositions#{d}"})
            held = now
    return rows


def catalysts_lane(sym: str, since: date) -> list[dict]:
    from api.services.catalyst import store

    rows = []
    try:
        with contextlib.closing(store._connect()) as c:
            c.row_factory = sqlite3.Row
            for r in c.execute(
                    "SELECT market_date, rank, tag, thesis_text FROM catalysts "
                    "WHERE ticker = ? AND market_date >= ? ORDER BY market_date",
                    (sym, since.isoformat())):
                rows.append({"date": r["market_date"], "lane": "catalysts",
                             "rank": r["rank"], "tag": r["tag"],
                             "text": (r["thesis_text"] or "").strip() or f"On the catalyst list ({r['tag'] or 'untagged'})",
                             "source": "catalysts", "as_of": r["market_date"],
                             "ref": f"/catalysts/history?date={r['market_date']}"})
    except sqlite3.Error as e:
        logger.warning("[ticker-history] catalysts lane unreadable: %s", e)
        raise
    return rows


def room_lane(sym: str, since: date) -> list[dict]:
    """COUNTS ONLY (owner ruling 2026-09-29): mentions per ET day. No text, no authors."""
    from api.services import buzz_store

    start = int(datetime.combine(since, datetime.min.time(), tzinfo=ET).timestamp())
    per_day: dict[str, int] = {}
    # buzz_store.connect() is the PROCESS-WIDE shared connection (the ingest poller, /buzz
    # and the scheduled boards all use it). Never close it: closing it here took every
    # buzz read and write on the pod down after the first History request (2026-09-29).
    c = buzz_store.connect()
    for (ts,) in c.execute("SELECT ts FROM mentions WHERE ticker = ? AND ts >= ?", (sym, start)):
        d = datetime.fromtimestamp(int(ts), ET).date().isoformat()
        per_day[d] = per_day.get(d, 0) + 1
    return [{"date": d, "lane": "room", "mentions": n,
             "text": f"Mentioned {n} time{'s' if n != 1 else ''} in the community room",
             "source": "buzz_mentions", "as_of": d, "ref": f"buzz_mentions#{sym}@{d}"}
            for d, n in sorted(per_day.items())]


_LANE_FNS = {"wire": wire_lane, "book": book_lane, "catalysts": catalysts_lane, "room": room_lane}


# ── Coverage: the first date each lane's STORE holds, whatever the ticker ──────────
# A lane that answers "0 rows" over a window its store does not reach is not saying
# "nothing happened" -- it is saying "we were not recording". The Morning Wire archive
# began 2026-09-28, so "0 wire mentions in 90 days" read as "never named" for every
# ticker until this was added. None = the store holds nothing yet.

def _wire_covers_from() -> Optional[str]:
    from api.services import wire_archive
    held = wire_archive.held_dates()
    return held[0] if held else None


def _book_covers_from() -> Optional[str]:
    from api.services import uct20_nav
    dates = sorted(c["date"] for c in uct20_nav._load_compositions() if c.get("date"))
    return dates[0] if dates else None


def _catalysts_covers_from() -> Optional[str]:
    from api.services.catalyst import store
    with contextlib.closing(store._connect()) as c:
        row = c.execute("SELECT MIN(market_date) FROM catalysts").fetchone()
    return row[0] if row and row[0] else None


def _room_covers_from() -> Optional[str]:
    from api.services import buzz_store
    row = buzz_store.connect().execute("SELECT MIN(ts) FROM mentions").fetchone()  # shared: never close
    return datetime.fromtimestamp(int(row[0]), ET).date().isoformat() if row and row[0] else None


_COVERAGE_FNS = {"wire": _wire_covers_from, "book": _book_covers_from,
                 "catalysts": _catalysts_covers_from, "room": _room_covers_from}


def history(sym: str, days: int = DEFAULT_DAYS) -> dict:
    """`{ticker, since, lanes: {lane: {status, rows}}, timeline: [...]}`, newest first.

    A lane that errors reports `status: "unavailable"` and contributes no rows — never an
    empty list presented as "nothing happened"."""
    sym = _norm(sym)
    days = max(1, min(int(days or DEFAULT_DAYS), MAX_DAYS))
    since = _since(days)
    lanes, timeline = {}, []
    for name in LANES:
        try:
            rows = _LANE_FNS[name](sym, since)
            covers_from = _COVERAGE_FNS[name]()
            lanes[name] = {"status": "ok", "count": len(rows), "covers_from": covers_from,
                           # True when the store starts AFTER the window opens: rows
                           # before `covers_from` were never recorded, not absent.
                           "partial": covers_from is None or covers_from > since.isoformat()}
            timeline.extend(rows)
        except Exception as e:  # noqa: BLE001 — one lane's store must not sink the others
            logger.warning("[ticker-history] %s lane failed for %s: %s", name, sym, e)
            lanes[name] = {"status": "unavailable", "count": None}
    timeline.sort(key=lambda r: (r["date"], LANES.index(r["lane"])), reverse=True)
    return {"ticker": sym, "key": "ticker", "since": since.isoformat(), "days": days,
            "lanes": lanes, "not_rendered": {"flow": "served by flow-worker; not citable from web yet"},
            "timeline": timeline}
