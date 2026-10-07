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
import time
import threading
import re
import weakref
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
#: How long one HIS request waits for its lanes before answering without the ones still
#: reading. First open of HIS took 5-6 s; after the flow lane got this budget (fn4) live
#: reads were still 3.2-6.2 s, so EVERY lane now has it. Past it a lane answers ``pending``
#: (said, never shown as "nothing"), its read keeps going in the background and parks its
#: answer, and the panel asks again. `HIS_SLOW_LANE_WAIT_S` is the fn4 name, still read.
LANE_WAIT_S = float(os.environ.get("HIS_LANE_WAIT_S") or os.environ.get("HIS_SLOW_LANE_WAIT_S") or 1.0)
#: A late lane's answer is kept this long for the panel's re-ask, then dropped.
_LANE_PARKED_TTL_S = 120.0
#: A whole HIS read slower than this logs one line naming every lane's time.
SLOW_HISTORY_LOG_S = 1.5


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


# ── dual-class spellings, decided per store FROM ITS WRITER ──────────────────────
# A class share has three spellings in this system: BRK-B (cap_universe, the journal since
# 2026-09-06, buzz cashtags since 2026-09-05), BRK.B (Massive's vendor form, buzz cashtags
# before 2026-09-05, older journal rows, the catalyst hunter), and BRKB (the OCC option root,
# the only form `massive_processor.OCC_PATTERN` `[A-Z]+` can write to the flow tape).
# A store whose writer is certain is asked in that spelling; a store that holds both is asked
# in both, and `history()` drops a repeated (date, lane, text) so a day never shows twice.

def _canon(sym: str) -> str:
    from api.services.ticker_resolver import canonical
    return canonical(sym)


def _class_spellings(sym: str) -> tuple[str, ...]:
    """(hyphen form, dot form) for a class share; (sym,) for anything else."""
    c = _canon(sym)
    return (c, c.replace("-", ".")) if "-" in c else (c,)


def _occ_root(sym: str) -> str:
    """The flow tape's spelling: the OCC root, which carries no class separator (BRK-B -> BRKB)."""
    return _canon(sym).replace("-", "")


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


def _wire_doc(rundown_html: str) -> tuple[str, tuple[str, ...], str]:
    """The ticker-independent half of `_wire_mentions`, done once per archived wire:
    (plain text, the bodies of the ticker-markup cells, plain text with those cells removed)."""
    plain = re.sub(r"<[^>]+>", " ", rundown_html)
    cells = tuple(re.sub(r"<[^>]+>", " ", m.group("body")).strip().lstrip("$").upper()
                  for m in _WIRE_SYM_CELL.finditer(rundown_html))
    without_cells = re.sub(r"<[^>]+>", " ", _WIRE_SYM_CELL.sub(" ", rundown_html))
    return plain, cells, without_cells


def _wire_doc_mentions(sym: str, doc: tuple[str, tuple[str, ...], str]) -> int:
    plain, cells, without_cells = doc
    # Every pattern below contains `sym` literally: a text without it holds no mention, and
    # the substring test is far cheaper than the regex scan it skips.
    if not _is_ambiguous(sym):
        return len(_mention_regex(sym).findall(plain)) if sym in plain else 0
    if sym not in without_cells:
        return sum(1 for c in cells if c == sym)
    cashtags = len(re.findall(r"(?<![A-Za-z0-9.$-])\$" + re.escape(sym) + r"(?![A-Za-z0-9])", without_cells))
    return sum(1 for c in cells if c == sym) + cashtags


def _wire_mentions(sym: str, rundown_html: str) -> int:
    """How many times the Wire names `sym`. For an ambiguous ticker only a
    cashtag or a ticker-markup cell counts; otherwise a whole-word match."""
    return _wire_doc_mentions(sym, _wire_doc(rundown_html))


#: Parsed archived wires, keyed by (file, mtime, size) so a re-archived day is re-read.
#: Measured 2026-10-06 on 90 synthetic 135 KB wires: the lane re-read and re-stripped every
#: file on every HIS open, 0.45-2.5 s; with this it pays that once per file.
_WIRE_DOC_MEMO: "dict" = {}
_WIRE_DOC_MEMO_MAX = 400
_WIRE_DOC_LOCK = threading.Lock()


