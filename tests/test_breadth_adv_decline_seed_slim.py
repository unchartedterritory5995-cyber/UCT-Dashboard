"""The cumulative-A/D seed reads the numeric projection, never the whole blob table.

2026-10-13 15:37Z: every cold Breadth Monitor build ran
`SUM(json_extract(metrics, '$.adv_decline')) FROM breadth_snapshots WHERE date < ?`,
parsing the ~636 KB blob of every earlier session (rchar +473-741 MB per request).
With the pod busy that turned a 0.4 s read into 22-44 s for every member who
opened Breadth. The value lives in `breadth_snapshot_numeric` too.

These rails pin two things: the slim reader answers exactly what the blob query
answered (including dates the projection has not reached, and a projection row
whose blob is gone), and the three readers use it.
"""
import json
import sqlite3

import pytest

from api.services import breadth_monitor as bm


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    db = tmp_path / "breadth.db"
    monkeypatch.setattr(bm, "_db_path", lambda: str(db))

    class _NoCache:
        def get(self, *_a, **_k):
            return None

        def set(self, *_a, **_k):
            pass

        def delete_prefix(self, *_a, **_k):
            pass

    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()
    yield db


DATES = [f"2026-02-{d:02d}" for d in range(2, 28)]


def _seed():
    """Mixed store: most dates projected, three blob-only, one projection orphan,
    one blob with no adv_decline, and blob lists large enough to be the cost."""
    big = ["T%04d" % i for i in range(2000)]
    with sqlite3.connect(bm._db_path()) as c:
        for i, d in enumerate(DATES):
            m = {"adv_decline": (i * 37) % 500 - 220, "up_4pct_today": i,
                 "universe_list": big}
            if i == 7:
                m.pop("adv_decline")
            c.execute("INSERT INTO breadth_snapshots (date, metrics) VALUES (?, ?)",
                      (d, json.dumps(m)))
            if i not in (3, 11, 19):              # blob-only dates
                c.execute("INSERT INTO breadth_snapshot_numeric (date, metrics) VALUES (?, ?)",
                          (d, json.dumps(bm.numeric_of(m))))
        # a projection row whose blob was deleted must not enter any sum
        c.execute("INSERT INTO breadth_snapshot_numeric (date, metrics) VALUES (?, ?)",
                  ("2026-02-01", json.dumps({"adv_decline": 100000})))
        c.commit()


def _old_sum(c, oldest):
    return c.execute(
        "SELECT COALESCE(SUM(json_extract(metrics, '$.adv_decline')), 0) "
        "FROM breadth_snapshots WHERE date < ?", (oldest,)).fetchone()[0]


def _old_rows(c, op, bound):
    return sorted(c.execute(
        f"SELECT date, json_extract(metrics, '$.adv_decline') FROM breadth_snapshots "
        f"WHERE date {op} ?", (bound,)).fetchall())


@pytest.mark.parametrize("bound", DATES + ["2026-01-01", "2026-12-31"])
def test_the_slim_sum_equals_the_blob_sum_for_every_boundary(bound):
    _seed()
    with sqlite3.connect(bm._db_path()) as c:
        assert bm._adv_decline_sum_before(c, bound) == _old_sum(c, bound)


@pytest.mark.parametrize("op", ["<", "<="])
@pytest.mark.parametrize("bound", ["2026-02-05", "2026-02-12", "2026-02-27"])
def test_the_slim_rows_equal_the_blob_rows(op, bound):
    _seed()
    with sqlite3.connect(bm._db_path()) as c:
        assert sorted(tuple(r) for r in bm._adv_decline_rows(c, op, bound)) == _old_rows(c, op, bound)


def test_non_vacuity_the_fixture_has_blob_only_dates_and_an_orphan():
    _seed()
    with sqlite3.connect(bm._db_path()) as c:
        blob = {r[0] for r in c.execute("SELECT date FROM breadth_snapshots")}
        proj = {r[0] for r in c.execute("SELECT date FROM breadth_snapshot_numeric")}
        assert len(blob - proj) == 3 and proj - blob == {"2026-02-01"}
        assert _old_sum(c, "2026-12-31") != 0


def test_a_projected_date_is_not_read_off_the_blob():
    """The projection wins where it has the date. Make the blob disagree and the
    answer must follow the projection: proof the blob is not being parsed."""
    _seed()
    with sqlite3.connect(bm._db_path()) as c:
        c.execute("UPDATE breadth_snapshots SET metrics = ? WHERE date = ?",
                  (json.dumps({"adv_decline": 777777}), DATES[0]))
        c.commit()
        rows = dict(bm._adv_decline_rows(c, "<=", DATES[0]))
        assert rows[DATES[0]] == (0 * 37) % 500 - 220


def test_the_three_readers_no_longer_scan_the_blob_column():
    import inspect
    src = "\n".join(l for l in inspect.getsource(bm).splitlines()
                    if not l.lstrip().startswith("#"))
    assert src.count("json_extract(metrics, '$.adv_decline')") == 0
    assert "FROM breadth_snapshots WHERE date < ?" not in src
    for fn in (bm._history_uncached, bm._adv_decline_seed_before, bm.v1_merged_adv_decline):
        body = inspect.getsource(fn)
        assert "_adv_decline_" in body, fn.__name__


def test_get_history_seed_is_unchanged_end_to_end():
    """The derived cumulative line through the public reader matches a reference
    built from the blob query."""
    _seed()
    rows = bm.get_history(5)
    assert rows, "get_history returned nothing"
    with sqlite3.connect(bm._db_path()) as c:
        oldest_fetched = sorted(
            r[0] for r in c.execute(
                "SELECT date FROM breadth_snapshots ORDER BY date DESC LIMIT ?",
                (5 + bm._ROLLING_WARMUP,)))[0]
        seed = _old_sum(c, oldest_fetched)
        vals = dict(_old_rows(c, "<=", "2026-12-31"))
    expected = seed + sum(v for d, v in vals.items() if d >= oldest_fetched and d <= rows[0]["date"] and v is not None)
    assert rows[0]["adv_decline_cum"] == expected
