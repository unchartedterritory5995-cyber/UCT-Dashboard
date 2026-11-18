"""UCT Agent spend ledger -- a HARD daily dollar cap with worst-case reservations (Phase 0A, owner 2026-10-13).

OWNER DECISION (Gate A, option 1): UCT Agent has its OWN hard cap ($5 per ET day,
UCT_AGENT_BUDGET_USD) and ALSO stops paid inference once the SHARED $15 AI ledger
(`catalyst.cost_guard`, $15 per ET day) is spent. Agent spend is NOT written into the
shared ledger -- the indicator builder, image and catalyst-synthesis budgets are
untouched -- so the Agent can never push another feature over its own limit.

HOW THE AGENT CAP HOLDS UNDER CONCURRENCY
  * Before EVERY paid call (a turn, its schema retry, its research round, a reroute,
    a chat-naming call) `reserve()` runs ONE `BEGIN IMMEDIATE` transaction on the
    Agent store: today's committed dollars = settled actuals + open reservations; the
    call is admitted only if committed + THIS call's worst case <= the cap. Two calls
    racing for the last dollars cannot both see the same total.
  * The worst case is a conservative bound under stated assumptions (docs/agent/budget/PER-TURN-CAP.md):
    every UTF-8 byte of the request
    (system, messages, output schema) is counted as one input token -- a token is
    never shorter than a byte -- plus a fixed allowance for the provider's own framing,
    priced as a cache WRITE (1.25x, the dearest way input is billed), plus `max_tokens`
    of output. Research is priced at the dearest search rate times every retry.
  * After the call `settle()` replaces the reservation with the actual cost from the
    provider's usage. MISSING usage (a timeout, a dropped connection, a malformed
    reply) settles AT THE WORST CASE. A reservation that is never settled (the process
    died mid-call) keeps counting at its worst case for the rest of the day.
  * A provider ERROR RESPONSE (an HTTP error status: nothing was generated, nothing is
    billed) releases the reservation.
  * Durable: the rows live in the Agent store on the web volume, so a restart or a
    deploy resumes the day where it was.
  * FAILS CLOSED: if the ledger cannot be read or written, the paid call is refused.
    Deterministic Agent paths never come here, so they keep working.

THE PER-TURN CAP (owner 2026-11-04, planner v1): one member request -- its planner call, a schema retry,
the server repair, its research lookup, the post-research call, the browser's reroute / repair of the same
request and its background chat-naming call -- may COMMIT at most UCT_AGENT_TURN_USD ($0.25, the same switch
planner v2 reads). Every reservation carries its request (`turn_request_id`, also for the calls that do not use
one of the request's calls), and `reserve()` sums the request's settled actuals + open reservations in the SAME
`BEGIN IMMEDIATE` transaction as the daily check: a call is admitted only if that sum + THIS call's worst case
<= the turn cap, so two calls of one request racing (a reroute and a naming call) cannot both slip under it.
A refusal never shortens the call (max_tokens is never lowered to fit): the call is not made, and the member
gets a fixed sentence (TURN_CAP_FIRST / TURN_CAP_LATER). docs/agent/budget/PER-TURN-CAP.md has the math and
the limits of the guarantee.

THE CALL CEILING (0B): at most UCT_AGENT_MAX_CALLS_PER_REQUEST (2) paid calls per
member request. A "member request" is one message sent to the model path; its
reroute (the browser asking again with more action groups) and its background
chat-naming call belong to the SAME request. The count moves inside the same
transaction as the reservation, so it is exact under concurrency.

Content-free: rows hold ids, categories, token counts and dollars -- never words or values.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from api.services import call_deadline

log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

DEFAULT_CAP_USD = 5.0
DEFAULT_MAX_CALLS = 2
DEFAULT_TURN_USD = 0.25
TURN_USD_ENV = "UCT_AGENT_TURN_USD"
# THE TURN DEADLINE, a maximum safety bound, from the per-call timeouts: planner v2's 6 default rounds at 60 s
# each, plus one research lookup's 4 attempts at 30 s. TurnClock below says how it is enforced.
DEFAULT_TURN_DEADLINE_S = 6 * 60.0 + 4 * 30.0
TURN_DEADLINE_ENV = "UCT_AGENT_TURN_DEADLINE_S"
#: Cache-write multipliers by TTL: the default (5 minute) cache write bills 1.25x input, a 1-hour write 2x.
CACHE_WRITE_MULT = 1.25
CACHE_WRITE_MULT_1H = 2.0
#: Provider framing a request's bytes do not show (structured-output instructions, role
#: markers). Generous on purpose: it only makes the reservation larger.
FRAMING_TOKENS = 4000
#: Research (Perplexity) worst case: the dearest search model's rates, a prompt allowance,
#: the request fee, times the client's attempts (1 + its retries).
RESEARCH_INPUT_TOKENS = 4000
RESEARCH_OUTPUT_TOKENS = 600
RESEARCH_RATES = (3.0, 15.0)            # $/MTok, the dearest rate in perplexity_search._PPLX_PRICES
RESEARCH_FEE_USD = 0.006
RESEARCH_ATTEMPTS = 4
#: A reservation still open after this long belongs to a call whose process died (request-path calls time out in
#: seconds): it is SETTLED at its worst case -- never released -- so the day stays conservative and rows don't pile up.
STALE_RESERVATION_S = 900
STALE_SWEEP_LIMIT = 200
#: A closed row a late reply may still confirm: closed without a reply, not settled from one.
LATE_OUTCOMES = ("deadline", "stale_worst_case")

AGENT_EXHAUSTED = ("UCT Agent has reached today's AI budget, so I can't interpret new requests until tomorrow. "
                   "Charts, breadth and other instant commands still work.")
SITE_EXHAUSTED = ("UCT's shared AI budget for today has been reached, so UCT Agent can't interpret new requests until "
                  "tomorrow. Charts, breadth and other instant commands still work.")
UNAVAILABLE = ("UCT Agent can't check its AI budget right now, so nothing was sent and nothing changed. "
               "Instant commands still work. Please try again shortly.")
TURN_DEADLINE = ("That request has been running too long, so I stopped before starting another AI step. "
                 "Try asking in smaller parts.")
STEP_LIMIT = "That request needed more AI steps than one request is allowed, so nothing was changed. Try asking in smaller parts."
TURN_CAP_FIRST = ("That request is larger than one turn's AI budget allows, so nothing was sent and nothing changed. "
                  "Try a shorter request or a new chat.")
TURN_CAP_LATER = ("That request reached one turn's AI budget, so I stopped before finishing it. Nothing was changed. "
                  "Try asking in smaller parts.")


class BudgetRefused(Exception):
    """A paid call was refused before it was made. `.sentence` is for the member; `.reason`
    ('agent_cap' | 'site_cap' | 'unavailable' | 'call_limit' | 'turn_cap') is for logs and tests."""

    def __init__(self, reason: str, sentence: str):
        super().__init__(reason)
        self.reason = reason
        self.sentence = sentence


def _num(env: str, default: float) -> float:
    """A positive number from the environment, else `default` -- 0, blank and garbage never
    read as "unlimited"."""
    try:
        v = float(os.environ.get(env, ""))
    except ValueError:
        return default
    return v if v > 0 else default


def cap_usd() -> float:
    return _num("UCT_AGENT_BUDGET_USD", DEFAULT_CAP_USD)


def turn_cap_usd() -> float:
    """One member request's dollar ceiling (v1 by request id here; planner v2 reads the same switch per turn)."""
    return _num(TURN_USD_ENV, DEFAULT_TURN_USD)


