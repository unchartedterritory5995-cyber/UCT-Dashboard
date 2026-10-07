"""Contract fixtures for the wave 12 to 15 Notebook endpoints.

WHY THIS EXISTS. Every frontend test of these surfaces used to type the server's response by
hand and mock `fetch` with it, so the client and the server could drift apart with both unit
suites green (it already happened once: the chart plan panel read `points` where the server
sent `price`). This tool asks the REAL routers for their REAL answers and writes them to

    app/src/pages/journal-2-0/__fixtures__/contract/<name>.json

The frontend tests load those files. `tests/test_notebook_contract_fixtures.py` regenerates
them in memory and fails when the committed files differ, so a server change that alters a
shape forces a deliberate regeneration, and the regenerated file then runs through the
frontend tests that consume it.

HOW IT RUNS. In process, FastAPI's TestClient over the real routers, on a temporary database:

  * `import conftest` comes BEFORE any `api.*` import. That applies the census pins (every
    `/data/...` path variable goes to a sandbox) and arms the shared-root tripwire, so nothing
    here can reach `C:\\data`. The run fails if the tripwire recorded anything.
  * A fresh temporary `auth.db` per run. Never the session's, never a shared one.
  * The clock is frozen at `FROZEN_NOW`, ids come from a seeded counter, and any timestamp
    SQLite stamped with the real clock is rewritten to the frozen one. Two runs are
    byte-identical; the pytest proves it by running the generator twice.
  * Outside sources (prices, the earnings calendar, the regime, the screener store) are
    replaced with fixed stand-ins, exactly as the backend tests do. The fixtures therefore pin
    the SHAPE and the composition the server emits, never a live market value.

USAGE
    python tools/notebook_contract_fixtures.py            # write the fixtures
    python tools/notebook_contract_fixtures.py --check    # exit 1 when the committed files differ
    python tools/notebook_contract_fixtures.py --list     # print the fixture names

Each file is `{"_contract": {endpoint, case, status, request...}, "body": <the response JSON>}`.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as _dt
import hashlib
import importlib
import json
import os
import re
import sys
import tempfile
import time as _time
import uuid as _uuid
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import conftest  # noqa: E402,F401 -- the census pins and the tripwire, before any api.* import

FIXTURE_DIR = ROOT / "app" / "src" / "pages" / "journal-2-0" / "__fixtures__" / "contract"

#: Monday 2026-10-05, 10:30 in New York. Every "now" the generator's code path asks for.
FROZEN_NOW = _dt.datetime(2026, 10, 5, 14, 30, 0, tzinfo=_dt.timezone.utc)
TODAY = "2026-10-05"

MEMBER = "contract-member"      # has data
EMPTY = "contract-empty"        # has nothing: the empty-state responses
OTHER = "contract-other"        # owns rows MEMBER must never see
ADMIN = "contract-admin"
PAID = {"plan": "pro"}
FREE = {"plan": "free"}

FLAGS = (
    "NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "NOTEBOOK_CHART_PLAN_ENABLED", "NOTEBOOK_EARNINGS_PREP_ENABLED",
    "NOTEBOOK_ENTRY_CONTEXT_ENABLED", "NOTEBOOK_TA_FINGERPRINT_ENABLED", "NOTEBOOK_PLAN_GRADING_ENABLED",
    "NOTEBOOK_PLAYBOOK_ENABLED", "NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED", "NOTEBOOK_PASSED_SETUPS_ENABLED",
    "NOTEBOOK_REVIEW_DRAFTS_ENABLED", "NOTEBOOK_SETUPS_BOARD_ENABLED", "NOTEBOOK_FIND_SIMILAR_ENABLED",
    "NOTEBOOK_THESIS_CHIPS_ENABLED", "NOTEBOOK_VISUAL_PLAYBOOK_ENABLED",
)


# ── determinism: the clock, the ids, the undo list ────────────────────────────────────────────

class _Patches:
    """setattr / setenv with an undo list (pytest's monkeypatch, usable outside pytest)."""

    def __init__(self) -> None:
        self._undo: list[Callable[[], None]] = []

    def setattr(self, obj: Any, name: str, value: Any) -> None:
        missing = object()
        old = getattr(obj, name, missing)
        setattr(obj, name, value)
        self._undo.append((lambda: delattr(obj, name)) if old is missing else (lambda: setattr(obj, name, old)))

    def setenv(self, name: str, value: str | None) -> None:
        old = os.environ.get(name)
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
        self._undo.append((lambda: os.environ.pop(name, None)) if old is None
                          else (lambda: os.environ.__setitem__(name, old)))

    def undo(self) -> None:
        while self._undo:
            self._undo.pop()()


_REAL_DATETIME = _dt.datetime
_REAL_DATE = _dt.date


class _DatetimeMeta(type):
    def __instancecheck__(cls, obj: Any) -> bool:   # a real datetime is still "a datetime"
        return isinstance(obj, _REAL_DATETIME)


class _DateMeta(type):
    def __instancecheck__(cls, obj: Any) -> bool:
        return isinstance(obj, _REAL_DATE)


class _FrozenDatetime(_REAL_DATETIME, metaclass=_DatetimeMeta):
    @classmethod
    def now(cls, tz: Any = None):  # noqa: ANN206
        # A naive "now" is read as UTC so the output does not depend on the box's time zone.
        return FROZEN_NOW.astimezone(tz) if tz is not None else FROZEN_NOW.replace(tzinfo=None)

    @classmethod
    def utcnow(cls):  # noqa: ANN206
        return FROZEN_NOW.replace(tzinfo=None)

    @classmethod
    def today(cls):  # noqa: ANN206
        return FROZEN_NOW.replace(tzinfo=None)


class _FrozenDate(_REAL_DATE, metaclass=_DateMeta):
    @classmethod
    def today(cls):  # noqa: ANN206
        return _REAL_DATE(FROZEN_NOW.year, FROZEN_NOW.month, FROZEN_NOW.day)


def _deterministic_uuid4() -> Callable[[], _uuid.UUID]:
    counter = [0]

    def uuid4() -> _uuid.UUID:
        counter[0] += 1
        # Hashed, not sequential: code that keeps only `hex[:10]` must still get distinct ids.
        return _uuid.UUID(hashlib.md5(f"notebook-contract-{counter[0]}".encode()).hexdigest(), version=4)
    return uuid4


NETWORK_ATTEMPTS: list[str] = []
_LOOPBACK = ("127.", "::1", "localhost", "0.0.0.0")


def _no_network(p: _Patches) -> None:
    """Fail closed on any outbound connection. The TestClient speaks to the app in process, so a
    socket leaving the box here is a vendor call nobody replaced; it is refused, recorded, and
    the run fails. Loopback stays open (the event loop's own wake-up pair uses it on Windows)."""
    import socket
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def _host(address: Any) -> str:
        return str(address[0]) if isinstance(address, tuple) and address else str(address)

    def connect(self: Any, address: Any) -> Any:
        host = _host(address)
        if not host.startswith(_LOOPBACK):
            NETWORK_ATTEMPTS.append(host)
            raise OSError(f"notebook_contract_fixtures: outbound connection refused ({host})")
        return real_connect(self, address)

    def connect_ex(self: Any, address: Any) -> Any:
        host = _host(address)
        if not host.startswith(_LOOPBACK):
            NETWORK_ATTEMPTS.append(host)
            raise OSError(f"notebook_contract_fixtures: outbound connection refused ({host})")
        return real_connect_ex(self, address)

    p.setattr(socket.socket, "connect", connect)
    p.setattr(socket.socket, "connect_ex", connect_ex)
    # yfinance can go out through libcurl, where a socket guard never sees it: close that door too.
    import yfinance

    def no_yahoo(*args: Any, **kwargs: Any) -> Any:
        NETWORK_ATTEMPTS.append(f"yfinance:{args[0] if args else '?'}")
        raise OSError("notebook_contract_fixtures: outbound connection refused (yfinance)")
    p.setattr(yfinance, "Ticker", no_yahoo)
    p.setattr(yfinance, "download", no_yahoo)


def _freeze(p: _Patches) -> None:
    """Freeze "now" and make ids repeatable for every `api.*` module already imported, and for
    any module that reads `datetime.datetime` / `uuid.uuid4` / `time.time` late."""
    uuid4 = _deterministic_uuid4()
    frozen_epoch = FROZEN_NOW.timestamp()
    p.setattr(_dt, "datetime", _FrozenDatetime)
    p.setattr(_dt, "date", _FrozenDate)
    p.setattr(_uuid, "uuid4", uuid4)
    p.setattr(_time, "time", lambda: frozen_epoch)
    for name, mod in list(sys.modules.items()):
        if mod is None or not (name == "api" or name.startswith("api.")):
            continue
        d = getattr(mod, "__dict__", {})
        if d.get("datetime") is _REAL_DATETIME:
            p.setattr(mod, "datetime", _FrozenDatetime)
        if d.get("date") is _REAL_DATE:
            p.setattr(mod, "date", _FrozenDate)
        if getattr(d.get("uuid4"), "__module__", None) == "uuid":
            p.setattr(mod, "uuid4", uuid4)


#: Every module a builder imports or patches. See `World.__enter__`.
_PREIMPORT = (
    "pandas", "yfinance",
    "api.services.engine", "api.services.brain_service", "api.services.breadth_live",
    "api.services.earnings_table", "api.services.earnings_intel", "api.services.rs_ranking",
    "api.services.user_definitions", "api.services.screener.scan_store", "api.services.bars_sqlite",
    "api.services.calendar_alerts", "api.services.calendar_personalization", "api.services.call_recap_store",
    "api.services.implied_store", "api.services.daily_counters", "api.routers.watchlist_alerts",
    "api.services.watchlist_alert_service", "api.services.ticker_meta", "api.services.entity_master.api",
    "api.services.journal_two.ticker_research", "api.services.fmp_transcripts", "api.services.transcript_index",
    "api.services.journal_two.note_excerpts", "api.services.journal_two.web_capture",
    "api.services.journal_two.web_capture_store",
    "api.services.journal_two.notes", "api.services.journal_two.note_levels",
    "api.services.journal_two.note_properties", "api.services.journal_two.plan_extract",
    "api.services.journal_two.plan_grading", "api.services.journal_two.playbook_stats",
    "api.services.journal_two.playbook_patterns", "api.services.journal_two.setups_board",
    "api.services.journal_two.similar_matches", "api.services.journal_two.review_drafts",
    "api.services.journal_two.thesis_chips", "api.services.journal_two.visual_playbook",
    "api.services.journal_two.chart_blocks", "api.services.journal_two.tech_fingerprint",
    "api.services.journal_two.earnings_prep", "api.services.journal_two.entry_context",
    "api.services.journal_two.regime", "api.services.journal_two.chart_plan",
    "api.services.journal_two.passed_setups", "api.services.journal_two.transcript_capture",
    "api.services.journal_two.template_gallery", "api.services.journal_two.calendar",
    "api.services.journal_two.coach_data_assembler", "api.services.journal_two.sample_size",
)


def _qualname(value: Any) -> str:
    """`value.__qualname__`, or "" for anything that will not say. Some module-level objects
    answer EVERY attribute read by doing work: the `openai` package's lazy client proxy builds a
    client and raises `OpenAIError` (no API key) on `getattr`, which is not an AttributeError, so
    `getattr(..., default)` does not catch it. Seen on the landing branch when a test file that
    imports the voice modules ran before the fixture rail in one pytest process."""
    try:
        return getattr(value, "__qualname__", "") or ""
    except Exception:  # noqa: BLE001 -- a foreign object's attribute hook; never this sweep's failure
        return ""


def _unfreeze_stragglers() -> None:
    """A module imported DURING the freeze captured the frozen clock by name. Give it the real
    one back, so nothing outlives the run (this matters inside pytest, not for the CLI)."""
    for mod in list(sys.modules.values()):
        d = getattr(mod, "__dict__", None)
        if not isinstance(d, dict) or d is globals():      # never this module's own class names
            continue
        for key, value in list(d.items()):
            if value is _FrozenDatetime:
                d[key] = _REAL_DATETIME
            elif value is _FrozenDate:
                d[key] = _REAL_DATE
            elif _qualname(value) == "_deterministic_uuid4.<locals>.uuid4":
                d[key] = _uuid.uuid4


# ── the world one run lives in ────────────────────────────────────────────────────────────────

def build_app() -> Any:
    """One app carrying every wave 12 to 15 Notebook router. The ONE list of routers: the
    generator, the sweeps and the pytest's coverage rail all read it from here."""
    from fastapi import FastAPI
    from api.routers import (notebook_chart_alerts, notebook_earnings_prep, notebook_entry_context,
                             notebook_fingerprint, notebook_plan_grades, notebook_playbook,
                             notebook_research_capture, notebook_review_drafts, notebook_setups_board,
                             notebook_template_gallery, notebook_thesis_chips, notebook_visual_playbook)
    app = FastAPI()
    for r in (notebook_plan_grades.router, notebook_playbook.router, notebook_setups_board.router,
              notebook_setups_board.similar_router, notebook_review_drafts.router,
              notebook_thesis_chips.router, notebook_visual_playbook.router,
              notebook_earnings_prep.router, notebook_entry_context.router,
              notebook_chart_alerts.router, notebook_research_capture.transcripts_router,
              notebook_research_capture.passed_router, notebook_template_gallery.router,
              notebook_fingerprint.router):
        app.include_router(r)
    return app


class World:
    """A temporary database, every flag on, a frozen clock, and one app with every router."""

    def __init__(self) -> None:
        self.p = _Patches()
        self.out: dict[str, dict[str, Any]] = {}
        self.app: Any = None
        self.client: Any = None
        self.db_path = ""
        self.tmpdir = ""
        self._real_started = _REAL_DATETIME.now(_dt.timezone.utc)

    # -- lifecycle ---------------------------------------------------------------------------
    def __enter__(self) -> "World":
        from fastapi.testclient import TestClient

        tmp = tempfile.NamedTemporaryFile(prefix="notebook_contract_", suffix=".db", delete=False)
        tmp.close()
        self.db_path = tmp.name
        self.tmpdir = tempfile.mkdtemp(prefix="notebook_contract_")
        self.p.setenv("AUTH_DB_PATH", tmp.name)
        for flag in FLAGS:
            self.p.setenv(flag, "1")
        from api.services import auth_db
        self._auth_db = auth_db
        self.p.setattr(auth_db, "_DB_PATH", tmp.name)
        build_app()              # imports every router
        # Everything a builder reaches is imported HERE, on the main thread and before the
        # freeze: a module first imported later would (a) capture the frozen clock for good and
        # (b) pull pandas in on a worker thread, whose stack is too small for that import chain.
        for name in _PREIMPORT:
            importlib.import_module(name)
        from api.limiter import limiter
        limiter.reset()          # the hourly limits are per process; a second run must start clean
        # So are the data lane's memos (landing 12-15): "one refresh on view per member per 15
        # minutes" made the SECOND run in a process answer `refreshQueued: false` where the first
        # answered true, so two runs were not byte-identical. Each module's own reset is used.
        from api.services.journal_two import entry_context as _ectx, passed_setups as _passed
        _passed._reset_refresh_clock()
        _ectx._reset_vendor_state()
        _ectx._reset_capture_queue()
        from api.services.cache import cache
        for prefix in ("notebook_earnings_prep_window", "calendar_week", "calendar_enrichment_"):
            cache.delete_prefix(prefix)
        cache.invalidate("calendar_weekly")
        _no_network(self.p)
        _freeze(self.p)          # after every import above, and BEFORE the database is built

        auth_db.init_db()
        from api.services.journal_two.db import ensure_schema
        c = auth_db.get_connection()
        try:
            ensure_schema(c)
            for uid, role in ((MEMBER, "member"), (EMPTY, "member"), (OTHER, "member"), (ADMIN, "admin")):
                c.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                          (uid, f"{uid}@example.com", "x", uid.replace("contract-", "Contract ").title(), role))
            c.commit()
        finally:
            c.close()

        app = build_app()
        self.app = app
        self.client = TestClient(app)
        self.as_user(MEMBER)
        return self

    def __exit__(self, *exc: Any) -> None:
        try:
            if self.app is not None:
                self.app.dependency_overrides.clear()
        finally:
            self.p.undo()
            _unfreeze_stragglers()
            with contextlib.suppress(Exception):
                from api.limiter import limiter
                limiter.reset()
            for suffix in ("", "-wal", "-shm"):
                with contextlib.suppress(OSError):
                    os.unlink(self.db_path + suffix)
            import shutil
            shutil.rmtree(self.tmpdir, ignore_errors=True)

    # -- helpers -----------------------------------------------------------------------------
    def conn(self):  # noqa: ANN201
        import sqlite3
        c = self._auth_db.get_connection()
        c.row_factory = sqlite3.Row
        return c

    def member(self, slug: str, name: str | None = None) -> str:
        """A member of their own for one surface, so no builder's rows show up in another's
        answers. Created once; the id is stable."""
        uid = f"contract-{slug}"
        c = self.conn()
        try:
            c.execute("INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                      (uid, f"{uid}@example.com", "x", name or uid.replace("contract-", "Contract ").title(), "member"))
            c.commit()
        finally:
            c.close()
        return uid

    def tmp(self, name: str) -> str:
        return os.path.join(self.tmpdir, name)

    def as_user(self, uid: str | None, plan: dict[str, str] = PAID, role: str = "member") -> None:
        from api.middleware import auth_middleware as authmw
        self.app.dependency_overrides.pop(authmw.get_current_user, None)
        self.app.dependency_overrides.pop(authmw.get_current_user_with_plan, None)
        self.app.dependency_overrides.pop(getattr(authmw, "require_admin", None), None)
        self.app.dependency_overrides.pop(getattr(authmw, "require_paid", None), None)
        if uid is None:
            return
        user = {"id": uid, "role": "admin" if uid == ADMIN else role, "email": f"{uid}@example.com",
                "display_name": uid.replace("contract-", "Contract ").title(), **plan}
        self.app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
        self.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
        if hasattr(authmw, "require_admin") and user["role"] == "admin":
            self.app.dependency_overrides[authmw.require_admin] = lambda: dict(user)
        if hasattr(authmw, "require_paid") and (plan is PAID or user["role"] == "admin"):
            self.app.dependency_overrides[authmw.require_paid] = lambda: dict(user)

    def record(self, name: str, method: str, path: str, *, case: str, expect: int,
               json_body: Any = None, content: bytes | None = None, note: str = "") -> Any:
        """Call the endpoint, check the status is the one this case is about, keep the answer."""
        kwargs: dict[str, Any] = {}
        if json_body is not None:
            kwargs["json"] = json_body
        if content is not None:
            kwargs["content"] = content
        res = self.client.request(method, path, **kwargs)
        if res.status_code != expect:
            raise AssertionError(f"{name}: {method} {path} answered {res.status_code}, wanted {expect}: "
                                 f"{res.text[:400]}")
        try:
            body = res.json()
        except ValueError:
            body = {"_notJson": res.text}
        if name in self.out:
            raise AssertionError(f"fixture name used twice: {name}")
        meta: dict[str, Any] = {"endpoint": f"{method} {path.split('?')[0]}", "case": case,
                                "status": res.status_code, "path": path}
        if json_body is not None:
            meta["requestBody"] = json_body
        if note:
            meta["note"] = note
        self.out[name] = {"_contract": meta, "body": body}
        return body


# ── seed helpers (direct rows with fixed ids, or the product's own create door) ──────────────

def para(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def doc(*nodes: dict[str, Any]) -> dict[str, Any]:
    return {"type": "doc", "content": list(nodes)}


def plan_list(entry: float, stop: float, target: float, shares: float) -> dict[str, Any]:
    lines = [f"Entry: {entry}", f"Stop: {stop}", f"Target: {target}", f"Shares: {shares}"]
    return {"type": "bulletList", "content": [{"type": "listItem", "content": [para(s)]} for s in lines]}


def add_trade(c: Any, tid: str, *, user: str = MEMBER, symbol: str = "NVDA", side: str = "Long",
              shares: float = 100, entry: float = 100.0, exit_: float = 110.0,
              entry_date: str = "2026-09-10T14:30:00+00:00", exit_date: str = "2026-09-15T15:00:00+00:00",
              stop: float = 95.0, setup: str | None = None, source: str | None = None,
              external_id: str | None = None, r: float | None = None, result: str | None = None,
              account_id: str | None = None, trading_day: str | None = None) -> str:
    sign = 1 if side == "Long" else -1
    pnl = round((exit_ - entry) * shares * sign, 2)
    risk = abs(entry - stop)
    r_mult = r if r is not None else (round((exit_ - entry) * sign / risk, 2) if risk else None)
    res = result or ("Win" if pnl > 0 else "Loss" if pnl < 0 else "BE")
    c.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple, hold_days,"
        " result, context_at_entry, created_at, source, external_id, account_id, trading_day_et)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, user, f"pos-{tid}", symbol, side, shares, entry, entry_date, exit_, exit_date, stop, setup,
         pnl, round((exit_ - entry) * sign / entry, 4), r_mult, 1, res, "{}", exit_date, source,
         external_id, account_id, trading_day or exit_date[:10]))
    c.commit()
    return tid


