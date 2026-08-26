"""W4b — the continuous live sweep: side tables with one writer each, the forming
bar, the 5-minute cycle behind its rails, the read surface's provenance."""
from __future__ import annotations
import ast as pyast, collections, contextlib, datetime, json, pathlib, re, sqlite3
from zoneinfo import ZoneInfo
import pytest
from api.services import ast_freshness, scan_definition, user_definitions
from api.services.screener import (live_tier, scan_evaluator, scan_store, snapshot_builder,
                                   snapshot_db)
from tests.test_scan_evaluator import (_series, _num, _op, _definition, _daily_bars, _function_node,
                                       PRICE_TREE, SCALAR_TREE, _FakeScheduler)


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, proved to be the one in use.

    `snapshot_db.get_db_path()` reads `SCREENER_DB_PATH` on EVERY call rather than
    capturing it at import, so `monkeypatch.setenv` genuinely reaches it — but
    that is a property of the module, not a promise, so it is asserted here
    before anything writes. `_INITED` is cleared because it is keyed by path and
    a previous test's entry must not answer for this one.
    """
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this whole file is writing somewhere else")
    scan_store.init_db()
    assert path.exists()
    return path


def _columns(path, table) -> list:
    with contextlib.closing(sqlite3.connect(str(path))) as c:
        return [r[1] for r in c.execute(f"PRAGMA table_info({table})")]


@pytest.fixture
def bars(monkeypatch):
    """A stub bars store keyed by ticker. Missing ticker == no bars."""
    from api.services import bars_sqlite

    table: dict = {}

    def _get(ticker, tf, max_bars):
        rows = table.get(str(ticker).upper())
        return list(rows or [])[-max_bars:]

    monkeypatch.setattr(bars_sqlite, "get_bars", _get)
    return table


# ═══ 1. the DDL: derived from the store's declarations, and it WIDENS ════════

OLD_NARROW_DDL = ("CREATE TABLE scan_hits_live (def_hash TEXT NOT NULL, tf TEXT NOT NULL, "
                  "symbol TEXT NOT NULL, as_of INTEGER NOT NULL DEFAULT 0, "
                  "PRIMARY KEY (def_hash, tf, symbol)) WITHOUT ROWID")


def test_an_OLD_narrower_live_table_is_WIDENED_by_init_db_never_left_as_is(tmp_path, monkeypatch):
    """⛔ CREATE TABLE IF NOT EXISTS never widens (8/25: `screener_live` held 0 rows
    with no `candle_type` column, silently, while the job ran every 60 s)."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    with contextlib.closing(sqlite3.connect(str(path))) as c:
        c.execute(OLD_NARROW_DDL); c.commit()
    assert "src_price" not in _columns(path, scan_store.LIVE_HITS_TABLE)   # the control
    scan_store.init_db()
    have = set(_columns(path, scan_store.LIVE_HITS_TABLE))
    assert have == {n for n, _ in scan_store.LIVE_HIT_COLUMNS}, have


OLD_NARROW_CYCLES_DDL = ("CREATE TABLE scan_live_cycles (cycle_started INTEGER NOT NULL, "
                         "PRIMARY KEY (cycle_started))")


