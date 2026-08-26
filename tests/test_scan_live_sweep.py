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


def _writes_by_function(source: str, *, resolve: bool = True,
                        constants: dict = None, tables: tuple = None) -> dict:
    """{function name: Writes(tables its execute*/executescript SQL WRITES, the
    interpolations in its execute* f-strings it could NOT resolve)}. AST, never grep.
    `resolve=False` is the brief's literal probe, kept ONLY so a control can show it
    is blind.

    ⭐ `constants`/`tables` let ONE probe read a SECOND module against its own table
    declaration — section 9 points it at `definition_record.TABLE_NAME`. Both
    default to this file's, so every existing caller is unchanged.
    """
    constants = (LIVE_CONSTANTS if constants is None else constants) if resolve else {}
    watched = (NIGHTLY_TABLES + tuple(LIVE_CONSTANTS.values())
               if tables is None else tuple(tables))
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
                    for t in watched:
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

    It does not, on its own, say the live SWEEP never writes a nightly table: when
    this was written it DID — `evaluate_one(mode="live")` fell through to
    `record_hits`/`record_coverage`, W4a's deliberate placeholder — and extending
    this probe there THEN would have been a rail that was red by design, which
    teaches people to ignore rails.

    ⭐ SECTION 9 IS THE SYSTEM-LEVEL HALF, and W4b.3 landed it in the same commit
    that wired the live branch: no function reachable under `mode == "live"` calls
    a nightly writer, with the offender set derived from these same table
    constants. The two are complements — this one reads the STORE's functions,
    section 9 reads the EVALUATOR's call graph — and neither subsumes the other.
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


def test_a_NON_STRING_series_name_is_REFUSED_by_name_never_RAISED():
    """⛔ THE GUARD THAT WAS DROPPED ONCE, NOW RAILED. `_forming_bar_series` reads
    PERSISTED trees — user data that never went through `canonicalise` — and no
    upstream reader refuses a non-string `name`: `ast_freshness.scalars_in` returns
    an empty set for it, `max_lookback` returns 0. Without `isinstance(name, str)`
    the membership test raises `TypeError: unhashable type` — a RAISE, not a
    refusal by name, out of a module whose whole contract is to refuse by name.

    ⚠️ THE POINT OF THIS TEST IS THAT DELETING THE GUARD GOES RED. Nothing else in
    the suite plants a non-string name, which is exactly how the guard was lost the
    first time.
    """
    f = scan_evaluator._forming_bar_series
    assert f({"type": "series", "name": {}}) == set()
    assert f({"type": "series", "name": ["close"]}) == set()
    assert f(_op(">", {"type": "series", "name": {"close": 1}}, _num(1))) == set()
    assert f(_op(">", _series("close"), {"type": "series", "name": {}})) == {"close"}, (
        "one unusable name must not lose the sibling that IS usable")


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
    out = scan_evaluator.live_bars_for(bars, QUOTE, session=SESSION, prev_session=PREV)
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
    out = scan_evaluator.live_bars_for(bars, QUOTE, session=SESSION, prev_session=PREV)
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
    out = scan_evaluator.live_bars_for(bars, quote, session=SESSION, prev_session=PREV)
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

    ⚠️ AND THE ONE SHAPE THE ORIGINAL MISSED: DOCTORING THE INPUT BEFORE THE GATE.
    `if quote.get("prev_vol", 0) < 1000: quote = dict(quote, last_price=0)` inserted
    ABOVE the call adds a second sanity rule, still produces ONE refusal whose
    `detail` is bound once by `sanity_reason`, and passes everything above. So both
    of the call's arguments are pinned too: the `quote` parameter is never rebound,
    and `anchor` — the only argument this function composes — is composed exactly
    once. What is covered is therefore "no second rule BESIDE it and none UPSTREAM
    of its inputs". A rule expressed INSIDE `live_tier.sanity_reason` is the
    owner's, which is the whole point.
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
    bound_by = binds[0].value
    assert (isinstance(bound_by, pyast.Call)
            and getattr(bound_by.func, "attr", None) == "sanity_reason"), (
        f"`{detail.id}` is not bound by the sanity_reason call")
    # …and NEITHER of the gate's two arguments is doctored on the way in
    targets = [t for a in pyast.walk(fn)
               for t in (a.targets if isinstance(a, pyast.Assign)
                         else [a.target] if isinstance(a, (pyast.AugAssign, pyast.AnnAssign))
                         else [])]
    names = [t.id for t in targets if isinstance(t, pyast.Name)]
    assert "quote" not in names, (
        "`quote` is REBOUND inside live_bars_for — a rule that edits the input "
        "before the gate is a second sanity rule wearing an assignment's clothes")
    assert names.count("anchor") == 1, (
        f"`anchor` is composed {names.count('anchor')} times, not once")


def test_stale_daily_bars_are_a_DROP_before_any_quote_is_looked_at():
    """A symbol whose newest confirmed bar is not the previous session has no
    anchor to hang a live price on — the drop is a fact about the BARS, and it is
    reached before the quote is consulted at all."""
    bars = _bars(60, end=datetime.date(2026, 8, 21))
    out = scan_evaluator.live_bars_for(bars, QUOTE, session=SESSION, prev_session=PREV)
    assert out["reason"] == "stale-bars" and out["bars"] == []
    assert scan_evaluator.live_bars_for([], QUOTE, session=SESSION, prev_session=PREV)["reason"] == "no-bars"


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
    out = scan_evaluator.live_bars_for(bars, q, session=SESSION, prev_session=PREV)
    assert out["live_cols"] == 2 and out["bars"][-1]["h"] is None
    # ⛔ and the floor is 2, not 1: `v` is an int and counts even at 0 (see `_f`).
    zero_vol = dict(q, today_vol=0, day_open=69.5)
    assert scan_evaluator.live_bars_for(
        bars, zero_vol, session=SESSION, prev_session=PREV)["live_cols"] == 3


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

# ═══ 8. `evaluate_one(mode=…)`: the live branch answers on the forming bar ════
#
# ⭐ THE SNAPSHOT IS THE FEED'S SHAPE, NOT A CONVENIENT ONE. `SNAP` is what
# `massive.get_full_market_snapshot` emits, and `BBB` is a DEGRADED row whose feed
# never carried `day_high` — the only shape per-field refusal exists for.

SNAP = {"AAA": QUOTE, "BBB": dict(QUOTE, day_high=None)}
#: The tick the snapshot was read at — a unix SECOND, never a YYYYMMDD. 10:42 ET
#: on SESSION, inside the regular session by construction.
TICK26 = int(datetime.datetime(2026, 8, 26, 10, 42, tzinfo=scan_evaluator._ET).timestamp())


def _call(name, args):
    return {"type": "call", "name": name, "args": list(args)}


#: `close > sma(close, 20)` — bars-only, and it READS `close` on the forming bar,
#: so the live answer genuinely depends on the snapshot rather than on history.
SMA_TREE = _op(">", _series("close"), _call("sma", [_series("close"), _num(20)]))
#: `high > high[1]` — reads `high` at offset 0, which `BBB`'s feed did not carry.
HIGH_TREE = _op(">", _series("high"), _offset(_series("high"), 1))


def test_LIVE_evaluate_one_answers_on_the_forming_bar_and_writes_ONLY_the_live_table(store, bars):
    """🔴 THE WHOLE POINT OF THE TWO-TABLE SPLIT, MEASURED. A live answer is built
    on a FORMING bar; filing it into `scan_coverage` would record it as that
    session's CLOSED-bar coverage — a second authority over "what this session's
    screen said". So the live branch writes `scan_hits_live` and nothing else."""
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    out = scan_evaluator.evaluate_one(_definition(SMA_TREE), "D", universe=["AAA"],
                                      as_of=SESSION, mode="live", snapshot=SNAP,
                                      tick=TICK26, prev_session=PREV)
    assert out["mode"] == "live" and out["answered"] == 1 and out["hits"] == ["AAA"]
    assert out["hit_rows"] == [{"symbol": "AAA", "value": 1.0, "bar_time": SESSION,
                                "live_cols": 5, "src_price": 71.0}]
    assert out["tick"] == TICK26
    live = scan_store.live_hits(out["def_hash"], "D")
    assert [r["symbol"] for r in live] == ["AAA"] and live[0]["as_of"] == TICK26
    # …and the nightly tables are untouched — "nobody looked" is the honest read
    assert scan_store.coverage(out["def_hash"], "D", SESSION) is None
    assert scan_store.hits(out["def_hash"], "D", SESSION) == []
    assert out["recorded"] == 0, "the forward record is closed-bar only"


def test_a_tree_reading_a_forming_field_the_feed_did_not_supply_is_NOT_COMPUTABLE_by_name(store, bars):
    """⛔ PER FIELD, NAMED, AND IN ITS OWN BUCKET. `high > high[1]` needs a
    `day_high` the feed did not carry for BBB: that is "the maths had nothing to
    say", not "something broke", and the member is told WHICH input was missing."""
    bars["BBB"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    out = scan_evaluator.evaluate_one(_definition(HIGH_TREE), "D", universe=["BBB"],
                                      as_of=SESSION, mode="live", snapshot=SNAP,
                                      tick=TICK26, prev_session=PREV)
    assert out["not_computable"] == 1 and out["answered"] == 0 and out["dropped"] == 0
    assert out["dropped_symbols"] == [{"ticker": "BBB", "reason": "not-computable",
                                       "detail": "live:forming-bar:high"}]
    # the control: the same tree on a symbol whose feed DID carry day_high answers
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    out2 = scan_evaluator.evaluate_one(_definition(HIGH_TREE), "D", universe=["AAA"],
                                       as_of=SESSION, mode="live", snapshot=SNAP,
                                       tick=TICK26, prev_session=PREV)
    assert out2["answered"] == 1, "the refusal is about the FIELD, not about the tree"


def test_a_symbol_the_SANITY_OWNER_refuses_is_a_DROP_that_NAMES_the_symbol_and_the_reason(store, bars):
    """⛔ THE DROP RECORD CARRIES BOTH HALVES: the symbol `live_bars_for` was asked
    about, and `live_tier`'s OWN word for why it said no. The sweep composes
    neither — which is what makes "one sanity owner" a measured claim here and not
    only inside `live_bars_for`."""
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    snap = {"AAA": dict(QUOTE, last_price=300.0)}          # a 4x move: insane_deviation
    out = scan_evaluator.evaluate_one(_definition(PRICE_TREE), "D", universe=["AAA"],
                                      as_of=SESSION, mode="live", snapshot=snap,
                                      tick=TICK26, prev_session=PREV)
    assert out["dropped"] == 1 and out["answered"] == 0
    assert out["dropped_symbols"] == [{"ticker": "AAA", "reason": "no-live-quote",
                                       "detail": "insane_deviation"}]
    assert out["dropped_symbols"][0]["detail"] in live_tier.SKIP_REASONS


def test_a_symbol_the_FEED_never_carried_at_all_is_a_DROP_naming_the_feeds_own_word(store, bars):
    """The other half of the same shape: a symbol absent from the snapshot. The
    quote is `None`, `sanity_reason` says `no_feed`, and the drop names the symbol
    the caller asked about rather than a re-derived one."""
    bars["ZZZ"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    out = scan_evaluator.evaluate_one(_definition(PRICE_TREE), "D", universe=["ZZZ"],
                                      as_of=SESSION, mode="live", snapshot=SNAP,
                                      tick=TICK26, prev_session=PREV)
    assert out["dropped_symbols"] == [{"ticker": "ZZZ", "reason": "no-live-quote",
                                       "detail": "no_feed"}]


def test_LIVE_mode_REFUSES_a_scalar_tree_at_gate_cadence(store, bars):
    """⛔ BEFORE A BAR IS READ, AND BEFORE THE SNAPSHOT GATE. Re-reading the 03:00
    snapshot five minutes later returns the same answer while implying new
    information — the ceiling is a property of the TREE, so the refusal is too."""
    with pytest.raises(scan_evaluator.ScanRunRefused, match=r"\[gate:cadence\]"):
        scan_evaluator.evaluate_one(_definition(SCALAR_TREE), "D", universe=["AAA"],
                                    as_of=SESSION, mode="live", snapshot=SNAP,
                                    tick=TICK26, prev_session=PREV)


def test_LIVE_mode_REFUSES_a_MISSING_TICK_rather_than_inventing_one(store, bars):
    """The live row's `as_of` IS the tick. A run that guessed it would file a
    forming-bar answer under an instant nobody measured."""
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    with pytest.raises(ValueError, match="tick"):
        scan_evaluator.evaluate_one(_definition(PRICE_TREE), "D", universe=["AAA"],
                                    as_of=SESSION, mode="live", snapshot=SNAP,
                                    prev_session=PREV)


def test_ON_DEMAND_mode_writes_NOTHING_anywhere_and_returns_the_values(store, bars):
    """The third mode, unchanged by this lane — and now proved against ALL FOUR
    tables rather than the two the nightly path writes."""
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))

    def _dump():
        with contextlib.closing(sqlite3.connect(str(store))) as c:
            return {t: c.execute(f"SELECT * FROM {t}").fetchall()
                    for t in ("scan_hits", "scan_coverage",
                              scan_store.LIVE_HITS_TABLE, scan_store.LIVE_CYCLES_TABLE)}

    before = _dump()
    out = scan_evaluator.evaluate_one(_definition(PRICE_TREE), "D", universe=["AAA"],
                                      as_of=PREV, mode="on-demand")
    assert out["hit_rows"][0]["symbol"] == "AAA" and out["recorded"] == 0
    assert _dump() == before


