"""Tests for the Phase B discipline state computation."""
from __future__ import annotations

import ast
import functools
import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import NamedTuple
from zoneinfo import ZoneInfo

import pytest


ET = ZoneInfo("America/New_York")


# ── Deterministic clock ──────────────────────────────────────────────────────
#
# Two of the tests below assert "a no-trade window CONTAINING now locks
# trading". Built as `now ± delta` off a LIVE clock, that window wraps ET
# midnight for twenty minutes a day, and settings._validate_no_trade_windows
# deliberately refuses a wrapping window ("No overnight windows allowed in
# v1"). The tests therefore went red 23:50-00:09 ET on a correct product --
# 22:50-23:09 on this CT box, which is why it read as late-night flakiness.
#
# The fix is a fixed anchor plus a fully frozen wall clock. A HALF-faked clock
# is worse than none (fake it in the test module only and
# test_cooling_off_clears_after_window starts failing on a live
# discipline.py -- measured), so the module list is DERIVED by an AST walk of
# the call graph the tests execute, never typed, and a rail fails by
# file:line when a reader appears that the freeze would miss.

# The instant the two window tests build their window around. Fixed, so the
# window is the same one every run. Mid-afternoon, well clear of ET midnight;
# 2026-03-11 is a Wednesday, three days past the DST transition.
_ANCHOR_ET = datetime(2026, 3, 11, 14, 30, 0, tzinfo=ET)

# The wall clock the whole process observes, parametrized ACROSS the old blast
# radius. 23:59:30 is the hour the two tests used to fail: if anyone
# re-derives a window from datetime.now() it goes red there immediately
# instead of once a night.
_AMBIENT_CLOCKS = [
    pytest.param(_ANCHOR_ET, id="wall-clock-mid-afternoon"),
    pytest.param(
        datetime(2026, 3, 11, 23, 59, 30, tzinfo=ET), id="wall-clock-2359-old-bomb-window"
    ),
]

_REPO_ROOT = Path(__file__).resolve().parents[3]

# (dotted prefix, attribute) shapes that read the CURRENT time. `datetime.min.time`
# is excluded by construction: its prefix is `datetime.min`, not `datetime`.
_CLOCK_CALL_SHAPES = frozenset({
    ("datetime", "now"), ("datetime", "utcnow"), ("datetime", "today"),
    ("datetime.datetime", "now"), ("datetime.datetime", "utcnow"),
    ("datetime.datetime", "today"),
    ("date", "today"), ("datetime.date", "today"),
    ("time", "time"), ("time", "time_ns"), ("time", "monotonic"),
})


class _ClockRead(NamedTuple):
    module: str
    func: str
    lineno: int
    prefix: str
    attr: str
    via: str

    def describe(self) -> str:
        src = self.module.replace(".", "/") + ".py"
        return (
            f"{src}:{self.lineno}  in {self.func}()  ->  {self.prefix}.{self.attr}()"
            f"   [reached via {self.via}]"
        )


@functools.cache
def _parse_module(dotted: str):
    """AST for an in-scope module, or None when it is outside api/services."""
    if not dotted.startswith("api.services."):
        return None
    path = _REPO_ROOT.joinpath(*dotted.split(".")).with_suffix(".py")
    if not path.is_file():
        return None
    try:
        return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError:
        return None


def _functions_of(dotted: str) -> dict:
    tree = _parse_module(dotted)
    if tree is None:
        return {}
    out = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out[node.name] = node
        elif isinstance(node, ast.ClassDef):
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    out[f"{node.name}.{sub.name}"] = sub
    return out


def _import_aliases(dotted: str) -> dict:
    """alias -> dotted target, covering function-local imports too."""
    tree = _parse_module(dotted)
    if tree is None:
        return {}
    amap = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            for a in node.names:
                amap[a.asname or a.name] = f"{node.module}.{a.name}"
        elif isinstance(node, ast.Import):
            for a in node.names:
                amap[a.asname or a.name] = a.name
    return amap