def add_note_row(c: Any, nid: str, *, body: dict[str, Any], user: str = MEMBER, title: str = "Plan",
                 ticker: str | None = "NVDA", created: str = "2026-09-05T12:00:00+00:00",
                 updated: str | None = None, plain: str = "", tags: tuple[str, ...] = (),
                 props: dict[str, Any] | None = None) -> str:
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, ticker, tags, created_at, updated_at,"
        " properties_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (nid, user, title, json.dumps(body), plain, ticker, json.dumps(list(tags)), created, updated or created,
         json.dumps(props) if props is not None else None))
    c.commit()
    return nid


def link_note(c: Any, nid: str, tid: str, *, user: str = MEMBER, symbol: str = "NVDA") -> None:
    c.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol, trade_ref,"
              " trade_ref_type) VALUES (?,?,?,?,?,?,?)", (nid, user, 0, "chart", symbol, tid, "equity_trade"))
    c.commit()


def create_note(c: Any, user: str, title: str, body: dict[str, Any], *, created: str | None = None,
                **payload: Any) -> dict[str, Any]:
    """The Notebook's own create door, so every index a real note has is built."""
    from api.services.journal_two import notes
    n = notes.create_note(user, {"title": title, "bodyJson": body, **payload}, conn=c)
    if created:
        c.execute("UPDATE j2_notes SET created_at = ?, updated_at = ? WHERE id = ?", (created, created, n["id"]))
        c.commit()
    return n


# ── builders: one per surface ────────────────────────────────────────────────────────────────

BUILDERS: list[Callable[[World], None]] = []


def builder(fn: Callable[[World], None]) -> Callable[[World], None]:
    BUILDERS.append(fn)
    return fn


