"""The R2 snapshot must carry every index the web's bars.db readers expect.

INCIDENT 2026-10-02 (docs/incidents/2026-10-02-web-boot-bydate-index.md). The
worker's snapshot is a backup-API copy of the WORKER's bars.db, and the worker had
never built the web-only `idx_ohlcv_daily_bydate`. Installed on web, the missing
index turned a boot-time calendar query into a scan of the whole 31 GB store on
the event-loop thread, and made every boot start a ~13-minute CREATE INDEX.

Rails:
1. `_make_tarball` ships a bars.db holding EVERY `bars_sqlite.BARS_INDEX_DDL`
   index even when the source lacks one -- built on the private copy, the source
   left untouched.
2. CENSUS: every `CREATE INDEX ... ON ohlcv` written anywhere under api/ names an
   index in `BARS_INDEX_DDL`, so a new ensure_* cannot add an index the snapshot
   does not carry. Derived from the AST every run, never a typed list.
3. The calendar query the boot depended on never plans a full scan of ohlcv when
   the by-date index is absent.
"""
from __future__ import annotations

import ast
import importlib
import os
import re
import shutil
import sqlite3
import tarfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
API = REPO / "api"

_OHLCV = (
    "CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
    "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))"
)


def _indexes(db_path) -> set[str]:
    c = sqlite3.connect(str(db_path))
    try:
        return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    finally:
        c.close()


@pytest.fixture
def data_sync_at(tmp_path, monkeypatch):
    """data_sync reloaded against a tmp DATA_DIR, and restored afterwards (the
    module object is shared; see api/services/data_sync_test.py)."""
    from api.services import data_sync
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    importlib.reload(data_sync)
    yield data_sync
    monkeypatch.undo()
    importlib.reload(data_sync)


def test_the_snapshot_ships_every_expected_index_even_when_the_source_lacks_one(tmp_path, data_sync_at):
    from api.services import bars_sqlite

    src = tmp_path / "bars.db"
    c = sqlite3.connect(str(src))
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(_OHLCV)
    c.execute(bars_sqlite.BARS_INDEX_DDL[bars_sqlite.LOOKUP_INDEX])   # the worker's shape
    c.executemany(
        "INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
        [("AAPL", "D", 20200101 + i, 1.0, 2.0, 0.5, 1.5, 100)
         for i in range(data_sync_at.SNAPSHOT_MIN_OHLCV_ROWS)],
    )
    c.commit()
    c.close()
    # Control: the source is the incident's shape -- the by-date index is MISSING.
    assert bars_sqlite.DAILY_BYDATE_INDEX not in _indexes(src)

    tar_path = data_sync_at._make_tarball()
    out = tmp_path / "extracted"
    out.mkdir()
    try:
        with tarfile.open(tar_path, mode="r:gz") as tar:
            tar.extractall(out)
    finally:
        shutil.rmtree(os.path.dirname(tar_path), ignore_errors=True)

    shipped = _indexes(out / "bars.db")
    missing = sorted(set(bars_sqlite.BARS_INDEX_DDL) - shipped)
    assert not missing, (
        f"the snapshot would install a bars.db WITHOUT {missing}; every web boot "
        "after that install pays for it (incident 2026-10-02)"
    )
    # The build happened on the COPY: the worker's live DB was not written to.
    assert bars_sqlite.DAILY_BYDATE_INDEX not in _indexes(src)


_CREATE_INDEX_ON_OHLCV = re.compile(
    r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s+ON\s+ohlcv\b",
    re.IGNORECASE,
)