def turn_deadline_s() -> float:
    """How long one turn may keep STARTING paid calls. The environment can only shorten it."""
    return min(_num(TURN_DEADLINE_ENV, DEFAULT_TURN_DEADLINE_S), DEFAULT_TURN_DEADLINE_S)


def max_calls() -> int:
    return int(_num("UCT_AGENT_MAX_CALLS_PER_REQUEST", DEFAULT_MAX_CALLS))


def et_day() -> str:
    return datetime.now(_ET).strftime("%Y-%m-%d")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_spend (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  et_day             TEXT NOT NULL,
  user_id            TEXT,
  request_id         INTEGER,
  turn_request_id    INTEGER,            -- the member request every row belongs to (the per-turn cap)
  category           TEXT NOT NULL,      -- turn | schema_retry | research | reroute | title
  model              TEXT,
  status             TEXT NOT NULL,      -- reserved | settled | released
  reserved_usd       REAL NOT NULL,
  actual_usd         REAL NOT NULL DEFAULT 0,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  outcome            TEXT,               -- ok | no_usage | provider_error | worst_case
  created_at         INTEGER NOT NULL,
  settled_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_spend_day ON agent_spend(et_day, status);
CREATE TABLE IF NOT EXISTS agent_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  conversation_id TEXT,
  message_hash    TEXT NOT NULL,
  calls           INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_requests_user ON agent_requests(user_id, conversation_id, id);
"""
_READY_FOR: str | None = None


def _connect():
    """A connection to the Agent store in manual-transaction mode, with the ledger tables."""
    global _READY_FOR
    from api.services.uct_agent import store
    conn = store._connect()
    conn.isolation_level = None
    if _READY_FOR != store._DB_PATH:
        try:
            conn.executescript(_SCHEMA)
            _add_turn_column(conn)
        except Exception:
            conn.close()                     # never leak the connection on a failed first open
            raise
        _READY_FOR = store._DB_PATH
    return conn


def _add_turn_column(conn) -> None:
    """A ledger created before these columns gets them (older rows carry NULL). Two first opens racing may both
    see one missing: the loser's "duplicate column" means the winner already added it."""
    for table, column, kind in (("agent_spend", "turn_request_id", "INTEGER"), ("agent_spend", "confirmed_usd", "REAL"),
                                ("agent_requests", "closed_at", "INTEGER")):
        if column not in {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")
            except sqlite3.OperationalError as e:
                if "duplicate column" not in str(e).lower() and "no such table" not in str(e).lower():
                    raise
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_spend_turn ON agent_spend(turn_request_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_spend_open ON agent_spend(status, created_at)")   # the stale sweep


# ── worst cases ─────────────────────────────────────────────────────────────────────────────────
def _price(model: str, **tokens) -> float:
    from api.services import narrative_cost_guard
    return float(narrative_cost_guard.estimate_cost(
        model, tokens.get("input", 0), tokens.get("output", 0),
        cache_read_tokens=tokens.get("cache_read", 0), cache_creation_tokens=tokens.get("cache_write", 0)))


def request_bytes(kwargs: dict) -> int:
    """UTF-8 bytes of what the model reads. The output schema (`output_config`) is counted TWICE: the provider
    renders a structured-output schema into the prompt in addition to constraining the reply with it."""
    body = {k: kwargs.get(k) for k in ("system", "messages", "output_config", "tools", "tool_choice")}
    n = len(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))
    if kwargs.get("output_config") is not None:
        n += len(json.dumps(kwargs.get("output_config"), ensure_ascii=False, default=str).encode("utf-8"))
    return n


def _has_1h_cache(node: Any) -> bool:
    if isinstance(node, dict):
        cc = node.get("cache_control")
        if isinstance(cc, dict) and str(cc.get("ttl") or "") == "1h":
            return True
        return any(_has_1h_cache(v) for v in node.values())
    if isinstance(node, list):
        return any(_has_1h_cache(v) for v in node)
    return False


def worst_case_usd(kwargs: dict) -> float:
    """A conservative bound on one Messages call's cost, valid while its assumptions hold (tokens <= bytes +
    FRAMING_TOKENS, the price table is right, output is billed up to `max_tokens`): bytes as tokens + framing,
    all billed as a cache write (a 1-hour cache write, 2x, when any block asks for one), plus every output token
    it may write."""
    tokens = request_bytes(kwargs) + FRAMING_TOKENS
    if _has_1h_cache({k: kwargs.get(k) for k in ("system", "messages", "tools")}):
        tokens = int(tokens * CACHE_WRITE_MULT_1H / CACHE_WRITE_MULT) + 1     # priced at 2x instead of 1.25x
    return _price(str(kwargs.get("model") or ""), cache_write=tokens, output=int(kwargs.get("max_tokens") or 0))


def research_worst_case_usd() -> float:
    pin, pout = RESEARCH_RATES
    one = RESEARCH_INPUT_TOKENS * pin / 1e6 + RESEARCH_OUTPUT_TOKENS * pout / 1e6 + RESEARCH_FEE_USD
    return round(one * RESEARCH_ATTEMPTS, 6)


# ── member requests (the call ceiling) ──────────────────────────────────────────────────────────
def _hash(message: str) -> str:
    return hashlib.sha256(" ".join(str(message or "").split()).encode("utf-8")).hexdigest()[:32]


REROUTE_WINDOW_S = 300


def open_request(user_id: Any, conversation_id: str | None, message: str, reroute: bool = False) -> int | None:
    """The member request a /turn belongs to. A new message opens one; a reroute continues the
    latest request with the SAME message in the same chat (within REROUTE_WINDOW_S), so its calls
    count against the same ceiling. A reroute with nothing to continue returns None (refused)."""
    now = int(time.time())
    with contextlib.closing(_connect()) as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            if reroute:
                row = c.execute(
                    "SELECT id FROM agent_requests WHERE user_id = ? AND conversation_id IS ? AND message_hash = ?"
                    " AND created_at >= ? ORDER BY id DESC LIMIT 1",
                    (str(user_id), conversation_id, _hash(message), now - REROUTE_WINDOW_S)).fetchone()
                c.execute("COMMIT")
                return int(row[0]) if row else None
            c.execute("DELETE FROM agent_requests WHERE created_at < ?", (now - 86400,))
            cur = c.execute("INSERT INTO agent_requests (user_id, conversation_id, message_hash, calls, created_at)"
                            " VALUES (?,?,?,0,?)", (str(user_id), conversation_id, _hash(message), now))
            c.execute("COMMIT")
            return int(cur.lastrowid)
        except Exception:
            c.execute("ROLLBACK")
            raise


def latest_request(user_id: Any, within_s: int = REROUTE_WINDOW_S) -> int | None:
    """The member's newest request still open for follow-up work (REROUTE_WINDOW_S), or None. The server's own
    answer to "which turn is this for": a browser-supplied turn id names no request and can always be a new one."""
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT id FROM agent_requests WHERE user_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1",
                        (str(user_id), int(time.time()) - int(within_s))).fetchone()
    return int(row[0]) if row else None


def attach_conversation(request_id: int, conversation_id: str) -> None:
    """A new chat's id is known only after the request opened; record it so a reroute finds it."""
    with contextlib.closing(_connect()) as c:
        c.execute("UPDATE agent_requests SET conversation_id = ? WHERE id = ?", (conversation_id, int(request_id)))


def _sweep_stale(c, now: int) -> int:
    """Inside the caller's transaction: settle at most STALE_SWEEP_LIMIT reservations older than STALE_RESERVATION_S at
    their worst case (actual = reserved, outcome 'stale_worst_case'). Totals are unchanged; nothing is released."""
    return c.execute(
        "UPDATE agent_spend SET status='settled', actual_usd=reserved_usd, outcome='stale_worst_case', settled_at=?"
        " WHERE id IN (SELECT id FROM agent_spend WHERE status='reserved' AND created_at < ? ORDER BY id LIMIT ?)",
        (now, now - STALE_RESERVATION_S, STALE_SWEEP_LIMIT)).rowcount


def sweep_stale_reservations(now: int | None = None) -> int:
    with contextlib.closing(_connect()) as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            n = _sweep_stale(c, int(now if now is not None else time.time()))
            c.execute("COMMIT")
            return n
        except Exception:
            c.execute("ROLLBACK")
            raise


def _turn_sum(c, request_id: int) -> tuple[int, float]:
    """(rows, dollars) one member request has committed: settled actuals + open reservations
    (a released row -- a provider error response, never billed -- counts for neither)."""
    n, usd = c.execute(
        "SELECT COUNT(*), COALESCE(SUM(CASE status WHEN 'reserved' THEN reserved_usd ELSE actual_usd END), 0)"
        " FROM agent_spend WHERE turn_request_id = ? AND status != 'released'", (int(request_id),)).fetchone()
    return int(n or 0), float(usd or 0.0)


def turn_committed_usd(request_id: int) -> float:
    with contextlib.closing(_connect()) as c:
        return _turn_sum(c, request_id)[1]


def calls_used(request_id: int) -> int:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT calls FROM agent_requests WHERE id = ?", (int(request_id),)).fetchone()
    return int(row[0]) if row else 0


# ── the SHARED $15 ledger (read-only) ────────────────────────────────────────────────────────────
def site_spend_usd() -> tuple[float, float]:
    """(today's spend, the hard cap) of the SHARED $15 ledger (catalyst.cost_guard). READ-ONLY.
    ⛔ NOT site-wide: it covers catalyst synthesis + its support jobs, call recaps, sector reads and the
    indicator builder / vision (docs/agent/conversational-intelligence/GATE-B-BUDGET.md); other paid AI
    features have their own caps or none.
    The Agent never writes there (owner, option 1)."""
    import sqlite3
    from api.services.catalyst import cost_guard, store as catalyst_store
    try:
        total = cost_guard.spend_by_kind(et_day())["total"]
    except sqlite3.OperationalError as e:
        if "no such table" not in str(e):
            raise
        # a catalysts.db the web startup has not initialised yet (the same idempotent schema
        # main.py creates): an empty ledger is a real $0, anything else still fails closed
        catalyst_store._init_db()
        total = cost_guard.spend_by_kind(et_day())["total"]
    return float(total), float(cost_guard.hard_cap_usd())


# ── reserve / settle ────────────────────────────────────────────────────────────────────────────
def reserve(*, user_id: Any, request_id: int | None, category: str, model: str, worst_usd: float,
            site_reader: Callable[[], tuple[float, float]] | None = None, counts_as_call: bool = True,
            turn_request_id: int | None = None) -> int:
    """Admit one paid call or raise BudgetRefused. Returns the reservation id. `counts_as_call`:
    a MODEL call uses one of the request's calls; a research lookup (the search itself) does not --
    the model call that reads its results does. `turn_request_id`: the member request this call's dollars count
    against when it has no `request_id` (planner v2, a data-gateway lookup): the per-turn cap applies, the
    2-call ceiling does not."""
    turn_id = request_id if request_id is not None else turn_request_id
    try:
        site_spent, site_cap = (site_reader or site_spend_usd)()
    except Exception:  # noqa: BLE001 -- fail closed: no paid call without a readable site ledger
        log.exception("[uct-agent budget] shared $15 ledger unreadable; paid call refused")
        raise BudgetRefused("unavailable", UNAVAILABLE)
    if site_spent >= site_cap:
        raise BudgetRefused("site_cap", SITE_EXHAUSTED)
    day, cap, now = et_day(), cap_usd(), int(time.time())
    try:
        with contextlib.closing(_connect()) as c:
            c.execute("BEGIN IMMEDIATE")
            try:
                # A turn past its deadline starts nothing, through any Meter, in any process: this is the ledger's word
                if turn_id is not None and (c.execute("SELECT closed_at FROM agent_requests WHERE id = ?",
                                                      (int(turn_id),)).fetchone() or (None,))[0] is not None:
                    c.execute("ROLLBACK")
                    raise BudgetRefused("turn_deadline", TURN_DEADLINE)
                if request_id is not None and counts_as_call:
                    moved = c.execute("UPDATE agent_requests SET calls = calls + 1 WHERE id = ? AND calls < ?",
                                      (int(request_id), max_calls())).rowcount
                    if not moved:
                        c.execute("ROLLBACK")
                        raise BudgetRefused("call_limit", STEP_LIMIT)
                _sweep_stale(c, now)
                committed = float(c.execute(
                    "SELECT COALESCE(SUM(CASE status WHEN 'reserved' THEN reserved_usd ELSE actual_usd END), 0)"
                    " FROM agent_spend WHERE et_day = ?", (day,)).fetchone()[0] or 0.0)
                if round(committed + worst_usd, 6) > round(cap, 6):     # cents-exact, no float drift
                    c.execute("ROLLBACK")
                    raise BudgetRefused("agent_cap", AGENT_EXHAUSTED)
                if turn_id is not None:
                    # THE PER-TURN CAP: this request's settled actuals + open reservations (on any day: a
                    # request that straddles midnight is still one turn) + this call's worst case
                    n_rows, turn_committed = _turn_sum(c, turn_id)
                    if round(turn_committed + worst_usd, 6) > round(turn_cap_usd(), 6):
                        c.execute("ROLLBACK")
                        raise BudgetRefused("turn_cap", TURN_CAP_LATER if n_rows else TURN_CAP_FIRST)
                cur = c.execute(
                    "INSERT INTO agent_spend (et_day, user_id, request_id, turn_request_id, category, model, status,"
                    " reserved_usd, created_at) VALUES (?,?,?,?,?,?,'reserved',?,?)",
                    (day, None if user_id is None else str(user_id), request_id if counts_as_call else None,
                     turn_id, category, model, round(float(worst_usd), 6), now))
                c.execute("COMMIT")
                return int(cur.lastrowid)
            except BudgetRefused:
                raise
            except Exception:
                c.execute("ROLLBACK")
                raise
    except BudgetRefused:
        raise
    except Exception:  # noqa: BLE001 -- fail closed
        log.exception("[uct-agent budget] ledger write failed; paid call refused")
        raise BudgetRefused("unavailable", UNAVAILABLE)


def settle(reservation_id: int, *, actual_usd: float | None, tokens: dict | None = None, outcome: str = "ok") -> float:
    """Replace a reservation with what was spent. `actual_usd=None` (usage missing) charges the
    reservation's worst case. Returns the dollars now counted. Never raises into a request: a
    failed settle leaves the row RESERVED, which keeps counting at the worst case."""
    t = tokens or {}
    try:
        with contextlib.closing(_connect()) as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT reserved_usd, status, outcome FROM agent_spend WHERE id = ?", (int(reservation_id),)).fetchone()
            if row and row[1] != "reserved" and row[2] in LATE_OUTCOMES and actual_usd is not None:
                # A reply after the row was closed: kept as the confirmed figure. The charge stands, so it counts once.
                if float(actual_usd) > float(row[0]):
                    log.error("[uct-agent budget] a late reply exceeded its worst case (reservation %s)", reservation_id)
                c.execute("UPDATE agent_spend SET confirmed_usd=?, input_tokens=?, output_tokens=?, cache_read_tokens=?,"
                          " cache_write_tokens=? WHERE id = ?",
                          (round(float(actual_usd), 6), int(t.get("input", 0)), int(t.get("output", 0)),
                           int(t.get("cache_read", 0)), int(t.get("cache_write", 0)), int(reservation_id)))
                c.execute("COMMIT")
                return 0.0
            if not row or row[1] != "reserved":
                c.execute("ROLLBACK")
                return 0.0
            reserved = float(row[0])
            if actual_usd is None:
                charged, outcome = reserved, ("no_usage" if outcome == "ok" else outcome)
            else:
                charged = float(actual_usd)
                if charged > reserved:
                    # The bound's assumptions failed (docs/agent/budget/PER-TURN-CAP.md): the real figure is kept
                    # (never hidden), so later calls see it, and the bound is logged as wrong.
                    log.error("[uct-agent budget] actual cost exceeded its worst case (reservation %s)", reservation_id)
            confirmed = None if actual_usd is None or outcome == "partial" else round(charged, 6)
            c.execute("UPDATE agent_spend SET status='settled', actual_usd=?, confirmed_usd=?, input_tokens=?, output_tokens=?,"
                      " cache_read_tokens=?, cache_write_tokens=?, outcome=?, settled_at=? WHERE id = ?",
                      (round(charged, 6), confirmed, int(t.get("input", 0)), int(t.get("output", 0)), int(t.get("cache_read", 0)),
                       int(t.get("cache_write", 0)), outcome, int(time.time()), int(reservation_id)))
            c.execute("COMMIT")
            return charged
    except Exception:  # noqa: BLE001
        log.exception("[uct-agent budget] settle failed; the reservation keeps counting at its worst case")
        return 0.0


def release(reservation_id: int, *, outcome: str = "provider_error") -> None:
    """The provider refused the call with an error response: nothing was generated or billed.
    The reservation is dropped and the request's call count given back."""
    try:
        with contextlib.closing(_connect()) as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT request_id FROM agent_spend WHERE id = ? AND status = 'reserved'",
                            (int(reservation_id),)).fetchone()
            c.execute("UPDATE agent_spend SET status='released', actual_usd=0, outcome=?, settled_at=?"
                      " WHERE id = ? AND status = 'reserved'", (outcome, int(time.time()), int(reservation_id)))
            if row and row[0] is not None:
                c.execute("UPDATE agent_requests SET calls = MAX(0, calls - 1) WHERE id = ?", (int(row[0]),))
            c.execute("COMMIT")
    except Exception:  # noqa: BLE001 -- the row stays reserved: over-counts, never under-counts
        log.exception("[uct-agent budget] release failed; the reservation keeps counting")


