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

SLICE 2 (2026-10-01) adds two lanes and the rename join:

  * ``flow``      — the options-flow tape (`flow.db`, owned by flow-worker since the P5
                    cutover; web reads it over the same internal hop the Discord /flow card
                    uses). COUNTS ONLY: prints per session for the ticker, plus a link to the
                    Options Flow page. ⛔ No premium, side, strike or expiry ever leaves this
                    module -- it asks the tape for ONE column (`CreatedDate`) and receives
                    nothing else. The route is paid-gated by the same predicate the flow page's
                    AuthGuard uses (admin | paid plan | trial), so the lane shows nobody a fact
                    the flow page would not; counts-plus-link keeps it from becoming a second,
                    unmetered copy of the tape.
  * ``setups``    — the engine's setup ledger (`setup_triggers` in `uct_intelligence.db`,
                    installed nightly on the pod by the Brain Pack). One row on the date a setup
                    was PUBLISHED for the ticker, and one on the date its outcome was RECORDED
                    (win / loss / never triggered / unresolved / voided, with the R multiple
                    as stored). ⛔ Never `quality_*`: that is a composite score.
  * entity ids   — when the Entity Master's member path is armed
                    (`ENTITY_MASTER_MEMBER_ENABLED`), the ticker is resolved to its entity and
                    every lane is read once per dated alias, inside that alias's own window, so
                    FB's rows join META's and a reused ticker never inherits its previous owner's
                    history. Every row then says which symbol it was recorded under. Dark or
                    unresolved, the key stays the bare ticker and the response says why.

⛔ ``flow`` and ``setups`` are DARK behind their own gate, ``TICKER_HISTORY_LANES2_ENABLED``
(see ``LANES2``): the parent flag is armed in production, and showing members the firm's setup
win/loss record is an owner call, not a merge side effect.

TAIL (2026-10-01) adds the member's own lane, behind the same LANES2 gate:

  * ``journal``   — the CALLER's own Journal 2.0 trades in this ticker: the day a trade was
                    OPENED (closed trades and still-open positions) and the day it was CLOSED
                    (result and R as stored). ⛔ STRICTLY OWNER-SCOPED: read only through the
                    journal_two service functions keyed on the caller's id
                    (``trades.list_trades_for_user`` / ``positions.list_open_positions``), never
                    raw SQL, and never for anyone but the requesting member. No member id, no
                    lane (``unavailable``) -- it never falls back to anybody's journal.
                    ``covers_from`` is the member's first journalled trade, any ticker.

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
LANES = ("wire", "book", "catalysts", "room", "flow", "setups", "journal")
#: One read of one ticker's CreatedDate column off the tape. A liquid name is hundreds of
#: thousands of prints; one narrow column keeps it to a few MB. Past this the lane is
#: `unavailable` -- a timeout is not a quiet tape.
FLOW_TIMEOUT_S = 12.0


#: The slice-2 lanes ride their OWN gate. `TICKER_HISTORY_ENABLED` is armed in production, so
#: without this a merge would put the firm's setup win/loss record and a per-ticker tape count
#: in front of members with no decision taken. Unset, those two lanes are not read at all (no
#: tape request, the engine DB never opened) and are named in `not_rendered` with the reason.
LANES2 = ("flow", "setups", "journal")
LANES2_ENV = "TICKER_HISTORY_LANES2_ENABLED"


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