def _archived_wire_doc(ymd: str):
    """`_wire_doc` of the archived wire for `ymd`, or None. Same answer as reading the file."""
    from api.services import wire_archive
    try:
        st = wire_archive.path_for(ymd).stat()
    except (OSError, ValueError):
        return None
    key = (str(wire_archive.archive_dir()), ymd, st.st_mtime_ns, st.st_size)
    with _WIRE_DOC_LOCK:
        hit = _WIRE_DOC_MEMO.get(key)
    if hit is not None:
        return hit
    entry = wire_archive.read(ymd)
    if not entry:
        return None
    doc = _wire_doc(entry.get("rundown_html") or "")
    with _WIRE_DOC_LOCK:
        if len(_WIRE_DOC_MEMO) >= _WIRE_DOC_MEMO_MAX:
            _WIRE_DOC_MEMO.clear()
        _WIRE_DOC_MEMO[key] = doc
    return doc


#: Boot warm bound (`warm_wire_archive`): the wall-clock budget for one warm pass.
WIRE_WARM_BUDGET_S = float(os.environ.get("HIS_WIRE_WARM_BUDGET_S") or 20.0)


def warm_wire_archive(budget_s: Optional[float] = None) -> dict:
    """Parse the archived wires the HIS lane can read (the last MAX_DAYS, newest first) into
    `_WIRE_DOC_MEMO`, so the first HIS open after a deploy does not pay the parse (~1 s).

    Bounded three ways: at most `_WIRE_DOC_MEMO_MAX` files (one memo fill, never a clear),
    a wall-clock budget, and local disk only (no vendor call). Called from the web boot-warm
    background thread (api/main.py), never from a request; a failure is the caller's log line.
    """
    from api.services import wire_archive
    budget = WIRE_WARM_BUDGET_S if budget_s is None else float(budget_s)
    since = _since(MAX_DAYS)
    t0 = time.monotonic()
    parsed = skipped = 0
    stopped = None
    held = sorted(wire_archive.held_dates(), reverse=True)
    for ymd in held:
        if parsed >= _WIRE_DOC_MEMO_MAX:
            stopped = "memo_cap"
            break
        if time.monotonic() - t0 > budget:
            stopped = "budget"
            break
        try:
            d = date.fromisoformat(wire_archive.parse_date(ymd))
        except (ValueError, TypeError):
            skipped += 1
            continue
        if d < since:
            break                                   # newest first: everything after is older
        if _archived_wire_doc(ymd) is None:
            skipped += 1
        else:
            parsed += 1
    return {"held": len(held), "parsed": parsed, "skipped": skipped, "stopped": stopped,
            "ms": round((time.monotonic() - t0) * 1000)}


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
        doc = _archived_wire_doc(ymd)
        if doc is None:
            continue
        # The wire's prose is written by the engine, which spells a class share both ways
        # (morning-wire `substack/lead.py` lists BRK.B AND BRK-B), so both are counted. The two
        # patterns cannot match the same characters, so no mention is counted twice.
        hits = sum(_wire_doc_mentions(s, doc) for s in _class_spellings(sym))
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
    # Holdings are `leadership[].sym` as the wire push carried it (routers/push.py), i.e. the
    # Finviz export's spelling, which this repo cannot see. Compared in the one canonical form.
    want = _canon(sym)
    for c in comps:
        now = want in {_canon(h) for h in (c.get("holdings") or [])}
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

    # The catalyst store holds BOTH spellings: the hunter keeps a dot class (hunter.py, "BRK.B")
    # and the discovery pass hands back the hyphen form (sources.py, ticker_resolver). Upserts key
    # on (market_date, ticker), so one day can hold the name twice. Both are read and ONE row per
    # day is kept: the one on the list (a rank), best rank first, the canonical spelling on a tie.
    spellings = _class_spellings(sym)
    picked: dict = {}
    try:
        with contextlib.closing(store._connect()) as c:
            c.row_factory = sqlite3.Row
            marks = ",".join("?" * len(spellings))
            for r in c.execute(
                    "SELECT market_date, ticker, rank, tag, thesis_text FROM catalysts "
                    f"WHERE ticker IN ({marks}) AND market_date >= ? ORDER BY market_date",
                    (*spellings, since.isoformat())):
                key = (r["rank"] is None, r["rank"] if r["rank"] is not None else 0,
                       spellings.index(r["ticker"]) if r["ticker"] in spellings else len(spellings))
                held = picked.get(r["market_date"])
                if held is None or key < held[0]:
                    picked[r["market_date"]] = (key, r)
    except sqlite3.Error as e:
        logger.warning("[ticker-history] catalysts lane unreadable: %s", e)
        raise
    rows = []
    for _d, (_k, r) in sorted(picked.items()):
        rows.append({"date": r["market_date"], "lane": "catalysts",
                     "rank": r["rank"], "tag": r["tag"],
                     # a pre-L5 row stores the engine's failure sentence as the thesis
                     "text": ("" if store.is_failed_writeup(r["thesis_text"]) else (r["thesis_text"] or "").strip())
                             or f"On the catalyst list ({r['tag'] or 'untagged'})",
                     "source": "catalysts", "as_of": r["market_date"],
                     "ref": f"/catalysts/history?date={r['market_date']}"})
    return rows