def _usage_tokens(resp) -> dict:
    u = getattr(resp, "usage", None)
    return {"input": int(getattr(u, "input_tokens", 0) or 0), "output": int(getattr(u, "output_tokens", 0) or 0),
            "cache_read": int(getattr(u, "cache_read_input_tokens", 0) or 0),
            "cache_write": int(getattr(u, "cache_creation_input_tokens", 0) or 0)}


def _is_provider_error_response(e: BaseException) -> bool:
    """An HTTP error status from the provider (nothing generated, nothing billed). A timeout or a
    dropped connection is NOT one: the call may have run, so it is charged at the worst case.

    Nor is an error event in a stream. The SDK raises that as an APIStatusError too, carrying the 200 the
    stream began with, and generation had started: the provider's docs do not say such a call is free, so
    it is treated as billed. Only a status of 400 or above counts."""
    try:
        import anthropic
        return isinstance(e, anthropic.APIStatusError) and int(getattr(e, "status_code", 0) or 0) >= 400
    except Exception:  # noqa: BLE001
        return False


class TurnClock:
    """The one deadline of a member's turn. `used_s` is the active time a paused turn already spent, so a run of
    resumes cannot each start a fresh deadline; the time a member spends on an approval card is not active time.

    ENFORCEMENT, cooperative because Python cannot kill a thread: no paid call starts past it, each model and
    lookup timeout is capped to what is left (call_deadline), a stream stops reading, and a wait on the browser
    ends. `expire()` is the backstop for a worker that is still blocked: limits.guard calls it, and it runs each
    cleanup once, so nothing the turn holds outlives the deadline even while that thread is stuck. `on_stuck` is
    only for that case: a worker that came back delivers its own last word, so nothing may end its stream first."""

    def __init__(self, used_s: float = 0.0):
        self.started = time.monotonic()
        self.used_before_s = max(0.0, float(used_s or 0.0))
        self.at = self.started + turn_deadline_s() - self.used_before_s
        self.expired = threading.Event()
        self._cleanups: list[Callable[[], None]] = []
        self._stuck: list[Callable[[], None]] = []
        self._lock = threading.Lock()

    def left(self) -> float:
        return self.at - time.monotonic()

    def used_s(self) -> float:
        return self.used_before_s + (time.monotonic() - self.started)

    def on_expire(self, fn: Callable[[], None]) -> None:
        with self._lock:
            self._cleanups.append(fn)

    def on_stuck(self, fn: Callable[[], None]) -> None:
        with self._lock:
            self._stuck.append(fn)

    def expire(self, worker_stuck: bool = False) -> None:
        """Run every cleanup, once, and the stuck-worker ones if the worker never came back. One that fails never
        stops the others."""
        self.expired.set()
        with self._lock:
            cleanups, self._cleanups = self._cleanups, []
            if worker_stuck:
                cleanups, self._stuck = cleanups + self._stuck, []
        for fn in cleanups:
            try:
                fn()
            except Exception:  # noqa: BLE001
                log.exception("[uct-agent budget] a turn deadline cleanup failed")


