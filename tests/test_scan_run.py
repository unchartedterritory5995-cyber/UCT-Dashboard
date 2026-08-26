"""W4a — run-now as a JOB: one definition over ≤ 500 symbols the member named,
computed through the SWEEP'S OWN LOOP on a single-worker pool, written nowhere.

⭐ THE HASH IS THE SWEEP'S. `scan_run._run_job` — the function `_POOL` executes,
and the ONLY caller of `scan_evaluator.evaluate_one` in that module — calls it
with `mode='on-demand'`; the on-demand `def_hash` is therefore the nightly one by
construction, and `tests/test_phase_e_acceptance.py` reads both off the artifact.

⭐ ONE PARAMETER, `mode`, DECIDES PERSISTENCE (controller ruling 8/25, replacing
the brief's `persist=False`): `'nightly'` is byte-for-byte the sweep, `'live'` is
RESERVED for W4b.3, `'on-demand'` writes nothing, and anything else is refused
BEFORE a bar is read.

⛔ NOTHING IS TYPED THAT CAN BE DERIVED. The tree helpers, the bars fixture and
the session are IMPORTED from `tests/test_scan_evaluator.py`; the gate set is
derived from the sweep's; the pool's worker count and the `mode` literal are
read off `scan_run.py` by AST.

⚠️ THE WORKER IS A REAL THREAD. Every test that submits a job WAITS for it to
finish inside the test (`_run`), or gates the worker on an Event it releases
itself (`slow_worker`) — a job outliving its test would run against patches
that are already undone, i.e. against the real bars store, which the repo-root
`conftest.py` tripwire turns into a whole-run failure. `_drain` is the rail.
"""
from __future__ import annotations

import ast as pyast
import contextlib
import pathlib
import sqlite3
import threading
import time
from types import SimpleNamespace

import pytest

from api.services import user_definitions
from api.services.screener import scan_evaluator, scan_store, snapshot_db
from tests.test_scan_evaluator import (
    SESSION, TF, _daily_bars, _definition, _num, _op, _series,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]

ALICE = "alice"
BOB = "bob"
CAROL = "carol"
DAVE = "dave"

DEF_ID = "u_0000000000aa"
BOB_DEF_ID = "u_00000000000b"
CAROL_DEF_ID = "u_00000000000c"
DAVE_DEF_ID = "u_00000000000d"
#: `close > 100` — bars-only (no snapshot gate), and `_daily_bars(start_close=…)`
#: decides the answer per symbol: 150.. climbs above 100, 10.. never does.
TREE = _op(">", _series("close"), _num(100))
DEFINITION = _definition(TREE, def_id=DEF_ID)
DEF_HASH = DEFINITION["compute"]["fn"]


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, PROVED to be the one in use."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path)
    scan_store.init_db()
    return path


@pytest.fixture
def bars(monkeypatch):
    """A stub bars store keyed by ticker. Missing ticker == no bars."""
    from api.services import bars_sqlite
    table: dict = {}

    def _get(ticker, tf, max_bars):
        return list(table.get(str(ticker).upper()) or [])[-max_bars:]

    monkeypatch.setattr(bars_sqlite, "get_bars", _get)
    table["NVDA"] = _daily_bars(start_close=150.0)   # a hit
    table["INTC"] = _daily_bars(start_close=10.0)    # answered, not a hit
    return table


