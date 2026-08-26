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