def test_an_OLD_narrower_CYCLES_table_is_WIDENED_TOO_not_just_the_hits_one(tmp_path, monkeypatch):
    """The UNTESTED half of a widening loop is the half that silently doesn't widen.
    `scan_live_cycles` gets the same ALTER-add pass as `scan_hits_live`, and this
    is what says so — every added column carries a DEFAULT, which is the only
    reason `ALTER TABLE … ADD COLUMN` accepts a NOT NULL one at all."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    with contextlib.closing(sqlite3.connect(str(path))) as c:
        c.execute(OLD_NARROW_CYCLES_DDL); c.commit()
    assert _columns(path, scan_store.LIVE_CYCLES_TABLE) == ["cycle_started"]   # the control
    scan_store.init_db()
    assert set(_columns(path, scan_store.LIVE_CYCLES_TABLE)) == {n for n, _ in scan_store.LIVE_CYCLE_COLUMNS}
    # …and the widened table is WRITABLE: a widening that leaves an unusable table
    # is the 8/25 incident with extra steps (0 rows, failing safely, invisibly)
    scan_store.record_live_cycle({"cycle_started": TICK, "tf": "D"}, ["x"])
    assert scan_store.last_live_cycle("D")["cycle_started"] == TICK


def test_a_fresh_file_gets_BOTH_live_tables_with_EXACTLY_the_declared_columns(store):
    for table, cols in ((scan_store.LIVE_HITS_TABLE, scan_store.LIVE_HIT_COLUMNS),
                        (scan_store.LIVE_CYCLES_TABLE, scan_store.LIVE_CYCLE_COLUMNS)):
        assert _columns(store, table) == [n for n, _ in cols], table


# ═══ 2. the writers: ONE each, ONE transaction, the nightly tables untouched ══

DEF = "sha256:" + "b" * 64
TICK = 1_787_900_000            # 2026-08-28 ~02:53 ET, a unix second (never a YYYYMMDD)
ROWS = [{"symbol": "aaa", "value": 1.0, "live_cols": 5, "src_price": 10.5},
        {"symbol": "BBB", "value": 1.0, "live_cols": 2, "src_price": 20.0}]


def _live_rows(path):
    with contextlib.closing(sqlite3.connect(str(path))) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute(
            f"SELECT * FROM {scan_store.LIVE_HITS_TABLE} ORDER BY symbol")]


def test_upsert_live_hits_REPLACES_the_definitions_set_and_uppercases(store):
    assert scan_store.upsert_live_hits(DEF, "D", ROWS, TICK) == 2
    assert [r["symbol"] for r in _live_rows(store)] == ["AAA", "BBB"]
    assert scan_store.upsert_live_hits(DEF, "D", ROWS[:1], TICK + 300) == 1
    rows = _live_rows(store)
    assert [r["symbol"] for r in rows] == ["AAA"] and rows[0]["as_of"] == TICK + 300


def test_the_live_key_REFUSES_a_session_date_BY_NAME(store):
    with pytest.raises(ValueError, match="TICK"):
        scan_store.upsert_live_hits(DEF, "D", ROWS, 20260826)
    with pytest.raises(ValueError, match="PRODUCT LABEL"):
        scan_store.upsert_live_hits(DEF, "1D", ROWS, TICK)


def test_a_MILLISECOND_epoch_is_REFUSED_because_it_would_poison_every_later_read(store):
    """⛔ A millisecond epoch is not a YYYYMMDD, so the session-date check waves it
    through. The row then writes cleanly and kills every subsequent READ of that
    definition — `live_session_ymd` hands it to `datetime.fromtimestamp`."""
    ms = TICK * 1000
    # ⚠️ THE CLASS IS PLATFORM-SPECIFIC, THE MEANING IS NOT. On Windows the C
    # runtime's `gmtime` refuses an out-of-range `time_t` and CPython surfaces
    # `OSError`; on glibc that same call succeeds at this magnitude and the
    # refusal comes from CPython's own year check as `ValueError`/`OverflowError`.
    # Pinning one of them would make this control pass only on this box.
    with pytest.raises((OSError, ValueError, OverflowError)):   # the control: the reader really does die
        scan_store.live_session_ymd(ms)
    with pytest.raises(ValueError, match="MILLISECOND"):
        scan_store.upsert_live_hits(DEF, "D", ROWS, ms)
    with pytest.raises(ValueError, match="MILLISECOND"):
        scan_store.record_live_cycle({"cycle_started": ms, "tf": "D"}, [])
    assert scan_store.hits_for(DEF, "D") == {"as_of": None, "rows": [], "live": None}


def test_a_MISSING_tick_is_refused_NAMING_the_tick_not_in_the_ledgers_words(store):
    """`cycle_started` absent from a receipt arrives here as None. The refusal has
    to name the TICK and the field a caller forgot, not `_normalize_bar_time`'s
    "unparseable bar_time: None" — which names neither."""
    for call in (lambda: scan_store.upsert_live_hits(DEF, "D", ROWS, None),
                 lambda: scan_store.record_live_cycle({"tf": "D"}, [])):
        with pytest.raises(ValueError, match="TICK") as exc:
            call()
        assert "cycle_started" in str(exc.value) and "unparseable" not in str(exc.value)


@pytest.mark.parametrize("autocommit", [False, True],
                         ids=["legacy-the-driver-opens-the-transaction", "autocommit-nobody-does"])
def test_the_replace_is_ONE_TRANSACTION_so_a_failed_insert_leaves_the_prior_set(store, monkeypatch, autocommit):
    """The DELETE and the INSERT land together or not at all — under BOTH transaction
    modes. `snapshot_db.connect()` leaves the driver on its legacy control today
    (`autocommit == LEGACY_TRANSACTION_CONTROL`: the first DML opens a transaction by
    itself), so a writer that never says BEGIN is atomic by accident of another
    module's default. The `autocommit=True` leg is the day that default flips: no
    implicit transaction exists, and only an EXPLICIT one keeps the DELETE from
    committing alone (five minutes of "the market went quiet" after a crash).

    The failure is injected INSIDE the connection — a `sqlite3.Connection` subclass
    handed to `sqlite3.connect(factory=…)` — because a C-level connection's methods
    are read-only: `conn.executemany = …` raises AttributeError, which is what the
    brief's version of this test measured instead of the transaction. Two controls:
    the DELETE must have RUN before the boom (`total_changes`), inside an OPEN
    transaction (`in_transaction`) — otherwise the surviving rows prove nothing."""
    class _Boom(Exception): pass
    armed, seen = {"boom": False}, {}

    class _BoomConn(sqlite3.Connection):
        def executemany(self, sql, rows):
            if armed["boom"] and "INSERT" in sql.upper():
                seen["changes_before_boom"] = self.total_changes
                seen["in_transaction_at_boom"] = self.in_transaction
                raise _Boom()
            return super().executemany(sql, rows)

    real_sqlite_connect = sqlite3.connect            # the conftest tripwire stays in the chain
    def _connect(*a, **k):
        conn = real_sqlite_connect(*a, factory=_BoomConn, **k)
        if autocommit:
            conn.autocommit = True
        return conn
    monkeypatch.setattr(sqlite3, "connect", _connect)
    assert scan_store.upsert_live_hits(DEF, "D", ROWS, TICK) == 2
    assert [r["symbol"] for r in _live_rows(store)] == ["AAA", "BBB"], "a GOOD write must commit in this mode"
    armed["boom"] = True
    with pytest.raises(_Boom):
        scan_store.upsert_live_hits(DEF, "D", ROWS[:1], TICK + 1)
    monkeypatch.setattr(sqlite3, "connect", real_sqlite_connect)
    assert seen["changes_before_boom"] >= 2, "the DELETE never ran — the surviving rows measure nothing"
    assert seen["in_transaction_at_boom"] is True, "the DELETE was not inside an open transaction"
    assert [r["symbol"] for r in _live_rows(store)] == ["AAA", "BBB"], "the DELETE half landed alone"


def test_the_nightly_tables_are_BYTE_IDENTICAL_across_every_live_write(store):
    scan_store.record_hits(DEF, "D", 20260825, ["AAA", "CCC"])
    scan_store.record_coverage(DEF, "D", 20260825, evaluated=3, answered=3, dropped=0,
                               not_computable=0, dropped_symbols=[], freshness="live")
    def _dump():
        with contextlib.closing(sqlite3.connect(str(store))) as c:
            return {t: c.execute(f"SELECT * FROM {t} ORDER BY 1,2,3").fetchall()
                    for t in ("scan_hits", "scan_coverage", "screener_rows")}
    before = _dump()
    scan_store.upsert_live_hits(DEF, "D", ROWS, TICK)
    scan_store.record_live_cycle({"cycle_started": TICK, "tf": "D"}, [DEF])
    assert _dump() == before


# ═══ 3. the overlay read: nightly hits LEFT-JOINed with SAME-SESSION live rows ═══

ET = ZoneInfo("America/New_York")


def _tick(y, m, d, hh, mm):
    return int(datetime.datetime(y, m, d, hh, mm, tzinfo=ET).timestamp())


def test_hits_for_OVERLAYS_live_rows_on_the_latest_nightly_session_and_marks_live_only(store):
    scan_store.record_hits(DEF, "D", 20260825, ["AAA", "CCC"])
    scan_store.record_coverage(DEF, "D", 20260825, evaluated=3, answered=3, dropped=0,
                               not_computable=0, dropped_symbols=[], freshness="live")
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.upsert_live_hits(DEF, "D", [{"symbol": "AAA", "value": 1, "live_cols": 5, "src_price": 1.0},
                                          {"symbol": "DDD", "value": 1, "live_cols": 2, "src_price": 2.0}], t)
    out = scan_store.hits_for(DEF, "D", now=t + 60)
    by = {r["symbol"]: r for r in out["rows"]}
    assert out["as_of"] == 20260825
    assert by["AAA"]["tier"] == "live" and by["AAA"]["in_nightly"] is True and by["AAA"]["live_as_of"] == t
    assert by["CCC"]["tier"] == "nightly" and by["CCC"]["live_as_of"] is None
    assert by["DDD"]["tier"] == "live" and by["DDD"]["in_nightly"] is False
    assert [r["symbol"] for r in out["rows"]] == ["AAA", "CCC", "DDD"], "nightly order first, live-only after"
    assert out["live"] is None, "no cycle has ever run is a real answer, distinct from a quiet cycle"
    assert {r["tier"] for r in out["rows"]} == set(scan_store.LIVE_TIERS), "the closed set, both words"


def _one_nightly_hit_and_one_live_row(wrote_tick, symbol="AAA"):
    """AAA hit on the 8/25 nightly sweep, and a live row for it written at `wrote_tick`."""
    scan_store.record_hits(DEF, "D", 20260825, [symbol])
    scan_store.record_coverage(DEF, "D", 20260825, evaluated=1, answered=1, dropped=0,
                               not_computable=0, dropped_symbols=[], freshness="live")
    scan_store.upsert_live_hits(
        DEF, "D", [{"symbol": symbol, "value": 1, "live_cols": 5, "src_price": 1}], wrote_tick)


def test_a_live_row_OLDER_than_max_age_serves_NIGHTLY_the_dead_sweeper_case(store, monkeypatch):
    """⚠️ THE AGE GATE ONLY. Both reads sit INSIDE the 8/26 session — 10:43 and
    10:57 against a row written at 10:42 — so the session gate answers `live` for
    each of them and age is the only thing that can separate them. This test
    therefore says NOTHING about the session gate. That gate has its own pair
    below, where the age gate is held open so only the session can answer."""
    _one_nightly_hit_and_one_live_row(_tick(2026, 8, 26, 10, 42))
    t = _tick(2026, 8, 26, 10, 42)
    monkeypatch.setenv("SCAN_LIVE_MAX_AGE_S", "900")
    assert scan_store.hits_for(DEF, "D", now=t + 60)["rows"][0]["tier"] == "live"        # the control
    assert scan_store.hits_for(DEF, "D", now=t + 901)["rows"][0]["tier"] == "nightly"    # dead sweeper


# The session gate's own pair: a row written two minutes before the 8/26 close and
# read one minute into the 8/27 session — 63,180 s apart, under a max age raised
# to a full day, so AGE cannot be what refuses it.
LATE_IN_SESSION = _tick(2026, 8, 26, 15, 58)
NEXT_MORNING = _tick(2026, 8, 27, 9, 31)
DAY_LONG_MAX_AGE = "86400"


def test_a_live_row_from_ANOTHER_SESSION_serves_NIGHTLY_even_when_it_is_YOUNG_ENOUGH(store, monkeypatch):
    """⛔ THE SESSION IS ITS OWN GATE, not a slow consequence of the age one. A row
    from yesterday afternoon is young in seconds and WRONG in fact: it was
    computed against a forming bar that has since closed, and serving it beside
    today's nightly set would age a stale answer into the current session."""
    monkeypatch.setenv("SCAN_LIVE_MAX_AGE_S", DAY_LONG_MAX_AGE)
    _one_nightly_hit_and_one_live_row(LATE_IN_SESSION)
    assert NEXT_MORNING - LATE_IN_SESSION < scan_store.live_max_age_s(), (
        "the AGE gate must be OPEN across this pair, or the session gate is never consulted "
        "and this test measures the age gate a second time")
    same_session = scan_store.hits_for(DEF, "D", now=_tick(2026, 8, 26, 16, 30))
    assert same_session["rows"][0]["tier"] == "live", "the control: same session, same max age"
    assert scan_store.hits_for(DEF, "D", now=NEXT_MORNING)["rows"][0]["tier"] == "nightly"