@builder
def plan_grades(w: World) -> None:
    base = "/api/j2/plan-grades"
    uid = w.member("grades")
    w.as_user(uid)
    c = w.conn()
    try:
        # A planned trade: the note LINKED to it wins over a second note in the window, so it is
        # graded at once and still offers the other as a Re-link choice. Entry kept, stop not
        # honoured, oversized.
        add_trade(c, "pg-planned", user=uid, symbol="PGNV", entry=100.5, exit_=94.5, shares=150, stop=96.0, setup="Breakout")
        add_note_row(c, "pg-note-plan", user=uid, title="PGNV plan", ticker="PGNV",
                     body=doc(para("Plan"), plan_list(100, 96, 120, 100)))
        link_note(c, "pg-note-plan", "pg-planned", user=uid, symbol="PGNV")
        add_note_row(c, "pg-note-alt", user=uid, title="Alternative plan", ticker="PGNV",
                     created="2026-09-08T12:00:00+00:00", body=doc(para("Tighter"), plan_list(100, 98, 110, 150)))
        # Two plans inside the window: the member has to pick one.
        add_trade(c, "pg-pick", user=uid, symbol="PGPK", entry=101.0, exit_=110.0, shares=80, stop=97.0)
        add_note_row(c, "pg-note-a", user=uid, title="First plan", ticker="PGPK", body=doc(para("A"), plan_list(100, 96, 120, 100)))
        add_note_row(c, "pg-note-other", user=uid, title="Other plan", ticker="PGPK", created="2026-09-07T12:00:00+00:00",
                     body=doc(para("Second look"), plan_list(101, 97, 118, 80)))
        # An unplanned trade (no note, no verdict) and a broker trade whose stop is a placeholder.
        add_trade(c, "pg-unplanned", user=uid, symbol="PGUN", entry=150.0, exit_=155.0, stop=145.0)
        add_trade(c, "pg-placeholder", user=uid, symbol="PGPH", entry=200.0, exit_=210.0, stop=200.0, source="broker",
                  external_id="X-PGPH-1", entry_date="2026-09-20T14:30:00+00:00",
                  exit_date="2026-09-22T15:00:00+00:00")
        add_note_row(c, "pg-note-tsla", user=uid, title="PGPH plan", ticker="PGPH", created="2026-09-18T12:00:00+00:00",
                     body=doc(para("PGPH"), plan_list(200, 192, 224, 50)))
        add_trade(c, "pg-theirs", user=OTHER, symbol="MSFT")
        # A trade the broker dated without a time, planned on a DRAWN chart that names a setup the
        # trade does not carry yet, whose best price went past a target the exit never took.
        add_trade(c, "pg-drawn", user=uid, symbol="PGDR", entry=100.5, exit_=104.0, shares=100, stop=96.0,
                  entry_date="2026-09-12", exit_date="2026-09-16T15:00:00+00:00", source="broker",
                  external_id="X-PGDR-1")
        add_note_row(c, "pg-note-drawn", user=uid, title="PGDR plan", ticker="PGDR",
                     body=doc(para("Plan"), chart_block("PGDR", [("entry", 100), ("stop", 96), ("target", 120)],
                                                        tag="Breakout")))
        c.execute("INSERT INTO j2_trade_excursions (user_id, trade_ref, symbol, mfe_price, computed_at)"
                  " VALUES (?,?,?,?,?)", (uid, "ext:X-PGDR-1", "PGDR", 121.0, "2026-09-17T00:00:00+00:00"))
        c.commit()
        # Thirty closed trades for the discipline record: twelve planned, eighteen not, so the
        # three sample bands (too few, thin, normal) all appear in one answer.
        sampled = w.member("discipline")
        for i in range(30):
            sym, day = f"DS{i:02d}", f"2026-08-{3 + i % 26:02d}"
            planned = i < 12
            add_trade(c, f"ds-{i:02d}", user=sampled, symbol=sym, shares=100 if i % 4 else 150,
                      entry=100.5 if i % 3 else 103.0, exit_=112.0 if i % 2 else 94.0, stop=96.0,
                      entry_date=f"{day}T14:30:00+00:00", exit_date=f"{day}T19:30:00+00:00")
            if planned:
                add_note_row(c, f"ds-note-{i:02d}", user=sampled, title=f"{sym} plan", ticker=sym,
                             created="2026-08-01T12:00:00+00:00", body=doc(para("Plan"), plan_list(100, 96, 120, 100)))
            if planned and i < 6:           # the overnight job has run for six of them
                c.execute("INSERT INTO j2_trade_excursions (user_id, trade_ref, symbol, mfe_price, computed_at)"
                          " VALUES (?,?,?,?,?)", (sampled, f"id:ds-{i:02d}", sym, 121.0 if i % 2 else 105.0,
                                                  "2026-09-01T00:00:00+00:00"))
        c.commit()
    finally:
        c.close()
    w.record("plan-grades.trade.planned", "GET", f"{base}/trades/pg-planned", case="success", expect=200)
    w.record("plan-grades.trade.unplanned", "GET", f"{base}/trades/pg-unplanned", case="empty", expect=200,
             note="A trade with no plan: the empty state of the card.")
    w.record("plan-grades.trade.placeholder-stop", "GET", f"{base}/trades/pg-placeholder", case="success",
             expect=200, note="A broker trade whose stored stop equals its entry (a placeholder).")
    w.record("plan-grades.trade.drawn-plan", "GET", f"{base}/trades/pg-drawn", case="success", expect=200,
             note="Dated by day only, planned on a drawn chart with a setup tag, target reached and not taken.")
    w.record("plan-grades.trade.not-found", "GET", f"{base}/trades/pg-theirs", case="error", expect=404,
             note="Another member's trade answers the one 404.")
    w.record("plan-grades.trade.needs-pick", "GET", f"{base}/trades/pg-pick", case="success", expect=200,
             note="Two plans match: no grade until the member picks one.")
    w.record("plan-grades.status", "GET", f"{base}/status?ids=pg-planned,pg-pick,pg-unplanned,pg-placeholder,nope",
             case="success", expect=200)
    w.record("plan-grades.status.too-many", "GET",
             f"{base}/status?ids=" + ",".join(f"t{i}" for i in range(201)), case="error", expect=400)
    w.record("plan-grades.discipline", "GET", f"{base}/discipline", case="success", expect=200)
    w.record("plan-grades.relink.choose-one", "POST", f"{base}/trades/pg-planned/relink", case="error",
             expect=400, json_body={})
    w.record("plan-grades.relink.bad-body", "POST", f"{base}/trades/pg-planned/relink", case="error",
             expect=422, content=b"[1]")
    w.record("plan-grades.relink.note", "POST", f"{base}/trades/pg-planned/relink", case="success",
             expect=200, json_body={"noteId": "pg-note-alt"},
             note="A graded trade re-linked to another of the member's plans.")
    w.record("plan-grades.relink.pick", "POST", f"{base}/trades/pg-pick/relink", case="success",
             expect=200, json_body={"noteId": "pg-note-other"}, note="The tie resolved by the member's pick.")
    w.record("plan-grades.relink.unknown-note", "POST", f"{base}/trades/pg-pick/relink", case="error",
             expect=400, json_body={"noteId": "nope"})
    w.record("plan-grades.relink.none", "POST", f"{base}/trades/pg-pick/relink", case="success",
             expect=200, json_body={"none": True})
    w.as_user(w.member("discipline"))
    w.record("plan-grades.discipline.sampled", "GET", f"{base}/discipline", case="success", expect=200,
             note="Thirty closed trades, twelve planned: every sample band in one record.")
    w.as_user(EMPTY)
    w.record("plan-grades.status.empty", "GET", f"{base}/status?ids=pg-planned", case="empty", expect=200,
             note="A member with no trades: every id asked for is simply absent.")
    w.record("plan-grades.discipline.empty", "GET", f"{base}/discipline", case="empty", expect=200)
    w.as_user(None)
    w.record("plan-grades.discipline.signed-out", "GET", f"{base}/discipline", case="error", expect=401)
    w.as_user(MEMBER)


@builder
def my_playbook(w: World) -> None:
    uid = w.member("playbook")
    w.as_user(uid)
    c = w.conn()
    try:
        n = 0

        def trade(r: float, setup: str | None, source: str | None = None) -> str:
            nonlocal n
            n += 1
            day = f"2026-0{1 + (n // 28) % 8}-{1 + n % 28:02d}"
            return add_trade(c, f"pb-{n:03d}", user=uid, symbol="PBNV", r=r, setup=setup, entry=100.0, exit_=100.0 + r, stop=99.0,
                             entry_date=f"{day}T14:30:00+00:00", exit_date=f"{day}T19:30:00+00:00",
                             source=source, external_id=(f"X-PB-{n}" if source else None))

        for r in (2.0, -1.0, 1.5, -1.0, 3.0, -1.0, 2.0, -1.0, 1.0, -1.0, 2.5, -1.0):
            trade(r, "Breakout")
        for i in range(9):
            trade(1.0 if i % 3 else -1.0, "EP")
        for i in range(25):
            trade(2.0 if i % 5 < 2 else -1.0, "Pullback")
        for _ in range(3):
            trade(1.0, None)
        # Notes written the day before entry, linked to the trade: the behaviour patterns.
        k = 0

        def noted(r: float, text: str, source: str | None = None) -> None:
            nonlocal k
            k += 1
            tid = trade(r, "Breakout", source)
            entry = c.execute("SELECT entry_date FROM j2_trades WHERE id = ?", (tid,)).fetchone()[0]
            before = (_REAL_DATETIME.fromisoformat(entry) - _dt.timedelta(days=1)).isoformat()
            nid = add_note_row(c, f"pb-note-{k:02d}", user=uid, ticker="PBNV", title=f"Pre-trade {k:02d}", body=doc(para(text)), plain=text,
                               created=before)
            link_note(c, nid, tid, user=uid, symbol="PBNV")

        for i in range(6):
            noted(-1.0, "Felt FOMO on the gap" if i < 4 else ("anxious, small size" if i == 4 else "plan is clear"),
                  "broker" if i == 0 else None)
        for i in range(6):
            noted(2.0, "patient, waited for the pivot" if i < 4 else ("a bit of fomo" if i == 4 else "clean base"))
    finally:
        c.close()
    w.record("my-playbook", "GET", "/api/j2/my-playbook", case="success", expect=200)
    w.as_user(EMPTY)
    w.record("my-playbook.empty", "GET", "/api/j2/my-playbook", case="empty", expect=200)
    w.as_user(None)
    w.record("my-playbook.signed-out", "GET", "/api/j2/my-playbook", case="error", expect=401)
    w.as_user(MEMBER)


def chart_block(symbol: str, levels: list[tuple[str, float]], *, embed_id: str | None = None,
                tag: str | None = None, tf: str = "D", fingerprint: dict[str, Any] | None = None,
                image: bool = False, mode: str = "live", to: int | None = None,
                captured: str = "2026-09-28T15:00:00Z") -> dict[str, Any]:
    # The drawing as the CLIENT writes it (`lib/chartPlan.js` setPlanRole): the role sits on the
    # line and the level is the line's own anchor. There is no separate `price` copy.
    anns = [{"id": f"d-{symbol}-{role}", "type": "horizontal", "role": role,
             "points": [{"time": 1758000000, "price": float(price)}]} for role, price in levels]
    attrs: dict[str, Any] = {"v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": tf, "to": to},
                             "capturedAt": captured, "embedId": embed_id or f"e-{symbol}", "mode": mode,
                             "annotations": anns}
    if image:
        attrs["fallback"] = {"url": f"/img/{attrs['embedId']}.png", "w": 800, "h": 400}
    ta: dict[str, Any] = {}
    if tag:
        ta["setupTag"] = tag
    if fingerprint:
        ta["fingerprint"] = fingerprint
    if ta:
        attrs["ta"] = ta
    return {"type": "widgetEmbed", "attrs": attrs}


@builder
def setups_board(w: World) -> None:
    from api.services.journal_two import setups_board as sb

    table = {"SBNV": 102.0, "SBAM": 149.0, "SBTS": 205.0, "SBME": 650.0, "SBIN": 100.0, "SBTR": 106.0}
    # Forty setups for the paging and the chart queue: each a little further from its entry.
    for i in range(40):
        table[f"SQ{i:02d}"] = round((100 + i) - 0.1 * (i + 1), 2)

    def read_prices(symbols: Any) -> dict[str, Any]:
        return {s: {"price": table[s], "source": "close", "asOf": "2026-10-02"} for s in symbols if s in table}

    w.p.setattr(sb, "read_prices", read_prices)
    w.as_user(EMPTY)
    w.record("setups-board.empty", "GET", "/api/j2/setups-board", case="empty", expect=200)
    w.as_user(MEMBER)
    c = w.conn()
    try:
        create_note(c, MEMBER, "SBNV breakout", doc(para("plan"), chart_block(
            "SBNV", [("entry", 105), ("stop", 100), ("target", 120)], tag="Breakout")),
            created="2026-09-28T15:00:00Z")
        create_note(c, MEMBER, "SBAM pullback", doc(para("plan"), chart_block("SBAM", [("entry", 150), ("stop", 140)])),
                    created="2026-09-30T15:00:00Z")
        create_note(c, MEMBER, "SBTS short", doc(para("plan"), chart_block("SBTS", [("entry", 200), ("stop", 210)])),
                    created="2026-09-21T15:00:00Z")
        create_note(c, MEMBER, "SBME watch", doc(para("plan"), chart_block("SBME", [("entry", 700)])),
                    created="2026-10-02T13:00:00Z")
        create_note(c, MEMBER, "SBIN invalidated", doc(para("plan"), chart_block("SBIN", [("entry", 105), ("stop", 100)])),
                    created="2026-09-25T15:00:00Z")
        create_note(c, MEMBER, "SBNP no price", doc(para("plan"), chart_block("SBNP", [("entry", 20), ("stop", 18)])),
                    created="2026-09-26T15:00:00Z")
        create_note(c, MEMBER, "SBTR triggered", doc(para("plan"), chart_block("SBTR", [("entry", 105), ("stop", 100)])),
                    created="2026-10-01T15:00:00Z")
        forty = w.member("board-forty")
        for i in range(40):
            create_note(c, forty, f"Plan {i}", doc(para("plan"), chart_block(
                f"SQ{i:02d}", [("entry", 100 + i), ("stop", 95 + i), ("target", 120 + i)],
                tag="VCP" if i == 0 else None)), created=f"{TODAY}T13:00:00Z" if i % 5 == 0 else "2026-10-01T15:00:00Z")
    finally:
        c.close()
    w.record("setups-board", "GET", "/api/j2/setups-board", case="success", expect=200,
             note="One card in each state: waiting (long and short), watching, triggered, invalidated, no price.")
    w.as_user(forty)
    w.record("setups-board.forty", "GET", "/api/j2/setups-board", case="success", expect=200,
             note="Forty setups, closest first: three pages of the grid.")
    w.as_user(None)
    w.record("setups-board.signed-out", "GET", "/api/j2/setups-board", case="error", expect=401)
    w.as_user(MEMBER)