def close_turn(turn_request_id: int | None) -> int:
    """End a turn on the ledger: nothing more can be reserved for it, and its open reservations close AT THEIR WORST
    CASE, as estimates (`confirmed_usd` stays NULL). Never released to $0: a call still running may be billed, and $0
    would let the daily cap undercount. A late reply only fills `confirmed_usd`, so it cannot lower the charge.
    This ends the REQUEST, so the browser's reroute of a request that hit its deadline is refused the same way."""
    if turn_request_id is None:
        return 0
    try:
        with contextlib.closing(_connect()) as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("UPDATE agent_requests SET closed_at = COALESCE(closed_at, ?) WHERE id = ?",
                      (int(time.time()), int(turn_request_id)))
            n = c.execute("UPDATE agent_spend SET status='settled', actual_usd=reserved_usd, outcome='deadline',"
                          " settled_at=? WHERE turn_request_id = ? AND status='reserved'",
                          (int(time.time()), int(turn_request_id))).rowcount
            c.execute("COMMIT")
            return n
    except Exception:  # noqa: BLE001 -- the row stays reserved: it counts at its worst case and the stale sweep closes it
        log.exception("[uct-agent budget] could not close a turn on the ledger")
        return 0


class Meter:
    """The paid-call gate for one member request: every Messages call and research lookup goes
    through `call` / `research`. `None` user/request (scripts, tests) still meters dollars.
    `turn_request_id`: see reserve(). `heartbeat`: called before each paid call, so a slow request keeps its
    in-flight lease (limits.renew)."""

    def __init__(self, *, user_id: Any, request_id: int | None, site_reader=None, turn_request_id: int | None = None,
                 heartbeat: Callable[[], None] | None = None, clock: TurnClock | None = None):
        self.user_id = user_id
        self.request_id = request_id
        self.turn_request_id = request_id if request_id is not None else turn_request_id
        self.site_reader = site_reader
        self.heartbeat = heartbeat
        self.spent_usd = 0.0
        self.clock = clock or TurnClock()
        self.clock.on_expire(lambda: close_turn(self.turn_request_id))

    @property
    def deadline(self) -> float:
        return self.clock.at

    @deadline.setter
    def deadline(self, at: float) -> None:
        self.clock.at = min(self.clock.at, at)         # a deadline can only come sooner

    def _check_deadline(self) -> None:
        """Refused before anything is sent. The turn ends on the ledger too, so no other Meter can carry on with it."""
        if self.clock.left() <= 0:
            close_turn(self.turn_request_id)
            raise BudgetRefused("turn_deadline", TURN_DEADLINE)

    def _check_still_in_time(self, rid: int) -> None:
        """`reserve` can wait on the store for seconds: a deadline that passed meanwhile sends nothing."""
        if self.clock.left() <= 0:
            release(rid, outcome="deadline_unsent")
            self._check_deadline()

    def calls_left(self) -> int:
        if self.request_id is None:
            return max_calls()
        return max(0, max_calls() - calls_used(self.request_id))

    def turn_room_usd(self) -> float | None:
        """Dollars this member request may still commit under the per-turn cap (None: no request,
        no per-turn cap -- scripts)."""
        if self.turn_request_id is None:
            return None
        return turn_cap_usd() - turn_committed_usd(self.turn_request_id)

    def affords(self, *worst_usd: float) -> bool:
        """Would calls with these worst cases, made one after another, fit this request's per-turn cap?
        A PRE-CHECK only (reserve() decides each call): used to skip an optional step (a repair, a lookup)
        up front instead of starting work the cap would stop half-way."""
        room = self.turn_room_usd()
        return room is None or round(sum(worst_usd), 6) <= round(room, 6)

    def call(self, category: str, fn: Callable[..., Any], *, counts_as_call: bool = True, **kwargs) -> Any:
        """`counts_as_call=False` (only E-1's evidence classifier, knowledge/evidence.py): the call is admitted and
        settled against the daily and site caps exactly like any other, but does not use one of the request's calls,
        so a classified turn keeps its planner call, its reroute and its research round. It still counts toward the
        request's per-turn dollar cap (every row carries its request)."""
        self._check_deadline()
        model = str(kwargs.get("model") or "")
        worst = worst_case_usd(kwargs)
        rid = reserve(user_id=self.user_id, request_id=self.request_id, category=category, model=model,
                      worst_usd=worst, site_reader=self.site_reader, counts_as_call=counts_as_call,
                      turn_request_id=self.turn_request_id)
        self._check_still_in_time(rid)
        if self.heartbeat is not None:
            self.heartbeat()
        try:
            with call_deadline.until(self.clock.at):
                resp = fn(**kwargs)
        except Exception as e:
            partial = getattr(e, "uct_usage", None)
            if isinstance(e, call_deadline.NotStarted):
                release(rid, outcome="deadline_unsent")
            elif isinstance(partial, dict):
                # a stream that failed AFTER the provider reported its input (even with an error event: generation
                # had started, so it is never released): the input as reported, the output at its ceiling (what
                # was generated but never received is unknown)
                t = {k: int(partial.get(k) or 0) for k in ("input", "cache_read", "cache_write")}
                t["output"] = int(kwargs.get("max_tokens") or 0)
                self.spent_usd += settle(rid, actual_usd=min(worst, _price(model, **t)), tokens=t, outcome="partial")
            elif _is_provider_error_response(e):
                release(rid)
            else:
                self.spent_usd += settle(rid, actual_usd=None, outcome="worst_case")
            self._check_deadline()               # settled first: the member's sentence, nothing left open
            raise
        if getattr(resp, "usage", None) is None:
            self.spent_usd += settle(rid, actual_usd=None)
        else:
            t = _usage_tokens(resp)
            self.spent_usd += settle(rid, actual_usd=_price(model, input=t["input"], output=t["output"],
                                                              cache_read=t["cache_read"], cache_write=t["cache_write"]),
                                     tokens=t)
        return resp

    def research(self, fn: Callable[[], dict]) -> dict:
        self._check_deadline()
        rid = reserve(user_id=self.user_id, request_id=self.request_id, category="research", model="perplexity",
                      worst_usd=research_worst_case_usd(), site_reader=self.site_reader, counts_as_call=False,
                      turn_request_id=self.turn_request_id)
        self._check_still_in_time(rid)
        if self.heartbeat is not None:
            self.heartbeat()
        try:
            with call_deadline.until(self.clock.at):
                res = fn()
        except Exception:
            self.spent_usd += settle(rid, actual_usd=None, outcome="worst_case")
            self._check_deadline()
            raise
        if isinstance(res, dict) and res.get("cached"):
            self.spent_usd += settle(rid, actual_usd=0.0, outcome="cached")
        elif isinstance(res, dict) and (int(res.get("attempts") or 1) > 1 or res.get("usage_reported") is False):
            # the returned cost prices only the LAST attempt from its usage: earlier attempts may have been billed and
            # missing usage prices only the fee -- the whole reservation (every attempt's worst case) is kept
            self.spent_usd += settle(rid, actual_usd=None, outcome="research_retried" if int(res.get("attempts") or 1) > 1
                                     else "no_usage")
        elif isinstance(res, dict) and isinstance(res.get("cost_usd"), (int, float)):
            self.spent_usd += settle(rid, actual_usd=float(res["cost_usd"]))
        else:
            self.spent_usd += settle(rid, actual_usd=None)
        return res