def test_DISABLING_the_session_gate_FLIPS_that_answer_so_the_gate_is_what_decides(store, monkeypatch):
    """The differential control for the test above. With `live_session_ymd` stubbed
    to a constant — every tick "the same session" — the identical read answers
    `live`. Gate real ⇒ nightly, gate disabled ⇒ live: the session comparison is
    the only thing standing between them. ⚠️ A gate that cannot fail is not a gate,
    and this is the assertion that would go red if the comparison were removed."""
    monkeypatch.setenv("SCAN_LIVE_MAX_AGE_S", DAY_LONG_MAX_AGE)
    _one_nightly_hit_and_one_live_row(LATE_IN_SESSION)
    monkeypatch.setattr(scan_store, "live_session_ymd", lambda tick: 20260826)
    assert scan_store.hits_for(DEF, "D", now=NEXT_MORNING)["rows"][0]["tier"] == "live"


def test_an_OLDER_requested_session_is_never_overlaid(store):
    for day in (20260824, 20260825):
        scan_store.record_hits(DEF, "D", day, ["AAA"])
        scan_store.record_coverage(DEF, "D", day, evaluated=1, answered=1, dropped=0,
                                   not_computable=0, dropped_symbols=[], freshness="live")
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.upsert_live_hits(DEF, "D", [{"symbol": "AAA", "value": 1, "live_cols": 5, "src_price": 1}], t)
    assert scan_store.hits_for(DEF, "D", 20260824, now=t + 1)["rows"][0]["tier"] == "nightly"
    assert scan_store.hits_for(DEF, "D", 20260825, now=t + 1)["rows"][0]["tier"] == "live"