@builder
def thesis_chips(w: World) -> None:
    from api.services.journal_two import note_levels, notes
    uid = w.member("chips")
    url = "/api/j2/thesis-chips"
    w.as_user(uid)
    c = w.conn()
    try:
        # The level table belongs to the resurfacing lane and exists only once that lane has
        # projected a note. Without it this route answers 500 (see docs/notebook/fin-tests.md,
        # defect D1, and the strict xfail in tests/test_notebook_contract_fixtures.py), so the
        # empty state is recorded with the table present.
        note_levels.ensure_schema(c)
        c.commit()
    finally:
        c.close()
    w.record("thesis-chips.empty", "POST", url, case="empty", expect=200, json_body={"symbols": ["TCNV"]},
             note="No note on any symbol asked for: an empty object, never a blank chip.")
    c = w.conn()
    try:
        def note(ticker: str, lines: list[str], status: str | None) -> None:
            n = notes.create_note(uid, {"title": f"{ticker} thesis", "ticker": ticker,
                                        "bodyJson": doc(*[para(t) for t in lines])}, conn=c)
            if status:
                notes.update_note(uid, n["id"], {"properties": {"builtin:thesis_status": status}}, conn=c)
            row = c.execute("SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes"
                            " WHERE id = ? AND user_id = ?", (n["id"], uid)).fetchone()
            note_levels.project_note(c, uid, row)
            c.commit()
        note("TCNV", ["Entry: 100", "Stop: 90", "Target: 120"], "active")
        note("TCAM", ["Watching the base, no levels yet."], "watching")
        note("TCIN", ["Entry: 50", "Stop: 47"], "invalidated")
    finally:
        c.close()
    w.record("thesis-chips", "POST", url, case="success", expect=200,
             json_body={"symbols": ["TCNV", "TCAM", "TCIN", "NOPE"]})
    w.record("thesis-chips.symbols-not-a-list", "POST", url, case="error", expect=400,
             json_body={"symbols": "TCNV"})
    w.record("thesis-chips.body-not-an-object", "POST", url, case="error", expect=422, content=b"[1]",
             note="FastAPI's own validation answer: `detail` is a LIST here, not a sentence.")
    w.as_user(uid, FREE)
    w.record("thesis-chips.free-plan", "POST", url, case="error", expect=402, json_body={"symbols": ["TCNV"]})
    w.as_user(MEMBER)


@builder
def review_drafts(w: World) -> None:
    uid = w.member("review")
    base = "/api/j2/review-drafts"
    acct = "acct-review"
    w.as_user(uid)
    w.record("review-drafts.daily.empty", "GET", f"{base}/daily?day=2026-09-30&accountId={acct}", case="empty",
             expect=200, note="A day with no closed trade.")
    w.record("review-drafts.weekly.empty", "GET", f"{base}/weekly?weekStart=2026-09-28&accountId={acct}",
             case="empty", expect=200)
    w.record("review-drafts.monthly.empty", "GET", f"{base}/monthly?month=2026-09&accountId={acct}",
             case="empty", expect=200)
    c = w.conn()
    try:
        def trade(tid: str, symbol: str, day: str, t_in: str, t_out: str, entry: float, exit_: float,
                  stop: float, setup: str | None = None, hour: int = 10) -> None:
            add_trade(c, tid, user=uid, symbol=symbol, entry=entry, exit_=exit_, stop=stop, setup=setup,
                      entry_date=f"{day}T{t_in}:00+00:00", exit_date=f"{day}T{t_out}:00+00:00",
                      account_id=acct, trading_day=day)
            c.execute("UPDATE j2_trades SET hour_et = ?, fees = 1.0 WHERE id = ?", (hour, tid))
        trade("rd-win", "RDWN", "2026-09-30", "14:00", "15:00", 100.0, 106.0, 97.0, "Breakout")
        trade("rd-loss", "RDLS", "2026-09-30", "13:00", "13:30", 100.0, 95.0, 94.0, "Pullback", 9)
        trade("rd-reentry", "RDLS", "2026-09-30", "13:45", "14:15", 95.0, 93.0, 92.0, "Pullback", 9)
        trade("rd-mon", "RDMN", "2026-09-28", "14:00", "18:00", 50.0, 52.0, 49.0, "Breakout")
        trade("rd-early", "RDEA", "2026-09-10", "14:00", "18:00", 20.0, 19.0, 19.0, "EP")
        # Twelve more losing trades earlier in the month, none with a plan: enough of them that
        # the month's "unplanned trades" finding is shown plainly instead of behind the reveal.
        for i in range(12):
            trade(f"rd-m{i:02d}", f"RM{i:02d}", f"2026-09-{1 + i:02d}", "14:00", "15:00", 50.0, 49.5, 49.0, None)
        c.commit()
        # The winner was planned: a plan note written before entry (so the draft links it), and
        # last week's review note (so the draft can be read beside it).
        add_note_row(c, "rd-note-plan", user=uid, title="RDWN plan", ticker="RDWN",
                     created="2026-09-25T12:00:00+00:00", body=doc(para("Plan"), plan_list(100, 97, 112, 100)))
        from api.services.journal_two import notes as notes_service
        prior = notes_service.create_note(uid, {"title": "Review of the week of Sep 14", "tags": ["weekly-review"]},
                                          conn=c)
        c.execute("UPDATE j2_notes SET created_at = ?, updated_at = ? WHERE id = ?",
                  ("2026-09-19T20:00:00+00:00", "2026-09-19T20:00:00+00:00", prior["id"]))
        c.commit()
        add_trade(c, "rd-theirs", user=OTHER, symbol="RDXX", account_id=acct,
                  entry_date="2026-09-30T14:00:00+00:00", exit_date="2026-09-30T15:00:00+00:00")
    finally:
        c.close()
    w.record("review-drafts.daily", "GET", f"{base}/daily?day=2026-09-30&accountId={acct}", case="success", expect=200)
    w.record("review-drafts.weekly", "GET", f"{base}/weekly?weekStart=2026-09-28&accountId={acct}", case="success",
             expect=200)
    w.record("review-drafts.monthly", "GET", f"{base}/monthly?month=2026-09&accountId={acct}", case="success",
             expect=200)
    w.record("review-drafts.daily.bad-day", "GET", f"{base}/daily?day=yesterday", case="error", expect=422)
    w.record("review-drafts.daily.missing-day", "GET", f"{base}/daily", case="error", expect=422,
             note="FastAPI's own validation answer: `detail` is a LIST here, not a sentence.")
    w.record("review-drafts.weekly.bad-week", "GET", f"{base}/weekly?weekStart=2026-9-28", case="error", expect=422)
    w.record("review-drafts.monthly.bad-month", "GET", f"{base}/monthly?month=Sept", case="error", expect=422)
    w.as_user(MEMBER)


def _fingerprint(**values: Any) -> dict[str, Any]:
    from api.services.journal_two import tech_fingerprint as tfp
    fields = {f: {"value": None, "source": "screener_row", "missing": "not_in_screener_row"} for f in tfp.FIELDS}
    for k, v in values.items():
        fields[k] = {"value": v, "source": "screener_row", "missing": None}
    return {"v": 1, "symbol": "X", "requested_as_of": "2026-09-30", "as_of": "2026-09-30", "mode": "nightly",
            "fields": fields}


@builder
def visual_playbook(w: World) -> None:
    from api.services.journal_two import chart_blocks
    from api.services.journal_two import tech_fingerprint as tfp
    uid = w.member("visual")
    base = "/api/j2/notebook-visual-playbook"

    def no_compute(*a: Any, **k: Any) -> Any:
        raise AssertionError("no fingerprint may be computed here: every block carries its own")
    w.p.setattr(tfp, "compute", no_compute)
    w.as_user(uid)
    w.record("visual-playbook.cards.empty", "GET", f"{base}/cards", case="empty", expect=200)
    to = 1759255200 + 365 * 86400          # 2026-09-30 14:00 ET
    c = w.conn()
    try:
        chart_blocks.ensure_schema(c)

        def chart(embed: str, symbol: str, tag: str | None, fp: dict[str, Any], tf: str = "D") -> dict[str, Any]:
            return chart_block(symbol, [], embed_id=embed, tag=tag, tf=tf, fingerprint=fp, image=True,
                               mode="snapshot", to=to, captured="2026-09-30T18:00:00Z")
        a = create_note(c, uid, "VPNV plan", doc(para("plan"), chart(
            "vp-a", "VPNV", "VCP", _fingerprint(rs_rank=95, base_depth_pct=12.0))))
        b = create_note(c, uid, "VPAM plan", doc(para("plan"), chart(
            "vp-b", "VPAM", "VCP", _fingerprint(rs_rank=80, base_depth_pct=22.0))))
        create_note(c, uid, "VPTS plan", doc(para("plan"), chart(
            "vp-f", "VPTS", "Bull Flag", _fingerprint(base_depth_pct=9.0), tf="W")))
        create_note(c, uid, "untagged", doc(para("plan"), chart("vp-u", "VPAA", None, _fingerprint(rs_rank=99))))

        def trade(tid: str, symbol: str, exit_: float, exit_date: str, ext: str | None = None) -> None:
            add_trade(c, tid, user=uid, symbol=symbol, entry=100.0, exit_=exit_, stop=96.0,
                      entry_date="2026-09-30T14:00:00Z", exit_date=exit_date,
                      source="broker" if ext else "manual", external_id=ext)

        def link(trade_ref: str, note_id: str, symbol: str) -> None:
            c.execute(
                "INSERT INTO j2_trade_plan_links (user_id, trade_ref, symbol, source_kind, match_tier, note_id,"
                " plan_json, flags_json, matched_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (uid, trade_ref, symbol, "note", "window", note_id,
                 json.dumps({"entry": 100.0, "stop": 96.0, "target": 112.0, "shares": 100}), "[]",
                 "2026-09-30T00:00:00Z"))
            c.commit()
        trade("vp-win", "VPNV", 108.0, "2026-10-01T15:00:00Z", ext="X-VPNV-1")
        trade("vp-loss", "VPAM", 96.0, "2026-10-01T16:00:00Z")
        trade("vp-noplan", "VPZZ", 101.0, "2026-10-01T17:00:00Z")
        link("ext:X-VPNV-1", a["id"], "VPNV")
        link("id:vp-loss", b["id"], "VPAM")
        add_trade(c, "vp-theirs", user=OTHER, symbol="VPNV")
    finally:
        c.close()
    w.record("visual-playbook.cards", "GET", f"{base}/cards", case="success", expect=200)
    w.record("visual-playbook.cards.filtered", "GET", f"{base}/cards?setup=VCP&range=rs_rank:90:", case="success",
             expect=200, note="One setup, RS rank 90 and up: the slice and what the filter left out.")
    w.record("visual-playbook.cards.range-only", "GET", f"{base}/cards?range=rs_rank:90:", case="success",
             expect=200, note="A range alone: charts with no value for it are left out, and counted.")
    w.p.setenv("NOTEBOOK_ENTRY_CONTEXT_ENABLED", "0")
    w.record("visual-playbook.cards.regime-unavailable", "GET", f"{base}/cards", case="success", expect=200,
             note="With the entry-context switch off there is no frozen regime to filter by.")
    w.p.setenv("NOTEBOOK_ENTRY_CONTEXT_ENABLED", "1")
    w.record("visual-playbook.cards.bad-range", "GET", f"{base}/cards?range=bogus:1:", case="error", expect=422)
    w.record("visual-playbook.cards.bad-outcome", "GET", f"{base}/cards?outcome=maybe", case="error", expect=422)
    w.record("visual-playbook.before-after", "GET", f"{base}/trades/vp-win/before-after", case="success", expect=200)
    w.record("visual-playbook.before-after.no-plan", "GET", f"{base}/trades/vp-noplan/before-after", case="empty",
             expect=200, note="A trade with no frozen plan.")
    w.record("visual-playbook.before-after.not-found", "GET", f"{base}/trades/vp-theirs/before-after", case="error",
             expect=404)
    w.as_user(uid, FREE)
    w.record("visual-playbook.cards.free-plan", "GET", f"{base}/cards", case="error", expect=402)
    # Twelve tagged charts, each with its trade: seven wins and five losses, a THIN sample.
    thin = w.member("visual-thin")
    c = w.conn()
    try:
        for i in range(12):
            sym = f"VT{i:02d}"
            n = create_note(c, thin, f"{sym} plan", doc(para("plan"), chart_block(
                sym, [], embed_id=f"vt-{i:02d}", tag="VCP", fingerprint=_fingerprint(rs_rank=80 + i), image=True,
                mode="snapshot", to=to, captured="2026-09-30T18:00:00Z")))
            add_trade(c, f"vt-{i:02d}", user=thin, symbol=sym, entry=100.0, exit_=108.0 if i < 7 else 96.0,
                      stop=96.0, entry_date="2026-09-30T14:00:00Z", exit_date="2026-10-01T15:00:00Z")
            c.execute(
                "INSERT INTO j2_trade_plan_links (user_id, trade_ref, symbol, source_kind, match_tier, note_id,"
                " plan_json, flags_json, matched_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (thin, f"id:vt-{i:02d}", sym, "note", "window", n["id"],
                 json.dumps({"entry": 100.0, "stop": 96.0, "target": 112.0, "shares": 100}), "[]",
                 "2026-09-30T00:00:00Z"))
        c.commit()
    finally:
        c.close()
    w.as_user(thin)
    w.record("visual-playbook.cards.thin", "GET", f"{base}/cards", case="success", expect=200,
             note="Twelve trades behind the slice: a thin sample, shown with its ranges.")
    w.as_user(MEMBER)


