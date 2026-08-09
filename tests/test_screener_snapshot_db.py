import importlib


def _fresh(tmp_path, monkeypatch):
    tmp_path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    return db


def test_init_upsert_and_read(tmp_path, monkeypatch):
    db = _fresh(tmp_path, monkeypatch)
    assert db.count_rows() == 0
    n = db.upsert_rows([
        {"ticker": "NVDA", "company": "NVIDIA", "sector": "Technology",
         "price": 184.0, "market_cap": 4.5e12, "rsi14": 61.0,
         "uct_composite": 97, "above_50sma": True,
         "snapshot_date": "2026-06-19", "built_at": 1718800000},
    ])
    assert n == 1
    row = db.get_row("NVDA")
    assert row["company"] == "NVIDIA"
    assert row["rsi14"] == 61.0
    assert row["above_50sma"] == 1  # python bool -> 0/1
    # upsert is replace-by-ticker
    db.upsert_rows([{"ticker": "NVDA", "price": 190.0,
                     "snapshot_date": "2026-06-20", "built_at": 1718900000}])
    assert db.count_rows() == 1
    assert db.get_row("NVDA")["price"] == 190.0


def test_status_reports_freshness(tmp_path, monkeypatch):
    db = _fresh(tmp_path, monkeypatch)
    db.upsert_rows([{"ticker": "AAA", "snapshot_date": "2026-06-19", "built_at": 123}])
    st = db.status()
    assert st["rows"] == 1
    assert st["latest_snapshot_date"] == "2026-06-19"
    assert st["latest_built_at"] == 123


# ─── the reported date must describe the DATA, not the newest single row ─────
#
# 🔴 The defect this section exists for, measured on the live `screener.db`
# 2026-08-09: 3,589 rows, of which ONE was stamped 2026-08-08 and 3,583 were
# stamped 2026-07-11. `MAX(snapshot_date)` is genuinely the maximum, so the
# screener told members "snapshot 2026-08-08" over fundamentals 28 days stale
# and they screened on them.
#
# ⛔ THE SHAPE IS BUILT HERE, NEVER READ OFF THE LIVE DB. A test that measures
# the artifact it is guarding goes green the day the artifact is repaired and
# never fails again.

_SKEW = (("2026-08-08", 1), ("2026-07-11", 3583), ("2026-07-10", 5))


def _seed(db, spec, prefix="T"):
    """Insert `spec` = ((snapshot_date | None, count), ...) with unique tickers."""
    rows, i = [], 0
    for date_str, count in spec:
        for _ in range(count):
            rows.append({"ticker": f"{prefix}{i}", "snapshot_date": date_str,
                         "built_at": 1_700_000_000 + i, "price": 10.0})
            i += 1
    db.upsert_rows(rows)
    return len(rows)


def test_the_reported_date_is_the_median_row_NOT_the_one_fresh_outlier(tmp_path, monkeypatch):
    db = _fresh(tmp_path, monkeypatch)
    assert _seed(db, _SKEW) == 3589

    st = db.status()
    # the whole point: one rebuilt row does not get to relabel 3,588 stale ones
    assert st["snapshot_date"] == "2026-07-11"
    assert st["snapshot_date"] != "2026-08-08"
    # ...and the MAX is still reported, under a name that only ever claimed
    # to be the newest single row. Both numbers, neither lying.
    assert st["latest_snapshot_date"] == "2026-08-08"
    assert st["newest_snapshot_date"] == "2026-08-08"
    assert st["oldest_snapshot_date"] == "2026-07-10"
    # the second number that makes the first honest
    assert st["rows"] == 3589
    assert st["rows_on_snapshot_date"] == 3583
    assert st["distinct_snapshot_dates"] == 3
    assert st["mixed"] is True


def test_a_single_date_table_still_reports_that_date(tmp_path, monkeypatch):
    """CONTROL — the normal case is untouched, and `mixed` says so."""
    db = _fresh(tmp_path, monkeypatch)
    _seed(db, (("2026-08-09", 40),))
    st = db.status()
    assert st["snapshot_date"] == "2026-08-09"
    assert st["latest_snapshot_date"] == "2026-08-09"
    assert st["oldest_snapshot_date"] == "2026-08-09"
    assert st["rows"] == st["rows_on_snapshot_date"] == 40
    assert st["distinct_snapshot_dates"] == 1
    assert st["mixed"] is False


def test_an_empty_table_reports_no_date_and_does_not_fabricate_one(tmp_path, monkeypatch):
    db = _fresh(tmp_path, monkeypatch)
    st = db.status()
    assert st["rows"] == 0
    assert st["snapshot_date"] is None
    assert st["latest_snapshot_date"] is None
    assert st["newest_snapshot_date"] is None and st["oldest_snapshot_date"] is None
    assert st["rows_on_snapshot_date"] == 0
    assert st["distinct_snapshot_dates"] == 0
    assert st["mixed"] is False


def test_rows_carrying_no_date_are_COUNTED_not_hidden(tmp_path, monkeypatch):
    """A NULL `snapshot_date` is a row of unknown age, not a row that isn't there.

    It must not vote on the median (it has no date to vote with) and it must not
    vanish from `rows` either — 'the screen served 12 rows, 4 of unknown age' is
    the honest sentence.
    """
    db = _fresh(tmp_path, monkeypatch)
    _seed(db, ((None, 4), ("2026-07-11", 8)))
    st = db.status()
    assert st["rows"] == 12
    assert st["rows_missing_snapshot_date"] == 4
    assert st["snapshot_date"] == "2026-07-11"
    assert st["rows_on_snapshot_date"] == 8
    assert st["mixed"] is True

    db2 = _fresh(tmp_path / "b", monkeypatch)
    _seed(db2, ((None, 3),))
    st2 = db2.status()
    assert st2["rows"] == 3 and st2["rows_missing_snapshot_date"] == 3
    assert st2["snapshot_date"] is None
    assert st2["mixed"] is False


def test_the_median_here_agrees_with_the_evaluators_own_gate(tmp_path, monkeypatch):
    """⚠️ TWO SPELLINGS OF ONE STATISTIC, AND THEY MUST NOT DRIFT.

    `scan_evaluator._median_snapshot_date` (E-3, shipped `075e7597`) reads the
    same median for its sweep gate with `ORDER BY snapshot_date LIMIT 1 OFFSET
    n // 2`. Two authorities over one value is this repo's most repeated defect,
    so rather than restate its convention this asserts the two AGREE — including
    on an EVEN row count, where an off-by-one in either walks to a different
    date. Collapsing them to one function is the real fix and belongs to whoever
    owns `scan_evaluator.py`; until then this is the rail.
    """
    from api.services.screener import scan_evaluator

    specs = (_SKEW,
             (("2026-07-10", 2), ("2026-07-11", 2)),          # even, split
             (("2026-07-09", 1), ("2026-07-10", 1), ("2026-07-11", 2)),
             (("2026-08-01", 3),),
             ((None, 2), ("2026-07-11", 3)))
    for i, spec in enumerate(specs):
        db = _fresh(tmp_path / f"case{i}", monkeypatch)
        _seed(db, spec)
        assert db.status()["snapshot_date"] == scan_evaluator._median_snapshot_date(), spec