@pytest.fixture
def defs(tmp_path, monkeypatch):
    """ALICE owns DEF_ID; BOB and CAROL each own the same maths under their OWN
    id. Nobody owns anyone else's — that is what the 404 tests lean on."""
    monkeypatch.setattr(user_definitions, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    user_definitions.save(ALICE, DEF_ID, DEFINITION)
    user_definitions.save(BOB, BOB_DEF_ID, _definition(TREE, def_id=BOB_DEF_ID))
    user_definitions.save(CAROL, CAROL_DEF_ID, _definition(TREE, def_id=CAROL_DEF_ID))
    user_definitions.save(DAVE, DAVE_DEF_ID, _definition(TREE, def_id=DAVE_DEF_ID))
    return DEF_ID


def _arm_writers(monkeypatch):
    """Every writer the nightly path touches, made to raise. ⛔ THE RAIL for
    'writes nothing' — a behavioural half beside the AST half below."""
    def _boom(*a, **k):
        raise AssertionError("the on-demand run wrote to the shared store")
    monkeypatch.setattr(scan_store, "record_hits", _boom)
    monkeypatch.setattr(scan_store, "record_coverage", _boom)
    monkeypatch.setattr(scan_evaluator, "_write_rule_record", _boom)


# ═══ the hand-back: `evaluate_one(..., mode=…)` ═════════════════════════════

def test_evaluate_one_mode_on_demand_WRITES_NOTHING_and_returns_hit_rows(store, bars, monkeypatch):
    """🔴 THE HAND-BACK'S RAIL. The nightly path writes three things; the
    on-demand path must write none of them and still answer with the same hash."""
    _arm_writers(monkeypatch)

    out = scan_evaluator.evaluate_one(
        DEFINITION, TF, universe=["NVDA", "INTC", "NOBARS"], as_of=SESSION, mode="on-demand")

    assert out["def_hash"] == DEF_HASH
    assert out["hits"] == ["NVDA"]
    assert out["hit_rows"] == [{"symbol": "NVDA", "value": 1.0, "bar_time": SESSION}]
    assert out["mode"] == "on-demand"
    assert out["persisted"] is False
    assert out["recorded"] == 0 and out["record_refused"] == 0
    assert out["evaluated"] == out["answered"] + out["dropped"] + out["not_computable"] == 3
    assert scan_store.coverage(DEF_HASH, TF, SESSION) is None


def test_and_mode_nightly_is_the_UNCHANGED_default(store, bars):
    """The control: without the keyword the sweep still files its receipt, so the
    hand-back changed nothing for the scheduler."""
    out = scan_evaluator.evaluate_one(DEFINITION, TF, universe=["NVDA", "INTC"], as_of=SESSION)
    assert out["mode"] == "nightly"
    assert out["persisted"] is True
    assert scan_store.coverage(DEF_HASH, TF, SESSION) is not None
    assert sorted(scan_store.hits(DEF_HASH, TF, SESSION)) == ["NVDA"]
    assert out["hit_rows"] == [{"symbol": "NVDA", "value": 1.0, "bar_time": SESSION}]


def test_mode_live_is_RESERVED__and_TODAYS_NIGHTLY_PERSISTENCE_IS_PINNED(store, bars):
    """🔴 PINNED SO LANE W4b.3 MUST CONSCIOUSLY CHANGE IT — the earlier version of
    this test asserted only that the kwarg was accepted, which left the real
    behaviour unrailed.

    TODAY `'live'` takes the NIGHTLY WRITE PATH: `persist = mode != "on-demand"`
    is True for it, so it files `scan_hits` and `scan_coverage` under the nightly
    key `(def_hash, tf, session)`. That is harmless while nothing passes `'live'`
    and WRONG the moment the live sweep runs for real — live rows would overwrite
    the nightly receipt silently, which is the exact failure the `mode` parameter
    exists to prevent, and it was found independently from the store's side too
    (W4b.1's AST rail).

    ⛔ SO THE STATE OF PLAY IS ASSERTED, NOT THE INTENTION. Lane W4b.3 OWNS the
    change: its live branch must write only `scan_hits_live`/`scan_live_cycles`
    and extend the AST rail to `scan_evaluator` in the same commit. When it does,
    THIS TEST GOES RED — and that red is the point. It cannot land quietly.
    """
    out = scan_evaluator.evaluate_one(DEFINITION, TF, universe=["NVDA", "INTC"], as_of=SESSION, mode="live")
    assert out["mode"] == "live"
    assert out["evaluated"] == 2 and out["hits"] == ["NVDA"]
    # ⚠️ W4b.3: these four lines are what your live branch must turn over.
    assert out["persisted"] is True
    assert scan_store.coverage(DEF_HASH, TF, SESSION) is not None
    assert sorted(scan_store.hits(DEF_HASH, TF, SESSION)) == ["NVDA"]
    assert out["hit_rows"] == [{"symbol": "NVDA", "value": 1.0, "bar_time": SESSION}]


def test_an_unknown_mode_is_refused_BEFORE_anything_is_read_or_written(store, bars, monkeypatch):
    """⛔ CLOSED SET. A mode nobody declared must not quietly behave as one of the
    three — it is the one authority over what a run writes."""
    _arm_writers(monkeypatch)
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("bars were read")))
    with pytest.raises(ValueError) as exc:
        scan_evaluator.evaluate_one(DEFINITION, TF, universe=["NVDA"], as_of=SESSION, mode="persist")
    assert "'persist'" in str(exc.value)
    assert scan_store.coverage(DEF_HASH, TF, SESSION) is None


# ═══ the auth database the LIST resolver reads (read-only, by URI) ══════════

@pytest.fixture
def lists(tmp_path, monkeypatch):
    """`list_universe` opens AUTH_DB_PATH read-only; the tables must exist first.
    ⛔ DDL COPIED FROM tests/test_screener_list_universe.py (TEXT ids — the real
    schema), never invented."""
    path = tmp_path / "auth.db"
    with contextlib.closing(sqlite3.connect(path)) as c:
        c.executescript("""
            CREATE TABLE watchlists (id TEXT PRIMARY KEY, user_id TEXT,
                name TEXT, is_flagged_list INTEGER DEFAULT 0);
            CREATE TABLE watchlist_items (id TEXT PRIMARY KEY, watchlist_id TEXT,
                sym TEXT, sort_order INTEGER DEFAULT 0, added_at TEXT DEFAULT '');
            CREATE TABLE ticker_tags (id INTEGER PRIMARY KEY, user_id TEXT,
                sym TEXT, color TEXT);
        """)
        c.execute("INSERT INTO watchlists VALUES ('4b9b2122-ddc','alice','Momentum',0)")
        c.execute("INSERT INTO watchlists VALUES ('b702218a-c0c','alice','Flagged',1)")
        c.execute("INSERT INTO watchlists VALUES ('6b64dbb0-f15','alice','Empty',0)")
        for i, s in enumerate(["nvda", "INTC", "nvda"]):
            c.execute("INSERT INTO watchlist_items (id,watchlist_id,sym,sort_order) "
                      "VALUES (?,'4b9b2122-ddc',?,?)", (f"i{i}", s, i))
        c.execute("INSERT INTO watchlist_items (id,watchlist_id,sym) VALUES ('f0','b702218a-c0c','TSLA')")
        c.execute("INSERT INTO watchlists VALUES ('ff0000aa-bbb','bob','Bobs secrets',0)")
        c.commit()
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    return path