def _quarter(fy: int, q: int, day: str, eps: float, rev: float, beat: bool | None, surprise: float | None,
             rev_beat: bool | None = True, rev_surprise: float | None = 1.0) -> dict[str, Any]:
    return {"fiscal_year": fy, "fiscal_quarter": q, "label": f"FY{fy} Q{q}", "report_date": day, "reported": True,
            "eps_actual": eps, "revenue_actual": rev, "eps_beat": beat, "eps_surprise_pct": surprise,
            "rev_beat": rev_beat, "rev_surprise_pct": rev_surprise}


_INTEL: dict[str, Any] = {
    "ticker": "EPNV",
    "quarters": [
        _quarter(2027, 2, "2026-08-26", 1.05, 46e9, True, 4.2, True, 1.1),
        _quarter(2027, 1, "2026-05-27", 0.96, 44e9, False, -1.3, None, None),
        _quarter(2026, 4, "2026-02-25", 0.89, 39e9, True, 2.0, True, 0.5),
        _quarter(2026, 3, "2025-11-19", 0.81, 35.1e9, True, 3.0, True, 2.0),
        _quarter(2026, 2, "2025-08-27", 0.68, 30e9, True, 1.0, True, 1.0),
    ],
    "estimates": [
        {"fiscal_year": 2027, "fiscal_quarter": 4, "label": "FY2027 Q4", "report_date": "2027-02-24",
         "eps_estimate": 1.5, "revenue_estimate": 60e9, "eps_yoy_pct": 68.5, "rev_yoy_pct": 53.8},
        {"fiscal_year": 2027, "fiscal_quarter": 3, "label": "FY2027 Q3", "report_date": "2026-10-07",
         "eps_estimate": 1.31, "revenue_estimate": 54e9, "eps_yoy_pct": 61.7, "rev_yoy_pct": 53.8},
    ],
    "reaction": {"events": [
        {"quarter": "FY2026 Q3", "report_date": "2025-11-19", "reaction_pct": 1.0},
        {"quarter": "FY2026 Q4", "report_date": "2026-02-25", "reaction_pct": -8.5},
        {"quarter": "FY2027 Q1", "report_date": "2026-05-27", "reaction_pct": 2.4},
        {"quarter": "FY2027 Q2", "report_date": "2026-08-26", "reaction_pct": -3.1},
    ]},
    "summary": {"next_report_date": "2026-10-07"},
    "next_report_date": "2026-10-07",
    "meta": {"retrieved_at": 1790000000.0},
}


@builder
def earnings_prep(w: World) -> None:
    from api.services import calendar_alerts, calendar_personalization, call_recap_store, earnings_intel, implied_store
    from api.services.cache import cache
    from api.services import ticker_meta
    from api.services.journal_two import notes
    uid = w.member("earnings")
    # The draft resolves the name's display identity through `ticker_meta` (Yahoo, then FMP, then
    # Finnhub). That is a live vendor read; it is replaced here like every other outside source.
    w.p.setattr(ticker_meta, "get_ticker_meta", lambda symbol: {"name": f"{symbol} Corp"})
    quiet = w.member("earnings-quiet")
    base = "/api/j2/earnings-prep"
    sets = {uid: {"positions": {"EPNV"}, "watchlist": {"EPAM", "EPNV"}, "flagged": {"EPCR"}, "uct20": {"EPME"}}}
    w.p.setattr(calendar_personalization, "get_user_ticker_sets",
                lambda u: {k: set(v) for k, v in sets.get(u, {}).items()})
    window = {"EPNV": "2026-10-07", "EPAM": "2026-10-05", "EPME": "2026-10-06", "EPCR": "2026-10-12",
              "EPTS": "2026-10-08"}
    w.p.setattr(calendar_alerts, "collect_earnings_window", lambda today, days: (dict(window), False))
    w.p.setattr(earnings_intel, "get_earnings", lambda _sym: json.loads(json.dumps(_INTEL)))
    w.p.setattr(call_recap_store, "DB_PATH", w.tmp("recaps.db"))
    call_recap_store.init_db()
    w.p.setattr(implied_store, "DB_PATH", w.tmp("implied.db"))
    cache.set("calendar_weekly", {"days": {"2026-10-05": {"bmo": [{"sym": "EPAM"}], "amc": []},
                                           "2026-10-07": {"amc": [{"sym": "EPNV"}]}}}, ttl=600)
    implied_store.record_implied("EPNV", "2026-10-07", {"pct": 6.5, "dollar": 12.4, "source": "test"},
                                 "2026-10-04T21:00:00Z")
    implied_store.record_implied("EPNV", "2026-08-26", {"pct": 6.9, "dollar": 11.0, "source": "test"},
                                 "2026-08-25T21:00:00Z")
    call_recap_store.put("EPNV", "Q2 2027", {"headline": "Data center carried it", "sentiment": "positive",
                                             "bullets": ["Blackwell ramp ahead of plan"], "guidance": "Raised"})
    w.as_user(quiet)
    w.record("earnings-prep.soon.empty", "GET", f"{base}/soon", case="empty", expect=200,
             note="A member who watches nothing that reports this week.")
    c = w.conn()
    try:
        notes.create_note(uid, {"title": "EPNV thesis", "ticker": "EPNV", "tags": []}, conn=c)
        notes.create_note(uid, {"title": "Earnings Prep — EPAM", "ticker": "EPAM",
                                "tags": ["earnings", "earnings-prep"]}, conn=c)
        c.execute(
            "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares, entry_price,"
            " stop_price, context_at_entry, created_at, updated_at, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("ep-pos", uid, "EPNV", "Long", "2026-09-15", 100, 100, 180.0, 170.0, "{}",
             "2026-09-15T14:00:00Z", "2026-09-15T14:00:00Z", None))
        c.commit()
        add_trade(c, "ep-trade", user=uid, symbol="EPNV", entry=100.0, exit_=112.3, stop=95.0, shares=10,
                  entry_date="2026-08-01T14:00:00+00:00", exit_date="2026-08-20T20:00:00+00:00")
    finally:
        c.close()
    w.as_user(uid)
    w.record("earnings-prep.soon", "GET", f"{base}/soon", case="success", expect=200)
    w.record("earnings-prep.draft", "POST", f"{base}/epnv/draft", case="success", expect=200)
    w.record("earnings-prep.draft.bad-symbol", "POST", f"{base}/no%20way/draft", case="error", expect=400)
    w.p.setattr(earnings_intel, "get_earnings", lambda _sym: {"error": "ticker required"})
    w.p.setattr(implied_store, "get_implied_history", lambda sym, limit=8: [])
    w.p.setattr(call_recap_store, "get", lambda sym, quarter=None: None)
    w.record("earnings-prep.draft.sources-missing", "POST", f"{base}/EPZZ/draft", case="empty", expect=200,
             note="A name the outside sources know nothing about: every cell is a labelled gap.")
    # The daily limit is real and durable: spend today's drafts, then record the refusal.
    from api.services.journal_two import earnings_prep as prep_service
    used = w.client.post(f"{base}/EPZZ/draft").json()["usage"]["used"]
    for _ in range(prep_service.daily_cap() - used):
        w.client.post(f"{base}/EPZZ/draft")
    w.record("earnings-prep.draft.daily-cap", "POST", f"{base}/EPNV/draft", case="error", expect=429,
             note="The member has used today's drafts.")
    w.as_user(uid, FREE)
    w.record("earnings-prep.soon.free-plan", "GET", f"{base}/soon", case="error", expect=402)
    w.as_user(MEMBER)


@builder
def entry_context(w: World) -> None:
    from api.services import breadth_live, earnings_table, engine, rs_ranking, user_definitions
    from api.services.journal_two import entry_context as ectx
    from api.services.journal_two import regime
    from api.services.journal_two import tech_fingerprint as tfp
    from api.services.screener import scan_store
    uid = w.member("context")
    base = "/api/j2/entry-context"
    rs = {"ECNV": {"rs_rank": 91, "rs_score": 1.4}, "ECAM": {"rs_rank": 77, "rs_score": 0.9}}
    w.p.setattr(regime, "get_current_regime",
                lambda: {"regime": "amber", "score": 72.5, "source": "wire_data", "asOf": None})
    w.p.setattr(engine, "get_breadth", lambda: {"wire_date": TODAY, "pct_above_50ma": 48.2})
    w.p.setattr(breadth_live, "compute_live", lambda force=False, cached_only=False: {
        "ok": True, "as_of": f"{TODAY}T10:15:00-04:00", "metrics": {"pct_above_50sma": 55.1},
        "measured": 3000, "degraded": False})
    w.p.setattr(rs_ranking, "get_rs_for_ticker", lambda s: rs.get(s))
    w.p.setattr(rs_ranking, "cached_rank_map", lambda: dict(rs))
    w.p.setattr(earnings_table, "_next_report_date", lambda s, now=None: TODAY if s == "ECZZ" else "2026-10-20")
    w.p.setattr(engine, "get_candidates", lambda: {
        "generated_at": f"{TODAY}T12:00:00Z", "market_date": TODAY,
        "candidates": {"pullback_ma": [{"ticker": "ECNV"}], "gapper_news": [], "remount": [{"ticker": "ECAM"}]}})
    w.p.setattr(user_definitions, "list_for_user", lambda u: [
        {"ast_hash": "h1", "def_id": "d1", "definition": {"meta": {"name": "My breakouts"}}},
        {"ast_hash": "h2", "def_id": "d2", "definition": {"meta": {"name": "Never swept"}}}])
    w.p.setattr(scan_store, "latest_covered_as_of", lambda h, tf: {"h1": 20261002}.get(h))
    w.p.setattr(scan_store, "hits", lambda h, tf, as_of: {"h1": ["MSFT", "ECNV"]}.get(h, []))
    def compute(symbol: str, as_of: Any = None) -> dict[str, Any]:
        if symbol == "ECZZ":
            raise RuntimeError("the fingerprint source is down")
        return {"v": 1, "symbol": symbol, "requested_as_of": as_of, "as_of": as_of, "mode": "bars",
                "fields": {"adr_pct": {"value": 4.2, "source": "bars", "missing": None}}}
    w.p.setattr(tfp, "compute", compute)
    c = w.conn()
    try:
        ectx.ensure_schema(c)

        def position(pid: str, symbol: str, entry: str, user: str = uid, *, broker: bool = False,
                     estimated: int = 0) -> None:
            c.execute(
                "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
                " entry_price, stop_price, raise_to_breakeven, context_at_entry, created_at, updated_at,"
                " closed_at, source, external_id, entry_estimated) VALUES (?,?,?,?,?,?,?,?,?,0,'{}',?,?,?,?,?,?)",
                (pid, user, symbol, "Long", entry, 10, 10, 100.0, 96.0, entry, entry, None,
                 "broker" if broker else None, f"bkpos:a1:{symbol}:Long" if broker else None, estimated))
            c.commit()
        position("ec-today", "ECNV", f"{TODAY}T14:00:00+00:00")
        # A name outside the RS universe and outside every scan, reporting today, whose
        # fingerprint source fails: the labelled gaps, beside values that are really zero or empty.
        position("ec-gaps", "ECZZ", f"{TODAY}T14:05:00+00:00")
        # A holding the broker carried in without its entry date.
        position("ec-carried", "ECCR", f"{TODAY}T14:00:00+00:00", broker=True, estimated=1)
        position("ec-old", "ECAM", "2026-10-01T14:30:00+00:00")
        position("ec-theirs", "ECNV", f"{TODAY}T14:00:00+00:00", user=OTHER)
        add_trade(c, "ec-trade", user=uid, symbol="ECNV", entry_date=f"{TODAY}T14:00:00+00:00",
                  exit_date=f"{TODAY}T14:20:00+00:00", source="broker", external_id="X-ECNV-1")
        c.execute("UPDATE j2_trades SET position_id = 'ec-today' WHERE id = 'ec-trade'")
        c.commit()
    finally:
        c.close()
    w.as_user(uid)
    w.record("entry-context.meta", "GET", f"{base}/meta", case="success", expect=200)
    w.record("entry-context.position.captured", "GET", f"{base}/position/ec-today", case="success", expect=200)
    w.record("entry-context.position.not-captured", "GET", f"{base}/position/ec-old", case="empty", expect=200,
             note="An entry from an earlier day: nothing was captured and nothing is reconstructed.")
    w.record("entry-context.position.with-gaps", "GET", f"{base}/position/ec-gaps", case="success", expect=200,
             note="Captured, with three values missing and labelled, and two that are really zero and empty.")
    w.record("entry-context.position.entry-day-unknown", "GET", f"{base}/position/ec-carried", case="empty",
             expect=200, note="A broker holding with no entry date: there is no entry day to freeze.")
    w.record("entry-context.trade.captured", "GET", f"{base}/trade/ec-trade", case="success", expect=200)
    w.record("entry-context.position.not-found", "GET", f"{base}/position/ec-theirs", case="error", expect=404)
    w.record("entry-context.by-key", "GET", f"{base}?symbol=ECNV&entryDay={TODAY}", case="success", expect=200)
    w.record("entry-context.by-key.not-captured", "GET", f"{base}?symbol=ECAM&entryDay=2026-10-01", case="empty",
             expect=200)
    w.record("entry-context.by-key.bad-day", "GET", f"{base}?symbol=ECNV&entryDay=yesterday", case="error", expect=422)
    # `baseUpdatedAt` (data lane I5, ac9305c742): the save is a compare-and-set, and the client
    # always names the version it read (null for a first save). Recorded as the client sends it.
    w.record("entry-context.why.saved", "PUT", f"{base}/why", case="success", expect=200,
             json_body={"symbol": "ECNV", "entryDay": TODAY, "text": "VCP through the pivot on volume",
                        "baseUpdatedAt": None})
    w.record("entry-context.why.no-context", "PUT", f"{base}/why", case="error", expect=409,
             json_body={"symbol": "ECAM", "entryDay": "2026-10-01", "text": "late"})
    w.record("entry-context.why.too-long", "PUT", f"{base}/why", case="error", expect=422,
             json_body={"symbol": "ECNV", "entryDay": TODAY, "text": "x" * (ectx.WHY_MAX_CHARS + 1)})
    w.record("entry-context.list", "GET", f"{base}/list", case="success", expect=200)
    w.as_user(EMPTY)
    w.record("entry-context.list.empty", "GET", f"{base}/list", case="empty", expect=200)
    w.as_user(uid, FREE)
    w.record("entry-context.position.free-plan", "GET", f"{base}/position/ec-today", case="error", expect=402,
             note="A free plan: the card renders nothing, it is not an error banner.")
    w.as_user(MEMBER)