def _dotted_prefix(node: ast.AST) -> str | None:
    """`datetime` / `datetime.datetime` for an attribute chain, else None."""
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


def _clock_reads_in(fn) -> list:
    hits = []
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        prefix = _dotted_prefix(node.func.value)
        if prefix and (prefix, node.func.attr) in _CLOCK_CALL_SHAPES:
            hits.append((node.lineno, prefix, node.func.attr))
    return hits


def _resolve_call(node, dotted, amap, local_funcs):
    f = node.func
    if isinstance(f, ast.Name):
        if f.id in local_funcs:
            return (dotted, f.id)
        target = amap.get(f.id)
        if target:
            mod, _, name = target.rpartition(".")
            if _parse_module(mod) is not None:
                return (mod, name)
        return None
    if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
        base = amap.get(f.value.id)
        if base and _parse_module(base) is not None:
            return (base, f.attr)
    return None


def _seed_functions():
    """The entry points the two window tests actually call, taken from the
    live objects rather than retyped as strings."""
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two import discipline as disc

    return (
        (disc.__name__, disc.compute_discipline_state.__name__),
        (accounts_service.__name__, accounts_service.upsert_account_settings.__name__),
        (accounts_service.__name__, accounts_service.get_or_migrate_default_account.__name__),
    )


@functools.cache
def _reachable_clock_reads():
    """(reads, unresolved) over the call graph the two window tests execute."""
    seen: set = set()
    reads: list = []
    unresolved: set = set()
    frontier = [(m, f, (f,)) for m, f in _seed_functions()]
    while frontier:
        dotted, name, path = frontier.pop()
        if (dotted, name) in seen:
            continue
        seen.add((dotted, name))
        funcs = _functions_of(dotted)
        fn = funcs.get(name)
        if fn is None:
            unresolved.add(f"{dotted}.{name}")
            continue
        amap = _import_aliases(dotted)
        via = " -> ".join(path)
        for lineno, prefix, attr in _clock_reads_in(fn):
            reads.append(_ClockRead(dotted, name, lineno, prefix, attr, via))
        for node in ast.walk(fn):
            if isinstance(node, ast.Call):
                target = _resolve_call(node, dotted, amap, funcs)
                if target:
                    frontier.append((*target, path + (f"{target[0].rpartition('.')[2]}.{target[1]}",)))
    return tuple(reads), frozenset(unresolved)


def _make_frozen_datetime(frozen: datetime):
    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen.astimezone(tz) if tz is not None else frozen.astimezone().replace(tzinfo=None)

        @classmethod
        def utcnow(cls):
            return frozen.astimezone(timezone.utc).replace(tzinfo=None)

        @classmethod
        def today(cls):
            return cls.now()

    return _FrozenDatetime


def _make_frozen_date(frozen: datetime):
    local = frozen.astimezone().date()

    class _FrozenDate(date):
        @classmethod
        def today(cls):
            return date(local.year, local.month, local.day)

    return _FrozenDate


# prefix -> (builder, probe, expected). The rail below fails by name on any
# reachable clock reader whose prefix is absent here.
_FREEZERS = {
    "datetime": (
        _make_frozen_datetime,
        lambda cls: cls.now(timezone.utc),
        lambda frozen: frozen.astimezone(timezone.utc),
    ),
    "date": (
        _make_frozen_date,
        lambda cls: cls.today(),
        lambda frozen: frozen.astimezone().date(),
    ),
}


class _FrozenClock(NamedTuple):
    wall: datetime          # what every datetime.now() in the process returns
    wall_utc: datetime
    patched: frozenset      # {(module, prefix)} actually pinned