# ═══ the job harness ═══════════════════════════════════════════════════════

def _terminal():
    """⛔ DERIVED FROM THE SERVICE, NEVER RETYPED. This was the one place in the
    lane that typed what it could read, and the cost was specific: a fifth job
    state would leave `_drain` treating it as pending and hanging for its whole
    timeout — a test-harness failure wearing a product bug's clothes."""
    from api.services.screener import scan_run
    return scan_run._TERMINAL


def _pending():
    from api.services.screener import scan_run
    with scan_run._LOCK:
        return [j["job"] for j in scan_run._JOBS.values() if j["state"] not in _terminal()]


def _drain(timeout=15.0):
    """Wait until no job is queued or running. ⛔ THE RAIL against a worker
    outliving its test's patches (module docstring)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        left = _pending()
        if not left:
            return
        time.sleep(0.01)
    raise AssertionError(f"jobs still in flight after {timeout}s: {left}")


@pytest.fixture(autouse=True)
def fresh_jobs():
    """Every test starts and ends with an empty, DRAINED job table. The import is
    guarded so the hand-back tests above stay green while the service module is
    still the RED half of this file."""
    try:
        from api.services.screener import scan_run
    except ImportError:
        yield
        return
    _drain()
    with scan_run._LOCK:
        scan_run._JOBS.clear()
    yield
    _drain()
    with scan_run._LOCK:
        scan_run._JOBS.clear()


def _wait(job, user, timeout=15.0):
    """Poll `job_status` until the job is terminal; the terminal status dict."""
    from api.services.screener import scan_run
    deadline = time.monotonic() + timeout
    while True:
        st = scan_run.job_status(job, user)
        if st["state"] in _terminal():
            return st
        assert time.monotonic() < deadline, f"job {job} still {st['state']} after {timeout}s"
        time.sleep(0.01)


def _run(user, def_id, **kw):
    """Submit and WAIT. Every test that does not gate the worker goes through
    here, so no job outlives its test."""
    from api.services.screener import scan_run
    return _wait(scan_run.submit_run(user, def_id, **kw), user)


@pytest.fixture
def slow_worker(monkeypatch, store, bars, defs):
    """Gate the worker on an Event so a job can be OBSERVED queued/running.

    ⚠️ Requests `store`/`bars`/`defs` so it is torn down BEFORE them: it releases
    the gate and drains, and only then do their patches come off."""
    real = scan_evaluator.evaluate_one
    release = threading.Event()
    entered = threading.Event()

    def _gated(*a, **k):
        entered.set()
        assert release.wait(timeout=15), "the test never released the worker"
        return real(*a, **k)

    monkeypatch.setattr(scan_evaluator, "evaluate_one", _gated)
    yield SimpleNamespace(release=release, entered=entered)
    release.set()
    _drain()


# ═══ the universe ═══════════════════════════════════════════════════════════

def test_resolve_universe_UPPERCASES_DEDUPES_and_keeps_the_callers_order(lists):
    from api.services.screener import scan_run
    syms, receipt = scan_run.resolve_universe(ALICE, symbols=[" nvda", "AMD", "nvda", "", "intc "])
    assert syms == ["NVDA", "AMD", "INTC"]
    assert receipt == {"source": "symbols", "label": None, "requested": 3}


def test_resolve_universe_REFUSES_a_bare_STRING_by_name__not_letter_by_letter(lists):
    """⛔ `"NVDA"` iterated is `["N","V","D","A"]` — four symbols we do not hold,
    four `no-bars` drops, and a receipt that reads like a quiet market. The wire
    says `string[]`; a string is a spelling problem and says so."""
    from api.services.screener import scan_run
    with pytest.raises(scan_run.BadRequest) as exc:
        scan_run.resolve_universe(ALICE, symbols="NVDA, AMD")
    assert "list" in str(exc.value)


def test_resolve_universe_REFUSES_over_the_cap_NAMING_the_count(lists):
    from api.services.screener import scan_run
    too_many = [f"S{i:04d}" for i in range(scan_run.MAX_RUN_SYMBOLS + 1)]
    with pytest.raises(scan_run.RunRefused) as exc:
        scan_run.resolve_universe(ALICE, symbols=too_many)
    assert exc.value.gate == scan_run.UNIVERSE_GATE
    assert str(exc.value).startswith("[gate:universe]")
    assert str(scan_run.MAX_RUN_SYMBOLS + 1) in str(exc.value)
    assert str(scan_run.MAX_RUN_SYMBOLS) in str(exc.value)
    # the control: one fewer is admitted, so the cap is a boundary and not a wall
    kept, _ = scan_run.resolve_universe(ALICE, symbols=too_many[:-1])
    assert len(kept) == scan_run.MAX_RUN_SYMBOLS


def test_600_pasted_tickers_of_which_50_are_UNIQUE_RUNS__the_cap_is_AFTER_dedup(lists):
    """🔴 THE MEMBER-VISIBLE REGRESSION THIS UNDOES (controller ruling 8/25).

    A fold-in moved the cap from post-dedup to PRE-dedup, so it was checked on
    what was SENT: a member pasting a column out of a spreadsheet — 600 rows, 50
    distinct names — was refused `gate:universe` for a run of FIFTY symbols. The
    unbounded-walk concern that motivated the move is about an input we cannot
    MEASURE, not about a sized list of 600, and the two are separated now:
    `HARD_SYMBOL_BOUND` bounds the WALK, `MAX_RUN_SYMBOLS` bounds the RUN.

    ⭐ AND BOTH DOORS AGREE. A sized list and a generator carrying the same names
    resolve to the same 50 symbols — otherwise the fix would have healed the
    measurable path and left the same lie on the other one.
    """
    from api.services.screener import scan_run
    pasted = [f"S{i % 50:04d}" for i in range(600)]
    assert len(pasted) == 600 and len(set(pasted)) == 50, "the fixture stopped being the case"

    syms, receipt = scan_run.resolve_universe(ALICE, symbols=pasted)
    assert len(syms) == 50
    # ⛔ `requested` IS WHAT WILL BE RUN, not what was typed — the receipt must not
    # claim 600 symbols were evaluated when 50 were.
    assert receipt == {"source": "symbols", "label": None, "requested": 50}

    from_generator, _ = scan_run.resolve_universe(ALICE, symbols=(s for s in pasted))
    assert from_generator == syms


def test_a_body_ABOVE_the_HARD_SANITY_BOUND_refuses_BY_NAME__the_WALK_stays_bounded(lists):
    """The other half of the ruling: the walk is still bounded, one order of
    magnitude ABOVE the member-facing cap.

    ⭐ THE MULTIPLE IS DERIVED AND THE BOUND IS ON THE **BODY**, NOT THE RUN — so
    the case here is a single name repeated past the bound. It would dedupe to
    ONE symbol and is refused anyway, which is precisely what distinguishes "this
    request is pathological" from "this run is too big".
    """
    from api.services.screener import scan_run
    assert scan_run.HARD_SYMBOL_BOUND == scan_run.MAX_RUN_SYMBOLS * scan_run.HARD_BOUND_MULTIPLE
    assert scan_run.HARD_SYMBOL_BOUND > scan_run.MAX_RUN_SYMBOLS

    body = ["NVDA"] * (scan_run.HARD_SYMBOL_BOUND + 1)
    with pytest.raises(scan_run.RunRefused) as exc:
        scan_run.resolve_universe(ALICE, symbols=body)
    assert exc.value.gate == scan_run.UNIVERSE_GATE
    assert str(scan_run.HARD_SYMBOL_BOUND) in str(exc.value)
    assert str(len(body)) in str(exc.value)

    # the control: exactly AT the bound is walked, deduped, and RUN
    kept, receipt = scan_run.resolve_universe(
        ALICE, symbols=["NVDA"] * scan_run.HARD_SYMBOL_BOUND)
    assert kept == ["NVDA"] and receipt["requested"] == 1


def test_resolve_universe_bounds_the_WALK_TOO__an_UNSIZED_iterable_refuses(lists):
    """⛔ THE CAP USED TO BE CHECKED AFTER THE WALK. `_clean_symbols` ran over
    whatever arrived before any bound was consulted — an unbounded request-path
    loop inside the module whose thesis is "bounded, never a universe".

    ⚠️ AND THIS TEST IS ITS OWN CONTROL: the generator below is INFINITE, so a
    walk that is not bounded does not fail this test, it HANGS it.
    """
    from api.services.screener import scan_run

    def _forever():
        i = 0
        while True:
            yield f"S{i:05d}"
            i += 1

    with pytest.raises(scan_run.RunRefused) as exc:
        scan_run.resolve_universe(ALICE, symbols=_forever())
    assert exc.value.gate == scan_run.UNIVERSE_GATE
    # ⛔ THE WALK'S BOUND IS THE HARD ONE, not the member-facing cap: a sized body
    # of 600 with 50 unique names RUNS (test above), so a generator carrying the
    # same names must too, or the fix healed one door and left the lie on the other.
    assert f"more than {scan_run.HARD_SYMBOL_BOUND}" in str(exc.value)
    # the control: an unsized input UNDER the cap is admitted, walked to the end
    kept, _ = scan_run.resolve_universe(ALICE, symbols=(f"S{i:05d}" for i in range(3)))
    assert kept == ["S00000", "S00001", "S00002"]


def test_resolve_universe_resolves_a_list_the_caller_OWNS_through_list_universe(lists):
    from api.services.screener import scan_run
    syms, receipt = scan_run.resolve_universe(ALICE, list_id="wl:4b9b2122-ddc")
    assert syms == ["NVDA", "INTC"]                      # uppercased, deduped, list order
    assert receipt == {"source": "wl:4b9b2122-ddc", "label": "Momentum", "requested": 2}


def test_resolve_universe_REFUSES_another_members_list_BY_NAME(lists):
    from api.services.screener import scan_run
    with pytest.raises(scan_run.RunRefused) as exc:
        scan_run.resolve_universe(ALICE, list_id="wl:ff0000aa-bbb")
    assert exc.value.gate == scan_run.UNIVERSE_GATE
    assert "ff0000aa-bbb" in str(exc.value)


@pytest.mark.parametrize("kwargs,why", [
    ({"list_id": "unflagged"}, "complement"),
    ({"symbols": [], "list_id": None}, "no symbols"),
    ({"symbols": ["NVDA"], "list_id": "flagged"}, "not both"),
    ({"list_id": "wl:6b64dbb0-f15"}, "the member's own list, but EMPTY"),
])
def test_resolve_universe_refuses_a_COMPLEMENT_an_EMPTY_and_a_DOUBLE_universe(lists, kwargs, why):
    from api.services.screener import scan_run
    with pytest.raises(scan_run.RunRefused) as exc:
        scan_run.resolve_universe(ALICE, **kwargs)
    assert exc.value.gate == scan_run.UNIVERSE_GATE, why


# ═══ submit → status: the job ══════════════════════════════════════════════

def test_a_run_ANSWERS_with_the_sweeps_hash_hit_rows_and_a_CLOSED_receipt(store, bars, defs):
    from api.services.screener import scan_run
    out = _run(ALICE, DEF_ID, symbols=["NVDA", "INTC", "NOBARS"], tf=TF, as_of=SESSION)
    assert out["state"] == "done", out
    assert out["def_hash"] == DEF_HASH
    assert out["def_id"] == DEF_ID and out["tier"] == scan_run.TIER == "on-demand"
    assert out["as_of"] == SESSION and out["tf"] == TF
    assert out["hits"] == [{"symbol": "NVDA", "value": 1.0, "bar_time": SESSION}]
    cov = out["coverage"]
    assert cov["evaluated"] == cov["answered"] + cov["dropped"] + cov["not_computable"] == 3
    assert cov["answered"] == 2 and cov["dropped"] == 1 and cov["not_computable"] == 0
    assert {d["ticker"]: d["reason"] for d in cov["dropped_symbols"]} == {"NOBARS": "no-bars"}
    assert cov["withheld"] == 0 and cov["withheld_reason"] is None
    assert out["universe"] == {"source": "symbols", "label": None, "requested": 3, "resolved": 3}
    assert out["mode"] == "on-demand" and out["persisted"] is False
    assert out["submitted_at"] <= out["started_at"] <= out["finished_at"]


def test_a_run_WRITES_NOTHING__the_rail(store, bars, defs, monkeypatch):
    _arm_writers(monkeypatch)
    out = _run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    # a write would have raised inside the worker and the job would read `refused`
    assert out["state"] == "done", out
    assert [h["symbol"] for h in out["hits"]] == ["NVDA"]
    assert scan_store.coverage(DEF_HASH, TF, SESSION) is None
    assert scan_store.hits(DEF_HASH, TF, SESSION) == []


def test_status_while_QUEUED_names_the_universe_and_position_but_NO_hash_yet(slow_worker):
    """One object, one hash: `def_hash` appears only when the evaluator hands it
    back. A queued/running job states what was asked, not what was answered."""
    from api.services.screener import scan_run
    job = scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert slow_worker.entered.wait(5)                  # alice is RUNNING, held at the gate
    st = scan_run.job_status(job, ALICE)
    assert st["state"] == "running" and "def_hash" not in st and "hits" not in st
    assert st["started_at"] >= st["submitted_at"]

    bobs = scan_run.submit_run(BOB, BOB_DEF_ID, symbols=["intc"], tf=TF, as_of=SESSION)
    sb = scan_run.job_status(bobs, BOB)
    assert sb["state"] == "queued" and sb["position"] == 0
    assert sb["universe"] == {"source": "symbols", "label": None, "requested": 1, "resolved": 1}
    assert sb["tier"] == scan_run.TIER and sb["as_of"] == SESSION and sb["tf"] == TF
    assert sb["def_id"] == BOB_DEF_ID
    assert "def_hash" not in sb and "hits" not in sb and "started_at" not in sb

    slow_worker.release.set()
    assert _wait(job, ALICE)["state"] == "done"
    done = _wait(bobs, BOB)
    assert done["state"] == "done" and done["hits"] == [] and done["coverage"]["answered"] == 1


def test_another_members_JOB_is_not_found__the_404_shape(store, bars, defs):
    from api.services.screener import scan_run
    job = scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    with pytest.raises(scan_run.JobNotFound):
        scan_run.job_status(job, BOB)
    with pytest.raises(scan_run.JobNotFound):
        scan_run.job_status("no-such-job", ALICE)
    assert _wait(job, ALICE)["state"] == "done"          # the control: the owner sees it


def test_another_members_DEFINITION_is_not_found__the_404_shape(store, bars, defs):
    from api.services.screener import scan_run
    with pytest.raises(scan_run.DefinitionNotFound):
        scan_run.submit_run(BOB, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    # a malformed id is a SPELLING problem, not a missing row — the store's own sentence
    with pytest.raises(scan_run.BadRequest):
        scan_run.submit_run(ALICE, "not-an-id", symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert not _pending()


def test_submit_refuses_a_PRODUCT_LABEL_timeframe_and_tells_the_code(store, bars, defs):
    from api.services.screener import scan_run
    with pytest.raises(scan_run.BadRequest) as exc:
        scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf="1D", as_of=SESSION)
    assert "'D'" in str(exc.value)
    with pytest.raises(scan_run.BadRequest):
        scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of="not a session")
    assert not _pending()


def test_submit_defaults_as_of_to_the_SWEEPS_expected_session(store, bars, defs, monkeypatch):
    monkeypatch.setattr(scan_evaluator, "expected_session", lambda: SESSION)
    out = _run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF)
    assert out["state"] == "done" and out["as_of"] == SESSION


def test_a_NOT_SCANNABLE_definition_is_refused_AT_SUBMIT_by_name(store, bars, defs):
    """A numeric tree cannot be a screen; the member learns that before a job
    exists, in the sweep's own gate word, namespaced."""
    from api.services.screener import scan_run
    numeric = _definition(_op("+", _series("close"), _num(1)), def_id="u_0000000000ee")
    user_definitions.save(ALICE, "u_0000000000ee", numeric)
    with pytest.raises(scan_run.RunRefused) as exc:
        scan_run.submit_run(ALICE, "u_0000000000ee", symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert exc.value.gate == "gate:not-scannable" and exc.value.gate in scan_run.RUN_GATES
    assert str(exc.value).startswith("[gate:not-scannable]")
    assert not scan_run._JOBS                            # nothing was queued


def test_an_EVALUATOR_gate_lands_on_the_job_in_THIS_modules_vocabulary(store, bars, defs):
    """A scalar-bearing tree refuses at `snapshot-stale` INSIDE the sweep — after
    the job was queued. The job ends `refused`, gate namespaced, never a crash."""
    from api.services.screener import scan_run
    scalar = _definition(_op(">", _series("market_cap"), _num(1)), def_id="u_0000000000bb")
    user_definitions.save(ALICE, "u_0000000000bb", scalar)
    out = _run(ALICE, "u_0000000000bb", symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert out["state"] == "refused", out
    assert out["gate"] == "gate:snapshot-stale" and out["gate"] in scan_run.RUN_GATES
    assert out["detail"] and "hits" not in out and "def_hash" not in out
    assert out.get("error") is not True


def test_the_gate_set_is_DERIVED_from_the_sweeps_and_CLOSED():
    from api.services.screener import scan_run
    assert set(scan_run.RUN_GATES) == {"gate:universe", "gate:busy"} | {
        f"gate:{g}" for g in scan_evaluator.RUN_GATES}
    with pytest.raises(ValueError):
        scan_run.RunRefused("gate:made-up", "x")
    assert str(scan_run.RunRefused(scan_run.BUSY_GATE, "x")).startswith("[gate:busy] ")


def test_note_demand_is_called_WHEN_IT_EXISTS_with_the_resolved_symbols(store, bars, defs, monkeypatch):
    """`scan_store.note_demand` is W4b's (contract: it lives on the STORE, not the
    evaluator, for the import rail's sake)."""
    seen = []
    monkeypatch.setattr(scan_store, "note_demand", lambda syms: seen.append(list(syms)), raising=False)
    out = _run(ALICE, DEF_ID, symbols=["nvda", "INTC", "nvda"], tf=TF, as_of=SESSION)
    assert out["state"] == "done"
    assert seen == [["NVDA", "INTC"]]


def test_note_demand_ABSENT_or_RAISING_never_breaks_a_run(store, bars, defs, monkeypatch):
    monkeypatch.delattr(scan_store, "note_demand", raising=False)
    assert _run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)["hits"]

    def _raise(_syms):
        raise RuntimeError("prewarm ring is down")
    monkeypatch.setattr(scan_store, "note_demand", _raise, raising=False)
    assert _run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)["hits"]