@builder
def chart_plan(w: World) -> None:
    from api.services import brain_service
    from api.services.journal_two import chart_plan as cp
    uid = w.member("chart-plan")
    base = "/api/j2/chart-plan"
    w.p.setattr(brain_service, "size_a_trade", lambda e, s, a, risk_pct=1.0: {
        "ok": True, "shares": 235, "regime": "GREEN", "risk_pct": risk_pct})
    # Before any account stand-in: the member has no journal account yet, read by the real reader.
    w.as_user(uid)
    w.record("chart-plan.size.default-account", "POST", f"{base}/size", case="empty", expect=200,
             json_body={"annotations": chart_block("CPNV", [("entry", 101.5), ("stop", 97.25)])["attrs"]["annotations"],
                        "symbol": "CPNV"},
             note="A member who never set their sizing: the default account size and no max risk per trade.")
    w.p.setattr(cp, "account_inputs", lambda u, aid=None: {"accountId": "acct-chart", "accountSize": 100000.0,
                                                           "riskPct": 1.0})
    w.p.setattr(cp, "_stock_sector", lambda s: "Energy")
    w.p.setattr(cp, "_stock_theme_etf", lambda s: None)
    block = chart_block("CPNV", [("entry", 101.5), ("stop", 97.25), ("target", 112.0)], embed_id="cp-emb")
    anns = block["attrs"]["annotations"]
    c = w.conn()
    try:
        note = create_note(c, uid, "CPNV plan", doc(para("plan"), block))
        theirs = create_note(c, OTHER, "theirs", doc(para("plan"), chart_block(
            "CPNV", [("entry", 10)], embed_id="cp-emb")))
    finally:
        c.close()
    w.as_user(uid)
    w.record("chart-plan.size", "POST", f"{base}/size", case="success", expect=200,
             json_body={"annotations": anns, "symbol": "CPNV"})
    w.record("chart-plan.size.no-levels", "POST", f"{base}/size", case="empty", expect=200,
             json_body={"annotations": [], "symbol": "CPNV"}, note="A chart with no plan lines drawn yet.")
    w.record("chart-plan.size.bad-body", "POST", f"{base}/size", case="error", expect=422,
             json_body={"annotations": "x"})
    w.as_user(uid, FREE)
    # Landing 12-15: this answered 200 with the starter formulas until the security lane made
    # every new Notebook member route paid (I-7, 6c694e3527). A free member is now refused.
    w.record("chart-plan.size.free-plan", "POST", f"{base}/size", case="error", expect=402,
             json_body={"annotations": anns, "symbol": "CPNV"},
             note="A free member is refused: chart plans take a paid plan (security review I-7).")
    w.as_user(uid)
    # The starter formulas' answer now that a free member is refused: a PAID member Compass did
    # not size. This is production's state while the brain pack is not installed (its flags are
    # off by default): the facade answers "not available" and the client sizes with the starter
    # formulas. Recorded with the facade's own refusal, then the stand-in is put back.
    w.p.setattr(brain_service, "size_a_trade", lambda e, s, a, risk_pct=1.0: {
        "ok": False, "error": "brain not available"})
    w.record("chart-plan.size.compass-unavailable", "POST", f"{base}/size", case="success", expect=200,
             json_body={"annotations": anns, "symbol": "CPNV"},
             note="Compass did not answer (the brain pack is not installed): the starter formulas size it.")
    w.p.setattr(brain_service, "size_a_trade", lambda e, s, a, risk_pct=1.0: {
        "ok": True, "shares": 235, "regime": "GREEN", "risk_pct": risk_pct})
    w.record("chart-plan.benchmarks", "GET", f"{base}/benchmarks?symbol=cpnv", case="success", expect=200)
    w.record("chart-plan.benchmarks.bad-symbol", "GET", f"{base}/benchmarks?symbol=", case="error", expect=422)
    alert = {"noteId": note["id"], "embedId": "cp-emb", "drawingId": "d-CPNV-stop", "direction": "below",
             "alert_type": "line", "target_price": 97.25}
    w.record("chart-plan.alerts.armed", "POST", f"{base}/alerts", case="success", expect=200, json_body=alert)
    w.record("chart-plan.alerts.no-chart", "POST", f"{base}/alerts", case="error", expect=404,
             json_body={**alert, "noteId": theirs["id"]}, note="Another member's note answers the one 404.")
    w.record("chart-plan.alerts.bad-direction", "POST", f"{base}/alerts", case="error", expect=400,
             json_body={**alert, "direction": "sideways"}, note="The existing alert route's own refusal.")
    w.record("chart-plan.alerts.bad-price", "POST", f"{base}/alerts", case="error", expect=422,
             json_body={**alert, "target_price": "abc"})
    w.as_user(None)
    w.record("chart-plan.size.signed-out", "POST", f"{base}/size", case="error", expect=401, json_body={})
    w.as_user(MEMBER)


def _weekdays(start: str, n: int) -> list[str]:
    d = _REAL_DATE.fromisoformat(start)
    out: list[str] = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += _dt.timedelta(days=1)
    return out