# ── the owner's view ────────────────────────────────────────────────────────────────────────────
def state(day: str | None = None) -> dict:
    """Today's Agent spend for the admin budget view: aggregates only (no member ids or words)."""
    day = day or et_day()
    with contextlib.closing(_connect()) as c:
        r = c.execute(
            "SELECT COALESCE(SUM(CASE status WHEN 'settled' THEN actual_usd ELSE 0 END),0),"
            " COALESCE(SUM(CASE status WHEN 'reserved' THEN reserved_usd ELSE 0 END),0),"
            " SUM(status='settled'), SUM(status='reserved'), SUM(status='released'),"
            " COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),"
            " COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_write_tokens),0),"
            " COALESCE(SUM(confirmed_usd),0),"
            " COALESCE(SUM(CASE WHEN status='settled' AND confirmed_usd IS NULL THEN actual_usd ELSE 0 END),0),"
            " SUM(outcome IN ('no_usage','worst_case','partial','research_retried','stale_worst_case','deadline'))"
            " FROM agent_spend WHERE et_day = ?", (day,)).fetchone()
        by_cat = {row[0]: round(float(row[1] or 0), 6) for row in c.execute(
            "SELECT category, SUM(CASE status WHEN 'reserved' THEN reserved_usd ELSE actual_usd END)"
            " FROM agent_spend WHERE et_day = ? GROUP BY category", (day,)).fetchall()}
        models = [row[0] for row in c.execute(
            "SELECT DISTINCT model FROM agent_spend WHERE et_day = ? AND model IS NOT NULL", (day,)).fetchall()]
    settled, open_ = float(r[0] or 0), float(r[1] or 0)
    cap = cap_usd()
    out = {"et_day": day, "cap_usd": cap, "settled_usd": round(settled, 6), "reserved_usd": round(open_, 6),
           "committed_usd": round(settled + open_, 6), "remaining_usd": round(max(0.0, cap - settled - open_), 6),
           "confirmed_usd": round(float(r[9] or 0), 6), "estimated_usd": round(float(r[10] or 0), 6),
           "calls": {"settled": int(r[2] or 0), "open": int(r[3] or 0), "released": int(r[4] or 0),
                     "charged_worst_case": int(r[11] or 0)},
           "tokens": {"input": int(r[5]), "output": int(r[6]), "cache_read": int(r[7]), "cache_write": int(r[8])},
           "by_category": by_cat, "models": models, "max_calls_per_request": max_calls(), "turn_cap_usd": turn_cap_usd()}
    try:
        site_spent, site_cap = site_spend_usd()
        out["site"] = {"spent_usd": round(site_spent, 4), "cap_usd": site_cap, "agent_paused": site_spent >= site_cap}
    except Exception:  # noqa: BLE001
        out["site"] = {"unreadable": True}
    return out


def _reset_for_test() -> None:
    with contextlib.closing(_connect()) as c:
        c.execute("DELETE FROM agent_spend")
        c.execute("DELETE FROM agent_requests")