def test_NIGHTLY_mode_is_the_DEFAULT_and_its_receipt_is_unchanged(store, bars):
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    out = scan_evaluator.evaluate_one(_definition(PRICE_TREE), "D", universe=["AAA"], as_of=PREV)
    assert out["mode"] == "nightly" and out["hits"] == ["AAA"]
    assert out["hit_rows"] == [{"symbol": "AAA", "value": 1.0, "bar_time": PREV}], (
        "the nightly row is BYTE-IDENTICAL — the two live keys are the live row's")
    assert scan_store.coverage(out["def_hash"], "D", PREV) is not None
    assert scan_store.live_hits(out["def_hash"], "D") == [], "the nightly path is not a live writer"


# ═══ 9. the AST rail EXTENDED to the EVALUATOR ═══════════════════════════════
#
# ⛔ W4b.1's rail read ONE file (`scan_store`) and said so in its own name. This is
# the system-level half the controller made a condition of wiring `mode='live'` at
# all: NO FUNCTION REACHABLE UNDER `mode == 'live'` CALLS A NIGHTLY WRITER. The
# offender set is DERIVED from the two owning modules' TABLE CONSTANTS — never
# from the substring "record" or "nightly" in a name.

def _nightly_writers() -> set:
    """`{module.function}` for every function that WRITES a CLOSED-BAR table.

    Two owners, each derived from its OWN declaration: `scan_store` writes
    `scan_hits`/`scan_coverage`/`screener_rows` (section 4's probe, reused), and
    `definition_record` writes the forward rule record under its `TABLE_NAME`.
    ⛔ A writer renamed tomorrow is still in this set; a READ-ONLY function called
    `record_anything` never is.
    """
    from api.services import definition_record
    out = set()
    src = pathlib.Path(scan_store.__file__).read_text(encoding="utf-8")
    for name, w in _writes_by_function(src).items():
        if w.tables & set(NIGHTLY_TABLES):
            out.add(f"scan_store.{name}")
    rec = pathlib.Path(definition_record.__file__).read_text(encoding="utf-8")
    for name, w in _writes_by_function(
            rec, constants={"TABLE_NAME": definition_record.TABLE_NAME},
            tables=(definition_record.TABLE_NAME,)).items():
        if w.tables:
            out.add(f"definition_record.{name}")
    return out


def test_the_NIGHTLY_WRITER_SET_is_derived_and_is_not_EMPTY():
    """A rail whose offender set is empty can never fire. This is the floor under
    the two walks below — and it names what the derivation found, so a writer that
    stops being seen is visible here rather than as a silently-green rail."""
    writers = _nightly_writers()
    assert {"scan_store.record_hits", "scan_store.record_coverage"} <= writers, sorted(writers)
    assert any(w.startswith("definition_record.") for w in writers), sorted(writers)
    assert not any(w.endswith(".upsert_live_hits") or w.endswith(".record_live_cycle")
                   for w in writers), "a LIVE writer landed in the nightly set"


#: `mode`'s three words, read off the evaluator so a fourth mode moves this with
#: no edit here.
_MODE_VALUES = {"NIGHTLY": scan_evaluator.NIGHTLY, "LIVE": scan_evaluator.LIVE,
                "ON_DEMAND": scan_evaluator.ON_DEMAND}


def _mode_const(node):
    """The mode word this AST node denotes, or `None` if it denotes no mode."""
    if isinstance(node, pyast.Constant) and isinstance(node.value, str):
        return node.value if node.value in _MODE_VALUES.values() else None
    if isinstance(node, pyast.Name):
        return _MODE_VALUES.get(node.id)
    return None


def _mode_truth(test, mode):
    """`True`/`False` when `mode == <word>` alone decides this test, else `None`.

    ⛔ THE ONLY FACT ASSUMED IS THE MODE. Anything else — a runtime value, a call,
    a name this probe cannot resolve — is UNKNOWN, and an unknown branch is walked
    on BOTH sides. A pruner may only ever narrow what it is certain of: one that
    guessed would make the rail pass on a branch it never read.
    """
    if isinstance(test, pyast.BoolOp):
        vals = [_mode_truth(v, mode) for v in test.values]
        if isinstance(test.op, pyast.And):
            return False if False in vals else (True if all(v is True for v in vals) else None)
        return True if True in vals else (False if all(v is False for v in vals) else None)
    if isinstance(test, pyast.UnaryOp) and isinstance(test.op, pyast.Not):
        inner = _mode_truth(test.operand, mode)
        return None if inner is None else (not inner)
    if not (isinstance(test, pyast.Compare) and isinstance(test.left, pyast.Name)
            and test.left.id == "mode" and len(test.ops) == 1):
        return None
    word = _mode_const(test.comparators[0])
    if word is None:
        return None
    if isinstance(test.ops[0], (pyast.Eq, pyast.Is)):
        return mode == word
    if isinstance(test.ops[0], (pyast.NotEq, pyast.IsNot)):
        return mode != word
    return None


def _mode_kwarg(call):
    for kw in call.keywords:
        if kw.arg == "mode":
            return _mode_const(kw.value)
    return None


def _dotted_call(func):
    parts = []
    while isinstance(func, pyast.Attribute):
        parts.append(func.attr)
        func = func.value
    if isinstance(func, pyast.Name):
        parts.append(func.id)
        return ".".join(reversed(parts))
    return None


def _live_call_graph(source: str, mode: str) -> tuple:
    """`(calls, mode_calls, takes_mode, entries)` for one module, with every branch
    this mode statically excludes PRUNED AWAY.

    ⚠️ A nested `def` is folded into its enclosing top-level function: the live
    cycle reaches `evaluate_one` through a closure, and a walk that stopped at the
    closure boundary would report an empty live path — a rail passing on blindness.
    """
    tree = pyast.parse(source)
    tops = [n for n in tree.body if isinstance(n, (pyast.FunctionDef, pyast.AsyncFunctionDef))]
    calls, mode_calls, takes, entries = {}, {}, {}, set()

    def _walk(node, owner, pruned):
        if isinstance(node, pyast.If):
            truth = _mode_truth(node.test, mode)
            _walk(node.test, owner, pruned)
            _each(node.body, owner, pruned or truth is False)
            _each(node.orelse, owner, pruned or truth is True)
            return
        if isinstance(node, pyast.Call):
            dotted = _dotted_call(node.func)
            if dotted and not pruned:
                calls[owner].add(dotted)
                word = _mode_kwarg(node)
                if word:
                    mode_calls[owner].add((dotted, word))
        _each(list(pyast.iter_child_nodes(node)), owner, pruned)

    def _each(nodes, owner, pruned):
        for n in nodes or []:
            if n is not None:
                _walk(n, owner, pruned)

    for fn in tops:
        calls[fn.name] = set()
        mode_calls[fn.name] = set()
        takes[fn.name] = "mode" in {a.arg for a in list(fn.args.args) + list(fn.args.kwonlyargs)}
        _each(fn.body, fn.name, False)
        # ⭐ THE ENTRY SET IS DERIVED, NEVER A NAME LIST: a function that BRANCHES
        # on this mode's word, or that PASSES it to something, is on its path.
        for node in pyast.walk(fn):
            if isinstance(node, pyast.Compare) and _mode_truth(node, mode) is True:
                entries.add(fn.name)
            if isinstance(node, pyast.Call) and _mode_kwarg(node) == mode:
                entries.add(fn.name)
    return calls, mode_calls, takes, entries


def _reachable_under(source: str, mode: str) -> set:
    """Every dotted call reachable from THIS mode's own entry points."""
    calls, mode_calls, takes, entries = _live_call_graph(source, mode)
    assert entries, f"nothing in the module branches on mode={mode!r} — the probe is blind"
    seen, stack, out = set(), sorted(entries), set()
    while stack:
        fn = stack.pop()
        if fn in seen:
            continue
        seen.add(fn)
        for dotted in calls.get(fn, ()):
            out.add(dotted)
            if dotted not in calls:                          # not a module-local function
                continue
            # ⛔ A CALL INTO A `mode`-TAKING FUNCTION REACHES ITS BODY UNDER THIS
            # MODE ONLY WHEN THE CALL SAYS SO. `run_sweep`'s nightly loop calls
            # `evaluate_one` with no `mode=` — that is the DEFAULT path, not this one.
            if takes.get(dotted) and (dotted, mode) not in mode_calls.get(fn, ()):
                continue
            stack.append(dotted)
    return out


def test_NO_function_reachable_under_mode_LIVE_calls_a_NIGHTLY_WRITER():
    """🔴 THE CONTROLLER'S CONDITION FOR WIRING `mode='live'` AT ALL.

    ⭐ Scope, exactly: `scan_evaluator`'s own AST, walked from the functions that
    branch on the live word, with every branch the live mode never takes pruned
    away, transitively through module-local helpers and closures.
    """
    src = pathlib.Path(scan_evaluator.__file__).read_text(encoding="utf-8")
    reachable = _reachable_under(src, scan_evaluator.LIVE)
    offenders = reachable & _nightly_writers()
    assert offenders == set(), (
        f"reachable under mode='live': {sorted(offenders)} — a forming-bar answer "
        "filed into a closed-bar table is a second authority over what this "
        "session's screen said")
    # ⛔ AND THE WALK REALLY REACHED THE LIVE WRITE. A rail that reached nothing
    # would pass for the wrong reason.
    assert {"scan_store.upsert_live_hits", "scan_store.note_demand"} <= reachable, sorted(reachable)


def test_the_NIGHTLY_walk_of_the_SAME_probe_DOES_see_the_nightly_writers():
    """The pruner's own control. If `_mode_truth` were broken in the direction that
    prunes everything, the rail above would pass on an empty walk — so the SAME
    probe is run with `mode='nightly'` and must find exactly what live must not."""
    src = pathlib.Path(scan_evaluator.__file__).read_text(encoding="utf-8")
    reachable = _reachable_under(src, scan_evaluator.NIGHTLY)
    assert {"scan_store.record_hits", "scan_store.record_coverage"} <= reachable
    assert "scan_store.upsert_live_hits" not in reachable, (
        "the nightly path writes a LIVE table — the split runs both ways")


def _plant_in_mode_branch(source: str, mode: str, statement: str) -> str:
    """The REAL module, with `statement` planted inside the first branch of
    `evaluate_one` that tests this mode's word.

    ⛔ AST SURGERY ON THE SHIPPED SOURCE, NOT A HAND-WRITTEN FAKE: a planted
    fixture would only prove the probe can read a fixture.
    """
    tree = pyast.parse(source)
    fn = next(n for n in pyast.walk(tree)
              if isinstance(n, pyast.FunctionDef) and n.name == "evaluate_one")
    for node in pyast.walk(fn):
        if not isinstance(node, pyast.If) or _mode_truth(node.test, mode) is False:
            continue
        if any(isinstance(c, pyast.Compare) and _mode_truth(c, mode) is True
               for c in pyast.walk(node.test)):
            node.body.insert(0, pyast.parse(statement).body[0])
            return pyast.unparse(tree)
    raise AssertionError(f"no branch testing mode == {mode!r} found in evaluate_one")


def test_PLANTING_a_nightly_writer_INSIDE_the_live_branch_REDS_this_rail():
    """⛔ THE VACUITY CONTROL. A rail nobody has watched fire is not a rail."""
    src = pathlib.Path(scan_evaluator.__file__).read_text(encoding="utf-8")
    planted = _plant_in_mode_branch(src, scan_evaluator.LIVE, "scan_store.record_coverage(1, 2, 3)")
    assert _reachable_under(planted, scan_evaluator.LIVE) & _nightly_writers() == {
        "scan_store.record_coverage"}


def test_and_the_SAME_call_planted_in_the_NIGHTLY_branch_is_INVISIBLE_to_the_live_walk():
    """The second half of the same control: the pruning is REAL. The identical
    statement, one branch over, is invisible to the live walk — otherwise the rail
    above would be reporting every line in the file and could never go green."""
    src = pathlib.Path(scan_evaluator.__file__).read_text(encoding="utf-8")
    planted = _plant_in_mode_branch(src, scan_evaluator.NIGHTLY,
                                    "scan_store.record_coverage(1, 2, 3)")
    assert "scan_store.record_coverage" not in _reachable_under(planted, scan_evaluator.LIVE)
    assert "scan_store.record_coverage" in _reachable_under(planted, scan_evaluator.NIGHTLY)


def test_the_MODES_are_ONE_closed_tuple_and_the_three_names_are_UNPACKED_from_it():
    """`NIGHTLY`/`LIVE`/`ON_DEMAND` are that tuple's members, not three literals
    typed beside it — and `EVALUATE_MODES` (W4a's name) is the SAME OBJECT, not a
    second spelling of the same three words."""
    assert scan_evaluator.MODES == ("nightly", "live", "on-demand")
    assert (scan_evaluator.NIGHTLY, scan_evaluator.LIVE,
            scan_evaluator.ON_DEMAND) == scan_evaluator.MODES
    assert scan_evaluator.EVALUATE_MODES is scan_evaluator.MODES


# ═══ 10. the clock in a scan: the tf the evaluator already holds, THREADED ════

#: `isdaily && (close > 0)` — `&&` PROPAGATES a NaN where a comparison EATS it, so
#: an unthreaded clock reads here as `not_computable` rather than as a confident 0.
CLOCK_TREE = _op("&&", _series("isdaily"), _op(">", _series("close"), _num(0)))


