"""Rail: recent_first_trade is a skip-scan and returns exactly what the old GROUP BY did
(2026-11-12). The old `WHERE tf='D' GROUP BY ticker` walked every index entry of every
timeframe (19.3 s on a 3.3 GB local store; the boot's `ipo-scan-ref` thread at ~90% of a
core after each deploy). Checked on BOTH layouts: the rowid store + lookup index, and the
clustered (WITHOUT ROWID) store the PR #1102 rollout is moving to."""
import random
import sqlite3

import pytest

from api.services import bars_sqlite as bs

OLD = ("SELECT ticker, MIN(ts) AS first_ts FROM ohlcv WHERE tf='D' "
       "GROUP BY ticker HAVING first_ts>=? AND first_ts>0")


def _store(layout):
    c = sqlite3.connect(":memory:")
    if layout == "clustered":
        c.execute(bs.ohlcv_ddl())
    else:
        c.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
                  "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))")
        c.execute(bs.BARS_INDEX_DDL[bs.LOOKUP_INDEX])
    rnd = random.Random(7)
    rows = []
    for i in range(60):
        t = f"T{i:03d}"
        first = rnd.choice([20200102, 20240603, 20251201, 20260105, 20261001])
        for d in range(rnd.randint(1, 30)):
            rows.append((t, "D", first + d, 1, 1, 1, 1, 1))
        for k in range(rnd.randint(0, 20)):             # intraday rows interleave every ticker
            rows.append((t, "5", 1700000000 + k * 300, 1, 1, 1, 1, 1))
    rows.append(("ONLYINTRADAY", "5", 1700000000, 1, 1, 1, 1, 1))   # no daily bar: excluded
    rows.append(("ZEROTS", "D", 0, 1, 1, 1, 1, 1))                    # ts 0: excluded
    rnd.shuffle(rows)
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    return c


@pytest.mark.parametrize("layout", ["rowid", "clustered"])
@pytest.mark.parametrize("since", [20000101, 20251101, 20260101, 20270101])
def test_matches_the_old_group_by(monkeypatch, layout, since):
    c = _store(layout)
    monkeypatch.setattr(bs, "_conn", lambda: c)
    want = {r[0]: int(r[1]) for r in c.execute(OLD, (since,))}
    assert bs.recent_first_trade(since) == want
    if since == 20000101:
        assert want and "ONLYINTRADAY" not in want and "ZEROTS" not in want


@pytest.mark.parametrize("layout", ["rowid", "clustered"])
def test_it_seeks_rather_than_scans(monkeypatch, layout):
    c = _store(layout)
    monkeypatch.setattr(bs, "_conn", lambda: c)
    seen = []
    real_execute = c.execute

    class Spy:
        def execute(self, sql, *a):
            seen.append(sql)
            return real_execute(sql, *a)

    monkeypatch.setattr(bs, "_conn", lambda: Spy())
    bs.recent_first_trade(20000101)
    plan = " | ".join(r[3] for r in real_execute("EXPLAIN QUERY PLAN " + seen[0], (20000101,)))
    assert "GROUP BY" not in seen[0].upper().replace("\n", " ")
    assert "SCAN ohlcv" not in plan, plan