def test_hits_for_answers_NOBODY_LOOKED_when_there_is_no_nightly_session(store):
    assert scan_store.hits_for(DEF, "D") == {"as_of": None, "rows": [], "live": None}


def test_the_live_block_is_the_LAST_CYCLE_and_says_whether_THIS_definition_was_swept(store):
    scan_store.record_hits(DEF, "D", 20260825, [])
    scan_store.record_coverage(DEF, "D", 20260825, evaluated=1, answered=1, dropped=0,
                               not_computable=0, dropped_symbols=[], freshness="live")
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.record_live_cycle({"cycle_started": t, "tf": "D", "skipped_reason": None}, ["other"])
    live = scan_store.hits_for(DEF, "D", now=t + 5)["live"]
    assert live["cycle_started"] == t and live["definition_swept"] is False
    assert live["skipped_reason"] is None
    assert live["fresh_rows"] == 0


def test_the_TIER_WORDS_are_READ_from_LIVE_TIERS_and_never_retyped_inside_hits_for():
    """⛔ A closed set nothing reads is a comment wearing a constant's clothes.
    `LIVE_TIERS` is the declared authority over the two provenance words, so
    `hits_for` must not contain either of them as a string literal of its own —
    otherwise editing the tuple would change the docs and not the answers."""
    src = pathlib.Path(scan_store.__file__).read_text(encoding="utf-8")
    fn = next(n for n in pyast.walk(pyast.parse(src))
              if isinstance(n, pyast.FunctionDef) and n.name == "hits_for")
    # ⚠️ dict KEYS are exempt: the payload's `"live"` block is a FIELD NAME fixed by
    # the route contract, not a tier word — same five letters, different fact.
    key_nodes = {id(k) for d in pyast.walk(fn) if isinstance(d, pyast.Dict) for k in d.keys if k}
    retyped = [n.value for n in pyast.walk(fn)
               if isinstance(n, pyast.Constant) and n.value in scan_store.LIVE_TIERS
               and id(n) not in key_nodes]
    assert not retyped, f"hits_for retypes {retyped}; LIVE_TIERS is the one authority"


# ═══ 4. the AST rail: live functions never WRITE a nightly table (and a control) ═══

NIGHTLY_TABLES = ("scan_hits", "scan_coverage", "screener_rows")
WRITE_VERBS = ("INSERT", "DELETE", "UPDATE", "REPLACE")
#: The ONLY interpolations the probe resolves — read off the store, never retyped.
LIVE_CONSTANTS = {"LIVE_HITS_TABLE": scan_store.LIVE_HITS_TABLE,
                  "LIVE_CYCLES_TABLE": scan_store.LIVE_CYCLES_TABLE}
Writes = collections.namedtuple("Writes", "tables unresolved")


def _sql_strings(node, constants):
    """Every string an execute* call can be reading, ONE per literal.

    A plain `Constant` as-is. A `JoinedStr` (f-string) reassembled with `constants`
    substituted for `{NAME}` placeholders and every OTHER interpolation reported by
    its source text instead of being dropped — the literal parts of
    `f"DELETE FROM {LIVE_HITS_TABLE} …"` never carry the table, which is how the
    brief's probe read every live writer as writing nothing. A JoinedStr's Constant
    children are never re-visited as bare literals."""
    if isinstance(node, pyast.JoinedStr):
        parts, unresolved = [], []
        for v in node.values:
            if isinstance(v, pyast.Constant):
                parts.append(str(v.value))
            elif (isinstance(v, pyast.FormattedValue) and isinstance(v.value, pyast.Name)
                  and v.value.id in constants):
                parts.append(constants[v.value.id])
            else:
                unresolved.append(pyast.unparse(v.value))
        yield "".join(parts), unresolved
        return
    if isinstance(node, pyast.Constant) and isinstance(node.value, str):
        yield node.value, []
        return
    for child in pyast.iter_child_nodes(node):
        yield from _sql_strings(child, constants)