@pytest.fixture(params=_AMBIENT_CLOCKS)
def frozen_clock(request, monkeypatch) -> _FrozenClock:
    """Pin every clock source the call graph can execute, plus this module's.

    Yields only after PROVING each patch is in force -- a freeze that silently
    is not applied is the failure mode this exists to prevent.
    """
    wall: datetime = request.param
    reads, _ = _reachable_clock_reads()
    targets = {(r.module, r.prefix) for r in reads} | {(__name__, "datetime")}

    patched = set()
    for dotted, prefix in sorted(targets):
        freezer = _FREEZERS.get(prefix)
        if freezer is None:
            continue
        module = importlib.import_module(dotted)
        if not isinstance(getattr(module, prefix, None), type):
            continue
        monkeypatch.setattr(module, prefix, freezer[0](wall))
        patched.add((dotted, prefix))

    for dotted, prefix in sorted(patched):
        _, probe, expected = _FREEZERS[prefix]
        observed = probe(getattr(importlib.import_module(dotted), prefix))
        assert observed == expected(wall), (
            f"the freeze did not take in {dotted}.{prefix}: it reports "
            f"{observed!r}, expected {expected(wall)!r}"
        )

    return _FrozenClock(wall, wall.astimezone(timezone.utc), frozenset(patched))


def _window_around(now_et: datetime, minutes: int) -> tuple[str, str]:
    """An HH:MM no-trade window centred on `now_et`, ± `minutes`.

    Asserts it does not wrap ET midnight: _validate_no_trade_windows refuses an
    overnight window in v1, so a wrapping one would fail these tests on the
    product's correct behaviour instead of on what they assert.
    """
    start = (now_et - timedelta(minutes=minutes)).strftime("%H:%M")
    end = (now_et + timedelta(minutes=minutes)).strftime("%H:%M")
    assert start < end, (
        f"anchor {now_et.isoformat()} ±{minutes}min wraps ET midnight "
        f"({start} -> {end}). v1 rejects overnight windows by design -- move the "
        f"anchor, do not widen the product."
    )
    return start, end


@pytest.fixture
def db_conn(monkeypatch):
    """Fresh temp DB per test, mirroring test_settings.py's pattern."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _baseline_payload():
    return {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
    }


def _seed_account(db_conn, user_id="u_disc"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, pnl_dollar, exit_iso, result="Loss"):
    """Helper: insert one closed trade with a specific exit ISO timestamp.
    j2_trades.exit_date stores full ISO timestamps (not date-only)."""
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id
        )
        VALUES (?, ?, ?, 'TEST', 'Long', 100, 100, ?, 99, ?, 99,
                NULL, NULL, ?, -1, NULL, 1, ?, '{}', ?, ?)
        """,
        (
            str(uuid.uuid4()), user_id, str(uuid.uuid4()),
            exit_iso, exit_iso, pnl_dollar, result,
            exit_iso, account_id,
        ),
    )
    conn.commit()


def test_no_settings_means_unlocked(db_conn):
    from api.services.journal_two import discipline as disc
    acc = _seed_account(db_conn)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert state["locked"] is False
    assert state["reasons"] == []
    assert state["todaysPnlDollar"] == 0
    assert state["todaysPnlPct"] == 0


def test_daily_loss_limit_locks_when_breached(db_conn):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "dailyLossLimitPct": 2},
        conn=db_conn,
    )
    today_et = datetime.now(ET).date()
    exit_iso = datetime.combine(today_et, datetime.min.time(), tzinfo=ET).astimezone(timezone.utc).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-2500, exit_iso=exit_iso)

    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert state["locked"] is True
    assert any(r["type"] == "daily_loss" for r in state["reasons"])


def test_cooling_off_locks_within_window(db_conn):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "coolingOffMinutesAfterLoss": 15},
        conn=db_conn,
    )
    five_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-100, exit_iso=five_min_ago)

    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    cooling = next((r for r in state["reasons"] if r["type"] == "cooling_off"), None)
    assert cooling is not None
    assert "unlockAt" in cooling


def test_cooling_off_clears_after_window(db_conn):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "coolingOffMinutesAfterLoss": 15},
        conn=db_conn,
    )
    twenty_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-100, exit_iso=twenty_min_ago)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert not any(r["type"] == "cooling_off" for r in state["reasons"])