def lanes2_enabled() -> bool:
    """Read PER CALL; unset = off."""
    return os.environ.get(LANES2_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


def _norm(sym: str) -> str:
    return (sym or "").strip().upper()


def _since(days: int) -> date:
    return datetime.now(ET).date() - timedelta(days=days)


def _mention_regex(sym: str) -> re.Pattern:
    # A whole-word ticker, optionally cashtagged; never inside another word or ticker.
    return re.compile(r"(?<![A-Za-z0-9.$-])\$?" + re.escape(sym) + r"(?![A-Za-z0-9])")


# R20: a bare-word match is only safe for a ticker that cannot be an ordinary
# word. AI, A, IT, NOW and ON matched every "AI capex", "it", "now" and "on" in
# the Wire. For those the wire must NAME it: a `$` cashtag, or the wire's own
# ticker markup (an element whose class is an `rd-...-sym` cell).
_SHORT_TICKER_LEN = 2
_WIRE_SYM_CELL = re.compile(
    r"<(?P<tag>[a-z0-9]+)\b[^>]*\bclass=\"[^\"]*\brd-[a-z0-9-]*sym\b[^\"]*\"[^>]*>(?P<body>.*?)</(?P=tag)>",
    re.IGNORECASE | re.DOTALL)


def _is_ambiguous(sym: str) -> bool:
    """True for a ticker that reads as an ordinary word: two letters or fewer,
    or in the buzz board's DERIVED chat-word set (symbols that are also chat
    vocabulary). Never raises: an unreadable set falls back to length alone."""
    if len(sym) <= _SHORT_TICKER_LEN:
        return True
    try:
        from api.services import buzz_universe
        return sym in buzz_universe.ambiguous()
    except Exception:  # noqa: BLE001
        return False


def _wire_mentions(sym: str, rundown_html: str) -> int:
    """How many times the Wire names `sym`. For an ambiguous ticker only a
    cashtag or a ticker-markup cell counts; otherwise a whole-word match."""
    if not _is_ambiguous(sym):
        text = re.sub(r"<[^>]+>", " ", rundown_html)
        return len(_mention_regex(sym).findall(text))
    cells = 0
    for m in _WIRE_SYM_CELL.finditer(rundown_html):
        body = re.sub(r"<[^>]+>", " ", m.group("body")).strip().lstrip("$").upper()
        if body == sym:
            cells += 1
    text = re.sub(r"<[^>]+>", " ", _WIRE_SYM_CELL.sub(" ", rundown_html))
    cashtags = len(re.findall(r"(?<![A-Za-z0-9.$-])\$" + re.escape(sym) + r"(?![A-Za-z0-9])", text))
    return cells + cashtags


# ── lanes ────────────────────────────────────────────────────────────────────

def wire_lane(sym: str, since: date) -> list[dict]:
    from api.services import wire_archive

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
        hits = _wire_mentions(sym, entry.get("rundown_html") or "")
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
                             # a pre-L5 row stores the engine's failure sentence as the thesis
                             "text": ("" if store.is_failed_writeup(r["thesis_text"]) else (r["thesis_text"] or "").strip())
                                     or f"On the catalyst list ({r['tag'] or 'untagged'})",
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


# ── flow: the options tape, COUNTS ONLY ─────────────────────────────────────────────

class LaneUnreadable(RuntimeError):
    """A store answered, but not with an answer (HTTP error, missing table, missing file)."""


def _flow_base_url() -> str:
    """Where the flow family lives, decided PER CALL the way `flow_proxy` decides it: with the
    read proxy armed (production since the P5 cutover) flow.db is flow-worker's, reached over
    `WORKER_INTERNAL_URL`; otherwise this process owns flow.db and serves the route itself."""
    from api import flow_proxy
    if flow_proxy.PROXY_ENABLED and flow_proxy.WORKER_INTERNAL_URL:
        return flow_proxy.WORKER_INTERNAL_URL
    return f"http://127.0.0.1:{os.environ.get('PORT', '8000')}"


def _flow_auth_headers() -> dict:
    """`/api/flow/*` is `require_flow_user`; an internal read carries the PUSH_SECRET bearer it
    accepts (the Discord /flow card's door, `flow_card_from_page.fetch_product`). Without a
    secret the read is refused (401) and the lane is `unavailable` -- never a quiet tape."""
    from api import flow_proxy
    return flow_proxy.internal_read_headers()


def _flow_request(path: str, params: dict):
    """One GET against the flow family. Returns an httpx-style response. Replaced in tests by a
    TestClient over the REAL flow router and a seeded flow.db."""
    import httpx
    return httpx.get(_flow_base_url() + path, params=params, headers=_flow_auth_headers(),
                     timeout=FLOW_TIMEOUT_S)


def _mdy_to_iso(s: str) -> Optional[str]:
    try:
        m, d, y = (s or "").strip().split("/")
        return date(int(y), int(m), int(d)).isoformat()
    except (ValueError, TypeError):
        return None


def _flow_counts(sym: str, source: str) -> dict[str, int]:
    """Prints per session for one ticker in one partition, asking for `CreatedDate` and nothing
    else. A non-200 RAISES: an unreachable or refusing tape is not a ticker with no prints."""
    import csv
    r = _flow_request(f"/api/flow/ticker/{sym}", {"source": source, "cols": "CreatedDate"})
    if r.status_code != 200:
        raise LaneUnreadable(f"flow tape {source} answered HTTP {r.status_code}")
    reader = csv.reader(r.text.splitlines())
    header = next(reader, None)
    if not header:
        return {}
    if header != ["CreatedDate"]:
        # A tape that ignored `cols=` would hand us premium/side/strike; refuse rather than
        # parse past it, so no paid column ever rides through this module.
        raise LaneUnreadable(f"flow tape answered columns {header!r}, asked for ['CreatedDate']")
    per_day: dict[str, int] = {}
    for row in reader:
        iso = _mdy_to_iso(row[0]) if row else None
        if iso:
            per_day[iso] = per_day.get(iso, 0) + 1
    return per_day


def flow_lane(sym: str, since: date) -> list[dict]:
    """COUNTS ONLY: options prints per session, and a link to the Options Flow page.

    The tape files index/ETF symbols under `source=indexes` and everything else under `stocks`;
    asking the wrong one is a 200 with no rows. So: `stocks`, then `indexes` only if `stocks`
    held nothing (the signature indicator's rule, `routers/signature._fetch_flow_by_date`)."""
    per_day = _flow_counts(sym, "stocks") or _flow_counts(sym, "indexes")
    lo = since.isoformat()
    return [{"date": d, "lane": "flow", "prints": n,
             "text": f"{n:,} options print{'s' if n != 1 else ''} on the tape",
             "source": "flow_tape", "as_of": d, "ref": "/options-flow"}
            for d, n in sorted(per_day.items()) if d >= lo]


# ── setups: the engine's setup ledger ───────────────────────────────────────────────

#: The ledger's own outcome words (`setup_triggers.status`, engine `regrade_triggers.TERMINAL`),
#: said in English. A status outside this map is shown AS STORED -- never guessed into one.
SETUP_OUTCOME_TEXT = {"win": "won", "loss": "lost", "never_triggered": "never triggered",
                      "unresolved": "unresolved", "void": "voided (not graded)",
                      "ambiguous": "ambiguous (not graded)"}


def _engine_db_path() -> str:
    from api.services import brain_sync
    return os.path.join(brain_sync.brain_dir(), "data", "uct_intelligence.db")


def _engine_ro() -> sqlite3.Connection:
    path = _engine_db_path()
    if not os.path.isfile(path):
        # The Brain Pack has not installed on this pod: unreadable, not empty.
        raise LaneUnreadable(f"engine DB not installed at {path}")
    c = sqlite3.connect("file:" + path.replace("\\", "/") + "?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


def setups_lane(sym: str, since: date) -> list[dict]:
    """Two kinds of dated fact per ledger row: the day the setup was PUBLISHED, and the day its
    outcome was RECORDED (`resolved_at`), each only when it falls in the window. An open setup
    has no outcome row. ⛔ `quality_*` is never read: it is a composite score."""
    lo = since.isoformat()
    rows = []
    with contextlib.closing(_engine_ro()) as c:
        for r in c.execute(
                "SELECT trigger_date, setup_name, source, status, resolved_at, r_multiple "
                "FROM setup_triggers WHERE UPPER(symbol) = ? "
                "AND (trigger_date >= ? OR substr(resolved_at, 1, 10) >= ?) "
                "ORDER BY trigger_date, setup_name", (sym, lo, lo)):
            td, name = r["trigger_date"], r["setup_name"]
            ref = f"setup_triggers#{sym}@{td}:{name}"
            if td >= lo:
                rows.append({"date": td, "lane": "setups", "event": "published", "setup": name,
                             "text": f"Published as a {name} setup ({r['source'] or 'unlabelled'} list)",
                             "source": "setup_triggers", "as_of": td, "ref": ref})
            done = (r["resolved_at"] or "")[:10]
            if done and done >= lo and r["status"] != "open":
                status = r["status"]
                said = SETUP_OUTCOME_TEXT.get(status, status)
                rm = r["r_multiple"]
                tail = f" ({rm:+.2f}R)" if isinstance(rm, (int, float)) else ""
                rows.append({"date": done, "lane": "setups", "event": "outcome", "setup": name,
                             "status": status, "r_multiple": rm,
                             "text": f"{name} setup from {td}: {said}{tail}",
                             "source": "setup_triggers", "as_of": done, "ref": ref})
    return rows


# ── journal: the CALLER's own trades, owner-scoped ──────────────────────────────────

#: Stored `j2_trades.result` words, said in English; anything else is shown AS STORED.
JOURNAL_RESULT_TEXT = {"win": "win", "loss": "loss", "breakeven": "breakeven", "be": "breakeven"}


def _member_journal(user_id: Optional[str]) -> tuple[list[dict], list[dict]]:
    """(closed trades, open positions) for ONE member, through the journal_two service
    functions keyed on that member's id. No id raises: the lane is then `unavailable`,
    and there is no code path that reads a journal without the caller's own id."""
    if not user_id:
        raise LaneUnreadable("no member id: the journal lane is the caller's own or nothing")
    from api.services.journal_two import positions, trades
    return trades.list_trades_for_user(str(user_id)), positions.list_open_positions(str(user_id))


def _day(v) -> Optional[str]:
    s = str(v or "")[:10]
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return None


def journal_lane(sym: str, since: date, user_id: Optional[str] = None) -> list[dict]:
    """The member's own trades in `sym`: an OPENED row on the entry day (closed trades and
    open positions) and a CLOSED row on the exit day, with result and R as stored."""
    closed, open_pos = _member_journal(user_id)
    lo = since.isoformat()
    rows = []
    for t in closed:
        if _norm(t.get("symbol")) != sym:
            continue
        ref = f"j2_trades#{t.get('tradeRef') or t.get('id')}"
        side = t.get("side") or ""
        opened, closed_on = _day(t.get("entryDate")), _day(t.get("exitDate"))
        if opened and opened >= lo:
            rows.append({"date": opened, "lane": "journal", "event": "opened", "side": side,
                         "text": f"You opened a {side.lower() or 'trade'} position (your journal)",
                         "source": "j2_trades", "as_of": opened, "ref": ref})
        if closed_on and closed_on >= lo:
            res = t.get("result")
            said = JOURNAL_RESULT_TEXT.get(str(res or "").lower(), res or "closed")
            rm = t.get("rMultiple")
            tail = f" ({rm:+.2f}R)" if isinstance(rm, (int, float)) else ""
            rows.append({"date": closed_on, "lane": "journal", "event": "closed", "side": side,
                         "result": res, "r_multiple": rm,
                         "text": f"You closed your {side.lower() or 'trade'} from {opened or 'an earlier date'}: {said}{tail}",
                         "source": "j2_trades", "as_of": closed_on, "ref": ref})
    for p in open_pos:
        if _norm(p.get("symbol")) != sym:
            continue
        opened = _day(p.get("entryDate"))
        if opened and opened >= lo:
            side = p.get("side") or ""
            rows.append({"date": opened, "lane": "journal", "event": "opened", "side": side,
                         "text": f"You opened a {side.lower() or 'trade'} position, still open (your journal)",
                         "source": "j2_positions", "as_of": opened, "ref": f"j2_positions#{p.get('id')}"})
    return rows


def _journal_coverage(user_id: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """The member's first journalled entry, any ticker. Before it, nothing was recorded."""
    closed, open_pos = _member_journal(user_id)
    days = [d for d in (_day(x.get("entryDate")) for x in [*closed, *open_pos]) if d]
    return (min(days) if days else None, None)


_LANE_FNS = {"wire": wire_lane, "book": book_lane, "catalysts": catalysts_lane, "room": room_lane,
             "flow": flow_lane, "setups": setups_lane, "journal": journal_lane}
#: Lanes that are the CALLER's own: their read and their coverage take the member id.
MEMBER_LANES = ("journal",)


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


def _flow_dates(source: str) -> list[str]:
    r = _flow_request("/api/flow/dates", {"source": source})
    if r.status_code != 200:
        raise LaneUnreadable(f"flow dates {source} answered HTTP {r.status_code}")
    return [iso for iso in (_mdy_to_iso(d) for d in (r.json() or {}).get("dates") or []) if iso]


def _flow_coverage() -> tuple[Optional[str], Optional[str]]:
    """The sessions the tape holds, across both partitions. Retention is a product setting
    (`FLOW_RETAIN_TRADE_DAYS`, prune unarmed today), so the start is MEASURED, never assumed."""
    held = sorted(set(_flow_dates("stocks")) | set(_flow_dates("indexes")))
    return (held[0], held[-1]) if held else (None, None)


def _setups_coverage() -> tuple[Optional[str], Optional[str]]:
    """First and last publish date the installed ledger holds. The pack is nightly, so the
    last date says how far behind the pod's copy is."""
    with contextlib.closing(_engine_ro()) as c:
        row = c.execute("SELECT MIN(trigger_date), MAX(trigger_date) FROM setup_triggers").fetchone()
    return (row[0], row[1]) if row and row[0] else (None, None)


def _first_only(fn):
    return lambda: (fn(), None)


#: lane -> () -> (covers_from, covers_to). `covers_to` is None where the store is live.
_COVERAGE_FNS = {"wire": _first_only(_wire_covers_from), "book": _first_only(_book_covers_from),
                 "catalysts": _first_only(_catalysts_covers_from),
                 "room": _first_only(_room_covers_from),
                 "flow": _flow_coverage, "setups": _setups_coverage,
                 "journal": _journal_coverage}


# ── entity ids across renames ──────────────────────────────────────────────────────

def _entity_eras(sym: str) -> tuple[dict, list[tuple[str, Optional[str], Optional[str]]]]:
    """(`entity` block, [(alias, valid_from, valid_to)]).

    Only through the Entity Master's MEMBER door (`member_resolve`), and only while it is armed:
    dark, the store is never opened. Unresolved, ambiguous or unreadable, the key stays the bare
    ticker over the whole window and the block says why -- an ambiguous alias keys to no one."""
    from api.services.entity_master import member_resolve
    if not member_resolve.is_enabled():
        return ({"status": "not_armed",
                 "reason": "entity master member path is dark (ENTITY_MASTER_MEMBER_ENABLED)"},
                [(sym, None, None)])
    try:
        body = member_resolve.resolve_for_member(sym, None)
    except Exception as e:  # noqa: BLE001 -- identity is an enrichment; the lanes still answer
        logger.warning("[ticker-history] entity resolve failed for %s: %s", sym, e)
        return ({"status": "unavailable", "reason": type(e).__name__}, [(sym, None, None)])
    if body.get("status") != "resolved" or not body.get("aliases"):
        return ({"status": body.get("status") or "not_found",
                 "candidates": body.get("candidates") or []}, [(sym, None, None)])
    eras = [(a["alias"], a["validFrom"], a["validTo"]) for a in body["aliases"]]
    return ({"status": "resolved", "entity_id": body["entityId"],
             "aliases": [{"alias": a, "valid_from": f, "valid_to": t} for a, f, t in eras]}, eras)


def _in_era(d: str, valid_from: Optional[str], valid_to: Optional[str]) -> bool:
    # Half-open [valid_from, valid_to), the store's own interval rule (spec §8.4).
    return (valid_from is None or d >= valid_from) and (valid_to is None or d < valid_to)


def history(sym: str, days: int = DEFAULT_DAYS, user_id: Optional[str] = None) -> dict:
    """`{ticker, since, entity, lanes: {lane: {status, ...}}, timeline: [...]}`, newest first.

    `user_id` is the REQUESTING member; it keys the member's own lanes (``MEMBER_LANES``) and
    nothing else. A lane that errors reports `status: "unavailable"` and contributes no rows —
    never an empty list presented as "nothing happened"."""
    sym = _norm(sym)
    days = max(1, min(int(days or DEFAULT_DAYS), MAX_DAYS))
    since = _since(days)
    entity, eras = _entity_eras(sym)
    lanes, timeline = {}, []
    not_rendered = {}
    armed2 = lanes2_enabled()
    if not armed2:
        for name in LANES2:
            not_rendered[name] = f"built, dark until {LANES2_ENV} is set"
    for name in LANES:
        if name in LANES2 and not armed2:
            continue
        try:
            rows = []
            for alias, valid_from, valid_to in eras:
                if valid_to is not None and valid_to <= since.isoformat():
                    continue                                   # this name ended before the window
                lane_rows = (_LANE_FNS[name](alias, since, user_id) if name in MEMBER_LANES
                             else _LANE_FNS[name](alias, since))
                for r in lane_rows:
                    if _in_era(r["date"], valid_from, valid_to):
                        rows.append({**r, "symbol": alias})    # the name it was RECORDED under
            covers_from, covers_to = (_COVERAGE_FNS[name](user_id) if name in MEMBER_LANES
                                      else _COVERAGE_FNS[name]())
            lanes[name] = {"status": "ok", "count": len(rows), "covers_from": covers_from,
                           "covers_to": covers_to,
                           # True when the store starts AFTER the window opens: rows
                           # before `covers_from` were never recorded, not absent.
                           "partial": covers_from is None or covers_from > since.isoformat()}
            timeline.extend(rows)
        except Exception as e:  # noqa: BLE001 — one lane's store must not sink the others
            logger.warning("[ticker-history] %s lane failed for %s: %s", name, sym, e)
            lanes[name] = {"status": "unavailable", "count": None}
    timeline.sort(key=lambda r: (r["date"], LANES.index(r["lane"])), reverse=True)
    return {"ticker": sym, "key": "entity" if entity["status"] == "resolved" else "ticker",
            "entity": entity, "since": since.isoformat(), "days": days, "lanes": lanes,
            "not_rendered": not_rendered, "timeline": timeline}