def _string_texts(tree: ast.AST):
    """Every string literal in a module, f-strings rendered with `{NAME}` holes.
    Implicitly concatenated literals arrive as ONE node, so a DDL split across
    lines is still one statement."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value
        elif isinstance(node, ast.JoinedStr):
            parts = []
            for v in node.values:
                if isinstance(v, ast.Constant):
                    parts.append(str(v.value))
                elif isinstance(v, ast.FormattedValue) and isinstance(v.value, ast.Name):
                    parts.append("{" + v.value.id + "}")
                else:
                    parts.append("{?}")
            yield "".join(parts)


def _index_names_in(text: str, namespace) -> set[str]:
    out = set()
    for m in _CREATE_INDEX_ON_OHLCV.finditer(text):
        name = m.group(1)
        hole = re.fullmatch(r"\{(\w+)\}", name)
        if hole:
            name = str(getattr(namespace, hole.group(1), name))
        out.add(name)
    return out


def _census() -> dict[str, set[str]]:
    from api.services import bars_sqlite
    found: dict[str, set[str]] = {}
    for p in sorted(API.rglob("*.py")):
        if p.name.startswith("test_") or p.name.endswith("_test.py"):
            continue
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        names = set()
        for text in _string_texts(tree):
            names |= _index_names_in(text, bars_sqlite)
        if names:
            found[str(p.relative_to(REPO))] = names
    return found


def test_every_index_created_on_ohlcv_is_one_the_snapshot_carries():
    from api.services import bars_sqlite
    census = _census()
    every = set().union(*census.values()) if census else set()
    # Control: the census SEES the registry's own DDL (f-string holes resolved),
    # so an empty census cannot pass vacuously.
    assert set(bars_sqlite.BARS_INDEX_DDL) <= every, (
        f"the census did not find the registry's own indexes ({sorted(every)}); "
        "it is blind and this rail would pass vacuously"
    )
    unregistered = {f: sorted(n - set(bars_sqlite.BARS_INDEX_DDL))
                    for f, n in census.items() if n - set(bars_sqlite.BARS_INDEX_DDL)}
    assert not unregistered, (
        "an index is created on ohlcv that bars_sqlite.BARS_INDEX_DDL does not "
        f"name, so the R2 snapshot would not carry it: {unregistered}. Add it to "
        "BARS_INDEX_DDL (data_sync._make_tarball builds every entry on the copy)."
    )


def test_the_census_catches_an_unregistered_index():
    """Control for the rail above: an index outside the registry IS found."""
    from api.services import bars_sqlite
    tree = ast.parse(
        'X = ("CREATE INDEX IF NOT EXISTS idx_new_thing "\n'
        '     "ON ohlcv(tf, v)")\n'
    )
    names = set()
    for text in _string_texts(tree):
        names |= _index_names_in(text, bars_sqlite)
    assert names == {"idx_new_thing"}


def _scan_steps(conn, sql: str) -> list[str]:
    return [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql).fetchall()
            if str(r[3]).upper().startswith("SCAN OHLCV")]


@pytest.mark.parametrize("with_bydate", [False, True])
def test_the_session_calendar_query_never_scans_ohlcv(tmp_path, monkeypatch, with_bydate):
    from api.services import bars_sqlite

    db = tmp_path / "bars.db"
    c = sqlite3.connect(str(db))
    c.execute(_OHLCV)
    c.execute(bars_sqlite.BARS_INDEX_DDL[bars_sqlite.LOOKUP_INDEX])
    rows = []
    for t in ("SPY", "QQQ", "AAPL", "MSFT"):
        rows += [(t, "D", 20240101 + i, 1, 1, 1, 1, 1) for i in range(30)]
        rows += [(t, "5", 1700000000 + i * 300, 1, 1, 1, 1, 1) for i in range(30)]
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    if with_bydate:
        c.execute(bars_sqlite.BARS_INDEX_DDL[bars_sqlite.DAILY_BYDATE_INDEX])
    c.commit()

    # Control: the detector sees a full scan when one is planned -- the old
    # unconditional query, on this DB without the by-date index.
    if not with_bydate:
        assert _scan_steps(c, "SELECT DISTINCT ts FROM ohlcv WHERE tf='D' AND ts<99999999 "
                              "ORDER BY ts DESC LIMIT 6"), "the scan detector is blind"
    c.close()

    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(db))
    bars_sqlite.bump_db_epoch()
    seen: list[str] = []
    bars_sqlite._conn().set_trace_callback(seen.append)
    try:
        got = bars_sqlite.nth_recent_trading_date(6, 99999999)
    finally:
        bars_sqlite._conn().set_trace_callback(None)
        bars_sqlite.bump_db_epoch()

    assert got == 20240101 + 24, got   # 30 sessions, the 6th most recent
    queries = [s for s in seen if "FROM ohlcv" in s and s.lstrip().upper().startswith("SELECT")]
    assert queries, f"no ohlcv query was traced: {seen}"
    probe = sqlite3.connect(str(db))
    try:
        scans = {q: _scan_steps(probe, q) for q in queries}
    finally:
        probe.close()
    assert not any(scans.values()), (
        f"the session calendar planned a full scan of ohlcv (by-date index "
        f"{'present' if with_bydate else 'ABSENT'}): {scans}"
    )
