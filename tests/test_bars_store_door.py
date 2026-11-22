"""U4: ONE authority. The store's read door (bars_sqlite._door) applies the published corrections ledger with the same
applier the serve path runs, so RS Rating, the screener and the alert evaluator read the corrected rows too; every
read-modify-write caller reads raw (bars_corrections.raw_reads), so a correction is never written into a row.
Synthetic rows only."""
import ast
import datetime
import json
import pathlib
import re

import pytest

from api.services import bars_corrections as K
from api.services import bars_sqlite

REPO = pathlib.Path(__file__).resolve().parents[1]


def _sessions(n, start=datetime.date(2005, 9, 1)):
    from api.services import session_calendar
    out, d = [], start
    while len(out) < n:
        if session_calendar.is_trading_day(d):
            out.append(d)
        d += datetime.timedelta(days=1)
    return out


DAYS = _sessions(30)
BAD = DAYS[20]
ISO = BAD.isoformat()


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    rows = [{"t": d.isoformat(), "o": 120.0, "h": 121.0, "l": 119.0, "c": 120.0, "v": 1000} for d in DAYS]
    rows[20] = {"t": ISO, "o": 121.29, "h": 121.31, "l": 112.09, "c": 119.63, "v": 1000}
    bars_sqlite.put_bars("SPY", "D", rows, date_tf=True)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(K.ENV_SERVE, raising=False)
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), loaded=False)
    K._cache.clear()
    d = tmp_path / "bars_corrections" / "v2"
    d.mkdir(parents=True)
    e = {"tf": "D", "src": "store", "d": ISO, "op": "set", "f": {"l": [112.09, 119.57]}, "chk": {"c": 119.63}}
    (d / "SPY.json.gz").write_bytes(K.encode_payload("SPY", 2, [e]))
    (tmp_path / "bars_corrections" / "manifest.json").write_text(json.dumps({"version": 2, "symbols": ["SPY"]}))
    assert K.load_local()
    yield
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), loaded=False)
    K._cache.clear()
    bars_sqlite.bump_db_epoch()


def _low(rows):
    key = int(ISO.replace("-", ""))
    return [r for r in rows if int(r[0]) == key][0][3]


@pytest.mark.parametrize("read", [
    lambda: bars_sqlite.get_bars("SPY", "D", 100),
    lambda: bars_sqlite.get_bars_fast("SPY", "D", 100),
    lambda: bars_sqlite.get_bars_before("SPY", "D", 100, 29991231),
    lambda: bars_sqlite.get_bars_since("SPY", "D", 0),
])
def test_every_store_reader_gets_the_corrected_row(store, read):
    assert _low(read()) == 119.57


def test_a_read_modify_write_caller_reads_the_rows_as_stored(store):
    with K.raw_reads():
        assert _low(bars_sqlite.get_bars("SPY", "D", 100)) == 112.09
    assert _low(bars_sqlite.get_bars("SPY", "D", 100)) == 119.57          # and only inside the block


def test_the_door_and_the_serve_path_are_one_applier_and_idempotent(store):
    rows = bars_sqlite.get_bars("SPY", "D", 100)
    assert K.apply_rows("SPY", "D", rows) is rows                          # a second pass finds nothing to change
    from api.services import bars_fetch as F
    served = F._fmt_sqlite_bars(rows, "D", "SPY")
    assert [b for b in served if b["t"] == ISO][0]["l"] == 119.57


def test_the_split_repair_never_writes_a_correction_into_the_store(store):
    """Its read is rescaled and written back: it must see the row AS STORED (112.09), never the corrected one."""
    from api.services import bars_split_repair as R
    rows = R._read_series("SPY", "D")
    assert [r for r in rows if str(r["t"]) == ISO.replace("-", "")][0]["l"] == 112.09