def test_a_scan_naming_a_CLOCK_value_EVALUATES_because_the_tf_is_THREADED(store, bars):
    """⭐ W2a.2 landed the clock and threaded the tf through the CHART path; the
    scan's `interpret` call was the matching hand-back. Without it, every clock
    name in every saved scan is permanently `not_computable`."""
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    out = scan_evaluator.evaluate_one(_definition(CLOCK_TREE), "D", universe=["AAA"], as_of=PREV)
    assert out["answered"] == 1 and out["not_computable"] == 0
    assert out["hits"] == ["AAA"], "isdaily is 1 on a D scan — the tf is what says so"


def test_and_WITHOUT_a_tf_the_SAME_tree_FAILS_CLOSED_never_a_guessed_default():
    """⛔ THE FAIL-CLOSED HALF, AT THE INTERPRETER. An absent tf is "nobody told
    me" and stays `None`; it is never a guessed `"D"`, which would make `isdaily` a
    confident 1 on a five-minute chart. This is why the two threading hand-backs
    were safe to land separately from the table."""
    from api.services import ast_interpret
    rows = _bars(30, end=datetime.date(2026, 8, 25))
    assert ast_interpret.interpret(CLOCK_TREE, rows)[-1] is None
    assert ast_interpret.interpret(CLOCK_TREE, rows, opts={"tf": "D"})[-1] == 1.0
    assert ast_interpret.interpret(CLOCK_TREE, rows, opts={"tf": "5"})[-1] == 0.0


def test_the_tf_the_scan_hands_the_clock_is_the_STORES_OWN_CODE_and_the_two_AGREE():
    """⛔ ONE VOCABULARY. The evaluator normalises `tf` through `scan_store` and
    hands THAT code to the clock, so the two declared code sets must be the same
    set. If they ever diverge the clock fails closed — a code it does not know is
    "nobody told me" — which is the safe direction, and this says so out loud."""
    from api.services import indicator_compute
    assert set(scan_store._TF_CODES) == set(indicator_compute.CLOCK_TIMEFRAMES)
    fn = _function_node("evaluate_one")
    calls = [n for n in pyast.walk(fn) if isinstance(n, pyast.Call)
             and getattr(n.func, "attr", None) == "interpret"]
    assert len(calls) == 1, f"{len(calls)} interpret calls in evaluate_one"
    opts = {k.arg: k.value for k in calls[0].keywords}.get("opts")
    assert isinstance(opts, pyast.Dict), "the interpret call passes no `opts` — the clock is dark"
    assert [k.value for k in opts.keys] == ["tf"]
    assert isinstance(opts.values[0], pyast.Name) and opts.values[0].id == "tf_code", (
        "the tf handed to the clock is not the NORMALISED code the store owns")

# ═══ 11. the live cycle's rails: the window, the budget, the flag ════════════
#
# ⛔ EVERY NUMBER HERE IS DERIVED OR MEASURED, AND THE ONE THAT IS TYPED SAYS WHAT
# IT MEASURES. The session OPEN comes off the bars store's own anchor; the CLOSE is
# the open plus a declared session LENGTH; the budget is the interval minus ONE
# worst-case definition.


def _at(y, m, d, hh, mm):
    return datetime.datetime(y, m, d, hh, mm, tzinfo=scan_evaluator._ET)


@pytest.mark.parametrize("when, state", [
    (_at(2026, 8, 26, 9, 29), "closed"),          # one minute before the open
    (_at(2026, 8, 26, 9, 30), None),              # the open itself: INSIDE
    (_at(2026, 8, 26, 15, 59), None),             # one minute before the close
    (_at(2026, 8, 26, 16, 0), "closed"),          # the close itself: OUTSIDE
    (_at(2026, 8, 29, 11, 0), "closed"),          # a Saturday
    (_at(2026, 9, 7, 11, 0), "closed"),           # Labor Day
])
def test_the_live_window_is_the_REGULAR_SESSION_derived_from_the_bars_stores_open(when, state):
    """⛔ HALF-OPEN AT BOTH ENDS: `open <= t < close`. A cycle that fired AT the
    close would read a forming bar the exchange has already settled."""
    assert scan_evaluator._live_session_state(when) == state


def test_the_live_window_AGREES_with_bars_fetch_is_market_open_at_BOTH_boundaries(monkeypatch):
    """⭐ THE THIRD COPY PROBLEM, MEASURED INSTEAD OF ASSERTED. `massive._detect_session`
    and `bars_fetch._is_market_open` both TYPE 16:00; this module derives the open
    and adds a declared session LENGTH. They are not called from here because each
    reads its OWN clock — so this drives the other one's clock to the same four
    instants and demands the same answer."""
    from api.services import bars_fetch
    for when in (_at(2026, 8, 26, 9, 29), _at(2026, 8, 26, 9, 30),
                 _at(2026, 8, 26, 15, 59), _at(2026, 8, 26, 16, 0)):
        class _Frozen(datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return when.astimezone(tz) if tz else when.replace(tzinfo=None)
        monkeypatch.setattr(bars_fetch, "datetime", _Frozen)
        assert (scan_evaluator._live_session_state(when) is None) == bars_fetch._is_market_open(), when


def test_the_BUDGET_is_the_interval_MINUS_ONE_worst_case_definition_and_it_is_POSITIVE(monkeypatch):
    """🔴 THE SAME ARGUMENT AS THE NIGHTLY DEADLINE, ONE GRAIN SMALLER. The check is
    between definitions, so a cycle can overrun by at most ONE definition — and the
    number that bounds it is the MEASURED worst case, not a round one."""
    monkeypatch.delenv("SCAN_LIVE_INTERVAL_S", raising=False)
    assert scan_evaluator.live_interval_s() == 300
    assert scan_evaluator._live_cycle_budget_s() == 300 - scan_evaluator.LIVE_DEFINITION_WORST_CASE_S
    assert scan_evaluator._live_cycle_budget_s() > 0
    assert scan_evaluator.LIVE_DEFINITION_WORST_CASE_S >= 42.4 * 1.2, (
        "the margin no longer covers the measured worst case (42.4 s of compute for "
        "one definition over 3,742 symbols on this box, contended)")


def test_the_live_row_OUTLIVES_the_next_cycle_or_the_overlay_would_go_DARK_between_ticks(monkeypatch):
    """⛔ TWO MODULES, ONE CONSTRAINT, AND IT IS ASSERTED RATHER THAN REMEMBERED.
    `scan_store.live_max_age_s()` decides when a live row is served as nightly; this
    module decides how often a new one is written. If the age ever fell below one
    interval, every row would die before its replacement arrived and the overlay
    would flicker off with nothing red anywhere."""
    monkeypatch.delenv("SCAN_LIVE_INTERVAL_S", raising=False)
    monkeypatch.delenv("SCAN_LIVE_MAX_AGE_S", raising=False)
    assert scan_store.live_max_age_s() >= 2 * scan_evaluator.live_interval_s()


@pytest.mark.parametrize("raw, seconds", [
    (None, 300), ("", 300), ("60", 60), ("600", 600),
    ("5", 30),                       # floored: a 5 s cadence is a self-inflicted outage
    ("banana", 300),                 # unparseable falls back, never crashes the job
])
def test_the_interval_is_read_from_the_env_with_a_FLOOR_and_a_fallback(monkeypatch, raw, seconds):
    if raw is None:
        monkeypatch.delenv("SCAN_LIVE_INTERVAL_S", raising=False)
    else:
        monkeypatch.setenv("SCAN_LIVE_INTERVAL_S", raw)
    assert scan_evaluator.live_interval_s() == seconds


def test_the_FLAG_is_OFF_by_default_and_read_PER_CALL(monkeypatch):
    """⭐ THE LIVE TIER'S IDIOM: rollback is UNSETTING AN ENV VAR, and the next tick
    answers `disabled`. Read per call, never captured at import, or a rollback would
    need a deploy."""
    monkeypatch.delenv("SCAN_LIVE_SWEEP_ENABLED", raising=False)
    assert scan_evaluator.live_enabled() is False
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    assert scan_evaluator.live_enabled() is True
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "0")
    assert scan_evaluator.live_enabled() is False


def test_the_flag_is_NOT_captured_at_import__BY_AST():
    """The structural half: `live_enabled` reads `os.environ` in its own body. A
    module-level capture would make the two behavioural cases above pass on the
    import order of the test session rather than on the code."""
    fn = _function_node("live_enabled")
    reads = [n for n in pyast.walk(fn) if isinstance(n, pyast.Call)
             and getattr(n.func, "attr", None) == "get"
             and pyast.unparse(n.func.value).endswith("environ")]
    assert len(reads) == 1, "live_enabled does not read os.environ in its own body"


def test_the_LIVE_SKIP_REASONS_are_a_CLOSED_set_a_caller_can_branch_on():
    """Every word a cycle can answer `skipped_reason` with, declared once. ⚠️ pinned
    by MEMBERSHIP, never by length — a seventh reason is a ruling, not a red."""
    for word in ("disabled", "closed", "build_in_flight", "no-definitions",
                 "no-universe", "budget", "failed"):
        assert word in scan_evaluator.LIVE_SKIP_REASONS, word
    # ⛔ THE WARNING SET IS A SUBSET OF IT, railed rather than trusted: a warning
    # word that is not a skip reason is a warning nothing can ever emit.
    assert set(scan_evaluator.LIVE_WARNING_REASONS) <= set(scan_evaluator.LIVE_SKIP_REASONS)
    assert scan_evaluator.LIVE_UNSWEPT_REASON == "budget:live-interval"
    assert scan_evaluator.LIVE_UNSWEPT_REASON != scan_evaluator.UNSWEPT_REASON, (
        "the live budget and the nightly market-open budget are DIFFERENT facts "
        "fixed by DIFFERENT actions — one word for both would hide which one fired")


def test_the_SESSION_LENGTH_is_declared_ONCE_and_the_close_is_DERIVED_from_the_open():
    """⛔ 16:00 IS NOT TYPED HERE. The open comes off `market_open_et` (the bars
    store's own anchor) and the close is that plus `REGULAR_SESSION_LENGTH`, so an
    exchange-hours change moves both with no edit in this file."""
    assert scan_evaluator.REGULAR_SESSION_LENGTH == datetime.timedelta(hours=6, minutes=30)
    day = datetime.date(2026, 8, 26)
    opened = scan_evaluator.market_open_et(day)
    assert opened.hour == 9 and opened.minute == 30
    closes = opened + scan_evaluator.REGULAR_SESSION_LENGTH
    assert (closes.hour, closes.minute) == (16, 0)
    src = pathlib.Path(scan_evaluator.__file__).read_text(encoding="utf-8")
    fn = _function_node("_live_session_state")
    literals = {n.value for n in pyast.walk(fn)
                if isinstance(n, pyast.Constant) and isinstance(n.value, int)}
    assert not ({16, 1600, 930, 9} & literals), (
        f"_live_session_state types a session boundary ({sorted(literals)}) — it "
        "must derive both ends")
    assert src.count("REGULAR_SESSION_LENGTH = ") == 1

# ═══ 12. the CYCLE: run_sweep(mode='live') behind its rails ══════════════════

#: 10:42 ET on SESSION — inside the regular session, so the window gate is open
#: and every test below is measuring the rail it names rather than the clock.
CYCLE_AT = _at(2026, 8, 26, 10, 42)


@pytest.fixture
def live_clock(monkeypatch):
    """⏰ ONE CLOCK, FROZEN. `scan_evaluator._now_et` is the module's only clock
    read (`test_the_module_reads_ONE_clock`), which is what makes freezing it here
    honest rather than half-faked."""
    monkeypatch.setattr(scan_evaluator, "_now_et", lambda: CYCLE_AT)
    return CYCLE_AT


@pytest.fixture
def feed(monkeypatch):
    """The shared 30 s market snapshot, stubbed at its accessor — the live tier's
    `_feed` idiom. ⛔ NOT at `massive`: the sweep's contract is that it reads the
    SHARED accessor and nothing else, and stubbing lower would let a direct
    provider call slip through unnoticed."""
    from api.services import scan_volume
    calls = []
    monkeypatch.setattr(scan_volume, "full_market_snapshot",
                        lambda: (calls.append(1), dict(SNAP))[1])
    return calls


def _defs():
    """Two DISTINCT bars-only definitions. `close < 0` answers for every symbol
    and hits none of them, which is what makes it a clean second definition."""
    return (_definition(PRICE_TREE, def_id="u_00000000000a"),
            _definition(_op("<", _series("close"), _num(0)), def_id="u_00000000000b"))


def _hash(definition):
    return scan_definition.assert_scannable(definition)["def_hash"]