def room_lane(sym: str, since: date) -> list[dict]:
    """COUNTS ONLY (owner ruling 2026-09-29): mentions per ET day. No text, no authors."""
    from api.services import buzz_store

    start = int(datetime.combine(since, datetime.min.time(), tzinfo=ET).timestamp())
    # Spelling, from the writer (buzz_extract.extract): cashtags are stored hyphenated since
    # be67086e0 (2026-09-05) and AS TYPED before it, so a 365-day window holds BRK.B rows then
    # BRK-B rows. Both are read; a message is counted once (PK is message_id + ticker, so one
    # message that typed both spellings would otherwise count twice).
    spellings = _class_spellings(sym)
    marks = ",".join("?" * len(spellings))
    per_day: dict[str, set] = {}
    # buzz_store.connect() is the PROCESS-WIDE shared connection (the ingest poller, /buzz
    # and the scheduled boards all use it). Never close it: closing it here took every
    # buzz read and write on the pod down after the first History request (2026-09-29).
    c = buzz_store.connect()
    for (mid, ts) in c.execute(f"SELECT message_id, ts FROM mentions WHERE ticker IN ({marks}) AND ts >= ?",
                               (*spellings, start)):
        d = datetime.fromtimestamp(int(ts), ET).date().isoformat()
        per_day.setdefault(d, set()).add(mid)
    per_day = {d: len(m) for d, m in per_day.items()}
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


# Live sweep 2026-10-05: HIS took 15.7 s for NVDA, nearly all of it this read (the tape for a
# liquid name is slow, see L1). Counts per session move slowly, so a good answer is kept
# _FLOW_OK_TTL_S; a failed read is kept _FLOW_FAIL_TTL_S, so a member re-opening HIS does not
# wait out the same timeout again -- the lane still says `unavailable`, never "no prints".
_FLOW_OK_TTL_S = 600.0
_FLOW_FAIL_TTL_S = 120.0
_FLOW_MEMO: dict = {}
_FLOW_MEMO_LOCK = threading.Lock()
#: key -> Event for a tape read already running. A panel that asks again while the first
#: read is still going (the ``pending`` re-ask) JOINS it instead of starting a second
#: multi-MB read of the same ticker on the worker.
_FLOW_INFLIGHT: dict = {}


def _flow_memo_hit(key, reader, now):
    with _FLOW_MEMO_LOCK:
        hit = _FLOW_MEMO.get(key)
    if hit is not None and hit[3] is reader:
        at, value, err, _r = hit
        if now - at < (_FLOW_FAIL_TTL_S if err is not None else _FLOW_OK_TTL_S):
            return hit
    return None


def _flow_counts(sym: str, source: str) -> dict[str, int]:
    key = (sym, source)
    reader = _flow_request          # a swapped reader (tests, a re-pointed tape) never reuses
    while True:
        hit = _flow_memo_hit(key, reader, time.monotonic())
        if hit is not None:
            if hit[2] is not None:
                raise hit[2]
            return dict(hit[1])
        with _FLOW_MEMO_LOCK:
            running = _FLOW_INFLIGHT.get(key)
            if running is None:
                mine = _FLOW_INFLIGHT[key] = threading.Event()
        if running is None:
            break
        if not running.wait(FLOW_TIMEOUT_S + 1.0):
            raise LaneUnreadable(f"flow tape {source} read for {sym} did not finish")
        # The joined read finished: its answer (or failure) is in the memo now.
    now = time.monotonic()
    try:
        value = _flow_counts_read(sym, source)
    except Exception as e:  # noqa: BLE001 -- remembered briefly, then re-raised as before
        with _FLOW_MEMO_LOCK:
            _FLOW_MEMO[key] = (now, None, e, reader)
            if len(_FLOW_MEMO) > 512:
                _FLOW_MEMO.clear()
        raise
    else:
        with _FLOW_MEMO_LOCK:
            _FLOW_MEMO[key] = (now, dict(value), None, reader)
        return value
    finally:
        with _FLOW_MEMO_LOCK:
            _FLOW_INFLIGHT.pop(key, None)
        mine.set()