@builder
def passed_setups(w: World) -> None:
    from api.services import bars_sqlite
    from api.services.journal_two import passed_setups as ps
    uid = w.member("passed")
    url = "/api/j2/research-capture/passed-setups"
    w.p.setattr(bars_sqlite, "_DB_PATH", w.tmp("bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    days = _weekdays("2026-08-24", 30)                     # the reference session is days[5], 2026-08-31
    bc = bars_sqlite._conn()
    for sym, start in (("SPY", 500.0), ("PSNV", 100.0), ("PSPD", 50.0), ("PSGP", 200.0), ("PSTR", 80.0),
                       ("PSSH", 40.0)):
        for i, day in enumerate(days):
            if sym == "PSGP" and i == 10:
                continue                                   # one session the store never received
            if sym == "PSSH" and i > 7:
                continue                                   # the store stops two sessions after the save
            close = start + (i - 5)
            bc.execute("INSERT OR REPLACE INTO ohlcv (ticker, tf, ts, o, h, l, c, v) VALUES (?,?,?,?,?,?,?,?)",
                       (sym, "D", int(day.replace("-", "")), close, close + 0.5, close - 1, close, 1000))
    bc.commit()
    c = w.conn()
    try:
        ps.ensure_schema(c)
        # The member bought PSTR three sessions after passing on it: it leaves the list, counted.
        c.execute(
            "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares, entry_price,"
            " stop_price, context_at_entry, created_at, updated_at, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("ps-pos", uid, "PSTR", "Long", days[8], 10, 10, 83.0, 80.0, "{}", f"{days[8]}T14:00:00Z",
             f"{days[8]}T14:00:00Z", None))
        c.commit()
    finally:
        c.close()
    w.as_user(uid)
    w.record("passed-setups.empty", "GET", url, case="empty", expect=200)
    w.record("passed-setups.add", "POST", url, case="success", expect=200,
             json_body={"symbol": "PSNV", "savedOn": days[5]})
    w.record("passed-setups.add.no-bars", "POST", url, case="success", expect=200,
             json_body={"symbol": "PSZZ", "savedOn": days[5]},
             note="A name UCT holds no daily bars for: every horizon is a labelled gap.")
    w.record("passed-setups.add.pending", "POST", url, case="success", expect=200,
             json_body={"symbol": "PSPD", "savedOn": days[-3]},
             note="Saved three sessions ago: the later horizons have not happened yet.")
    w.record("passed-setups.add.short-store", "POST", url, case="success", expect=200,
             json_body={"symbol": "PSSH", "savedOn": days[5]},
             note="The store holds two sessions after the save and the market has had more: a labelled gap.")
    w.record("passed-setups.add.gap", "POST", url, case="success", expect=200,
             json_body={"symbol": "PSGP", "savedOn": days[5]},
             note="ONE session is missing in the middle of the stored bars. See docs/notebook/fin-tests.md, "
                  "defect D5: the horizons after the hole are read one session late, with no label.")
    w.record("passed-setups.add.traded", "POST", url, case="success", expect=200,
             json_body={"symbol": "PSTR", "savedOn": days[5]},
             note="A name the member went on to trade: it is counted, not listed.")
    w.record("passed-setups.add.bad-symbol", "POST", url, case="error", expect=400, json_body={"symbol": "<script>"})
    w.record("passed-setups.add.too-old", "POST", url, case="error", expect=400,
             json_body={"symbol": "PSNV", "savedOn": "2026-07-01"})
    w.record("passed-setups.add.future-day", "POST", url, case="error", expect=400,
             json_body={"symbol": "PSNV", "savedOn": "2027-01-04"})
    w.record("passed-setups.add.body-not-an-object", "POST", url, case="error", expect=422, content=b"[1]",
             note="FastAPI's own validation answer: `detail` is a LIST here, not a sentence.")
    listing = w.record("passed-setups.list", "GET", url, case="success", expect=200)
    w.record("passed-setups.dismiss.not-found", "DELETE", f"{url}/nope", case="error", expect=404)
    first = next(i["id"] for i in listing["items"] if i["symbol"] == "PSZZ")
    w.record("passed-setups.dismiss", "DELETE", f"{url}/{first}", case="success", expect=200)
    w.as_user(uid, FREE)
    w.record("passed-setups.free-plan", "GET", url, case="error", expect=402)
    w.as_user(MEMBER)
    bars_sqlite.bump_db_epoch()


@builder
def template_gallery(w: World) -> None:
    from api.services.journal_two import note_properties as np_
    author = w.member("author", "Alice Trader")
    viewer = w.member("viewer", "Bob Viewer")
    base = "/api/j2/template-gallery"
    c = w.conn()
    try:
        setup = np_.create_property_def(author, "Setup", "select",
                                        [{"label": "Breakout", "color": "green"}, {"label": "Pullback"}], conn=c)
        body = doc({"type": "heading", "attrs": {"level": 2},
                    "content": [{"type": "text", "text": "Before the breakout"}]},
                   para("Is the base at least five weeks long?"), para("Is volume drying up into the pivot?"))
        for tid, name in (("tg-template", "My checklist"), ("tg-second", "Weekly review"),
                          ("tg-third", "Earnings notes"), ("tg-fourth", "Sector notes")):
            c.execute("INSERT INTO j2_note_templates (id, user_id, name, title, body_json, properties_json,"
                      " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                      (tid, author, name, name, json.dumps(body),
                       json.dumps({"builtin:thesis_status": "active", setup["id"]: setup["options"][0]["id"]}),
                       "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"))
        c.commit()
    finally:
        c.close()
    w.as_user(viewer)
    w.record("template-gallery.list.empty", "GET", base, case="empty", expect=200,
             note="Before any member has shared one: only UCT's own templates.")
    w.as_user(author)
    publish = {"templateId": "tg-template", "title": "Breakout checklist",
               "description": "What I check before a breakout.", "category": "trade_plan"}
    pending = w.record("template-gallery.publish", "POST", base, case="success", expect=200, json_body=publish)
    gid = pending["template"]["id"]

    def submit(template_id: str, title: str, category: str) -> str:
        res = w.client.post(base, json={"templateId": template_id, "title": title, "description": "",
                                        "category": category})
        if res.status_code != 200:
            raise AssertionError(f"could not submit {title}: {res.status_code} {res.text[:200]}")
        return res.json()["template"]["id"]
    second = submit("tg-second", "Weekly review", "review")
    third = submit("tg-third", "Earnings notes", "research")
    fourth = submit("tg-fourth", "Sector notes", "research")
    w.record("template-gallery.publish.bad-category", "POST", base, case="error", expect=400,
             json_body={**publish, "category": "memes"})
    w.record("template-gallery.publish.no-title", "POST", base, case="error", expect=400,
             json_body={**publish, "title": "   "})
    w.record("template-gallery.publish.unknown-template", "POST", base, case="error", expect=404,
             json_body={**publish, "templateId": "nope"})
    w.record("template-gallery.publish.bad-body", "POST", base, case="error", expect=422, content=b"[1]")
    w.record("template-gallery.list.mine.pending", "GET", f"{base}?section=mine", case="success", expect=200,
             note="The author's own submissions while they all wait for review.")
    w.as_user(author, FREE)
    w.record("template-gallery.publish.free-plan", "POST", base, case="error", expect=402, json_body=publish)
    w.as_user(viewer)
    w.record("template-gallery.item.pending-hidden", "GET", f"{base}/{gid}", case="error", expect=404,
             note="A submission waiting for review is the one 404 to everyone but its author and an admin.")
    w.as_user(ADMIN)
    first_queue = w.record("template-gallery.admin.queue", "GET", f"{base}/admin/queue", case="success",
                           expect=200, note="Four submissions waiting, nothing reported or hidden yet.")
    # Landing 12-15: an approval names the version the reviewer saw (security review I-6,
    # 0cee0950c4). The value is read off the queue answer just recorded, as the review panel does.
    seen = next(row["updatedAt"] for row in first_queue["pending"] if row["id"] == gid)
    w.record("template-gallery.admin.approve", "PATCH", f"{base}/admin/items/{gid}", case="success", expect=200,
             json_body={"action": "approve", "reviewedUpdatedAt": seen})
    w.record("template-gallery.admin.approve.stale", "PATCH", f"{base}/admin/items/{third}", case="error",
             expect=409, json_body={"action": "approve"},
             note="An approval that does not name the version the reviewer saw is refused.")
    w.record("template-gallery.admin.reject", "PATCH", f"{base}/admin/items/{second}", case="success", expect=200,
             json_body={"action": "reject", "note": "Too thin to be useful yet."})
    w.record("template-gallery.admin.bad-action", "PATCH", f"{base}/admin/items/{gid}", case="error", expect=400,
             json_body={"action": "explode"})
    w.as_user(author)
    w.record("template-gallery.list.mine", "GET", f"{base}?section=mine", case="success", expect=200,
             note="One listed, one not approved (with the reviewer's note), two still waiting.")
    w.as_user(viewer)
    w.record("template-gallery.admin.queue.forbidden", "GET", f"{base}/admin/queue", case="error", expect=403)
    w.record("template-gallery.list", "GET", base, case="success", expect=200,
             note="UCT's picks and one member's approved template.")
    w.record("template-gallery.list.bad-sort", "GET", f"{base}?sort=loudest", case="error", expect=400)
    w.record("template-gallery.item", "GET", f"{base}/{gid}", case="success", expect=200)
    w.record("template-gallery.item.not-found", "GET", f"{base}/nope", case="error", expect=404)
    w.record("template-gallery.use", "POST", f"{base}/{gid}/use", case="success", expect=200)
    w.record("template-gallery.use.not-found", "POST", f"{base}/nope/use", case="error", expect=404)
    w.record("template-gallery.report", "POST", f"{base}/{gid}/report", case="success", expect=200,
             json_body={"reason": "broken", "note": "The second line is cut off."})
    w.record("template-gallery.report.already", "POST", f"{base}/{gid}/report", case="success", expect=200,
             json_body={"reason": "spam"})
    w.record("template-gallery.report.bad-reason", "POST", f"{base}/{gid}/report", case="error", expect=400,
             json_body={"reason": "boring"})
    w.as_user(author)
    w.record("template-gallery.report.own", "POST", f"{base}/{gid}/report", case="error", expect=400,
             json_body={"reason": "spam"}, note="A member cannot report their own template.")
    w.as_user(ADMIN)
    # A fourth submission approved and then hidden, so the queue holds one of each kind at once.
    # ⛔ A setup call that is CHECKED. It used to be an unchecked PATCH; once approvals had to name
    # the reviewed version (security I-6) it answered 409 silently, the template stayed pending,
    # and every fixture below recorded a hidden-but-never-approved template without a word.
    seen_fourth = next(row["updatedAt"] for row in first_queue["pending"] if row["id"] == fourth)
    approved = w.client.patch(f"{base}/admin/items/{fourth}",
                              json={"action": "approve", "reviewedUpdatedAt": seen_fourth})
    assert approved.status_code == 200, f"setup: approving the fourth template answered {approved.status_code}"
    w.record("template-gallery.admin.hide", "PATCH", f"{base}/admin/items/{fourth}", case="success", expect=200,
             json_body={"action": "hide"})
    queue = w.record("template-gallery.admin.queue.full", "GET", f"{base}/admin/queue", case="success", expect=200,
                     note="One waiting, one reported (with its report), one hidden.")
    w.record("template-gallery.admin.unhide", "PATCH", f"{base}/admin/items/{fourth}", case="success", expect=200,
             json_body={"action": "unhide"})
    report_id = queue["reported"][0]["reports"][0]["id"]
    w.record("template-gallery.admin.report.hide", "PATCH", f"{base}/admin/reports/{report_id}", case="success",
             expect=200, json_body={"action": "hide"})
    w.record("template-gallery.admin.report.not-found", "PATCH", f"{base}/admin/reports/nope", case="error",
             expect=404, json_body={"action": "dismiss"})
    w.as_user(author)
    w.record("template-gallery.unpublish", "DELETE", f"{base}/{third}", case="success", expect=200)
    w.record("template-gallery.unpublish.not-found", "DELETE", f"{base}/{third}", case="error", expect=404)
    w.as_user(None)
    w.record("template-gallery.list.signed-out", "GET", base, case="error", expect=401)
    w.as_user(MEMBER)


@builder
def remaining_routes(w: World) -> None:
    """The routes outside the ten converted surfaces: find similar, transcripts, the fingerprint,
    the entry-context backfill and the gallery's report queue. Recorded so every wave 12 to 15
    Notebook route has at least one pinned answer."""
    from api.services.journal_two import tech_fingerprint as tfp
    visual = w.member("visual")
    context = w.member("context")
    sim, tr, fp = "/api/j2/similar-names", "/api/j2/research-capture/transcripts", "/api/j2/notebook-fingerprint"

    # Find more like this reads only what the nightly job stored. The job itself is run here, the
    # real one, over a fixed universe of screener rows (no screener store, no vendor): its rows
    # are the stored artefact, written by the product's own writer.
    from api.services.journal_two import similar_matches as sm
    def universe_row(i: int) -> dict[str, Any]:
        return {"ticker": f"SM{i:02d}", "bars_asof": "20261002", "is_etf": 0, "candle_score": 3,
                "adr_pct": 5.0 + 0.2 * i, "pct_vs_sma20": 2.0, "pct_vs_sma50": 10.0, "pct_vs_sma200": 30.0,
                "ma_stack": "full-bull", "ema_stack_intact": 1, "rs_rank": 92 - i, "rs_line_trend": "up",
                "pullback_depth_pct": 12.0 + 0.5 * i, "vol_nweek_low": None, "close_cv_pct": 1.5,
                "pole_pct": 60.0}
    template_values = {"adr_pct": 5.0, "pct_vs_sma20": 2.0, "pct_vs_sma50": 10.0, "pct_vs_sma200": 30.0,
                       "ma_stack": "full-bull", "ema_stack_intact": True, "rs_rank": 92, "rs_line_trend": "up",
                       "pullback_depth_pct": 12.0, "close_cv_pct": 1.5, "pole_pct": 60.0}
    c = w.conn()
    try:
        ran = sm.run_nightly(conn=c, universe=sm.universe_from_rows([universe_row(i) for i in range(15)]),
                             compute=lambda symbol, as_of: _fingerprint(**template_values),
                             pattern_field=lambda a, sym: {"value": ["vcp"] if sym in ("SM00", "SM01") else [],
                                                           "missing": None})
        stored = c.execute("SELECT user_id, note_id, embed_key FROM j2_similar_matches"
                           " ORDER BY user_id, note_id, embed_key LIMIT 1").fetchone()
        who = sorted({r[0] for r in c.execute("SELECT DISTINCT user_id FROM j2_similar_matches")})
    finally:
        c.close()
    if not ran.get("ran") or stored is None:
        raise AssertionError(f"the nightly similar-names job stored nothing: {ran!r}")
    # The one tagged chart with a full fingerprint is the setups board's own (SBNV, on MEMBER's
    # board): the visual playbook's charts carry one or two values each and are too thin to rank.
    if who != [MEMBER] or stored[2] != "e-SBNV":
        raise AssertionError(f"expected the board's tagged SBNV chart to be the one matched, got {who!r} {stored[2]!r}")
    board_note = (stored[1],)
    w.as_user(MEMBER)
    w.record("similar-names.templates", "GET", f"{sim}/templates", case="success", expect=200,
             note="The member's tagged charts the nightly job matched.")
    w.record("similar-names.matches", "GET", f"{sim}/{board_note[0]}/e-SBNV", case="success", expect=200,
             note="Tonight's stored matches for one tagged chart, written by the real nightly job.")
    w.as_user(EMPTY)
    w.record("similar-names.templates.empty", "GET", f"{sim}/templates", case="empty", expect=200)
    w.record("similar-names.matches.not-found", "GET", f"{sim}/nope/nope", case="error", expect=404)
    w.as_user(EMPTY, FREE)
    w.record("similar-names.templates.free-plan", "GET", f"{sim}/templates", case="error", expect=402)

    w.as_user(EMPTY)
    w.record("transcripts.quarters.empty", "GET", f"{tr}/TRNV/quarters", case="empty", expect=200,
             note="A name UCT holds no transcript for.")
    w.record("transcripts.quarters.bad-symbol", "GET", f"{tr}/no%20way/quarters", case="error", expect=400)
    w.record("transcripts.read.not-held", "GET", f"{tr}/TRNV/2026Q2", case="error", expect=404)
    w.record("transcripts.read.bad-quarter", "GET", f"{tr}/TRNV/soon", case="error", expect=400)
    w.record("transcripts.save.not-held", "POST", f"{tr}/save", case="error", expect=404,
             json_body={"noteId": "nope", "symbol": "TRNV", "quarter": "2026Q2", "turn": 0, "passage": "x"})
    w.record("transcripts.save.body-not-an-object", "POST", f"{tr}/save", case="error", expect=422, content=b"[1]",
             note="FastAPI's own validation answer: `detail` is a LIST here, not a sentence.")
    # A transcript UCT holds: stored through the index's own writer, in a temporary index file.
    from api.services import transcript_index
    from api.services.journal_two import notes as notes_service
    w.p.setattr(transcript_index, "DB_PATH", w.tmp("transcript_index.db"))
    w.p.setattr(transcript_index, "_INITED", False)
    transcript_index.put("TRHD", 2026, 2, "2026-08-27", (
        "Operator: Good afternoon. Welcome to the second quarter call.\n"
        "Chief Financial Officer: Revenue was a record, up 56% year over year. Data center revenue grew\n"
        "sequentially, and gross margin was 72.4%.\n"
        "Chief Executive Officer: Demand is extraordinary. We are sold out through next year.\n"
        "Analyst One: Can you talk about supply?\n"
        "Chief Executive Officer: Supply is improving every quarter.\n"))
    reader = w.member("transcripts")
    c = w.conn()
    try:
        held_note = notes_service.create_note(reader, {"title": "TRHD thesis", "ticker": "TRHD"}, conn=c)
    finally:
        c.close()
    w.as_user(reader)
    w.record("transcripts.quarters", "GET", f"{tr}/TRHD/quarters", case="success", expect=200)
    w.record("transcripts.read", "GET", f"{tr}/TRHD/2026Q2", case="success", expect=200,
             note="A held transcript as numbered turns.")
    passage = {"noteId": held_note["id"], "symbol": "TRHD", "quarter": "2026Q2", "turn": 2,
               "passage": "gross margin was 72.4%", "annotation": "Margins held."}
    w.record("transcripts.save", "POST", f"{tr}/save", case="success", expect=200, json_body=passage,
             note="A passage saved into the member's note, cited to its source, date and turn.")
    w.record("transcripts.save.again", "POST", f"{tr}/save", case="success", expect=200, json_body=passage,
             note="The same passage saved twice is the one excerpt.")
    w.record("transcripts.save.passage-not-in-turn", "POST", f"{tr}/save", case="error", expect=422,
             json_body={**passage, "passage": "words the speaker never said"})
    w.as_user(EMPTY)

    w.p.setattr(tfp, "compute", lambda symbol, as_of=None: _fingerprint(rs_rank=88, base_depth_pct=14.0))
    w.as_user(visual)
    w.record("fingerprint.meta", "GET", f"{fp}/meta", case="success", expect=200)
    w.record("fingerprint.compute", "GET", f"{fp}/compute?symbol=VPNV", case="success", expect=200)
    blocks = w.record("fingerprint.blocks", "GET", f"{fp}/blocks", case="success", expect=200)
    first = blocks["blocks"][0]
    w.record("fingerprint.block", "GET", f"{fp}/blocks/{first['noteId']}/{first['embedKey']}", case="success",
             expect=200)
    w.record("fingerprint.block.not-found", "GET", f"{fp}/blocks/nope/nope", case="error", expect=404)
    w.record("fingerprint.freeze.not-found", "POST", f"{fp}/blocks/nope/nope/freeze", case="error", expect=404)
    c = w.conn()
    try:
        freezer = w.member("freeze")          # a member of its own: the visual playbook's counts stay put
        unfrozen = create_note(c, freezer, "VPFZ plan", doc(para("plan"), chart_block(
            "VPFZ", [], embed_id="vp-z", tag="VCP", image=True, mode="snapshot",
            to=1759255200 + 365 * 86400, captured="2026-09-30T18:00:00Z")))
    finally:
        c.close()
    w.as_user(freezer)
    w.record("fingerprint.freeze", "POST", f"{fp}/blocks/{unfrozen['id']}/vp-z/freeze", case="success", expect=200,
             note="A tagged chart with no fingerprint yet: computed once (a stand-in here) and stored.")
    w.record("fingerprint.freeze.again", "POST", f"{fp}/blocks/{unfrozen['id']}/vp-z/freeze", case="success",
             expect=200, note="Frozen is frozen: the second call returns the stored one.")
    w.as_user(visual)
    # A tagged chart whose trade was entered today, with its market context frozen at the fill:
    # the regime filter has something to count, and something to leave out.
    c = w.conn()
    try:
        n = create_note(c, visual, "VPRG plan", doc(para("plan"), chart_block(
            "VPRG", [], embed_id="vp-r", tag="VCP", fingerprint=_fingerprint(rs_rank=90), image=True,
            mode="snapshot", to=None, captured=f"{TODAY}T14:00:00Z")))
        add_trade(c, "vp-today", user=visual, symbol="VPRG", entry=100.0, exit_=104.0, stop=96.0,
                  entry_date=f"{TODAY}T14:00:00+00:00", exit_date=f"{TODAY}T14:20:00+00:00")
        c.execute(
            "INSERT INTO j2_trade_plan_links (user_id, trade_ref, symbol, source_kind, match_tier, note_id,"
            " plan_json, flags_json, matched_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (visual, "id:vp-today", "VPRG", "note", "window", n["id"],
             json.dumps({"entry": 100.0, "stop": 96.0, "target": 112.0, "shares": 100}), "[]", f"{TODAY}T00:00:00Z"))
        c.commit()
    finally:
        c.close()
    captured = w.client.get("/api/j2/entry-context/trade/vp-today").json()
    if captured.get("status") != "captured":
        raise AssertionError(f"the regime fixture needs a frozen context, got {captured.get('status')!r}")
    vpb = "/api/j2/notebook-visual-playbook"
    w.record("visual-playbook.cards.with-regime", "GET", f"{vpb}/cards", case="success", expect=200,
             note="One chart's trade has a regime frozen at entry; the others have none.")
    w.record("visual-playbook.cards.regime-filtered", "GET", f"{vpb}/cards?regime=green", case="success",
             expect=200, note="Filtered to a regime: charts with no frozen regime are left out, and counted.")
    w.as_user(EMPTY)
    w.record("fingerprint.blocks.empty", "GET", f"{fp}/blocks", case="empty", expect=200)
    w.as_user(visual, FREE)
    w.record("fingerprint.meta.free-plan", "GET", f"{fp}/meta", case="error", expect=402)

    w.as_user(context)
    w.record("entry-context.backfill", "POST", "/api/j2/entry-context/backfill", case="success", expect=200)
    w.record("entry-context.position.captured-late", "GET", "/api/j2/entry-context/position/ec-old",
             case="success", expect=200, note="An older entry the backfill captured afterwards, labelled late.")
    w.as_user(MEMBER)