def _writes_by_function(source: str, *, resolve: bool = True) -> dict:
    """{function name: Writes(tables its execute*/executescript SQL WRITES, the
    interpolations in its execute* f-strings it could NOT resolve)}. AST, never grep.
    `resolve=False` is the brief's literal probe, kept ONLY so a control can show it
    is blind."""
    constants = LIVE_CONSTANTS if resolve else {}
    tree = pyast.parse(source)
    out = {}
    for fn in [n for n in pyast.walk(tree) if isinstance(n, pyast.FunctionDef)]:
        tables, unresolved = set(), []
        for call in [n for n in pyast.walk(fn) if isinstance(n, pyast.Call)]:
            if getattr(call.func, "attr", None) not in ("execute", "executemany", "executescript"):
                continue
            for text, missing in _sql_strings(call, constants):
                unresolved += missing
                sql = text.upper()
                if any(v in sql for v in WRITE_VERBS):
                    for t in NIGHTLY_TABLES + tuple(LIVE_CONSTANTS.values()):
                        if re.search(rf"\b{t.upper()}\b", sql):
                            tables.add(t)
        out[fn.name] = Writes(tables, unresolved)
    return out


def _live_writers(writes: dict) -> set:
    """The functions this rail governs — DERIVED from the two live TABLES, not from
    the substring "live" in a name: anything writing either live table is a live
    writer whatever it is called, so a future `upsert_intraday_hits` or
    `record_tick_cycle` is inside the rail with no edit here. Name-matched
    functions are folded in as well, because the one offender the table rule
    cannot see is a live-NAMED function that writes ONLY a nightly table."""
    derived = {n for n, w in writes.items() if w.tables & set(LIVE_CONSTANTS.values())}
    return derived | {n for n in writes if "live" in n}


def test_no_LIVE_WRITER_IN_THIS_MODULE_writes_a_nightly_table():
    """⚠️ SCOPE, EXACTLY: `scan_store`'s OWN functions. This reads ONE file.

    It does NOT say the live SWEEP never writes a nightly table — as of today it
    does: `scan_evaluator.evaluate_one(mode="live")` still falls through to
    `record_hits`/`record_coverage`, W4a's deliberate placeholder (see
    `scan_evaluator.EVALUATE_MODES`: "until it lands, `live` runs and persists
    exactly as `nightly` does"). Extending this probe there today would red the
    branch over a placeholder that is correct for today, and a rail that is red
    by design teaches people to ignore it.

    ⭐ W4b.3 OWNS THE SYSTEM-LEVEL RAIL: wiring the live branch requires extending
    this probe to `scan_evaluator` — no function reachable under `mode == "live"`
    calls a nightly writer — green in the SAME commit. A live answer filed into
    `scan_coverage` would record a forming-bar result as that session's
    closed-bar coverage: the second-authority defect the two-table split exists
    to prevent.
    """
    src = pathlib.Path(scan_store.__file__).read_text(encoding="utf-8")
    writes = _writes_by_function(src)
    live_fns = _live_writers(writes)
    assert live_fns >= {"upsert_live_hits", "record_live_cycle"}, live_fns
    for name in live_fns:
        assert not (writes[name].tables & set(NIGHTLY_TABLES)), f"{name} writes {writes[name].tables}"
        assert not writes[name].unresolved, (
            f"{name} builds SQL from {writes[name].unresolved} — a table the probe cannot "
            "read is a table this rail cannot clear")
    for name in ("record_hits", "record_coverage", "prune"):
        assert not (writes[name].tables & set(LIVE_CONSTANTS.values())), name
    # …and the live writers are SEEN writing their own tables: the rail passes on the
    # code, not on blindness
    assert writes["upsert_live_hits"].tables == {scan_store.LIVE_HITS_TABLE}
    assert writes["record_live_cycle"].tables == {scan_store.LIVE_CYCLES_TABLE}


def test_the_write_probe_SEES_a_planted_offender_in_BOTH_spellings():
    planted = ("def upsert_live_x(conn):\n"
               "    conn.execute('DELETE FROM scan_hits WHERE 1')\n")
    assert _writes_by_function(planted)["upsert_live_x"].tables == {"scan_hits"}
    # ⚠️ the real writers spell their table through an f-string — the probe must read THAT
    planted_f = ("def upsert_live_y(conn):\n"
                 "    conn.execute(f'DELETE FROM {LIVE_HITS_TABLE} WHERE 1')\n")
    assert _writes_by_function(planted_f)["upsert_live_y"].tables == {scan_store.LIVE_HITS_TABLE}


def test_the_LIVE_SET_is_derived_from_the_TABLES_so_a_differently_NAMED_writer_is_still_railed():
    """The naming trap the rail must not have: a live writer called something else.
    `upsert_intraday_hits` carries no "live" in its name, writes a live table, and
    also writes a nightly one — the rail has to SEE it to refuse it."""
    planted = ("def upsert_intraday_hits(conn):\n"
               "    conn.execute(f'INSERT INTO {LIVE_HITS_TABLE} VALUES (1)')\n"
               "    conn.execute('DELETE FROM scan_coverage WHERE 1')\n")
    writes = _writes_by_function(planted)
    assert _live_writers(writes) == {"upsert_intraday_hits"}, "derived from the table, not the name"
    assert writes["upsert_intraday_hits"].tables & set(NIGHTLY_TABLES), "…and it IS an offender"