def test_volume_is_a_field_too(store, tmp_path):
    e = {"tf": "D", "src": "store", "d": ISO, "op": "set", "f": {"v": [1000, 950]}, "chk": {"c": 119.63}}
    (tmp_path / "bars_corrections" / "v3").mkdir(parents=True)
    (tmp_path / "bars_corrections" / "v3" / "SPY.json.gz").write_bytes(K.encode_payload("SPY", 3, [e]))
    (tmp_path / "bars_corrections" / "manifest.json").write_text(json.dumps({"version": 3, "symbols": ["SPY"]}))
    assert K.load_local()
    row = [r for r in bars_sqlite.get_bars("SPY", "D", 100) if int(r[0]) == int(ISO.replace("-", ""))][0]
    assert row[5] == 950


# ── the rail: who must read raw ─────────────────────────────────────────────────────────────────────────────
DOOR = {"get_bars", "get_bars_before", "get_bars_since", "get_bars_fast", "get_bars_packed"}
WRITES = re.compile(r"\bput_bars(_many)?\s*\(|INSERT\s+(OR\s+\w+\s+)?INTO\s+(main\.)?ohlcv|UPDATE\s+(main\.)?ohlcv|"
                    r"DELETE\s+FROM\s+(main\.)?ohlcv", re.I)
#: Read-modify-write callers: every door call in these modules sits inside `with ... raw_reads():`.
RAW_REQUIRED = {
    "api/services/bars_split_repair.py": "rescales the rows it reads and writes every one back",
    "api/services/audit.py": "compares the rows AS STORED with the vendor",
    "api/services/bars_regraft.py": "its dry-run diff compares a re-graft against the rows AS STORED, which put_bars replaces",
}
#: Modules that call the door AND write the store, whose door reads are NOT written back (read for serving).
READ_ONLY_OK = {
    "api/main.py": "pattern scans and the bars cache warm read for serving",
    "api/routers/bars.py": "a pure read for /api/bars-history",
    "api/services/bars_fetch.py": "serve reads; its D/W/M writes come from provider fetches, never from these reads",
    "api/services/intraday_gap_audit.py": "intraday only: the door passes intraday rows untouched",
    "api/services/ffseed_intraday.py": "intraday only (the door passes intraday rows untouched): one stored bar's start "
                                       "time, read as a record of the as-of day's tail; never written back",
}


def door_calls(tree):
    """[(call node, inside a raw_reads() with-block)] for every door call in a module."""
    out = []

    def walk(node, raw):
        for child in ast.iter_child_nodes(node):
            r = raw
            if isinstance(child, ast.With):
                r = raw or any("raw_reads" in ast.unparse(it.context_expr) for it in child.items)
            if isinstance(child, ast.Call):
                f = child.func
                name = f.attr if isinstance(f, ast.Attribute) else f.id if isinstance(f, ast.Name) else None
                if name in DOOR:
                    out.append((child, r))
            walk(child, r)

    walk(tree, False)
    return out


def audit(root=REPO):
    """Problems, by name: a RAW_REQUIRED door read outside raw_reads(), or a writer module nobody classified."""
    bad = []
    for p in sorted((root / "api").rglob("*.py")):
        rel = p.relative_to(root).as_posix()
        if rel.endswith("_test.py") or rel == "api/services/bars_sqlite.py":
            continue
        src = p.read_text(encoding="utf-8", errors="ignore")
        try:
            calls = door_calls(ast.parse(src))
        except SyntaxError:
            continue
        if not calls:
            continue
        if rel in RAW_REQUIRED:
            bad += [f"{rel}:{c.lineno} reads the door outside raw_reads()" for c, raw in calls if not raw]
        elif WRITES.search(src) and rel not in READ_ONLY_OK:
            bad.append(f"{rel}: reads the store door AND writes the store; classify it (RAW_REQUIRED or READ_ONLY_OK)")
    return bad


def test_every_read_modify_write_caller_reads_raw_and_every_writer_is_classified():
    assert audit() == []