def route_table(app: Any) -> list[tuple[str, str]]:
    """`(METHOD, path template)` for every route on the app, sorted. DERIVED from the routers,
    never typed, so a route added tomorrow is in the sweeps and the coverage rail the day it lands."""
    out = set()
    for r in app.routes:
        methods = getattr(r, "methods", None)
        if not methods or not getattr(r, "path", "").startswith("/api/"):
            continue
        for m in methods:
            if m not in ("HEAD", "OPTIONS"):
                out.add((m, r.path))
    return sorted(out)


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x", path)


@builder
def sweeps(w: World) -> None:
    """Two answers every route gives, in one file each: signed out with the flags on (401), and
    signed out with every flag off (the one 404, BEFORE the session is read)."""
    def sweep(expect: int) -> dict[str, Any]:
        rows: dict[str, Any] = {}
        for method, path in route_table(w.app):
            res = w.client.request(method, _concrete(path), **({} if method in ("GET", "DELETE") else {"json": {}}))
            if res.status_code != expect:
                raise AssertionError(f"sweep: {method} {path} answered {res.status_code}, wanted {expect}: "
                                     f"{res.text[:200]}")
            rows[f"{method} {path}"] = {"status": res.status_code, "body": res.json()}
        return rows

    w.as_user(None)
    w.out["sweep.signed-out"] = {
        "_contract": {"endpoint": "every route", "case": "error", "status": 401, "path": "",
                      "note": "No session, every flag on."},
        "body": sweep(401)}
    for flag in FLAGS:
        w.p.setenv(flag, "0")
    w.out["sweep.flags-off"] = {
        "_contract": {"endpoint": "every route", "case": "error", "status": 404, "path": "",
                      "note": "Every flag off, no session: the gate answers before the session is read."},
        "body": sweep(404)}
    for flag in FLAGS:
        w.p.setenv(flag, "1")
    w.as_user(MEMBER)


@builder
def shared_constants(w: World) -> None:
    """Lists the client restates by hand. Not an endpoint: the server's own tables, written out so a
    frontend test can hold the client's copy equal to them."""
    from api.services.journal_two import note_properties, template_gallery
    status = next(d for d in note_properties.BUILTIN_PROPERTY_DEFS if d["id"] == "builtin:thesis_status")
    w.out["constants.thesis-status-options"] = {
        "_contract": {"endpoint": "note_properties.BUILTIN_PROPERTY_DEFS['builtin:thesis_status'].options",
                      "case": "constant", "status": 0, "path": ""},
        "body": {"options": list(status["options"])}}
    w.out["constants.template-gallery"] = {
        "_contract": {"endpoint": "template_gallery.CATEGORIES / REPORT_REASONS", "case": "constant", "status": 0,
                      "path": ""},
        "body": {"categories": list(template_gallery.CATEGORIES),
                 "reportReasons": list(template_gallery.REPORT_REASONS)}}


# ── normalising, writing, checking ────────────────────────────────────────────────────────────

#: Every value the normaliser rewrote in the last run (for `--explain`, and for the rail).
NORMALISED: list[str] = []

_TS = re.compile(r"^(\d{4}-\d{2}-\d{2})([T ])(\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$")


def _real_days(started: _dt.datetime) -> set[str]:
    return {(started + _dt.timedelta(days=d)).strftime("%Y-%m-%d") for d in (-1, 0, 1)}


def _normalise(value: Any, real_days: set[str]) -> Any:
    """A timestamp SQLite (or any un-frozen clock) stamped during the run becomes the frozen
    instant, keeping its own format. Nothing else is touched."""
    if isinstance(value, dict):
        return {k: _normalise(v, real_days) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalise(v, real_days) for v in value]
    if isinstance(value, str):
        m = _TS.match(value)
        if m and m.group(1) in real_days:
            NORMALISED.append(value)
            frac = "." + "0" * (len(m.group(4)) - 1) if m.group(4) else ""
            return f"{TODAY}{m.group(2)}14:30:00{frac}{m.group(5) or ''}"
    return value


def _render(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def generate() -> dict[str, str]:
    """Every fixture, as `{name: file text}`. Touches no file outside the temporary database."""
    violations_before = len(conftest.SHARED_ROOT_VIOLATIONS)
    del NETWORK_ATTEMPTS[:]
    del NORMALISED[:]
    with World() as w:
        for build in BUILDERS:
            build(w)
        real_days = _real_days(w._real_started)
        out = {name: _render(_normalise(payload, real_days)) for name, payload in sorted(w.out.items())}
    stray = conftest.SHARED_ROOT_VIOLATIONS[violations_before:]
    if stray:
        raise AssertionError(f"the generator reached the shared data root: {stray!r}")
    if NETWORK_ATTEMPTS:
        raise AssertionError("the generator tried to reach the network (replace that source with a "
                             f"stand-in): {sorted(set(NETWORK_ATTEMPTS))!r}")
    # A day this file SEEDS on purpose is not a leak when the calendar happens to reach it.
    seeded = set(re.findall(r"\d{4}-\d{2}-\d{2}", Path(__file__).read_text(encoding="utf-8")))
    leaks = sorted({f"{name}: {day}" for name, text in out.items() for day in real_days - seeded if day in text})
    if leaks:
        raise AssertionError("the real clock leaked into a fixture (freeze it or normalise it): " + "; ".join(leaks))
    return out


def committed() -> dict[str, str]:
    if not FIXTURE_DIR.is_dir():
        return {}
    return {p.stem: p.read_text(encoding="utf-8") for p in sorted(FIXTURE_DIR.glob("*.json"))}


def diff(fresh: dict[str, str], on_disk: dict[str, str]) -> list[str]:
    """Names, never a count: every fixture that is missing, extra or different."""
    problems = [f"missing on disk: {n}" for n in sorted(set(fresh) - set(on_disk))]
    problems += [f"on disk but no longer generated: {n}" for n in sorted(set(on_disk) - set(fresh))]
    for name in sorted(set(fresh) & set(on_disk)):
        if fresh[name] != on_disk[name]:
            a, b = on_disk[name].splitlines(), fresh[name].splitlines()
            at = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            was = a[at].strip() if at < len(a) else "<end of file>"
            now = b[at].strip() if at < len(b) else "<end of file>"
            problems.append(f"differs: {name} (line {at + 1}: committed `{was}` / server now `{now}`)")
    return problems


def write(fresh: dict[str, str]) -> list[str]:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    changed = []
    for stale in sorted(set(committed()) - set(fresh)):
        (FIXTURE_DIR / f"{stale}.json").unlink()
        changed.append(f"removed {stale}")
    for name, text in fresh.items():
        path = FIXTURE_DIR / f"{name}.json"
        # Compared as TEXT: git may have checked the file out with either line ending, and a
        # rewrite for that alone would show every fixture as changed.
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
            changed.append(f"wrote {name}")
    return changed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="exit 1 when the committed fixtures differ")
    ap.add_argument("--list", action="store_true", help="print the fixture names and exit")
    args = ap.parse_args(argv)
    fresh = generate()
    if args.list:
        print("\n".join(fresh))
        return 0
    if args.check:
        problems = diff(fresh, committed())
        print("\n".join(problems) if problems else f"OK: {len(fresh)} contract fixtures match the server")
        return 1 if problems else 0
    changed = write(fresh)
    print("\n".join(changed) if changed else "nothing changed")
    print(f"{len(fresh)} contract fixtures in {FIXTURE_DIR.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