def test_the_probe_REFUSES_an_fstring_it_cannot_resolve_rather_than_clearing_it():
    planted = ("def upsert_live_z(conn):\n"
               "    conn.execute(f'DELETE FROM {NIGHTLY} WHERE 1')\n")
    got = _writes_by_function(planted)["upsert_live_z"]
    assert got.tables == set() and got.unresolved == ["NIGHTLY"], got


def test_WITHOUT_fstring_resolution_the_rail_would_pass_VACUOUSLY():
    """The brief's literal probe reads every live writer as writing NOTHING, so the
    rail above would pass on blindness rather than on the code. Kept as a control:
    the day someone simplifies the probe, this goes red before the rail goes silent."""
    src = pathlib.Path(scan_store.__file__).read_text(encoding="utf-8")
    naive = _writes_by_function(src, resolve=False)
    assert naive["upsert_live_hits"].tables == set() and naive["record_live_cycle"].tables == set()
    assert naive["record_hits"].tables == {"scan_hits"}, "plain literals it CAN read"


# ═══ 5. demand: the store owns it — bounded, most-recent-first, per-process ═══

def test_note_demand_is_BOUNDED_most_recent_first_and_uppercased(monkeypatch):
    monkeypatch.setattr(scan_store, "_DEMAND", collections.OrderedDict())
    monkeypatch.setattr(scan_store, "DEMAND_MAX", 3)
    scan_store.note_demand(["aaa", "bbb"]); scan_store.note_demand(["ccc", "aaa"]); scan_store.note_demand(["ddd"])
    assert scan_store.demand_recent() == ["DDD", "AAA", "CCC"]      # BBB evicted, AAA refreshed
    assert scan_store.demand_recent(limit=1) == ["DDD"]


def test_note_demand_IGNORES_blanks_and_a_zero_limit_is_an_empty_list(monkeypatch):
    monkeypatch.setattr(scan_store, "_DEMAND", collections.OrderedDict())
    scan_store.note_demand(["", None, "  eee ", "eee"])
    assert scan_store.demand_recent() == ["EEE"]
    assert scan_store.demand_recent(limit=0) == []


# ═══ 6. the forming bar: which series a tree reads AT OFFSET ZERO ════════════

def _offset(child, n):
    """The canonical `offset` node — `close[1]` is an offset of ONE around `close`."""
    return {"type": "offset", "value": n, "args": [child]}


def test_forming_bar_series_is_EVERY_series_read_at_offset_ZERO_and_offsets_COMPOSE():
    """⛔ THE OFFSET IS ACCUMULATED ALONG THE PATH, NOT READ OFF THE NEAREST NODE.
    A window `[i-n, i]` includes `i`, so `sma(close, 20)` reads the forming bar
    just as bare `close` does; `high[1] > high[2]` reads nothing on it. Only the
    SUM of the offsets between the root and the series says which of those it is.
    """
    f = scan_evaluator._forming_bar_series
    assert f(_op(">", _series("close"),
                 {"type": "call", "name": "sma", "args": [_series("close"), _num(20)]})) == {"close"}
    assert f(_op(">", _series("high"), _offset(_series("high"), 1))) == {"high"}
    assert f(_op(">", _offset(_series("high"), 1), _offset(_series("high"), 2))) == set()   # the control
    assert f({"type": "call", "name": "sma", "args": [_offset(_series("high"), 1), _num(5)]}) == set()
    assert f(_offset(_offset(_series("low"), 1), 0)) == set()                               # 1 + 0


def test_forming_bar_series_is_DERIVED_from_the_manifest_not_a_hand_list():
    """A scalar rides the same `series` node; it is not a bar field and must not be reported."""
    assert scan_evaluator._forming_bar_series(_op(">", _series("market_cap"), _num(1))) == set()
    assert scan_evaluator._forming_bar_series(_series("volume")) == {"volume"}


def test_the_bar_field_map_is_the_SAME_declaration_backtest_reads():
    """⛔ ONE DECLARATION OF WHICH BAR KEY A SERIES READS. `backtest._bar_fields`
    already answers that question off `TABLE['series'][name]['field']`; a second
    `{"close": "c"}` here would be the second-authority defect, and it would rot
    silently the day the manifest grows a series."""
    from api.services.screener import backtest
    tree = _op(">", _series("close"),
               {"type": "call", "name": "sma", "args": [_series("close"), _num(20)]})
    assert tuple(sorted(scan_evaluator._BAR_FIELD_OF(n)
                        for n in scan_evaluator._forming_bar_series(tree))) == backtest._bar_fields(tree)
# ═══ 7. the forming bar itself: the snapshot's candle behind the live tier's gate ═══
#
# SESSION is a Wednesday and PREV the Tuesday before it, so the anchor is exactly
# one weekday session old and `live_tier`'s own `stale_anchor` gate is open —
# leaving each parametrised case below refused by the ONE gate it names.

SESSION = 20260826
PREV = 20260825

#: `_daily_bars` closes at `start_close + n - 1`, so a 60-bar run ends at 69.0 —
#: which is why `prev_close` reads 69.0 here. The anchor price the gate compares
#: against is that same last confirmed close, so the pair is not a coincidence:
#: change one and the deviation case below stops measuring what it names.
QUOTE = {"last_price": 71.0, "prev_close": 69.0, "today_vol": 1_000_000, "prev_vol": 2_000_000,
         "day_open": 69.5, "day_high": 71.4, "day_low": 69.1}