def test_a_LIVE_cycle_writes_live_hits_a_receipt_row_and_the_receipt_CLOSES(
        store, bars, live_clock, feed, monkeypatch):
    """🔴 THE CYCLE'S OWN ARITHMETIC, ASSERTED BY THE FUNCTION AND AGAIN HERE:
    `definitions == swept + refused + duplicate + unswept`. Without it a cycle that
    dropped definitions on the floor would look exactly like a cycle with fewer to
    do."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    live, scalar = _definition(PRICE_TREE), _definition(SCALAR_TREE, def_id="u_00000000000b")

    r = scan_evaluator.run_sweep([live, scalar], "D", universe=["AAA"], mode="live")

    assert r["skipped_reason"] is None and r["session"] == SESSION and r["tf"] == "D"
    assert r["definitions"] == 2 and r["swept"] == 1 and r["refused"] == 1
    assert r["refusals"][0]["gate"] == "cadence", r["refusals"]
    assert r["refusals"][0]["def_hash"] == _hash(scalar)
    assert r["evaluated"] == 1 and r["answered"] == 1 and r["hits"] == 1
    assert r["definitions"] == r["swept"] + r["refused"] + r["duplicate"] + r["unswept"]
    assert set(r) >= {"cycle_started", "cycle_seconds", "definitions", "evaluated",
                      "answered", "skipped_reason"}
    cyc = scan_store.last_live_cycle("D")
    assert cyc["swept"] == [_hash(live)]
    assert cyc["receipt"]["answered"] == 1
    assert scan_store.live_hits(cyc["swept"][0], "D")[0]["as_of"] == r["tick"]


def test_run_sweep_REFUSES_the_on_demand_mode_by_NAME_rather_than_sweeping(store):
    """⛔ SELF-REVIEW: `run_sweep` now takes `mode`, and `MODES` has THREE words —
    so a gate that cannot fire is not a gate. `'on-demand'` is a property of ONE
    definition's run, not of a sweep: a sweep that wrote nothing would leave no
    receipt for anyone to read, and silently behaving as `nightly` would file a
    member's list under the universe's key. The refusal NAMES the door to use."""
    with pytest.raises(ValueError, match="evaluate_one"):
        scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=["AAA"],
                                 mode="on-demand")
    with pytest.raises(ValueError, match="persist"):
        scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=["AAA"],
                                 mode="persist")
    assert set(scan_evaluator.MODES) == {"nightly", "live", "on-demand"}, (
        "a fourth mode arrived and run_sweep's dispatch has not ruled on it")


def test_the_cadence_refusal_happens_in_PHASE_ONE_before_any_bar_is_read(
        store, bars, live_clock, feed, monkeypatch):
    """⭐ 1.9 µs a tree, before the loop. A nightly-ceiling definition never
    reaches `evaluate_one` in a cycle — but `evaluate_one` refuses it the same way
    for a direct caller, so the two doors give one answer."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars",
                        lambda *a, **k: pytest.fail("a bar was read for a refused definition"))
    r = scan_evaluator.run_sweep([_definition(SCALAR_TREE)], "D", universe=["AAA"], mode="live")
    assert r["refused"] == 1 and r["swept"] == 0 and r["evaluated"] == 0


def test_the_flag_OFF_answers_disabled_and_TOUCHES_NO_STORE(
        store, bars, live_clock, feed, monkeypatch):
    """⛔ A DARK CYCLE WRITES NOTHING AT ALL — not even its own receipt. A receipt
    row per five minutes for a feature nobody turned on is a table filling with the
    word 'disabled'."""
    monkeypatch.delenv("SCAN_LIVE_SWEEP_ENABLED", raising=False)
    r = scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=["AAA"], mode="live")
    assert r["skipped_reason"] == "disabled" and r["definitions"] == 1
    assert scan_store.last_live_cycle("D") is None
    assert feed == [], "a disabled cycle read the market"


def test_OUTSIDE_the_session_the_cycle_answers_closed_AND_RECORDS_that(
        store, bars, feed, monkeypatch):
    """⚠️ `closed` IS RECORDED WHERE `disabled` IS NOT, and the difference is the
    question each answers. "The flag is off" is knowable from the env; "the last
    cycle ran and the market was shut" is only knowable from the artifact, and a
    status surface that could not tell that from "nothing has run since the deploy"
    would report a dead scheduler as a quiet evening."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    monkeypatch.setattr(scan_evaluator, "_now_et", lambda: _at(2026, 8, 26, 16, 5))
    r = scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=["AAA"], mode="live")
    assert r["skipped_reason"] == "closed"
    assert scan_store.last_live_cycle("D")["receipt"]["skipped_reason"] == "closed"
    assert feed == [], "the market was read outside the session"


def test_a_tf_other_than_D_is_REFUSED_BY_NAME_in_wave_1(store, live_clock, monkeypatch):
    """Wave 1 is daily-only: intraday timeframes arrive with the prewarm ring's
    MEASURED coverage (spec §5.5), not before it."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    with pytest.raises(scan_evaluator.ScanRunRefused, match=r"\[gate:tf\]"):
        scan_evaluator.run_sweep([_definition(PRICE_TREE)], "W", universe=["AAA"], mode="live")


def test_the_WALL_CLOCK_RAIL_stops_STARTING_definitions_past_the_budget_and_NAMES_them(
        store, bars, feed, monkeypatch):
    """🔴 CHECKED BETWEEN DEFINITIONS, NEVER INSIDE ONE. A mid-definition abort
    would leave a live set describing a partial universe as a complete one.

    ⏰ THE TICK LIST IS EXACTLY AS LONG AS THE READS THIS CYCLE IS ENTITLED TO:
    `started`, one `_stop()` before each of the two definitions, and one in
    `_finish_live`. A fifth read is a StopIteration here, on purpose — the module's
    one-clock property is what makes that a rail rather than a trap.
    """
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    ticks = iter([CYCLE_AT,                       # started
                  CYCLE_AT,                       # _stop() before the first
                  _at(2026, 8, 26, 10, 47),       # _stop() before the second: BLOWN
                  _at(2026, 8, 26, 10, 47)])      # _finish_live
    monkeypatch.setattr(scan_evaluator, "_now_et", lambda: next(ticks))
    first, second = _defs()
    r = scan_evaluator.run_sweep([first, second], "D", universe=["AAA"], mode="live")
    assert r["swept"] == 1 and r["unswept"] == 1 and r["skipped_reason"] == "budget"
    assert r["unswept_definitions"] == [_hash(second)]
    assert r["unswept_reason"] == scan_evaluator.LIVE_UNSWEPT_REASON


def test_the_budget_CONTROL_a_normal_cycle_reaches_EVERYONE(
        store, bars, live_clock, feed, monkeypatch):
    """The control the budget test needs: with the clock standing still the same
    two definitions are both swept, so the test above is measuring the CLOCK and
    not some other failure."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    r = scan_evaluator.run_sweep(list(_defs()), "D", universe=["AAA"], mode="live")
    assert r["swept"] == 2 and r["unswept"] == 0 and r["skipped_reason"] is None


def test_FAIRNESS_the_definition_the_LAST_cycle_never_reached_LEADS_this_one(
        store, bars, live_clock, feed, monkeypatch):
    """🔴 A BUDGET THAT ALWAYS CUTS AT THE SAME POINT STARVES THE SAME DEFINITIONS
    FOREVER, and each cycle's receipt would look like a healthy partial.

    ⭐ THE RESUME POINT IS THE ARTIFACT — the LAST CYCLE'S OWN `swept` LIST, not a
    cursor and not a coverage row. The nightly sweep reads `scan_coverage` for the
    PREVIOUS SESSION; a five-minute cycle has no such session-grained receipt, so
    it reads the thing it does write.
    """
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    a, b = _defs()
    ha, hb = _hash(a), _hash(b)
    scan_store.record_live_cycle({"cycle_started": TICK26 - 300, "tf": "D"}, [ha])
    order = []
    real = scan_evaluator.evaluate_one
    monkeypatch.setattr(scan_evaluator, "evaluate_one",
                        lambda d, *args, **kw: (order.append(d["id"]), real(d, *args, **kw))[1])
    scan_evaluator.run_sweep([a, b], "D", universe=["AAA"], mode="live")
    assert order == ["u_00000000000b", "u_00000000000a"], (
        "the definition the last cycle never reached must lead this one")
    # the control: with NO previous cycle the caller's order survives untouched
    order.clear()
    scan_evaluator.run_sweep([a, b], "D", universe=["AAA"], mode="live")
    assert order == ["u_00000000000a", "u_00000000000b"], (
        "the last cycle reached BOTH, so this one is the identity — a sort that "
        "reordered anyway would be shuffling, not fairness")


def test_a_BUILD_IN_FLIGHT_stops_the_cycle_between_definitions_WITHOUT_taking_the_lock(
        store, bars, live_clock, feed, monkeypatch):
    """⛔ THE CYCLE NEVER HOLDS `_BUILD_LOCK`. A four-minute hold would starve the
    live tier's own 60 s cadence, which refuses on `build_in_flight`. So this
    PROBES it (`build_in_flight()` is the read-only accessor) between definitions
    and stops."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    assert snapshot_builder._BUILD_LOCK.acquire(blocking=False)
    try:
        r = scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=["AAA"], mode="live")
    finally:
        snapshot_builder._BUILD_LOCK.release()
    assert r["skipped_reason"] == "build_in_flight" and r["swept"] == 0 and r["unswept"] == 1
    assert r["unswept_reason"] is None, "this is not the BUDGET — a different fact, a different fix"


def _build_lock_touches(source: str) -> set:
    """Every place this source REACHES the builder's lock, by AST.

    ⛔ AN AST, NEVER A SUBSTRING. `"_BUILD_LOCK" in src` reads the COMMENT that
    explains why the lock is not taken as though it were the taking, so the
    honest-prose version of this module and the offending version are the same
    string to it — a probe that cannot tell an explanation from a call.
    """
    tree = pyast.parse(source)
    return {pyast.unparse(n) for n in pyast.walk(tree)
            if (isinstance(n, pyast.Attribute) and n.attr == "_BUILD_LOCK")
            or (isinstance(n, pyast.Name) and n.id == "_BUILD_LOCK")}


def test_the_cycle_TAKES_no_build_lock__BY_AST():
    """The structural half of the test above: presence of `build_in_flight` is not
    absence of `_BUILD_LOCK`. Nothing in this module may reach the lock at all —
    it probes the read-only accessor and stops, because a four-minute hold would
    starve the live TIER's own 60 s cadence."""
    src = pathlib.Path(scan_evaluator.__file__).read_text(encoding="utf-8")
    assert _build_lock_touches(src) == set(), (
        f"the evaluator reaches for the builder's lock: {_build_lock_touches(src)}")
    # the control: the probe DOES see a taking, so the assert above is not blind
    assert _build_lock_touches(
        "def cycle():\n    with snapshot_builder._BUILD_LOCK:\n        pass\n")
    tree = pyast.parse(src)
    reads = {n.func.attr for n in pyast.walk(tree) if isinstance(n, pyast.Call)
             and isinstance(n.func, pyast.Attribute)
             and getattr(n.func.value, "id", None) == "snapshot_builder"}
    assert "build_in_flight" in reads and "run_build" not in reads, reads


def test_an_EMPTY_universe_or_NO_definitions_is_its_OWN_word_never_an_empty_sweep(
        store, bars, live_clock, feed, monkeypatch):
    """⛔ NEVER SWEEP ZERO SYMBOLS AND FILE THE RESULT: an empty hit list is
    indistinguishable from a quiet market."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    assert scan_evaluator.run_sweep([], "D", universe=["AAA"],
                                    mode="live")["skipped_reason"] == "no-definitions"
    assert scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=[],
                                    mode="live")["skipped_reason"] == "no-universe"
    for word in ("no-definitions", "no-universe"):
        assert word in scan_evaluator.LIVE_SKIP_REASONS


def test_EVERY_cycle_returns_the_SAME_KEY_SET_whatever_stopped_it(
        store, bars, live_clock, feed, monkeypatch):
    """⛔ THE LIVE TIER'S `_blank_receipt` IDIOM. A status surface that had to
    branch on which keys exist would report a missing key as a zero — and a
    disabled cycle and a swept one would disagree about what a receipt IS."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    full = scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=["AAA"], mode="live")
    monkeypatch.delenv("SCAN_LIVE_SWEEP_ENABLED", raising=False)
    dark = scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=["AAA"], mode="live")
    assert set(full) == set(dark), set(full) ^ set(dark)
    required = {"cycle_started", "cycle_seconds", "definitions", "evaluated", "answered",
                "skipped_reason", "session", "tf", "tick", "distinct", "swept", "refused",
                "duplicate", "unswept", "unswept_definitions", "hits", "dropped",
                "not_computable", "interval_s", "budget_s", "deadline", "refusals", "enabled"}
    assert required <= set(full), sorted(required - set(full))
    assert full["enabled"] is True and dark["enabled"] is False


def test_the_ONLY_market_read_is_the_SHARED_snapshot_accessor__BY_AST():
    """⛔ NO PROVIDER CALL LIVES IN THIS MODULE. The shipped probe from the live
    tier's own suite, plus the narrower statement that the only `scan_volume`
    functions reached are the shared snapshot and its symbol lookup."""
    src = pathlib.Path(scan_evaluator.__file__).read_text(encoding="utf-8")
    from tests.test_screener_live_tier import _fetcher_probe
    assert _fetcher_probe(src) == []
    tree = pyast.parse(src)
    reads = {n.func.attr for n in pyast.walk(tree) if isinstance(n, pyast.Call)
             and isinstance(n.func, pyast.Attribute)
             and getattr(n.func.value, "id", None) == "scan_volume"}
    assert reads == {"full_market_snapshot", "_snap_lookup"}, reads