def test_no_trade_window_locks_during_window(db_conn, frozen_clock):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    now_et = _ANCHOR_ET
    start, end = _window_around(now_et, 10)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "noTradeWindowsET": [{"start": start, "end": end, "label": "Test"}]},
        conn=db_conn,
    )
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn, now=now_et)
    assert any(r["type"] == "no_trade_window" for r in state["reasons"]), (
        f"window {start}-{end} ET contains now={now_et.isoformat()} but did not lock; "
        f"reasons fired: {sorted(r['type'] for r in state['reasons'])}"
    )


def test_multiple_reasons_can_fire_simultaneously(db_conn, frozen_clock):
    from api.services.journal_two import discipline as disc
    from api.services.journal_two import accounts as accounts_service
    acc = _seed_account(db_conn)
    now_et = _ANCHOR_ET
    start, end = _window_around(now_et, 5)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(),
         "dailyLossLimitPct": 2,
         "coolingOffMinutesAfterLoss": 15,
         "noTradeWindowsET": [{"start": start, "end": end, "label": "Test"}]},
        conn=db_conn,
    )
    # Anchored to the same instant the window is, so the cooling-off arithmetic
    # and the window can never be measured against two different clocks.
    exit_iso = (now_et - timedelta(minutes=5)).astimezone(timezone.utc).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-3000, exit_iso=exit_iso)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn, now=now_et)
    types = {r["type"] for r in state["reasons"]}
    expected = {"daily_loss", "cooling_off", "no_trade_window"}
    assert expected <= types, (
        f"missing {sorted(expected - types)} at now={now_et.isoformat()} "
        f"(window {start}-{end} ET); fired: {sorted(types)}"
    )


# ── Rails on the freeze itself ───────────────────────────────────────────────


def test_the_freeze_reaches_every_clock_reader_the_call_graph_can_execute(frozen_clock):
    """Fail BY FILE:LINE when a reachable reader of the current time is one the
    freeze does not pin. A test that freezes one source and reads another looks
    fixed and is not."""
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two import discipline as disc

    reads, unresolved = _reachable_clock_reads()

    assert not unresolved, (
        "the call-graph walk could not resolve these callees, so its verdict "
        "covers less than it claims:\n  " + "\n  ".join(sorted(unresolved))
    )
    assert reads, (
        "the AST census found no clock reader at all -- the walker is broken and "
        "every coverage claim below it is vacuous"
    )
    reached = {r.module for r in reads}
    for module in (disc, accounts_service):
        assert module.__name__ in reached, (
            f"the walk found no clock read in {module.__name__}, which is known to "
            "stamp one -- the walker has stopped resolving edges"
        )

    missed = [r for r in reads if (r.module, r.prefix) not in frozen_clock.patched]
    assert not missed, (
        "clock readers the freeze does not pin:\n  "
        + "\n  ".join(r.describe() for r in missed)
        + "\n(add the prefix to _FREEZERS, or the module to the walk's reach)"
    )


def test_the_frozen_clock_is_what_the_code_under_test_observes(db_conn, frozen_clock):
    """The freeze is INSTALLED is not the same claim as the freeze is OBSERVED.
    This asserts the product code reads the pinned instant at both sites the
    call graph reaches."""
    from api.services.journal_two import accounts as accounts_service
    from api.services.journal_two import discipline as disc

    acc = _seed_account(db_conn)

    # discipline.py -- compute_discipline_state's own `now or datetime.now(...)`
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert state["computedAt"] == frozen_clock.wall_utc.isoformat(), (
        f"discipline.py read {state['computedAt']}, not the pinned "
        f"{frozen_clock.wall_utc.isoformat()}"
    )

    # accounts.py -- _now_iso(), which stamps updated_at on every settings write
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"], _baseline_payload(), conn=db_conn,
    )
    row = db_conn.execute(
        "SELECT updated_at FROM j2_accounts WHERE id = ?", (acc["id"],)
    ).fetchone()
    assert row["updated_at"] == frozen_clock.wall_utc.isoformat(), (
        f"accounts.py stamped {row['updated_at']}, not the pinned "
        f"{frozen_clock.wall_utc.isoformat()}"
    )