def test_the_rail_can_fail(tmp_path):
    (tmp_path / "api" / "services").mkdir(parents=True)
    (tmp_path / "api" / "services" / "new_writer.py").write_text(
        "from api.services import bars_sqlite\nrows = bars_sqlite.get_bars('X', 'D', 5)\nbars_sqlite.put_bars('X', 'D', [])\n")
    assert audit(tmp_path) == ["api/services/new_writer.py: reads the store door AND writes the store; classify it "
                               "(RAW_REQUIRED or READ_ONLY_OK)"]
    (tmp_path / "api" / "services" / "bars_split_repair.py").write_text(
        "from api.services import bars_sqlite\nrows = bars_sqlite.get_bars('X', 'D', 5)\n")
    assert "api/services/bars_split_repair.py:2 reads the door outside raw_reads()" in audit(tmp_path)


# ── note (1): a rebuild-served ticker's store rows after `end` keep their D1 verdicts ──────────────────────────
def test_store_keeps_after_the_rebuild_end_reach_the_clamp(tmp_path, monkeypatch):
    from api.services import bars_rebuild as R
    from api.services import bars_sanitize as S
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(K.ENV_SERVE, raising=False)
    monkeypatch.delenv(R.ENV_SERVE, raising=False)
    monkeypatch.setattr(S, "_meta_cached", lambda t: None)
    days = [d.isoformat() for d in _sessions(30, datetime.date(2010, 4, 1))]
    end = days[9]
    reb = [[t, 61.0, 61.5, 60.5, 61.0, 1000] for t in days[:10]]
    import gzip
    (tmp_path / "bars_rebuild" / "v2").mkdir(parents=True)
    (tmp_path / "bars_rebuild" / "v2" / "PG.json.gz").write_bytes(gzip.compress(json.dumps({"sym": "PG", "end": end, "bars": reb}).encode()))
    (tmp_path / "bars_rebuild" / "manifest.json").write_text(json.dumps({"version": 2, "end": end, "symbols": ["PG"]}))
    R._state.update(version=0, end=None, symbols=frozenset(), loaded=False)
    R._cache.clear()
    K._state.update(version=0, symbols=frozenset(), retired=frozenset(), loaded=False)
    K._cache.clear()
    try:
        assert R.load_local()
        crash = days[15]                                          # a STORE row after the rebuild's end
        keep = {"tf": "D", "src": "store", "d": crash, "op": "keep_wick", "field": "l", "value": 39.37}
        (tmp_path / "bars_corrections" / "v4").mkdir(parents=True)
        (tmp_path / "bars_corrections" / "v4" / "PG.json.gz").write_bytes(K.encode_payload("PG", 4, [keep]))
        (tmp_path / "bars_corrections" / "manifest.json").write_text(json.dumps({"version": 4, "symbols": ["PG"]}))
        assert K.load_local()
        stored = [{"t": t, "o": 61.0, "h": 61.5, "l": 60.5, "c": 61.0, "v": 1000} for t in days]
        stored[15] = {"t": crash, "o": 61.91, "h": 62.67, "l": 39.37, "c": 60.75, "v": 5000}
        monkeypatch.setattr(S, "_reaches_store_head", lambda t, b, tf: True)
        out = S.sanitize_daily_bars("PG", stored, "D")
        assert [b for b in out if b["t"] == crash][0]["l"] == 39.37
    finally:
        R._state.update(version=0, end=None, symbols=frozenset(), loaded=False)
        R._cache.clear()
        K._state.update(version=0, symbols=frozenset(), retired=frozenset(), loaded=False)
        K._cache.clear()


