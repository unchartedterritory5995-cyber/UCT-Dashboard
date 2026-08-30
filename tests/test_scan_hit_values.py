"""The value a definition answered with, stored beside the hit.

⛔⛔ THE GAP TWO INDEPENDENT COMPETITIVE REGISTERS BOTH RANKED FIRST. TC2000's whole
product is a sortable column of any formula; ours could filter on a definition and
never sort by it. The sweep was COMPUTING the value on every hit and throwing it
away — ``scan_evaluator`` said so beside the line that built the row: *"THE VALUE AND
THE BAR IT CAME FROM, beside the symbol. The sweep discards both."*

⛔ ABSENT IS NOT ZERO, and that is why the column is NULLable. A row written before
this column existed has no value, and 0.0 would be a number a member could sort by —
indistinguishable from a real answer. NULL says "not recorded".
"""

import sqlite3

import pytest

from api.services.screener import scan_store, snapshot_db


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """A throwaway snapshot db. ⛔ NEVER the shared root — the repo-root conftest
    tripwire fails the whole run on a write into it, and rightly."""
    db = tmp_path / "snap.db"
    monkeypatch.setattr(snapshot_db, "DB_PATH", str(db), raising=False)
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    snapshot_db.init_db()
    return str(db)


def _cols(db, table):
    with sqlite3.connect(db) as conn:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_scan_hits_carries_a_value_column(store):
    assert "value" in _cols(store, "scan_hits")


def test_the_value_is_stored_and_read_back(store):
    scan_store.record_hits("d" * 12, "D", 20260829, ["AAPL", "MSFT"],
                           values={"AAPL": 71.5, "MSFT": 42.0})
    with sqlite3.connect(store) as conn:
        rows = dict(conn.execute(
            "SELECT ticker, value FROM scan_hits WHERE def_hash=?", ("d" * 12,)))
    assert rows == {"AAPL": 71.5, "MSFT": 42.0}


def test_a_caller_that_passes_no_values_writes_NULL_not_zero(store):
    """⛔ THE DISTINCTION THAT MATTERS. Every pre-existing caller passes no values,
    and 0.0 would put a fabricated number in a sortable column."""
    scan_store.record_hits("e" * 12, "D", 20260829, ["AAPL"])
    with sqlite3.connect(store) as conn:
        (value,) = conn.execute(
            "SELECT value FROM scan_hits WHERE def_hash=?", ("e" * 12,)).fetchone()
    assert value is None


def test_the_value_map_is_keyed_by_the_UPPER_CASED_ticker(store):
    """⚰️ THE SILENT FAILURE THIS PINS. ``record_hits`` upper-cases every ticker
    because ``screener_rows.ticker`` is stored upper-cased. A values map keyed in the
    caller's own casing would write NULL for every row while the hits themselves
    landed perfectly — a feature that looks wired and stores nothing."""
    scan_store.record_hits("f" * 12, "D", 20260829, ["aapl"], values={"aapl": 12.5})
    with sqlite3.connect(store) as conn:
        rows = dict(conn.execute(
            "SELECT ticker, value FROM scan_hits WHERE def_hash=?", ("f" * 12,)))
    assert rows == {"AAPL": 12.5}


def test_a_hit_missing_from_the_values_map_still_records_the_HIT(store):
    """⛔ MEMBERSHIP CANNOT REGRESS BEHIND A PRESENTATION FEATURE. The hits list is
    the authority on who matched; the values ride BESIDE it."""
    scan_store.record_hits("g" * 12, "D", 20260829, ["AAPL", "MSFT"],
                           values={"AAPL": 3.0})
    with sqlite3.connect(store) as conn:
        rows = dict(conn.execute(
            "SELECT ticker, value FROM scan_hits WHERE def_hash=?", ("g" * 12,)))
    assert rows == {"AAPL": 3.0, "MSFT": None}
    assert scan_store.hits("g" * 12, "D", 20260829) == ["AAPL", "MSFT"]


