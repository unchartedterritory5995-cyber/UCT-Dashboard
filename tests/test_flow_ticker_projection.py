"""`/api/flow/ticker` serves a PROJECTION, because "tiny result set" stopped
being true.

The endpoint's own docstring called one symbol "a tiny payload (tens of rows)",
and that was accurate of an uploaded BBS CSV. It has not been true since the
OPRA WS consumer went live: measured against production 2026-08-06,

    SPY   ?source=indexes   349,203 rows   40.9 MB CSV   8.2 MB gzipped
    NVDA  ?source=stocks    141,639 rows   19.9 MB CSV   3.5 MB gzipped
    AAPL  ?source=stocks     68,018 rows    9.5 MB CSV   1.7 MB gzipped

and `_build_gzipped_symbol_csv` materializes the whole thing in memory before a
byte ships, so that build IS the time-to-first-byte (measured 7.59 s for SPY).
The Signature flow-breakout read parses three of those twenty-two columns.

`?cols=` lets a caller ask for what it reads. It is OPTIONAL and defaults to
every column, so this is additive: an older caller, and an older deploy of this
service answering a newer caller, both behave exactly as before.

The one thing it may NOT do is answer a question it did not understand. Readers
on this surface resolve fields BY NAME out of the header, so a silently-narrowed
body is either a raised parse or - worse - a join that matches nothing and
reports a quiet tape. An unknown column is therefore a 400.
"""
import gzip
import os
import tempfile

import pytest

from api.flow_db import COLUMNS, FlowDB, parse_columns
from tests.authclients import sign_in_flow_caller

FCB_COLS = ["CreatedDate", "CallPut", "Premium"]


@pytest.fixture
def db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.unlink(path)
    d = FlowDB(path)
    yield d
    for p in (path, path + "-wal", path + "-shm"):
        try:
            os.unlink(p)
        except OSError:
            pass


def _seed(d, symbol, source, n):
    """`n` rows carrying a value in EVERY column.

    Every column is filled on purpose: a projection test seeded with blanks
    would measure the width of the commas rather than the width of the data,
    and would show a saving whether or not any bytes were actually dropped.
    """
    rows = []
    for i in range(n):
        row = {c: f"{c}-{i:05d}" for c in COLUMNS}
        row["Symbol"] = symbol
        row["CreatedDate"] = "6/21/2026"
        row["CallPut"] = "C"
        row["Premium"] = "1200000"
        rows.append(row)
    header = ",".join(COLUMNS)
    body = "\n".join(",".join(r[c] for c in COLUMNS) for r in rows)
    d.insert_csv(header + "\n" + body + "\n", source=source)


# -- parse_columns: the allow-list at the request boundary --------------------

def test_no_cols_means_every_column_which_is_what_every_caller_had():
    """Blank and absent both mean "all". This parameter is additive or it is a
    breaking change to every existing consumer of the surface."""
    assert parse_columns(None) is None
    assert parse_columns("") is None
    assert parse_columns("   ") is None
    assert parse_columns(",,") is None


def test_a_projection_keeps_the_CALLERS_order_and_drops_repeats():
    """The header the caller receives has to describe the rows it receives, so
    the order is the caller's, not the schema's. A repeated name would emit a
    repeated column, which no by-name reader expects."""
    assert parse_columns("Premium,CallPut,CreatedDate") == [
        "Premium", "CallPut", "CreatedDate"]
    assert parse_columns(" CreatedDate , CallPut ") == ["CreatedDate", "CallPut"]
    assert parse_columns("Premium,Premium,CallPut") == ["Premium", "CallPut"]


def test_an_unknown_column_is_REFUSED_and_never_quietly_dropped():
    """Dropping it would narrow the header behind the caller's back, and the
    readers here resolve by name - so the failure would surface as an empty
    join, i.e. as a quiet tape, which is the one thing this surface must never
    fake."""
    with pytest.raises(ValueError, match="unknown flow column"):
        parse_columns("CreatedDate,Premmium")
    with pytest.raises(ValueError, match="unknown flow column"):
        parse_columns("CreatedDate,1) OR 1=1")


def test_the_projection_is_resolved_by_MEMBERSHIP_not_interpolated():
    """`cols` is user input that ends up in a SELECT list. Every accepted name
    is a member of the declared schema, so nothing that is not a column name can
    reach the query text at all."""
    for name in parse_columns(",".join(COLUMNS)):
        assert name in COLUMNS


# -- stream_csv_symbol: the store method -------------------------------------

def test_the_default_stream_is_UNCHANGED_by_the_new_parameter(db):
    _seed(db, "NVDA", "stocks", 5)

    chunks = list(db.stream_csv_symbol("NVDA", source="stocks"))

    assert chunks[0] == ",".join(COLUMNS) + "\n"
    assert "".join(chunks).count("\r\n") == 5