# ── twice = once (coordinator review of #2265) ─────────────────────────────────────────────────────────────
def test_door_then_serve_equals_one_application_and_counts_once(store, tmp_path):
    """A stored row passes the read door AND sanitize_daily_bars' own apply. Compare-and-set makes the second a no-op:
    sets, drops, keep_wick and chk give exactly what ONE application gives, and nothing is counted twice."""
    from api.services import bars_fetch as F
    from api.services import bars_sanitize as S
    filler = DAYS[5].isoformat()
    bars_sqlite.put_bars("SPY", "D", [{"t": filler, "o": 120.0, "h": 120.0, "l": 120.0, "c": 120.0, "v": 0}], date_tf=True)
    other = DAYS[10].isoformat()
    ents = [{"tf": "D", "src": "store", "d": ISO, "op": "set", "f": {"l": [112.09, 119.57]}, "chk": {"c": 119.63}},
            {"tf": "D", "src": "store", "d": filler, "op": "drop", "old": [120.0, 120.0, 120.0, 120.0, 0]},
            {"tf": "D", "src": "store", "d": other, "op": "set", "f": {"h": [121.0, 120.9]}, "chk": {"c": 99.0}},  # chk refuses
            {"tf": "D", "src": "store", "d": DAYS[15].isoformat(), "op": "keep_wick", "field": "l", "value": 119.0}]
    (tmp_path / "bars_corrections" / "v5").mkdir(parents=True)
    (tmp_path / "bars_corrections" / "v5" / "SPY.json.gz").write_bytes(K.encode_payload("SPY", 5, ents))
    (tmp_path / "bars_corrections" / "manifest.json").write_text(json.dumps({"version": 5, "symbols": ["SPY"]}))
    assert K.load_local()
    with K.raw_reads():
        raw = bars_sqlite.get_bars("SPY", "D", 100)
    once = K.apply_rows("SPY", "D", raw)
    K._counts.clear()
    door = bars_sqlite.get_bars("SPY", "D", 100)
    assert door == once
    served = S.sanitize_daily_bars("SPY", F._fmt_sqlite_bars(door, "D", None), "D")      # the serve path's own apply
    expect = S._clamp_wicks(F._fmt_sqlite_bars(once, "D", None), K.keep_wicks("SPY", "store"))
    assert [b["t"] for b in served] == [b["t"] for b in expect] and served == expect
    assert K._counts["set_applied"] == 1 and K._counts["drop_applied"] == 1
    assert K._counts["set_missed_field"] == 0                 # the second pass counts "already", never a miss


# ── every writer, named (coordinator review of #2265) ──────────────────────────────────────────────────────
#: Paths that WRITE bars and how each stays raw. The R2 snapshot writer and the restore read ohlcv with SQL of
#: their own and never touch the door, so a published correction can never be baked into a snapshot.
DIRECT_SQL_NEVER_THE_DOOR = ("api/services/data_sync.py", "api/services/bars_restore.py",
                             "api/services/bars_reconciliation.py", "api/services/bars_live_store.py")


@pytest.mark.parametrize("rel", DIRECT_SQL_NEVER_THE_DOOR)
def test_the_snapshot_writer_and_its_kin_never_read_the_door(rel):
    calls = door_calls(ast.parse((REPO / rel).read_text(encoding="utf-8")))
    assert calls == [], f"{rel} reads the store door: a correction could be written into a snapshot or a row"


# ── threads (coordinator review of #2265) ──────────────────────────────────────────────────────────────────
THREAD_HOPS = re.compile(r"\.submit\(|run_in_executor|\bThread\(|to_thread\(|\.map\(")


def raw_blocks_that_hop(root=REPO):
    """raw_reads() is a ContextVar: it does not follow into an executor or a new thread. Any `with ...raw_reads():`
    block that hands work to one is named."""
    bad = []
    for p in sorted((root / "api").rglob("*.py")):
        src = p.read_text(encoding="utf-8", errors="ignore")
        if "raw_reads" not in src:
            continue
        for n in ast.walk(ast.parse(src)):
            if isinstance(n, ast.With) and any("raw_reads" in ast.unparse(i.context_expr) for i in n.items):
                body = "\n".join(ast.unparse(b) for b in n.body)
                if THREAD_HOPS.search(body):
                    bad.append(f"{p.relative_to(root).as_posix()}:{n.lineno}")
    return bad


def test_no_raw_block_hands_its_read_to_another_thread(tmp_path):
    assert raw_blocks_that_hop() == []
    (tmp_path / "api").mkdir()
    (tmp_path / "api" / "x.py").write_text("def f(pool, K):\n    with K.raw_reads():\n        pool.submit(print)\n")
    assert raw_blocks_that_hop(tmp_path) == ["api/x.py:2"]