#: The flow family's per-session COUNT route (flow_router `get_flow_ticker_day_counts`): a SQL
#: GROUP BY on flow-worker, a few KB, instead of shipping the ticker's whole `CreatedDate` column
#: (~390K rows / ~4 MB decoded for NVDA) to count lines here. Web deploys from `production` and
#: flow-worker ships only after hours, so web can be ahead of it: a 404 from this route means
#: "flow-worker predates it" and the lane reads the tape the old way.
DAY_COUNTS_PATH = "/api/flow/ticker/{sym}/day-counts"
#: The memo/in-flight key's partition for the day-counts read, which covers BOTH partitions.
FLOW_ALL = "all"


class _RouteMissing(LookupError):
    """The flow side answered 404 for a route this module prefers: it predates it."""


def _flow_day_counts_read(sym: str) -> dict[str, int]:
    """Prints per session for one ticker across both partitions, from the count route.

    COUNTS ONLY: every key must be an ISO date and every value a non-negative int -- an answer
    carrying anything else is refused, so no paid column can ride through this module. As a
    side effect the answer's tape span primes `_flow_coverage`'s memo (one hop, not three)."""
    r = _flow_request(DAY_COUNTS_PATH.format(sym=sym), {"source": FLOW_ALL})
    if r.status_code == 404:
        raise _RouteMissing(r.status_code)
    if r.status_code != 200:
        raise LaneUnreadable(f"flow day counts answered HTTP {r.status_code}")
    try:
        body = r.json() or {}
    except ValueError as e:
        raise LaneUnreadable(f"flow day counts answered a non-JSON body: {e}") from e
    days = body.get("days")
    if not isinstance(days, dict):
        raise LaneUnreadable("flow day counts answered without a `days` map")
    per_day: dict[str, int] = {}
    for k, v in days.items():
        try:
            iso = date.fromisoformat(k).isoformat()
        except (TypeError, ValueError):
            raise LaneUnreadable(f"flow day counts answered a non-date key {k!r}") from None
        if isinstance(v, bool) or not isinstance(v, int) or v < 0:
            raise LaneUnreadable(f"flow day counts answered a non-count value for {iso}")
        per_day[iso] = v
    tape = body.get("tape") or {}
    if isinstance(tape, dict) and tape.get("ok") is not False:
        first, last = tape.get("first"), tape.get("last")
        span = (first, last) if (first and last) else (None, None)
        _FLOW_COVERAGE_MEMO["span"] = (time.monotonic(), span, _flow_request)
    return per_day


def _flow_counts_read(sym: str, source: str) -> dict[str, int]:
    """Prints per session for one ticker. `source=FLOW_ALL` asks the count route (both
    partitions in one cheap read); a flow side that predates it (404) is read the old way --
    the tape's `CreatedDate` column, `stocks` then `indexes` -- so web can deploy first."""
    if source == FLOW_ALL:
        try:
            return _flow_day_counts_read(sym)
        except _RouteMissing:
            logger.info("[ticker-history] flow day-counts route missing (404); reading the tape")
            return _flow_tape_counts(sym, "stocks") or _flow_tape_counts(sym, "indexes")
    return _flow_tape_counts(sym, source)