def test_an_unusable_value_is_dropped_rather_than_crashing_the_write(store):
    """A None or a non-numeric must not take the whole sweep's write down with it."""
    scan_store.record_hits("h" * 12, "D", 20260829, ["AAPL", "MSFT"],
                           values={"AAPL": None, "MSFT": "not a number"})
    assert scan_store.hits("h" * 12, "D", 20260829) == ["AAPL", "MSFT"]


def test_an_OLD_table_without_the_column_is_WIDENED_by_init(tmp_path, monkeypatch):
    """⛔⛔ THE PRODUCTION PATH, AND THE ONE THIS REPO HAS ALREADY PAID FOR ONCE.
    ``CREATE TABLE IF NOT EXISTS`` NEVER WIDENS — ``screener_live`` sat at 0 rows for
    as long as nobody read it. A pod already holding the four-column ``scan_hits``
    keeps it unless ALTERed, and every write naming ``value`` would fail THERE while
    passing in every test here.

    So this builds the OLD shape by hand first, then runs ``init_db`` over it.
    """
    db = tmp_path / "old.db"
    with sqlite3.connect(str(db)) as conn:
        conn.execute("""
            CREATE TABLE scan_hits (
              def_hash TEXT NOT NULL, tf TEXT NOT NULL,
              as_of INTEGER NOT NULL, ticker TEXT NOT NULL,
              PRIMARY KEY (def_hash, tf, as_of, ticker)
            ) WITHOUT ROWID""")
        conn.execute("INSERT INTO scan_hits VALUES ('i'*12,'D',20260101,'OLD')"
                     .replace("'i'*12", "'iiiiiiiiiiii'"))
        conn.commit()
    assert "value" not in _cols(str(db), "scan_hits")

    monkeypatch.setattr(snapshot_db, "DB_PATH", str(db), raising=False)
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    snapshot_db.init_db()

    assert "value" in _cols(str(db), "scan_hits"), (
        "an existing scan_hits was not widened — every write naming `value` will "
        "fail on a pod that already held this table")
    # ⭐ AND THE PRE-EXISTING ROW SURVIVES, carrying NULL rather than a fabricated 0.
    with sqlite3.connect(str(db)) as conn:
        (ticker, value) = conn.execute(
            "SELECT ticker, value FROM scan_hits").fetchone()
    assert (ticker, value) == ("OLD", None)


def test_hit_values_returns_the_map_and_omits_unrecorded(store):
    """⛔ ABSENT, NOT 0.0 — the caller must be able to tell "answered 0" from "not
    recorded", and only an absence can say the second."""
    scan_store.record_hits("j" * 12, "D", 20260829, ["AAPL", "MSFT"],
                           values={"AAPL": 8.25})
    vals = scan_store.hit_values("j" * 12, "D", 20260829)
    assert vals == {"AAPL": 8.25}
    assert "MSFT" not in vals


def test_a_recorded_ZERO_survives_as_a_real_answer(store):
    """⚰️ THE CASE A TRUTHY TEST WOULD DROP. 0.0 is a legitimate answer for a
    definition and must reach the member; only NULL means "not recorded"."""
    scan_store.record_hits("k" * 12, "D", 20260829, ["AAPL"], values={"AAPL": 0.0})
    assert scan_store.hit_values("k" * 12, "D", 20260829) == {"AAPL": 0.0}


def test_hits_for_carries_the_NIGHTLY_value_when_there_is_no_live_row(store):
    """⭐ THE COMPLETION OF THE PATH. The sweep stored the value; `_row` sourced it
    from the LIVE row alone, so a nightly-only symbol reported None and the screen
    still could not be sorted — stored and never read."""
    scan_store.record_hits("m" * 12, "D", 20260829, ["AAPL", "MSFT"],
                           values={"AAPL": 71.5})
    out = scan_store.hits_for("m" * 12, "D", 20260829)
    by = {r["symbol"]: r for r in out["rows"]}
    assert by["AAPL"]["value"] == 71.5
    assert by["AAPL"]["tier"] == "nightly"
    # ⛔ and the one with no recorded value stays None rather than 0.0
    assert by["MSFT"]["value"] is None
    # ⛔ membership is unchanged either way
    assert sorted(by) == ["AAPL", "MSFT"]