def test_the_snapshot_is_read_ONCE_per_cycle_NEVER_per_definition(
        store, bars, live_clock, feed, monkeypatch):
    """⭐ ONE READ PER CYCLE. `full_market_snapshot` is ~10k names behind a 30 s
    cache; calling it per definition would make a 100-definition cycle a hundred
    trips through that door for one answer, and every definition in the cycle would
    be answering off a slightly different market."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    scan_evaluator.run_sweep(list(_defs()), "D", universe=["AAA"], mode="live")
    assert feed == [1]


def test_the_NIGHTLY_sweep_is_UNCHANGED_by_the_refactor(store, bars, clock_nightly):
    """The regression control for factoring phase 1 and the loop into helpers: the
    nightly receipt is the same shape, with the same keys, and still files coverage."""
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 7))
    a, b = _defs()
    r = scan_evaluator.run_sweep([a, b, a], "D", universe=["AAA"], as_of=20260807)
    assert r["definitions"] == 3 and r["distinct"] == 2 and r["duplicate"] == 1
    assert r["swept"] == 2 and r["unswept"] == 0 and r["stopped_early"] is False
    assert r["hits"] == 1 and r["as_of"] == 20260807
    assert scan_store.coverage(_hash(a), "D", 20260807) is not None
    assert scan_store.last_live_cycle("D") is None, "the nightly sweep wrote a live receipt"


@pytest.fixture
def clock_nightly(monkeypatch):
    """The nightly sweep's own frozen clock — its scheduled hour on the session the
    shared bars fixtures use, DERIVED from the constants rather than typed."""
    frozen = datetime.datetime(2026, 8, 7, scan_evaluator.SWEEP_HOUR_ET,
                               scan_evaluator.SWEEP_MINUTE_ET, tzinfo=scan_evaluator._ET)
    monkeypatch.setattr(scan_evaluator, "_now_et", lambda: frozen)
    return frozen


def _raises(exc):
    """A stub that raises `exc` when called with anything."""
    def _boom(*a, **k):
        raise exc
    return _boom


def test_a_cycle_that_RAISES_still_FILES_a_receipt_before_the_error_LEAVES(
        store, bars, live_clock, feed, monkeypatch):
    """🔴 THE PROPERTY `_finish_live` EXISTS FOR, HELD ON THE PATH THAT BREAKS IT.

    Every RETURN path files a receipt. The setup phase — `_load_universe`, the
    fairness read, the receipt write itself — can RAISE, and a raise that left no
    receipt would make `last_live_cycle()` read `None`: "nothing has run since the
    deploy". That is the exact reading `_finish_live`'s own comment says it
    prevents, and it is the one a status surface must never be told when a cycle
    DID run and broke. The realistic path is sqlite under lock contention on the
    single web pod, which is why the stub raises what sqlite raises.

    ⛔ AND THE ERROR IS STILL LOUD. The artifact and the loudness are not a trade:
    the receipt is filed and the exception is RE-RAISED, which `pytest.raises`
    below is what pins.
    """
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    monkeypatch.setattr(snapshot_builder, "_load_universe",
                        _raises(sqlite3.OperationalError("database is locked")))
    with pytest.raises(sqlite3.OperationalError):
        scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", mode="live")

    cyc = scan_store.last_live_cycle("D")
    assert cyc is not None, (
        "a cycle died and left NOTHING behind — a dead scheduler now reads as a "
        "quiet evening, which is the one thing the receipt exists to prevent")
    assert cyc["receipt"]["skipped_reason"] == "failed"
    assert "OperationalError" in cyc["receipt"]["failure"]
    assert "database is locked" in cyc["receipt"]["failure"]
    assert cyc["swept"] == [] and cyc["receipt"]["cycle_started"] == cyc["cycle_started"]


def test_the_FAILURE_receipt_never_MASKS_the_original_error(
        store, bars, live_clock, feed, monkeypatch):
    """⛔ IF THE STORE IS THE BROKEN THING, THE SECOND WRITE FAILS TOO — and the
    exception a caller must see is the FIRST one. A handler that let its own
    recovery raise would replace "the universe read died" with "the receipt write
    died", and the second sentence is the less useful of the two."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    monkeypatch.setattr(snapshot_builder, "_load_universe",
                        _raises(RuntimeError("the universe read died")))
    monkeypatch.setattr(scan_store, "record_live_cycle",
                        _raises(sqlite3.OperationalError("database is locked")))
    with pytest.raises(RuntimeError, match="the universe read died"):
        scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", mode="live")


def test_the_HEALTHY_cycle_carries_the_failure_slot_EMPTY(
        store, bars, live_clock, feed, monkeypatch):
    """The control for the two above: `failure` is always present and `None` when
    nothing broke. A key that only appears when something broke is a key every
    reader has to branch on — and `skipped_reason` stays the one authority over
    whether a cycle did its whole job."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    r = scan_evaluator.run_sweep([_definition(PRICE_TREE)], "D", universe=["AAA"], mode="live")
    assert r["failure"] is None and r["skipped_reason"] is None
    assert scan_store.last_live_cycle("D")["receipt"]["failure"] is None


# ═══ 13. `live_sweep_job`: the scheduler's door, and it reads the ARTIFACT ════

def test_live_sweep_job_reads_the_ARTIFACT_back_and_EXPLAINS_a_budget_shortfall(
        store, bars, live_clock, feed, monkeypatch, caplog):
    """⛔ THE RETURN VALUE IS COUNTED, NEVER TRUSTED — APScheduler discards it and
    silence reads as success. The success criterion is the RECEIPT ROW, read back
    out of the store."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    bars["AAA"] = _daily_bars(60, end=datetime.date(2026, 8, 25))
    monkeypatch.setattr(scan_evaluator, "definitions_to_sweep", lambda: [_definition(PRICE_TREE)])
    monkeypatch.setattr(snapshot_builder, "_load_universe", lambda: ["AAA"])
    with caplog.at_level("INFO"):
        scan_evaluator.live_sweep_job()
    assert any("[scan-live] receipts read back" in r.message for r in caplog.records), (
        [r.message for r in caplog.records])
    assert scan_store.last_live_cycle("D")["receipt"]["answered"] == 1


def test_a_DARK_live_job_does_not_even_READ_the_definitions(store, monkeypatch):
    """⛔ THE FLAG IS CHECKED FIRST, BEFORE `definitions_to_sweep` — that is the
    only member-shaped read in the file (it opens the definitions store), and a
    dark job doing it every five minutes is a cost nobody asked for."""
    monkeypatch.delenv("SCAN_LIVE_SWEEP_ENABLED", raising=False)
    monkeypatch.setattr(scan_evaluator, "definitions_to_sweep",
                        lambda: pytest.fail("a dark job read the definitions store"))
    scan_evaluator.live_sweep_job()


def test_the_JOB_SURVIVES_a_failing_cycle_and_the_ARTIFACT_still_answers(
        store, bars, live_clock, feed, monkeypatch, caplog):
    """⛔ THE JOB DOES NOT PROPAGATE. APScheduler's next tick is five minutes away
    either way, and a `[scan-live]` line beside a filed receipt is more use to
    whoever reads the logs than a bare traceback with no artifact. The cycle has
    already recorded `failed`, so the read-back below still answers."""
    monkeypatch.setenv("SCAN_LIVE_SWEEP_ENABLED", "1")
    monkeypatch.setattr(scan_evaluator, "definitions_to_sweep", lambda: [_definition(PRICE_TREE)])
    monkeypatch.setattr(snapshot_builder, "_load_universe",
                        _raises(RuntimeError("the universe read died")))
    with caplog.at_level("INFO"):
        scan_evaluator.live_sweep_job()          # ⛔ does NOT raise
    assert any("[scan-live] the cycle FAILED" in r.message for r in caplog.records), (
        [r.message for r in caplog.records])
    assert any("[scan-live] receipts read back" in r.message for r in caplog.records), (
        "the artifact read-back was skipped on the failure path")
    assert scan_store.last_live_cycle("D")["receipt"]["skipped_reason"] == "failed"


def test_note_demand_on_the_evaluator_DELEGATES_to_the_store(monkeypatch):
    """⭐ A THIN DELEGATE, NOT A SECOND RING. The contract names
    `scan_evaluator.note_demand`; the OWNER is `scan_store`, because the
    router-import rail forbids a route reaching this module at all."""
    seen = []
    monkeypatch.setattr(scan_store, "note_demand", lambda syms: seen.append(list(syms)))
    scan_evaluator.note_demand(["aaa"])
    assert seen == [["aaa"]]
    fn = _function_node("note_demand")
    calls = [n for n in pyast.walk(fn) if isinstance(n, pyast.Call)]
    assert len(calls) == 1 and getattr(calls[0].func, "attr", None) == "note_demand", (
        "note_demand does more than delegate — a second ring is a second answer to "
        "'what did somebody just ask about'")


# ═══ 14. the SCHEDULER: the registration that turns all of the above ON ═══════
#
# ⛔ THE RISK LIVES HERE, NOT IN THE CYCLE. This runs on the SINGLE web pod — one
# uvicorn process, one event loop, one 64-slot anyio threadpool shared by every
# member — so `max_instances=1` is a CORRECTNESS guard (overlapping cycles double
# the provider reads and race the receipt), not a tuning knob.
#
# ⛔ AND THE INSTRUMENT MUST BE ABLE TO SEE AN ABSENCE. "assert the job is in the
# list" is the classic vacuous scheduler test: it passes for a registration that
# cannot be turned off just as happily as for one that can. Every presence
# assertion below is paired with a SIBLING whose absence is asserted in the SAME
# call, so a `_FakeScheduler` that had stopped recording ids would go red.


def _main_source() -> str:
    import api.main as main_mod
    return pathlib.Path(main_mod.__file__).read_text(encoding="utf-8")


def _register_screener_jobs_node():
    for node in pyast.walk(pyast.parse(_main_source())):
        if (isinstance(node, (pyast.FunctionDef, pyast.AsyncFunctionDef))
                and node.name == "register_screener_jobs"):
            return node
    raise AssertionError("api/main.py no longer defines register_screener_jobs")


def _add_job_gate_depth() -> dict:
    """``{job id: how many `if` statements wrap its `add_job` call}``, DERIVED by
    walking `register_screener_jobs`'s own body — never a typed list of ids.

    ⚠️ The function's leading `SCREENER_SNAPSHOT_ENABLED` guard is a RETURN, not a
    wrapper, so it contributes no depth to anything after it. That master switch
    gates the whole screener job family and is a different fact from a feature's
    own flag, which is exactly what this probe is here to tell apart.
    """
    out = {}

    def _walk(body, depth):
        for stmt in body:
            if isinstance(stmt, pyast.If):
                _walk(stmt.body, depth + 1)
                _walk(stmt.orelse, depth + 1)
                continue
            for node in pyast.walk(stmt):
                if not (isinstance(node, pyast.Call)
                        and getattr(node.func, "attr", None) == "add_job"):
                    continue
                for kw in node.keywords:
                    if kw.arg == "id" and isinstance(kw.value, pyast.Constant):
                        out[kw.value.value] = depth

    _walk(_register_screener_jobs_node().body, 0)
    return out


def _register(monkeypatch, **env):
    """Register the screener job family against a fake scheduler and hand back
    ``{id: job}``. `start_screener_snapshot_warm` is stubbed because it is a boot
    warm, not part of what registration asserts."""
    import api.main as main_mod
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    for key, value in env.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)
    monkeypatch.setattr(main_mod, "start_screener_snapshot_warm", lambda: None)
    sched = _FakeScheduler()
    assert main_mod.register_screener_jobs(sched) is True
    return {j["id"]: j for j in sched.jobs}


def test_the_live_job_is_registered_with_the_live_tiers_idiom_PLUS_a_misfire_grace(monkeypatch):
    """⭐ THE LIVE TIER'S OWN `add_job` SHAPE, plus the one thing it is missing.

    `screener_live_tier` registers `IntervalTrigger(seconds=…), max_instances=1,
    replace_existing=True, coalesce=True` and NO `misfire_grace_time` — see the
    test below for why that is a hole here rather than a style choice.

    ⛔ THE CADENCE IS READ, NEVER TYPED: 240 comes back only if the registration
    called `scan_evaluator.live_interval_s()` instead of writing 300 down.
    """
    by_id = _register(monkeypatch, SCAN_LIVE_INTERVAL_S="240",
                      SCAN_LIVE_SWEEP_ENABLED=None)
    assert "screener_scan_sweep_live" in by_id, (
        "the live cycle has no scheduler job — every rail under it is inert")
    job = by_id["screener_scan_sweep_live"]
    assert job["max_instances"] == 1, (
        "overlapping live cycles would double the provider reads and race the receipt")
    assert job["coalesce"] is True
    assert job["replace_existing"] is True
    assert job["misfire_grace_time"] == 60
    assert job["trigger"].interval.total_seconds() == 240, (
        "the registration retyped the cadence instead of reading live_interval_s()")


def test_the_misfire_GRACE_is_WIDER_than_the_INSTALLED_schedulers_own_DEFAULT():
    """🔴 THE NUMBER THIS EXISTS TO BEAT IS READ OUT OF THE INSTALLED LIBRARY.

    APScheduler 3.11.2 defaults `job_defaults['misfire_grace_time']` to **1
    second**, and `executors/base.py` SKIPS a due run (EVENT_JOB_MISSED, the
    function never called) whose trigger time is further behind `now` than that
    when the check loop reaches it. On a single pod under GIL contention one
    second is nothing, and a silently dropped tick here is a five-minute hole in
    the overlay that nothing reports.

    ⛔ Read, not retyped: if a future apscheduler ships a sane default this goes
    red and somebody re-decides, rather than the assertion quietly agreeing with a
    number that has moved.
    """
    from apscheduler.schedulers.background import BackgroundScheduler
    library_default = BackgroundScheduler()._job_defaults["misfire_grace_time"]
    assert library_default == 1, (
        f"apscheduler's default misfire grace is now {library_default}s, not 1s -- "
        "the reason this job widens it has changed and needs re-deciding")
    assert 60 > library_default


