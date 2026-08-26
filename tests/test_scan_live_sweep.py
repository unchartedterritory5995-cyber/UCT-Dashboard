"""W4b — the continuous live sweep: side tables with one writer each, the forming
bar, the 5-minute cycle behind its rails, the read surface's provenance."""
from __future__ import annotations
import ast as pyast, collections, contextlib, datetime, json, pathlib, re, sqlite3
from zoneinfo import ZoneInfo
import pytest
from api.services import ast_freshness, scan_definition, user_definitions
from api.services.screener import scan_evaluator, scan_store, snapshot_builder, snapshot_db
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


def test_a_live_row_from_ANOTHER_session_or_OLDER_than_max_age_serves_NIGHTLY(store, monkeypatch):
    scan_store.record_hits(DEF, "D", 20260825, ["AAA"])
    scan_store.record_coverage(DEF, "D", 20260825, evaluated=1, answered=1, dropped=0,
                               not_computable=0, dropped_symbols=[], freshness="live")
    t = _tick(2026, 8, 26, 10, 42)
    scan_store.upsert_live_hits(DEF, "D", [{"symbol": "AAA", "value": 1, "live_cols": 5, "src_price": 1}], t)
    monkeypatch.setenv("SCAN_LIVE_MAX_AGE_S", "900")
    assert scan_store.hits_for(DEF, "D", now=t + 60)["rows"][0]["tier"] == "live"        # the control
    assert scan_store.hits_for(DEF, "D", now=t + 901)["rows"][0]["tier"] == "nightly"    # dead sweeper
    assert scan_store.hits_for(DEF, "D", now=_tick(2026, 8, 27, 10, 0))["rows"][0]["tier"] == "nightly"


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


def test_no_LIVE_function_writes_a_NIGHTLY_table_and_no_nightly_writer_touches_a_live_one():
    src = pathlib.Path(scan_store.__file__).read_text(encoding="utf-8")
    writes = _writes_by_function(src)
    live_fns = {n for n in writes if "live" in n}
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