def _bars(n, end):
    """`n` daily bars ending on `end`, in the DICT shape `_read_bars` hands out."""
    return [{"t": k, "o": o, "h": h, "l": l, "c": c, "v": v}
            for k, o, h, l, c, v in _daily_bars(n, end=end)]


def test_live_bars_for_APPENDS_the_forming_bar_after_the_last_confirmed_one():
    bars = _bars(60, end=datetime.date(2026, 8, 25))          # confirmed through PREV
    out = scan_evaluator.live_bars_for("AAA", bars, QUOTE, session=SESSION, prev_session=PREV)
    assert out["reason"] is None and out["live_cols"] == 5
    last = out["bars"][-1]
    assert last == {"t": SESSION, "o": 69.5, "h": 71.4, "l": 69.1, "c": 71.0, "v": 1_000_000}
    assert out["bars"][-2]["t"] == PREV and len(out["bars"]) == 61


def test_a_store_bar_NEWER_than_the_previous_session_is_REPLACED_by_the_snapshots_forming_bar():
    """⚠️ The store can already hold a PARTIAL bar for today — `bars_prewarm` writes
    one mid-session. The snapshot is the newer description of that same forming
    bar, so it REPLACES it; keeping both would put two candles on one session and
    keeping the store's would answer today off a stale intraday write."""
    bars = _bars(61, end=datetime.date(2026, 8, 26))          # the store carries a partial today
    assert bars[-1]["t"] == SESSION and bars[-1]["c"] != 71.0, "the control: a DIFFERENT today bar"
    out = scan_evaluator.live_bars_for("AAA", bars, QUOTE, session=SESSION, prev_session=PREV)
    assert [b["t"] for b in out["bars"]][-2:] == [PREV, SESSION] and out["bars"][-1]["c"] == 71.0


@pytest.mark.parametrize("quote, reason, detail", [
    (None, "no-live-quote", "no_feed"),
    (dict(QUOTE, today_vol=0, day_open=None), "no-live-quote", "not_traded"),
    (dict(QUOTE, last_price=0), "no-live-quote", "no_price"),
    (dict(QUOTE, last_price=300.0), "no-live-quote", "insane_deviation"),
])
def test_a_quote_the_live_tier_would_refuse_is_refused_HERE_with_ITS_reason(quote, reason, detail):
    """⛔ ONE SANITY OWNER. Every word in `detail` is `live_tier`'s own, so the live
    tier and the live sweep can never disagree about whether a quote is usable —
    and a NEW gate added there is honoured here with no edit in this lane.

    ⚠️ THE SUBSET ASSERT IS WHAT MAKES THAT CLAIM MEASURED RATHER THAN STATED. The
    four cases below are hand-typed words; on their own they would pass just as
    well against a hand-written copy of `live_tier`'s rules. Asserting the
    forwarded word is a MEMBER of the declared closed tuple is what ties this
    module's `detail` vocabulary to the owner's — and it is the assert that goes
    red if this lane ever starts composing a reason of its own.
    """
    bars = _bars(60, end=datetime.date(2026, 8, 25))
    out = scan_evaluator.live_bars_for("AAA", bars, quote, session=SESSION, prev_session=PREV)
    assert (out["bars"], out["reason"], out["detail"]) == ([], reason, detail)
    assert {out["detail"]} <= set(live_tier.SKIP_REASONS), (
        f"{out['detail']!r} is not one of the sanity owner's OWN words — this lane "
        f"has grown a second vocabulary")


def test_the_gate_IS_live_tiers_sanity_reason_by_AST_not_a_second_copy():
    """The structural half of the test above: the four cases would pass just as
    well against a hand-written copy of the same four rules, which is exactly the
    second-authority defect. This says the call is there."""
    fn = _function_node("live_bars_for")
    calls = {getattr(n.func, "attr", None) for n in pyast.walk(fn) if isinstance(n, pyast.Call)}
    assert "sanity_reason" in calls


def test_sanity_reason_is_the_ONLY_gate_no_SECOND_RULE_BESIDE_it():
    """⛔ THE CONSTRAINT IS "NO SECOND SANITY RULE", AND PRESENCE CANNOT SAY THAT.
    The test above proves `sanity_reason` is CALLED; a hand-written rule added
    BESIDE it — `if quote["prev_vol"] < 1000: return refused` — passes that test
    and all four behaviour cases, and is exactly the defect the pair exists to
    prevent. So this pins the SHAPE of the refusal: there is exactly ONE
    `no-live-quote` return in the function, and the `detail` it forwards is a bare
    NAME bound exactly once, by the `sanity_reason` call itself. A second rule
    needs either a second refusal or a composed detail, and either one reds this.
    """
    fn = _function_node("live_bars_for")
    refusals = [n for n in pyast.walk(fn)
                if isinstance(n, pyast.Return) and isinstance(n.value, pyast.Dict)
                and any(isinstance(v, pyast.Name) and v.id == "LIVE_DROP_REASON"
                        for v in n.value.values)]
    assert len(refusals) == 1, (
        f"{len(refusals)} `no-live-quote` returns in live_bars_for — a second sanity rule?")
    fields = dict(zip([getattr(k, "value", None) for k in refusals[0].value.keys],
                      refusals[0].value.values))
    detail = fields["detail"]
    assert isinstance(detail, pyast.Name), (
        "the refusal's `detail` is COMPOSED here rather than forwarded — the sanity "
        "owner's word is the only thing that may appear there")
    binds = [a for a in pyast.walk(fn) if isinstance(a, pyast.Assign)
             and any(isinstance(t, pyast.Name) and t.id == detail.id for t in a.targets)]
    assert len(binds) == 1, f"`{detail.id}` is assigned {len(binds)} times, not once"
    assert isinstance(binds[0].value, pyast.Call)         and getattr(binds[0].value.func, "attr", None) == "sanity_reason",         f"`{detail.id}` is not bound by the sanity_reason call"