def test_the_live_job_is_registered_UNCONDITIONALLY_while_the_NIGHTLY_one_is_FLAG_GATED(
        monkeypatch):
    """🔴 THE LIVE TIER'S CONSTRAINT 4: *a job registered only under the flag
    cannot be turned off without a deploy.* The FLAG gates the WORK inside the
    job (`run_sweep` re-reads it per call), never the registration — so rollback
    is unsetting an env var and the next tick answers `disabled`.

    ⛔ AND THIS IS THE NON-VACUITY CONTROL FOR EVERY PRESENCE ASSERTION IN THIS
    SECTION. With BOTH flags dark, the nightly sweep is ABSENT from the very same
    `sched.jobs` list the live job is PRESENT in. A `_FakeScheduler` that had
    stopped recording — or a `register_screener_jobs` that bailed early — could
    not produce that pair.
    """
    dark = _register(monkeypatch, SCAN_LIVE_SWEEP_ENABLED=None, SCAN_SWEEP_ENABLED=None)
    assert "screener_scan_sweep_live" in dark, (
        "the live job is registered only under its flag -- the kill switch would "
        "then need a deploy, which is not a kill switch")
    assert "screener_scan_sweep" not in dark, (
        "the flag-gated sibling was registered anyway: this instrument cannot see "
        "an absence, so the assertion above proves nothing")

    lit = _register(monkeypatch, SCAN_LIVE_SWEEP_ENABLED="1", SCAN_SWEEP_ENABLED="1")
    assert "screener_scan_sweep_live" in lit and "screener_scan_sweep" in lit


def test_the_live_add_job_is_wrapped_in_NO_flag_test__BY_AST():
    """The structural half of the test above: the behavioural pair could both pass
    on a registration gated by something that happens to be true in the test
    environment. This walks `register_screener_jobs` and counts the `if`
    statements between each `add_job` and the function body.

    ⛔ WITH ITS OWN CONTROL: the nightly sweep MUST come back gated. A probe that
    reported zero for everything would pass the live assertion for free.
    """
    depth = _add_job_gate_depth()
    assert depth.get("screener_scan_sweep_live") == 0, (
        f"the live add_job sits under {depth.get('screener_scan_sweep_live')} "
        "conditional(s) -- registration must not be gated")
    assert depth.get("screener_scan_sweep", 0) >= 1, (
        "the probe reports the flag-gated nightly sweep as unconditional too, so "
        "it cannot see gating at all and the assertion above is vacuous")


def test_the_registered_job_REACHES_live_sweep_job_and_a_RAISING_cycle_is_SWALLOWED(
        store, monkeypatch):
    """⛔ THE WRAPPER SWALLOWS, LIKE THE NIGHTLY ONE. An exception escaping into
    APScheduler's executor is a traceback in a log nobody reads; the cycle has
    already filed its own receipt and logged its own `[scan-live]` line, and the
    next tick is five minutes away either way.

    ⭐ THE MIDDLE STEP IS WHAT MAKES THE LAST ONE MEAN ANYTHING: a wrapper that
    never called `live_sweep_job` would swallow a raise for free.
    """
    fn = _register(monkeypatch,
                   SCAN_LIVE_SWEEP_ENABLED=None)["screener_scan_sweep_live"]["fn"]

    fn()                                        # the REAL job, dark
    assert scan_store.last_live_cycle("D") is None, (
        "a dark tick filed a receipt -- the flag no longer gates the work")

    seen = []
    monkeypatch.setattr(scan_evaluator, "live_sweep_job", lambda: seen.append(1))
    fn()
    assert seen == [1], "the registered job never reaches live_sweep_job"

    monkeypatch.setattr(scan_evaluator, "live_sweep_job", _raises(RuntimeError("x")))
    fn()                                        # ⛔ does NOT raise


def test_the_REGISTERED_job_still_FILES_a_receipt_when_the_CYCLE_DIES(
        store, bars, live_clock, feed, monkeypatch):
    """🔴 THE END-TO-END PROOF THAT W4b.3's FIX IS NO LONGER LATENT.

    `_finish_live` files a receipt on the raising path and re-raises; until this
    registration existed nothing ever CALLED that path on a schedule, so a cycle
    that died left `last_live_cycle()` reading `None` — indistinguishable from "a
    scheduler that never ran". This drives the real chain the pod will drive —
    `add_job`'s own callable -> the wrapper -> `live_sweep_job` -> `run_sweep`
    -> `_finish_live` — and reads the ARTIFACT back out of the store.

    ⛔ A status surface that could not tell a dead scheduler from a quiet evening
    is the failure this whole pipeline is built to avoid.
    """
    fn = _register(monkeypatch,
                   SCAN_LIVE_SWEEP_ENABLED="1")["screener_scan_sweep_live"]["fn"]
    monkeypatch.setattr(scan_evaluator, "definitions_to_sweep",
                        lambda: [_definition(PRICE_TREE)])
    monkeypatch.setattr(snapshot_builder, "_load_universe",
                        _raises(sqlite3.OperationalError("database is locked")))

    fn()                                        # ⛔ the pod never sees this raise

    filed = scan_store.last_live_cycle("D")
    assert filed is not None, (
        "the cycle died and left NO receipt -- the status surface cannot tell this "
        "from a scheduler that never started")
    assert filed["receipt"]["skipped_reason"] == "failed"
    assert "database is locked" in str(filed["receipt"]["failure"])


def test_the_live_window_and_the_nightly_sweep_are_DISJOINT_by_derivation():
    """The nightly sweep stops STARTING definitions at `sweep_deadline()` = the
    open minus 30 min; the live window opens AT the open. Neither can be inside
    the other, and neither number is typed here.
    """
    day = datetime.date(2026, 8, 26)
    opened = scan_evaluator.market_open_et(day)
    nightly_deadline = scan_evaluator.sweep_deadline(
        _at(2026, 8, 26, scan_evaluator.SWEEP_HOUR_ET, scan_evaluator.SWEEP_MINUTE_ET))
    assert nightly_deadline < opened
    assert scan_evaluator._live_session_state(nightly_deadline) == "closed"
    assert scan_evaluator._live_session_state(opened) is None
    # ⛔ AND THE HOUR THE NIGHTLY ACTUALLY FIRES IS OUTSIDE THE LIVE WINDOW TOO --
    # the deadline being early is not the same fact as the cron being early.
    assert scan_evaluator._live_session_state(
        _at(2026, 8, 26, scan_evaluator.SWEEP_HOUR_ET,
            scan_evaluator.SWEEP_MINUTE_ET)) == "closed"


# ─── 14b. the REGISTERED cadence meets the store's bound (fix round 1) ────────
#
# 🔴 THE TRIGGER RUNS 24 HOURS; THE WINDOW IS 6.5. Registration is unconditional
# and `IntervalTrigger` has no session bounds — by design, because the session
# test is DERIVED inside the cycle and a cron with typed hours would be a second
# authority over `market_open_et`. The consequence is that most ticks of the day
# land OUTSIDE the window and answer `closed`, and `closed` IS recorded (a
# deliberate ruling: "the flag is off" is knowable from the environment, "the
# last cycle ran and the market was shut" is only knowable from the artifact).
#
# ⛔ SO TWO POPULATIONS SHARE ONE FIFO: 210 low-information `closed` ticks a night
# against 78 high-information real receipts a session, bounded together at
# `LIVE_CYCLES_KEEP`. Nothing railed that bound before this round, which is
# exactly how it went unnoticed.


def _cycle_rows(path, tf="D"):
    """Every receipt row, newest first — the ARTIFACT, not `last_live_cycle`'s
    one-row view, because eviction is invisible from the top of the table."""
    with contextlib.closing(sqlite3.connect(str(path))) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute(
            f"SELECT cycle_started, receipt_json FROM {scan_store.LIVE_CYCLES_TABLE} "
            "WHERE tf=? ORDER BY cycle_started DESC", (tf,))]