def _flow_tape_counts(sym: str, source: str) -> dict[str, int]:
    """FALLBACK: prints per session for one ticker in one partition, read off the tape asking
    for `CreatedDate` and nothing else. A non-200 RAISES: an unreachable or refusing tape is not
    a ticker with no prints."""
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

    One read of the flow side's per-session COUNT route, across both partitions (the tape files
    index/ETF symbols under `source=indexes` and everything else under `stocks`, by the root's
    classification at write time). Against a flow side that predates the route (404) it falls
    back to the old read: the tape's `CreatedDate` column, `stocks`, then `indexes` only if
    `stocks` held nothing (the signature indicator's rule, `routers/signature._fetch_flow_by_date`).

    The tape is asked in the OCC root spelling, because that is the only one its writers can
    produce: `Symbol` is the root parsed out of the option ticker by `massive_processor.parse_occ`
    (`OCC_PATTERN` root `[A-Z]+`) and `build_gap_fill_csv.parse_occ` -- BRK.B's options are
    `O:BRKB...`, so its prints are filed under BRKB, never BRK.B or BRK-B."""
    sym = _occ_root(sym)
    per_day = _flow_counts(sym, FLOW_ALL)
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
    # The writer (uct-intelligence `api.record_setup_trigger`) stores `symbol.upper()` as the
    # morning wire handed it -- the Finviz leadership export's spelling, not visible from this
    # repo. Both class spellings are read; a setup recorded under both repeats the same
    # (date, lane, text) and `history()` keeps one.
    # The writer upper-cases the symbol, so the column is compared bare: wrapping it in UPPER()
    # hid it from the ledger's own UNIQUE(symbol, ...) index and scanned the whole table per open.
    spellings = _class_spellings(sym)
    marks = ",".join("?" * len(spellings))
    with contextlib.closing(_engine_ro()) as c:
        for r in c.execute(
                "SELECT trigger_date, setup_name, source, status, resolved_at, r_multiple "
                f"FROM setup_triggers WHERE symbol IN ({marks}) "
                "AND (trigger_date >= ? OR substr(resolved_at, 1, 10) >= ?) "
                "ORDER BY trigger_date, setup_name", (*spellings, lo, lo)):
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


#: Per-thread memo for ONE lane run (set by `history()._one`, None outside a run): the journal
#: lane and its coverage read the member's journal once between them, not twice.
_RUN_MEMO = threading.local()


def _journal_prefix(sym: str) -> str:
    """The leading letters/digits every stored spelling of `sym` shares (BRK-B, BRK.B -> BRK)."""
    m = re.match(r"[A-Z0-9]+", _canon(sym))
    return m.group(0) if m else ""


def _run_memo(key, read):
    """`read()` once per lane run (see `_RUN_MEMO`); outside a run, every call reads."""
    memo = getattr(_RUN_MEMO, "d", None)
    if memo is not None and key in memo:
        return memo[key]
    out = read()
    if memo is not None:
        memo[key] = out
    return out


def _member_positions(user_id: str) -> list[dict]:
    from api.services.journal_two import positions
    return _run_memo(("positions", user_id), lambda: positions.list_open_positions(user_id))


def _member_journal(user_id: Optional[str], sym: Optional[str] = None) -> tuple[list[dict], list[dict]]:
    """(closed trades, open positions) for ONE member, through the journal_two service
    functions keyed on that member's id. No id raises: the lane is then `unavailable`,
    and there is no code path that reads a journal without the caller's own id.

    With `sym`, only that ticker's trades are read, through the service's own symbol filter
    (`FilterSpec.symbol`, a prefix match the caller narrows to the exact ticker). Live
    2026-10-06: reading and decoding EVERY trade of a large journal cost the lane >1 s on
    every open (6,000 trades: 4.1 s, nearly all of it each row's `context_at_entry` JSON)."""
    if not user_id:
        raise LaneUnreadable("no member id: the journal lane is the caller's own or nothing")
    uid = str(user_id)
    from api.services.journal_two import trades
    if sym is None:
        closed = _run_memo(("trades", uid, None), lambda: trades.list_trades_for_user(uid))
    else:
        from api.services.journal_two.filters import FilterSpec
        prefix = _journal_prefix(sym)
        closed = _run_memo(("trades", uid, prefix), lambda: (
            trades.list_trades_for_user(uid, spec=FilterSpec(symbol=prefix))[0] if prefix
            else trades.list_trades_for_user(uid)))
    return closed, _member_positions(uid)


def _day(v) -> Optional[str]:
    s = str(v or "")[:10]
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return None


def journal_lane(sym: str, since: date, user_id: Optional[str] = None) -> list[dict]:
    """The member's own trades in `sym`: an OPENED row on the entry day (closed trades and
    open positions) and a CLOSED row on the exit day, with result and R as stored."""
    closed, open_pos = _member_journal(user_id, sym)
    lo = since.isoformat()
    rows = []
    # Journal writes go through `journal_two.symbol_normalize` (BRK.B -> BRK-B) only since
    # 5b925477a (2026-09-06); an older row can still read BRK.B. Compared in the canonical form.
    sym = _canon(sym)
    for t in closed:
        if _canon(t.get("symbol")) != sym:
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
        if _canon(p.get("symbol")) != sym:
            continue
        opened = _day(p.get("entryDate"))
        if opened and opened >= lo:
            side = p.get("side") or ""
            rows.append({"date": opened, "lane": "journal", "event": "opened", "side": side,
                         "text": f"You opened a {side.lower() or 'trade'} position, still open (your journal)",
                         "source": "j2_positions", "as_of": opened, "ref": f"j2_positions#{p.get('id')}"})
    return rows


_JOURNAL_OLDEST_TTL_S = 600.0
_JOURNAL_OLDEST_MEMO: dict = {}


def _journal_coverage(user_id: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """The member's first journalled entry, any ticker. Before it, nothing was recorded.

    Two one-row reads through the same service door instead of the whole journal: the
    service lists newest entry first, so its total names the offset of the OLDEST trade."""
    if not user_id:
        raise LaneUnreadable("no member id: the journal lane is the caller's own or nothing")
    uid = str(user_id)
    from api.services.journal_two import trades
    from api.services.journal_two.filters import FilterSpec
    days = []
    _first, total = trades.list_trades_for_user(uid, spec=FilterSpec(limit=1))
    if total:
        # The offset read walks every trade's row (350 ms at 6,000 trades), so its answer is
        # kept per (member, trade COUNT): adding or deleting a trade re-reads at once; an edit
        # that back-dates an existing trade is picked up within _JOURNAL_OLDEST_TTL_S.
        key = (uid, int(total))
        hit = _JOURNAL_OLDEST_MEMO.get(key)
        if hit is not None and time.monotonic() - hit[0] < _JOURNAL_OLDEST_TTL_S:
            days += hit[1]
        else:
            oldest, _t = trades.list_trades_for_user(uid, spec=FilterSpec(limit=1, offset=total - 1))
            found = [d for d in (_day(t.get("entryDate")) for t in oldest) if d]
            if len(_JOURNAL_OLDEST_MEMO) > 2048:
                _JOURNAL_OLDEST_MEMO.clear()
            _JOURNAL_OLDEST_MEMO[key] = (time.monotonic(), found)
            days += found
    days += [d for d in (_day(p.get("entryDate")) for p in _member_positions(uid)) if d]
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


def _flow_tape_span() -> Optional[tuple[Optional[str], Optional[str]]]:
    """(first, last) session from the flow side's `/api/flow/tape-span` (one ~ms read instead of
    two DISTINCT date scans). None when the flow side predates the route (404) -- the caller
    then asks `/dates` twice, the old way. Any other non-200 raises: the lane is unavailable."""
    r = _flow_request("/api/flow/tape-span", {})
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        raise LaneUnreadable(f"flow tape span answered HTTP {r.status_code}")
    body = r.json() or {}
    first, last = body.get("first"), body.get("last")
    return (first, last) if (first and last) else (None, None)


#: The tape's span is the same for every ticker and only ever gains a session, so one answer
#: serves every HIS open for this long (two cross-service reads saved per open; a cold
#: `/api/flow/dates` is ~3 s on the worker, flow_db.get_available_dates). At worst the
#: last-session date is this far behind on the morning a new session's first prints land.
_FLOW_COVERAGE_TTL_S = 300.0
_FLOW_COVERAGE_MEMO: dict = {}


def _flow_coverage() -> tuple[Optional[str], Optional[str]]:
    """The sessions the tape holds, across both partitions. Retention is a product setting
    (`FLOW_RETAIN_TRADE_DAYS`, prune unarmed today), so the start is MEASURED, never assumed.
    A failed read is not remembered: it raises, and the lane says `unavailable`."""
    reader = _flow_request          # a swapped reader (tests) never reuses another's answer
    hit = _FLOW_COVERAGE_MEMO.get("span")
    if hit is not None and hit[2] is reader and time.monotonic() - hit[0] < _FLOW_COVERAGE_TTL_S:
        return hit[1]
    span = _flow_tape_span()
    if span is None:                        # a flow side that predates /tape-span
        held = sorted(set(_flow_dates("stocks")) | set(_flow_dates("indexes")))
        span = (held[0], held[-1]) if held else (None, None)
    _FLOW_COVERAGE_MEMO["span"] = (time.monotonic(), span, reader)
    return span


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


#: One small pool for the lanes (seven at most per request), off the shared anyio threadpool.
#: A lane that misses the budget keeps its thread until it finishes, so the pool has room for
#: a few requests' worth of late lanes; a repeat ask JOINS a running read rather than adding one.
from concurrent.futures import ThreadPoolExecutor as _TPE
from concurrent.futures import TimeoutError as FutureTimeout
_LANE_POOL = _TPE(max_workers=21, thread_name_prefix="his-lane")
#: key -> Future of a lane read still running (joined by a repeat ask).
_LANE_INFLIGHT: dict = {}
#: key -> (finished_at, Future) of a lane read that finished after its request answered.
_LANE_PARKED: dict = {}
#: Futures whose answer a request already used, so their late callback parks nothing.
_LANE_CONSUMED = weakref.WeakSet()
_LANE_LOCK = threading.Lock()


def _lane_done(key, fut) -> None:
    """Runs when a lane read finishes: unless its request used the answer, park it."""
    with _LANE_LOCK:
        if _LANE_INFLIGHT.get(key) is fut:
            del _LANE_INFLIGHT[key]
        if fut in _LANE_CONSUMED:
            _LANE_CONSUMED.discard(fut)
            return
        now = time.monotonic()
        for k in [k for k, (at, _f) in _LANE_PARKED.items() if now - at > _LANE_PARKED_TTL_S]:
            del _LANE_PARKED[k]
        _LANE_PARKED[key] = (now, fut)
    try:
        name, _status, _rows, ms, _read_at = fut.result()
        if ms >= SLOW_HISTORY_LOG_S * 1000:
            logger.warning("[ticker-history] late lane %s for %s took %d ms", name, key[1], ms)
    except Exception:  # noqa: BLE001 -- _one never raises; this is only the log line
        pass


def _lane_consumed(key, fut) -> None:
    """A request used this read's answer: nothing of it may be parked for a later ask."""
    with _LANE_LOCK:
        held = _LANE_PARKED.get(key)
        if held is not None and held[1] is fut:
            del _LANE_PARKED[key]
        elif not fut.done() or _LANE_INFLIGHT.get(key) is fut:
            _LANE_CONSUMED.add(fut)


def _lane_future(key, run):
    """(future, how) for one lane: a parked late answer, a running read to join, or a new read."""
    with _LANE_LOCK:
        held = _LANE_PARKED.pop(key, None)
        if held is not None and time.monotonic() - held[0] <= _LANE_PARKED_TTL_S:
            return held[1], "parked"
        fut = _LANE_INFLIGHT.get(key)
        if fut is not None:
            return fut, "joined"
        fut = _LANE_POOL.submit(run)
        _LANE_INFLIGHT[key] = fut
    fut.add_done_callback(lambda f, k=key: _lane_done(k, f))
    return fut, "read"


def history(sym: str, days: int = DEFAULT_DAYS, user_id: Optional[str] = None) -> dict:
    """`{ticker, since, entity, lanes: {lane: {status, ...}}, timeline: [...]}`, newest first.

    `user_id` is the REQUESTING member; it keys the member's own lanes (``MEMBER_LANES``) and
    nothing else. A lane that errors reports `status: "unavailable"` and contributes no rows —
    never an empty list presented as "nothing happened"."""
    # The one spelling (BRK.B -> BRK-B). Each lane then asks its store in the spelling(s) that
    # store's writer produces (see `_class_spellings` / `_occ_root`).
    sym = _canon(sym)
    days = max(1, min(int(days or DEFAULT_DAYS), MAX_DAYS))
    since = _since(days)
    t_start = time.monotonic()
    entity, eras = _entity_eras(sym)
    timing = [("entity", (time.monotonic() - t_start) * 1000, "ok")]
    lanes, timeline = {}, []
    not_rendered = {}
    armed2 = lanes2_enabled()
    if not armed2:
        for name in LANES2:
            not_rendered[name] = f"built, dark until {LANES2_ENV} is set"
    # Live sweep 2026-10-05: the lanes read independent stores, so they run side by side and
    # HIS costs its slowest lane instead of the sum. Each keeps its own failure as before.
    def _one(name):
        t_lane = time.monotonic()
        _RUN_MEMO.d = {}
        try:
            name_, status, rows = _one_lane(name)
            # TERM-019: the wall-clock instant this lane's stores were read. A parked answer
            # keeps the time of ITS read, so the response's as_of never claims a later read.
            return name_, status, rows, (time.monotonic() - t_lane) * 1000, time.time()
        finally:
            _RUN_MEMO.d = None

    def _one_lane(name):
        try:
            rows, seen = [], set()
            for alias, valid_from, valid_to in eras:
                if valid_to is not None and valid_to <= since.isoformat():
                    continue                                   # this name ended before the window
                lane_rows = (_LANE_FNS[name](alias, since, user_id) if name in MEMBER_LANES
                             else _LANE_FNS[name](alias, since))
                for r in lane_rows:
                    if _in_era(r["date"], valid_from, valid_to):
                        # A store read in two spellings, or two aliases that are one class
                        # share's spellings, can hand back the same fact twice: one is kept.
                        # The journal reads one store row per trade, and two same-day trades
                        # read alike, so its identity also carries the trade's own ref.
                        k = (r["date"], r["lane"], r.get("text"),
                             r.get("ref") if r["lane"] in MEMBER_LANES else None)
                        if k in seen:
                            continue
                        seen.add(k)
                        rows.append({**r, "symbol": alias})    # the name it was RECORDED under
            covers_from, covers_to = (_COVERAGE_FNS[name](user_id) if name in MEMBER_LANES
                                      else _COVERAGE_FNS[name]())
            status = {"status": "ok", "count": len(rows), "covers_from": covers_from,
                           "covers_to": covers_to,
                           # True when the store starts AFTER the window opens: rows
                           # before `covers_from` were never recorded, not absent.
                           "partial": covers_from is None or covers_from > since.isoformat()}
            return name, status, rows
        except Exception as e:  # noqa: BLE001 — one lane's store must not sink the others
            logger.warning("[ticker-history] %s lane failed for %s: %s", name, sym, e)
            return name, {"status": "unavailable", "count": None}, []

    wanted = [n for n in LANES if not (n in LANES2 and not armed2)]
    eras_key = tuple(eras)
    futures = []
    for n in wanted:
        # Everything the answer depends on is in the key, including WHICH functions read the
        # store, so a swapped reader (a test, a re-pointed store) never gets another's answer.
        key = (n, sym, since.isoformat(), user_id if n in MEMBER_LANES else None, eras_key,
               _LANE_FNS[n], _COVERAGE_FNS[n], _flow_request if n == "flow" else None)
        fut, how = _lane_future(key, lambda n=n: _one(n))
        futures.append((n, key, fut, how))
    t0 = time.monotonic()
    read_times = []
    for n, key, f, how in futures:
        # One budget for the whole request, counted from when the lanes started, so the
        # lanes' times are not added on top of each other.
        budget = max(0.0, LANE_WAIT_S - (time.monotonic() - t0))
        try:
            name, status, rows, ms, read_at = f.result(timeout=budget)
        except FutureTimeout:
            # Still reading. The read keeps going and parks its answer, so the panel's next
            # ask is answered at once. Not "nothing" and not "unavailable": the lane has not
            # answered YET, and says so.
            lanes[n] = {"status": "pending", "count": None, "retry_after_s": 2}
            timing.append((n, (time.monotonic() - t0) * 1000, "pending"))
            continue
        if how != "parked":
            _lane_consumed(key, f)
        lanes[name] = status
        if status.get("status") == "ok":
            read_times.append(read_at)
        timeline.extend(rows)
        timing.append((n, 0.0 if how == "parked" else ms, status["status"] if how == "read" else how))
    timeline.sort(key=lambda r: (r["date"], LANES.index(r["lane"])), reverse=True)
    total_ms = (time.monotonic() - t_start) * 1000
    if total_ms >= SLOW_HISTORY_LOG_S * 1000:
        logger.warning("[ticker-history] slow %s %d ms: %s", sym, total_ms,
                       " ".join(f"{n}={ms:.0f}({st})" for n, ms, st in timing))
    return {"ticker": sym, "key": "entity" if entity["status"] == "resolved" else "ticker",
            "entity": entity, "since": since.isoformat(), "days": days, "lanes": lanes,
            "not_rendered": not_rendered, "timeline": timeline,
            # TERM-019: the OLDEST read among the lanes that answered -- what this timeline is
            # current through. None when no lane answered (the panel then says "undated").
            "as_of": (datetime.fromtimestamp(min(read_times), ET).isoformat(timespec="seconds")
                      if read_times else None),
            "_timing": timing + [("total", total_ms, "ok")]}


def server_timing(timing) -> str:
    """The `Server-Timing` header for one history read: `his-<lane>;dur=<ms>;desc="<state>"`."""
    parts = []
    for name, ms, state in timing or []:
        safe = re.sub(r"[^A-Za-z0-9_-]", "", str(name)) or "lane"
        st = re.sub(r"[^A-Za-z0-9_ -]", "", str(state))
        parts.append(f'his-{safe};dur={float(ms):.0f};desc="{st}"')
    return ", ".join(parts)
