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
  * The worst case is an upper bound, not a guess: every UTF-8 byte of the request
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
import time
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

DEFAULT_CAP_USD = 5.0
DEFAULT_MAX_CALLS = 2
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

AGENT_EXHAUSTED = ("UCT Agent has reached today's AI budget, so I can't interpret new requests until tomorrow. "
                   "Charts, breadth and other instant commands still work.")
SITE_EXHAUSTED = ("UCT's shared AI budget for today has been reached, so UCT Agent can't interpret new requests until "
                  "tomorrow. Charts, breadth and other instant commands still work.")
UNAVAILABLE = ("UCT Agent can't check its AI budget right now, so nothing was sent and nothing changed. "
               "Instant commands still work. Please try again shortly.")
STEP_LIMIT = "That request needed more AI steps than one request is allowed, so nothing was changed. Try asking in smaller parts."


class BudgetRefused(Exception):
    """A paid call was refused before it was made. `.sentence` is for the member; `.reason`
    ('agent_cap' | 'site_cap' | 'unavailable' | 'call_limit') is for logs and tests."""

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
        conn.executescript(_SCHEMA)
        _READY_FOR = store._DB_PATH
    return conn


# ── worst cases ─────────────────────────────────────────────────────────────────────────────────
def _price(model: str, **tokens) -> float:
    from api.services import narrative_cost_guard
    return float(narrative_cost_guard.estimate_cost(
        model, tokens.get("input", 0), tokens.get("output", 0),
        cache_read_tokens=tokens.get("cache_read", 0), cache_creation_tokens=tokens.get("cache_write", 0)))


def request_bytes(kwargs: dict) -> int:
    body = {k: kwargs.get(k) for k in ("system", "messages", "output_config", "tools", "tool_choice")}
    return len(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"))


def worst_case_usd(kwargs: dict) -> float:
    """An upper bound on one Messages call's cost: bytes as tokens + framing, all billed as a
    cache write, plus every output token it may write."""
    return _price(str(kwargs.get("model") or ""), cache_write=request_bytes(kwargs) + FRAMING_TOKENS,
                  output=int(kwargs.get("max_tokens") or 0))


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


def attach_conversation(request_id: int, conversation_id: str) -> None:
    """A new chat's id is known only after the request opened; record it so a reroute finds it."""
    with contextlib.closing(_connect()) as c:
        c.execute("UPDATE agent_requests SET conversation_id = ? WHERE id = ?", (conversation_id, int(request_id)))


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
            site_reader: Callable[[], tuple[float, float]] | None = None, counts_as_call: bool = True) -> int:
    """Admit one paid call or raise BudgetRefused. Returns the reservation id. `counts_as_call`:
    a MODEL call uses one of the request's calls; a research lookup (the search itself) does not --
    the model call that reads its results does."""
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
                if request_id is not None and counts_as_call:
                    moved = c.execute("UPDATE agent_requests SET calls = calls + 1 WHERE id = ? AND calls < ?",
                                      (int(request_id), max_calls())).rowcount
                    if not moved:
                        c.execute("ROLLBACK")
                        raise BudgetRefused("call_limit", STEP_LIMIT)
                committed = float(c.execute(
                    "SELECT COALESCE(SUM(CASE status WHEN 'reserved' THEN reserved_usd ELSE actual_usd END), 0)"
                    " FROM agent_spend WHERE et_day = ?", (day,)).fetchone()[0] or 0.0)
                if round(committed + worst_usd, 6) > round(cap, 6):     # cents-exact, no float drift
                    c.execute("ROLLBACK")
                    raise BudgetRefused("agent_cap", AGENT_EXHAUSTED)
                cur = c.execute(
                    "INSERT INTO agent_spend (et_day, user_id, request_id, category, model, status, reserved_usd,"
                    " created_at) VALUES (?,?,?,?,?,'reserved',?,?)",
                    (day, None if user_id is None else str(user_id), request_id if counts_as_call else None,
                     category, model, round(float(worst_usd), 6), now))
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
            row = c.execute("SELECT reserved_usd, status FROM agent_spend WHERE id = ?", (int(reservation_id),)).fetchone()
            if not row or row[1] != "reserved":
                c.execute("ROLLBACK")
                return 0.0
            reserved = float(row[0])
            if actual_usd is None:
                charged, outcome = reserved, ("no_usage" if outcome == "ok" else outcome)
            else:
                charged = float(actual_usd)
                if charged > reserved:
                    # By construction this cannot happen; if it ever does, the real figure is kept
                    # (never hidden) and the bound is logged as wrong.
                    log.error("[uct-agent budget] actual cost exceeded its worst case (reservation %s)", reservation_id)
            c.execute("UPDATE agent_spend SET status='settled', actual_usd=?, input_tokens=?, output_tokens=?,"
                      " cache_read_tokens=?, cache_write_tokens=?, outcome=?, settled_at=? WHERE id = ?",
                      (round(charged, 6), int(t.get("input", 0)), int(t.get("output", 0)), int(t.get("cache_read", 0)),
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
    dropped connection is NOT one: the call may have run, so it is charged at the worst case."""
    try:
        import anthropic
        return isinstance(e, anthropic.APIStatusError)
    except Exception:  # noqa: BLE001
        return False


class Meter:
    """The paid-call gate for one member request: every Messages call and research lookup goes
    through `call` / `research`. `None` user/request (scripts, tests) still meters dollars."""

    def __init__(self, *, user_id: Any, request_id: int | None, site_reader=None):
        self.user_id = user_id
        self.request_id = request_id
        self.site_reader = site_reader
        self.spent_usd = 0.0

    def calls_left(self) -> int:
        if self.request_id is None:
            return max_calls()
        return max(0, max_calls() - calls_used(self.request_id))

    def call(self, category: str, fn: Callable[..., Any], **kwargs) -> Any:
        model = str(kwargs.get("model") or "")
        rid = reserve(user_id=self.user_id, request_id=self.request_id, category=category, model=model,
                      worst_usd=worst_case_usd(kwargs), site_reader=self.site_reader)
        try:
            resp = fn(**kwargs)
        except Exception as e:
            if _is_provider_error_response(e):
                release(rid)
            else:
                self.spent_usd += settle(rid, actual_usd=None, outcome="worst_case")
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
        rid = reserve(user_id=self.user_id, request_id=self.request_id, category="research", model="perplexity",
                      worst_usd=research_worst_case_usd(), site_reader=self.site_reader, counts_as_call=False)
        try:
            res = fn()
        except Exception:
            self.spent_usd += settle(rid, actual_usd=None, outcome="worst_case")
            raise
        if isinstance(res, dict) and res.get("cached"):
            self.spent_usd += settle(rid, actual_usd=0.0, outcome="cached")
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
            " SUM(outcome IN ('no_usage','worst_case'))"
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
           "calls": {"settled": int(r[2] or 0), "open": int(r[3] or 0), "released": int(r[4] or 0),
                     "charged_worst_case": int(r[9] or 0)},
           "tokens": {"input": int(r[5]), "output": int(r[6]), "cache_read": int(r[7]), "cache_write": int(r[8])},
           "by_category": by_cat, "models": models, "max_calls_per_request": max_calls()}
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