def test_a_projected_stream_emits_a_header_that_DESCRIBES_its_rows(db):
    """Header and row width must agree or every by-name reader mis-parses."""
    _seed(db, "NVDA", "stocks", 3)

    text = "".join(db.stream_csv_symbol("NVDA", source="stocks", columns=FCB_COLS))
    lines = text.splitlines()

    assert lines[0] == "CreatedDate,CallPut,Premium"
    assert len(lines) == 4
    for line in lines[1:]:
        assert line == "6/21/2026,C,1200000"


def test_the_store_method_refuses_a_column_outside_the_schema(db):
    """Consumed with `list(...)`, deliberately.

    `stream_csv_symbol` is a GENERATOR, so calling it merely builds one - the
    guard cannot fire until something iterates. A `pytest.raises` around the
    bare call would pass against a version with no guard at all
    (`lesson_test_that_passes_vacuously`).

    The message is deliberately NOT worded like `parse_columns`' refusal: two
    gates that share a phrase let a `match=` pin pass while the other is
    deleted.
    """
    with pytest.raises(ValueError, match="not in the flow schema"):
        list(db.stream_csv_symbol("NVDA", source="stocks", columns=["Nope"]))

    bare = db.stream_csv_symbol("NVDA", source="stocks", columns=["Nope"])
    assert bare is not None, "a generator, not yet a refusal - hence list() above"


def test_the_projection_ACTUALLY_REMOVES_BYTES(db):
    """The artifact, not a proxy.

    This is the whole latency claim, so it is asserted on the built payload -
    the same `_build_gzipped_symbol_csv` production ships - and not on a row
    count or a column count, either of which could shrink while the body did
    not.
    """
    from api import flow_router

    _seed(db, "NVDA", "stocks", 2000)
    saved = flow_router.db
    flow_router.db = db
    try:
        full = flow_router._build_gzipped_symbol_csv("NVDA", "stocks")
        narrow = flow_router._build_gzipped_symbol_csv("NVDA", "stocks",
                                                       columns=FCB_COLS)
    finally:
        flow_router.db = saved

    plain_full = len(gzip.decompress(full))
    plain_narrow = len(gzip.decompress(narrow))
    assert plain_narrow < plain_full * 0.25, (plain_narrow, plain_full)
    assert len(narrow) < len(full) * 0.5, (len(narrow), len(full))
    # ...and the rows survived the diet: fewer BYTES, never fewer ROWS.
    assert gzip.decompress(narrow).count(b"\r\n") == 2000


# -- the endpoint ------------------------------------------------------------

def _get(db, sym, monkeypatch, **params):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api import flow_router as fr

    # `/api/flow/ticker/{symbol}` carries `require_flow_user` since the
    # 2026-08-09 auth sweep — it was serving 40 MB of the firm's options tape to
    # anyone. These are BEHAVIOUR tests (projection width, refusal on an unknown
    # column), so they get the caller they always implied. The flow family reads
    # the cookie itself, so the identity is installed on `flow_admin_auth` — the
    # gate is left running. Whether the route is gated at all is owned by
    # tests/test_exposed_routes_gated.py and asserted exactly once, there.
    sign_in_flow_caller(monkeypatch)

    app = FastAPI()
    app.include_router(fr.flow_router)
    saved = fr.db
    fr.db = db
    try:
        return TestClient(app).get(f"/api/flow/ticker/{sym}", params=params)
    finally:
        fr.db = saved


def test_the_endpoint_defaults_to_every_column(db, monkeypatch):
    # `r.content` is already PLAIN here: the response declares
    # `Content-Encoding: gzip` and httpx (so TestClient) transparently decodes
    # it, exactly as `httpx.stream(...).iter_lines()` does for the real reader.
    # Decompressing again raises BadGzipFile.
    _seed(db, "NVDA", "stocks", 2)

    r = _get(db, "NVDA", monkeypatch, source="stocks")

    assert r.status_code == 200
    assert r.text.splitlines()[0] == ",".join(COLUMNS)


def test_the_endpoint_honours_a_projection(db, monkeypatch):
    _seed(db, "NVDA", "stocks", 2)

    r = _get(db, "NVDA", monkeypatch, source="stocks", cols=",".join(FCB_COLS))

    assert r.status_code == 200
    lines = r.text.splitlines()
    assert lines[0] == "CreatedDate,CallPut,Premium"
    assert lines[1:] == ["6/21/2026,C,1200000"] * 2


def test_an_unknown_column_is_a_400_not_a_narrower_body(db, monkeypatch):
    """400, because the caller scores a non-200 as a FAILED read and retries it.
    A 200 carrying a body built from a question we did not understand is the
    shape that gets remembered as "no signal" for the next thirty minutes."""
    _seed(db, "NVDA", "stocks", 2)

    r = _get(db, "NVDA", monkeypatch, source="stocks", cols="CreatedDate,Premmium")

    assert r.status_code == 400, r.text
    assert "unknown flow column" in r.text