def _ticks_per(span_seconds) -> int:
    """How many ticks of the REGISTERED cadence fit in `span_seconds`. ⛔ Derived
    from `live_interval_s()`, never typed: change the env var and every count in
    this section moves with it."""
    return int(span_seconds // scan_evaluator.live_interval_s())


def _file(tick, *, skipped=None):
    scan_store.record_live_cycle(
        {"cycle_started": int(tick), "tf": "D", "skipped_reason": skipped}, [])


def test_an_OVERNIGHT_of_CLOSED_ticks_does_not_EVICT_the_sessions_REAL_receipts(
        store, monkeypatch):
    """🔴 THE ARMING BLOCKER, AS A RAIL.

    One session of real receipts, then one overnight of `closed` ticks, at the
    cadence this task actually registered. Before the fix, 0 of the session's
    receipts survived and `last_live_cycle('D')` read `closed` at the next open —
    the whole of yesterday gone, and the one artifact this pipeline names as its
    success criterion destroyed by the ticks that were supposed to prove the
    scheduler was alive.

    ⛔ EVERY COUNT IS DERIVED from the registered interval and the declared
    session length. Nothing here types 78, 210 or 288.
    """
    monkeypatch.delenv("SCAN_LIVE_INTERVAL_S", raising=False)
    interval = scan_evaluator.live_interval_s()
    session_ticks = _ticks_per(scan_evaluator.REGULAR_SESSION_LENGTH.total_seconds())
    overnight_ticks = _ticks_per(datetime.timedelta(days=1).total_seconds()) - session_ticks
    assert session_ticks and overnight_ticks > session_ticks, (
        "the day no longer has more closed ticks than open ones -- re-read this test")

    base = 1_800_000_000
    for i in range(session_ticks):                      # a full regular session
        _file(base + i * interval)
    session_last = base + (session_ticks - 1) * interval
    for i in range(overnight_ticks):                    # then the whole night
        _file(session_last + (i + 1) * interval, skipped="closed")

    rows = _cycle_rows(store)
    real = [r for r in rows if json.loads(r["receipt_json"]).get("skipped_reason") is None]
    assert len(real) == session_ticks, (
        f"{session_ticks - len(real)} of {session_ticks} real receipts were EVICTED by "
        f"{overnight_ticks} closed ticks -- a status surface reading this table at the "
        "next open cannot see that yesterday's session ran at all")
    assert len(rows) <= scan_store.LIVE_CYCLES_KEEP


def test_a_CLOSED_receipt_is_a_STATE_not_an_EVENT_so_consecutive_ones_COLLAPSE(store):
    """⭐ THE FIX, AND ITS SHAPE. 210 rows that all say "the market is shut" carry
    exactly the information of ONE row plus its timestamp. So `closed` collapses:
    a trailing closed row is REPLACED, never appended.

    ⛔ AND THE LIVENESS BEAT IS PRESERVED AT FULL FRESHNESS, which is the whole
    reason `closed` is recorded where `disabled` is not. The surviving row always
    carries the NEWEST tick, so "when did the scheduler last beat" is answerable
    to within one interval all night — the property is kept, only the 209
    redundant copies of it are dropped.
    """
    base, step = 1_800_000_000, scan_evaluator.live_interval_s()
    _file(base, skipped="closed")
    _file(base + step, skipped="closed")
    _file(base + 2 * step, skipped="closed")

    rows = _cycle_rows(store)
    assert len(rows) == 1, f"{len(rows)} closed rows survived; a state needs one"
    assert rows[0]["cycle_started"] == base + 2 * step, (
        "the collapse kept the OLDEST closed row -- the liveness beat is now stale, "
        "which is worse than not recording it at all")
    assert scan_store.last_live_cycle("D")["cycle_started"] == base + 2 * step


def test_the_collapsed_closed_row_SURVIVES_as_HISTORY_once_a_real_cycle_follows(store):
    """⛔ COLLAPSE IS NOT DELETION. "The session ended and the scheduler was alive
    through the night" is one row of real history and it stays — only a closed row
    directly REPLACED by another closed row goes."""
    base, step = 1_800_000_000, scan_evaluator.live_interval_s()
    _file(base, skipped="closed")
    _file(base + step, skipped="closed")
    _file(base + 2 * step)                              # the open: a real cycle
    _file(base + 3 * step)

    rows = _cycle_rows(store)
    kinds = [json.loads(r["receipt_json"]).get("skipped_reason") for r in rows]
    assert kinds == [None, None, "closed"], kinds


def test_a_real_receipt_is_an_EVENT_and_is_NEVER_collapsed_into_its_neighbour(store):
    """The control on the collapse: it must be the `closed` WORD that collapses,
    not "the newest two rows". Two real cycles a tick apart are two events."""
    base, step = 1_800_000_000, scan_evaluator.live_interval_s()
    _file(base)
    _file(base + step)
    assert len(_cycle_rows(store)) == 2

    # ⛔ AND A NON-CLOSED SKIP IS AN EVENT TOO: `no-definitions` twice in a session
    # is two facts about two cycles, not one state.
    _file(base + 2 * step, skipped="no-definitions")
    _file(base + 3 * step, skipped="no-definitions")
    assert len(_cycle_rows(store)) == 4


def test_the_KEEP_bound_STILL_MEANS_what_its_own_comment_says(store, monkeypatch):
    """⭐ THE CONSTANT'S COMMENT IS A CLAIM, AND IT IS NOW CHECKED. `LIVE_CYCLES_KEEP`
    says "≈ 1.5 regular sessions" — a premise the unconditional registration
    falsified until the collapse landed, because the sessions were sharing the
    window with a nightly flood. Nothing railed it before this round.
    """
    monkeypatch.delenv("SCAN_LIVE_INTERVAL_S", raising=False)
    session_ticks = _ticks_per(scan_evaluator.REGULAR_SESSION_LENGTH.total_seconds())
    assert scan_store.LIVE_CYCLES_KEEP / session_ticks >= 1.5, (
        f"KEEP={scan_store.LIVE_CYCLES_KEEP} holds only "
        f"{scan_store.LIVE_CYCLES_KEEP / session_ticks:.2f} sessions at a "
        f"{scan_evaluator.live_interval_s()} s cadence, not the 1.5 it claims")
    # ⛔ AND THE FLOOR CADENCE IS THE HARD CASE, stated here rather than discovered
    # later. Ask for a cadence below the floor and `live_interval_s` clamps it; at
    # that clamped rate a session runs to many times `LIVE_CYCLES_KEEP`, so the
    # table holds only a FRACTION of one session. That is a real limit — but it is
    # bounded by this constant rather than by an overnight flood, which is the
    # difference the collapse buys, and it is the reason SCAN_LIVE_INTERVAL_S must
    # never be lowered without raising the keep bound.
    #
    # ⛔ NOTHING HERE TYPES THE FLOOR OR THE TICK COUNT. An earlier draft asserted a
    # literal 780, which is the retyped-constant defect in a test written to catch
    # exactly that: both are read back from the module under test.
    monkeypatch.setenv("SCAN_LIVE_INTERVAL_S", "1")          # below the floor
    floor_ticks = _ticks_per(scan_evaluator.REGULAR_SESSION_LENGTH.total_seconds())
    assert floor_ticks > session_ticks, (
        "the floor cadence no longer yields more ticks per session than the "
        "default one, so the paragraph above no longer describes anything")
    held = scan_store.LIVE_CYCLES_KEEP / floor_ticks
    assert held < 0.5, (
        f"at the {scan_evaluator.live_interval_s()} s floor this table holds "
        f"{held:.2f} of one session ({floor_ticks} ticks) -- if that is now "
        "comfortable, LIVE_CYCLES_KEEP moved and this warning should be re-read")


def test_the_COLLAPSING_reasons_are_a_SUBSET_of_the_words_a_cycle_can_actually_EMIT():
    """⛔ THE SAME RAIL `LIVE_WARNING_REASONS` CARRIES, for the same reason: a word
    in the store's collapse policy that no cycle can ever emit is a policy that can
    never fire, and it would sit there reading as protection.

    The two constants live in different modules on purpose — the prune is the
    WRITER's policy and `scan_store` cannot import the evaluator without a cycle —
    so this is the only place the relationship can be asserted.
    """
    # ⛔ NON-EMPTY FIRST, OR THE SUBSET BELOW IS VACUOUS: `set() <= anything` is True,
    # so an emptied policy would sail through this rail reading as protection. An
    # EMPTY authority is not one -- measured: emptying the tuple leaves this test
    # GREEN and is caught only by the behavioural rails above.
    assert scan_store.LIVE_COLLAPSING_REASONS, (
        "the collapse policy is empty -- nothing collapses and the overnight flood "
        "is back")
    assert set(scan_store.LIVE_COLLAPSING_REASONS) <= set(scan_evaluator.LIVE_SKIP_REASONS)
    # ⛔ AND `disabled` IS NOT AMONG THEM: it is never recorded at all
    # (`record=False`), so collapsing it would be a rule about rows that cannot
    # exist -- and reading it here would suggest they do.
    assert "disabled" not in scan_store.LIVE_COLLAPSING_REASONS


def test_the_FIRST_closed_tick_after_the_bell_does_NOT_eat_the_sessions_LAST_receipt(store):
    """🔴 THE 16:00 TRANSITION, WHICH HAPPENS EVERY SINGLE DAY. The session's final
    real receipt is written at 15:55 and the very next tick answers `closed`. The
    collapse must look at what the PREVIOUS row actually says, not merely at "there
    is a row behind me" — a version that skipped that check would silently eat the
    closing receipt of every session, which is the single most interesting row in
    the table.
    """
    base, step = 1_800_000_000, scan_evaluator.live_interval_s()
    _file(base)                                          # 15:50, a real cycle
    _file(base + step)                                   # 15:55, the session's last
    _file(base + 2 * step, skipped="closed")             # 16:00, the bell

    rows = _cycle_rows(store)
    kinds = [json.loads(r["receipt_json"]).get("skipped_reason") for r in rows]
    assert kinds == ["closed", None, None], kinds
    assert rows[1]["cycle_started"] == base + step, (
        "the closing tick swallowed the session's final real receipt")


# ═══ 15. THE READ SURFACE (W4b.5) — the receipt finally gets a reader ════════
#
# ⛔ THE THING THIS SECTION EXISTS FOR. Before W4b.5 the sweep filed an honest
# liveness receipt every cycle and `last_live_cycle` had THREE references in
# `api/`, all of them inside `scan_evaluator.py` (one a comment). Nobody off the
# pod could answer "is the sweeper alive?", so the arming runbook's confirm step
# was written against a surface nothing mounted. These tests are the reader.
#
# ⭐ AND THE ANSWER IS THE AGE OF THE TOP ROW. A healthy read is ~one interval
# old; a scheduler dead since the bell reads hundreds of minutes stale. THAT
# DIFFERENCE IS THE WHOLE SIGNAL — a reader that drops the age, or that filters
# `closed` rows out of what it exposes, makes a healthy sweeper and a dead one
# indistinguishable, which is exactly the shape section 14b refuted with
# byte-identical table hashes.

from fastapi import FastAPI                                        # noqa: E402
from fastapi.testclient import TestClient                          # noqa: E402
from api.middleware.auth_middleware import (get_current_user,      # noqa: E402
                                            get_current_user_with_plan)
from api.routers import scan_results as results_mod                # noqa: E402

PAID_USER = {"id": "paid1", "role": "member", "plan": "pro"}
FREE_USER = {"id": "free1", "role": "member", "plan": "free"}
ROOT = pathlib.Path(__file__).resolve().parents[1]


def _client(user, module=results_mod):
    app = FastAPI()
    app.include_router(module.router)
    if user is not None:
        # ⚠️ THE OVERRIDES ARE ON THE IDENTITY DEPENDENCIES, NEVER ON
        # `require_paid` — overriding the gate means the test never runs it.
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _get(user, **params):
    q = {"def_hash": DEF, "tf": "D"}
    q.update(params)
    return _client(user).get("/api/scans/definition-results", params=q)


def _seed_nightly(symbols, as_of, extra_rows=("DDD", "ZZZ")):
    """One swept session, exactly as the sweep files it, plus the `screener_rows`
    the route joins against — the join is what keeps a symbol the nightly build
    dropped out of the snapshot off a member's page."""
    with contextlib.closing(snapshot_db.connect()) as conn:
        for t in list(symbols) + list(extra_rows):
            conn.execute("INSERT OR IGNORE INTO screener_rows (ticker) VALUES (?)", (t,))
        conn.commit()
    scan_store.record_hits(DEF, "D", as_of, list(symbols))
    scan_store.record_coverage(DEF, "D", as_of, evaluated=len(symbols) + 2,
                               answered=len(symbols) + 2, dropped=0, not_computable=0,
                               dropped_symbols=[], freshness="live")


def test_definition_results_carries_TIER_and_LIVE_AS_OF_per_hit_and_the_last_receipt(
        store, monkeypatch):
    _seed_nightly(["AAA", "CCC"], 20260825)
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.upsert_live_hits(DEF, "D", [
        {"symbol": "AAA", "value": 1, "live_cols": 5, "src_price": 71.0},
        {"symbol": "DDD", "value": 1, "live_cols": 2, "src_price": 2.0}], t)
    scan_store.record_live_cycle(
        {"cycle_started": t, "tf": "D", "skipped_reason": None, "answered": 3}, [DEF])
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + 30)
    body = _get(PAID_USER, as_of="20260825").json()
    # ⛔ UNCHANGED FOR W5a's CURRENT READER. `ScanResults.jsx` reads `tickers`;
    # provenance is ADDED beside it, never folded into it.
    assert body["tickers"] == ["AAA", "CCC"], body
    by = {h["symbol"]: h for h in body["hits"]}
    assert by["AAA"]["tier"] == "live" and by["AAA"]["live_as_of"] == t
    assert by["AAA"]["src_price"] == 71.0 and by["AAA"]["live_cols"] == 5
    assert by["CCC"]["tier"] == "nightly" and by["CCC"]["live_as_of"] is None
    assert by["CCC"]["in_nightly"] is True
    # the live-only symbol is APPENDED and SAYS it was not in the nightly set —
    # never dropped (a hit the member cannot see) and never promoted (a hit the
    # nightly artifact never made).
    assert by["DDD"]["tier"] == "live" and by["DDD"]["in_nightly"] is False
    assert body["live"]["definition_swept"] is True and body["live"]["answered"] == 3
    assert body["live"]["cycle_started"] == t


def test_the_hits_PAGE_carries_the_nightly_tickers_FIRST_and_IN_THE_SAME_ORDER(
        store, monkeypatch):
    """⛔ THE TWO LISTS ARE ONE ANSWER. `tickers` is the nightly page; `hits` is
    that same page with provenance, plus the live-only tail. A page whose two
    halves disagreed about order would make the tier chip land on the wrong row."""
    _seed_nightly(["AAA", "CCC"], 20260825)
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.upsert_live_hits(DEF, "D", [
        {"symbol": "DDD", "value": 1, "live_cols": 2, "src_price": 2.0}], t)
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + 30)
    body = _get(PAID_USER, as_of="20260825").json()
    syms = [h["symbol"] for h in body["hits"]]
    assert syms[:len(body["tickers"])] == body["tickers"], syms
    assert [h["symbol"] for h in body["hits"] if not h["in_nightly"]] == ["DDD"]


def test_a_live_only_hit_with_NO_screener_row_is_not_reported__the_same_join_the_page_passes(
        store, monkeypatch):
    """A live-only symbol still has to exist in `screener_rows`, for exactly the
    reason `_hit_tickers` joins: a ticker the nightly build dropped is one a member
    cannot act on, and half a row is worse than none."""
    _seed_nightly(["AAA"], 20260825, extra_rows=())
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.upsert_live_hits(DEF, "D", [
        {"symbol": "GONE", "value": 1, "live_cols": 5, "src_price": 1.0}], t)
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + 30)
    body = _get(PAID_USER, as_of="20260825").json()
    assert [h["symbol"] for h in body["hits"]] == ["AAA"]
    assert body["tickers"] == ["AAA"]


def test_a_not_run_window_carries_EMPTY_hits_and_a_NULL_live_block(store):
    """🔴 E6-A2 AGAIN, ON THE NEW FIELDS. "Nobody looked" must not acquire a live
    block on the way out — a receipt beside an empty page reads as a swept quiet
    market, which is the one thing the `not-run` branch exists to refuse."""
    body = _get(PAID_USER, as_of="20260101").json()
    assert body["status"] == "not-run"
    assert body["hits"] == [] and body["live"] is None


def test_the_ENTITLEMENT_CAP_is_applied_ONCE_over_the_WHOLE_page_never_twice(
        store, monkeypatch):
    """🔴 THE BRIEF'S STEP 3 CAPPED TWICE — nightly and live-only separately — which
    hands a capped member up to `2 * max_symbols` symbols. The shipped toolkit is
    `max_symbols=None`, so the defect is INVISIBLE today and would ship a doubled
    ceiling the day a second toolkit is sold.

    ⛔ AND THE NIGHTLY HALF KEEPS PRECEDENCE: the cap trims the TAIL, and the
    live-only tail is what the page appends, so a live-only symbol can never
    displace a nightly hit a member already paid for.
    """
    from api.services import entitlements

    _seed_nightly(["AAA", "CCC"], 20260825, extra_rows=("DDD", "EEE"))
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.upsert_live_hits(DEF, "D", [
        {"symbol": "DDD", "value": 1, "live_cols": 2, "src_price": 2.0},
        {"symbol": "EEE", "value": 1, "live_cols": 2, "src_price": 3.0}], t)
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + 30)

    capped = entitlements.Limits(toolkit="all", max_symbols=3, max_history_bars=None,
                                 max_definitions=10, min_refresh_seconds=None)
    app = FastAPI()
    app.include_router(results_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID_USER)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID_USER)
    app.dependency_overrides[entitlements.limits_dependency] = lambda: capped
    body = TestClient(app).get("/api/scans/definition-results",
                               params={"def_hash": DEF, "tf": "D", "as_of": "20260825"}).json()

    assert len(body["hits"]) == capped.max_symbols, (
        f"{len(body['hits'])} rows reached a member capped at {capped.max_symbols} — "
        "the cap was applied per-SLICE instead of once over the page")
    # the nightly half survives whole; the live-only tail is what got trimmed
    assert body["tickers"] == ["AAA", "CCC"]
    assert [h["symbol"] for h in body["hits"]] == ["AAA", "CCC", "DDD"]
    # …and the member is TOLD, beside the four counts, never inside them
    assert body["coverage"]["withheld"] == 1
    assert body["coverage"]["withheld_reason"] == entitlements.SYMBOLS_WITHHELD
    for key in ("evaluated", "answered", "dropped", "not_computable"):
        assert body["coverage"][key] == scan_store.coverage(DEF, "D", 20260825)[key], key


def test_the_CAP_probe_is_NOT_vacuous__the_UNCAPPED_toolkit_returns_the_whole_page(
        store, monkeypatch):
    """The control. Without it the assertion above passes on a route that returns
    three rows because it can only ever find three."""
    _seed_nightly(["AAA", "CCC"], 20260825, extra_rows=("DDD", "EEE"))
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.upsert_live_hits(DEF, "D", [
        {"symbol": "DDD", "value": 1, "live_cols": 2, "src_price": 2.0},
        {"symbol": "EEE", "value": 1, "live_cols": 2, "src_price": 3.0}], t)
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + 30)
    body = _get(PAID_USER, as_of="20260825").json()
    assert [h["symbol"] for h in body["hits"]] == ["AAA", "CCC", "DDD", "EEE"]
    assert "withheld" not in (body["coverage"] or {})