# ═══ the bounds: one run per member, a bounded queue, a TTL, a bounded table ═

def test_ONE_run_per_MEMBER_at_a_time__the_second_submit_is_refused_busy(slow_worker):
    from api.services.screener import scan_run
    job = scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert slow_worker.entered.wait(5)
    with pytest.raises(scan_run.RunRefused) as exc:
        scan_run.submit_run(ALICE, DEF_ID, symbols=["INTC"], tf=TF, as_of=SESSION)
    assert exc.value.gate == scan_run.BUSY_GATE and job in str(exc.value)
    # another member is NOT blocked by alice's run: they queue behind the one worker
    bobs = scan_run.submit_run(BOB, BOB_DEF_ID, symbols=["INTC"], tf=TF, as_of=SESSION)
    assert scan_run.job_status(bobs, BOB)["state"] == "queued"
    slow_worker.release.set()
    assert _wait(job, ALICE)["state"] == "done" and _wait(bobs, BOB)["state"] == "done"
    # the control: finished, the same member runs again
    assert _run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)["state"] == "done"


def test_the_pods_run_queue_is_BOUNDED__over_the_bound_is_refused_busy(slow_worker, monkeypatch):
    """⚠️ THE TWO NUMBERS IN THE MESSAGE ARE MADE TO DIFFER, ON PURPOSE. At the
    moment of refusal `pending == MAX_PENDING_RUNS` by construction, so asserting
    a bare `"2" in ...` would pass whichever number the sentence actually named —
    it measured nothing. Lowering the bound while THREE are already in flight
    separates them (3 in flight, bound 2), so each half of the sentence is pinned
    to the value it claims to report.
    """
    from api.services.screener import scan_run
    a = scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert slow_worker.entered.wait(5)
    b = scan_run.submit_run(BOB, BOB_DEF_ID, symbols=["INTC"], tf=TF, as_of=SESSION)
    c = scan_run.submit_run(CAROL, CAROL_DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    monkeypatch.setattr(scan_run, "MAX_PENDING_RUNS", 2)
    with pytest.raises(scan_run.RunRefused) as exc:
        scan_run.submit_run(DAVE, DAVE_DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert exc.value.gate == scan_run.BUSY_GATE
    assert "3 runs are already in flight" in str(exc.value)
    assert "the bound is 2" in str(exc.value)
    slow_worker.release.set()
    for job, who in ((a, ALICE), (b, BOB), (c, CAROL)):
        assert _wait(job, who)["state"] == "done"
    # the control: drained, dave is admitted under the SAME lowered bound
    assert _run(DAVE, DAVE_DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)["state"] == "done"


def test_a_FINISHED_job_expires_after_the_TTL__a_PENDING_one_never_does(slow_worker, monkeypatch):
    from api.services.screener import scan_run
    now = [1_000_000.0]
    monkeypatch.setattr(scan_run, "_clock", lambda: now[0])
    # ⚠️ THE DURATION CAP IS A DIFFERENT RAIL AND IT IS TESTED SEPARATELY (below).
    # Neutralised here — and the queue wait DERIVES from it, so both move — because
    # any TTL-sized jump also passes `MAX_RUN_SECONDS`, and this test is about what
    # the TTL does to a FINISHED job versus a pending one.
    monkeypatch.setattr(scan_run, "MAX_RUN_SECONDS", 10 ** 9)
    a = scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert slow_worker.entered.wait(5)
    b = scan_run.submit_run(BOB, BOB_DEF_ID, symbols=["INTC"], tf=TF, as_of=SESSION)

    now[0] += scan_run.JOB_TTL_SECONDS + 1
    assert scan_run.job_status(b, BOB)["state"] == "queued"      # pending is never evicted
    assert scan_run.job_status(a, ALICE)["state"] == "running"

    slow_worker.release.set()
    assert _wait(a, ALICE)["state"] == "done" and _wait(b, BOB)["state"] == "done"
    assert scan_run.job_status(a, ALICE)["state"] == "done"      # readable until the TTL
    now[0] += scan_run.JOB_TTL_SECONDS + 1
    with pytest.raises(scan_run.JobNotFound):
        scan_run.job_status(a, ALICE)
    with pytest.raises(scan_run.JobNotFound):
        scan_run.job_status(b, BOB)


def test_a_WEDGED_run_AGES_OUT_and_FREES_ITS_MEMBER__the_pod_self_heals(slow_worker, monkeypatch):
    """🔴 A WORKER THAT BLOCKS IS NOT A WORKER THAT RAISES, AND ONLY ONE OF THEM
    WAS HANDLED. `_run_job`'s `finally` covers a raise; nothing catches a HANG (a
    SQLite lock retry loop, a wedged bars read). The TTL cannot reach it either —
    its clock starts at `finished_at`, which a wedged job never gets — so the one
    worker never freed, the pending slots filled permanently, and every one of
    those members stayed locked out by the per-member gate FOREVER.

    Here the worker is wedged for real (held inside the evaluator) and the clock
    is injected, in the same idiom as the TTL test above.
    """
    from api.services.screener import scan_run
    now = [1_000_000.0]
    monkeypatch.setattr(scan_run, "_clock", lambda: now[0])
    job = scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert slow_worker.entered.wait(5)                  # wedged INSIDE the evaluator
    assert scan_run.job_status(job, ALICE)["state"] == "running"

    now[0] += scan_run.MAX_RUN_SECONDS + 1
    st = scan_run.job_status(job, ALICE)
    assert st["state"] == "refused", "a wedged run never became terminal"
    # ⛔ NOT A GATE. A timeout is this pod failing the member, not something they
    # can act on — same shape as a crash.
    assert st["gate"] is None and st["error"] is True
    assert str(scan_run.MAX_RUN_SECONDS) in st["detail"]

    # 🔑 THE POINT: the member is FREED — the next submit is ADMITTED, not busy.
    nxt = scan_run.submit_run(ALICE, DEF_ID, symbols=["INTC"], tf=TF, as_of=SESSION)
    assert scan_run.job_status(nxt, ALICE)["state"] == "queued"

    slow_worker.release.set()
    assert _wait(nxt, ALICE)["state"] == "done"
    # ⛔ AND THE FIRST TERMINAL VERDICT WINS: the wedged worker finishing later must
    # not flip the answer the member already read from `refused` back to `done`.
    assert scan_run.job_status(job, ALICE)["state"] == "refused"


def test_a_job_QUEUED_BEHIND_a_wedged_worker_AGES_OUT_TOO(slow_worker, monkeypatch):
    """The other half of the same failure, and aging only the RUNNING job would
    have missed it: everything queued behind a wedged worker never starts, so
    those members would stay locked out even after the running job was released."""
    from api.services.screener import scan_run
    now = [2_000_000.0]
    monkeypatch.setattr(scan_run, "_clock", lambda: now[0])
    scan_run.submit_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert slow_worker.entered.wait(5)
    queued = scan_run.submit_run(BOB, BOB_DEF_ID, symbols=["INTC"], tf=TF, as_of=SESSION)
    assert scan_run.job_status(queued, BOB)["state"] == "queued"

    now[0] += scan_run._max_queue_wait_seconds() + 1
    st = scan_run.job_status(queued, BOB)
    assert st["state"] == "refused" and st["gate"] is None and st["error"] is True

    again = scan_run.submit_run(BOB, BOB_DEF_ID, symbols=["INTC"], tf=TF, as_of=SESSION)
    assert scan_run.job_status(again, BOB)["state"] == "queued"
    slow_worker.release.set()
    assert _wait(again, BOB)["state"] == "done"
    # ⛔ the abandoned job is NOT resurrected when the worker reaches it
    assert scan_run.job_status(queued, BOB)["state"] == "refused"


def test_the_modules_BOUNDS_ARE_ARITHMETIC_not_prose():
    """⛔ THE HEADER'S CLAIM, CHECKED. "Nothing queued can outlive the TTL" is only
    true while the whole queue ahead of a job is capped below it — so the two
    bounds are pinned to each other rather than asserted in a comment, and tuning
    either past the other fails HERE."""
    from api.services.screener import scan_run
    assert scan_run._max_queue_wait_seconds() == (
        scan_run.MAX_PENDING_RUNS * scan_run.MAX_RUN_SECONDS)
    assert scan_run._max_queue_wait_seconds() <= scan_run.JOB_TTL_SECONDS
    # and the three state tuples are ONE partition, not three hand-kept lists
    assert set(scan_run.JOB_STATES) == set(scan_run._PENDING) | set(scan_run._TERMINAL)
    assert not (set(scan_run._PENDING) & set(scan_run._TERMINAL))


def test_the_job_table_is_BOUNDED__the_OLDEST_finished_job_is_evicted_first(store, bars, defs, monkeypatch):
    from api.services.screener import scan_run
    monkeypatch.setattr(scan_run, "MAX_JOBS", 3)
    jobs = [_run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)["job"] for _ in range(5)]
    for old in jobs[:2]:
        with pytest.raises(scan_run.JobNotFound):
            scan_run.job_status(old, ALICE)
    assert scan_run.job_status(jobs[-1], ALICE)["state"] == "done"
    assert len(scan_run._JOBS) <= 3


def test_a_CRASH_in_the_worker_is_a_named_failure_not_a_job_stuck_running(store, bars, defs, monkeypatch):
    """⛔ RECORDED, NEVER SWALLOWED — and NEVER A GATE. A crash is not one of the
    closed refusals, so it carries `gate: None` + `error: True` (the router's
    500), and it must not lock the member out of their next run."""
    from api.services.screener import scan_run

    def _boom(*a, **k):
        raise RuntimeError("the bars store is on fire")
    monkeypatch.setattr(scan_evaluator, "evaluate_one", _boom)

    out = _run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)
    assert out["state"] == "refused" and out["gate"] is None and out["error"] is True
    assert "RuntimeError" in out["detail"] and "on fire" in out["detail"]
    assert "hits" not in out and "def_hash" not in out
    # accepted again (not `gate:busy`), and honestly a failure again
    assert _run(ALICE, DEF_ID, symbols=["NVDA"], tf=TF, as_of=SESSION)["state"] == "refused"