def test_stale_daily_bars_are_a_DROP_before_any_quote_is_looked_at():
    """A symbol whose newest confirmed bar is not the previous session has no
    anchor to hang a live price on — the drop is a fact about the BARS, and it is
    reached before the quote is consulted at all."""
    bars = _bars(60, end=datetime.date(2026, 8, 21))
    out = scan_evaluator.live_bars_for("AAA", bars, QUOTE, session=SESSION, prev_session=PREV)
    assert out["reason"] == "stale-bars" and out["bars"] == []
    assert scan_evaluator.live_bars_for("AAA", [], QUOTE, session=SESSION, prev_session=PREV)["reason"] == "no-bars"


def test_a_quote_MISSING_its_OHL_still_yields_a_bar_and_live_cols_SAYS_WHICH_ARRIVED():
    """A quote that HAS TRADED (`today_vol` > 0) but whose `o/h/l` the feed did not
    carry. The bar is still usable — `c` and `v` are real — so the refusal is PER
    FIELD: `live_cols` says how many of the five arrived, and a tree reading `high`
    on the forming bar is what W4b.3 turns into `live:forming-bar:high`.

    ⚠️ THIS IS NOT THE PRE-OPEN SHAPE, AND IT USED TO CLAIM IT WAS. Genuine
    pre-open out of `massive.get_full_market_snapshot` is `today_vol=0` WITH
    `day_open=None`, and it never reaches this code at all — `sanity_reason`
    refuses it `not_traded`, which is the case the parametrisation one test up
    already pins. What survives to build a bar with no o/h/l is a DEGRADED FEED
    ROW, which is precisely the shape per-field refusal exists for.
    """
    bars = _bars(60, end=datetime.date(2026, 8, 25))
    q = dict(QUOTE, day_open=None, day_high=None, day_low=None)
    assert q["today_vol"] > 0, "the control: this quote TRADED — pre-open is the case above"
    out = scan_evaluator.live_bars_for("AAA", bars, q, session=SESSION, prev_session=PREV)
    assert out["live_cols"] == 2 and out["bars"][-1]["h"] is None
    # ⛔ and the floor is 2, not 1: `v` is an int and counts even at 0 (see `_f`).
    zero_vol = dict(q, today_vol=0, day_open=69.5)
    assert scan_evaluator.live_bars_for(
        "AAA", bars, zero_vol, session=SESSION, prev_session=PREV)["live_cols"] == 3


def test_the_per_field_refusal_word_is_NAMESPACED_and_names_the_FIELD_that_is_MISSING():
    """The detail W4b.3 reports is `live:forming-bar:<field>` — namespaced into the
    lane contract's closed-set idiom, and it names the field so a member reading a
    short screen learns WHICH input the feed did not carry, never just "no".

    ⛔ THE `<field>` HALF IS A MANIFEST SERIES NAME, NEVER A TYPED LIST: every name
    `_forming_bar_series` can return composes into its OWN distinct word, so a
    sixth series is covered with no edit here.

    ⚠️ WHAT CARRIES THIS TEST IS THE EXACT-EQUALITY PIN ON THE FIRST LINE, not the
    `split(":")` below it. An earlier version of this docstring claimed the
    opposite and was wrong: with the constant pinned to its literal, a prefix that
    lost its trailing separator reds that first assert before any derived one runs,
    and the asserts underneath compose a dict FROM the very constant just pinned —
    there is no second producer for them to disagree with, so they cannot fail
    independently today. They are kept because they DOCUMENT the composition rule
    and would become load-bearing the day the prefix is computed rather than
    literal; they are not, and were never, an independent check.
    """
    assert scan_evaluator.LIVE_NOT_COMPUTABLE_DETAIL == "live:forming-bar:"
    names = sorted(ast_freshness._sections(None)[0])
    assert names, "the manifest declares no series — this test would be vacuous"
    details = {n: scan_evaluator.LIVE_NOT_COMPUTABLE_DETAIL + n for n in names}
    assert len(set(details.values())) == len(names), "two fields sharing one word"
    assert all(d.startswith("live:") for d in details.values())
    assert all(d.split(":")[-1] == n for n, d in details.items()), details
    # and the names really are the ones the reach analysis hands the caller
    assert scan_evaluator._forming_bar_series(_series("high")) == {"high"}
    assert details["high"] == "live:forming-bar:high"


def test_no_live_quote_is_IN_the_closed_DROP_REASONS_set_beside_the_others():
    """A refusal word a caller cannot branch on exhaustively is not a closed set.
    ⚠️ Pinned by MEMBERSHIP, never by the tuple's length — a sixth reason tomorrow
    is a ruling, not a red here."""
    assert scan_evaluator.LIVE_DROP_REASON == "no-live-quote"
    assert scan_evaluator.LIVE_DROP_REASON in scan_evaluator.DROP_REASONS
    for older in ("no-bars", "stale-bars", "no-screener-row", "refused"):
        assert older in scan_evaluator.DROP_REASONS, "the widening must not DISPLACE a nightly word"