# ─── the beat's own door: /api/scans/live-status ─────────────────────────────

def _live_client(user=PAID_USER):
    from api.routers import scan_live as live_mod
    return _client(user, module=live_mod)


def test_live_status_is_PAID_and_the_demand_route_is_BEARER_GATED(store, monkeypatch):
    from api.routers import scan_live as live_mod

    app = FastAPI()
    app.include_router(live_mod.router)
    c = TestClient(app)
    # no identity override at all: the paid gate must refuse, not 500
    assert c.get("/api/scans/live-status").status_code in (401, 402, 403)
    assert c.get("/api/scans/demand").status_code == 401
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    assert c.get("/api/scans/demand",
                 headers={"Authorization": "Bearer wrong"}).status_code == 401
    # ⚠️ THE RING IS PER-PROCESS MODULE STATE, so it carries whatever an earlier
    # test in this file left in it. Replaced rather than appended to — the
    # section-5 idiom — or this assertion reads another test's symbols.
    monkeypatch.setattr(scan_store, "_DEMAND", collections.OrderedDict())
    scan_store.note_demand(["zzz"])
    r = c.get("/api/scans/demand", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200, r.text
    assert r.json()["recent"] == ["ZZZ"] and "lists" in r.json()


def test_a_BLANK_push_secret_refuses_the_demand_route_rather_than_opening_it(
        store, monkeypatch):
    """⛔ THE FAILURE DIRECTION IS CLOSED. An unset `PUSH_SECRET` must not make
    `Authorization: Bearer ` (empty) match — the same contract as
    `DESK_TSDR_ANNOUNCE_SHOWS`: blank announces nothing."""
    from api.routers import scan_live as live_mod

    monkeypatch.delenv("PUSH_SECRET", raising=False)
    app = FastAPI()
    app.include_router(live_mod.router)
    c = TestClient(app)
    assert c.get("/api/scans/demand", headers={"Authorization": "Bearer "}).status_code == 401
    monkeypatch.setenv("PUSH_SECRET", "")
    assert c.get("/api/scans/demand", headers={"Authorization": "Bearer "}).status_code == 401


def test_a_NON_ASCII_bearer_header_is_REFUSED_not_a_500(store, monkeypatch):
    """⛔ FAIL CLOSED ON A HEADER THE COMPARISON CANNOT EVEN READ.
    `hmac.compare_digest` REFUSES two `str`s when either carries a non-ASCII
    character — it raises `TypeError`, which FastAPI turns into a 500. A gate
    that answers "internal error" to a malformed credential is a gate whose
    refusal is indistinguishable from an outage, and 500s on an unauthenticated
    path are how a scanner finds a wall worth pushing on. Bytes compare cleanly,
    so the answer is 401 for every input.
    """
    from api.routers import scan_live as live_mod

    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    app = FastAPI()
    app.include_router(live_mod.router)
    c = TestClient(app, raise_server_exceptions=False)
    # ⚠️ SENT AS RAW BYTES. An HTTP header is bytes on the wire and Starlette
    # decodes it latin-1, so `request.headers` really can hand the gate a
    # non-ASCII `str` — but httpx refuses to ASCII-encode one, so a test that
    # passed a `str` here would fail in the CLIENT and prove nothing about the
    # server.
    r = c.get("/api/scans/demand",
              headers={"Authorization": "Bearer sécret".encode("latin-1")})
    assert r.status_code == 401, (
        f"a non-ASCII bearer answered {r.status_code}; the comparison raised "
        "instead of refusing")


def test_a_FREE_member_is_refused_the_live_status(store):
    assert _live_client(FREE_USER).get("/api/scans/live-status").status_code == 402


def test_live_status_serves_the_TOP_ROW_and_the_AGE_the_runbook_confirms_on(
        store, monkeypatch):
    """⭐ THE ARMING RUNBOOK'S CONFIRM STEP, PERFORMABLE OFF THE POD.

    A healthy sweeper's top row is younger than one interval; a scheduler that
    died at the bell reads hundreds of minutes stale. The number is computed
    SERVER-side off the store's own read clock, because a caller comparing a raw
    `cycle_started` against its own wall clock is a second authority on "now" —
    and the operator curling this wants the answer, not the arithmetic.
    """
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.record_live_cycle(
        {"cycle_started": t, "tf": "D", "skipped_reason": None, "cycle_seconds": 3.1}, [DEF])

    healthy = 4 * 60                                    # inside one 5-minute interval
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + healthy)
    body = _live_client().get("/api/scans/live-status").json()
    assert body["last_cycle"]["cycle_started"] == t
    assert body["last_cycle"]["receipt"]["cycle_seconds"] == 3.1
    assert body["age_s"] == pytest.approx(healthy)
    assert body["stale"] is False
    assert body["max_age_s"] == scan_store.live_max_age_s()

    # …and the dead-scheduler read, the one the whole receipt exists to make
    # distinguishable: 20:00 against a 10:42 last beat.
    dead = int(_tick(2026, 8, 26, 20, 0) - t)
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + dead)
    dead_body = _live_client().get("/api/scans/live-status").json()
    assert dead_body["age_s"] == pytest.approx(dead)
    assert dead_body["stale"] is True
    assert dead_body["age_s"] > body["age_s"] * 10, (
        "a healthy read and a dead-scheduler read are not separable on this "
        "surface — the reader lost the AGE and with it the whole signal")


def test_NO_cycle_EVER_is_its_own_answer_and_is_NOT_reported_as_stale(store):
    """"Nobody has swept" and "the sweeper died" are different facts and a member
    reading `stale: true` for a pod that has simply never run would chase the
    wrong thing. `age_s`/`stale` are both `null` — the same "nobody looked"
    grammar `coverage is None` already uses."""
    body = _live_client().get("/api/scans/live-status").json()
    assert body["last_cycle"] is None
    assert body["age_s"] is None and body["stale"] is None
    assert body["max_age_s"] == scan_store.live_max_age_s()


def test_a_CLOSED_top_row_is_STILL_THE_BEAT__the_reader_NEVER_filters_it_out(
        store, monkeypatch):
    """⛔ THE REFUTED FIX, RE-REFUTED ON THE READ PATH. Not recording `closed` at
    all was proven wrong by byte-identical table hashes: a healthy overnight pod
    and a dead one became indistinguishable. A reader that hides `closed` rows
    rebuilds exactly that blindness one layer up — overnight, EVERY top row says
    `closed`, and a reader that filtered them would answer "no cycle has ever
    run" for a perfectly healthy sweeper every single night.
    """
    t = _tick(2026, 8, 26, 18, 30)
    scan_store.record_live_cycle(
        {"cycle_started": t, "tf": "D", "skipped_reason": "closed"}, [])
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + 120)
    body = _live_client().get("/api/scans/live-status").json()
    assert body["last_cycle"] is not None, (
        "the reader filtered the `closed` receipt out and reported a healthy "
        "overnight sweeper as one that has never run")
    assert body["last_cycle"]["receipt"]["skipped_reason"] == "closed"
    assert body["age_s"] == pytest.approx(120)
    assert body["stale"] is False


def test_the_STALE_threshold_is_the_STORES_max_age_never_a_typed_number(store, monkeypatch):
    """The bound is `scan_store.live_max_age_s()`, which Task 3 pins at
    `>= 2 * live_interval_s()` — so `stale` means "at least two intervals were
    missed", derived, and it MOVES when the env var moves."""
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.record_live_cycle({"cycle_started": t, "tf": "D", "skipped_reason": None}, [])
    monkeypatch.setenv("SCAN_LIVE_MAX_AGE_S", "60")
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: t + 90)
    body = _live_client().get("/api/scans/live-status").json()
    assert body["max_age_s"] == 60.0 and body["stale"] is True
    monkeypatch.setenv("SCAN_LIVE_MAX_AGE_S", "600")
    later = _live_client().get("/api/scans/live-status").json()
    assert later["max_age_s"] == 600.0 and later["stale"] is False, (
        "the staleness verdict did not move with the store's own bound — a "
        "typed threshold has appeared beside it")


def test_the_AGE_is_the_STORES_to_compute__the_router_reads_no_clock_of_its_own():
    """⛔ ONE CLOCK. `scan_store._now_for_reads` is the read path's single seam;
    a router that subtracted its own `time.time()` would be a second authority on
    "now", and the route test above could freeze one of them while the handler
    used the other. BY AST, over the handler."""
    from api.routers import scan_live as live_mod

    tree = pyast.parse(pathlib.Path(live_mod.__file__).read_text(encoding="utf-8"))
    fns = [n for n in pyast.walk(tree)
           if isinstance(n, (pyast.FunctionDef, pyast.AsyncFunctionDef))
           and n.name == "live_status"]
    assert len(fns) == 1, "the live-status handler was renamed; this rail lost its subject"
    calls = {pyast.unparse(n.func) for n in pyast.walk(fns[0]) if isinstance(n, pyast.Call)}
    assert "scan_store.live_beat" in calls, calls
    assert not {c for c in calls if c.startswith(("time.", "datetime."))}, calls
    assert not [n for n in pyast.walk(fns[0])
                if isinstance(n, pyast.BinOp) and isinstance(n.op, pyast.Sub)], (
        "the handler subtracts something — the age belongs to the store")


def test_every_route_in_scan_live_is_GATED__DERIVED_off_router_routes():
    """⛔ DERIVED FROM `router.routes`, and from the GATE OBJECTS — never from a
    substring of the handler's source. `main.py` includes this router with no
    router-level dependency, so an ungated route here is reachable by anybody, and
    a rail that looked for the WORD `PUSH_SECRET` would be cleared by a comment.
    """
    from api.routers import scan_live as live_mod

    gates = {live_mod.require_paid, live_mod.require_push_secret}
    routes = [r for r in live_mod.router.routes if getattr(r, "methods", None)]
    assert routes, "the router mounts nothing — this whole rail would pass vacuously"
    for route in routes:
        calls = {d.call for d in route.dependant.dependencies}
        assert calls & gates, (
            f"{sorted(route.methods)} {route.path} carries neither gate: {calls}")


def test_the_GATE_census_SEES_an_UNGATED_route():
    """The control: a route mounted without either dependency must be caught."""
    from fastapi import APIRouter as _APIRouter
    from api.routers import scan_live as live_mod

    r = _APIRouter()

    @r.get("/api/scans/__planted__")
    def _planted():                                        # pragma: no cover
        return {}

    gates = {live_mod.require_paid, live_mod.require_push_secret}
    planted = [x for x in r.routes if getattr(x, "methods", None)]
    assert planted and not any({d.call for d in x.dependant.dependencies} & gates
                               for x in planted)


def test_scan_live_is_REGISTERED_in_main():
    """⛔ A route defined in a module nobody includes is invisible to the E-7
    census AND to the runbook — which is the exact class this task retires."""
    from tests.test_scan_results_route import _included_router_modules

    included = _included_router_modules((ROOT / "api/main.py").read_text(encoding="utf-8"))
    assert "api.routers.scan_live" in included, (
        f"api.routers.scan_live is not passed to include_router in api/main.py — "
        f"the reader exists and nothing serves it. Mounted: {len(included)} routers.")


def test_the_scan_live_router_reaches_the_EVALUATOR_nowhere():
    """⛔ THE ROUTER RAIL, RESTATED WHERE THIS FILE CAN SEE IT.
    `tests/test_scan_evaluator_off_request_path.py` walks every `api/routers/*`
    module; this is the same assertion aimed at the one file W4b.5 adds, so a
    breakage names THIS lane rather than surfacing as a census failure elsewhere."""
    src = pathlib.Path(ROOT / "api/routers/scan_live.py").read_text(encoding="utf-8")
    tree = pyast.parse(src)
    for node in pyast.walk(tree):
        if isinstance(node, pyast.Import):
            assert not any("scan_evaluator" in a.name for a in node.names), pyast.unparse(node)
        elif isinstance(node, pyast.ImportFrom):
            base = node.module or ""
            assert "scan_evaluator" not in base, pyast.unparse(node)
            assert not any(a.name == "scan_evaluator" for a in node.names), pyast.unparse(node)


def test_the_DEMAND_route_carries_the_ring_and_the_member_lists_and_a_stamp(
        store, monkeypatch):
    """The worker's door. `auth.db` is EMPTY on the worker, so `lists` is the ONLY
    way member watchlist/tag symbols reach the prewarm ring at all."""
    from api.routers import scan_live as live_mod

    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setattr(live_mod, "_member_list_symbols", lambda: ["MSFT", "NVDA"])
    monkeypatch.setattr(scan_store, "_DEMAND", collections.OrderedDict())
    scan_store.note_demand(["aapl", "tsla"])
    app = FastAPI()
    app.include_router(live_mod.router)
    body = TestClient(app).get("/api/scans/demand",
                               headers={"Authorization": "Bearer s3cret"}).json()
    assert body["recent"] == ["TSLA", "AAPL"]              # most recent FIRST
    assert body["lists"] == ["MSFT", "NVDA"]
    assert isinstance(body["as_of"], (int, float)) and body["as_of"] > 0


def test_the_member_list_read_NEVER_RAISES_into_the_worker_response(monkeypatch):
    """A missing or unreadable `auth.db` must cost the ring its member lists, not
    the whole demand answer — the ring still has the recent ring and cap universe."""
    from api.routers import scan_live as live_mod

    monkeypatch.setattr(live_mod, "_auth_db_path", lambda: "/nonexistent/nope.db")
    assert live_mod._member_list_symbols() == []