# ═══ the structural half: by AST ════════════════════════════════════════════

def test_evaluate_one_is_called_EXACTLY_ONCE_inside__run_job_with_mode_on_demand__BY_AST():
    """⛔ THE STRUCTURAL HALF of the no-write / off-request-path rails: a future
    edit that dropped the keyword would write the nightly key on every member
    click, and one that called the evaluator from `submit_run` would put 0.7–5.7 s
    of GIL-bound compute back on the request path. The behavioural tests above
    only see either when they run; this sees them in the source."""
    from api.services.screener import scan_run
    src = (ROOT / "api" / "services" / "screener" / "scan_run.py").read_text(encoding="utf-8")
    tree = pyast.parse(src)

    # innermost enclosing function wins: `ast.walk` is breadth-first, and a plain
    # assignment leaves the nested name in place (the off-request-path rail's idiom)
    enclosing = {}
    for fn in pyast.walk(tree):
        if isinstance(fn, (pyast.FunctionDef, pyast.AsyncFunctionDef)):
            for n in pyast.walk(fn):
                enclosing[id(n)] = fn.name

    calls = [n for n in pyast.walk(tree)
             if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)
             and n.func.attr == "evaluate_one"]
    assert len(calls) == 1, "evaluate_one is called from more than one place"
    assert enclosing.get(id(calls[0])) == "_run_job"
    kws = {k.arg: k.value for k in calls[0].keywords}
    assert isinstance(kws.get("mode"), pyast.Constant)
    assert kws["mode"].value == scan_run.TIER == "on-demand"

    # the pool that executes `_run_job` has ONE worker, and `_run_job` is what it is handed
    pools = [n for n in tree.body if isinstance(n, pyast.Assign)
             and any(isinstance(t, pyast.Name) and t.id == "_POOL" for t in n.targets)]
    assert len(pools) == 1
    ctor = pools[0].value
    assert isinstance(ctor, pyast.Call) and isinstance(ctor.func, pyast.Name)
    assert ctor.func.id == "ThreadPoolExecutor"
    workers = {k.arg: k.value for k in ctor.keywords}.get("max_workers")
    assert isinstance(workers, pyast.Constant) and workers.value == 1

    submits = [n for n in pyast.walk(tree)
               if isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)
               and n.func.attr == "submit" and isinstance(n.func.value, pyast.Name)
               and n.func.value.id == "_POOL"]
    assert len(submits) == 1
    assert isinstance(submits[0].args[0], pyast.Name) and submits[0].args[0].id == "_run_job"
