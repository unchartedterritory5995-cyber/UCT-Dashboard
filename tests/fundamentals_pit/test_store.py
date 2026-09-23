"""Store: migrations, append-only raw truth, idempotency, versioned derived."""
import sqlite3
from datetime import date, datetime, timezone

import pytest

from api.services.fundamentals_pit import store as S
from api.services.fundamentals_pit.series import Point

from ._build import fact, filing


def _db(tmp_path):
    return S.connect(str(tmp_path / "pit.db"))


def test_migrations_are_recorded_and_idempotent(tmp_path):
    c = _db(tmp_path)
    assert c.execute("PRAGMA user_version").fetchone()[0] == S.SCHEMA_VERSION
    assert S.migrate(c) == S.SCHEMA_VERSION                    # re-run: no-op


def test_newer_schema_is_refused(tmp_path):
    c = _db(tmp_path)
    c.execute(f"PRAGMA user_version = {S.SCHEMA_VERSION + 1}")
    c.close()
    with pytest.raises(S.SchemaTooNew):
        S.connect(str(tmp_path / "pit.db"))


def test_reingesting_the_same_document_is_a_no_op(tmp_path):
    c = _db(tmp_path)
    fl = {"A": filing("A", "2021-02-10T21:00:00", form="10-K")}
    fx = [fact("Revenues", "2020-01-01", "2020-12-31", 100, "A")]
    with S.tx(c):
        assert S.put_filings(c, 1, fl) == 1 and S.put_facts(c, 1, fx) == 1
    with S.tx(c):
        assert S.put_filings(c, 1, fl) == 0 and S.put_facts(c, 1, fx) == 0
    assert c.execute("SELECT count(*) FROM fact").fetchone()[0] == 1


def test_a_restated_value_is_a_new_row_the_original_survives(tmp_path):
    c = _db(tmp_path)
    fl = {"A": filing("A", "2021-02-10T21:00:00", form="10-K"), "B": filing("B", "2021-06-01T14:00:00", form="10-K/A")}
    with S.tx(c):
        S.put_filings(c, 1, fl)
        S.put_facts(c, 1, [fact("Revenues", "2020-01-01", "2020-12-31", 100, "A"),
                           fact("Revenues", "2020-01-01", "2020-12-31", 90, "B")])
    vals = sorted(r[0] for r in c.execute("SELECT val FROM fact"))
    assert vals == [90, 100]
    got = {f.accn: f.val for f in S.load_facts(c, 1)}
    assert got == {"A": 100, "B": 90}


def test_filing_metadata_is_frozen_and_disagreement_is_logged(tmp_path):
    c = _db(tmp_path)
    with S.tx(c):
        S.put_filings(c, 1, {"A": filing("A", "2021-02-10T21:00:00", form="10-K")})
    with S.tx(c):
        S.put_filings(c, 1, {"A": filing("A", "2021-02-10T21:05:00", form="10-K")})
    f = S.load_filings(c, 1)["A"]
    assert f.accepted_at == datetime(2021, 2, 10, 21, 0, tzinfo=timezone.utc)
    assert c.execute("SELECT count(*) FROM filing_anomaly").fetchone()[0] == 1


def test_round_trip_facts_and_filings(tmp_path):
    c = _db(tmp_path)
    fl = {"A": filing("A", "2021-02-10T21:00:00", form="10-K")}
    fx = [fact("Revenues", "2020-01-01", "2020-12-31", 100, "A"), fact("Assets", None, "2020-12-31", 5, "A")]
    with S.tx(c):
        S.put_filings(c, 1, fl)
        S.put_facts(c, 1, fx)
    assert S.load_filings(c, 1)["A"] == fl["A"]
    assert sorted((f.tag, f.start, f.end, f.val) for f in S.load_facts(c, 1)) == \
        sorted((f.tag, f.start, f.end, f.val) for f in fx)


def test_derived_versions_do_not_overwrite_each_other(tmp_path):
    c = _db(tmp_path)
    p = lambda v: Point(datetime(2021, 2, 10, 21, tzinfo=timezone.utc), v, date(2020, 12, 31),
                        (("us-gaap:Revenues", date(2020, 1, 1), date(2020, 12, 31), "A"),), "fiscal_year")
    with S.tx(c):
        S.replace_series(c, 1, 1, {"revenue_ttm": [p(100)]}, "h1", {})
        S.replace_series(c, 1, 2, {"revenue_ttm": [p(101)]}, "h2", {})
    assert S.read_series(c, 1, 1)["revenue_ttm"][0][1] == 100
    assert S.read_series(c, 1, 2)["revenue_ttm"][0][1] == 101
    with S.tx(c):                                         # rebuild v2 replaces v2 only
        S.replace_series(c, 1, 2, {"revenue_ttm": [p(102)]}, "h3", {})
    assert S.read_series(c, 1, 1)["revenue_ttm"][0][1] == 100
    assert S.read_series(c, 1, 2)["revenue_ttm"][0][1] == 102
    assert S.build_info(c, 1, 2)["input_hash"] == "h3"


def test_a_failed_transaction_leaves_nothing(tmp_path):
    c = _db(tmp_path)
    with pytest.raises(RuntimeError):
        with S.tx(c):
            S.put_filings(c, 1, {"A": filing("A", "2021-02-10T21:00:00", form="10-K")})
            raise RuntimeError("crash mid-ingest")
    assert c.execute("SELECT count(*) FROM filing").fetchone()[0] == 0
